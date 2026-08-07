# F-059: Raster autotrace — scanned cartoons to lead lines

|                |                                                                 |
| -------------- | --------------------------------------------------------------- |
| **Phase**      | 5 — Power features                                              |
| **Status**     | in-progress — implementation complete, pending Mathieu's review |
| **Depends on** | F-050, F-051                                                    |
| **Complexity** | L                                                               |

## Summary

Scan a hand-drawn cartoon and get an editable lead-line network. Designers sketch on
paper; today the only route in is tracing over an F-051 underlay by hand. Autotrace does
that pass automatically: binarise the scan, reduce each drawn stroke to a **centreline**,
fit curves, heal the result, and merge it as one undoable edit. Glass Eye Pro Plus has
this; Diafane does not.

## User story

As a designer, I want to scan the cartoon I drew at the bench and have Vitrum turn it
into lead lines I can edit, so I don't redraw by hand what I already drew on paper.

## Scope

- **Input**: a raster already placed as an F-051 reference layer — so the image arrives
  perspective-corrected and **scale-calibrated**, and the trace lands at true mm. Trace
  the active layer; no separate file picker.
- **Preprocess**: greyscale, contrast, then binarise. Adaptive (local) thresholding, not
  a single global cut — scans of pencil on paper have uneven exposure across the sheet.
  Despeckle below a minimum blob size.
- **Centreline extraction**: skeletonise the binarised strokes (Zhang–Suen thinning or a
  medial-axis equivalent) so a 2 mm pencil stroke yields **one** line, not two edges.
  This is the core requirement and the reason outline tracers (potrace) are the wrong
  tool here — see Technical guidance.
- **Vectorise**: walk the skeleton into polylines, detecting junctions (T, X, Y) and
  endpoints so branches break at junctions rather than running through them. Simplify
  (Douglas–Peucker), then fit cubic béziers to the smooth runs with a tolerance control,
  keeping straight runs as lines.
- **Exclude annotations, don't recognise them.** A real cartoon carries pencil piece
  numbers and colour notes written on the artwork (see the reference fixture). They must
  not become lead lines. The mechanism is **luminance separation**, not size: a hand-written
  "10" is about as large as a short lead segment, so a minimum-blob or minimum-length
  filter alone either keeps the numbers or deletes real geometry. Bold marker is near-black
  and pencil is mid-grey, so the binarisation threshold is what does the work — which makes
  the threshold control the most important one in the dialog, and worth previewing as a
  binarised image rather than only as a piece count.
- **Heal**: hand the traced network straight to F-050's `healNetwork` — near-miss
  junctions, crossings, degenerate and duplicate segments are exactly what a traced
  scan produces. Do not write a second healing implementation.
- **Merge**: one `patchNetwork` compound command into the active project, exactly as
  F-050 does — one undo step, redo reproduces it.
- **Dialog** with live preview and controls: threshold, despeckle size, simplification
  tolerance, curve-fit tolerance, heal tolerance, and a **resulting piece count** so the
  designer tunes against the outcome that matters (the F-050 slider idiom). Plus an
  option to treat the outermost closed contour as the panel border (`role: 'border'`)
  rather than a lead line.

### Non-goals

- **Colour → glass suggestion.** Autotrace produces geometry; glass is assigned with the
  existing F-023 tools. Colour-to-catalogue matching needs a perceptual distance metric
  over the F-022 catalogue and is its own feature.
- **Tracing photographs of existing windows.** Lead has specular highlights, glass has
  texture and painted detail, and lighting varies across a panel — reliably beating a
  manual trace over an F-051 underlay is a research problem, not this ticket.
- **Colour-region tracing of arbitrary artwork** (posterise + boundary trace). A
  different algorithm, and it tends to emit hundreds of pieces that fail F-031/F-032.
- Handwriting/label recognition; tracing to anything but the active document.

## Design

No design exists in the Claude Design project. F-050's `ImportDialog.svelte` already
solves the same shape of problem — a preview, a tolerance slider, and a live piece count
— so **reuse it rather than inventing a second dialog language**: same layout, same
`Slider` primitive, same live-count affordance. Tokens only, `components/core`
primitives, sentence case, numbers in mono. The preview overlay (what was traced, what
was healed) uses design tokens; the traced document content is data-driven and exempt.
Note the dialog as a net-new screen for back-port, as F-050 did.

