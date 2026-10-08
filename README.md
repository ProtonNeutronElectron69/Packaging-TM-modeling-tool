# FCBGA Thermomechanical Screening Tool

A self-contained, single-file browser application that performs approximate 3D finite-element thermomechanical stress and warpage analysis of flip chip ball grid array (FCBGA) packages: SAC solder flip chip bonded silicon dies on a multilayer organic build-up substrate with a glass-fiber core, capillary underfill, and an optional hat lid or stiffener ring.

**Screening tool. Results are approximate and intended for design comparison and trend studies, not sign-off.**

The full specification the tool is built against is in [`CLAUDE.md`](CLAUDE.md).

## Using the tool

Open `dist/fcbga_thermomech_tool.html` in a current Chromium-based browser (Chrome, Edge) or Firefox. Everything runs locally in the page; nothing is uploaded. The only external resource is three.js (for the 3D view) from cdnjs; when it cannot be loaded the 3D view is hidden and every other feature keeps working.

Workflow (left stepper):

1. **Package**: substrate outline, layer stack (with an N-2-N generator), BGA field, configuration (bare die, lid, stiffener). Presets from Section 12 of the specification load in one click.
2. **Dies and floorplan**: die list and properties, bump fields; drag dies on the floorplan (R rotates, Delete removes), with snapping and live clearances. A Draft preview solve runs while dragging and the full analysis runs on release when auto-solve is on.
3. **Underfill, lid, stiffener** geometry.
4. **Materials**: the cited database with confidence badges, datasheet ranges, source tooltips, E(T) and CTE(T) plots, duplicate / reset.
5. **Process and loads**: stress-free temperatures, reflow sweep, JESD22-A104 cycling, limits and fatigue constants.
6. **Run and results**: fidelity preset, estimated DOF / memory / runtime, run controls, baseline pinning, mesh sensitivity check, CSV export and printable report. Results views (center area): warpage (JEITA ED-7306 sign convention), die stress, bump loading, underfill interface tractions, solder fatigue screening and bump submodels, 3D view, sensitivity tornado charts, verification suite.

Configurations are saved and loaded as JSON files. `localStorage` holds only the theme and the last step.

## Building and verifying

```
node tools/build.mjs          # writes dist/fcbga_thermomech_tool.html
node tools/verify.mjs         # runs the verification suite headless in Node (V1 to V15)
node tools/verify.mjs V1,V2,V13   # selected tests
node tools/smoke.mjs --full   # Playwright / Chromium smoke test with screenshots
```

`src/core/*.js` is the physics core (materials, homogenization, mesher, elements, assembly, solvers, post-processing, Anand model, screening, submodel, sensitivity, verification). It has no DOM dependencies and is embedded in the HTML as a `text/plain` script block that the UI thread, the Web Worker and the headless runner all load. `src/worker.js` is the worker driver, `src/ui/*.js` the interface, `src/materials-db.json` the materials database with citations.

## Modeling summary

- Structured, extruded hexahedral mesh with void cells; 8-node hexahedra with Wilson-Taylor incompatible modes (statically condensed); layered integration through the substrate sub-layers; superposed solder / underfill phases in the bump layer.
- Total thermoelastic formulation with element birth (substrate, chip join, underfill cure, lid or stiffener attach), one linear solve per evaluation temperature.
- Jacobi-scaled PCG with a multigrid preconditioner (column block Gauss-Seidel smoother on the 3D level, shell-type coarse levels built from per-column rigid-body-plus-thickness aggregates with Hermite deflection interpolation) and an IC(0) fallback; warm starts by Galerkin projection on previous solutions.
- Post-processing per JEITA ED-7306 / JESD22-B112 (warpage), fixed-patch corner metrics, per-bump forces from the solder phase, interface tractions.
- Anand viscoplastic SAC305 with backward-Euler radial return and consistent tangent; bump screening across all sites; one-pitch bump submodel with B-bar hexahedra, cut-boundary displacements and Newton-Raphson; Syed and Darveaux life models.

See the in-app "Assumptions and limitations" panel for every modeling assumption and build decision.
