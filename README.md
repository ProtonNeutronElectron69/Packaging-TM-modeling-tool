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
4. **Materials**: the cited database (101 materials, see "Materials database" below) with confidence badges, datasheet ranges, source tooltips, E(T) and CTE(T) plots, duplicate / reset.
5. **Process and loads**: stress-free temperatures, reflow sweep, JESD22-A104 cycling, limits and fatigue constants.
6. **Run and results**: fidelity preset, parallel worker count with the memory estimate, estimated DOF / memory / runtime, run controls, baseline pinning, mesh sensitivity check, the list of Estimated inputs in use, CSV export and printable report. Results views (center area): warpage (JEITA ED-7306 sign convention), die stress, bump loading, underfill interface tractions, cross-section stress (click a horizontal or vertical line on the package and see any stress component on the vertical cut under it, from the top solder resist to the package top, zoomable, with an element mesh overlay and a CSV export), solder fatigue screening and bump submodels, 3D view, sensitivity tornado charts, verification suite.

Every pane can be resized by dragging: the step list and the context panel (vertical splitters), the split between the floorplan and the cross-section, the 3D view (grip below it), and each plot or map (drag its bottom edge). Fields, dropdowns, tables and plots follow the new size; double-click a splitter or edge to restore its default. A narrow step list shows step numbers only.

In the Results area every plot, contour map and tornado chart zooms with the mouse wheel about the pointer; drag to pan once zoomed and double-click to show everything again (the page scrolls normally when the pointer is outside a plot). Contour maps, bump maps, the floorplan overlay and the 3D view use a rainbow colour scale by default (purple for low values through blue, green, yellow and orange to red for high; signed quantities put zero at mid-scale). The "colors" dropdown in the Results bar switches to the colorblind-safe scales (viridis and blue-white-red).

A glossary ("A–Z" in the top bar, or "Glossary" under the step list) spells out every technical acronym and variable symbol with a short description; trade-name acronyms of materials are not listed. Wherever such a term appears in the tool it is underlined with dots: hovering it shows its meaning, and clicking it opens the glossary at that entry. Terms drawn inside plots and maps (canvas text) are not linked. The printable report ends with the glossary.

Configurations are saved and loaded as JSON files. `localStorage` holds only conveniences: the theme, the last step and tab, the pane sizes and the colour scale.

## Project status

The specification in `CLAUDE.md` is implemented in full. Twenty pull requests are merged on `main`:

