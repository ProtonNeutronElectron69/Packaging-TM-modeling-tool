# FCBGA Thermomechanical Screening Tool

A self-contained, single-file browser application that performs approximate 3D finite-element thermomechanical stress and warpage analysis of flip chip ball grid array (FCBGA) packages: SAC solder flip chip bonded silicon dies on a multilayer organic build-up substrate with a glass-fiber core, capillary underfill, and an optional hat lid or stiffener ring.

**Screening tool. Results are approximate and intended for design comparison and trend studies, not sign-off.**

The full specification the tool is built against is in [`CLAUDE.md`](CLAUDE.md).

## Using the tool

Open `dist/fcbga_thermomech_tool.html` in a current Chromium-based browser (Chrome, Edge) or Firefox. Everything runs locally in the page; nothing is uploaded. The only external resource is three.js (for the 3D view), loaded from cdnjs with jsdelivr and unpkg as fallbacks; when none can be reached the 3D view is hidden and every other feature keeps working.

Workflow (left stepper):

1. **Package**: substrate outline, layer stack (with an N-2-N generator), BGA field, configuration (bare die, lid, stiffener). Presets from Section 12 of the specification load in one click.
2. **Dies and floorplan**: die list and properties, bump fields; drag dies on the floorplan (R rotates, Delete removes), with snapping and live clearances. Moving dies starts no analysis; the warpage overlay is hidden while the geometry differs from the last results. Run the analysis from step 6 (full, or Quick preview on the Draft mesh).
3. **Underfill, lid, stiffener** geometry.
4. **Materials**: the cited database with confidence badges, datasheet ranges, source tooltips, E(T) and CTE(T) plots, duplicate / reset.
5. **Process and loads**: stress-free temperatures, reflow sweep, JESD22-A104 cycling, limits and fatigue constants.
6. **Run and results**: fidelity preset, parallel worker count with the memory estimate, estimated DOF / memory / runtime, run controls, baseline pinning, mesh sensitivity check, the list of Estimated inputs in use, CSV export and printable report. Results views (center area): warpage (JEITA ED-7306 sign convention), die stress, bump loading, underfill interface tractions, solder fatigue screening and bump submodels, 3D view, sensitivity tornado charts, verification suite.

Every pane can be resized by dragging: the step list and the context panel (vertical splitters), the split between the floorplan and the cross-section, the 3D view (grip below it), and each plot or map (drag its bottom edge). Fields, dropdowns, tables and plots follow the new size; double-click a splitter or edge to restore its default. A narrow step list shows step numbers only.

In the Results area every plot, contour map and tornado chart zooms with the mouse wheel about the pointer; drag to pan once zoomed and double-click to show everything again (the page scrolls normally when the pointer is outside a plot). Contour maps, bump maps, the floorplan overlay and the 3D view use a rainbow colour scale by default (purple for low values through blue, green, yellow and orange to red for high; signed quantities put zero at mid-scale). The "colors" dropdown in the Results bar switches to the colorblind-safe scales (viridis and blue-white-red).

Configurations are saved and loaded as JSON files. `localStorage` holds only conveniences: the theme, the last step and tab, the pane sizes and the colour scale.

## Project status

The specification in `CLAUDE.md` is implemented in full. Seven pull requests are merged on `main`:

