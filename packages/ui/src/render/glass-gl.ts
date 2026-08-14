import {
  daylight,
  hexToRgb,
  litColor,
  textureParams,
  transmission,
  worldToScreen,
  type Backlight,
  type Viewport,
} from '@vitrum/core'
import type { BBox, Vec2 } from '@vitrum/geometry'

/**
 * The WebGL2 realistic-glass renderer (F-053) — the dedicated render pass behind the `render` view
 * mode, following the same factory pattern as the F-051 reference-underlay renderer (`reference/gl.ts`):
 * `createGlassRenderer` returns `null` when no WebGL2 context is available (jsdom in component tests,
 * or a GPU-less environment), so callers no-op gracefully and the shell falls back to the flat
 * Canvas2D render.
 *
 * **Why WebGL, why here.** Light transmitted through textured glass is a per-fragment effect over
 * potentially hundreds of pieces; doing the procedural texture, swatch-photo modulation and backlight
 * on the GPU is what keeps mode-switch instant and pan/zoom smooth (FR-1). The *shading maths* live in
 * pure `@vitrum/core` (`litColor`/`transmission`/`textureParams`), unit-tested without a GL context;
 * the fragment shader mirrors them, and each piece's lit base colour is computed on the CPU by the
 * same `litColor` so GPU and CPU never drift.
 *
 * **Fills use the stencil buffer** (even-odd), not a triangulator: each piece's rings are drawn into
 * the stencil with `INVERT` (holes fall out for free, exactly like the Canvas2D `fill('evenodd')`),
 * then the piece's bounding quad is drawn masked by the stencil with the glass shader. Came/solder are
 * a second pass of extruded ribbons with a rounded specular profile.
 */

/** How light passes through a glass (mirrors `@vitrum/model`'s `TransparencyClass`). */
type TransparencyClass = 'transparent' | 'translucent' | 'opalescent' | 'opaque'
/** Surface texture of a glass (mirrors `@vitrum/model`'s `TextureTag`). */
type TextureTag = 'smooth' | 'hammered' | 'seedy' | 'streaky' | 'ripple' | 'granite'
/** Solder-bead finish (mirrors `@vitrum/core`'s `SolderFinish`). */
type SolderFinish = 'silver' | 'copper' | 'black'

/** A per-piece texture placement (mirrors `@vitrum/model`'s `PieceTextureTransform`). */
export interface TextureTransform {
  readonly rotationDeg: number
  readonly offsetXmm: number
  readonly offsetYmm: number
  readonly scale: number
}

/** One glass piece to render: world-mm rings plus its glass appearance and texture placement. */
export interface GlassPieceInput {
  readonly ring: readonly Vec2[]
  readonly holeRings: readonly (readonly Vec2[])[]
  readonly bbox: BBox
  readonly color: string
  readonly transparency: TransparencyClass
  readonly texture: TextureTag
  /** Key into `resolveSwatch` for the glass's photo swatch, if any (swatch-photo modulation). */
  readonly swatchKey?: string
  readonly textureTransform: TextureTransform
}

/** One came / solder line to render as a rounded, specular-hinted ribbon. */
export interface CameRibbonInput {
  readonly points: readonly Vec2[]
  readonly widthMm: number
  readonly kind: 'lead' | 'foil' | 'border'
}

/** The full realistic-render scene for one frame. */
export interface GlassScene {
  readonly pieces: readonly GlassPieceInput[]
  readonly cames: readonly CameRibbonInput[]
  readonly backlight: Backlight
  readonly solderFinish: SolderFinish
}

/** Resolves a glass's swatch key to a decoded, GPU-uploadable image, or `undefined` if not ready. */
export type ResolveSwatch = (key: string) => TexImageSource | undefined

export interface GlassRenderer {
  render(
    viewport: Viewport,
    sizeCss: { width: number; height: number },
    dpr: number,
    scene: GlassScene,
    resolveSwatch: ResolveSwatch,
  ): void
  dispose(): void
}

