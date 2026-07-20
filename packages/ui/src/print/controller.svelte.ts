import type { BBox } from '@vitrum/geometry'
import {
  buildPrintDocument,
  computeTiling,
  DEFAULT_MARGIN_MM,
  DEFAULT_OVERLAP_MM,
  orientedSize,
  paperSize,
  renderPdf,
  type Orientation,
  type PaperSize,
  type PrintContent,
  type PrintOptions,
  type PrintScene,
  type Tiling,
} from '@vitrum/paper'

/** Writes generated PDF bytes to the host (native dialog on desktop, download in the browser). */
export type SavePdf = (suggestedName: string, bytes: Uint8Array) => Promise<string | null>

/**
 * The reactive owner of the print dialog's settings (F-041). It holds the paper/orientation/margins/
 * overlap/content/include state as runes, derives the tile grid for the live canvas preview, and runs
 * the export through `@vitrum/paper` (build the {@link PdfDoc} → render vector PDF → hand the bytes to
 * the host). All the actual geometry lives in the pure package; this class is just the UI seam.
 */
export class PrintController {
  open = $state(false)

  paperId = $state<string>('a4')
  orientation = $state<Orientation>('portrait')
  marginMm = $state(DEFAULT_MARGIN_MM)
  overlapMm = $state(DEFAULT_OVERLAP_MM)
  content = $state<PrintContent>('cartoon')
  /** Custom sheet size (mm), used when `paperId === 'custom'`. */
  customWidthMm = $state(210)
  customHeightMm = $state(297)

  includeNumbers = $state(true)
  includeGlassCodes = $state(true)
  includeAlignmentMarks = $state(true)
  includePageLabels = $state(true)
  includeCalibrationRuler = $state(true)
  includeOverviewMap = $state(true)

  /** Export progress + result, surfaced in the dialog footer. */
  exporting = $state(false)
  errorMessage = $state<string | null>(null)
  lastSavedPath = $state<string | null>(null)

  /** The resolved paper size (a named size, or the user's custom dimensions). */
  get paper(): PaperSize {
    if (this.paperId === 'custom') {
      return {
        id: 'custom',
        label: 'Custom',
        widthMm: Math.max(1, this.customWidthMm),
        heightMm: Math.max(1, this.customHeightMm),
      }
    }
    return paperSize(this.paperId) ?? paperSize('a4')!
  }

  /** The current settings as a {@link PrintOptions} for a given project. */
  optionsFor(projectName: string): PrintOptions {
    return {
      paper: this.paper,
      orientation: this.orientation,
      marginMm: this.marginMm,
      overlapMm: this.overlapMm,
      content: this.content,
      include: {
        numbers: this.includeNumbers,
        glassCodes: this.includeGlassCodes,
        alignmentMarks: this.includeAlignmentMarks,
        pageLabels: this.includePageLabels,
        calibrationRuler: this.includeCalibrationRuler,
        overviewMap: this.includeOverviewMap,
      },
      projectName,
    }
  }

  /** The tile grid over the given content bounds, or null when the settings are degenerate. */
  tilingFor(bounds: BBox | null): Tiling | null {
    if (!bounds) return null
    const { widthMm, heightMm } = orientedSize(this.paper, this.orientation)
    try {
      return computeTiling({
        contentBounds: bounds,
        pageWidthMm: widthMm,
        pageHeightMm: heightMm,
        marginMm: this.marginMm,
        overlapMm: this.overlapMm,
      })
    } catch {
      return null
    }
  }

  /**
   * Build and export the PDF. Resolves to the saved path (null if the user cancelled the save
   * dialog). Errors are captured into `errorMessage` rather than thrown, so the dialog can show them.
   */
  async export(scene: PrintScene, projectName: string, savePdf: SavePdf): Promise<string | null> {
    this.exporting = true
    this.errorMessage = null
    try {
      const doc = buildPrintDocument(scene, this.optionsFor(projectName))
      const bytes = await renderPdf(doc)
      const name = `${sanitize(projectName)}-1to1.pdf`
      const path = await savePdf(name, bytes)
      this.lastSavedPath = path
      return path
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error)
      return null
    } finally {
      this.exporting = false
    }
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
