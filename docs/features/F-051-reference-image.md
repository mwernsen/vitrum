# F-051: Reference image underlay & perspective correction

|                |                                      |
| -------------- | ------------------------------------ |
| **Phase**      | 5 — Power features                   |
| **Status**     | draft (expand before implementation) |
| **Depends on** | F-003                                |
| **Complexity** | M                                    |

## Summary

Load a photo or scan under the drawing to trace over (Diafane parity): opacity
control, scaling to real dimensions, and 4-corner perspective correction so a photo
of an existing window taken at an angle becomes a straight-on template — the
restoration workflow.

## Scope

- Image layer(s) below content: place, move, scale, rotate, lock; per-layer opacity
  and desaturate toggle; show/hide.
- **Scale calibration**: user marks two points on the image and types the real
  distance (essential for restoration work).
- **Perspective correction**: drag four corner handles to the corners of the window
  in the photo; image is rectified to a user-given rectangle (homography, GPU-sampled).
- Images embedded in the project file (drives the F-002 zip-container decision),
  downscaled at import with a size cap.
- Excluded from all outputs (print/export) by default; optional inclusion in PDF
  for client presentations.

## Functional requirements (sketch — refine at expansion)

- FR-1: Calibrated image: distances measured on the image match reality through the
  viewport's units.
- FR-2: Rectified image is visually correct for a reference photo fixture (known
  building window shot at an angle).
- FR-3: Layer ops are undoable; file round-trips embedded images.
- FR-4: A 4K underlay does not break the F-003 interaction budget.

## Open questions

1. Multiple simultaneous reference layers in v1, or single? (Proposal: multiple,
   it's nearly free once one works.)
