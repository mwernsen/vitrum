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

### Glass inherits across replicas (2026-08-16, from user test [S2])

Closes finding **[S2]** of [docs/testing/runs/2026-08-16-a/F-052.md](../testing/runs/2026-08-16-a/F-052.md)
(SUMMARY issue 3): symmetry replicated linework but not colour, so a 4-fold border had to be painted
four times. See F-023's Implementation notes for the resolution-precedence details; the symmetry side
is recorded here.

- **The missing relation is a piece orbit, derived from segment ids.** `pieceOrbits`
  (`packages/core/src/pieces/orbits.ts`) returns `contentId(replica.ring) → contentId(source.ring)` —
  deliberately the same shape as F-020's edit lineage, so F-023's `resolveGeneration` composes the two
  rather than growing a second inheritance mechanism. It is **exact, with no geometric tolerance**:
  `expandReplicas` mints replica ids as `${id}~sym${k}`, the expanded network is invariant under the
  symmetry group, so a face maps to another face by shifting each boundary segment's sector index
  through the group's composition table (built by matching `compose(gⱼ, gₖ)` against the ordered
  transform list). A piece's orbit key is the smallest shifted signature; the one piece whose _own_
  signature is that minimum is the source the rest inherit from.
  - Why not the obvious "strip the `~symN` suffix": it misses pieces that **straddle a sector seam**,
    which is exactly the tested Art Deco border — a quarter-border's own reflection closes into one
    box spanning two sectors, and that box's image spans the other two. The orbit walk groups them;
    suffix-stripping would leave the user painting the top and bottom strips separately. Covered by a
    test.
  - Why not geometric matching (transform each centroid and look for a piece): it needs a tolerance
    and an area guard, and concentric pieces fixed by the group can collide. Ids are exact.
  - A piece that is its **own** image (astride the axis) is left ungrouped — an orbit of one needs no
    inheritance. An orbit whose signature minimum is claimed by two pieces does not inherit at all,
    rather than guessing.
- **Where it is wired:** `DocumentController.detect()` — the seam that already owns expansion — tags
  the generation with `DetectionResult.symLineage` (a new **optional** field; detection itself stays
  symmetry-agnostic and never sets it). Absent, and free, when symmetry is off. `AssignmentController`
  reads it off the detection result it already receives as the generation token, so **no shell change
  was needed** (`AppShell.svelte` is untouched — another agent held it for the centre work).
- **No schema change, no migration.** Assignments still store one glass per content id; replica colour
  is derived at resolution time and re-derives on a _cold_ detection, so a reopened symmetric file is
  coloured with nothing extra persisted. Saved files resolve exactly as before (a direct entry on a
  replica still outranks its source — see F-023 notes).
- **Painting a replica writes through to the source** (the user-visible semantic choice — flagged for
  Mathieu). `PaintController` routes every write (click, drag, bulk assign, fill-unassigned, unassign)
  through the orbit source and clears any stale direct entry on the orbit's other replicas, so the
  patch is still one command / one undo entry. Rationale: replicas are derived output and read-only for
  geometry (Decision §1), so making them read-only for colour too keeps one rule; the document stays
  minimal (one entry per orbit, matching "un-baked files store source + setup only"); and the invariant
  "with symmetry on, an orbit is monochrome" is provable, with no invisible per-replica state to
  diverge when the fold count or axis angle changes. To colour one sector on its own, **bake** first —
  the same escape hatch geometry editing already uses. The alternatives considered were (a) a local
  override on the replica and (b) refusing the paint outright; (a) leaves hidden state keyed to
  coordinates that the next setup edit invalidates, and (b) makes drag-paint across the panel fail
  silently.
- **Bake keeps the colours, with no new code.** The baked replicas re-key (bake mints new segment ids,
  and F-020 canonicalizes a ring's start span _by segment id_, so an unchanged region gets a new content
  id), but F-023's edit lineage maps each post-bake piece to its pre-bake self and carries the colour;
  the save-time normaliser then materialises them under their new keys. Asserted end to end in
  `packages/ui/src/glass/symmetryInheritance.svelte.test.ts` (paint → bake → same colours → save →
  four stored entries → undo bake → still coloured).
- **UI.** No new surface (the Draw panel was held by another agent). The piece inspector explains the
  rule when a replica is selected: "Its glass follows the source sector, so every sector changes
  together. Bake the symmetry to colour one sector on its own." Tokens only, sentence case. A matching
  hint line in the Draw dock's symmetry section is a follow-up.
- **Tests.** Core: `pieces/orbits.test.ts` (mirror / double-mirror / radial-N / radial+mirror
  multiplicity, straddling-seam orbits, self-image pieces, out-of-range sectors, plus fast-check
  properties for order-independence, "only genuine rigid images are paired" via area+perimeter, and
  orbit size ≤ group order) and `pieces/assignment.test.ts` (precedence). UI:
  `glass/assignment.svelte.test.ts`, `tools/paint.svelte.test.ts` (write-through),
  `glass/symmetryInheritance.svelte.test.ts` (integration incl. bake),
  `shell/Inspector.symmetry.test.ts`. E2E: `apps/desktop/e2e/symmetry-glass.spec.ts` — mirror on, draw
  a rectangle, one paint click, readiness reads "N of N painted", then save and reopen with the colour
  intact.

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

Discovered while wiring glass inheritance (2026-08-16), all out of scope for that change:

- **The save-time normaliser should skip replicas.** `normalizeAssignments` in `AppShell.svelte`
  materialises every live piece's effective glass, so a save now also writes one redundant entry per
  replica. Harmless (they equal the inherited value, and the next paint on that orbit clears them —
  covered by a test), but it bloats the file and breaks the "one entry per orbit" invariant until then.
  The fix is one line inside the loop: `if (assignments.isReplica(key)) continue`. Not applied because
  `AppShell.svelte` was held by the concurrent symmetry-centre work.
- **A hint line in the Draw dock's symmetry section** — "glass follows the source sector; bake to
  colour a sector on its own" — same reason (`DrawPanel.svelte` was held). The piece inspector says it
  today, which only helps once a piece is selected.
- **Piece numbering (F-040) has the identical keying problem.** `NumberingController` resolves through
  the same `resolveGeneration`, so replicas get no number and a renumber treats each sector as a
  separate piece. Passing the generation's `symLineage` through would make an orbit share one number —
  which is arguably what a cut list wants ("piece 7 ×4"), but it changes what F-042's BOM counts, so it
  needs a decision rather than a patch.
- **Per-piece texture placement (F-053)** is keyed by content id too, so a texture set on a replica is
  a local override that the orbit does not share. Same seam (`setPieceTextureTransforms`) if it should
  follow the source.
- **Geometry drawn exactly on a mirror axis degenerates.** A closed shape symmetric about the axis
  reflects onto itself, so the expanded network carries duplicate segments and detection returns _no_
  pieces for it (found while building the orbit tests; pre-existing, unrelated to glass). Worth a
  `duplicate-segment` DRC surface or a de-duplication pass in `expandReplicas`.

_Cockpit v2 (2026-07-30):_ the symmetry controls moved from the Layers panel into the **Draw** dock section. See the "Cockpit v2 rework" section of
[F-001](F-001-architecture.md) for the full shell IA.