| PR | Merged | Content |
|---|---|---|
| [#1](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/1) | 2026-10-08 | Complete tool: physics core, worker, single-file UI, verification suite, build and test tooling |
| [#2](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/2) | 2026-10-09 | Feature-preserving multigrid, parallel sweep and submodels on nested workers, faster submodel, JEITA shape class and sign confidence, three.js fallback chain and 3D smoke test, "Estimated inputs in use" card, V7 consistency (suite 15/15) |
| [#3](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/3) | 2026-10-09 | Tooltips on every control, dropdown, results tab and result quantity |
| [#4](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/4) | 2026-10-09 | Documentation: project status, repository layout, workflow, verification, performance, deviations, known issues |
| [#5](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/5) | 2026-10-09 | Documentation: listed the documentation PR in the status tables |
| [#6](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/6) | 2026-10-10 | Resizable panes (side panels, floorplan and cross-section split, 3D view, plot edges) with content that follows the size; auto-solve on die release and the drag preview removed; floorplan overlay hidden while the geometry differs from the results |
| [#7](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/7) | 2026-10-10 | Mouse-wheel zoom, drag pan and double-click reset on every results plot and map; rainbow colour scale by default with a colorblind-safe option |

Open items are listed under "Known issues and next steps" below. The largest is performance against the Section 13 targets.

## Repository layout

| Path | Content |
|---|---|
| `CLAUDE.md` | Project guide (status, conventions) followed by the original build specification |
| `dist/fcbga_thermomech_tool.html` | The deliverable, built from `src/` and committed |
| `dist/verification.json` | Results of the last headless verification run (not committed) |
| `src/template.html`, `src/style.css` | Page skeleton (three.js loader with cdnjs, jsdelivr and unpkg fallback) and styles, light and dark themes |
| `src/materials-db.json` | Cited materials database (Section 11) with per-property source, confidence and range |
| `src/core/00-constants.js` | `CONST`: every modelling, mesh, solver and fatigue constant |
| `src/core/01-util.js`, `02-config.js` | Helpers; default configuration, presets, stack generator, hashing, JSON round trip, JEITA and cycling tables |
| `src/core/03-materials.js`, `04-homogenize.js` | E(T) and CTE(T) forms on the 1 °C grid, cubic silicon rotated 45°, Voigt / Reuss / Turner layer mixing, layered band sections, bump profile and d_eff |
| `src/core/05-geometry.js`, `06-mesher.js` | Package geometry; structured extruded hex mesher with void cells, feature lines, size function, DOF cap, 3-2-1 constraints |
| `src/core/07-element.js`, `08-sparse.js`, `09-assembly.js` | Incompatible-mode hex (closed-form box integration, layered integration), block CSR, `FEModel` (assembly, birth states, stress recovery) |
| `src/core/10-solver.js` | Jacobi-scaled PCG, `MultigridPC` (column block Gauss-Seidel, shell aggregates, feature-preserving coarsening, banded coarsest Cholesky), `ICPC`, warm start, rebuild policy |
| `src/core/11-analysis.js` | Process stages, evaluation temperatures, sweep ordering, the `Analysis` driver |
| `src/core/12-post.js` | JEITA warpage with shape class and sign confidence, die stress, bump loads, underfill tractions, 3D face fields |
| `src/core/13-fatigue.js` | Anand point integrator, cycle history, screening, `BumpSubmodel`, Syed and Darveaux life models |
| `src/core/14-sensitivity.js`, `15-verify.js` | Tornado inputs, bounds and cases; verification tests V1 to V15 |
| `src/worker.js` | Worker driver and nested helper workers (parallel sweep and submodels) |
| `src/ui/00-app.js`, `00b-tips.js`, `00c-layout.js`, `01-plot.js` | App state, worker client, field helpers, tooltip dictionary and element, resizable panes and plot edge grips, 2D plots and colour maps |
| `src/ui/02-floorplan.js`, `03-panels.js`, `04-results.js`, `05-main.js` | Floorplan and cross-section editor, the six step panels, results views and report, shell and wiring |
| `tools/build.mjs` | Concatenates `src/` into the single HTML file |
| `tools/verify.mjs` | Extracts the core block from the built file and runs the suite in Node |
| `tools/smoke.mjs`, `tools/three-stub.js` | Playwright / Chromium end-to-end test, with a local three.js API stub for sandboxes that block CDNs |
| `tools/dev-core.mjs` | Loads `src/core` directly for ad-hoc experiments in Node |

## Development workflow

```
node tools/build.mjs                       # writes dist/fcbga_thermomech_tool.html (always rebuild after editing src/)
node tools/verify.mjs                      # full verification suite headless in Node, V1 to V15 (about 4 min, V10 dominates)
node tools/verify.mjs V1,V2,V13            # selected tests
node tools/verify.mjs --presets draft      # V15 timing presets (default draft,standard)
node tools/smoke.mjs                       # Chromium: page load and Draft preview, zero console errors
node tools/smoke.mjs --full [--standard] [--workers 3] [--submodels]   # full analysis, every results view, 3D view, submodels
```

Rules that keep the three execution contexts consistent:

- `src/core/*.js` must stay free of DOM references; the same text runs on the UI thread, in the Web Worker (Blob URL) and in Node.
- Never edit `dist/` by hand; commit the rebuilt file with the sources.
- Every constant goes in `CONST`; large data lives in `Float64Array` / `Int32Array`.
- Every UI control gets a tooltip through `tip()`, `helpTip()` or `kl()` (dictionary `TIPS` in `src/ui/00b-tips.js`); numeric inputs go through `numField()` so bounds and plausibility ranges apply.
- Playwright is resolved from the repository or from `/opt/node-tools/node_modules`; Chromium is pre-installed in the cloud sandbox.
- There are no CI workflows; the headless suite and the smoke test are the gate before a pull request.

## Modeling summary

- Structured, extruded hexahedral mesh with void cells; 8-node hexahedra with Wilson-Taylor incompatible modes (statically condensed); layered integration through the substrate sub-layers; superposed solder / underfill phases in the bump layer.
- Total thermoelastic formulation with element birth (substrate, chip join, underfill cure, lid or stiffener attach), one linear solve per evaluation temperature.
- Jacobi-scaled PCG with a multigrid preconditioner (column block Gauss-Seidel smoother on the 3D level, shell-type coarse levels built from per-column rigid-body-plus-thickness aggregates with Hermite deflection interpolation, feature lines kept at every coarse level, banded Cholesky on the coarsest level) and an IC(0) fallback; warm starts by Galerkin projection on previous solutions.
- The temperature sweep and the bump submodels run in parallel on nested helper workers (birth states, respectively cycling fields, are transferred); the worker count is a run setting.
- Post-processing per JEITA ED-7306 / JESD22-B112 (warpage, with a shape class and a sign-confidence metric from the diagonals), fixed-patch corner metrics, per-bump forces from the solder phase, interface tractions.
- Anand viscoplastic SAC305 with backward-Euler radial return and consistent tangent; bump screening across all sites; one-pitch bump submodel with B-bar hexahedra, cut-boundary displacements and Newton-Raphson; Syed and Darveaux life models.

See the in-app "Assumptions and limitations" panel for every modeling assumption and build decision.

## Verification status

Last headless run (Node 22, 4-core container), 15 of 15 pass. `dist/verification.json` holds the full text of each measurement.

| ID | Test | Measured | Criterion | Result |
|---|---|---|---|---|
| V1 | Free thermal expansion | displacement error 3.3e-12 relative, stress 1.2e-13 × EαΔT | 1e-9 / 1e-8 | pass |
| V2 | Patch test, incompatible-mode hex, distorted mesh | displacement 6.8e-17, strain 6.5e-16 | 1e-9 | pass |
| V3 | Bimaterial plate curvature vs Timoshenko | 2.0692e-3 vs 2.0692e-3 1/mm (0.00 %) | 3 % | pass |
| V4 | Three-layer laminate vs classical lamination theory | kx 0.01 %, ky 0.17 % | 3 % | pass |
| V5 | Layered integration vs one element per layer | 104.95 vs 105.11 µm (0.15 %) | 1 % | pass |
| V6 | Anand saturation stress vs closed form | 42.04 / 22.81 / 13.02 MPa vs 42.09 / 22.83 / 13.04 | 1 % | pass |
| V7 | Submodel consistency with homogenized bump layer | 0.18 % (bump-layer domain, uniform phases); 0.47 % with the production domain, reported as information | 2 % | pass |
| V8 | Symmetry of the warpage field | 1.3e-11 (x), 2.0e-11 (y), 7.3e-12 (diagonal), 1.3e-11 mirrored | 1e-6 | pass |
| V9 | Physical sanity on the presets | bare RT +236 µm convex; backside +89 MPa tensile; 0.8 mm core 174 vs 313 µm; 795G LH 182 vs 705G 278 µm | all four | pass |
| V10 | Mesh convergence, Standard vs Fine | warpage 0.59 %, die interior peak 2.95 % (113k vs 383k DOF) | 5 % | pass |
| V11 | Solver integrity | residual 9.1e-11, reactions 2.8e-11 of the force scale, energy balance 2.4e-13 | 1e-8 / 1e-9 | pass |
| V12 | JEITA sign and magnitude on synthetic domes | signs +1 / -1, magnitude error 0.0 | exact / 1e-9 | pass |
| V13 | Unit checks (Si CTE, rotated Si moduli, SAC305 E, AlSiC-9 strain, Turner, Voigt, Reuss) | all exact | 1e-9 (formulas), printed precision (rounded references) | pass |
| V14 | JSON save / load round trip | identical hash | identical | pass |
| V15 | Timing benchmark | see below | report | pass |

## Measured performance

Headless Chromium on a 4-core cloud container with 3 workers, Section 13 targets in parentheses. A 2023-class laptop should be somewhat faster per core.

| Job | Measured | Target |
|---|---|---|
| Quick preview (Draft, step 6 button; the drag preview was removed) | about 8 s | none (drag preview target 2 s no longer applies) |
| Full Draft analysis (stages, 25 °C, chip-join state, reflow sweep, cycling samples) | 33 s | none |
| Full Standard analysis | 147 s | 90 s |
| Full Fine analysis | not run end to end; stage chain alone about 190 s at 383k DOF | 10 min |
| Screening over all 17,424 bumps of the default die | 7 s | 10 s |
| Four bump submodels, 16×16×14, 3 cycles | 286 s on 3 workers (145 s per bump) | 120 s |
| Sensitivity (Draft, default input set, worker pool) | about 15 to 20 s per case, roughly 2 to 3 min on 8 cores | 3 min |
| Peak memory at Standard | about 330 MB per worker | 600 MB |
| V15, stage chain + 25 °C, Draft 28k DOF | multigrid 4.7 s, IC(0) 37.7 s | report |
| V15, stage chain + 25 °C, Standard 113k DOF | multigrid 23.6 s, IC(0) 170 s | report |

Multigrid wins by about 6× at both presets and is the default preconditioner; IC(0) remains the fallback. PCG iterations per solve: bare 25, lidded 26, two-die stiffener 42 at Standard.

## Deviations from the specification

Each is also listed in the in-app "Assumptions and limitations" panel.

1. **Multigrid coarse space.** Plain semi-coarsening with nodal interpolation stalled at 110 to 200 iterations, growing with refinement, because interpolated bending modes carry far too much shear energy on thin layered structures. The coarse levels use per-column shell aggregates (rigid-body plus thickness modes of each stiff stack, split at compliant layers) with Hermite deflection interpolation, keep die, lid and stiffener feature lines at every level, and finish with a banded Cholesky. Smoother, Galerkin products and warm starts are as specified.
2. **Full symmetric block matrix stored** instead of the upper triangle, for faster smoothing sweeps; memory stays within target.
3. **Element integration** uses a closed-form 12-point box rule, identical to 2×2×2 Gauss for single-material elements and to two Gauss points per sub-layer for layered elements.
4. **Layered sub-layer stiffness** uses the continuum-shell form (plane-stress in-plane block, uncoupled thickness modulus); one thickness strain shared across a band's sub-layers over-constrained the softer ones (V5 at 1.5 %, now 0.15 %).
5. **Preconditioner rebuild policy** is also keyed on the process stage and the solder regime (below or above the solidus), with a mid-solve rebuild when the 2× budget is exceeded; without it the solidus crossing stalled at 2000 iterations.
6. **Reflow sweep sampling** is 15 °C above the cycling range and 10 °C near a Tg, plus the report temperatures and the solidus; the 10 / 5 °C rule of Section 9.2 applies to the cycling samples.
7. **V7** is run with 25 °C process temperatures and a bump-layer-only domain of uniform homogenized phases, because the spec's perturbation submodel coincides with the global total formulation only when the 25 °C state is stress-free; the production domain with materially consistent silicon and substrate slices is reported as information (0.47 %).
8. **V11** is solved to 1e-10 to meet the 1e-9 reaction criterion; **V13** compares rounded reference values at their printed precision.
9. **Submodel Newton** refreshes the consistent tangent on the first iterations and on stalls, and freezes it while the residual shrinks (modified Newton); the inner PCG uses an inexact-Newton tolerance.
10. **No drag preview and no auto-solve on die release** (Section 4.3 asks for both). Removed at the user's request: moving a die starts no solve, and the floorplan overlay is hidden while the geometry differs from the results it was computed for. The analysis runs from step 6 (full, or Quick preview on the Draft mesh).
11. **Rainbow colour scale by default** (Section 4.8 asks for colorblind-safe, perceptually uniform maps). Changed at the user's request; the rainbow is neither colorblind safe nor perceptually uniform, so bright yellow and cyan bands can look like features. The colorblind-safe scales remain one click away in the Results bar.
12. **Estimated material values** (rubbery moduli of ABF and solder resist, polymer Poisson ratios, core through-thickness and shear moduli, TIM gel) are flagged in the materials editor, listed in the run panel and report, and included in the default sensitivity set. SAC105 and SAC387 are placeholders without bundled data.

## Known issues and next steps

- **Performance targets are still missed** by 1.6× to 2.4× (Standard, submodels; Fine not measured end to end). Candidates: WebAssembly or SIMD kernels for the matrix-vector product and the column smoother, a sparse direct solver for the 13k-DOF submodel, and fewer sweep temperatures when no Tg lies in the range.
- **Fine preset** full analysis has not been timed; V10 covers its accuracy against Standard.
- **JEITA sign on ring and saddle surfaces** is inherently fragile (the lidded default at 25 °C is a ring profile); the shape class, the sign-confidence metric and the magnitude curve are shown so the user can judge. A customer-specific sign rule could be added as an option.
- **Peak memory grows with the worker count** (each helper holds its own model copy); the run panel shows the estimate.
- **3D view** has been exercised only against the local three.js stub in the sandbox; a check in a browser with CDN access is still worthwhile.
- **Possible future work**: mesh-independent corner metrics across presets (currently fixed physical patches), a warpage-only fast mode for sensitivity, calibrating effective stress-free temperatures against measured warpage, and an optional viscoelastic underfill model.
