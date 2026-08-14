# F-064: Photorealistic render & light

|                |                    |
| -------------- | ------------------ |
| **Phase**      | 5 — Power features |
| **Status**     | done               |
| **Depends on** | F-053, F-054       |
| **Complexity** | XL                 |

## Summary

F-053 and F-054 shipped the render and light views "procedural-first", both pending a
gallery/visual pass with an expected tuning follow-up. Reviewing the result (Mathieu,
2026-08-14) the verdict is that **tuning is not enough**: the lead reads as 1990s grey
plastic and the glass does not read as glass at all, because the pipeline models a piece
as _a flat fill whose brightness is multiplied by noise_. That is painting, not lighting.

This feature replaces that with a **material model**: per-fragment surface normals and
relief lighting, thickness-aware transmission, structured multi-octave glass textures with
real hue variation, and lead/solder rebuilt as a lit metal profile with patina, solder
joints and a contact shadow into the glass. It also fixes the Light view, where an
additive haze currently erases the leaded lattice — the very thing that makes stained glass
read as stained glass.

## User story

As a stained glass designer, I want the Render and Light views to look like a photograph
of a finished, backlit panel — glass with visible surface relief and depth, a dark crisp
lead lattice with lumpy solder joints — so I can hand the image to a client and have it
sell the commission.

## Scope

Four thrusts against the shared F-053/F-054 WebGL2 pipeline
(`packages/ui/src/render/glass-gl.ts`, `packages/ui/src/light/light-gl.ts`, pure maths in
`packages/core/src/render/shading.ts`). Shared improvements apply to **both** views so the
two stay consistent.

### A. Glass material model — "make it read as glass"

The core of the feature. Today a piece is `litColor * vnoise()`; it becomes a lit surface.

- **A procedural height field per glass**, in world mm, layered (multi-octave fBm with
  domain warping) and parameterised per texture tag — replacing today's single
  `vnoise()` call.
- **Surface normals derived from that height field**, and **relief lighting** from them:
  this is what makes hammered and ripple glass _bend_ light instead of looking like dirt
  on a flat pane. The defining change of this feature.
- **Thickness-aware transmission**: colour deepens with optical path length
  (Beer–Lambert style) using the existing `Glass.thicknessMm` — no model change needed.
  Relief makes path length vary across a piece, which is where the depth comes from.
- **Front-surface Fresnel sheen**: a faint view-dependent reflection so glass reads as a
  glossy physical slab, with gloss derived from the existing `transparency`/`texture`
  tags (see resolved Open question 2).
- **Refractive offset**: light sampled through the slab is displaced by the surface
  normal scaled by thickness — the subtle lensing that sells relief.
- **Edge treatment**: a rim along each piece's cut edge (glass is optically thicker
  there), distinct from B's contact shadow.
- **Structured, per-family textures with hue variation — not just brightness.** Real
  streaky glass streaks _different colours_ together; today everything is one hue
  multiplied by grey noise. Per tag:
  - `streaky` — flowing domain-warped bands, anisotropic, with hue/saturation drift
  - `seedy` — actual round bubbles (distance-field discs) with bright refractive rims
  - `hammered` — a packed dimple lattice with real relief
  - `ripple` — parallel surface waves with relief
  - `granite` — fine high-frequency relief
  - `smooth` — near-flat with a faint rolling unevenness (antique glass is never optically flat)
- **Physical tiling scale** (mm-per-sheet) for optional user swatch photos, replacing
  today's piece-bbox UV space (the F-053 follow-up), so a photo texture is the same
  physical size on large and small pieces.

### B. Lead & solder material — "kill the 90s look"

- **A lit came profile**: cross-section relief → normal → shaded by the same light
  direction as the glass, instead of a fixed baked gradient.
- **Length-wise irregularity**: low-frequency variation so came is never a uniform
  extruded tube (the single strongest "90s render" tell after the old chrome ridge).
