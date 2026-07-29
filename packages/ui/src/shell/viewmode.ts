// The cockpit's top-bar view switcher (Portal "2b"). "design" is the working view; the rest are
// derived output views (cartoon/render/light are the F-040/F-053/F-054 renders; "nest" is the F-057
// sheet-nesting layout). Each renders the same source network a different way.
export type ViewMode = 'design' | 'cartoon' | 'render' | 'light' | 'nest'

export interface ViewModeMeta {
  id: ViewMode
  label: string
  live: boolean
  /** For placeholder modes: the roadmap feature that will build the view. */
  feature?: string
}

export const VIEW_MODES: ViewModeMeta[] = [
  { id: 'design', label: 'Design', live: true },
  { id: 'cartoon', label: 'Cartoon', live: true },
  { id: 'render', label: 'Render', live: true },
  { id: 'light', label: 'Light', live: true },
  { id: 'nest', label: 'Nest', live: true },
]
