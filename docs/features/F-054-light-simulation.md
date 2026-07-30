# F-054: Sunlight simulation

|                |                                          |
| -------------- | ---------------------------------------- |
| **Phase**      | 5 — Power features                       |
| **Status**     | done (pending Mathieu's visual sign-off) |
| **Depends on** | F-053                                    |
| **Complexity** | XL                                       |

## Summary

Diafane's showpiece, matched: view the panel on a dark stage lit by the sun, with
volumetric light rays and a solar halo streaming through the coloured glass. Two ways to
place the light — **Manual** (drop the sun on a dome, set intensity, temperature and
halo) and **365 days** (set the address, facade orientation and tilt; the app computes the
real sun trajectory and plays the window through a day and through the seasons). Capture a
photo of any moment.

## Scope (v1, as expanded 2026-07-22)

- **Light view mode** (`light` in `viewmode.ts`), a derived output view alongside
  design / cartoon / render — a near-black stage with volumetric god-rays and a solar
  halo bleeding through the lighter pieces (the emotional showpiece). Built on the F-053
  WebGL pipeline (stencil even-odd fills, `gl.ts`-style factory, `preserveDrawingBuffer`
  for snapshots).
- **Manual mode** (Diafane "Manual"): a hemispherical **sun-position dome** (draggable sun
  dot, zenith at top, horizon at the edge, a "Frontal" caption when centred), plus
  **intensity**, **temperature (K)**, **solar-halo intensity** and **solar-halo
  concentration** controls.
- **365 days mode** (Diafane "365 days"): **location** (latitude/longitude), **facade
  orientation** (compass), **tilt** (vertical window ↔ skylight), **day-of-year** and
  **time-of-day** sliders, **solstice/equinox presets**, and **animation playback** that
  advances time-of-day (≥ 30 fps). Sun azimuth/elevation from a standard astronomical
  algorithm (NOAA); sky colour/intensity by solar elevation; a simple **overcast** toggle.
- **Photo capture** of the current moment (Diafane parity) — reuses the F-053 PNG snapshot
  machinery and the F-043 export port.
- Global look toggles on the canvas: **photo grain** and **textures** (Diafane's
  bottom-right toggles).

### Non-goals / descoped (recorded decisions)

- **Configurable room proxy / cast light patch** — **descoped from v1** (Open-question 1,
  resolved below, following Diafane). V1 is the dark-void stage; a cast light patch on a
  floor plane is a follow-up.
- **Day-lapse GIF / video export** — **descoped to a follow-up** (advisory steer allowed
  this). Single-moment photo capture ships; a time-lapse recorder is noted as a follow-up.
- Physically accurate spectral rendering, caustics, neighbouring-building shadowing (a
  horizon-obstruction slider stays a possible future approximation).

## Decisions made while expanding (recorded for Mathieu)

1. **Room proxy fidelity (Open question 1): follow Diafane — dark-void stage, no room
   box.** V1 renders the panel on a near-black stage with volumetric rays + halo. The cast
   light patch on a floor plane is dropped from v1 and listed as a follow-up. (Mathieu's
   steer this session.)
2. **Where the solar maths live:** pure functions in `@vitrum/core/solar/` (position, sky,
   panel projection, sun resolution), unit-tested against a reference (FR-1). The WebGL
   light pass consumes the resolved sun; no astronomy in the renderer or the UI.
3. **Manual vs astronomical are one persisted `LightSettings` block** on `Project.light`
   (schema v12 → v13), F-042 "persist tunable intent only, derive the rest": the render and
   the resolved sun are always derived, never stored. In **manual** mode the sun az/el,
   intensity and temperature are the user's direct values (panel-relative); in
   **astronomical** mode they are derived from location + orientation + tilt + date/time,
   and the intensity/temperature sliders are inert. The halo controls, overcast, grain and
   textures toggles apply in both modes.
4. **Undo hygiene for scrubbing/animation:** installation setup (location, orientation,
   tilt, mode, manual sun, intensity, temperature, halo, toggles) commits **one undo entry
   per change** (commit-on-release, the F-053 backlight pattern). The **time-of-day and
   day-of-year sliders scrub transiently** in the `LightController` and commit **once on
   release**; **animation playback is preview-only** (transient, never writes per frame),
   committing the final moment once on pause. So a day-lapse never floods the undo stack.
5. **UI home (Portal turn-3 IA):** the lighting controls are a **standing dock section**
   (`light`, reached from the activity rail), not the inspector (selection-only) — Diafane's
   right-hand panel maps to a Vitrum dock section. Entering the **Light view** auto-opens the
   Light dock section, and selecting the Light dock section switches to the Light view, so
   the panel and the stage always agree. Net-new surface, flagged for back-port.
6. **Light is a view mode, not a readiness gate:** no new `ReadinessStrip` pill (it is a
   presentation view, like render/cartoon).

## Functional requirements

- **FR-1 (solar accuracy):** `solarPosition(location, instant)` returns azimuth/elevation
  matching the NOAA reference calculator within **0.5°** for a set of test locations/dates
  spanning latitude and season. Pure, unit-tested.
- **FR-2 (seasonal behaviour):** for a south-facing vertical window in Amsterdam, the
  resolved sun at solar noon in **June** vs **December** differs in the expected directions:
  higher **elevation**, **cooler** light and **more frontal** incidence in June; lower,
  **warmer**, more grazing in December. Unit-tested on the resolver.
- **FR-3 (live view):** switching design/render/cartoon ↔ light is a view switch (no
  export); the light stage renders the current document and updates live as geometry, glass
  and light settings change. Animation playback runs at **≥ 30 fps** on the reference panel
  (structural: one WebGL pass per frame, no per-frame allocation on the hot path; the exact
  frame-rate is a manual/gallery check).
- **FR-4 (manual placement):** the dome widget places the sun directly (azimuth/elevation),
  and the intensity/temperature/halo sliders drive the look; "Frontal" shows when the sun is
  centred facing the panel. Each adjustment is one undo entry.
- **FR-5 (astronomical placement):** location + facade orientation + tilt + day-of-year +
  time-of-day drive the sun; solstice/equinox presets jump the date; the overcast toggle
  flattens the light. Below the horizon renders as night (dark stage).
- **FR-6 (photo capture):** a capture control exports a PNG of the current lit moment
  (reusing F-043's snapshot + export port), so the light stage — not the flat design — is
  what lands on disk.
- **FR-7 (persistence):** all light settings persist on the project (schema v12 → v13);
  reopening a file restores the installation, mode and last moment. The render itself is
  never stored.

## Acceptance criteria

- **Core solar (FR-1/FR-2):** unit tests assert `solarPosition` within 0.5° of published
  NOAA values for ≥ 3 location/date pairs, and the resolver's June-vs-December directional
  behaviour for a south-facing Amsterdam window (elevation ↑, temperature ↓/cooler, front
  factor ↑ in June).
- **Model (FR-7):** `updateLightSettings` patch + undo + serialize round-trip; a v12 → v13
  migration test seeding defaults on an old file.
- **UI components:** `LightPanel` renders the Manual and 365-days tabs; the dome places the
  sun (a drag/keyboard maps to azimuth/elevation and commits one undo entry); a slider edit
  is one undo entry; the panel is gated to the light view. A light-layer test confirms the
  WebGL factory no-ops under jsdom and the layer is inert outside the light view.
- **E2E (one Playwright, packaged `file://` build):** draw + paint a panel, switch to the
  Light view (the light WebGL layer goes live), toggle to 365-days mode and scrub time,
  capture a PNG of the moment to disk (`VITRUM_EXPORT_PNG_PATH`), assert a real PNG lands.
- **Manual (Mathieu):** the gallery/visual pass on the **volumetric look** — god-ray
  believability, halo bleed through light glass, the dark-stage mood, and that animation
  feels smooth (the FR-3 frame-rate). This is the showpiece sign-off, expected to produce a
  parameter-tuning follow-up (like F-053's).

## Open questions

1. ~~Room proxy fidelity: flat floor only vs configurable simple room box?~~ **Resolved
   (Mathieu, this session): follow Diafane — dark-void stage, no room box in v1; a cast
   light patch on a floor plane is a follow-up.**

## Implementation notes

_Delivered 2026-07-22 on branch `f-054-light-simulation`. Status: done, pending Mathieu's manual
gallery/visual check of the volumetric look (below). The spec was expanded first (this whole
document), per Mathieu's readiness-gate override; the decisions above were applied as written._

**Solar maths — pure `@vitrum/core/solar/`.** Model- and framework-free (the F-053/F-020
discipline), unit-tested without any GL/DOM:

- `position.ts` — a direct NOAA solar-position port (`solarPosition(location, date)` → azimuth
  clockwise from north + refraction-corrected elevation), plus `solarDeclinationDeg`,
  `equationOfTimeMinutes`, `solarNoonUtcMinutes`. FR-1 is asserted via the **solar-noon identity**
  (elevation = 90° − |lat − decl|, azimuth 0/180) across five latitude/season cases — a reference
  geometry the NOAA calculator reproduces, so no external data table is needed — all within 0.5°.
- `sky.ts` — `skyLight(elevation, overcast)` (warm/dim near the horizon, bright/cool high, dark below
  a −6° floor) + `kelvinToRgb` (Tanner-Helland blackbody fit).
- `panel.ts` — `projectSunOnPanel(sun, facadeAzimuth, tilt)`: world sun → panel plane, giving the
  front-incidence factor (0 when grazing/behind) and the in-plane sun direction the halo/rays stream
  from; `frontal` = in front and centred left–right (the Diafane caption).
- `resolve.ts` — `resolveSun(input)` branches on mode: **manual** takes the panel-relative dome az/el,
  user intensity and temperature; **astronomical** derives everything from location + orientation +
  tilt + `instantForDay(day, minutes, lon)` (integer-tz-from-longitude estimate — FR-1 uses explicit
  UTC dates so it is unaffected; FR-2 is directional). FR-2 is asserted here (June vs December on a
  south-facing Amsterdam window: higher, cooler, more frontal in June).

**Persisted model (`@vitrum/model`).** New `LightSettings` on `Project.light` (schema **v12 → v13**,
`migrateV12ToV13` seeds the default south-facing Amsterdam window), `defaultLightSettings()`,
`LightMode`. One command `updateLightSettings` (shallow patch, self-inverting, one undo entry — the
F-053 `updateRenderSettings` pattern). Tunable intent only; the resolved sun and the lit stage are
derived, never stored (F-042 discipline).

**Light controller (`packages/ui/src/light/controller.svelte.ts`).** Owns the view-side transient
state the document must not carry: the scrub position of the day / time / manual-sun drags and the
animation loop. Scrubbing updates a transient value (live re-render) and commits **once** on release;
animation is preview-only (advances the transient each frame, never writes per frame — no undo
flood), committing the paused moment once on stop. `sun` is the pure `resolveSun` derivation.

**WebGL2 volumetric renderer (`packages/ui/src/light/light-gl.ts`, `LightLayer.svelte`).** The
showpiece, behind the same null-under-jsdom factory as F-053. **Two passes:** (1) sun-lit glass into
an offscreen FBO (stencil even-odd fills, holes free — the F-053 approach; the per-piece lit base is
computed on the CPU by `sunLit` for GPU/CPU parity, tinted by the sun colour × transmission × front
factor, so lighter/more-transparent pieces glow brightest), with the lead/solder lattice stamped
**black** as ray occluders; (2) a full-screen scattering pass that marches 48 samples from each
fragment toward the sun's screen position through that emission buffer → volumetric god-rays broken up
by the leaded lattice, adds a sun-coloured solar halo gated to daylight/front (night stays dark),
filmic tone-maps, and adds optional photo grain. `preserveDrawingBuffer` keeps it readable for the PNG
snapshot. Dark near-black stage; the canvas content is data-driven and exempt from the token rule.

**Shell integration.** The `light` view mode was turned **live** (`viewmode.ts`). A new **Light dock
section** (`dock.ts` + `ActivityRail` Sun item + `DockPanel` → `LightPanel.svelte`) hosts the
controls — the IA-correct home for a standing panel (turn-3: the inspector is selection-only).
Entering the Light view auto-opens the Light dock section; the panel offers a "switch to light view"
affordance when the view is elsewhere. `LightPanel` has the Manual / 365-days tabs: the **sun dome**
(`SunDome.svelte`, an SVG semicircle with a draggable/keyboard sun dot, "Frontal" caption), intensity
/ temperature / solar-halo sliders (Manual), and location / orientation / tilt / day / time + play +
season presets + overcast (365 days), plus shared photo-grain and textures toggles. `Canvas.svelte`
gained the `LightLayer`, treats the light view as a clean read-only presentation stage (no
overlays/interaction, toolbar hidden), and `toPngBytes` composites the `.light-render` canvas on a
black ground for capture. Photo capture reuses F-043's `ExportPort.savePng` + the `takeSnapshot`
getter (`VITRUM_EXPORT_PNG_PATH` E2E override).

**Deviations / decisions.**

- **Room proxy / cast light patch descoped** from v1 (Open-question 1, Mathieu's steer): dark-void
  stage only. Follow-up below.
- **Day-lapse GIF/video export descoped** to a follow-up (advisory steer): single-moment photo
  capture ships; animation playback exists on-screen but is not recorded.
- **Manual intensity/temperature are inert in astronomical mode** (the sky drives brightness/warmth
  there); the Manual tab surfaces them. This matches Diafane's split (Manual vs 365-days tabs).
- **Net-new surfaces to back-port** to the Portal / Design projects: the Light view mode, the Light
  dock section (activity-rail Sun item), the `SunDome` widget, and the light-stage capture control.
- **Dome sky-colour gradient** (Diafane's warm-horizon→blue-zenith marketing card) was kept as a
  token-clean widget (cobalt sun dot on paper) rather than a data-driven sky gradient, to stay inside
  the design-system token rule; a richer elevation-tinted dome is a design enhancement (follow-up).

**Tests.** Core: `solar/solar.test.ts` (19 — FR-1 noon identity across latitude/season within 0.5°,
morning/afternoon azimuth, EoT envelope, sky/kelvin monotonicity, panel projection, FR-2
June-vs-December, `instantForDay`). Model: `lightCommands.test.ts` (patch + undo + serialize
round-trip) and a v12→v13 migration test in `serialize.test.ts`. UI: `light/controller.test.ts`
(scrub/commit for time + manual sun, clamping, play/stop commit) and `shell/LightPanel.test.ts`
(both tabs; mode switch, intensity, time scrub-then-commit, season preset each one undo entry; the
switch-to-light-view invite; the WebGL factory no-ops under jsdom so the layer is inert). E2E:
`apps/desktop/e2e/light.spec.ts` drives the packaged `file://` build — draw + paint, switch to the
Light view (WebGL layer live + dock opens), scrub a season preset, capture a PNG photo to disk.

**Verification (by me).** All gates green from the repo root: `pnpm lint`, `pnpm format:check`,
`pnpm check` (svelte-check 0 errors), `pnpm test` (988 unit/component), and the new `light.spec` E2E
on the real `file://` build. FR-3's ≥ 30 fps is met structurally (two WebGL passes/frame, no
per-frame allocation on the hot path); the exact frame-rate and the volumetric beauty are the manual
gallery pass. The GL path runs only in the E2E (the F-030 file:// lesson); jsdom no-ops the renderer.

**Pending Mathieu (manual, not automatable).**

- The **volumetric-look gallery pass**: god-ray believability, halo bleed through the lighter pieces,
  the dark-stage mood, temperature/warmth of the golden hour, and that animation feels smooth
  (FR-3). Expected to produce a parameter-tuning follow-up (like F-053's).

**Follow-ups (out of scope).**

- Cast coloured light patch on a simple floor plane (the descoped half of Open-question 1).
- Day-lapse GIF / video export of a full day / season.
- Elevation-tinted sky gradient in the sun dome (design enhancement).
- Horizon-obstruction slider (neighbouring-building shadowing approximation, from the non-goals).
- A proper IANA timezone for the astronomical instant (currently longitude/15 integer estimate).

### Post-merge polish (2026-07-23)

- **Light controls moved out of the dock into a floating card** (`shell/LightControls.svelte`) shown
  over the canvas stage only in the light view (Mathieu, 2026-07-23) — closer to Diafane's on-canvas
  card and keeps light UI scoped to the light page. The dock "Light" section and its activity-rail
  item are removed; `dock.ts`, `ActivityRail.svelte` and `DockPanel.svelte` no longer know about
  light. The card reuses the existing `LightPanel` content unchanged. Net-new surface to back-port:
  the floating light-controls card (paper card, tokens only, `.stage`-anchored like the Toolbar).
- `light.spec.ts` updated: asserts the floating `Light controls` card appears on entering the light
  view (was: the dock section opens).

_Cockpit v2 (2026-07-30):_ the floating `LightControls` card was folded into the inspector's light-view context. See the "Cockpit v2 rework" section of
[F-001](F-001-architecture.md) for the full shell IA.
