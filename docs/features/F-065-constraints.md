# F-065: Parametric constraints

|                |                     |
| -------------- | ------------------- |
| **Phase**      | 5 — Power features  |
| **Status**     | draft               |
| **Depends on** | F-010, F-012, F-013 |
| **Complexity** | XL                  |

## Summary

The one CAD capability Vitrum claims but does not have: relationships between entities
that **persist through editing**. Today a right angle is right only until someone drags
the node next to it; "these twelve spokes are equal" is a fact about the moment they were
drawn, not about the design. This feature adds a constraint model on the document, a
numeric solver that re-establishes those relationships after every edit, and the UI to
apply, inspect and diagnose them — the sketcher half of what FreeCAD's PlaneGCS or
SolveSpace do, scoped to a lead-line network.

Snapping (F-012) already gets geometry _into_ position; constraints are what keep it
there. The two are complementary and the seam between them matters: snapping is
construction-time, constraints are durable.

## User story

As a stained glass designer, I want the relationships I care about — this border is a
constant 12 mm wide, these spokes are equally spaced, the arched top stays tangent to the
side rails, this leaf is a mirror of that one — to survive every subsequent edit, so that
reworking one part of a panel does not silently break the parts I already got right, and
so that I can change one dimension and let the design follow.

Concretely, in a workshop: a lancet head whose arc must stay tangent to both rails so the
came bends fair; a rose window whose radial ribs must stay at exactly 30° so the
repeated pieces are actually interchangeable; a border whose inner line must stay
parallel to the frame at the width the customer bought.

## Scope

### Constraint model (document)

- `Project.constraints`: a keyed record of constraints, each referencing entities by
  stable id (`NodeId` / `SegmentId`). Persisted intent only — solved positions live in
  the geometry, as always. Schema bump with a migration seeding `{}`.
- Constrainable entities in v1: **nodes**, **line segments**, **arcs**, and
  **construction guides** (lines and circles — constraining against construction geometry
  is the classic CAD workflow and F-012 already stores it). Cubic béziers participate
  only through their endpoint nodes and endpoint tangency; their handles stay free-form.
