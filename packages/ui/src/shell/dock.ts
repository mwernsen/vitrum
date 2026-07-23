// The docked side panel (Portal cockpit, turn 3) has one home per feature area. The activity
// rail is the *sole* switcher — clicking a rail icon swaps what's docked, there are no tabs.
// Today "layers", "glass", "rules", "make" and "cost" are backed by completed features (F-003/012/
// 013/021/022/023/030/040/042/056); "make" hosts piece numbering (F-040) and the live cutting list /
// BOM table (F-042); "cost" hosts the cost estimate + quote builder (F-056). All document outputs
// (print, SVG/PDF/DXF, cutting list, PNG, quote PDF) route through the single Export dialog opened
// from the top bar (F-043), not the dock. "light" hosts the sunlight simulation (F-054); "versions"
// hosts the version browser and sharing (F-055).
export type DockSection = 'layers' | 'glass' | 'rules' | 'make' | 'light' | 'cost' | 'versions'

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
  { id: 'cost', label: 'Cost', live: true }, // F-056 cost estimation & quoting
  { id: 'versions', label: 'Versions', live: true },
]
