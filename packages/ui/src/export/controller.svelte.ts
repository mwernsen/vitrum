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
 * The kinds of output the single Export dialog produces (F-043, consolidated 2026-07-21). Every
 * shipping output routes through here, organised by document type:
 * - `design-sheet` — a single-sheet PDF of the whole design (this controller).
 * - `design-files` — SVG (linework / cut / render) or DXF interchange files (this controller).
 * - `tiled` — the F-041 1:1 tiled cutting template (driven by `PrintController`).
 * - `bom` — the F-042 cutting list / BOM as PDF or CSV (driven by `BomController`).
 * - `png` — a raster snapshot of the canvas (this controller, via the shell's canvas getter).
 */
export type OutputDocType = 'design-sheet' | 'design-files' | 'tiled' | 'bom' | 'png'

/** Which interchange file the `design-files` type writes. */
export type DesignFileFormat = 'svg' | 'dxf'

/** Which document the `bom` type writes. */
export type BomFileFormat = 'pdf' | 'csv'

/**
 * The reactive owner of the Export dialog's own state (F-043). It holds the chosen document type and
 * the options for the types it generates directly (`design-sheet`, `design-files`, `png`) and runs
 * those through `@vitrum/paper`. The `tiled` and `bom` types are composed from the existing
 * `PrintController` (F-041) and `BomController` (F-042) — this controller does not duplicate their
 * pure logic; the shell dispatches each type to the right runner. All generation lives in the pure
 * package; this class is only the UI seam.
 */
export class ExportController {
  open = $state(false)

  docType = $state<OutputDocType>('design-sheet')

  // design-files.
  designFileFormat = $state<DesignFileFormat>('svg')
  svgFlavor = $state<SvgFlavor>('linework')
  cutLayout = $state<CutLayout>('in-place')

  // design-sheet (single-sheet PDF).
  pdfScaleMode = $state<PdfScaleMode>('actual')
  pdfLook = $state<PdfLook>('render')
  pdfPaperId = $state<string>('a4')
  pdfOrientation = $state<Orientation>('portrait')
  marginMm = $state(DEFAULT_EXPORT_MARGIN_MM)

  // bom.
  bomFormat = $state<BomFileFormat>('pdf')

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
   * Build and save the `design-sheet` (single-sheet PDF) or `design-files` (SVG/DXF) output. SVG/DXF
   * go through `saveText`; PDF through `savePdf`. Errors are captured into `errorMessage` (not
   * thrown) so the dialog can show them. Resolves to the saved path, or null on failure/cancel.
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
      if (this.docType === 'design-files' && this.designFileFormat === 'svg') {
        if (!hosts.saveText) throw new Error('SVG export is unavailable')
        return await this.#saved(
          hosts.saveText(`${base}.svg`, buildSvg(scene, this.svgOptions(projectName))),
        )
      }
      if (this.docType === 'design-files' && this.designFileFormat === 'dxf') {
        if (!hosts.saveText) throw new Error('DXF export is unavailable')
        return await this.#saved(
          hosts.saveText(`${base}.dxf`, buildDxf(scene, this.dxfOptions(projectName))),
        )
      }
      // design-sheet PDF.
      if (!hosts.savePdf) throw new Error('PDF export is unavailable')
      const bytes = await renderPdf(buildExportPdfDocument(scene, this.pdfOptions(projectName)))
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
    this.exporting = true
    this.errorMessage = null
    if (!bytes) {
      this.errorMessage = 'Could not capture the canvas'
      this.exporting = false
      return null
    }
    try {
      return await this.#saved(savePng(`${this.baseName(projectName)}.png`, bytes))
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error)
      return null
    } finally {
      this.exporting = false
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