- **Oxidised patina**: mottled darkening, per finish — lead came vs. darker border vs.
  solder (silver/copper/black) stay visually distinct.
- **Solder joints at nodes**: lumpy blobs where lead lines meet, not mitred corners.
  Joint positions come from the lead-line network / piece detection, not from the ribbon
  geometry.
- **Contact shadow / ambient occlusion** where glass meets came: a narrow darkening band
  in the glass along every lead line. The biggest remaining "these are separate flat
  layers" tell.
- **Cast shadow**: came throws a slight directional shadow onto adjacent glass, offset by
  the light direction.

### C. Light-view compositing — "it must still look like stained glass"

Currently a bug, not just missing polish. In [`light-gl.ts`](../../packages/ui/src/light/light-gl.ts)
the scatter term is added at `* 3.4` over the sharp panel plus a broad halo, then
tone-mapped; the additive haze **washes out the glass and erases the black lead lattice**,
leaving a brown smudge.

- **The panel stays sharp.** Recomposite so glass detail and the lead lattice survive:
  the scattered field must not swamp the subject.
- **Rays read as light in the air**, strongest _outside_ the panel silhouette and
  attenuated across the glass, rather than a uniform blur over everything.
- **A crisp lead lattice on top** of the light effects — dark, sharp, unmistakable.
- **A constrained solar halo** instead of a panel-wide blob, and subtle atmosphere so the
  shafts have something to scatter in.
- The F-054 dark-stage mood and the ≥ 30 fps animation budget are both retained.

### D. Pipeline & mood

- MSAA anti-aliasing on the Render context. ✅ _(landed — see Implementation notes)_
- Gamma-correct linear compositing + filmic tone map in Render, matching Light. ✅
- Came de-chromed from a full-strength white specular ridge to a matte sheen. ✅
  _(superseded by B, which replaces the whole came shading model)_
- **Remaining:** a soft **bloom** around the brightest glass, and a **graded backlit
  surround** replacing the flat near-black wash, so a panel reads as glowing in a
  lightbox rather than floating on black.

### Non-goals

- **A full 3D scene** (modelled came geometry, true refraction, a camera, real volumetrics)
  — considered and **rejected** for this feature (Open question 1): the render is a
  head-on presentation view, so a material model buys most of the realism without a
  rewrite of both render paths. Revisit only if the material model proves insufficient.
- **Manufacturer catalog glass images** — stays with F-062 (data/licensing research).
  Realism here comes from procedural textures plus optional user photos (resolved Open
  question 3).
- Physically accurate path tracing, caustics, spectral/dispersion rendering (as F-054).
- The configurable room proxy / cast-light patch on a floor plane — remains an F-054 follow-up.
- Day-lapse GIF/video export — remains an F-054 follow-up.
- Authored per-glass gloss/roughness **fields** — gloss is derived from existing tags
  (resolved Open question 2); an authored field would ride with F-062.

## Design

Canvas content (glass, lead, the lit stage) is data-driven rendered document content,
exempt from the design-token rule per CLAUDE.md's canvas-boundary clause — this feature
lives almost entirely inside the two WebGL passes. Any **new control surface** follows
F-053's precedent: tokens only, hosted in the inspector's render/light view context
(Cockpit v2), one undo entry per change, flagged as net-new for back-port to the Design
project. Prefer believable fixed defaults over knobs (Open question 4).

## Functional requirements

- **FR-1 (glass reads as a lit surface):** a piece shows surface relief lit from the
  scene's light direction, a front-surface sheen, and colour that deepens with optical
  thickness. Hammered/ripple/seedy read as _relief_, not as brightness noise, and the six
  texture tags are distinguishable side by side.
- **FR-2 (transmission model preserved):** transparency classes stay visually distinct and
  monotonic clear → solid (F-053 FR-2 holds) after the thickness-aware model lands.
- **FR-3 (lead reads as dimensional metal):** came is lit from its own profile normal, is
  non-uniform along its length, carries patina, shows lumpy solder joints at lead-line
  nodes, and seats into the glass via a contact shadow. Lead, border and solder finishes
  (silver/copper/black) are visually distinct. No full-white specular ridge.
