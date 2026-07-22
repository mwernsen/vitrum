import {
  buildImportPreview,
  readSvg,
  scaleForTargetWidth,
  type DrawRole,
  type ImportPreview,
  type SvgSource,
} from '@vitrum/core'

import type { OpenedFile } from '@vitrum/model'

/**
 * The reactive owner of the SVG import dialog's state (F-050). It holds the parsed source (cached so
 * slider drags never re-parse), the single healing tolerance, the scale for an ambiguous-unit file,
 * and the import target role. The live preview — the healed network, its piece count and the "what
 * changed" highlight — is derived from those. Heavy heal recomputation on slider drag is debounced so
 * a large file stays responsive; the read-out label tracks the slider live. All generation is in the
 * pure `@vitrum/core` package; this class is only the UI seam.
 */
export class ImportController {
  open = $state(false)
  /** True while a file is being read from the host. */
  busy = $state(false)
  error = $state<string | null>(null)

  fileName = $state<string | null>(null)
  source = $state<SvgSource | null>(null)

  /** Live slider position (mm) — updates immediately for the read-out. */
  sliderMm = $state(0.2)
  /** Debounced tolerance (mm) that actually drives the (heavier) heal + preview. */
  toleranceMm = $state(0.2)

  /** Import target role: lead lines (default) or construction guides. */
  role = $state<DrawRole>('lead')

  /** Target artwork width (mm) for an ambiguous-unit file (the scale dialog's field). */
  targetWidthMm = $state(0)

  #timer: ReturnType<typeof setTimeout> | undefined

  /** Whether the file's physical scale is ambiguous and the scale dialog applies (decision #3). */
  get ambiguous(): boolean {
    return this.source?.unit.ambiguous ?? false
  }

  /** Physical size of one SVG user unit in mm — from the file, or the scale dialog when ambiguous. */
  get userUnitMm(): number {
    const unit = this.source?.unit
    if (!unit) return 1
    if (!unit.ambiguous) return unit.userUnitMm
    const widthUser = unit.artworkWidthUser
    return widthUser && widthUser > 0 ? scaleForTargetWidth(widthUser, this.targetWidthMm) : 1
  }

  /** The live preview: healed network, piece count and dropped-content kinds. Null until a file loads. */
  preview = $derived.by<ImportPreview | null>(() => {
    if (!this.source) return null
    return buildImportPreview(this.source, {
      userUnitMm: this.userUnitMm,
      toleranceMm: this.toleranceMm,
      role: this.role,
    })
  })

  /** Read an SVG through the host and open the dialog seeded with sensible defaults. */
  async load(openSvg: () => Promise<OpenedFile | null>): Promise<void> {
    this.busy = true
    this.error = null
    try {
      const file = await openSvg()
      if (!file) return
      // `OpenedFile.contents` is bytes (the project container is binary); SVG is UTF-8 text.
      const source = readSvg(new TextDecoder().decode(file.contents))
      this.source = source
      this.fileName = file.path
      // Default the scale dialog to 1 user unit = 1 mm (decision #3): target width = artwork width.
      this.targetWidthMm = source.unit.artworkWidthUser ?? 100
      this.sliderMm = 0.2
      this.toleranceMm = 0.2
      this.role = 'lead'
      this.open = true
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.source = null
      this.open = true
    } finally {
      this.busy = false
    }
  }

  /** Move the tolerance slider: update the read-out immediately, debounce the heal recompute. */
  setTolerance(mm: number): void {
    this.sliderMm = mm
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.toleranceMm = mm
    }, 120)
  }

  /** Set the target artwork width (mm) for an ambiguous file (rescales the whole import). */
  setTargetWidth(mm: number): void {
    if (Number.isFinite(mm) && mm > 0) this.targetWidthMm = mm
  }

  close(): void {
    clearTimeout(this.#timer)
    this.open = false
    this.source = null
    this.fileName = null
    this.error = null
  }
}
