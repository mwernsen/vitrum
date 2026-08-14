import {
  daylight,
  hexToRgb,
  litColor,
  surfaceParams,
  textureParams,
  transmission,
  worldToScreen,
  type Backlight,
  type Viewport,
} from '@vitrum/core'
import type { BBox, Vec2 } from '@vitrum/geometry'

import type { CameJoint } from './joints'

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
  /** Sheet thickness in mm, driving the Beer–Lambert optical path (F-064 thrust A). */
  readonly thicknessMm: number
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
  /** Soldered intersections, from `cameJoints()` — derived at scene build, not per frame. */
  readonly joints: readonly CameJoint[]
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
// F-064 thrust A — the surface material. uGlass is the raw sheet colour (uColor is litColor, the CPU
// reference); the rest describe the surface as a physical thing rather than as a pattern.
uniform vec3 uGlass;
uniform vec3 uLight;
uniform float uRelief;
uniform float uStep;
uniform float uGloss;
uniform float uHueDrift;
uniform float uThickness;
uniform float uSwatchTileMm;
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

// Three octaves of value noise. One octave alone shows its integer lattice as soft squares as soon
// as the amplitude is strong enough to see (F-064), which is not what rolled glass looks like.
float fbm(vec2 p) {
  float n = vnoise(p) * 0.5;
  n += vnoise(p * 2.03 + vec2(5.2, 1.3)) * 0.28;
  n += vnoise(p * 4.11 + vec2(9.7, 7.1)) * 0.14;
  return n / 0.92;
}
// Domain warp: displace the sample point by a low-frequency noise vector, which bends the lattice
// into organic blotches instead of axis-aligned cells.
vec2 warp(vec2 p) {
  float wx = vnoise(p * 0.5 + vec2(1.7, 8.3)) - 0.5;
  float wy = vnoise(p * 0.5 + vec2(4.9, 2.1)) - 0.5;
  return p + vec2(wx, wy) * 1.6;
}
// The glass-grain field every texture tag is built from.
float gnoise(vec2 p) { return fbm(warp(p)); }

