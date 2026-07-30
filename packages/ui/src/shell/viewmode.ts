import LayoutGrid from 'lucide-svelte/icons/layout-grid'
import PenTool from 'lucide-svelte/icons/pen-tool'
import ScrollText from 'lucide-svelte/icons/scroll-text'
import Sparkles from 'lucide-svelte/icons/sparkles'
import Sun from 'lucide-svelte/icons/sun'

// The cockpit's top-bar view switcher (Cockpit v2). "design" is the working view; the rest are
// derived readings of the same source network — cartoon/render/light are the F-040/F-053/F-054
// renders, "nest" is the F-057 sheet-nesting layout. One canvas, five readings of it.
export type ViewMode = 'design' | 'cartoon' | 'render' | 'light' | 'nest'

export interface ViewModeMeta {
  id: ViewMode
  label: string
  icon: typeof PenTool
  live: boolean
  /** For placeholder modes: the roadmap feature that will build the view. */
  feature?: string
  /** Banner copy shown over the stage in the derived views, so nobody edits a read-only reading. */
  banner?: string
}

export const VIEW_MODES: ViewModeMeta[] = [
  { id: 'design', label: 'Design', icon: PenTool, live: true },
  {
    id: 'cartoon',
    label: 'Cartoon',
    icon: ScrollText,
    live: true,
    banner: 'Cartoon — full-size line drawing',
  },
  {
    id: 'render',
    label: 'Render',
    icon: Sparkles,
    live: true,
    banner: 'Render — glass as it will look',
  },
  { id: 'light', label: 'Light', icon: Sun, live: true, banner: 'Light — simulated sun' },
  {
    id: 'nest',
    label: 'Nest',
    icon: LayoutGrid,
    live: true,
    banner: 'Nest — pieces laid onto sheets',
  },
]
