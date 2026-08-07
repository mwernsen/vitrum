# Autotrace fixtures (F-059)

## `cartoon-photo-workbench.jpg`

Mathieu's own cartoon, photographed on his bench 2026-08-07 and supplied as the reference
fixture for F-059. A landscape panel: orange sky, a sun, roof tiles, grass. 1500 × 2000,
downscaled from a 5712 × 4284 phone photo and rotated upright.

**This is deliberately a photo, not a flat scan**, because that is what a designer will
actually have. Everything awkward about it is the point:

- **Perspective and background.** The paper sits at a slight angle on a cluttered bench,
  with a tool and the photographer's leg in frame. The trace must run on an F-051 layer
  whose four-corner correction has already rectified and cropped to the paper — which is
  why F-059 depends on F-051 rather than taking a file of its own.
- **Hand annotations that must not become lead lines.** The drawing carries pencil piece
  numbers (1, 2, 3, 5, 6, 7, 10, 11 …) and Dutch colour notes — "Oranje lucht" (orange
  sky), "dakpannen" (roof tiles), "gras" (grass). These are marks on the artwork, not
  geometry.
- **Luminance, not size, is what separates them.** A "10" is about as large as a short
  lead segment, so a minimum-blob or minimum-length filter alone would either keep the
  numbers or delete real geometry. The marker is near-black and the pencil is mid-grey:
  the threshold between them is the mechanism that works. This cartoon is close to the
  ideal case for it — a fainter pen would be harder.
- **Graphite dust, smudges and stray construction lines.** The sheet has been used at the
  bench: long faint diagonals cross the design, and the area around the sun is heavily
  smudged. Global thresholding will not cope; adaptive (local) thresholding is not
  optional.
- **EXIF orientation.** The original was `orientation=upper-right`. `sips` strips the tag
  rather than baking it, so the first downscale came out sideways — the rotation is baked
  into these pixels and the file carries no orientation tag. Real phone photos do carry
  it, so the UI must honour EXIF when it rasterises an F-051 layer, or a trace arrives
  rotated.

**The fixture carries its own expected answer.** Mathieu numbered the pieces by hand
before Vitrum existed to do it (which is also the point of F-040), and the numbering runs
to at least 11 — so a correct trace, healed, should yield about that many regions. Confirm
the exact count with Mathieu before hard-coding it in a test; several digits are ambiguous
in the photo.

## Synthetic fixtures

To be added by the implementer per F-059's acceptance criteria: a thick straight stroke
(FR-1 centreline, not outline), and a drawn T and X (FR-2 junctions survive). Keep them
small and generated in code where possible, so the intent is legible from the test.
