# F-052: Live symmetry

|                |                    |
| -------------- | ------------------ |
| **Phase**      | 5 — Power features |
| **Status**     | done               |
| **Depends on** | F-011, F-013       |
| **Complexity** | L                  |

## Summary

Draw one half (or one wedge) and see the whole design mirror live — Diafane's
signature feature for rose windows, lancets and medallions, extended CAD-style:
mirror across one or two axes, plus radial repetition (N-fold rotation) which
Diafane doesn't have.

## Scope

- Symmetry setup on the project: none / mirror (1 axis) / double mirror (2 axes) /
  radial N-fold (with optional mirror) around a center point; axes placeable and
  editable as construction-like guides.
- While active: drawing and editing happen **inside the source sector**; the source
  reflects/rotates live to every other sector. Replicas render live but are
  **read-only** in v1 (see Decisions §1 and Follow-ups).
- Replicated geometry is _derived_ until **bake**: an explicit "bake symmetry"
  command materializes replicas into ordinary segments (with weld-up at seams) for
  asymmetric finishing. Un-baked symmetric documents store only the source + setup
  (smaller files, always-perfect symmetry).
- Piece detection, DRC and outputs operate on the _full_ (replicated) network.
- Seam handling: geometry crossing the axis/sector boundary is coherent — see
  Decisions §4.

## Decisions (expansion pass, agreed with Mathieu 2026-07-22)

1. **v1 scope = source-only editing.** Draw and edit only inside the source sector;
   replicas render live but are READ-ONLY. Full "edit anywhere" (editing a replica
   maps back to the source) is DEFERRED to a follow-up ticket. Source-confinement is
   achieved by **canonicalizing pointers into source space at the existing F-011
   `PointerResolver` / F-012 `SnapController` controller seam** — no change to the
   tool contracts or to `ResolvedPoint` / `ResolveContext`.
2. **Replicas are pure derived output; the source is the only stored truth.**
   `Project.symmetry` (`@vitrum/model`) holds **setup only** — mode, center, primary
   axis angle, radial count, and the radial-mirror flag — mirroring how
   F-023/F-030/F-040/F-042 attach document state. Un-baked files store source + setup
   only. A **pure `@vitrum/core` transform** expands `outputSegments(source)` → the
   full replicated network (structural mirror/rotation, mirroring `Segment`/`Node`
   structurally like F-020 — no `core → model` edge). Piece detection (F-020), DRC
   (F-030) and all outputs consume the expanded network. No stored replica geometry.
3. **Undo (FR-1) is free.** Since replicas are derived, undoing the single source
   command removes all N replicas automatically — no special undo handling. Verified
   by a test.
4. **Seam handling leans on F-020 positional clustering** for the derived network
   (its 0.01 mm coincident-endpoint clustering makes piece detection see one coherent
   network with no near-miss at the axis — satisfies FR-2 without mutating the
   document). Explicit seam weld into shared anchors happens **only at bake**.
5. **Bake (FR-3)** reuses the same derive transform, materializes replicas into
   ordinary segments (deterministic per undo/redo — the concrete segments are minted
   once at command-construction and captured in the command closure, the F-013/F-020
   pattern), welds seams, and toggles the mode off, all as **one compound command =
   one undo step**. Baked output is geometry-equivalent to the derived replicas
   (asserted by sampling curve points, per the F-050 learning — arcs stay kernel
   arcs).
6. **F-013 / F-050 positioning (closes Open question #1):** F-052 symmetry is the
   persistent, live, document-wide setting; F-013 mirror stays a one-shot ad-hoc
   transform; F-050 import is unaffected. Complementary, not competing.
7. **UI home:** the existing symmetry placeholder in
   `packages/ui/src/shell/LayersPanel.svelte` becomes live (Portal turn-3 IA:
   document-wide toggles/technique live in the Layers panel — no new dock section, not
   the Inspector). Axes render/edit on-canvas as construction-like guides reusing
   F-012's guide + spatial-index infra. Radial N-fold config (N, optional mirror,
   center) lives in that same Layers symmetry section.

## Functional requirements

- **FR-1** — With 6-fold radial symmetry, drawing one line yields 6 live replicas (12
  with mirror); undoing the draw removes all of them together (one undo step).
