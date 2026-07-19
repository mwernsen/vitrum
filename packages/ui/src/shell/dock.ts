// The docked side panel (Portal cockpit, turn 3) has one home per feature area. The activity
// rail is the *sole* switcher — clicking a rail icon swaps what's docked, there are no tabs.
// Today only "layers" and "glass" are backed by completed features (F-003/012/013/021/022/023);
// rules/make/versions are as-designed placeholders their roadmap features will fill in.
export type DockSection = 'layers' | 'glass' | 'rules' | 'make' | 'versions'

export interface DockSectionMeta {
  id: DockSection
  /** Label shown in the dock header. */
  label: string
  /** Whether the section has live content today, vs. an "arrives with F-0XX" placeholder. */
  live: boolean
  /** For placeholder sections: the roadmap feature that will fill it. */
  feature?: string
}

export const DOCK_SECTIONS: DockSectionMeta[] = [
  { id: 'layers', label: 'Layers', live: true },
  { id: 'glass', label: 'Glass', live: true },
  { id: 'rules', label: 'Rules', live: false, feature: 'F-030' },
  { id: 'make', label: 'Make', live: false, feature: 'F-042' },
  { id: 'versions', label: 'Versions', live: false, feature: 'F-055' },
]
