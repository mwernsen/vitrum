import type { ToolId } from '@vitrum/core'
import Circle from 'lucide-svelte/icons/circle'
import Minus from 'lucide-svelte/icons/minus'
import MousePointer2 from 'lucide-svelte/icons/mouse-pointer-2'
import PaintBucket from 'lucide-svelte/icons/paint-bucket'
import PenTool from 'lucide-svelte/icons/pen-tool'
import Ruler from 'lucide-svelte/icons/ruler'
import Shapes from 'lucide-svelte/icons/shapes'
import Spline from 'lucide-svelte/icons/spline'
import Square from 'lucide-svelte/icons/square'
import SquareDashed from 'lucide-svelte/icons/square-dashed'
import Triangle from 'lucide-svelte/icons/triangle'
import Wrench from 'lucide-svelte/icons/wrench'

/**
 * Which layer a palette entry drives. The drawing tools (F-011/013) live on the tool controller;
 * paint and piece-select (F-023) on the paint controller; bars (F-032) on the reinforcement
 * controller. They are mutually exclusive, so the palette lights exactly one entry.
 */
export type ToolKind = 'draw' | 'paint' | 'pieces' | 'bar'

export interface ToolItem {
  /** The tool-controller id, for `kind: 'draw'` entries only. */
  id: ToolId | 'select'
  kind: ToolKind
  label: string
  /** The single-key shortcut this tool really has — empty when it has none (F-011: L/A/B/R/C/P/G). */
  key: string
  icon: typeof Minus
  /** One line saying what the next click does. Shown under the palette and in the status bar. */
  hint: string
}

/**
 * The whole palette in one list (Cockpit v2): drawing, painting and bars, in the order a maker
 * meets them. Cockpit v2 moved this out of a floating overlay into the Draw dock section, so the
 * hints have room to be read rather than hidden in tooltips.
 */
export const TOOL_ITEMS: readonly ToolItem[] = [
  {
    id: 'select',
    kind: 'draw',
    label: 'Select',
    key: 'Esc',
    icon: MousePointer2,
    hint: 'Click a line to select it. Drag to marquee-select.',
  },
  {
    id: 'line',
    kind: 'draw',
    label: 'Line',
    key: 'L',
    icon: Minus,
    hint: 'Click two points. Hold shift for 15° increments.',
  },
  {
    id: 'arc',
    kind: 'draw',
    label: 'Arc',
    key: 'A',
    icon: Spline,
    hint: 'Two ends, then pull the bulge.',
  },
  {
    id: 'bezier',
    kind: 'draw',
    label: 'Bézier',
    key: 'B',
    icon: PenTool,
    hint: 'Click to place, drag to curve.',
  },
  {
    id: 'rectangle',
    kind: 'draw',
    label: 'Rectangle',
    key: 'R',
    icon: Square,
    hint: 'Drag a rectangle. Hold shift for a square.',
  },
  {
    id: 'circle',
    kind: 'draw',
    label: 'Circle',
    key: 'C',
    icon: Circle,
    hint: 'Drag from the centre.',
  },
  {
    id: 'polygon',
    kind: 'draw',
    label: 'Polygon',
    key: 'P',
    icon: Triangle,
    hint: 'Regular polygon — scroll to change the side count.',
  },
  {
    id: 'border',
    kind: 'draw',
    label: 'Panel border',
    key: '',
    icon: SquareDashed,
    hint: 'Draws the outer came the panel sits in.',
  },
  {
    id: 'guide',
    kind: 'draw',
    label: 'Guide',
    key: 'G',
    icon: Ruler,
    hint: 'Construction guides snap but never cut.',
  },
  {
    id: 'select',
    kind: 'paint',
    label: 'Paint glass',
    key: '',
    icon: PaintBucket,
    hint: 'Click a piece to fill it with the selected glass.',
  },
  {
    id: 'select',
    kind: 'pieces',
    label: 'Select pieces',
    key: '',
    icon: Shapes,
    hint: 'Select whole pieces rather than lines.',
  },
  {
    id: 'select',
    kind: 'bar',
    label: 'Reinforcement',
    key: '',
    icon: Wrench,
    hint: 'Lay a reinforcement bar across the panel.',
  },
]

/** Just enough of each controller to resolve which palette entry is lit. */
export interface ActiveToolState {
  toolId?: ToolId | 'select'
  paintMode?: 'off' | 'paint' | 'select'
  barMode?: 'off' | 'draw'
}

/**
 * The lit palette entry. The paint and bar layers win over the drawing tool, because activating
 * either deactivates drawing — mirroring how the controllers actually behave.
 */
export function activeTool(state: ActiveToolState): ToolItem {
  const find = (kind: ToolKind, id?: ToolId | 'select') =>
    TOOL_ITEMS.find((t) => t.kind === kind && (id === undefined || t.id === id))
  if (state.paintMode === 'paint') return find('paint')!
  if (state.paintMode === 'select') return find('pieces')!
  if (state.barMode === 'draw') return find('bar')!
  return find('draw', state.toolId ?? 'select') ?? TOOL_ITEMS[0]!
}