// The surface height at a point in texture space (world mm), 0..1 — the mirror of @vitrum/core's
// heightField. Each tag is a shape of *surface*: the same field drives the relief normal, the optical
// path length and the brightness, so they cannot disagree with each other.
float heightAt(vec2 q, float freq) {
  vec2 fq = q * freq;
  if (uTexKind == 1) {
    // hammered: ridged noise gives rounded hollows rather than hills
    return 1.0 - abs(2.0 * gnoise(fq) - 1.0);
  } else if (uTexKind == 2) {
    // seedy: bubbles sit proud in sparse round patches
    return smoothstep(0.72, 0.92, gnoise(fq));
  } else if (uTexKind == 3) {
    return gnoise(vec2(fq.x / uAniso, fq.y));
  } else if (uTexKind == 4) {
    return 0.5 + 0.5 * sin(q.y * freq * 6.2831853 / uAniso) * (0.6 + 0.4 * gnoise(fq));
  } else if (uTexKind == 5) {
    return gnoise(fq) * 0.6 + gnoise(fq * 2.7) * 0.4;
  }
  // smooth: a faint long roll, so even "flat" glass is not a dead plane
  return gnoise(fq);
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
    float n = gnoise(fq);
    m = 1.0 + uAmp * (2.0 * n - 1.0);
  } else if (uTexKind == 2) {
    // seedy: sparse dark bubbles
    float n = gnoise(fq);
    float bubble = smoothstep(0.72, 0.9, n);
    m = 1.0 - uAmp * bubble;
  } else if (uTexKind == 3) {
    // streaky: anisotropic streaks (stretched along one axis)
    float n = gnoise(vec2(fq.x / uAniso, fq.y));
    m = 1.0 + uAmp * (2.0 * n - 1.0);
  } else if (uTexKind == 4) {
    // ripple: directional waves plus a little noise
    float wave = sin(q.y * uFreq * 6.2831853 / uAniso);
    m = 1.0 + uAmp * wave * (0.6 + 0.4 * gnoise(fq));
  } else if (uTexKind == 5) {
    // granite: fine high-frequency grain
    float n = gnoise(fq) * 0.6 + gnoise(fq * 2.7) * 0.4;
    m = 1.0 + uAmp * (2.0 * n - 1.0);
  }

  vec3 base = toLinear(uColor);
  vec3 col = base * m;

  // --- The surface as a material (F-064 thrust A) ---------------------------
  // Normal by forward differences on the height field: three evaluations, not five, because the
  // field is multi-octave noise and this runs per fragment (FR-6).
  float hfreq = uFreq > 0.0 ? uFreq : 0.04;
  float st = max(uStep, 0.0001);
  float h0 = heightAt(q, hfreq);
  float hx = heightAt(q + vec2(st, 0.0), hfreq);
  float hy = heightAt(q + vec2(0.0, st), hfreq);
  vec3 n = normalize(vec3(-(hx - h0) * uRelief / st, -(hy - h0) * uRelief / st, 1.0));

  // Beer–Lambert: a tilted surface lengthens the optical path, so relief shows up as varying colour
  // *depth* rather than as varying brightness — the thing that makes glass read as a slab. Relative
  // to the reference thickness, so a flat 3 mm sheet reproduces litColor exactly.
  float ratio = (max(uThickness, 0.1) / 3.0) / max(n.z, 0.25);
  col *= pow(max(toLinear(uGlass), vec3(0.004)), vec3(ratio - 1.0));

  // Hue drift: real cathedral and streaky glass streaks *different colours* together, so warm and
  // cool are pushed in opposite directions rather than the whole piece just dimming.
  float d = gnoise(q * 0.035) - 0.5;
  col *= vec3(1.0 + d * uHueDrift, 1.0 + d * uHueDrift * 0.15, 1.0 - d * uHueDrift);

  if (uHasSwatch == 1) {
    // Physical tiling: the photo is a sheet of glass at a real size, so it repeats in world mm
    // (F-053 follow-up) instead of being stretched to each piece's bbox.
    vec2 uv = q / max(uSwatchTileMm, 1.0);
    vec3 tex = toLinear(texture(uSwatch, uv).rgb);
    float luma = dot(tex, vec3(0.299, 0.587, 0.114));
    // Modulate the assigned base colour by the photo's luminance (keeps the glass's hue).
    col = mix(col, base * (0.55 + 0.9 * luma), 0.6);
  }

  // Front-surface Fresnel sheen. Head-on the glass reflects ~4%; where relief tilts it away,
  // reflectance climbs steeply, putting glints along dimple edges and ripple crests. This is the
  // strongest single cue that a surface is glass and not backlit paper.
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(n.z, 0.0, 1.0), 5.0);
  col += toLinear(uLight) * fres * uGloss * 0.22;

  // Linear HDR out; the composite pass adds bloom and tone-maps.
  frag = vec4(col, 1.0);
}`

// Came / solder ribbon shader (F-064 thrust B), tuned against Mathieu's reference photo of a real
// leaded panel. What that photo shows: came is a near-black *silhouette* against lit glass, matte
// with no chrome ridge, its width visibly wobbles along the run, and the metal is mottled with
// oxidation. Colours arrive in display space and are written out directly (unlike the glass, which
// tone-maps), so the authored near-blacks land exactly as intended.
const FRAG_CAME = `#version 300 es
precision highp float;
in float vAcross;
in float vAlong;
uniform vec3 uCame;
uniform int uBead;
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
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  float a = clamp(vAcross, -1.0, 1.0);
  float aa = abs(a);

  // Hand-leaded came is not a machined extrusion: wobble the half-width slowly along the run, and
  // fade the last sliver so the edge anti-aliases into the glass instead of stair-stepping.
  float wobble = vnoise(vec2(vAlong * 0.04, 0.0));
  float halfW = 1.0 - 0.09 * wobble;
  float edge = 1.0 - smoothstep(halfW - 0.12, halfW, aa);
  if (edge <= 0.001) discard;

  // A shallow crown. The range stays narrow and dark — the photo shows almost no tonal variation
  // across a lead line, which is exactly what a previous "rounded profile" got wrong.
  float crown = 1.0 - 0.30 * a * a;
  // Oxidation: low-frequency mottling along the run and across the crown.
  float patina = 0.86 + 0.14 * vnoise(vec2(vAlong * 0.3, a * 1.7));

  // Solder is slightly glossier than lead; both stay matte.
  float specAmt = uBead == 1 ? 0.16 : 0.055;
  float spec = exp(-a * a * 20.0) * specAmt;
  float bead = uBead == 1 ? (0.92 + 0.08 * sin(vAlong * 0.8)) : 1.0;

  vec3 col = uCame * crown * patina * bead + vec3(spec);
  // Authored in display space, written to the linear scene buffer.
  frag = vec4(pow(clamp(col, 0.0, 1.0), vec3(2.2)), edge);
}`

// Solder-joint blob shader: a lumpy dome at each node, so intersections read as soldered rather
// than as two ribbons crossing. The radius is perturbed by angle — a hand-made joint is never a disc.
const VERT_JOINT = `#version 300 es
in vec2 aScreen;
in vec2 aLocal;
uniform vec2 uResolution;
out vec2 vLocal;
void main() {
  vLocal = aLocal;
  vec2 clip = (aScreen / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`

const FRAG_JOINT = `#version 300 es
precision highp float;
in vec2 vLocal;
uniform vec3 uCame;
uniform float uSeed;
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
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  float r = length(vLocal);
  float ang = atan(vLocal.y, vLocal.x);
  // Lumpy outline: radius varies with angle, seeded per joint so no two look alike.
  float lump = 0.80 + 0.20 * vnoise(vec2(cos(ang), sin(ang)) * 1.9 + uSeed);
  float edge = 1.0 - smoothstep(lump - 0.18, lump, r);
  if (edge <= 0.001) discard;

  // A dome, so the blob reads as raised solder catching a little light.
  float nr = r / max(lump, 0.001);
  float dome = sqrt(max(0.0, 1.0 - nr * nr));
  float patina = 0.88 + 0.12 * vnoise(vLocal * 3.1 + uSeed);
  float spec = pow(dome, 6.0) * 0.14;

  vec3 col = uCame * (0.82 + 0.30 * dome) * patina + vec3(spec);
  frag = vec4(pow(clamp(col, 0.0, 1.0), vec3(2.2)), edge);
}`

// Full-screen passes (F-064 thrust D): a graded surround behind the panel, and a composite that adds
// bloom and tone-maps. Both use a single oversized triangle rather than a quad.
const VERT_FS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

// The surround. A flat near-black wash made a panel look like it was floating in a void; a soft
// luminous field centred on the panel reads as a lit room behind glass.
const FRAG_SURROUND = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uWash;
uniform vec2 uCentre;
uniform float uSpread;
uniform float uStrength;
out vec4 frag;
void main() {
  float d = distance(vUv, uCentre) / max(uSpread, 0.001);
  float g = exp(-d * d * 1.1);
  frag = vec4(pow(max(uWash, vec3(0.0)), vec3(2.2)) * uStrength * (0.06 + 0.94 * g), 1.0);
}`

// Composite: bloom, then the filmic tone map, then sRGB encode. Bloom has to be a screen-space pass —
// it is the one effect that cannot be computed from a single fragment.
const FRAG_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uTexel;
uniform float uBloom;
out vec4 frag;
void main() {
  vec3 base = texture(uScene, vUv).rgb;

  // Ring taps at two radii, keeping only what is above the highlight threshold, so bright glass
  // blooms into its surroundings and dark lead does not.
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988;
    vec2 dir = vec2(cos(a), sin(a));
    glow += max(texture(uScene, vUv + dir * uTexel * 7.0).rgb - 0.72, vec3(0.0));
    glow += max(texture(uScene, vUv + dir * uTexel * 16.0).rgb - 0.72, vec3(0.0));
  }
  glow /= 24.0;

  vec3 col = base + glow * uBloom;
  col = vec3(1.0) - exp(-col * 1.45);
  frag = vec4(pow(max(col, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
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
  const jointProgram = buildProgram(gl, VERT_JOINT, FRAG_JOINT)
  const surroundProgram = buildProgram(gl, VERT_FS, FRAG_SURROUND)
  const compositeProgram = buildProgram(gl, VERT_FS, FRAG_COMPOSITE)
  if (!glassProgram || !cameProgram || !jointProgram || !surroundProgram || !compositeProgram) {
    return null
  }
  // A half-float scene target keeps the whole composite in linear HDR, so bloom and the tone map
  // behave; 8-bit would band. Fall back where the extension is missing (older GPUs, headless).
  const floatColor = !!gl.getExtension('EXT_color_buffer_float')

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
    uGlass: gl.getUniformLocation(glassProgram, 'uGlass'),
    uLight: gl.getUniformLocation(glassProgram, 'uLight'),
    uRelief: gl.getUniformLocation(glassProgram, 'uRelief'),
    uStep: gl.getUniformLocation(glassProgram, 'uStep'),
    uGloss: gl.getUniformLocation(glassProgram, 'uGloss'),
    uHueDrift: gl.getUniformLocation(glassProgram, 'uHueDrift'),
    uThickness: gl.getUniformLocation(glassProgram, 'uThickness'),
    uSwatchTileMm: gl.getUniformLocation(glassProgram, 'uSwatchTileMm'),
  }
  const sr = {
    aPos: gl.getAttribLocation(surroundProgram, 'aPos'),
    uWash: gl.getUniformLocation(surroundProgram, 'uWash'),
    uCentre: gl.getUniformLocation(surroundProgram, 'uCentre'),
    uSpread: gl.getUniformLocation(surroundProgram, 'uSpread'),
    uStrength: gl.getUniformLocation(surroundProgram, 'uStrength'),
  }
  const cp = {
    aPos: gl.getAttribLocation(compositeProgram, 'aPos'),
    uScene: gl.getUniformLocation(compositeProgram, 'uScene'),
    uTexel: gl.getUniformLocation(compositeProgram, 'uTexel'),
    uBloom: gl.getUniformLocation(compositeProgram, 'uBloom'),
  }
  const c = {
    aScreen: gl.getAttribLocation(cameProgram, 'aScreen'),
    aAcross: gl.getAttribLocation(cameProgram, 'aAcross'),
    aAlong: gl.getAttribLocation(cameProgram, 'aAlong'),
    uResolution: gl.getUniformLocation(cameProgram, 'uResolution'),
    uCame: gl.getUniformLocation(cameProgram, 'uCame'),
    uBead: gl.getUniformLocation(cameProgram, 'uBead'),
  }
  const j = {
    aScreen: gl.getAttribLocation(jointProgram, 'aScreen'),
    aLocal: gl.getAttribLocation(jointProgram, 'aLocal'),
    uResolution: gl.getUniformLocation(jointProgram, 'uResolution'),
    uCame: gl.getUniformLocation(jointProgram, 'uCame'),
    uSeed: gl.getUniformLocation(jointProgram, 'uSeed'),
  }

  const posBuffer = gl.createBuffer()
  const worldBuffer = gl.createBuffer()
  const cameBuffer = gl.createBuffer()
  const jointBuffer = gl.createBuffer()
  const quadBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const swatches = new Map<string, CachedSwatch>()

  // Offscreen linear-HDR scene target, sized to the backing store (recreated on resize). The stencil
  // attachment is what lets the even-odd glass fills work off-screen.
  let fbo: WebGLFramebuffer | null = null
  let sceneTex: WebGLTexture | null = null
  let depthStencil: WebGLRenderbuffer | null = null
  let fboW = 0
  let fboH = 0

  function ensureFbo(w: number, h: number): boolean {
    if (fbo && w === fboW && h === fboH) return true
    if (!fbo) fbo = gl.createFramebuffer()
    if (!sceneTex) sceneTex = gl.createTexture()
    if (!depthStencil) depthStencil = gl.createRenderbuffer()
    if (!fbo || !sceneTex || !depthStencil) return false
    gl.bindTexture(gl.TEXTURE_2D, sceneTex)
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
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0)
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

  /** Draw a full-screen triangle for one of the screen-space passes. */
  function fullScreen(aPos: number): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

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
      // --- Pass 1: the scene into a linear-HDR target ---------------------
      const haveFbo = ensureFbo(backingW, backingH)
      gl.bindFramebuffer(gl.FRAMEBUFFER, haveFbo ? fbo : null)
      gl.viewport(0, 0, backingW, backingH)
      // Release the scene texture from unit 0 before drawing *into* it. The composite pass left it
      // bound, and the glass shader carries a sampler — so the driver sees a framebuffer/texture
      // feedback loop and silently drops every glass draw, leaving only the came visible.
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, null)

      const room = daylight(scene.backlight.warmth)
      gl.clearColor(0, 0, 0, 1)
      gl.clearStencil(0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.BLEND)

      // The graded surround, centred on the panel: a luminous field rather than a flat void, so the
      // panel reads as glass in a lit room instead of floating on black (F-064 thrust D).
      const panel = unionBBox(scene.pieces)
      if (panel) {
        const min = worldToScreen(viewport, panel.min)
        const max = worldToScreen(viewport, panel.max)
        const cx = (min.x + max.x) / 2 / Math.max(sizeCss.width, 1)
        const cy = (min.y + max.y) / 2 / Math.max(sizeCss.height, 1)
        const spanX = Math.abs(max.x - min.x) / Math.max(sizeCss.width, 1)
        const spanY = Math.abs(max.y - min.y) / Math.max(sizeCss.height, 1)
        gl.useProgram(surroundProgram)
        gl.uniform3f(sr.uWash, room.r, room.g, room.b)
        // vUv is y-up; the screen centre is y-down.
        gl.uniform2f(sr.uCentre, cx, 1 - cy)
        gl.uniform1f(sr.uSpread, Math.max(spanX, spanY) * 0.9 + 0.25)
        // Peak linear ~0.018, which lands near 0.2 in display after the composite's tone map. The
        // surround has to stay a suggestion of a lit room; brighter than this and it greys the stage.
        gl.uniform1f(sr.uStrength, 0.018 * scene.backlight.intensity)
        fullScreen(sr.aPos)
      }

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
        const surf = surfaceParams(piece.texture, piece.transparency)
        const tt = piece.textureTransform
        // The surface material (F-064 thrust A). Relief and the normal step are in world mm, so the
        // texture keeps its physical size and the per-piece transform composes with it.
        gl.uniform3f(g.uGlass, glass.r, glass.g, glass.b)
        gl.uniform3f(g.uLight, room.r, room.g, room.b)
        gl.uniform1f(g.uRelief, surf.reliefMm)
        gl.uniform1f(g.uStep, surf.normalStepMm)
        gl.uniform1f(g.uGloss, surf.gloss)
        gl.uniform1f(g.uHueDrift, surf.hueDrift)
        gl.uniform1f(g.uThickness, piece.thicknessMm)
        gl.uniform1f(g.uSwatchTileMm, SWATCH_TILE_MM)
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
      // Blend on: the came shader fades its wobbling outer edge, so it feathers into the glass
      // instead of stair-stepping along every lead line.
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.useProgram(cameProgram)
      gl.uniform2f(c.uResolution, sizeCss.width, sizeCss.height)
      const lead = LEAD_RGB
      const border = BORDER_RGB
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

      // --- Solder joints --------------------------------------------------
      // Drawn last so a lump sits on top of the runs meeting under it.
      gl.useProgram(jointProgram)
      gl.uniform2f(j.uResolution, sizeCss.width, sizeCss.height)
      for (const joint of scene.joints) {
        // Tinted like the metal it joins: only foil seams get the bright solder finish.
        const jointCol = joint.kind === 'foil' ? solder : joint.kind === 'border' ? border : lead
        // Only slightly wider than the came it terminates — the reference photo's joints are subtle
        // lumps, not beads sitting proud of the lattice.
        const radiusPx = Math.max(2, (joint.widthMm * pxPerMm) / 2) * 1.12
        const centre = worldToScreen(viewport, joint.at)
        gl.uniform3f(j.uCame, jointCol.r, jointCol.g, jointCol.b)
        // Seed from world position so each joint's lumpiness is distinct but stable across frames.
        gl.uniform1f(j.uSeed, ((joint.at.x * 7.31 + joint.at.y * 3.17) % 10) + 0.5)
        drawJointQuad(gl, jointBuffer, j.aScreen, j.aLocal, centre, radiusPx)
      }
      gl.disable(gl.BLEND)

      // --- Pass 2: bloom + tone map to the visible canvas ------------------
      if (haveFbo) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.viewport(0, 0, backingW, backingH)
        gl.useProgram(compositeProgram)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, sceneTex)
        gl.uniform1i(cp.uScene, 0)
        gl.uniform2f(cp.uTexel, 1 / backingW, 1 / backingH)
        gl.uniform1f(cp.uBloom, 0.85)
        fullScreen(cp.aPos)
      }
    },
    dispose() {
      for (const { texture } of swatches.values()) gl.deleteTexture(texture)
      swatches.clear()
      gl.deleteBuffer(posBuffer)
      gl.deleteBuffer(worldBuffer)
      gl.deleteBuffer(cameBuffer)
      gl.deleteBuffer(jointBuffer)
      gl.deleteBuffer(quadBuffer)
      if (fbo) gl.deleteFramebuffer(fbo)
      if (sceneTex) gl.deleteTexture(sceneTex)
      if (depthStencil) gl.deleteRenderbuffer(depthStencil)
      gl.deleteProgram(glassProgram)
      gl.deleteProgram(cameProgram)
      gl.deleteProgram(jointProgram)
      gl.deleteProgram(surroundProgram)
      gl.deleteProgram(compositeProgram)
    },
  }
}