- **Coincidence is not a constraint.** Two endpoints are welded exactly when they name
  the same `NodeId` (F-013's structural invariant), so the solver never emits coincidence
  equations and cannot tear a junction. This is a real advantage over sketchers that
  model coincidence as an equation, and it shrinks every system.

### Constraint catalog (v1)

Geometric (no value):

1. **fix** — pin a node in place
2. **horizontal** / **vertical** — a line, guide, or node pair
3. **parallel** — two lines/guides
4. **perpendicular** — two lines/guides
5. **collinear** — two lines/guides
6. **equal** — equal length (two lines) or equal radius (two arcs/guide circles)
7. **point-on-curve** — a node lies on a line, arc or guide
8. **tangent** — line–arc and arc–arc, both the "meeting at a shared node" and the
   "distant" form; this is the one that makes arched heads and flowing came look right
9. **concentric** — two arcs/guide circles share a centre
10. **symmetric** — two nodes mirrored about a line or guide

Dimensional (carry a value, edited numerically in the inspector):

11. **distance** — node↔node, or node↔curve (perpendicular)
12. **length** — a line's length
13. **angle** — between two lines/guides
14. **radius** — an arc or guide circle

### Solver

- Pure, model-free numeric core in a new `packages/solve` (`@vitrum/solve`), the way
  `@vitrum/drc` and `@vitrum/nest` are separate packages: residual functions + analytic
  Jacobian + a damped least-squares (Levenberg–Marquardt / dogleg) iteration, plus rank
  analysis for degrees-of-freedom and conflict reporting.
- **Minimal-displacement solving.** A stained glass panel is overwhelmingly
  under-constrained and always will be — free-form curve is the point of the craft. The
  solve therefore minimises movement from the pre-edit state (weak regulariser toward the
  current values; the dragged entity pinned hard during a drag), so unconstrained degrees
  of freedom never wander. Deterministic and repeatable is a hard requirement, not a
  nice-to-have.
- **Locality.** Constraints induce a graph over entities; a solve touches only the
  connected component(s) containing the edited entities. Everything outside is frozen.
  A 3,000-segment panel with one 20-constraint rose window pays only for the rose window.

### Interaction & UI

- Apply constraints from the inspector: a row of actions enabled/disabled by what is
  selected (select two lines → parallel, perpendicular, equal, angle are live). Keyboard
  shortcuts for the common four (H, V, P for parallel, ⊥ for perpendicular — exact keys
  in the design pass, they must not collide with the F-011 tool shortcuts).
- A **Constraints** subsection in the **Draw** dock: the list of constraints on the
  document (or on the selection), each row showing its kind glyph, its entities, and for
  dimensional ones an editable value; hover highlights the entities on canvas; delete per
  row. Plus the DOF readout — "12 degrees of freedom" / "fully constrained" — which is
  how a CAD user reads the health of a sketch at a glance.
- Canvas overlay glyphs per constraint near their entities (∥, ⊥, =, the tangency mark),
  toggleable through the existing Overlays chip. Tokened, overlay layer, not part of any
  output.
- **Drag solves live**: dragging a constrained node re-solves each frame and the rest of
  the component follows under the cursor.
- **Editing a dimensional value re-solves** — this is the parametric payoff: type 14 into
  the border-width constraint and the border moves.
- Conflict/redundancy reporting: adding a constraint that cannot be satisfied is refused
  and names the constraints it fights with.
- Optional **auto-constrain on snap** (default off, a switch in the Draw dock): when the
  snap engine lands a point on a curve or aligns to horizontal/vertical, record the
  corresponding constraint. SolidWorks' "automatic relations". Off by default because
  silently accumulating constraints is how sketches become unsolvable.

### Non-goals

- **Dimension annotations and named parameters** — printable dimension objects with
  witness lines and arrowheads, named variables, expressions between them
  (`border = frame/8`), and panel-size-driven resize. Deferred to **F-066**, which is
  where the "change one number, the whole window adapts" story lands. F-065 provides the
  solver and lets dimensional constraints be edited numerically in the inspector; it does
  not draw them on the cartoon.
- Constraints on bézier interiors (curvature, G2 continuity between spans). Endpoint
  tangency only.
- Auto-repair of over-constrained systems ("which constraint should I delete?" beyond
  naming the conflicting set).
- Constraints across documents, or between a panel and a library motif.
- 3D or assembly constraints.

## Design

Lives in the **Draw** dock section (F-001 Cockpit v2 IA — Draw already owns the geometry
aids: tools, snapping, symmetry, tracing), as a **Constraints** subsection below the snap
controls: the constraint list, the DOF readout, the auto-constrain switch. The
apply-constraint actions live in the **Inspector** alongside the existing F-013 selection
editor, since they act on the selection.

Built from `components/core` primitives (`Button`, `Input`, `Select`, switch rows),
tokens only, sentence-case copy, values in Geist Mono. Canvas glyphs use the semantic
overlay tokens on the overlay layer, read via `getComputedStyle` per the F-003 canvas
learning, with the paper-halo treatment F-012's snap markers and F-040's piece numbers
use (constraint glyphs land on dark came constantly). Conflicts use the DRC error token,
not a new colour.

All net-new UI — note for back-port to the Claude Design project.

## Functional requirements

- **FR-1** — Every catalog constraint is applicable, solvable and persisted; after a
  solve, each satisfied constraint's residual is < 1e-6 (mm for distances, rad for
  angles).
- **FR-2** — A solve is **minimal-displacement and deterministic**: identical input
  produces bit-identical output, and entities in the component that are not implicated by
  the constraint do not move beyond what the constraint requires. (Test: constraining one
  line horizontal in a 50-segment welded network leaves every unrelated node exactly
  where it was.)
- **FR-3** — Dragging a constrained node holds 60 fps for a constraint component of 200
  entities / 400 constraints; a frame whose solve does not converge within the iteration
  budget reverts to the last converged state rather than showing broken geometry.
- **FR-4** — Solving is **local**: only the constraint-graph component(s) containing the
  edited entities are solved. Adding 3,000 unconstrained segments to the document does
  not measurably change solve time.
- **FR-5** — Editing a dimensional constraint's value re-solves and the geometry honours
  the typed value exactly (typed 12.5 → measured 12.5 mm ± 1e-6), as one undo entry.
- **FR-6** — Adding a constraint that is inconsistent with the existing set is **refused**
  with a message naming the constraints it conflicts with; the document is unchanged.
  Redundant-but-consistent constraints are accepted and flagged as redundant.