- **FR-2** — The derived replica network is coherent at the seams: piece detection
  sees one connected network with no near-miss violations at the axis/center. On-axis
  source endpoints coincide with their sector images within the detection weld
  tolerance.
- **FR-3** — Bake is one undo step and produces geometry equivalent to the derived
  replicas (sampled curve points match within tolerance; arcs remain arcs).
- **FR-4** — Symmetry setup (mode, center, axis angle, radial count, mirror flag) is
  persisted on the project, round-trips through save/load, and each setup edit is one
  undo entry.
- **FR-5** — Drawing/editing is confined to the source sector: a pointer anywhere on
  the canvas is canonicalized into source space before it reaches a tool, so a gesture
  never authors geometry directly into a replica sector.

## Acceptance criteria

- [x] **Core transform (unit + property, `@vitrum/core`):**
  - `expandNetwork` / `expandReplicas` produce exactly the right multiplicity: mirror
    ×2, double-mirror ×4, radial-N ×N, radial-N+mirror ×2N (property over random
    source networks and N).
  - Each replica is a rigid image of the source: sampled curve points equal the
    transformed source points (property). Arcs stay arcs (reflection flips winding).
  - Determinism: expansion output is independent of input order and identical across
    repeated runs (stable derived ids).
  - Seam coincidence (FR-2): for a source endpoint on the axis/center, every sector
    image coincides within 1e-9 mm (property).
- [x] **Pointer confinement (unit, `@vitrum/core`):** `canonicalizeToSource` maps any
      world point into the fundamental domain for each mode; a point already in the source
      sector is returned unchanged; applying the mapped point through the symmetry group
      reproduces the original point's orbit (FR-5).
- [x] **Detection over the expanded network (unit):** a source touching the axis
      yields no `near-miss` diagnostics at the seam and the expected connected piece
      count (FR-2).
- [x] **Bake (unit + property, `@vitrum/model`):** bake is invertible (undo restores
      source + prior setup exactly); baked segment geometry samples equal to the derived
      replicas within tolerance; mode is `none` after bake (FR-3).
- [x] **Model (unit):** `setSymmetry` applies/inverts exactly; `symmetry` round-trips
      through serialize/deserialize; the v10→v11 migration seeds `mode: 'none'` on older
      files (FR-4).
- [x] **Component (Testing Library):** the Layers symmetry controls switch mode, edit
      radial count / mirror flag, and fire the bake action; copy is sentence case, numbers
      in mono, tokens only.
- [x] **E2E (Playwright, one flow):** enable 6-fold radial symmetry, draw one line
      (source count 1), bake (source count 6 — proving 6 replicas were derived), undo bake
      (back to 1), undo draw (0). Covers FR-1 and FR-3.

## Design

Lives in the **Layers** dock section (`shell/LayersPanel.svelte`), activating the
existing symmetry placeholder. Composed from `components/core` primitives, tokens
only, sentence-case copy, numbers in mono. On-canvas axes/center render as
construction-like guides (dashed, `--ink`/`--paper` leaf tokens read via
`getComputedStyle`, per the F-003 canvas-token learning) drawn on the overlay layer.
Net-new UI (the symmetry section controls) — note for back-port to the Claude Design
project.

## Open questions

_None — all resolved in the expansion pass above (Decisions §1–7). Open question #1
(F-013/F-050 interaction) is closed by Decision §6._

## Implementation notes

Delivered as specified; all quality gates green from the repo root (`pnpm lint`,
`format:check`, `check`, `test` — 926 unit/component, `test:e2e` — 25 including the new
`symmetry.spec.ts`).

- **Pure transform (`@vitrum/core/src/symmetry/`).** `symmetryTransforms` builds the
  ordered symmetry group (identity first); `expandReplicas`/`expandNetwork` replicate a
  structural `NetworkSegment` view (mirrors `@vitrum/model`'s `Segment` like F-020's
  `PieceSegment`, so **no `core → model` edge**). Replica ids are derived
  (`${id}~sym${k}`, node ids `${node}~sym${k}`), so per-sector welds hold by construction
  and the output is order-independent and byte-stable.
