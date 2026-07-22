import { worldToScreen, type Viewport } from '@vitrum/core'
import { homographyFromQuadToQuad, type Mat3, type Quad } from '@vitrum/geometry'

/**
 * The WebGL reference-underlay renderer (F-051). Each layer is drawn as a screen-space quad
 * (`dstQuad` mapped world→screen) whose fragments sample the image through the homography
 * `screen → image-uv`; that single matrix expresses placement, calibration and perspective
 * rectification at once (an un-rectified layer degenerates to an affine fill). Sampling on the GPU
 * keeps a 4K underlay off the interaction budget (FR-4) and matches the CPU-side homography we
 * measure against (FR-1).
 *
 * WebGL1, non-power-of-two textures (CLAMP_TO_EDGE, LINEAR, no mipmaps). The factory returns `null`
 * when no GL context is available (jsdom in component tests), so callers no-op gracefully.
 */

export interface RenderLayer {
  readonly assetId: string
  readonly naturalWidthPx: number
  readonly naturalHeightPx: number
  /** Image-pixel-space source corners (TL, TR, BR, BL). */
  readonly srcQuad: Quad
  /** World-space destination corners (TL, TR, BR, BL). */
  readonly dstQuad: Quad
  readonly opacity: number
  readonly desaturate: boolean
  readonly visible: boolean
}

/** Resolves a layer's decoded image to a GPU-uploadable source, or `undefined` while decoding. */
export type ResolveSource = (assetId: string) => TexImageSource | undefined

export interface ReferenceRenderer {
  /** Redraw every visible layer for the current viewport. `sizeCss` is the canvas size in CSS px. */
  render(
    viewport: Viewport,
    sizeCss: { width: number; height: number },
    dpr: number,
    layers: readonly RenderLayer[],
    resolve: ResolveSource,
  ): void
  dispose(): void
}

const VERT = `
attribute vec2 aScreen;
uniform vec2 uResolution;
varying vec2 vScreen;
void main() {
  vScreen = aScreen;
  vec2 clip = (aScreen / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`

const FRAG = `
precision highp float;
uniform sampler2D uTex;
uniform mat3 uHomography;
uniform float uOpacity;
uniform float uDesaturate;
varying vec2 vScreen;
void main() {
  vec3 p = uHomography * vec3(vScreen, 1.0);
  vec2 uv = p.xy / p.z;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  vec4 c = texture2D(uTex, uv);
  if (uDesaturate > 0.5) {
    float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    c = vec4(g, g, g, c.a);
  }
  gl_FragColor = vec4(c.rgb, c.a * uOpacity);
}`

interface CachedTexture {
  texture: WebGLTexture
  source: TexImageSource
}

