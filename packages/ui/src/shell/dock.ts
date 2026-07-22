// The docked side panel (Portal cockpit, turn 3) has one home per feature area. The activity
// rail is the *sole* switcher — clicking a rail icon swaps what's docked, there are no tabs.
// Today "layers", "glass", "rules" and "make" are backed by completed features (F-003/012/013/021/
// 022/023/030/040/042); "make" hosts piece numbering (F-040) and the live cutting list / BOM table
// (F-042). All outputs (print, SVG/PDF/DXF, cutting list export, PNG) route through the single
// Export dialog opened from the top bar (F-043), not the dock. "versions" is a placeholder (F-055).
export type DockSection = 'layers' | 'glass' | 'rules' | 'make' | 'light' | 'versions'

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
  { id: 'light', label: 'Light', live: true }, // F-054 sunlight simulation
  { id: 'versions', label: 'Versions', live: false, feature: 'F-055' },
]
