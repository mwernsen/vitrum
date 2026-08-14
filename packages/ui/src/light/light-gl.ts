import {
  hexToRgb,
  textureParams,
  transmission,
  worldToScreen,
  type ResolvedSun,
  type Rgb,
  type Viewport,
} from '@vitrum/core'
import { clamp01, type BBox, type Vec2 } from '@vitrum/geometry'

import type { CameRibbonInput, GlassPieceInput } from '../render/glass-gl'

/**
 * The WebGL2 sunlight renderer (F-054) — the dark-stage volumetric look that is Diafane's showpiece.
 * Same factory discipline as the F-053 glass renderer and the F-051 reference underlay
 * (`createLightRenderer` returns `null` when WebGL2 is unavailable, e.g. jsdom, so callers no-op),
 * and the same stencil even-odd glass fills (no triangulator; holes fall out for free).
 *
 * **Two passes.** Pass 1 renders the sun-lit glass into an offscreen framebuffer: each piece's base
 * colour is the glass tinted by the sun colour, scaled by transmission and the panel front factor
 * (grazing / behind → dark), so lighter and more transparent pieces glow brightest. The lead/solder
 * lattice is stamped **black** over it (occluders). Pass 2 is a full-screen light-scattering pass: it
 * marches samples from every fragment toward the sun's screen position through that emission buffer,
 * accumulating volumetric god-rays broken up by the lead lines, adds a solar halo that bleeds through
 * the bright glass, tone-maps, and (optionally) adds photo grain. `preserveDrawingBuffer` keeps the
 * result readable for the F-043 PNG snapshot (photo capture, FR-6).
 *
 * The per-piece lit base colour is computed on the CPU (`sunLit`), mirroring the F-053 discipline of
 * keeping the reference maths off the GPU; the fragment shader only adds procedural texture.
 */

/** The full sunlight scene for one frame. */
export interface LightScene {
  readonly pieces: readonly GlassPieceInput[]
  readonly cames: readonly CameRibbonInput[]
  readonly sun: ResolvedSun
  /** Sun position in normalised canvas coords (x: 0 left…1 right, y: 0 top…1 bottom). */
  readonly sunScreen: { readonly x: number; readonly y: number }
  /** Whether glass surface textures show (Diafane "Textures" toggle). */
  readonly showTextures: boolean
  /** Whether the photo-grain overlay is on (Diafane toggle). */
  readonly photoGrain: boolean
}