| PR | Merged | Content |
|---|---|---|
| [#1](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/1) | 2026-10-08 | Complete tool: physics core, worker, single-file UI, verification suite, build and test tooling |
| [#2](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/2) | 2026-10-09 | Feature-preserving multigrid, parallel sweep and submodels on nested workers, faster submodel, JEITA shape class and sign confidence, three.js fallback chain and 3D smoke test, "Estimated inputs in use" card, V7 consistency (suite 15/15) |
| [#3](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/3) | 2026-10-09 | Tooltips on every control, dropdown, results tab and result quantity |
| [#4](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/4) | 2026-10-09 | Documentation: project status, repository layout, workflow, verification, performance, deviations, known issues |
| [#5](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/5) | 2026-10-09 | Documentation: listed the documentation PR in the status tables |
| [#6](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/6) | 2026-10-10 | Resizable panes (side panels, floorplan and cross-section split, 3D view, plot edges) with content that follows the size; auto-solve on die release and the drag preview removed; floorplan overlay hidden while the geometry differs from the results |
| [#7](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/7) | 2026-10-10 | Mouse-wheel zoom, drag pan and double-click reset on every results plot and map; rainbow colour scale by default with a colorblind-safe option |
| [#8](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/8) | 2026-10-10 | Materials database expanded from 20 to 49 materials (solders, underfills, build-up films, cores, solder resist, adhesives, TIMs, lid and stiffener metals) with a sanity pass on the original entries; PRs 5 to 7 added to the status tables |
| [#9](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/9) | 2026-10-10 | Materials database second pass from primary sources, 49 to 101 materials (SAC105 and SAC405 Anand sets, MGC, Panasonic, Resonac and Shengyi cores, more underfills, build-up films, solder resists, lid adhesives and metals) with corrections to existing entries; PR 8 added to the status tables |
| [#10](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/10) | 2026-10-11 | Parallel worker count offered up to CPU cores / 1.5 (rounded down); the sensitivity run uses the chosen worker count |
| [#11](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/11) | 2026-10-11 | Documentation: PRs 9 and 10 added to the status tables |
| [#12](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/12) | 2026-10-11 | Results map legends show enough decimals to keep narrow ranges distinct (the fatigue map read 0.2 at both ends); CLAUDE.md now picks verification subsets by the nature of a change |
| [#13](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/13) | 2026-10-11 | Documentation: PRs 11 and 12 added to the status tables |
| [#14](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/14) | 2026-10-11 | Glossary of 83 acronyms and variable symbols: matching terms in the UI show the spelled-out form on hover and open the entry on click; glossary window (A–Z) and a glossary section in the report |
| [#15](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/15) | 2026-10-13 | Colour-scale end labels to 4 significant figures (scientific notation below 1); die corners numbered 1 to 4 clockwise from the bottom-right corner everywhere (underfill perimeter plots, die stress map and patches); line key on the die stress map; verification criteria shown before a run with a plain-language description of each test; explainer tooltips on the fatigue, sensitivity and verification tabs |
| [#16](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/16) | 2026-10-13 | Documentation: PRs 13 to 15 added to the status tables; standing rule to update them after every merge |
| [#17](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/17) | 2026-10-13 | Cancelling a job no longer strands the results: verification, mesh check and core study run on a one-shot side worker; cancelling a main-worker job shows a notice with Restore analysis instead of "No analysis in memory"; cancel with nothing running keeps the analysis; a cancelled sensitivity run reports no false failures |
| [#18](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/18) | 2026-10-14 | Documentation: PRs 16 and 17 added to the status tables |
| [#19](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/19) | 2026-10-14 | Cross-section stress view: click a horizontal or vertical line on the package and see any stress component (invariants, package-axis and line-frame components) on the vertical cut under it, from the top solder resist to the package top; zoom, element mesh overlay, bump-layer phase toggle, vertical scale, hover readout and CSV export; solder resist sub-layer stress recovered with out-of-plane stresses continuous through the band |
| [#20](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/20) | 2026-10-14 | Documentation: PRs 18 and 19 added to the status tables; from now on each PR adds its own row before it merges, with no separate status PR |

Open items are listed under "Known issues and next steps" below. The largest is performance against the Section 13 targets.

## Materials database

`src/materials-db.json` holds 101 materials. Every property carries a confidence label (Datasheet, Literature, Handbook, Estimated) and its sources (reference ids R1 to R72, listed with URLs in the file and shown in the app's source tooltips). "Typical" entries are representative values drawn from the bundled data sheets, for trend studies. The confidence column counts the properties of each label.

**Die** (1)

| Material | Grade | Confidence of properties | Sources |
|---|---|---|---|
| Silicon | (100) wafer, die edges along <110> | Literature 6 | R10, R11 |

**Bump solder** (6)

| Material | Grade | Confidence of properties | Sources |
|---|---|---|---|
| SAC305 | Sn-3.0Ag-0.5Cu | Literature 13 | R8, R9 |
| SAC105 | Sn-1.0Ag-0.5Cu (low silver, drop-shock grade) | Literature 10, Handbook 1, Estimated 2 | R51, R52, R55 |
| SAC387 | Sn-3.8Ag-0.7Cu | Datasheet 2, Literature 1, Estimated 10 | R22, R23, R54 |
| Sn-3.5Ag | 96.5Sn-3.5Ag eutectic (C4 bumps, Cu pillar caps) | Literature 12, Handbook 1 | R18, R19, R20, R21 |
| Sn-Pb eutectic | 63Sn-37Pb (legacy C4 and BGA reference) | Literature 12, Handbook 1 | R18, R19, R25, R53 |
| SAC405 | Sn-4.0Ag-0.5Cu | Datasheet 2, Literature 9, Estimated 2 | R22, R51, R54 |

**Build-up dielectric** (13)

| Material | Grade | Confidence of properties | Sources |
|---|---|---|---|
| ABF GL series | e.g. GL102 (default) | Datasheet 5, Estimated 4 | R1 |
| ABF GX-T31 | GX-T31 | Datasheet 5, Estimated 4 | R1, R59 |
| ABF GX92 | GX92 | Datasheet 5, Estimated 4 | R1, R59 |
| ABF GX13 | GX13 (earlier general-purpose grade) | Datasheet 5, Estimated 4 | R1 |
| ABF GZ41 | GZ41 (low-loss, high-Tg grade) | Datasheet 5, Estimated 4 | R1 |
| ABF GY11 | GY11 (lowest-loss grade, active-ester cure) | Datasheet 5, Estimated 4 | R1 |
| ABF GX-E4 | GX-E4 (low-CTE, high-modulus grade) | Literature 3, Estimated 6 | R59 |
| ABF GX-E5 | GX-E5 (lowest-CTE grade) | Literature 3, Estimated 6 | R59 |
| ABF GZ22 | GZ22 (cyanate ester cure) | Literature 3, Estimated 6 | R59 |
| Sekisui NQ07X | Sekisui Chemical build-up film, low loss | Literature 3, Estimated 6 | R59 |
| Sekisui NX04H | Sekisui Chemical build-up film | Literature 3, Estimated 6 | R59 |
| Sekisui NR11 | Sekisui Chemical build-up film, low CTE | Literature 3, Estimated 6 | R59 |
| Sekisui NR50 | Sekisui Chemical build-up film, thin (10 um) | Literature 3, Estimated 6 | R59 |

**Core laminate** (28)

| Material | Grade | Confidence of properties | Sources |
|---|---|---|---|
| MCL-E-795G | Standard type (default core) | Datasheet 7, Estimated 10 | R2, R60 |
| MCL-E-795G Type X | Low CTE type X | Datasheet 7, Estimated 10 | R2 |
| MCL-E-795G Type LH | Low CTE type LH | Datasheet 7, Estimated 10 | R2 |
| MCL-E-705G | Standard high-Tg core | Datasheet 7, Estimated 10 | R3 |
| MCL-E-705G Type LH | Low CTE type LH | Datasheet 7, Estimated 10 | R3 |
| MCL-E-770G Type R | Halogen-free, high Tg, low CTE | Datasheet 5, Estimated 12 | R31 |
| MCL-E-770G Type RLH | Very low CTE type RLH | Datasheet 5, Estimated 12 | R31 |
| Panasonic R-1515W | MEGTRON GX / LEXCM GX, high-elasticity low-CTE core | Datasheet 5, Estimated 12 | R32 |
| Panasonic R-1515A | MEGTRON GX / LEXCM GX, low-CTE core | Datasheet 5, Estimated 12 | R33 |
| MGC HL832NS | Mitsubishi Gas Chemical BT laminate, low CTE | Datasheet 6, Estimated 11 | R34 |
| MCL-E-705G Type X | Low CTE type X | Datasheet 7, Estimated 10 | R3 |
| MCL-E-705G Type L | Low CTE type L (low-CTE glass cloth) | Datasheet 7, Estimated 10 | R3 |
| MCL-E-700G Type R | Standard-CTE FC-BGA and FC-CSP core, good drillability | Datasheet 7, Estimated 10 | R50 |
| Panasonic R-1515V | LEXCM GX, low-CTE glass cloth | Datasheet 3, Estimated 14 | R61 |
| Panasonic R-1515K | LEXCM GX, low-CTE core | Datasheet 3, Estimated 14 | R61 |
| Panasonic R-1515E (R-151YE) | LEXCM GX, high-elasticity low-CTE ultra-thin core | Datasheet 6, Estimated 11 | R61, R62 |
| MGC HL832NX type A | BT laminate, halogen free (standard) | Datasheet 6, Estimated 11 | R34 |
| MGC HL832NS type LC | BT laminate, low-CTE glass | Datasheet 6, Estimated 11 | R34 |
| MGC HL832NSR | BT laminate, low CTE, low shrinkage | Datasheet 6, Estimated 11 | R34 |
| MGC HL832NSR type LCA | BT laminate, ultra-low CTE | Datasheet 6, Estimated 11 | R34 |
| MGC HL832NSF | BT laminate, high Tg, low CTE | Datasheet 6, Estimated 11 | R34 |
| MGC HL832NSF type LCA | BT laminate, high Tg, super-low CTE | Datasheet 6, Estimated 11 | R34 |
| MGC HL832NSA type LCA | BT laminate, very high Tg, near-zero CTE | Datasheet 6, Estimated 11 | R34 |
| MGC HL972LF type LD | Low-Dk laminate for packages | Datasheet 6, Estimated 11 | R34 |
| MGC HL972LFG | Low-Dk laminate for packages | Datasheet 5, Estimated 12 | R34 |
| MGC HL972LFG type LD | Low-Dk laminate for packages | Datasheet 5, Estimated 12 | R34 |
| Shengyi SI10U | IC substrate laminate | Handbook 4, Estimated 13 | R63 |
| Shengyi SI10U LC | IC substrate laminate, low CTE | Handbook 4, Estimated 13 | R63 |

**Solder resist** (7)

| Material | Grade | Confidence of properties | Sources |
|---|---|---|---|
| PSR-4000 AUS703 | Taiyo, FC package grade | Datasheet 3, Estimated 6 | R4 |
| PSR-4000 AUS320 | Taiyo, liquid photoimageable | Datasheet 3, Estimated 6 | R35 |
| PSR-4000 AUS308 | Taiyo, liquid photoimageable (package substrate) | Datasheet 3, Estimated 6 | R56 |
| Taiyo AUS AZ1 | Liquid solder resist for FC-xGA | Datasheet 3, Estimated 6 | R57 |
| Taiyo PSR-800 AUS SR3 | Dry film, high modulus, low CTE (FC-CSP, memory) | Datasheet 4, Estimated 5 | R57 |
| Resonac SR7300 / SR-F | Photosensitive solder resist for package substrates (liquid or film) | Datasheet 3, Estimated 6 | R58 |
| Typical package solder resist | Generic liquid photoimageable epoxy-acrylate resist | Handbook 6, Estimated 3 | R4, R35, R56, R57, R58 |

**Underfill** (19)

| Material | Grade | Confidence of properties | Sources |
|---|---|---|---|
| ECCOBOND UF 9000AE | Henkel LOCTITE, large-die FCBGA capillary underfill | Datasheet 6, Estimated 3 | R5 |
| ECCOBOND UF 8830S | Henkel LOCTITE, flip chip capillary underfill (MSL 2a/3) | Datasheet 5, Estimated 4 | R26 |
| ECCOBOND FP4549 | Henkel LOCTITE, high-purity flip chip underfill | Datasheet 4, Estimated 5 | R27 |
| ECCOBOND FP4530 | Henkel LOCTITE, snap-cure flip chip underfill | Datasheet 4, Estimated 5 | R28 |
| NAMICS U8410-73C | For low-k, Pb-free bumps and tight spaces | Datasheet 3, Estimated 6 | R29 |
| NAMICS U8410-302 | For low-k, Cu pillar and Pb-free bumps | Datasheet 3, Estimated 6 | R29 |
| NAMICS U8410-377 | Low viscosity; for tight spaces | Datasheet 3, Estimated 6 | R29 |
| ALPHA HiTech CU21-3240 | MacDermid Alpha, board-level capillary underfill | Datasheet 4, Estimated 5 | R30 |
| Typical FCBGA capillary underfill | Generic silica-filled epoxy (about 50 to 70 wt% filler) | Handbook 6, Estimated 3 | R5, R26, R27, R29, R65 |
| ECCOBOND UF 9000AG | Henkel LOCTITE, low-CTE high-Tg large-die FCBGA underfill | Datasheet 6, Estimated 3 | R47 |
| ECCOBOND UF 8807 | Henkel LOCTITE, high-Tg fast-cure flip chip underfill | Datasheet 4, Estimated 5 | R49 |
| ECCOBOND FP4531 | Henkel LOCTITE, snap-cure flip chip underfill | Datasheet 4, Estimated 5 | R48 |
| NAMICS U8443-14 | Low viscosity; for tight spaces | Datasheet 3, Estimated 6 | R29 |
| NAMICS U8410-73CF3 | For low-k, Cu pillar and Pb-free bumps and tight spaces | Datasheet 3, Estimated 6 | R29 |
| NAMICS U8410-99 | For low-k, Pb-free bumps | Datasheet 3, Estimated 6 | R29 |
| NAMICS U8439-1 | For low-k and large ICs | Datasheet 3, Estimated 6 | R29 |
| NAMICS U8439-105 | For low-k, large ICs and tight spaces | Datasheet 3, Estimated 6 | R29 |
| Panasonic CV5300 | Capillary underfill, narrow gap and pitch (1 um filler) | Datasheet 3, Estimated 6 | R64 |
| Panasonic CV5350 | Capillary underfill, high Tg (5 um filler) | Datasheet 3, Estimated 6 | R64 |

**Lid and stiffener adhesive** (6)

| Material | Grade | Confidence of properties | Sources |
|---|---|---|---|
| ECCOBOND 3005 | Henkel LOCTITE silicone lid / stiffener attach | Datasheet 4, Estimated 2 | R6 |
| DOWSIL EA-7100 | Dow, one-part heat-cure silicone adhesive | Datasheet 2, Handbook 1 | R42 |
| ABLESTIK 8700E | Henkel LOCTITE, Ag-filled epoxy (conductive lid or component attach) | Datasheet 5, Estimated 4 | R43 |
| Typical epoxy stiffener adhesive | Generic rigid epoxy | Handbook 6, Estimated 3 | R43, R44 |
| Dow Corning EA-6700 | One-part heat-cure silicone, microelectronic lid attach | Datasheet 1, Handbook 1, Estimated 1 | R70, R71 |
| DOWSIL 3-6265 Thixotropic | One-part heat-cure silicone lid seal adhesive | Datasheet 2, Handbook 1 | R71 |

**TIM1** (4)

| Material | Grade | Confidence of properties | Sources |
|---|---|---|---|
| Silicone gel TIM (generic) | Generic | Literature 2, Estimated 1 | R12, R45 |
| Indium TIM | Metal TIM | Datasheet 3 | R46 |
| Soft TIM (grease or phase-change, near-decoupled) | Generic | Literature 2, Estimated 1 | R45 |
| DOWSIL TC-4515 | Dow, soft thermally conductive gap filler | Datasheet 2, Estimated 1 | R72 |

**Lid, stiffener and substrate metal** (17)

| Material | Grade | Confidence of properties | Sources |
|---|---|---|---|
| Copper | Electroplated / foil; Ni-plated for lids | Literature 3 | R8 |
| AlSiC-9 | CPS Technologies | Datasheet 3 | R7 |
| AlSiC-12 | CPS Technologies | Datasheet 3 | R7 |
| Stainless steel 304 | Austenitic, stiffener option (EN 1.4301) | Datasheet 2, Handbook 1 | R66 |
| Copper C10200 / C11000 (wrought) | Oxygen-free or ETP copper sheet for lids and stiffeners | Handbook 3 | R41 |
| Aluminum 6061-T6 | Stiffener or lid option | Datasheet 3 | R36 |
| Stainless steel 430 (SUS430) | Ferritic, common stiffener material | Datasheet 2, Handbook 1 | R37 |
| Kovar (ASTM F-15) | Fe-Ni-Co low-expansion alloy | Datasheet 2, Handbook 1 | R38 |
| Copper-tungsten W90Cu10 | WCu10 heat spreader / lid | Datasheet 2, Estimated 1 | R39, R40, R68 |
| Copper-tungsten W85Cu15 | WCu15 heat spreader / lid | Datasheet 2, Estimated 1 | R39, R40, R68 |
| Stainless steel 316 | Austenitic Mo-bearing (EN 1.4401), stiffener option | Datasheet 2, Handbook 1 | R66 |
| Alloy 42 (Fe-42Ni) | Low-expansion alloy, lid or stiffener option | Datasheet 2, Estimated 1 | R67 |
| Nickel 200 | Commercially pure nickel (reference for Ni-plated lids) | Datasheet 3 | R67 |
| Copper-molybdenum Cu35Mo65 | CuMo heat spreader or lid (wt%) | Datasheet 2, Estimated 1 | R68 |
| CPC141 (Cu / CuMo / Cu) | A.L.M.T. laminated heat spreader | Datasheet 2, Estimated 1 | R68 |
| Copper-tungsten W80Cu20 | WCu20 heat spreader / lid (wt%) | Datasheet 2, Estimated 1 | R68 |
| Aluminum 6063-T6 | Extruded stiffener option | Datasheet 2, Handbook 1 | R69 |

Sources were read directly where the publisher allows it: manufacturer data sheets and product pages (Henkel, NAMICS, Panasonic, Resonac, Mitsubishi Gas Chemical, Taiyo, Dow, CPS, Carpenter, Special Metals, Outokumpu, Kyocera), archived copies where a page has moved, and peer-reviewed papers for solder constitutive data. Values reproduced by a review or a third-party site are labelled Literature or Handbook rather than Datasheet. Above-Tg (rubbery) moduli, Poisson ratios and through-thickness core CTEs are rarely published; where they are missing they are estimated, the estimate rule is stated in the property note, and the value is flagged Estimated. Replace Estimated values with your own DMA and TMA data before trusting absolute numbers.

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
| `src/ui/00-app.js`, `00b-tips.js`, `00c-layout.js`, `00d-glossary.js`, `01-plot.js` | App state, worker client, field helpers, tooltip dictionary and element, resizable panes and plot edge grips, glossary and automatic term linking, 2D plots and colour maps |
| `src/ui/02-floorplan.js`, `03-panels.js`, `04-results.js`, `04b-section.js`, `05-main.js` | Floorplan and cross-section editor, the six step panels, results views and report, the cross-section stress view, shell and wiring |
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
- The temperature sweep and the bump submodels run in parallel on nested helper workers (birth states, respectively cycling fields, are transferred); the worker count is a run setting (Parallel workers in step 6, offered up to the CPU core count divided by 1.5, rounded down) and also sizes the sensitivity worker pool.
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
12. **Estimated material values** (rubbery moduli of ABF and solder resist, polymer Poisson ratios, core through-thickness and shear moduli, TIM gel) are flagged in the materials editor, listed in the run panel and report, and included in the default sensitivity set. SAC387 has measured elastic, CTE and solidus data with SAC305 Anand placeholders; the SAC405 Anand set comes from water-quenched specimens and overstates the strength of reflowed bumps. Above-Tg (rubbery) moduli of most underfills, adhesives and solder resists are not published and are estimated as a fixed fraction of the glassy modulus; through-thickness CTEs of most cores are not published and are taken from MCL-E-795G or HL832NS. Core in-plane CTE is held at its below-Tg value even where a data sheet gives a lower above-Tg value (MGC BT laminates), which matters only above the core's TMA Tg (200 to 270 °C).

## Known issues and next steps

- **Performance targets are still missed** by 1.6× to 2.4× (Standard, submodels; Fine not measured end to end). Candidates: WebAssembly or SIMD kernels for the matrix-vector product and the column smoother, a sparse direct solver for the 13k-DOF submodel, and fewer sweep temperatures when no Tg lies in the range.
- **Fine preset** full analysis has not been timed; V10 covers its accuracy against Standard.
- **JEITA sign on ring and saddle surfaces** is inherently fragile (the lidded default at 25 °C is a ring profile); the shape class, the sign-confidence metric and the magnitude curve are shown so the user can judge. A customer-specific sign rule could be added as an option.
- **Peak memory grows with the worker count** (each helper holds its own model copy); the run panel shows the estimate.
- **3D view** has been exercised only against the local three.js stub in the sandbox; a check in a browser with CDN access is still worthwhile.
- **Possible future work**: mesh-independent corner metrics across presets (currently fixed physical patches), a warpage-only fast mode for sensitivity, calibrating effective stress-free temperatures against measured warpage, and an optional viscoelastic underfill model.