/** Create the renderer for `canvas`, or `null` if WebGL is unavailable (e.g. jsdom). */
export function createReferenceRenderer(canvas: HTMLCanvasElement): ReferenceRenderer | null {
  const context =
    (canvas.getContext('webgl', {
      premultipliedAlpha: false,
      alpha: true,
    }) as WebGLRenderingContext | null) ??
    (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null)
  if (!context) return null
  // Capture the narrowed, non-null context so the closures below keep the non-null type (control-flow
  // narrowing does not reach into nested functions).
  const glc: WebGLRenderingContext = context

  const program = buildProgram(glc)
  if (!program) return null

  const aScreen = glc.getAttribLocation(program, 'aScreen')
  const uResolution = glc.getUniformLocation(program, 'uResolution')
  const uHomography = glc.getUniformLocation(program, 'uHomography')
  const uOpacity = glc.getUniformLocation(program, 'uOpacity')
  const uDesaturate = glc.getUniformLocation(program, 'uDesaturate')

  const positionBuffer = glc.createBuffer()
  const indexBuffer = glc.createBuffer()
  glc.bindBuffer(glc.ELEMENT_ARRAY_BUFFER, indexBuffer)
  glc.bufferData(glc.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), glc.STATIC_DRAW)

  const textures = new Map<string, CachedTexture>()

  function textureFor(assetId: string, source: TexImageSource): WebGLTexture | null {
    const cached = textures.get(assetId)
    if (cached && cached.source === source) return cached.texture
    const texture = cached?.texture ?? glc.createTexture()
    if (!texture) return null
    glc.bindTexture(glc.TEXTURE_2D, texture)
    glc.texParameteri(glc.TEXTURE_2D, glc.TEXTURE_WRAP_S, glc.CLAMP_TO_EDGE)
    glc.texParameteri(glc.TEXTURE_2D, glc.TEXTURE_WRAP_T, glc.CLAMP_TO_EDGE)
    glc.texParameteri(glc.TEXTURE_2D, glc.TEXTURE_MIN_FILTER, glc.LINEAR)
    glc.texParameteri(glc.TEXTURE_2D, glc.TEXTURE_MAG_FILTER, glc.LINEAR)
    glc.pixelStorei(glc.UNPACK_FLIP_Y_WEBGL, 0)
    glc.pixelStorei(glc.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    glc.texImage2D(glc.TEXTURE_2D, 0, glc.RGBA, glc.RGBA, glc.UNSIGNED_BYTE, source)
    textures.set(assetId, { texture, source })
    return texture
  }

  return {
    render(viewport, sizeCss, dpr, layers, resolve) {
      const backingW = Math.max(1, Math.round(sizeCss.width * dpr))
      const backingH = Math.max(1, Math.round(sizeCss.height * dpr))
      if (canvas.width !== backingW) canvas.width = backingW
      if (canvas.height !== backingH) canvas.height = backingH

      glc.viewport(0, 0, backingW, backingH)
      glc.clearColor(0, 0, 0, 0)
      glc.clear(glc.COLOR_BUFFER_BIT)
      glc.disable(glc.DEPTH_TEST)
      glc.enable(glc.BLEND)
      glc.blendFunc(glc.SRC_ALPHA, glc.ONE_MINUS_SRC_ALPHA)

      glc.useProgram(program)
      glc.uniform2f(uResolution, sizeCss.width, sizeCss.height)

      glc.bindBuffer(glc.ARRAY_BUFFER, positionBuffer)
      glc.enableVertexAttribArray(aScreen)
      glc.vertexAttribPointer(aScreen, 2, glc.FLOAT, false, 0, 0)
      glc.bindBuffer(glc.ELEMENT_ARRAY_BUFFER, indexBuffer)

      for (const layer of layers) {
        if (!layer.visible || layer.opacity <= 0) continue
        const source = resolve(layer.assetId)
        if (!source) continue
        const texture = textureFor(layer.assetId, source)
        if (!texture) continue

        // Destination quad corners in CSS screen px.
        const screen = layer.dstQuad.map((p) => worldToScreen(viewport, p))
        const screenQuad: Quad = [screen[0]!, screen[1]!, screen[2]!, screen[3]!]
        // Image-uv source corners (0..1).
        const uv: Quad = [
          uvOf(layer.srcQuad[0], layer),
          uvOf(layer.srcQuad[1], layer),
          uvOf(layer.srcQuad[2], layer),
          uvOf(layer.srcQuad[3], layer),
        ]
        const homography = homographyFromQuadToQuad(screenQuad, uv)

        glc.bufferData(glc.ARRAY_BUFFER, screenPositions(screenQuad), glc.DYNAMIC_DRAW)
        glc.uniformMatrix3fv(uHomography, false, columnMajor(homography))
        glc.uniform1f(uOpacity, layer.opacity)
        glc.uniform1f(uDesaturate, layer.desaturate ? 1 : 0)

        glc.activeTexture(glc.TEXTURE0)
        glc.bindTexture(glc.TEXTURE_2D, texture)
        glc.drawElements(glc.TRIANGLES, 6, glc.UNSIGNED_SHORT, 0)
      }
    },
    dispose() {
      for (const { texture } of textures.values()) glc.deleteTexture(texture)
      textures.clear()
      glc.deleteBuffer(positionBuffer)
      glc.deleteBuffer(indexBuffer)
      glc.deleteProgram(program)
    },
  }
}

function uvOf(p: { x: number; y: number }, layer: RenderLayer): { x: number; y: number } {
  return { x: p.x / layer.naturalWidthPx, y: p.y / layer.naturalHeightPx }
}

function screenPositions(quad: Quad): Float32Array {
  return new Float32Array([
    quad[0].x,
    quad[0].y,
    quad[1].x,
    quad[1].y,
    quad[2].x,
    quad[2].y,
    quad[3].x,
    quad[3].y,
  ])
}

/** GLSL stores mat3 column-major; our {@link Mat3} is row-major, so upload the transpose. */
function columnMajor(m: Mat3): Float32Array {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]])
}

function buildProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
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

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
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