## Functional requirements

- FR-1 — **Centreline, not outline.** A stroke of non-trivial width yields exactly one
  segment along its centre. Verified on a synthetic fixture: a 6 px-wide straight stroke
  traces to one segment, not two, and its endpoints sit on the stroke's centre axis.
- FR-2 — **Junctions survive.** A drawn T and a drawn X each become welded junctions
  (branches meeting at one shared point), not overlapping run-through lines. After heal,
  F-020 reports no near-miss or dangling diagnostics on the clean fixtures.
- FR-3 — **True scale.** Tracing a calibrated F-051 layer produces geometry whose
  measured dimensions match the calibration within 1%. An uncalibrated layer is refused
  with a message pointing at F-051's calibration, rather than silently guessing a DPI.
- FR-4 — **Regions come out.** On the committed cartoon fixtures, piece detection finds
  the visually apparent regions (exact counts asserted per fixture). For
  `cartoon-photo-workbench.jpg` the target is the count Mathieu's own hand numbering
  implies — confirm it with him rather than fitting the test to whatever the code returns.
- FR-8 — **Annotations stay out.** On the reference fixture, no traced segment comes from a
  pencil number, a colour note, a stray construction line or a smudge, at the recommended
  threshold. Verified by asserting the traced segment count and that no segment lies inside
  the annotation regions (a small set of hand-listed boxes is fine).
- FR-5 — **One undo step.** A completed trace is a single history entry; undo removes all
  traced geometry and restores the prior document; redo reproduces it identically.
- FR-6 — **Deterministic.** Same image + same settings → identical output, so redo and
  the tests are stable.
- FR-7 — **Responsive tuning.** The live preview stays usable on a 2000×1500 scan:
  debounce recomputation on slider drag and keep the pipeline off the interaction path
  if a pass blocks (the F-050 lesson).

## Technical guidance

- **Buy vs build.** `potrace` is the obvious library and is the **wrong** one: it traces
  the _outline_ of a bitmap region, so a pencil line becomes a closed loop around the
  stroke. `autotrace` has a centreline mode but is an unmaintained C codebase. Expect to
  implement thinning + skeleton-walking ourselves (both are well-documented and modest);
  spike briefly and record the decision rather than forcing a library to fit.
- Keep the whole pipeline **pure and DOM-free** in `@vitrum/core` (alongside `svg/`, e.g.
  `trace/`) so it is unit-testable in Node and worker-safe: take pixel data in, return
  geometry. Rasterising the F-051 layer to pixels is the UI's job.
- Reuse: F-010 for curve fitting, F-050's `healNetwork` for healing, F-050's
  `patchNetwork` merge for FR-5. The pipeline is preprocess → skeletonise → walk →
  simplify → fit → **heal**, with healing owned by F-050.
- **The real fixture is already committed**: `packages/core/src/trace/fixtures/`
  `cartoon-photo-workbench.jpg` — Mathieu's own cartoon, photographed on his bench. Read
  that directory's README before starting: it documents the perspective, the annotations,
  the graphite smudging, the EXIF-orientation trap, and the fact that the drawing's own
  hand numbering (to at least 11) is the expected region count. Add the synthetic
  stroke/T/X fixtures for FR-1 and FR-2 alongside it.
- **Honour EXIF orientation** when rasterising an F-051 layer. Phone photos routinely carry
  it; ignoring it traces the panel sideways. (The committed fixture has the rotation baked
  in and no tag, so it cannot mask this bug — test it separately.)

## Acceptance criteria

- Unit (core): thinning on synthetic bitmaps; skeleton-walk junction/endpoint detection;
  curve fitting within tolerance; the full pipeline on each committed fixture with
  asserted segment and piece counts; determinism (FR-6).
- Component: the dialog's controls update the previewed piece count; an uncalibrated
  layer shows the calibration message (FR-3).
- E2E (Playwright): place a reference image, run autotrace, confirm pieces are detected,
  then undo restores the prior document in one step (FR-5).
- Manual (Mathieu): judge whether the traced reference cartoon is worth editing versus
  redrawing — the only test that decides if this feature earns its place. He supplied the
  fixture on 2026-08-07, so this is checkable from the start rather than at the end.

## Open questions

_None blocking. Two calls are delegated to the implementer — make them, and record the
reasoning in Implementation notes:_

