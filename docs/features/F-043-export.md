# F-043: Export — SVG, PDF, DXF, cutting machines

|                |                        |
| -------------- | ---------------------- |
| **Phase**      | 4 — Production outputs |
| **Status**     | draft                  |
| **Depends on** | F-021, F-040           |
| **Complexity** | M                      |

## Summary

Get designs out of Vitrum for other tools and machines: SVG (design interchange +
Cricut-class cutters), PDF (sharing/printing elsewhere), and DXF (CAD interop,
professional plotters/waterjets). Completes milestone M4 (Diafane core parity).

## Scope

- **SVG export**, three flavors:
  - _Linework_: drawn lead lines as paths (round-trip target for F-050 import).
  - _Cut templates_: each piece's **cut contour** as a closed path, laid out either
    in-place or spread on a grid with numbers — the Cricut/Silhouette use case
    (Diafane parity). True physical units via width/height + viewBox in mm.
  - _Colored render_: filled pieces + lead strokes for web/portfolio use.
- **PDF export**: single-sheet full design at scale (or scaled-to-page with the scale
  factor printed), colored or cartoon — reuses F-041's pipeline.
- **DXF export**: linework and cut contours on separate layers (`LEAD`, `BORDER`,
  `CUT`, `REBAR`), polylines/arcs in mm — importable by AutoCAD-class tools and
  waterjet/plotter CAM software (Glass Eye Enterprise parity).
- Export dialog with per-format options, technique-aware defaults, and the same
  DRC warn-on-errors gate as F-041.
- Round-trip contract with F-050: exporting linework SVG and re-importing must
  reproduce the network (state this as a shared test they both own).

### Non-goals

- G-code/CAM post-processing for specific cutters (SVG/DXF is the interchange
  boundary). `.vitrum` project sharing (that's just the F-002 file; sharing flows in
  F-055). Raster image export beyond a simple PNG snapshot button (include the
  snapshot — it's cheap).

## Functional requirements

- FR-1: SVG output validates and opens correctly in Inkscape and Illustrator with
  physical dimensions intact (1 mm in file = 1 mm on their rulers).
- FR-2: Cut-template SVG paths are the technique-inset contours (F-021), closed and
  simple, one path per piece, numbered via `<title>`/label conventions cutters accept.
- FR-3: DXF opens in a reference viewer with correct layers, units and arc fidelity
  (arcs as DXF arcs where the source is an arc; béziers as fine polylines with
  documented tolerance).
- FR-4: All exports are deterministic (same doc → byte-identical output where the
  format allows) to keep them diffable/testable.

## Open questions

1. Which cutter should be the compatibility reference for cut-template SVG —
   does Mathieu (or a target user) own a Cricut/Silhouette to validate against?