- **FR-4 (Light view reads as stained glass):** in the Light view the leaded lattice is
  crisp and dark and the glass retains its texture and saturation at all sun positions and
  halo settings; rays and halo are additive light _around_ the panel, never a haze that
  erases it. The dark-stage mood is retained.
- **FR-5 (mood):** the Render surround is a graded luminous field, not flat black, and the
  brightest glass blooms softly.
- **FR-6 (no perf regression):** F-053's design↔render switch < 1 s and F-054's ≥ 30 fps
  light animation on the reference panel are preserved. Every added effect is a bounded
  per-fragment cost or a single extra full-screen pass, with no per-frame allocation on the
  hot path.
- **FR-7 (parity & snapshot):** shared material work applies to both Render and Light; the
  F-043 PNG snapshot captures the upgraded look in both views.
- **FR-8 (persistence):** any new tunable persists on `RenderSettings` / `LightSettings`
  behind a schema-version migration (F-042 "persist tunable intent only, derive the rest"),
  seeded to a believable default on old files, one undo entry per edit.

## Technical guidance

- **Keep the CPU/GPU mirror invariant.** New terms in the reference model
  (`shading.ts`'s `litColor`/`TRANSMISSION`/`TEXTURE_PARAMS`, `light-gl.ts`'s `sunLit`)
  must exist as pure unit-tested functions in `@vitrum/core` _and_ in the mirroring GLSL —
  the F-053 discipline that stops GPU and CPU drifting. Add the new maths there:
  `heightField(tag, x, y)`, `surfaceNormal(...)`, `fresnel(...)`,
  `transmitThroughThickness(...)`. Display-only effects (bloom, tone map, contact shadow,
  the Light recomposite) may live shader-side only — state which is which in the notes.
- **Height field first, everything else derives from it.** Normal by finite differences of
  `heightField`; refractive offset from the normal × `thicknessMm`; relief lighting from
  N·L. One height function per tag keeps the texture work and the lighting work coupled
  rather than two systems fighting.
- **Hue variation needs the texture to modulate colour, not just a scalar.** Today's
  `textureModulation()` returns a single brightness multiplier — it needs to become (or be
  joined by) something returning a colour/normal pair, or the streaky glass will keep
  looking like grey dust on red.
- **Solder joints need topology, not geometry.** Ribbon strips do not know where lines
  meet; take node positions from the lead-line network / piece detection (F-020) and draw
  joints as a separate small pass.
- **Contact shadow** — the stencil even-odd fill carries no signed distance to the piece
  edge. Options: (a) redraw the came ribbons wider and dark _under_ the glass as an
  occlusion band; (b) a screen-space darkening pass keyed off the came mask; (c) a
  distance-to-edge attribute in the ribbon geometry. Pick the cheapest that reads right (FR-6).
- **Light recomposite (C)** is the cheapest big win in the feature — start here. Reuse the
  existing two-pass FBO scaffold (`ensureFbo`, `FRAG_RAYS`); the fix is compositing order
  and weighting, plus drawing the lattice after the scatter, not new machinery.
- **Bloom / graded surround (D)** are a full-screen pass; the Light view's FBO scaffold is
  the model, the Render view gains an equivalent cheap post pass. Reuse, don't reinvent.
- **New knobs** go on `RenderSettings` / `LightSettings` (`packages/model/src/types.ts`)
  with a schema migration and the `updateRenderSettings` / `updateLightSettings` pattern
  (self-inverting shallow patch, one undo entry).
- **Tuning is data.** `TRANSMISSION` and the per-tag parameters are constants; the unit
  tests assert _shape_ (distinct + monotonic), not exact values, so tuning stays green.