export interface LightRenderer {
  render(
    viewport: Viewport,
    sizeCss: { width: number; height: number },
    dpr: number,
    scene: LightScene,
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

// Emission pass: the CPU passes the sun-lit base colour in uColor; here we only add the per-tag
// procedural surface texture (mirrors the F-053 glass shader's noise, minus swatch photos).
const FRAG_EMIT = `#version 300 es
precision highp float;
in vec2 vWorld;
uniform vec3 uColor;
uniform int uTexKind;
uniform float uFreq;
uniform float uAmp;
uniform float uAniso;
// Coverage marker written to alpha, so the scatter pass knows what it is shading: 1 = glass,
// 0.5 = came/solder, 0 = empty air (the cleared void). Without this the scatter pass cannot tell
// the panel from the air around it, and its haze fills in the lead lattice.
uniform float uMask;
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

// sRGB → linear: the CPU passes the lit base in sRGB-ish space; decode so the emission buffer and
// the scatter accumulation are in linear light (gamma-correct compositing).
vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

void main() {
  vec2 fq = vWorld * uFreq;
  float m = 1.0;
  if (uTexKind == 1) { m = 1.0 + uAmp * (2.0 * vnoise(fq) - 1.0); }
  else if (uTexKind == 2) { m = 1.0 - uAmp * smoothstep(0.72, 0.9, vnoise(fq)); }
  else if (uTexKind == 3) { m = 1.0 + uAmp * (2.0 * vnoise(vec2(fq.x / uAniso, fq.y)) - 1.0); }
  else if (uTexKind == 4) { m = 1.0 + uAmp * sin(vWorld.y * uFreq * 6.2831853 / uAniso) * (0.6 + 0.4 * vnoise(fq)); }
  else if (uTexKind == 5) { m = 1.0 + uAmp * (2.0 * (vnoise(fq) * 0.6 + vnoise(fq * 2.7) * 0.4) - 1.0); }
  frag = vec4(toLinear(uColor) * m, uMask);
}`

// Full-screen light-scattering + composite pass.
const VERT_FS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG_RAYS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uEmission;
uniform vec2 uSun;            // sun position in vUv space (y-up)
uniform float uRayStrength;   // halo intensity 0..1
uniform float uConcentration; // 0..1 (tighter rays / halo)
uniform float uHaloBoost;     // halo brightness gate (0 at night / behind)
uniform vec3 uSunColor;
uniform int uGrain;
out vec4 frag;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// sRGB → linear, matching the emission pass — the halo/sun colour arrives in sRGB-ish space.
vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

const int SAMPLES = 64;
void main() {
  // The emission buffer is already in linear light (see the emission pass).
  vec4 em = texture(uEmission, vUv);
  vec3 base = em.rgb;

  // What are we standing on? The emission pass wrote a coverage marker into alpha.
  // Scattered light belongs in the *air*; over the panel it must not wash out the subject, and
  // over the lead it must stay out entirely or the lattice — the thing that makes a panel read as
  // stained glass — dissolves into haze.
  float onGlass = smoothstep(0.75, 0.95, em.a);
  float covered = smoothstep(0.25, 0.45, em.a);
  float onCame = (1.0 - onGlass) * covered;
  float inAir = 1.0 - covered;

  // March toward the sun, accumulating emission with distance decay → volumetric rays. Jitter the
  // start per-fragment so the step aliasing reads as fine noise, not concentric rings.
  float density = mix(0.75, 1.05, uConcentration);
  float decay = mix(0.965, 0.905, uConcentration);
  vec2 delta = (uSun - vUv) / float(SAMPLES) * density;
  vec2 uv = vUv + delta * hash(vUv * 1023.7);
  float illum = 1.0;
  vec3 scatter = vec3(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    uv += delta;
    scatter += texture(uEmission, clamp(uv, 0.0, 1.0)).rgb * illum;
    illum *= decay;
  }
  scatter /= float(SAMPLES);

  // Solar halo: a bright core plus a soft bloom. The bloom term is kept narrow — a wide one reads
  // as a panel-sized smudge rather than a sun.
  float d = distance(vUv, uSun);
  float tight = mix(26.0, 90.0, uConcentration);
  float halo = exp(-d * d * tight) + 0.28 * exp(-d * d * tight * 0.35);

  // Rays are light in the air: full strength in the void, a fraction over the glass, almost none
  // over the lead.
  float rayWeight = inAir + onGlass * 0.18 + onCame * 0.04;

  // The halo may still bleed through the *lighter* pieces (the F-054 look), so gate its glass
  // contribution on how luminous the glass already is — bright, transparent glass glows, dark and
  // opaque glass stays dense.
  float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
  float bleed = smoothstep(0.15, 0.75, lum);
  float haloWeight = inAir + onGlass * mix(0.10, 0.65, bleed) + onCame * 0.02;

  vec3 col = base
    + scatter * uRayStrength * 2.6 * rayWeight
    + toLinear(uSunColor) * halo * uHaloBoost * haloWeight;

  // Filmic-ish tone map in linear, then encode to sRGB for display (gamma-correct output).
  col = vec3(1.0) - exp(-col * 1.35);
  col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));

