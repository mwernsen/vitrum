export interface Point {
  x: number
  y: number
}

/**
 * A single piece of glass in a panel. Vertices describe a closed polygon in
 * millimetres, listed in order without repeating the first point at the end.
 */
export interface GlassPiece {
  id: string
  label: string
  /** CSS color used for previews; real glass catalog data comes later. */
  color: string
  vertices: Point[]
}

export interface Panel {
  id: string
  name: string
  widthMm: number
  heightMm: number
  pieces: GlassPiece[]
}

function assertPolygon(vertices: Point[]): void {
  if (vertices.length < 3) {
    throw new Error(`A glass piece needs at least 3 vertices, got ${vertices.length}`)
  }
}

/** Area of a piece in mm², via the shoelace formula. Vertex order does not matter. */
export function pieceArea(piece: GlassPiece): number {
  assertPolygon(piece.vertices)
  let sum = 0
  const { vertices } = piece
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!
    const b = vertices[(i + 1) % vertices.length]!
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

/** Perimeter of a piece in mm — the length of lead came or copper foil it needs. */
export function piecePerimeter(piece: GlassPiece): number {
  assertPolygon(piece.vertices)
  let length = 0
  const { vertices } = piece
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!
    const b = vertices[(i + 1) % vertices.length]!
    length += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return length
}

/**
 * Total lead came length for a panel in mm. Shared edges are counted once per
 * piece for now; deduplicating shared borders is a later refinement.
 */
export function totalLeadLength(panel: Panel): number {
  return panel.pieces.reduce((total, piece) => total + piecePerimeter(piece), 0)
}
