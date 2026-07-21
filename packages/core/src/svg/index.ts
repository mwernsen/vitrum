/**
 * SVG import (F-050): parse SVG from Illustrator/Inkscape/Affinity into editable lead lines, heal the
 * imperfect network so piece detection (F-020) finds the regions, and map document units. Pure and
 * DOM-free — it parses the SVG *string*, so it unit-tests in Node and stays out of `packages/ui`.
 */

export { parseXml, decodeEntities, type XmlElement } from './xml'
export { parseTransform } from './transform'
export { parsePathData, arcCommand, type PathGeometry } from './path'
export {
  parseLength,
  parseViewBox,
  resolveUnits,
  scaleForTargetWidth,
  type SvgLength,
  type SvgSizeInfo,
  type UnitResolution,
  type ViewBox,
} from './units'
export { parseSvg, scaleGeometries, type ParsedSvg } from './parse'
export { healNetwork, type HealResult, type HealSegment, type HealSummary } from './heal'
export {
  buildImportPreview,
  countPieces,
  readSvg,
  toDrafts,
  type ImportOptions,
  type ImportPreview,
  type SvgSource,
} from './import'