- **Watch the fragment-shader budget.** Multi-octave fBm with domain warping per fragment
  is the main new cost. Consider octave counts scaled by zoom, or baking height/normal
  maps per glass into a texture atlas once instead of evaluating noise every frame, if
  FR-6 comes under pressure.
- The GL path runs only in a real browser — exercise it in the E2E on the packaged
  `file://` build (the F-030 lesson); jsdom no-ops the renderer.

## Suggested sequencing

Ordered by visible payoff per unit of risk, so each step is independently reviewable:

1. **C — Light recomposite.** Cheap, and turns an unusable view into the showpiece.
2. **B — Lead & solder.** Kills the "90s" read; affects every render.
3. **A — Glass material model.** The largest and most valuable, and the one that needs the
   gallery loop most.
4. **D — Bloom & graded surround.** Final mood pass, once the subject is right.

## Acceptance criteria

- Core unit tests: the new pure maths (`heightField`, `surfaceNormal`, `fresnel`,
  thickness transmission, per-tag parameters) are unit-tested — height fields distinct per
  tag, normals unit-length and responding to relief, Fresnel monotonic in angle,
  transmission monotonic in thickness. Existing F-053/F-054 assertions (transmission
  distinct + monotonic, `litColor`/`sunLit` monotonic) still hold.
- Model tests for any new `RenderSettings`/`LightSettings` field: patch + undo + serialize
  round-trip, plus a migration test seeding the default on an old file.
- `render.spec.ts` and `light.spec.ts` E2E stay green (switch view, live edit, PNG
  snapshot), extended if a new persisted knob lands.
- FR-6 preserved structurally (bounded passes, no hot-path allocation); if a bake is
  introduced, note the memory cost.
- **Manual (Mathieu) — the gallery pass, which closes both F-053's and F-054's pending
  sign-offs:** glass reads as a physical relief surface with depth; the six texture tags
  read apart and streaky shows hue variation; lead reads as matte dimensional metal with
  believable solder joints and seats into the glass; the Light view shows a crisp leaded
  lattice with glowing glass, never a haze; the overall mood reads as a photo of a real
  backlit panel.

## Open questions

1. ~~Material model vs. full 3D scene?~~ **Resolved (Mathieu, 2026-08-14): material model,
   staying in the 2D projected pipeline.** A head-on presentation view does not need true
   3D; normals + relief + thickness get most of the realism without rewriting both render
   paths. 3D is recorded as a non-goal, revisitable if the material model falls short.
2. ~~Where does per-material gloss come from?~~ **Resolved: derive from the existing
   `transparency` / `texture` tags.** No `Glass` model change; an authored gloss/roughness
   field would ride with F-062.
3. ~~Where do realistic glass textures come from?~~ **Resolved (Mathieu, 2026-08-14):
   much better procedural textures + derived normal maps.** No licensing or asset
   dependency, and it covers all 60+ starter glasses immediately. Optional user-photographed
   sheets are supported through the existing per-glass `swatch` field (physical tiling, thrust
   A); manufacturer catalogs stay with F-062.
4. **Fixed look vs. new controls?** Recommendation: believable fixed defaults, with a
   slider only where dialling it is genuinely wanted (surround brightness/warmth is the
   likeliest candidate). Which, if any, new knobs do you want surfaced?
5. **Reference photos** — now optional rather than blocking, since v1 is procedural. Do you
   have reference photos of real glass and leaded panels to tune against, or should the
   implementer tune by eye against Diafane captures?
6. **Contact-shadow approach** — any preference among the options in Technical guidance, or
   leave it to the implementer to pick the cheapest that passes the gallery eye?

## Implementation notes

**Phase 1 — Render fidelity pass (landed on branch `render-fidelity-pass`, 2026-08-14).**
The low-risk subset of thrust D, taken first to see how far tuning alone would go — the
answer (it is not far enough) is what prompted this spec's rescope to a material model:

- `packages/ui/src/render/glass-gl.ts` only. Added `antialias: true` to the WebGL2 context;
  rewrote `FRAG_GLASS` to composite in linear light (`toLinear`/`toSrgb`) with a filmic tone
  map (`1 - exp(-col * 1.45)`) as a display transform — `litColor` unchanged, so the 384
  `@vitrum/core` tests stayed green; softened `FRAG_CAME` from a `0.6` white specular ridge
  to a thin matte sheen (`0.11` lead / `0.22` solder).
- Verified: `pnpm check` clean, `@vitrum/core` 384 tests pass, live Render view drives with
  no GL errors.
- **Review outcome (Mathieu):** the chrome tube is gone, but the came now reads as uniform
  grey putty and the glass still reads as a flat fill — hence thrusts A and B, which replace
  the came shading model and the glass fill model outright rather than tuning them.
  **Phase 2 — Thrust C, the Light recomposite (2026-08-14).** The scatter pass added a 64-tap blur
  of the emission buffer at `3.4x` over the sharp panel plus a panel-wide halo, then tone-mapped the
  sum, so the haze filled in the black lead lines and washed out the glass. The emission pass now
  writes a **coverage marker into the FBO's unused alpha** (1 glass, 0.5 came, 0 the cleared void)
  and the scatter pass weights by it — full ray strength in the air, 18% over glass, 4% over lead —
  so rays read as light in the air rather than a veil over the subject. The halo keeps F-054's
  bleed-through-lighter-pieces look by gating its glass contribution on the glass's own luminance, and
  its broad bloom term was narrowed (weight `0.5 → 0.28`, falloff `0.14 → 0.35`), which is what made
  it read as a panel-sized smudge. No new render target and no extra pass, so FR-6 is untouched.
  Verified in the browser across sun positions and halo settings, including the old worst case
  (halo 100%, concentration 0%).

**Phase 3 — Thrust B, lead & solder, tuned to a reference photo (2026-08-14).** Mathieu supplied a
photo of one of his own leaded panels, which corrected two assumptions:

- **Came is near-black, not mid-grey.** `LEAD_RGB` 0.11 / `BORDER_RGB` 0.075, and the solder
  finishes dropped to roughly half their old values. Backlit came is a silhouette.
- **A soft contact shadow would be wrong for the Light view.** An H-profile came's flange covers
  the glass edge, so backlit you get a **hard** boundary, not a gradient — so the AO/contact-shadow
  bullet of thrust B is _not_ implemented, and open question 6 is answered by the reference rather
  than by a choice of technique. It may still suit the Render (lightbox) view; left in scope there.
- `FRAG_CAME` rewritten: a shallow crown in a narrow dark range, low-frequency **width wobble**
  along the run with a feathered edge (came is now drawn with blending so it anti-aliases into the
  glass), oxidation **patina** mottling, and the sheen cut to 0.055 lead / 0.16 solder.
- **Solder joints** at lattice nodes: `render/joints.ts` derives them purely from came endpoints
  (any position shared by ≥ 2 runs; interior vertices are curve detail, lone ends are unsoldered),
  carrying the widest came's width _and kind_ — so a lead panel's joints are lead-dark and only foil
  seams get bright solder. Drawn as a lumpy angle-perturbed dome, seeded per world position so no two
  match, at 1.12× the came half-width. The Light view stamps the same joints as **disc occluders**, so
  the lattice has no pinholes at its nodes for rays to leak through. 8 unit tests.
- **Texture retuning + better noise.** The photo shows blotches ~5–15 mm across and far stronger than
  the shipped values, so frequencies dropped to ~0.1/mm and amplitudes roughly doubled. That exposed a
  latent flaw: single-octave value noise shows its **integer lattice as soft squares** at visible
  amplitudes. Replaced by three-octave fBm with a domain warp (`gnoise`), added identically to both
  fragment shaders **and** `@vitrum/core`'s `textureModulation`, preserving the CPU/GPU mirror
  invariant. `smooth` stays flat: kind 0 short-circuits in both, so an amplitude there would be inert —
  its faint unevenness is deferred to thrust A with the height-field branch.

