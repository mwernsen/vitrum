// The docked side panel (Portal cockpit, turn 3) has one home per feature area. The activity
// rail is the *sole* switcher — clicking a rail icon swaps what's docked, there are no tabs.
// Today "layers", "glass", "rules" and "make" are backed by completed features (F-003/012/013/021/
// 022/023/030/040); "make" hosts piece numbering (F-040) live with the cutting list / BOM / print /
// export still as-designed placeholders. "versions" is an as-designed placeholder (F-055).
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
  { id: 'rules', label: 'Rules', live: true },
  { id: 'make', label: 'Make', live: true },
  { id: 'versions', label: 'Versions', live: false, feature: 'F-055' },
]