- **FR-7** — The DOF readout is correct for known systems: a free line reads 4; add
  horizontal → 3; fix both endpoints → 0 and "fully constrained".
- **FR-8** — Constraints round-trip through save/load; add, remove, value-edit, and any
  constraint-solving geometry edit are each exactly **one** undo entry, and undo restores
  the prior geometry bit-identically (solved positions are materialised in the command,
  not re-derived on redo — the F-013/F-020/F-052 pattern).
- **FR-9** — Cascade: deleting a segment or node deletes every constraint referencing it,
  in the same undo entry. A saved document never contains a constraint pointing at a
  missing entity.
- **FR-10** — A constrained arc never silently demotes to cubics (F-013's demotion would
  destroy tangency and radius constraints): a transform or node edit that would demote one
  is refused with an explanation, or resolved by moving the arc's own parameters instead.
- **FR-11** — Welded junctions survive every solve: F-013 FR-1 (no edit separates a
  shared node) still holds after any constraint solve, structurally rather than
  numerically.

## Technical guidance

### Package shape

New `packages/solve` (`@vitrum/solve`), dependencies `@vitrum/geometry` + `@vitrum/model`
(the `@vitrum/drc` shape). Keep the numeric core — residuals, Jacobian, the LM iteration,
rank analysis — strictly model-free inside the package so it is testable as pure math and
worker-ready; the `Project` → variable-vector binding is one adapter file. `packages/ui`
gets a `ConstraintController` at the same controller seam F-012's `SnapController` and
F-052's `SymmetryController` use — **no changes to the F-011 tool contracts,
`ResolvedPoint` or `ResolveContext`.**

### Variable model — the key decision

Node positions are the primary variables (x, y per node). Everything else is expressed
against them:

- **Arcs**: variables are centre (cx, cy) and radius r, with an implicit residual
  `|p − c| = r` for each of the arc's two endpoint nodes. Sweep angles are _derived_ from
  the endpoint node positions plus the stored winding flag, so model invariant I2 (node
  position bit-identical to the geometry endpoint) is preserved by construction, and no
  new geometry representation is needed. Winding is discrete and must be preserved, not
  solved.
- **Cubics**: handles are not variables unless an endpoint-tangency constraint touches
  them; otherwise they translate rigidly with their endpoint node, so a solve never warps
  free-form curve that the user did not ask it to touch.
- **Construction guides**: F-012 stores infinite lines as very long finite lines; the
  solver should treat a guide by its direction + through-point, not by its (arbitrary)
  stored endpoints, or a length-ish residual will fight the ±100 m representation.

### Solving

- Damped least squares (Levenberg–Marquardt), analytic Jacobian, sparse. The
  regularisation term toward pre-solve values is what makes the under-constrained case
  behave; weight it well below the constraint residuals so it never trades accuracy for
  stillness.
- DOF = (variables) − rank(J); conflicts come from the left null space of J — a
  dependency among rows that cannot be satisfied identifies the offending constraint set
  to name in FR-6. A sparse QR is enough; avoid a dense SVD on anything but small
  components.
- Convergence budget: iteration cap and a wall-clock cap, both configurable, both
  reported. Never loop unbounded on a live drag.

### Interactions with existing features (all of these will bite)

- **F-013 splitting / T-junction welding.** `planWeldedCommit` splits a target segment
  when a line lands on its interior. Constraints on the split segment need a transfer
  rule; proposed: **direction-type** constraints (horizontal, vertical, parallel,
  perpendicular, collinear, tangent-direction) duplicate onto both halves — both halves
  stay collinear so both remain true — while **measure-type** constraints (length, equal,
  distance to that segment) are dropped and reported as "removed by split" in the
  constraint list. Confirm with Mathieu (Open question 2).
- **F-052 symmetry.** Constraints live on the source network only; replicas are derived
  and carry none. **Bake** replicates constraints along with the segments — replica ids
  are derived (`${id}~sym${k}`), so the id mapping is mechanical and cheap. Without this,
  baking silently throws the design's relationships away.
- **F-030 DRC.** One new rule, `constraints-unsatisfied` (severity error), so the
  readiness meter cannot report a panel ready while its sketch is broken. Constraint
  health otherwise belongs in the Draw dock, not the Check queue — a conflict is an
  authoring problem, not a manufacturability one.
- **F-012 snapping.** Auto-constrain reads the snap hit that already exists
  (`SnapController.hit` carries the kind); no new detection code.