- **Arcs stay arcs (FR-3).** The kernel's `transformShape` refuses to reflect an arc, so
  `transformSymGeometry` reflects arcs analytically (reflected center, angles `2α − φ`,
  winding flipped) rather than demoting to cubics (the F-013 choice). Verified by sampling
  curve points, per the F-050 learning.
- **Seam handling (FR-2, Decision §4).** No document mutation for the derived network —
  the new `detectPieces`-over-expanded test builds a 4-fold rosette from one wedge and
  asserts 4 coherent pieces with zero `near-miss` diagnostics; F-020's 0.01 mm clustering
  welds the spokes. Explicit welding happens only at bake, via `segmentsFromDrafts`
  (coincident endpoints share a node, and replica endpoints landing on a source node reuse
  it).
- **Model (`@vitrum/model`).** `Project.symmetry` (`SymmetrySetup`, structurally identical
  to core's — kept in the model so it stays core-free), `setSymmetry` (patch, one undo
  entry), `bakeSymmetry` (one compound command: adds the welded replicas + sets
  `mode: 'none'`; invert removes exactly those ids and restores the prior setup; ids are
  captured in the closure so redo is deterministic — the F-013/F-020 pattern). Schema
  bumped 10 → 11 with a `migrateV10ToV11` seeding the inert default.
- **UI seams.** Expansion is centralised on `DocumentController` (`outputNetwork()` /
  `replicaNetwork()`), so piece detection, cut contours, DRC, BOM, print and export all
  consume the full network with one code path; the canvas renders replicas as read-only
  linework and the symmetry axes/spokes as dashed guides on the overlay. Pointer
  confinement (FR-5) is a one-line composition at the F-011/F-012 resolver seam
  (`snap.resolver(symmetry.canonicalize(world), ctx)`) — **no tool or `ResolvedPoint`
  change**. The Layers panel placeholder is now live (mode / axis angle / fold count /
  add-mirror / bake). Net-new UI: the Layers symmetry section — flag for back-port to the
  Claude Design project.
- **Drawing legibility (UX follow-up, Mathieu 2026-07-22).** Pointer confinement alone
  read as "the cursor is mirrored": while dragging in a replica sector the ghost showed
  in the source and only snapped into place on release. Two fixes, both display-only:
  (1) the source fundamental domain is shaded as a translucent wedge from the center
  (`drawSymmetryDomain`, matched to `canonicalizeToSource` — spans π / π/2 / 2π·N⁻¹ /
  π·N⁻¹), so the editable sector is unmistakable; (2) the live tool preview is mirrored
  into every replica sector (`SymmetryController.previewReplicas`, same transform group as
  the commit path) and drawn at half alpha, so drawing shows the full symmetric result
  live. Covered by `symmetry.svelte.test.ts` (domain spans + replica multiplicity /
  reflected geometry). The domain wedge was visually confirmed in `dev:ui`.
  - **Default center = world origin (0, 0)** (was panel/content center) — the predictable
    pivot a user expects, and where the grid axes already cross.
  - The **axes + center pivot now render in the accent (cobalt)** matching the source tint
    (`drawSymmetryAxes`), with a filled ringed center dot, so the active mirror/rotation
    line reads distinctly from grey construction guides. Mirror-mode axis-through-origin +
    tinted source half visually confirmed in `dev:ui`.
- **Housekeeping.** Ran Prettier on `README.md`, which was already failing
  `format:check` on `main` (pre-existing, commit 8c52ad6) so the gate could go green; no
  content change.

## Follow-ups (out of scope for v1)

- **Edit anywhere (deferred, agreed §1).** Editing a replica and mapping the change back
  to the source. v1 confines editing to the source sector; replicas are read-only. The
  canonicalization seam already folds pointers into source space — the follow-up adds the
  inverse mapping for hit-testing/selecting a replica and re-authoring the corresponding
  source geometry.
- **On-canvas axis/center dragging.** Axes render as guides and are editable via the
  Layers panel (angle, fold count, mirror) and seeded to the panel center; direct drag of
  the center/axis handles on the canvas (and snapping draw points _to_ the axis via the
  F-012 spatial index) is a natural next increment.
- **Bake weld tolerance.** Bake welds by exact coincidence + F-020 clustering; a
  tolerance-based weld pass at bake would tidy the ≤1 ulp gaps that non-axis-aligned
  reflections can leave between sectors before F-020 clustering absorbs them.