const VERT = `#version 300 es
in vec2 aScreen;
in vec2 aWorld;
uniform vec2 uResolution;
out vec2 vWorld;
void main() {
  vWorld = aWorld;
  vec2 clip = (aScreen / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`

// Glass fragment shader. Mirrors @vitrum/core's litColor on the CPU side (uColor is the lit base);
// here we only add the per-fragment procedural texture and optional swatch-photo modulation.
const FRAG_GLASS = `#version 300 es
precision highp float;
in vec2 vWorld;
uniform vec3 uColor;
uniform int uTexKind;
uniform float uFreq;
uniform float uAmp;
uniform float uAniso;
uniform float uRot;
uniform vec2 uOffset;
uniform float uScale;
uniform sampler2D uSwatch;
uniform int uHasSwatch;
uniform vec2 uBboxMin;
uniform vec2 uBboxSize;
out vec4 frag;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// sRGB <-> linear: uColor and the swatch photo arrive in sRGB-ish space. Compositing (texture
// multiply, swatch mix, tone map) happens in linear light, then we encode back to sRGB for display —
// the gamma-correct workflow the Light pass already uses. This does not change litColor (still the
// CPU reference in uColor); it is a display transform only, so the shading unit tests are unaffected.
vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }

void main() {
  // Texture-space position: undo per-piece offset, rotation and scale (all in world mm).
  vec2 p = vWorld - uOffset;
  float c = cos(uRot), s = sin(uRot);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y) / max(uScale, 0.001);
  vec2 fq = q * uFreq;

  float m = 1.0;
  if (uTexKind == 1) {
    // hammered: rounded dimples
    float n = vnoise(fq);
    m = 1.0 + uAmp * (2.0 * n - 1.0);
  } else if (uTexKind == 2) {
    // seedy: sparse dark bubbles
    float n = vnoise(fq);
    float bubble = smoothstep(0.72, 0.9, n);
    m = 1.0 - uAmp * bubble;
  } else if (uTexKind == 3) {
    // streaky: anisotropic streaks (stretched along one axis)
    float n = vnoise(vec2(fq.x / uAniso, fq.y));
    m = 1.0 + uAmp * (2.0 * n - 1.0);
  } else if (uTexKind == 4) {
    // ripple: directional waves plus a little noise
    float wave = sin(q.y * uFreq * 6.2831853 / uAniso);
    m = 1.0 + uAmp * wave * (0.6 + 0.4 * vnoise(fq));
  } else if (uTexKind == 5) {
    // granite: fine high-frequency grain
    float n = vnoise(fq) * 0.6 + vnoise(fq * 2.7) * 0.4;
    m = 1.0 + uAmp * (2.0 * n - 1.0);
  }

  vec3 base = toLinear(uColor);
  vec3 col = base * m;

  if (uHasSwatch == 1) {
    vec2 uv = (vWorld - uBboxMin) / max(uBboxSize, vec2(0.001));
    // apply the same rotation/scale about the piece centre so the photo tracks the transform
    vec2 cc = uv - 0.5;
    cc = vec2(c * cc.x + s * cc.y, -s * cc.x + c * cc.y) / max(uScale, 0.001);
    uv = clamp(cc + 0.5, 0.0, 1.0);
    vec3 tex = toLinear(texture(uSwatch, uv).rgb);
    float luma = dot(tex, vec3(0.299, 0.587, 0.114));
    // Modulate the assigned base colour by the photo's luminance (keeps the glass's hue).
    col = mix(col, base * (0.55 + 0.9 * luma), 0.6);
  }

  // Filmic-ish tone map in linear light so lit glass reads luminous rather than flat, then encode to
  // sRGB for display (gamma-correct output, matching the Light pass).
  col = vec3(1.0) - exp(-col * 1.45);
  frag = vec4(toSrgb(col), 1.0);
}`

