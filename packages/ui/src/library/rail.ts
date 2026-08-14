import Droplet from 'lucide-svelte/icons/droplet'
import LayoutGrid from 'lucide-svelte/icons/layout-grid'

/**
 * The launch screen's left nav (`#2a`). The design makes the launch screen a **portal** with
 * cross-document destinations, not just a grid. Only destinations that exist or are actively planned
 * earn a row: "Panels" and, since F-063, "Glass library" are both live and select their view (the
 * portal's `panels | glass` state); the active row carries `aria-current="page"`.
 *
 * The design's other rows (Cut lists, Versions, Settings) were removed 2026-08-14 at Mathieu's
 * direction: nothing on the roadmap owns a cross-document home for them, so a permanent disabled
 * placeholder is noise. They return when a spec claims them — with `live: false` and a `note`, the
 * repo's established convention for unbuilt surfaces (`shell/dock.ts`, `shell/viewmode.ts`).
 */
export type RailId = 'panels' | 'glass'

export interface RailItem {
  readonly id: RailId
  readonly label: string
  /** Typed off a concrete icon, like `shell/viewmode.ts` — lucide's are legacy Svelte components. */
  readonly icon: typeof LayoutGrid
  /** Whether the destination exists. Both current rows do since F-063. */
  readonly live: boolean
  /** For a placeholder: why it is disabled, shown as its tooltip. Absent on a live row. */
  readonly note?: string
}

export const RAIL_ITEMS: readonly RailItem[] = [
  { id: 'panels', label: 'Panels', icon: LayoutGrid, live: true },
  { id: 'glass', label: 'Glass library', icon: Droplet, live: true },
]
