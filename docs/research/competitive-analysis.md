# Competitive analysis (July 2026)

Research snapshot used to seed the roadmap. Sources: [diafane.com](https://diafane.com/en/),
[diafane.com/faq](https://diafane.com/faq), [Glass Eye 2000 editions](https://www.dfly.com/editions.html).

## Diafane (web, subscription — free tier: 3 projects)

- **Drawing**: vector line drawing; automatic closed-shape (piece) detection; cutting
  contours computed from lead thickness + cutting tolerance. Stylus/tablet support.
- **Techniques**: lead came (H/U profiles, configurable width/heart) and a dedicated
  Tiffany/copper-foil mode (foil width, spacing, solder finish: silver/copper/black),
  chosen at project level; rendering, cutting and export adapt automatically.
- **Glass**: catalog of 1,400+ hue/transparency/texture combinations; custom glass
  creation. Manufacturer catalogs (Bullseye, Wissmach, Oceanside, Kokomo, Lamberts,
  Saint-Just) _planned_, not shipped.
- **References & import**: photo/scan underlay with 4-corner perspective correction;
  SVG import from Illustrator/Inkscape (paths become editable lead lines).
- **Symmetry**: live mirroring across one or two axes (rose windows, lancets).
- **Light simulation**: 3D scene, real sun position from GPS/orientation/date/time,
  seasonal progression, photo capture.
- **Output**: 1:1 tiled printing (A4–A0, custom up to 5,000 mm); numbered templates
  sorted by glass or size; cutting lists per glass; BOM; PDF preview/export; SVG export
  (Cricut-compatible); `.diafane` project sharing.
- **Architecture**: browser-based, local-first (stays responsive offline); automatic
  versioning (manual + automatic on paid tier).

## Glass Eye 2000 (Windows desktop, tiered editions — the incumbent since ~2000)

- Drawing: line/curve/circle/polygon; resize/rotate/stretch/flip; grid, crosshair, rulers.
- 400+ pattern library; piece numbering by color/location/manual; BOM; per-selection
  material calculation.
- Glass library of 3,700+ manufacturer glass images (Pro); custom glass images;
  repositionable/rotatable glass textures (Pro Plus).
- AutoTrace of scanned drawings (Pro Plus); text tools; decimal/fractional units.
- Import/export: BMP/JPEG → up to DXF/DWG/EMF/WMF vector for CAD interop.
- Enterprise: plotter/cutter support, design bursting, **nesting**, offset contour drawing.

## Gaps and opportunities for Vitrum

1. **No competitor has design rule checking.** Cuttability (impossible inside cuts,
   slivers, minimum piece size) and structural checks (hinge lines, reinforcement,
   weight) are entirely the craftsperson's job today. This is our KiCad-inspired edge.
2. CAD-grade editing (proper snapping, constraints, node editing, robust undo) is
   weak in both products — Diafane is drawing-app-like, Glass Eye is dated.
3. Nesting exists only in Glass Eye's most expensive edition.
4. Manufacturer glass catalogs are unshipped in Diafane — an open flank.
5. Quoting/cost estimation is underserved in both.
