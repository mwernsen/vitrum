# F-050: SVG import

|                |                                      |
| -------------- | ------------------------------------ |
| **Phase**      | 5 — Power features                   |
| **Status**     | draft (expand before implementation) |
| **Depends on** | F-011, F-020                         |
| **Complexity** | L                                    |

## Summary

Import SVG files from Illustrator/Inkscape/Affinity and convert paths into editable
lead lines (Diafane parity). Designers often sketch elsewhere; this is the on-ramp.

## Scope

- Parse SVG paths (lines, cubic/quadratic béziers, arcs → converted to béziers per
  F-010's decision), apply transforms, map document units (respect width/viewBox;
  offer a scale dialog when units are ambiguous).
- Import dialog with preview, target scale, and options: treat strokes as lead lines,
  ignore fills, flatten groups.
- **Healing pass** (the hard part): imported art is never a clean network — snap
  near-coincident endpoints together (tolerance slider with live preview of resulting
  piece count), split intersecting paths at crossings, drop zero-length/duplicate
  segments. Report what was healed. Without this, piece detection yields garbage.
- Round-trip contract with F-043's linework SVG export (shared test suite).

### Non-goals

- Raster autotrace (bitmap → vectors). Glass Eye Pro Plus has it; genuinely useful
  with F-051, but a separate hard feature → backlog `F-059 autotrace`.
- Text-to-path, gradients, clip paths (drop with a notice).

## Functional requirements (sketch — refine at expansion)

- FR-1: Reference files exported from Inkscape and Illustrator import with correct
  geometry and scale.
- FR-2: Healing produces a network where piece detection finds the visually apparent
  regions on curated messy fixtures.
- FR-3: Import is one undo step.
- FR-4: F-043 linework export → import round-trips the network exactly.

## Open questions

1. Healing tolerance UX: single slider vs staged review? Needs a design pass.
