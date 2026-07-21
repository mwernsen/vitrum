import {
  buildDxf,
  buildExportPdfDocument,
  buildSvg,
  DEFAULT_EXPORT_MARGIN_MM,
  defaultCutLayout,
  paperSize,
  renderPdf,
  type CutLayout,
  type DxfOptions,
  type ExportFormat,
  type ExportPdfOptions,
  type ExportScene,
  type Orientation,
  type PaperSize,
  type PdfLook,
  type PdfScaleMode,
  type SvgFlavor,
  type SvgOptions,
} from '@vitrum/paper'

/** Writes generated PDF bytes to the host (native dialog on desktop, download in the browser). */
export type SavePdf = (suggestedName: string, bytes: Uint8Array) => Promise<string | null>
/** Writes a generated text document (SVG / DXF) to the host. */
export type SaveText = (suggestedName: string, text: string) => Promise<string | null>
/** Writes raw image bytes (the PNG snapshot) to the host. */
export type SavePng = (suggestedName: string, bytes: Uint8Array) => Promise<string | null>

/**
 * The reactive owner of the export dialog's settings (F-043). It holds the chosen format and its
 * per-format options as runes and runs the export through `@vitrum/paper` (build SVG/DXF text or a
 * single-sheet PDF → hand it to the host). All the actual generation lives in the pure package; this
 * class is only the UI seam, mirroring `PrintController` (F-041). The PNG snapshot is a separate path
 * (it rasterises the live canvas rather than the scene) driven by {@link runPng} in the shell.
 */
export class ExportController {
  open = $state(false)

  format = $state<ExportFormat>('svg')

  // SVG options.
  svgFlavor = $state<SvgFlavor>('linework')
  cutLayout = $state<CutLayout>('in-place')

  // PDF options.
  pdfScaleMode = $state<PdfScaleMode>('actual')
  pdfLook = $state<PdfLook>('render')
  pdfPaperId = $state<string>('a4')
  pdfOrientation = $state<Orientation>('portrait')
  marginMm = $state(DEFAULT_EXPORT_MARGIN_MM)

  // Shared.
  includeNumbers = $state(true)

  exporting = $state(false)
  errorMessage = $state<string | null>(null)
  lastSavedPath = $state<string | null>(null)

  /** Apply technique-aware defaults (F-043): a foil design spreads cut contours on a grid. */
  applyTechniqueDefaults(technique: 'lead' | 'foil'): void {
    this.cutLayout = defaultCutLayout(technique)
  }

  get paper(): PaperSize {
    return paperSize(this.pdfPaperId) ?? paperSize('a4')!
  }

  svgOptions(projectName: string): SvgOptions {
    return {
      flavor: this.svgFlavor,
      cutLayout: this.cutLayout,
      includeNumbers: this.includeNumbers,
      projectName,
    }
  }

  dxfOptions(projectName: string): DxfOptions {
    return { projectName, includeCut: true }
  }

  pdfOptions(projectName: string): ExportPdfOptions {
    return {
      scaleMode: this.pdfScaleMode,
      look: this.pdfLook,
      includeNumbers: this.includeNumbers,
      paper: this.paper,
      orientation: this.pdfOrientation,
      marginMm: this.marginMm,
      projectName,
    }
  }

  /** The base filename (no extension) for the current export. */
  private baseName(projectName: string): string {
    return sanitize(projectName)
  }

  /**
   * Build and save the current format. SVG/DXF go through `saveText`; PDF through `savePdf`. Errors
   * are captured into `errorMessage` (not thrown) so the dialog can show them. Resolves to the saved
   * path, or null if the export failed or the user cancelled the save dialog.
   */
  async run(
    scene: ExportScene,
    projectName: string,
    hosts: { saveText?: SaveText; savePdf?: SavePdf },
  ): Promise<string | null> {
    this.exporting = true
    this.errorMessage = null
    try {
      const base = this.baseName(projectName)
      if (this.format === 'svg') {
        if (!hosts.saveText) throw new Error('SVG export is unavailable')
        const svg = buildSvg(scene, this.svgOptions(projectName))
        return await this.#saved(hosts.saveText(`${base}.svg`, svg))
      }
      if (this.format === 'dxf') {
        if (!hosts.saveText) throw new Error('DXF export is unavailable')
        const dxf = buildDxf(scene, this.dxfOptions(projectName))
        return await this.#saved(hosts.saveText(`${base}.dxf`, dxf))
      }
      if (!hosts.savePdf) throw new Error('PDF export is unavailable')
      const doc = buildExportPdfDocument(scene, this.pdfOptions(projectName))
      const bytes = await renderPdf(doc)
      return await this.#saved(hosts.savePdf(`${base}.pdf`, bytes))
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error)
      return null
    } finally {
      this.exporting = false
    }
  }

  /** Save a PNG snapshot (bytes rasterised from the live canvas by the shell). */
  async runPng(
    bytes: Uint8Array | null,
    projectName: string,
    savePng: SavePng,
  ): Promise<string | null> {
    this.errorMessage = null
    if (!bytes) {
      this.errorMessage = 'Could not capture the canvas'
      return null
    }
    try {
      return await this.#saved(savePng(`${this.baseName(projectName)}.png`, bytes))
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error)
      return null
    }
  }

  async #saved(promise: Promise<string | null>): Promise<string | null> {
    const path = await promise
    this.lastSavedPath = path
    return path
  }
}

/** A filesystem-friendly base filename from a project name. */
function sanitize(name: string): string {
  const trimmed = name
    .trim()
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return trimmed || 'panel'
}