1. Thinning algorithm and whether any library survives the spike above.
   → **Decided**: Zhang–Suen, implemented here; no library survives. See Implementation notes.
2. Whether the outermost-contour-as-border option defaults on or off (it is convenient
   and easy to undo, but it guesses at intent).
   → **Decided**: off. See Implementation notes.

## Implementation notes

_Implemented 2026-08-07 on `f-059-autotrace`. **Pending Mathieu's review** on two points he
reserved for himself: the FR-4 target region count (see "The FR-4 discrepancy" below) and the
manual judgement of whether the traced cartoon is worth editing._

### What shipped

- **`packages/core/src/trace/`** — the whole pipeline, pure and DOM-free: `binarise.ts`
  (Bradley–Roth adaptive threshold + an absolute luminance ceiling, despeckle, hole-fill),
  `thin.ts` (Zhang–Suen + non-redundant neighbour links), `skeleton.ts` (walk to polylines with
  junction clustering and spur pruning), `vectorise.ts` (Douglas–Peucker, corner splitting,
  line-or-curve), `trace.ts` (`traceBitmap`, `defaultTraceOptions`), `raster.ts` (world-aligned
  grid + homography resampling, so FR-3 is a pure property), `exif.ts` (orientation reader and
  the eight-case transform).
- **`packages/geometry/src/fit.ts`** — Schneider curve fitting (`fitCubics`,
  `isNearlyStraight`), the inverse of F-010's evaluation, with the reparameterisation kept
  strictly increasing (without that guard Newton collapses parameters and the fit "converges"
  while drifting off the points).
