// The docked side panel (Portal cockpit "2b") is organized into sections, mirrored by the
// activity rail. Only "glass" is backed by a completed feature today (F-022/F-023); the rest
// are placeholders that later roadmap features fill in.
export type DockSection = 'layers' | 'glass' | 'rules' | 'make'

export interface DockSectionMeta {
  id: DockSection
  /** Label shown in the dock tab header. */
  label: string
  /** Whether the section has live content today, vs. a "coming with F-0XX" placeholder. */
  live: boolean
  /** For placeholder sections: the roadmap feature that will fill it. */
  feature?: string
}

export const DOCK_SECTIONS: DockSectionMeta[] = [
  { id: 'layers', label: 'Layers', live: false, feature: 'F-002' },
  { id: 'glass', label: 'Glass', live: true },
  { id: 'rules', label: 'Rules', live: false, feature: 'F-030' },
  { id: 'make', label: 'Make', live: false, feature: 'F-042' },
]
