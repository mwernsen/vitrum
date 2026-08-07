import Droplet from 'lucide-svelte/icons/droplet'
import History from 'lucide-svelte/icons/history'
import LayoutGrid from 'lucide-svelte/icons/layout-grid'
import List from 'lucide-svelte/icons/list'
import Settings from 'lucide-svelte/icons/settings'

/**
 * The launch screen's left nav (`#2a`). The design makes the launch screen a **portal** with
 * cross-document destinations, not just a grid — so the rail is built for real, with "Panels" live and
 * the other four visibly disabled and labelled (FR-8). That is the repo's established convention for
 * unbuilt surfaces (`shell/dock.ts`, `shell/viewmode.ts`): never silently absent, never fake-clickable.
 *
 * Note on the `feature` tags: these four destinations are **cross-document** views that have no
 * roadmap id of their own. Each is therefore tagged with the feature that owns the capability *inside
 * the editor* today, which is the honest statement of where it lives — a cross-document home for each
 * still needs its own spec. "Settings" has no owner at all and says so.
 */
export type RailId = 'panels' | 'glass' | 'cutLists' | 'versions' | 'settings'

export interface RailItem {
  readonly id: RailId
  readonly label: string
  /** Typed off a concrete icon, like `shell/viewmode.ts` — lucide's are legacy Svelte components. */
  readonly icon: typeof LayoutGrid
  /** Whether the destination exists. Only "Panels" does in v1. */
  readonly live: boolean
  /** For a placeholder: why it is disabled, shown as its tooltip. */
  readonly note?: string
}

export const RAIL_ITEMS: readonly RailItem[] = [
  { id: 'panels', label: 'Panels', icon: LayoutGrid, live: true },
  {
    id: 'glass',
    label: 'Glass library',
    icon: Droplet,
    live: false,
    note: 'Your glass catalog lives in the editor for now (F-022)',
  },
  {
    id: 'cutLists',
    label: 'Cut lists',
    icon: List,
    live: false,
    note: 'Cutting lists are per panel for now (F-042)',
  },
  {
    id: 'versions',
    label: 'Versions',
    icon: History,
    live: false,
    note: 'Version history is per panel for now (F-055)',
  },
  { id: 'settings', label: 'Settings', icon: Settings, live: false, note: 'Not built yet' },
]