  if (uGrain == 1) {
    float g = hash(vUv * 1024.0) - 0.5;
    col += g * 0.045;
  }
  frag = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

/** Create the sunlight renderer for `canvas`, or `null` if WebGL2 is unavailable (e.g. jsdom). */
export function createLightRenderer(canvas: HTMLCanvasElement): LightRenderer | null {
  const context = canvas.getContext('webgl2', {
    stencil: true,
    premultipliedAlpha: false,
    alpha: true,
    preserveDrawingBuffer: true,
  }) as WebGL2RenderingContext | null
  if (!context) return null
  const gl: WebGL2RenderingContext = context

  // A half-float (RGBA16F) emission target lets the god-ray march accumulate in linear HDR — an
  // 8-bit target quantises the accumulation into the concentric-ring banding. Fall back to 8-bit
  // where the extension is unavailable (older GPUs / headless).
  const floatColor = !!gl.getExtension('EXT_color_buffer_float')

  const emitProgram = buildProgram(gl, VERT, FRAG_EMIT)
  const rayProgram = buildProgram(gl, VERT_FS, FRAG_RAYS)
  if (!emitProgram || !rayProgram) return null

  const e = {
    aScreen: gl.getAttribLocation(emitProgram, 'aScreen'),
    aWorld: gl.getAttribLocation(emitProgram, 'aWorld'),
    uResolution: gl.getUniformLocation(emitProgram, 'uResolution'),
    uColor: gl.getUniformLocation(emitProgram, 'uColor'),
    uTexKind: gl.getUniformLocation(emitProgram, 'uTexKind'),
    uFreq: gl.getUniformLocation(emitProgram, 'uFreq'),
    uAmp: gl.getUniformLocation(emitProgram, 'uAmp'),
    uAniso: gl.getUniformLocation(emitProgram, 'uAniso'),
    uMask: gl.getUniformLocation(emitProgram, 'uMask'),
  }
  const r = {
    aPos: gl.getAttribLocation(rayProgram, 'aPos'),
    uEmission: gl.getUniformLocation(rayProgram, 'uEmission'),
    uSun: gl.getUniformLocation(rayProgram, 'uSun'),
    uRayStrength: gl.getUniformLocation(rayProgram, 'uRayStrength'),
    uConcentration: gl.getUniformLocation(rayProgram, 'uConcentration'),
    uHaloBoost: gl.getUniformLocation(rayProgram, 'uHaloBoost'),
    uSunColor: gl.getUniformLocation(rayProgram, 'uSunColor'),
    uGrain: gl.getUniformLocation(rayProgram, 'uGrain'),
  }

  const posBuffer = gl.createBuffer()
  const worldBuffer = gl.createBuffer()
  const cameBuffer = gl.createBuffer()
  const quadBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

  // Offscreen emission target, sized to the backing store (recreated on resize).
  let fbo: WebGLFramebuffer | null = null
  let emissionTex: WebGLTexture | null = null
  let depthStencil: WebGLRenderbuffer | null = null
  let fboW = 0
  let fboH = 0

  function ensureFbo(w: number, h: number): boolean {
    if (fbo && w === fboW && h === fboH) return true
    if (!fbo) fbo = gl.createFramebuffer()
    if (!emissionTex) emissionTex = gl.createTexture()
    if (!depthStencil) depthStencil = gl.createRenderbuffer()
    if (!fbo || !emissionTex || !depthStencil) return false
    gl.bindTexture(gl.TEXTURE_2D, emissionTex)
    if (floatColor) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthStencil)
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, w, h)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, emissionTex, 0)
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_STENCIL_ATTACHMENT,
      gl.RENDERBUFFER,
      depthStencil,
    )
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    fboW = w
    fboH = h
    return ok
  }

  return {
    render(viewport, sizeCss, dpr, scene) {
      const backingW = Math.max(1, Math.round(sizeCss.width * dpr))
      const backingH = Math.max(1, Math.round(sizeCss.height * dpr))
      if (canvas.width !== backingW) canvas.width = backingW
      if (canvas.height !== backingH) canvas.height = backingH

      const sun = scene.sun

      // --- Pass 1: sun-lit glass + black lead lattice → emission FBO ------
      const haveFbo = ensureFbo(backingW, backingH)
      gl.bindFramebuffer(gl.FRAMEBUFFER, haveFbo ? fbo : null)
      gl.viewport(0, 0, backingW, backingH)
      // Near-black void, in linear light. Alpha 0 marks "empty air" for the scatter pass's coverage
      // test — this is where god-rays are allowed to be at full strength.
      gl.clearColor(0.0009, 0.001, 0.0014, 0)
      gl.clearStencil(0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.BLEND)

      gl.useProgram(emitProgram)
      gl.uniform2f(e.uResolution, sizeCss.width, sizeCss.height)
      gl.enable(gl.STENCIL_TEST)

      for (const piece of scene.pieces) {
        const min = worldToScreen(viewport, piece.bbox.min)
        const max = worldToScreen(viewport, piece.bbox.max)
        const rx = Math.floor(Math.min(min.x, max.x) * dpr) - 1
        const ry = Math.floor(Math.min(min.y, max.y) * dpr) - 1
        const rw = Math.ceil(Math.abs(max.x - min.x) * dpr) + 2
        const rh = Math.ceil(Math.abs(max.y - min.y) * dpr) + 2
        gl.enable(gl.SCISSOR_TEST)
        gl.scissor(rx, backingH - (ry + rh), rw, rh)
        gl.clear(gl.STENCIL_BUFFER_BIT)

        gl.colorMask(false, false, false, false)
        gl.stencilFunc(gl.ALWAYS, 0, 0xff)
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT)
        stampRing(gl, posBuffer, worldBuffer, e.aScreen, e.aWorld, viewport, piece.ring)
        for (const hole of piece.holeRings) {
          stampRing(gl, posBuffer, worldBuffer, e.aScreen, e.aWorld, viewport, hole)
        }

        gl.colorMask(true, true, true, true)
        gl.stencilFunc(gl.NOTEQUAL, 0, 0xff)
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)

        const lit = sunLit(hexToRgb(piece.color), transmission(piece.transparency), sun)
        const tex = scene.showTextures
          ? textureParams(piece.texture)
          : { kind: 0, frequencyPerMm: 0, amplitude: 0, anisotropy: 1 }
        gl.uniform3f(e.uColor, lit.r, lit.g, lit.b)
        gl.uniform1i(e.uTexKind, tex.kind)
        gl.uniform1f(e.uFreq, tex.frequencyPerMm)
        gl.uniform1f(e.uAmp, tex.amplitude)
        gl.uniform1f(e.uAniso, tex.anisotropy)
        gl.uniform1f(e.uMask, 1)
        drawQuad(gl, posBuffer, worldBuffer, e.aScreen, e.aWorld, viewport, piece.bbox)
      }
      gl.disable(gl.SCISSOR_TEST)
      gl.disable(gl.STENCIL_TEST)

      // Lead / solder as black occluders, so the rays are broken into the leaded lattice.
      const o = worldToScreen(viewport, { x: 0, y: 0 })
      const ox = worldToScreen(viewport, { x: 1, y: 0 })
      const pxPerMm = Math.hypot(ox.x - o.x, ox.y - o.y) || 1
      gl.useProgram(emitProgram)
      gl.uniform3f(e.uColor, 0, 0, 0)
      gl.uniform1i(e.uTexKind, 0)
      gl.uniform1f(e.uAmp, 0)
      // 0.5 marks the lattice: black in the emission buffer so it occludes the rays, and flagged so
      // the scatter pass keeps it crisp instead of hazing over it.
      gl.uniform1f(e.uMask, 0.5)
      for (const came of scene.cames) {
        const strip = ribbon(viewport, came.points, Math.max(1.2, (came.widthMm * pxPerMm) / 2))
        if (!strip) continue
        gl.bindBuffer(gl.ARRAY_BUFFER, cameBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, strip.data, gl.DYNAMIC_DRAW)
        gl.enableVertexAttribArray(e.aScreen)
        gl.vertexAttribPointer(e.aScreen, 2, gl.FLOAT, false, 16, 0)
        // Feed world coords too (unused by the black fill, but the attribute must be bound).
        gl.enableVertexAttribArray(e.aWorld)
        gl.vertexAttribPointer(e.aWorld, 2, gl.FLOAT, false, 16, 0)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, strip.count)
      }

      // --- Pass 2: scatter + composite to the visible canvas -------------
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, backingW, backingH)
      gl.clearColor(0.015, 0.017, 0.022, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(rayProgram)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, emissionTex)
      gl.uniform1i(r.uEmission, 0)
      // vUv is y-up; the incoming sunScreen is y-down normalised.
      gl.uniform2f(r.uSun, scene.sunScreen.x, 1 - scene.sunScreen.y)
      gl.uniform1f(r.uRayStrength, sun.haloIntensity)
      gl.uniform1f(r.uConcentration, sun.haloConcentration)
      const haloGate = sun.aboveHorizon ? sun.haloIntensity * sun.intensity * sun.frontFactor : 0
      gl.uniform1f(r.uHaloBoost, haloGate)
      gl.uniform3f(r.uSunColor, sun.color.r, sun.color.g, sun.color.b)
      gl.uniform1i(r.uGrain, scene.photoGrain ? 1 : 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
      gl.enableVertexAttribArray(r.aPos)
      gl.vertexAttribPointer(r.aPos, 2, gl.FLOAT, false, 0, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose() {
      gl.deleteBuffer(posBuffer)
      gl.deleteBuffer(worldBuffer)
      gl.deleteBuffer(cameBuffer)
      gl.deleteBuffer(quadBuffer)
      if (fbo) gl.deleteFramebuffer(fbo)
      if (emissionTex) gl.deleteTexture(emissionTex)
      if (depthStencil) gl.deleteRenderbuffer(depthStencil)
      gl.deleteProgram(emitProgram)
      gl.deleteProgram(rayProgram)
    },
  }
}