// Came / solder ribbon shader: a rounded cross-section (darker at the edges), a specular ridge near
// the centre, and a length-wise bead for foil seams.
const FRAG_CAME = `#version 300 es
precision highp float;
in vec2 vWorld;
in float vAcross;
in float vAlong;
uniform vec3 uCame;
uniform int uBead;
out vec4 frag;
void main() {
  float a = clamp(vAcross, -1.0, 1.0);
  // Rounded profile: edges fall off toward the glass, so the line reads as a raised bead.
  float shade = 1.0 - 0.45 * a * a;
  // A thin, dim sheen near the crown — matte lead, not chromed tube. Solder (bead) is a little
  // glossier than lead, so it catches a touch more light.
  float specAmt = uBead == 1 ? 0.22 : 0.11;
  float spec = exp(-a * a * 16.0) * specAmt;
  float bead = uBead == 1 ? (0.9 + 0.1 * sin(vAlong)) : 1.0;
  vec3 col = uCame * shade * bead + vec3(spec) * bead;
  frag = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

interface CachedSwatch {
  texture: WebGLTexture
  source: TexImageSource
}

/** Create the renderer for `canvas`, or `null` if WebGL2 is unavailable (e.g. jsdom). */
export function createGlassRenderer(canvas: HTMLCanvasElement): GlassRenderer | null {
  const context = canvas.getContext('webgl2', {
    stencil: true,
    premultipliedAlpha: false,
    alpha: true,
    // MSAA on the default framebuffer: smooths piece edges and came ribbons, which are otherwise
    // hard-edged (stencil fills + triangle strips have no anti-aliasing of their own).
    antialias: true,
    // Keep the drawing buffer so the F-043 PNG snapshot can read the render back via drawImage.
    preserveDrawingBuffer: true,
  }) as WebGL2RenderingContext | null
  if (!context) return null
  // Capture the non-null context so the returned closures keep the non-null type (control-flow
  // narrowing does not reach into nested functions — the reference renderer does the same).
  const gl: WebGL2RenderingContext = context

  const glassProgram = buildProgram(gl, VERT, FRAG_GLASS)
  const cameProgram = buildProgram(gl, VERT_CAME, FRAG_CAME)
  if (!glassProgram || !cameProgram) return null

  const g = {
    aScreen: gl.getAttribLocation(glassProgram, 'aScreen'),
    aWorld: gl.getAttribLocation(glassProgram, 'aWorld'),
    uResolution: gl.getUniformLocation(glassProgram, 'uResolution'),
    uColor: gl.getUniformLocation(glassProgram, 'uColor'),
    uTexKind: gl.getUniformLocation(glassProgram, 'uTexKind'),
    uFreq: gl.getUniformLocation(glassProgram, 'uFreq'),
    uAmp: gl.getUniformLocation(glassProgram, 'uAmp'),
    uAniso: gl.getUniformLocation(glassProgram, 'uAniso'),
    uRot: gl.getUniformLocation(glassProgram, 'uRot'),
    uOffset: gl.getUniformLocation(glassProgram, 'uOffset'),
    uScale: gl.getUniformLocation(glassProgram, 'uScale'),
    uSwatch: gl.getUniformLocation(glassProgram, 'uSwatch'),
    uHasSwatch: gl.getUniformLocation(glassProgram, 'uHasSwatch'),
    uBboxMin: gl.getUniformLocation(glassProgram, 'uBboxMin'),
    uBboxSize: gl.getUniformLocation(glassProgram, 'uBboxSize'),
  }
  const c = {
    aScreen: gl.getAttribLocation(cameProgram, 'aScreen'),
    aAcross: gl.getAttribLocation(cameProgram, 'aAcross'),
    aAlong: gl.getAttribLocation(cameProgram, 'aAlong'),
    uResolution: gl.getUniformLocation(cameProgram, 'uResolution'),
    uCame: gl.getUniformLocation(cameProgram, 'uCame'),
    uBead: gl.getUniformLocation(cameProgram, 'uBead'),
  }

  const posBuffer = gl.createBuffer()
  const worldBuffer = gl.createBuffer()
  const cameBuffer = gl.createBuffer()
  const swatches = new Map<string, CachedSwatch>()

  function swatchTexture(key: string, source: TexImageSource): WebGLTexture | null {
    const cached = swatches.get(key)
    if (cached && cached.source === source) return cached.texture
    const texture = cached?.texture ?? gl.createTexture()
    if (!texture) return null
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    swatches.set(key, { texture, source })
    return texture
  }

  return {
    render(viewport, sizeCss, dpr, scene, resolveSwatch) {
      const backingW = Math.max(1, Math.round(sizeCss.width * dpr))
      const backingH = Math.max(1, Math.round(sizeCss.height * dpr))
      if (canvas.width !== backingW) canvas.width = backingW
      if (canvas.height !== backingH) canvas.height = backingH
      gl.viewport(0, 0, backingW, backingH)

      // The surround: a dim wash of the backlight colour, so lit glass reads as glowing in a room.
      const room = daylight(scene.backlight.warmth)
      const dim = 0.08 * scene.backlight.intensity
      gl.clearColor(room.r * dim, room.g * dim, room.b * dim, 1)
      gl.clearStencil(0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.BLEND)

      // --- Glass fills (stencil even-odd) ---------------------------------
      gl.useProgram(glassProgram)
      gl.uniform2f(g.uResolution, sizeCss.width, sizeCss.height)
      gl.enable(gl.STENCIL_TEST)

      for (const piece of scene.pieces) {
        const min = worldToScreen(viewport, piece.bbox.min)
        const max = worldToScreen(viewport, piece.bbox.max)
        const rx = Math.floor(Math.min(min.x, max.x) * dpr) - 1
        const ry = Math.floor(Math.min(min.y, max.y) * dpr) - 1
        const rw = Math.ceil(Math.abs(max.x - min.x) * dpr) + 2
        const rh = Math.ceil(Math.abs(max.y - min.y) * dpr) + 2
        // Scissor + clear stencil to this piece's screen rect (flip y for GL's bottom-left origin).
        gl.enable(gl.SCISSOR_TEST)
        gl.scissor(rx, backingH - (ry + rh), rw, rh)
        gl.clear(gl.STENCIL_BUFFER_BIT)

        // Pass 1: stamp the even-odd interior into the stencil (colour writes off).
        gl.colorMask(false, false, false, false)
        gl.stencilFunc(gl.ALWAYS, 0, 0xff)
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT)
        stampRing(gl, posBuffer, worldBuffer, g.aScreen, g.aWorld, viewport, piece.ring)
        for (const hole of piece.holeRings) {
          stampRing(gl, posBuffer, worldBuffer, g.aScreen, g.aWorld, viewport, hole)
        }

        // Pass 2: shade the bbox quad where stencil is odd (inside the piece).
        gl.colorMask(true, true, true, true)
        gl.stencilFunc(gl.NOTEQUAL, 0, 0xff)
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)

        const glass = hexToRgb(piece.color)
        const t = transmission(piece.transparency)
        const lit = litColor(glass, t, scene.backlight)
        const tex = textureParams(piece.texture)
        const tt = piece.textureTransform
        gl.uniform3f(g.uColor, lit.r, lit.g, lit.b)
        gl.uniform1i(g.uTexKind, tex.kind)
        gl.uniform1f(g.uFreq, tex.frequencyPerMm)
        gl.uniform1f(g.uAmp, tex.amplitude)
        gl.uniform1f(g.uAniso, tex.anisotropy)
        gl.uniform1f(g.uRot, (tt.rotationDeg * Math.PI) / 180)
        gl.uniform2f(g.uOffset, tt.offsetXmm, tt.offsetYmm)
        gl.uniform1f(g.uScale, tt.scale)
        gl.uniform2f(g.uBboxMin, piece.bbox.min.x, piece.bbox.min.y)
        gl.uniform2f(
          g.uBboxSize,
          piece.bbox.max.x - piece.bbox.min.x,
          piece.bbox.max.y - piece.bbox.min.y,
        )

        let hasSwatch = 0
        if (piece.swatchKey) {
          const source = resolveSwatch(piece.swatchKey)
          if (source) {
            const texture = swatchTexture(piece.swatchKey, source)
            if (texture) {
              gl.activeTexture(gl.TEXTURE0)
              gl.bindTexture(gl.TEXTURE_2D, texture)
              gl.uniform1i(g.uSwatch, 0)
              hasSwatch = 1
            }
          }
        }
        gl.uniform1i(g.uHasSwatch, hasSwatch)

        drawQuad(gl, posBuffer, worldBuffer, g.aScreen, g.aWorld, viewport, piece.bbox)
      }
      gl.disable(gl.SCISSOR_TEST)
      gl.disable(gl.STENCIL_TEST)

      // --- Came / solder ribbons -----------------------------------------
      gl.useProgram(cameProgram)
      gl.uniform2f(c.uResolution, sizeCss.width, sizeCss.height)
      const lead = { r: 0.29, g: 0.29, b: 0.28 }
      const border = { r: 0.16, g: 0.16, b: 0.16 }
      const solder = SOLDER_RGB[scene.solderFinish]
      const o = worldToScreen(viewport, { x: 0, y: 0 })
      const ox = worldToScreen(viewport, { x: 1, y: 0 })
      const pxPerMm = Math.hypot(ox.x - o.x, ox.y - o.y) || 1
      for (const came of scene.cames) {
        const strip = ribbon(viewport, came.points, Math.max(1.5, (came.widthMm * pxPerMm) / 2))
        if (!strip) continue
        const col = came.kind === 'foil' ? solder : came.kind === 'border' ? border : lead
        gl.uniform3f(c.uCame, col.r, col.g, col.b)
        gl.uniform1i(c.uBead, came.kind === 'foil' ? 1 : 0)
        gl.bindBuffer(gl.ARRAY_BUFFER, cameBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, strip.data, gl.DYNAMIC_DRAW)
        const stride = 4 * 4
        gl.enableVertexAttribArray(c.aScreen)
        gl.vertexAttribPointer(c.aScreen, 2, gl.FLOAT, false, stride, 0)
        gl.enableVertexAttribArray(c.aAcross)
        gl.vertexAttribPointer(c.aAcross, 1, gl.FLOAT, false, stride, 8)
        gl.enableVertexAttribArray(c.aAlong)
        gl.vertexAttribPointer(c.aAlong, 1, gl.FLOAT, false, stride, 12)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, strip.count)
      }
    },
    dispose() {
      for (const { texture } of swatches.values()) gl.deleteTexture(texture)
      swatches.clear()
      gl.deleteBuffer(posBuffer)
      gl.deleteBuffer(worldBuffer)
      gl.deleteBuffer(cameBuffer)
      gl.deleteProgram(glassProgram)
      gl.deleteProgram(cameProgram)
    },
  }
}

const SOLDER_RGB: Record<SolderFinish, { r: number; g: number; b: number }> = {
  silver: { r: 0.55, g: 0.56, b: 0.58 },
  copper: { r: 0.62, g: 0.38, b: 0.2 },
  black: { r: 0.09, g: 0.09, b: 0.1 },
}

const VERT_CAME = `#version 300 es
in vec2 aScreen;
in float aAcross;
in float aAlong;
uniform vec2 uResolution;
out float vAcross;
out float vAlong;
void main() {
  vAcross = aAcross;
  vAlong = aAlong;
  vec2 clip = (aScreen / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`

/** Stamp one ring into the stencil as a triangle fan (screen space). */
function stampRing(
  gl: WebGL2RenderingContext,
  posBuffer: WebGLBuffer | null,
  worldBuffer: WebGLBuffer | null,
  aScreen: number,
  aWorld: number,
  viewport: Viewport,
  ring: readonly Vec2[],
): void {
  if (ring.length < 3) return
  const screen = new Float32Array(ring.length * 2)
  const world = new Float32Array(ring.length * 2)
  ring.forEach((p, i) => {
    const s = worldToScreen(viewport, p)
    screen[i * 2] = s.x
    screen[i * 2 + 1] = s.y
    world[i * 2] = p.x
    world[i * 2 + 1] = p.y
  })
  bindAttrib(gl, posBuffer, aScreen, screen, 2)
  bindAttrib(gl, worldBuffer, aWorld, world, 2)
  gl.drawArrays(gl.TRIANGLE_FAN, 0, ring.length)
}

/** Draw a piece's bounding quad (two triangles) with world coords for the fragment shader. */
function drawQuad(
  gl: WebGL2RenderingContext,
  posBuffer: WebGLBuffer | null,
  worldBuffer: WebGLBuffer | null,
  aScreen: number,
  aWorld: number,
  viewport: Viewport,
  bbox: BBox,
): void {
  const corners: Vec2[] = [
    { x: bbox.min.x, y: bbox.min.y },
    { x: bbox.max.x, y: bbox.min.y },
    { x: bbox.max.x, y: bbox.max.y },
    { x: bbox.min.x, y: bbox.max.y },
  ]
  const order = [0, 1, 2, 0, 2, 3]
  const screen = new Float32Array(order.length * 2)
  const world = new Float32Array(order.length * 2)
  order.forEach((ci, i) => {
    const p = corners[ci]!
    const s = worldToScreen(viewport, p)
    screen[i * 2] = s.x
    screen[i * 2 + 1] = s.y
    world[i * 2] = p.x
    world[i * 2 + 1] = p.y
  })
  bindAttrib(gl, posBuffer, aScreen, screen, 2)
  bindAttrib(gl, worldBuffer, aWorld, world, 2)
  gl.drawArrays(gl.TRIANGLES, 0, order.length)
}

function bindAttrib(
  gl: WebGL2RenderingContext,
  buffer: WebGLBuffer | null,
  loc: number,
  data: Float32Array,
  size: number,
): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0)
}

/**
 * Build a triangle-strip ribbon for a polyline: two vertices per point offset ±`halfPx` along the
 * average normal, carrying `aAcross` (±1 across the width, for the rounded specular profile) and
 * `aAlong` (arc length in px, for the foil bead). Interleaved [x, y, across, along].
 */
function ribbon(
  viewport: Viewport,
  points: readonly Vec2[],
  halfPx: number,
): { data: Float32Array; count: number } | null {
  if (points.length < 2) return null
  const screen = points.map((p) => worldToScreen(viewport, p))
  const n = screen.length
  const data = new Float32Array(n * 2 * 4)
  let along = 0
  for (let i = 0; i < n; i++) {
    const prev = screen[Math.max(0, i - 1)]!
    const next = screen[Math.min(n - 1, i + 1)]!
    if (i > 0) along += Math.hypot(screen[i]!.x - prev.x, screen[i]!.y - prev.y)
    let dx = next.x - prev.x
    let dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    // Normal is the perpendicular of the tangent.
    const nx = -dy
    const ny = dx
    const cur = screen[i]!
    const beadPhase = along * 0.25
    // upper vertex (across = +1)
    data[i * 8] = cur.x + nx * halfPx
    data[i * 8 + 1] = cur.y + ny * halfPx
    data[i * 8 + 2] = 1
    data[i * 8 + 3] = beadPhase
    // lower vertex (across = -1)
    data[i * 8 + 4] = cur.x - nx * halfPx
    data[i * 8 + 5] = cur.y - ny * halfPx
    data[i * 8 + 6] = -1
    data[i * 8 + 7] = beadPhase
  }
  return { data, count: n * 2 }
}

function buildProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc)
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc)
  if (!vs || !fs) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  return program
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}