// Backlit came reads as a near-black silhouette, not mid-grey (F-064 thrust B, reference photo).
// Solder finishes stay recognisable as metal but sit far darker than the old values.
const SOLDER_RGB: Record<SolderFinish, { r: number; g: number; b: number }> = {
  silver: { r: 0.34, g: 0.35, b: 0.37 },
  copper: { r: 0.32, g: 0.19, b: 0.11 },
  black: { r: 0.06, g: 0.06, b: 0.07 },
}

/**
 * The physical size a glass swatch photo tiles at, in mm — a photographed sheet is a real object, so
 * it repeats in world space rather than being stretched to each piece (F-053 follow-up).
 */
const SWATCH_TILE_MM = 240

/** The union of every piece's bbox, for centring the graded surround. `null` for an empty panel. */
function unionBBox(pieces: readonly GlassPieceInput[]): BBox | null {
  if (pieces.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pieces) {
    minX = Math.min(minX, p.bbox.min.x)
    minY = Math.min(minY, p.bbox.min.y)
    maxX = Math.max(maxX, p.bbox.max.x)
    maxY = Math.max(maxY, p.bbox.max.y)
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
}

/** Lead came: near-black, faintly cool. */
const LEAD_RGB = { r: 0.11, g: 0.11, b: 0.115 }
/** The perimeter came, darker still so the panel edge reads as a frame. */
const BORDER_RGB = { r: 0.075, g: 0.075, b: 0.08 }

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

/**
 * Draw one solder joint: a screen-space quad centred on the node, carrying local −1..1 coordinates
 * so the fragment shader can build a lumpy dome inside it. Interleaved [x, y, lx, ly].
 */
function drawJointQuad(
  gl: WebGL2RenderingContext,
  buffer: WebGLBuffer | null,
  aScreen: number,
  aLocal: number,
  centre: Vec2,
  radiusPx: number,
): void {
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, -1],
    [1, 1],
    [-1, 1],
  ]
  const data = new Float32Array(corners.length * 4)
  corners.forEach(([lx, ly], i) => {
    data[i * 4] = centre.x + lx! * radiusPx
    data[i * 4 + 1] = centre.y + ly! * radiusPx
    data[i * 4 + 2] = lx!
    data[i * 4 + 3] = ly!
  })
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
  const stride = 4 * 4
  gl.enableVertexAttribArray(aScreen)
  gl.vertexAttribPointer(aScreen, 2, gl.FLOAT, false, stride, 0)
  gl.enableVertexAttribArray(aLocal)
  gl.vertexAttribPointer(aLocal, 2, gl.FLOAT, false, stride, 8)
  gl.drawArrays(gl.TRIANGLES, 0, corners.length)
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