/**
 * The sun-lit base colour of a glass piece: its colour tinted by the sun, scaled by transmission and
 * the panel front factor (grazing / behind → dark), plus a faint bloom of the sun colour through
 * transparent glass. Computed on the CPU so the GPU never re-derives the reference maths (F-053
 * discipline). Below the horizon the sun intensity is already 0, so the piece renders near-black.
 */
function sunLit(glass: Rgb, t: number, sun: ResolvedSun): Rgb {
  const front = 0.25 + 0.75 * sun.frontFactor
  const gain = sun.intensity * front * (0.4 + 0.6 * t)
  const bloom = t * 0.12 * sun.intensity * sun.frontFactor
  return {
    r: clamp01(glass.r * sun.color.r * gain + sun.color.r * bloom),
    g: clamp01(glass.g * sun.color.g * gain + sun.color.g * bloom),
    b: clamp01(glass.b * sun.color.b * gain + sun.color.b * bloom),
  }
}

// --- Low-level GL plumbing (kept local so the light renderer stands alone) ---

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

/** Interleaved [x, y, across, along] triangle-strip ribbon for a polyline (as in the glass renderer). */
function ribbon(
  viewport: Viewport,
  points: readonly Vec2[],
  halfPx: number,
): { data: Float32Array; count: number } | null {
  if (points.length < 2) return null
  const screen = points.map((p) => worldToScreen(viewport, p))
  const n = screen.length
  const data = new Float32Array(n * 2 * 4)
  for (let i = 0; i < n; i++) {
    const prev = screen[Math.max(0, i - 1)]!
    const next = screen[Math.min(n - 1, i + 1)]!
    let dx = next.x - prev.x
    let dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    const nx = -dy
    const ny = dx
    const cur = screen[i]!
    data[i * 8] = cur.x + nx * halfPx
    data[i * 8 + 1] = cur.y + ny * halfPx
    data[i * 8 + 2] = 1
    data[i * 8 + 3] = 0
    data[i * 8 + 4] = cur.x - nx * halfPx
    data[i * 8 + 5] = cur.y - ny * halfPx
    data[i * 8 + 6] = -1
    data[i * 8 + 7] = 0
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
