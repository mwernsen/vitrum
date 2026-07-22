// The cockpit's top-bar view switcher (Portal "2b"). Only "design" is live today; the derived
// output views arrive with later roadmap features and render as disabled placeholders for now.
export type ViewMode = 'design' | 'cartoon' | 'render' | 'light'

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
  { id: 'light', label: 'Light', live: false, feature: 'F-054' },
]
