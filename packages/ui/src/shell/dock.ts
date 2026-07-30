// The docked side panel (Cockpit v2). Sections are named after the *task* the maker is doing, not
// the feature that implements it: Draw, Glass, Check, Make, Cost, History. The activity rail is the
// sole switcher — clicking a rail item swaps what is docked, there are no tabs.
//
// "draw" owns the drawing tools (F-011), snapping (F-012), live symmetry (F-052) and the tracing
// underlay (F-051) — the geometry aids that used to be scattered across a floating palette, the
// status bar and the old Layers junk-drawer. "glass" is the palette + library (F-022/F-023).
// "check" is the design-rule queue (F-030/F-031). "make" is piece numbering (F-040) plus the links
// that open the bench outputs in the bottom drawer (F-041/F-042). "cost" is the estimate + quote
// builder (F-056). "history" is the version browser and sharing (F-055).
//
// Overlay visibility moved to the canvas "Overlays" chip, technique (F-021) to the top-bar document
// chip, and the cutting list / BOM / quote tables to the bottom drawer, where they get real width.
// The light simulation (F-054) and sheet nesting (F-057) are views, not sections — their controls
// live in the inspector alongside the view they belong to.
export type DockSection = 'draw' | 'glass' | 'check' | 'make' | 'cost' | 'history'

export interface DockSectionMeta {
  id: DockSection
  /** Label shown in the dock header and under the rail icon. */
  label: string
  /** Whether the section has live content today, vs. an "arrives with F-0XX" placeholder. */
  live: boolean
  /** For placeholder sections: the roadmap feature that will fill it. */
  feature?: string
}

export const DOCK_SECTIONS: DockSectionMeta[] = [
  { id: 'draw', label: 'Draw', live: true },
  { id: 'glass', label: 'Glass', live: true },
  { id: 'check', label: 'Check', live: true },
  { id: 'make', label: 'Make', live: true },
  { id: 'cost', label: 'Cost', live: true },
  { id: 'history', label: 'History', live: true },
]