- **`packages/ui/src/trace/`** — `rasterise.ts` (the only DOM-touching part: decode the layer's
  stored bytes, resample through the layer's own `dstQuad → srcQuad`), `runner.ts` +
  `trace.worker.ts` (classic worker, sync fallback), `controller.svelte.ts`, `TraceDialog.svelte`.
- **Wiring** — an "Autotrace" section on the selected reference layer in `Inspector.svelte`
  (per-selection editing is the inspector's job), the dialog mounted in `AppShell.svelte`, and
  `runTrace()` merging via `segmentsFromDrafts` + `addSegments` — the same one-command route
  F-050 uses, so FR-5 holds for free.
- **`ReferenceLayer.calibrated`** (`@vitrum/model`, schema **v16 → v17**) — see FR-3 below.
- **F-051's `prepare.ts` now resolves EXIF orientation explicitly** — see "EXIF" below.

### Decisions on the two delegated questions

1. **Thinning: Zhang–Suen, written here; no library survives the spike.** `potrace` is the wrong
   tool as the spec says (it traces the _outline_, so a stroke returns as a loop around itself),
   `autotrace`'s centreline mode is an unmaintained C codebase with no usable JS binding, and the
   thinning options on npm are unmaintained wrappers of the same 40-line algorithm. Zhang–Suen is
   ~50 lines, deterministic, and symmetric because each sub-iteration decides against one snapshot.
   The part that actually needed care was not the thinning but the **neighbour test** used to walk
   the result: a plain 8-neighbour count reads every rasterised diagonal staircase as a chain of
   junctions and shatters the curve, so diagonal neighbours only count when neither bridging
   orthogonal pixel is ink (`thin.ts`, `neighbourLinks`).
2. **Outermost-contour-as-border defaults off.** It guesses at intent, and it guesses wrong on the
   common case — a cartoon drawn on a sheet whose panel edge is the sheet edge, i.e. the committed
   fixture. On is one click away and one undo back.

### The FR-4 discrepancy — 6 regions, not 11. Needs your call.

The trace closes **6** regions on `cartoon-photo-workbench.jpg`; your hand numbering runs to at
least 11. I did not fit the assertion to the code — the tests assert 6 _and_ pin down why:

- **Four or five of the missing regions are never closed on the sheet.** Their outer edge is the
  panel border, and the panel border is not drawn: the top strip ("Oranje lucht", 11) has no line
  along the top, the right-hand column (3 and its neighbour) has no right edge, and the
  bottom-left region (1) has no line along its bottom. `fixtures.test.ts` proves this rather than
  asserting it: adding the sheet outline closes exactly **one** more region — the whole open
  remainder as a single face — not five.
- **The sun (6) is drawn closed, but the photograph does not contain all of it.** The sheet is
  folded, and the circle's right-hand arc lies under the fold: it survives only as a faint grey
  imprint, at exactly the luminance of the pencil annotations. Recovering it would import the
  annotations with it, which FR-8 forbids. A second test sweeps the threshold to 120/130 and shows
  that extra ink only ever adds **slivers** (0–25 mm² against real regions of 3 500–8 000 mm²),
  never a substantive region.

So 6 is the honest answer for this photograph, and the shortfall is mostly a property of the
drawing rather than of the pipeline. Two things would move it: a photograph of the sheet
unfolded (recovers the sun → 7), and drawing the panel border on the cartoon. If you would rather
FR-4 read "the regions the drawn linework closes", say so and I will reword it.

### The three review points from the working tree

1. **`fflate` in `@vitrum/core` — kept, as a `devDependency`, justified in `fixtures/png.ts`.**
   The package's shipped runtime graph is still `@vitrum/geometry` alone; nothing in
   `src/index.ts` reaches `fixtures/`, and the only importer is a `*.test.ts`. It is already a
   runtime dependency of `@vitrum/model` (the `.vitrum` zip container), pure JS with no
   dependencies of its own, so it is not new to the workspace. The alternatives were worse: raw
   pixel data makes the fixture ~578 kB of bytes no reviewer can open (half the value of a real
   fixture is being able to look at it); an uncompressed-PNG variant needs bespoke tooling and is
   not what anything else writes; hand-rolling inflate is ~150 lines of fiddly, security-relevant
   code to avoid one test-only dependency.
2. **The reference photo is back to its committed bytes.** The previous run had patched its EXIF
   orientation tag in place (two bytes — hence identical size). Restored with
   `git checkout --`; `git diff` on it is now empty, and the derived variant stays under its own
   name. What the patch was working around is real and is now handled properly, below.
3. **The rectified fixture is now 980 × 980, the sheet's own resolution — not a downscale.** The
   paper's edges measure 968–1029 px in the photo, so 980 resamples without discarding linework;
   the marker stroke lands at **6.2 px**, matching FR-1's 6 px synthetic premise. 760 was worse
   than it looked: at 4.8 px of stroke a pencil digit falls **below the despeckle floor**, so the
   fixture passed FR-8 by _size_ rather than by luminance — precisely the mechanism the fixtures
   README says must not be what does the work. At 980 the annotations sit well above the floor,
   and the test that raises the threshold to 150 and watches them become geometry only works at
   this resolution. `fixtures/rectify.py` regenerates the file byte-for-byte from the photo, and
   the fixtures README carries the comparison table.

### EXIF orientation — resolved at F-051 import, not at trace time

The committed photo is a live specimen of the trap: upright pixels **and** a stale
`orientation = 6`. Two things follow.

- The requirement is not "always upright", it is **"the trace sees what the underlay shows"** —
  the user places the calibration and the four rectification corners on what they can see, so a
  trace that silently rotated relative to the underlay would be the same bug inverted.
- The only place the tag is still readable is import, before `prepareReferenceImage` re-encodes
  through a canvas. So that is where it is applied now: decode with `imageOrientation: 'none'`
  (never the decoder's default, which has changed across specs and engines), apply
  `orientRgba`, bake it into the stored asset. From then on the bytes carry no orientation
  question and the WebGL underlay and the trace rasteriser cannot disagree. Rotation happens
  after the downscale — same picture, up to 16 M fewer pixels moved. `rasteriseLayer` still reads
  the tag (identity for a prepared asset) so raw camera bytes arriving by some future route are
  oriented rather than traced sideways.

**This is a change to F-051's behaviour**, made deliberately: before it, the orientation of an
imported photo was whatever `createImageBitmap`'s default happened to be in the shipped Chromium.

### FR-3 — a new model field rather than a heuristic

FR-3 requires refusing an _uncalibrated_ layer, and nothing in the F-051 document could tell one
apart: a fresh layer is scaled to an arbitrary 300 mm on its longest edge, and a user may
legitimately calibrate a sheet to exactly 300 mm, so no quad heuristic is sound. Added
`ReferenceLayer.calibrated`, set by both of F-051's calibrating acts (the two-point ruler, and
the perspective correction — which asks for the window's real size). Schema **v16 → v17**
defaults existing layers to `false`, the conservative direction: the user re-measures once and
nothing traces at a scale Vitrum cannot vouch for. `rasteriseLayer` throws
`UncalibratedLayerError`; the inspector hides the trace button and says why.

### Other deviations worth knowing

- **Ids: none.** The pipeline's internal ids never leave `traceBitmap` — `TraceResult.segments`
  are `SegmentDraft`s (`geometry` + `role` only) and the document mints its own on merge. Asserted
  in both the core and the component tests, so F-050's offcut-id collision cannot recur here.
- **A worker, not just a debounce.** A full-sheet trace is ~200 ms at 980 px and ~600 ms at
  2000 px, which is too long to spend on the draw thread on every slider release. `runner.ts`
  mirrors F-057's nest runner: classic (IIFE) worker so Vite bundles a self-contained script that
  loads under `file://`, plus a permanent fallback to running inline the moment the worker proves
  unusable (the F-030 lesson). Slider drags are debounced at 180 ms and superseded results are
  dropped by sequence number.
- **The preview shows the binarised mask under the traced linework**, both through the same
  transform, so a line the threshold lost reads as bare ink with nothing on it. The spec asked for
  this and it earns its keep — a piece count alone cannot distinguish a lost line from a gained
  smudge.
- **Arcs.** The vectoriser emits lines and cubics only. A traced circle comes out as a chain of
  cubics rather than an `Arc`; fitting true arcs to a skeleton run is a different (and harder)
  estimation problem, and F-013 already demotes arcs to cubics when they are edited.

### Verified

`pnpm lint`, `pnpm format:check`, `pnpm check`, `pnpm test` (1342 tests) and `pnpm test:e2e`
(33 specs) all green from the repo root.

- FR-1 — `synthetic.test.ts`: a 6 px stroke traces to **one** segment on its centre axis, at
  widths 3/6/11/16; a 36 × 14 block thins to under a fifth of its pixels.
- FR-2 — a drawn T gives three branches meeting at one point; a drawn X gives four, and F-020
  reports no near-miss or duplicate diagnostics at the crossing, only the four free ends.
- FR-3 — synthetically, an 80 px stroke on a 0.5 mm/px grid measures 40 mm at the right offset; on
  the real fixture, the same pixels calibrated to twice the size trace to exactly twice the
  geometry (equal to nine decimals, against FR-3's 1%). The refusal path has a component test.
- FR-4 — see the discrepancy above: 6 regions, at the right centroids, with the shortfall
  explained by two further tests.
- FR-5 — the E2E: trace, then one undo returns the document to empty (and leaves the reference
  layer, which was placed by earlier commands).
- FR-6 — determinism on both the synthetic fixtures and the real cartoon.
- FR-7 — the worker + debounce, exercised for real by the E2E through the packaged `file://`
  build; a unit test asserts the worker request is structured-cloneable (it caught a real
  `$state`-proxy clone failure, which the sync fallback would otherwise have hidden).
- FR-8 — no traced segment enters any of 14 hand-listed annotation boxes at the recommended
  threshold; raising the threshold past the pencil puts them in. The component test does the same
  with a mid-grey stray line that becomes a third region.

### Pending Mathieu

- **The FR-4 target count** — 6 versus your numbering's 11, as set out above.
- **The manual judgement** (spec's own acceptance criterion): is the traced cartoon worth editing
  rather than redrawing? Open a panel, add the photo, rectify it to the sheet, and trace.

### Follow-ups discovered, out of scope

- **The trace cannot close what the sheet leaves open.** An "extend to panel border" or
  "close open ends against the border" action after the trace would turn the fixture's 6 regions
  into ~11 in one gesture. It is an editing feature, not a tracing one.
- **`ReferenceLayer.calibrated` deserves surfacing in F-051's own UI** beyond the layer-row meta
  chip added here — the layer list would read better with a "not calibrated" badge.
- **Arc recovery** (see above), if traced circles turn out to be annoying to edit as cubic chains.
- **Net-new screen for back-port**: `TraceDialog.svelte` is built in code in F-050's
  `ImportDialog` language (same layout, same `Slider`, same live-count affordance) and should be
  back-ported to the Claude Design project (`3c259295-607a-4eba-8cad-3890f7e80063`), along with the
  Inspector's "Autotrace" section.
