import type { QuoteReport } from '@vitrum/core'
import { buildQuoteDocument, renderPdf, type QuoteDocOptions } from '@vitrum/paper'

/** Writes generated PDF bytes to the host (native dialog on desktop, download in the browser). */
export type SavePdf = (suggestedName: string, bytes: Uint8Array) => Promise<string | null>

/**
 * The reactive owner of the cost / quote panel's view state (F-056): the sensitivity-view piece
 * count, the two client-PDF export options (internal breakdown, panel image — FR-3), and the PDF
 * export runner. The {@link QuoteReport} itself is derived upstream in the shell from the live
 * document + BOM via `computeQuote`, so it stays live (FR-2); this class holds no report state. Canvas
 * highlighting for the sensitivity view reuses the F-042 `BomController` highlight (wired in the
 * shell) so no new canvas overlay is added.
 */
export class QuoteController {
  /** How many of the smallest pieces the sensitivity view sums/highlights ("the N smallest…"). */
  smallestN = $state(12)

  /** Include the internal cost breakdown in the exported quote PDF (FR-3). Default off. */
  includeBreakdown = $state(false)
  /** Embed the rendered panel snapshot in the exported quote PDF. Default on. */
  includePanelImage = $state(true)

  exporting = $state(false)
  errorMessage = $state<string | null>(null)
  lastSavedPath = $state<string | null>(null)

  /** Build and export the quote PDF. Errors are captured, not thrown, for the dialog. */
  async exportPdf(
    report: QuoteReport,
    options: QuoteDocOptions,
    savePdf: SavePdf,
  ): Promise<string | null> {
    this.exporting = true
    this.errorMessage = null
    try {
      const bytes = await renderPdf(buildQuoteDocument(report, options))
      const base = sanitize(options.client.projectTitle || options.projectName)
      const path = await savePdf(`${base}-quote.pdf`, bytes)
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

/** A filesystem-friendly base filename from a project / quote name. */
function sanitize(name: string): string {
  const trimmed = name
    .trim()
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return trimmed || 'panel'
}