**Phase 4 — Thrust A (glass material model) and the rest of D (2026-08-14).** The reframing that
carries the feature: a texture tag is now a shape of **surface**, not a shape of brightness, and one
height field drives everything downstream so the terms cannot disagree.

New pure maths in `@vitrum/core/render/shading.ts`, each mirrored verbatim in both fragment shaders
(28 unit tests in `surface.test.ts`):

- `heightField(tag, x, y)` — the surface, 0..1, in world mm. Hammered is ridged noise (rounded
  hollows, not hills), seedy is proud round bubbles, streaky is anisotropic bands, ripple is waves,
  granite is fine grain, and **`smooth` finally gets its faint long roll** — the deferred item from
  phase 3, now possible because the height branch exists in CPU and GLSL together.
- `surfaceNormal(...)` — forward differences, three height evaluations rather than five, because the
  field is multi-octave noise and this is per-fragment (FR-6).
- `pathRatio` + `pathDepthFactor` — Beer–Lambert. A tilted surface lengthens the optical path, so
  relief reads as varying colour **depth** rather than varying brightness, and thickness comes from
  the existing `Glass.thicknessMm` with no model change. Applied _relative_ to a 3 mm reference so
  `ratio === 1` reproduces `litColor` exactly and the F-053 reference stays the nominal case.
- `fresnelSheen` — Schlick. Head-on the glass reflects ~4%; where relief tilts it away reflectance
  climbs steeply, putting glints on dimple edges and ripple crests. The strongest single cue that a
  surface is glass and not backlit paper.
- `hueDriftMultiplier` — warm and cool pushed in _opposite_ directions by one low-frequency field, so
  a piece drifts between two tints of its own colour instead of just dimming. Streaky drifts most.
- `surfaceParams(tag, transparency)` — relief depth, gloss, hue drift and normal step. Gloss is
  **derived** from the tag and the transparency class (denser glass scatters rather than reflects), so
  open question 2 is settled without a `Glass` field.

Thrust D completed alongside it, which required an architecture change: the render pass now draws into
an **offscreen linear-HDR target** (RGBA16F + stencil, mirroring the light renderer) and composites in
a second pass that adds **bloom** — ring taps at two radii above a highlight threshold, so bright glass
blooms and dark lead does not — then tone-maps. The flat near-black wash became a **graded surround**
centred on the panel. Swatch photos now tile at a **physical 240 mm** in world space rather than being
stretched to each piece's bbox (the F-053 follow-up). `sunLit`'s sheen is scaled lower than the render
pass's, since the light view then scatters it.

**Deviations.**

- **Edge refraction / rim is not implemented, and is dropped rather than deferred.** In a leaded panel
  the came flange covers every cut edge — the same photo finding that killed the contact shadow in
  phase 3 — so a rim on the glass would be hidden under the lead in all but pathological cases. Noted
  here rather than left as a phantom follow-up.
- **MSAA is lost on the render path** now that pass 1 draws into an FBO (multisample applies to the
  default framebuffer only). Acceptable because every glass edge sits under a came ribbon, and the came
  and joints feather their own edges through alpha. A multisample-resolve blit is the fix if it ever
  shows.
- **A feedback-loop bug worth remembering:** the composite leaves the scene texture bound to unit 0,
  and pass 1 then draws _into_ that texture. Because the glass shader carries a sampler, the driver
  detected a framebuffer/texture feedback loop and **silently dropped every glass draw** — the panel
  rendered as bare came with no fill, and nothing threw. Only a `GL_INVALID_OPERATION` console warning
  revealed it. Pass 1 now unbinds unit 0 first.

**Still open (recorded, not blocking).** With the haze gone, the panel is darker at some sun positions
because the old additive scatter was artificially brightening it; the `sunLit` gain curve is a
candidate for tuning. And the gallery pass itself is Mathieu's call — this feature closes F-053's and
F-054's pending sign-offs mechanically, but "believable" remains a human judgement.