- **Outputs.** Constraints appear in no export, print or cartoon. F-066's dimension
  annotations will.

### Staging (an XL — do not attempt in one pass)

1. Solver core + catalog residuals, pure, with property tests. No UI.
2. `Project.constraints`, commands, cascade, migration, undo/redo determinism.
3. Inspector actions + Draw dock list + canvas glyphs + DOF readout.
4. Live drag solving, dimensional value editing, conflict reporting.
5. The interaction seams above (split transfer, bake replication, DRC rule,
   auto-constrain).

## Acceptance criteria

- **Solver (unit + property, `@vitrum/solve`)**: each catalog constraint solved from
  randomised starts to residual < 1e-6 (FR-1); determinism — the same system solved twice
  is bit-identical, and solving from a permuted constraint order gives the same result
  (FR-2); minimal displacement — unimplicated entities unmoved (FR-2); DOF correct on a
  table of hand-computed systems, including fully-constrained and over-constrained
  (FR-7); conflict detection names the right constraint set on a table of known-bad
  systems (FR-6).
- **Golden systems**: a checked-in fixture set (lancet head tangent to rails, 12-fold
  rose with equal angles, constant-width border) with expected solved geometry, run as
  golden tests — the `@vitrum/drc` golden pattern.
- **Bench, checked in** (the F-010 pattern): 200-entity / 400-constraint component solves
  within the frame budget (FR-3); a 3,000-segment document with an unrelated constrained
  component solves in the same time as the component alone (FR-4).
- **Model (unit + property, `@vitrum/model`)**: constraints round-trip through
  serialize/deserialize; the migration seeds `{}` on older files; add/remove/value-edit
  each invert exactly; a property test over random edit sequences asserts no dangling
  constraint refs and that undo-all restores the initial document exactly (FR-8, FR-9);
  welded-node integrity after solves (FR-11); constrained-arc demotion refused (FR-10).
- **Component (Testing Library)**: the inspector enables exactly the applicable
  constraints for a given selection; the Draw dock list renders kinds, values and the DOF
  readout; a conflicting apply shows the refusal message naming the conflict; copy is
  sentence case, values in mono, tokens only.
- **E2E (Playwright, one flow)**: draw two lines, constrain them perpendicular, drag one
  — the other follows and stays perpendicular (assert the measured angle); set a length
  constraint to 60 mm and assert the measured length; undo back through each step and
  assert the geometry returns.
- **Manual**: build a lancet head — two vertical rails, an arc tangent to both, a border
  line parallel at 12 mm — then drag the panel wider and confirm the head stays tangent
  and the border stays parallel at 12 mm.

## Open questions

1. **Buy vs build the solver.** FreeCAD's PlaneGCS compiles to WASM and is battle-tested,
   but it is **LGPL** and adds a WASM artefact to an Electron app whose other kernels are
   plain TS; SolveSpace's solver has the same shape of question. Hand-rolling LM +
   analytic Jacobians over this catalog is on the order of the F-010 offset work and
   keeps the stack pure TS, worker-friendly and debuggable. **Recommendation: hand-roll**,
   with a ≤1 day spike to confirm convergence behaviour on the golden systems before
   committing — the F-010 precedent. Mathieu decides, and confirms the licensing position
   for Vitrum's own distribution either way.
2. **Split transfer rule** (direction constraints duplicate to both halves, measure
   constraints drop with a report) — confirm, since it silently changes a user's document.
3. **Non-convergence behaviour**: revert the gesture (FR-3 as written, keeps the invariant
   "a saved document satisfies its constraints") versus SolveSpace's "let it be marked
   unsatisfied and shown in red". Recommendation: revert during drags, refuse on commit.
4. **Auto-constrain default off** — confirm.
5. **Is the F-065 / F-066 split right?** F-065 gives durable relationships and numeric
   editing in the inspector; F-066 gives printable dimensions, named parameters and
   parametric resize. The split is what makes F-065 shippable, but "change one number and
   the window adapts" — arguably the whole reason to want constraints — lands in F-066.
   If that story is the point, F-066 should be scheduled immediately after, not left in
   the backlog.
6. **Keyboard shortcuts** for the common constraints, given F-011's tool shortcuts already
   hold most single letters.

## Implementation notes

(Filled in by the implementing agent after completion: deviations, follow-ups.)
