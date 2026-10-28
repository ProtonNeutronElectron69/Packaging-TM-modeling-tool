# FCBGA Thermomechanical Screening Tool

A self-contained, single-file browser application (also packaged as a Windows desktop app for large runs) that performs approximate 3D finite-element thermomechanical stress and warpage analysis of flip chip ball grid array (FCBGA) packages: SAC solder flip chip bonded silicon dies on a multilayer organic build-up substrate with a glass-fiber core, capillary underfill, and an optional hat lid or stiffener ring. Besides monolithic dies, the substrate can carry stacked modules (Foveros-S or CoWoS-R style): a Si base die or interposer, or an organic RDL interposer, with one layer of chiplets on die-to-die microbumps, wafer underfill and wafer mold.

**Screening tool. Results are approximate and intended for design comparison and trend studies, not sign-off.**

The full specification the tool is built against is in [`CLAUDE.md`](CLAUDE.md).

## Using the tool

The tool is used as the Windows desktop app (see "Desktop app (Windows)" below), which runs the analysis in compute processes bounded only by the computer's memory. The same page also runs in a browser: open `dist/fcbga_thermomech_tool.html` in a current Chromium-based browser (Chrome, Edge) or Firefox; this is the quickest way to try a change, and the smoke tests use it. Everything runs locally; nothing is uploaded. The only external resource is three.js (for the 3D view), loaded from cdnjs with jsdelivr and unpkg as fallbacks; when none can be reached the 3D view is hidden and every other feature keeps working.

Workflow (left stepper):

1. **Package**: substrate outline, layer stack (with an N-2-N generator), BGA field, configuration (bare die, lid, stiffener). Presets from Section 12 of the specification load in one click.
2. **Dies, modules and floorplan**: monolithic dies and stacked modules with their properties and bump fields; drag dies, modules and chiplets on the floorplan (a chiplet moves within its module; R rotates the selection, Delete removes it), with snapping and live clearances. A stacked module has one base (Si base die or interposer with an optional TSV Cu fraction, or an organic RDL interposer given as a layer table) on the flip chip bumps and one layer of chiplets on DDI microbumps (Cu pillar plus solder cap); every chiplet has the package-wide chiplet thickness, and every module the package-wide DDI microbump. Wafer mold fills each module out to the base edge, flush with the chiplet backsides. Moving dies starts no analysis; the warpage overlay is hidden while the geometry differs from the last results. Run the analysis from step 6 (full, or Quick preview on the Draft mesh).
3. **Underfill, lid, stiffener** geometry, and for stacked modules the die-to-die fill: wafer underfill (wCUF) in the DDI gap with its own fillet width and height plus wafer mold, or wafer mold only (molded underfill).
4. **Materials**: the cited database (106 materials, see "Materials database" below) with confidence badges, datasheet ranges, source tooltips, E(T) and CTE(T) plots, duplicate / reset.
5. **Process and loads**: stress-free temperatures (with stacked modules also the chiplet join, wafer underfill cure and wafer mold cure, before the substrate stage), reflow sweep, JESD22-A104 cycling, limits and fatigue constants.
6. **Run and results**: fidelity preset, parallel worker count with the memory estimate, estimated DOF / memory / runtime, run controls, baseline pinning, mesh sensitivity check, the list of Estimated inputs in use, CSV export and printable report. Results views (center area): warpage (JEITA ED-7306 sign convention), die stress (every die, chiplet and Si base), bump loading (flip chip bumps, and for stacked modules the DDI microbumps at the end of chiplet join and as assembled), underfill interface tractions (flip chip underfill, and the wafer underfill or mold at every chiplet), cross-section stress (click a horizontal or vertical line on the package and see any stress component on the vertical cut under it, from the top solder resist to the package top, zoomable, with an element mesh overlay and a CSV export), solder fatigue screening and bump submodels, submodel cross-section (the underfill, solder, die and substrate slice stress on a vertical cut through a bump submodel at the end of each ramp and dwell of the last cycle, as the change from the as-assembled 25 °C state, with the underfill or solder coloured and the rest grey, a voxel mesh overlay and a CSV export), 3D view (every part drawn as a closed surface, so hiding the lid or the substrate shows the full die, TIM, underfill and bump volumes, with an element mesh overlay on the faces of the shown parts), sensitivity tornado charts, verification suite.

While a job runs, the status bar at the bottom shows a coloured dot, the current step, a progress bar, the elapsed time with an estimate of the time left, Details and Cancel. The dot is green while everything converges at the usual rate, orange when a step is taking longer than usual (a solve needs more than 3 times the run's average PCG iterations, the solver switched preconditioner, a bump submodel is cutting back its time step, or nothing was heard for 30 s) and red when the run is likely stuck (a residual has not halved over the last 500 PCG iterations, a solve is close to the 2000-iteration limit, or a worker inside a solve has sent nothing for 60 s); the status text then says which solve and why. Details (or a click on the dot) opens a panel, updated once a second, with the steps of the job and their times, one row per worker with its current solve or submodel step (PCG iterations, residual, how far the residual has fallen toward the 1e-8 target, age of its last report), the residual history of the selected worker and a log of finished solves, rebuilds and warnings.

Every pane can be resized by dragging: the step list and the context panel (vertical splitters), the split between the floorplan and the cross-section, the 3D view (grip below it), and each plot or map (drag its bottom edge). Fields, dropdowns, tables and plots follow the new size; double-click a splitter or edge to restore its default. A narrow step list shows step numbers only.

In the Results area every plot, contour map and tornado chart zooms with the mouse wheel about the pointer; drag to pan once zoomed and double-click to show everything again (the page scrolls normally when the pointer is outside a plot). Contour maps, bump maps, the floorplan overlay and the 3D view use a rainbow colour scale by default (purple for low values through blue, green, yellow and orange to red for high; signed quantities put zero at mid-scale). The "colors" dropdown in the Results bar switches to the colorblind-safe scales (viridis and blue-white-red).

A glossary ("A–Z" in the top bar, or "Glossary" under the step list) spells out every technical acronym and variable symbol with a short description; trade-name acronyms of materials are not listed. Wherever such a term appears in the tool it is underlined with dots: hovering it shows its meaning, and clicking it opens the glossary at that entry. Terms drawn inside plots and maps (canvas text) are not linked. The printable report ends with the glossary.

Configurations are saved and loaded as JSON files. `localStorage` holds only conveniences: the theme, the last step and tab, the pane sizes and the colour scale.

Results are saved as one **results file** (extension `.fcbgares`): Save results in step 6 writes every result in memory, that is the configuration, the analysis results with every temperature already viewed, the cross-sections, the bump screening and submodels (with their cross-section snapshots), the pinned baseline, the last sensitivity and verification runs and the view settings, together with the analysis behind the results (the displacement increment of every thermal-path step, 4 bytes per DOF per step: about 140 MB for the default lidded package at Standard, plus the results). Open results file (steps 1 and 6, or drop the file on the window) replaces the current configuration and results with the file's, shows the saved views at once and rebuilds the analysis in the worker from the configuration and the saved increments without solving, after which other temperatures, cross-sections and new submodels work as after the original run. A temperature evaluated for the first time after reopening sums the single-precision increments, so it can differ from the original session by up to about 1e-7 relative (1e-8 in the checks). A file saved while the analysis was not in memory (after a cancelled job or a stopped compute process) holds the results only; a file whose configuration this version of the tool meshes differently opens with its results but not its analysis. In both cases Restore analysis re-runs the analysis. Files written by a newer version of the tool are refused.

### Desktop app (Windows)

The same tool also comes as a Windows desktop app, for runs that need more memory than a browser tab allows. In a browser every parallel worker lives inside one tab, each holds its own copy of the model (0.76 GB per helper and 2.1 GB for the main worker on the default package at Standard), and the browser stops a tab that grows past its memory allowance (around 10 GB has been seen in Edge and Brave), which ends the run. The desktop app shows the same page in its own window but runs each worker as a separate compute process on the computer, so the analysis can use all of its memory and cores.

- **Getting it.** The "Desktop app (Windows)" GitHub Actions workflow builds one file on a Windows machine: `FCBGA-Screening-Tool-Portable-<version>.exe`, which runs without installing (it unpacks itself on each start, so it opens a few seconds slower). Up to desktop-v1.0.2 the releases also carried an installer (`FCBGA-Screening-Tool-Setup-<version>.exe`); it is no longer built. Every merge to `main` that changes the app (the built page, `desktop/` or the workflow) publishes a new release by itself, about 5 minutes later: the latest version is always at the top of the repository's Releases page (right-hand column of the repository's main page), with its `.exe` file under Assets and the merged pull requests listed in its notes. Versions count up one patch step per release (1.0.1, 1.0.2, ...); raising the version in `desktop/package.json` (for example to 1.1.0) makes the next release use it. A manual run from the Actions tab (Run workflow) builds without releasing, or publishes the release tag entered in its form. To build on a Windows computer instead: install Node.js 22 or later, then `cd desktop`, `npm install`, `npm run dist`; the file lands in `desktop/release/`.
- **First start.** The app is not code-signed, so Windows SmartScreen shows "Windows protected your PC"; choose More info, then Run anyway. A signing certificate would remove the warning.
- **What is the same.** Every screen, input and result: the app loads the built page (`dist/fcbga_thermomech_tool.html`) and its compute processes run the page's own physics code, so results match the browser version (the checks compare them).
- **What is different.** The run panel shows "Compute engine: desktop app" with the computer's memory and core count, and warns when the memory estimate approaches the computer's memory. The 3D view uses a bundled three.js, so it works offline. Saving a configuration, a CSV or a results file asks where to save it. File > Open results (Ctrl+O) and File > Save results (Ctrl+S) open and save results files; starting the program with a results file (Windows "Open with", or dropping the file on the program file) opens it. The portable program registers no file type, so a double-click on a `.fcbgares` file needs Open with once (choose the program file); after a new version is downloaded under another file name, choose it again. File > Print and File > Save as PDF print the focused window (the main window or the report). Web links (material sources) open in the default browser. If a compute process stops unexpectedly (most often when the computer runs out of memory), the results already shown stay, a notice offers Restore analysis, and the next job starts a fresh process.
- **Limits.** The computer's memory is still the ceiling: on the default lidded package a full analysis takes about 2.1 GB for the main worker and 0.76 GB per helper at Standard (3.6 GB on 3 workers), and an estimated 4.9 GB and 1.6 GB at Fine (8 GB on 3 workers); the run panel shows the estimate for the current package before every run. WebGL (graphics acceleration) is needed for the 3D view, as in a browser.

## Project status

The specification in `CLAUDE.md` is implemented in full. Thirty-eight pull requests are merged on `main`:

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
| [#21](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/21) | 2026-10-15 | Material dropdowns in steps 1 to 3 sorted from fewest to most Estimated values and coloured green (none), orange (1 to 4) or red (5 or more), with the count in brackets and a legend; the glass-transition smoothing widths are not counted (doubling them moves RT and peak warpage and die stress by under 0.5 %) |
| [#22](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/22) | 2026-10-16 | At least 4 element layers through every region (bump underfill, fillet, dies, TIM, lid, adhesives, stiffener; substrate groups split into 4 bands each), DOF caps 75k / 330k / 600k to keep the in-plane element sizes; continuous fillet wedge (partly filled cells scaled by their volume fraction, up to 6 columns), drawn as a triangle in the cross-section view; runs about 5 to 6 times longer (Standard full analysis 867 s) |
| [#23](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/23) | 2026-10-18 | Documentation: hand-off notes for the next session ("Where to pick up" in CLAUDE.md), verify and smoke-test run times after the mesh refinement, repository layout and modeling summary refreshed, in-app limitations text updated for the twelve substrate bands |
| [#24](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/24) | 2026-10-18 | TIM back to one element layer (the other regions keep at least four): four TIM layers changed no result by more than 0.3 % on the default lidded package and raised the lid-stage PCG iterations (55 and 38 to 76 and 48); stage chain plus 25 °C about 17 % faster at a fixed in-plane grid |
| [#25](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/25) | 2026-10-18 | Submodel cross-section stress view: each bump submodel stores its stress field at the end of each ramp and dwell of the last cycle, shown on a vertical cut along x or y through the pitch cell (underfill or solder coloured, the rest grey; any stress component, voxel mesh overlay, plan view to place the cut, CSV export; change from the as-assembled 25 °C state); element mesh toggle in the 3D view |
| [#26](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/26) | 2026-10-19 | Windows desktop app (Electron): the page runs in its own window and every worker is a separate compute process on the computer (running the page's own core and driver, helpers as worker threads), so runs are no longer bounded by the browser's per-tab memory allowance (Edge and Brave stopped at about 10 GB); installer and portable exe built by a GitHub Actions workflow on Windows; a stopped compute process is reported with Restore analysis; bundled three.js; 3D view shows a message when WebGL is missing; desktop smoke test and compute-process check |
| [#27](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/27) | 2026-10-19 | Desktop workflow publishes a GitHub release from a manual run (release_tag and release_target inputs; the workflow's token creates the tag), used for desktop-v1.0.0 on the PR 26 merge |
| [#28](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/28) | 2026-10-20 | Desktop app published automatically: every merge to main that changes the built page, desktop/ or the desktop workflow builds the installer and portable exe and publishes a GitHub release (next patch version after the latest desktop-v* tag, or the raised desktop/package.json version; tools/desktop-version.mjs), with the merged pull requests in its notes |
| [#29](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/29) | 2026-10-21 | Live run progress: status-bar dot (green running, orange slow, red likely stuck), progress bar, elapsed and remaining time, and a Details panel updated once a second (steps with times, one row per worker with its PCG iterations and residual or submodel step, residual history, log); core live reports throttled to 1 s, helpers report on their own message ports; desktop compute process split into a relay thread and a driver thread; 3D view draws faces between parts so the full die, TIM and underfill volumes show |
| [#30](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/30) | 2026-10-21 | Desktop app built and released as the portable exe only (the installer is no longer built; desktop-v1.0.0 to v1.0.2 keep theirs) |
| [#31](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/31) | 2026-10-26 | Incremental thermoelasticity dσ = D(T)(dε − α dT) along the temperature path in place of the secant form (steps of at most 30 °C, 10 °C near a Tg, one solve each with a fresh preconditioner, spread over the workers; stresses from per-element histories; submodel elastic parts incremental too); column solder phase (axial and shear stiffness only) and free-standing column screening; lid foot and stiffener ring edges refined to h_min after the DOF cap (lidded default 506k DOF at Standard); submodel cross-section total-stress option; Fine cap 850k (1.18M DOF, h_min 0.138 mm); run-panel memory estimate fitted to measured peaks; V16 (suite 16/16); full Standard 912 s, 3.6 GB on 3 workers |
| [#32](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/32) | 2026-10-26 | Results file (.fcbgares): one binary file holds the configuration, every result in memory (temperatures viewed, cross-sections, screening, bump submodels, baseline, sensitivity, verification), the view settings and the analysis behind them (every thermal-path step increment, Float32), so reopening rebuilds the analysis without solving; Save and Open in steps 1 and 6, drop on the window, desktop File menu (Ctrl+O, Ctrl+S) and a file on the command line; increments sent in 64 MB blocks; V17 round-trip test (suite 17/17); submodel plan view no longer draws before layout |
| [#33](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/33) | 2026-10-26 | Cleanup before the next major update: unused code removed (the earlier assembly path's element and BCSR helpers, R_GAS, workerPool; page 827 to 821 kB); tools/desktop-run.mjs (one full analysis in a desktop compute process with time and peak memory, for refitting the run panel estimates); CLAUDE.md checklist for the next major update (reference values, results file compatibility, fitted constants, desktop version, checks); README brought up to date (desktop app as the way the tool is used, memory, helper scheduling, repository layout) |
| [#34](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/34) | 2026-10-27 | Stacked modules, part 1: Si-base (base die or Si interposer, optional TSV Cu) and organic RDL-interposer modules with one layer of chiplets on DDI microbumps (Cu pillar and solder cap in series), wafer underfill plus mold or mold only; floorplan editing of modules and chiplets; module process stages before the substrate stage, each module free on its own support; die stress on every chiplet and Si base; wafer mold and RDL dielectric materials (106 materials); three illustrative presets; h_min stops at the preset h_max when the cap cannot be met; V14 extended, V18 (suite 18/18); results file format 2; desktop 1.1.0; module packages need about 2 to 3 times the PCG iterations per step |
| [#35](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/35) | 2026-10-27 | Stacked modules, part 2: DDI microbump loads as assembled and at the end of chiplet join (a 'ddi' branch of the thermal path, the joined module cooled to 25 °C before its fill), microbump screening with each joint a solder cap on an elastic Cu pillar in series (at most 5000 sites per chiplet), wafer underfill (or mold) tractions at every chiplet; C4 / DDI layer toggles in the bump, underfill and fatigue views, floorplan overlays, report and CSV sections; the cross-section view draws the mold above the wCUF wedge; V18 extended; monolithic results unchanged |
| [#36](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/36) | 2026-10-27 | Documentation: accuracy over speed recorded as a standing rule at the user's request (speed-ups only when they leave the results unchanged, with before and after reference values in the PR); fewer or longer thermal-path steps and a larger submodel step dropped from the open items |
| [#37](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/37) | 2026-10-27 | One colour per material in the floorplan, section sketch and 3D view (all silicon blue, all underfill orange, lid and stiffener grey, RDL interposer light brown, wafer mold dark grey), colour key under the section, die and chiplet labels that fit their boxes, floorplan readout moved under the floorplan, section names over each die and module with seamless fills and a 240 px default height, grid and rulers kept inside the substrate |
| [#38](https://github.com/ProtonNeutronElectron69/Packaging-TM-modeling-tool/pull/38) | 2026-10-27 | End-of-run dialogs: a summary when a run finishes (total time, mesh, workers, solves, PCG iterations, solver time, screening, RT warpage, step times; warning banner for failed tests or unconverged solves) and the cause when it fails, crashes (worker or compute process died) or is cancelled (where it stopped, what is kept, Restore analysis, what to try, last log lines); helper solve records carry converged and fallback |

Open items are listed under "Known issues and next steps" below. The largest is performance against the Section 13 targets.

## Materials database

`src/materials-db.json` holds 106 materials. Every property carries a confidence label (Datasheet, Literature, Handbook, Estimated) and its sources (reference ids R1 to R74, listed with URLs in the file and shown in the app's source tooltips). "Typical" entries are representative values drawn from the bundled data sheets, for trend studies. The confidence column counts the properties of each label.

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

**Wafer mold** (2, stacked modules)

| Material | Grade | Confidence of properties | Sources |
|---|---|---|---|
| Eternal EI-6042 | Liquid molding compound for wafer-level packaging and molded underfill (silica filled) | Datasheet 2, Estimated 4 | R73 |
| Typical wafer-level mold (generic) | Generic high-filler epoxy mold compound for chip-on-wafer molding | Estimated 9 |  |

**RDL interposer dielectric** (3, stacked modules)

| Material | Grade | Confidence of properties | Sources |
|---|---|---|---|
| HD MicroSystems HD-4100 | Photodefinable polyimide (solvent negative), RDL dielectric | Datasheet 4, Estimated 5 | R74 |
| HD MicroSystems HD-8820 | Photodefinable PBO (aqueous positive), RDL dielectric | Datasheet 4, Estimated 5 | R74 |
| HD MicroSystems HD-8930 | Low-temperature-cure PBO (aqueous positive), RDL dielectric | Datasheet 4, Estimated 5 | R74 |

The wafer underfill of stacked modules is chosen from the underfill list (default Panasonic CV5300, a narrow-gap grade with 1 µm filler); the DDI microbump solder from the solder list (default Sn-3.5Ag); TSV, RDL and Cu pillar copper is the substrate `cu` record. The EI-6042 data sheet gives the modulus at 25 and 150 °C only, so its drop through the glass transition is estimated; the selection guide that is the source of the RDL dielectrics gives one Tg without a method, used for both the modulus and the CTE transition.

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
| `src/core/01-util.js`, `02-config.js` | Helpers; default configuration, presets (Section 12 and the three stacked-module presets), substrate and RDL stack generators, stacked module, chiplet and package-wide stack defaults, `normalizeConfig()` for files from earlier versions, hashing, JSON round trip, JEITA and cycling tables |
| `src/core/03-materials.js`, `04-homogenize.js` | E(T) and CTE(T) forms on the 1 °C grid, cubic silicon rotated 45°, Voigt / Reuss / Turner layer mixing, substrate bands (`substrateBands()`, 3 groups x 4 bands) and their layered sections, bump profile and d_eff |
| `src/core/05-geometry.js`, `06-mesher.js` | Package geometry (objects on the bump layer: dies and module bases; chiplets, DDI fields, RDL bands, silicon parts for the die stress, fillet and wCUF wedges) and validation; structured extruded hex mesher with void cells, feature lines, size function, DOF cap (h_min stops at the preset h_max), at least 4 element layers per region (`zPlanes()`), partly filled fillet cells (`fillFraction()`), RDL layered sections per element layer, 3-2-1 constraints and each module's own support for its process stages |
| `src/core/07-element.js`, `08-sparse.js`, `09-assembly.js` | Incompatible-mode hex (closed-form box integration, distorted hex for the patch test), block CSR pattern, `FEModel` (step assembly `assembleStep()` with mean stiffness and exact thermal stress increment, element birth by stage, per-step recovery data and element stress histories `accumulateStep()`, `stateStress()`) |
| `src/core/10-solver.js` | Jacobi-scaled PCG, `MultigridPC` (column block Gauss-Seidel, shell aggregates, feature-preserving coarsening, banded coarsest Cholesky), `ICPC`, warm start, rebuild policy, live solver reports (`LIVE`, `liveReport()`) |
| `src/core/11-analysis.js` | The `Analysis` driver: evaluation temperatures, the thermal path (`buildPath()`, `solveStep()`, `finishPath()`, `restorePath()`), views of the solution at a temperature (`view()`, `StateView`), strain histories (`qAlong()`) |
| `src/core/12-post.js` | JEITA warpage with shape class and sign confidence, die stress, bump loads, underfill tractions, cross-section stresses (`sectionStress()`, `layeredPointStress()`), 3D face fields |
| `src/core/13-fatigue.js` | Anand point integrator, cycle history, screening, `BumpSubmodel`, Syed and Darveaux life models |
| `src/core/14-sensitivity.js`, `15-verify.js` | Tornado inputs, bounds and cases; verification tests V1 to V18 |
| `src/core/16-results-file.js` | Results file (`.fcbgares`) container: encode and decode a value tree with typed arrays, Maps, Sets and non-finite numbers; the analysis state (step plan, mesh fingerprint, step increments) and its restore without solving |
| `src/worker.js` | Worker driver and nested helper workers (parallel sweep and submodels); live reports from each helper on a message port of its own |
| `src/ui/00-app.js`, `00b-tips.js`, `00c-layout.js`, `00d-glossary.js`, `00e-progress.js`, `01-plot.js` | App state, worker client, field helpers, tooltip dictionary and element, resizable panes and plot edge grips, glossary and automatic term linking, run progress (status dot, times, details panel), 2D plots and colour maps |
| `src/ui/02-floorplan.js`, `03-panels.js`, `04-results.js`, `04b-section.js`, `04c-subsection.js`, `05-main.js` | Floorplan and cross-section editor, the six step panels, results views and report (including the 3D view and its mesh overlay), the cross-section stress view, the submodel cross-section view, shell and wiring |
| `src/ui/04d-resultsfile.js` | Save results and open a results file (also by drop, and from the desktop File menu and command line) |
| `tools/build.mjs` | Concatenates `src/` into the single HTML file |
| `tools/verify.mjs` | Extracts the core block from the built file and runs the suite in Node |
| `tools/smoke.mjs`, `tools/three-stub.js` | Playwright / Chromium end-to-end test (with `--full`: full analysis, results file saved, page reloaded and the file reopened, every view), with a local three.js API stub for sandboxes that block CDNs |
| `tools/dev-core.mjs` | Loads `src/core` directly for ad-hoc experiments in Node |
| `desktop/main.js` | Desktop app (Electron) main process: the window, the compute processes (one per page worker, started, stopped and relayed on the page's request), menu with Open results, Save results, Print and Save as PDF, save dialogs, a results file named on the command line, external links |
| `desktop/compute-worker.js`, `desktop/core-source.js` | Compute process: runs the page's own core and worker driver (read from the built page) in Node; its main thread relays messages, the driver runs in a worker thread and its nested helpers are worker threads of the driver |
| `desktop/preload.js` | The page's end of the compute channel (`window.fcbgaDesktop`), isolated from the page |
| `desktop/package.json`, `desktop/stage.mjs`, `desktop/build/icon.png` | Versions (Electron 44.5.1, electron-builder 26.15.3, three.js 0.128.0), portable target; staging of the page and three.js into `desktop/app/`; app icon |
| `tools/desktop-run.mjs` | Full analysis of a preset package in a desktop compute process: wall time, DOF, PCG iterations and peak resident memory, for refitting the run panel's runtime and memory estimates |
| `tools/desktop-smoke.mjs`, `tools/desktop-check.mjs` | Desktop end-to-end test (Electron through Playwright: full analysis, submodels, results file saved through the File menu and reopened by a second launch with the file on its command line, every view, 3D with the bundled three.js, report window, a killed compute process) and a check of the compute process in plain Node against a direct run |
| `.github/workflows/desktop-windows.yml`, `tools/desktop-version.mjs` | Builds the Windows portable app on a Windows runner and publishes a release on every merge to `main` that changes the app (next patch version, or the raised `desktop/package.json` version); a build-only check on pull requests that touch `desktop/`; manual runs build, or release a given tag |

## Development workflow

```
node tools/build.mjs                       # writes dist/fcbga_thermomech_tool.html (always rebuild after editing src/)
node tools/verify.mjs                      # full verification suite headless in Node, V1 to V18 (about 1.5 h: V10 about 45 min with Fine at 1.18M DOF, V15 about 17, V8 and V9 about 8 each, V18 about 2)
node tools/verify.mjs V1,V2,V13            # selected tests
node tools/verify.mjs --presets draft      # V15 timing presets (default draft,standard)
node tools/smoke.mjs                       # Chromium: page load and Draft preview, zero console errors
node tools/smoke.mjs --full [--standard] [--workers 3] [--submodels]   # full analysis, every results view, 3D view, submodels (Draft about 5 min, Standard about 17 min; the four submodels about 21 min more)
cd desktop && npm install                  # desktop app: Electron, electron-builder, three.js (Electron itself downloads on first use)
npm start                                  # (in desktop/) run the desktop app from the sources (stages dist/ into desktop/app/ first)
npm run dist                               # (in desktop/, on Windows) build the portable app into desktop/release/
node tools/desktop-check.mjs               # compute process in plain Node: full Draft analysis on 2 helper threads versus a direct run (about 4 min)
xvfb-run -a node tools/desktop-smoke.mjs [--workers 3] [--submodels] [--exe path]   # desktop app end to end under a virtual display (about 5 min, 12 with submodels)
node tools/desktop-run.mjs standard default 3   # one full analysis in a compute process: time and peak memory (Linux; Standard about 15 min)
```

Rules that keep the three execution contexts consistent:

- `src/core/*.js` must stay free of DOM references; the same text runs on the UI thread, in the Web Worker (Blob URL) and in Node.
- Never edit `dist/` by hand; commit the rebuilt file with the sources.
- Every constant goes in `CONST`; large data lives in `Float64Array` / `Int32Array`.
- Every UI control gets a tooltip through `tip()`, `helpTip()` or `kl()` (dictionary `TIPS` in `src/ui/00b-tips.js`); numeric inputs go through `numField()` so bounds and plausibility ranges apply.
- Playwright is resolved from the repository or from `/opt/node-tools/node_modules`; Chromium is pre-installed in the cloud sandbox.
- The only CI workflow builds the Windows desktop app (and runs `tools/desktop-check.mjs` there); the headless suite and the smoke tests are the gate before a pull request.
- The desktop app must keep working from the built page alone: its compute processes read the `core` and `worker-driver` blocks from `dist/` (through `desktop/app/index.html`), and the page switches to them only when `window.fcbgaDesktop` is present, so the single HTML file behaves exactly as before in a browser.

## Modeling summary

- Structured, extruded hexahedral mesh with void cells; in-plane grid graded from h_min at the die edges and at the lid foot or stiffener ring edges; 8-node hexahedra with Wilson-Taylor incompatible modes (statically condensed); layered integration through the substrate sub-layers (12 bands); at least 4 element layers through every other region except the TIM (one layer); superposed solder / underfill phases in the bump layer, the solder phase as separate columns (axial and transverse shear stiffness only); fillet cells under the wedge surface partly filled (stiffness and load scaled by the filled volume fraction).
- Incremental (rate-form) thermoelasticity with element birth (substrate, chip join, underfill cure, lid or stiffener attach): dσ = D(T) (dε − α dT) integrated along the temperature path in steps of at most 30 °C (10 °C near the Tg of a born material), each one linear solve with the mean stiffness over the step and the exact integral of D dF as the thermal load (exact for a strain linear in T within the step; within 0.25 % of 2 °C steps on the bare-die chain), with a fresh preconditioner per step. The path runs down the process chain to 25 °C, then from 25 °C up to the reflow peak and down to the cycling minimum (plus the chip-join branch); stresses come from per-element histories built on demand.
- Stacked modules: the base (Si, with TSV Cu superposed by the Voigt rule, or an RDL stack integrated layer by layer), the DDI gap (microbump columns, a Cu pillar and a solder cap in series, superposed on the wafer underfill or mold), the chiplets and the wafer mold with the wCUF wedge (cells it cuts carry wCUF and mold by volume fraction) are meshed on the same structured grid. Each module goes through its own process stages first (negative stage numbers: chiplet join, wafer underfill cure, wafer mold cure, then to the substrate stress-free temperature) as a free body on a statically determinate three-point support, with the substrate and everything else unborn; it is then joined by its flip chip bumps in stage 1 like a die. Die stress is reported on every chiplet and Si base.
- Jacobi-scaled PCG with a multigrid preconditioner (column block Gauss-Seidel smoother on the 3D level, shell-type coarse levels built from per-column rigid-body-plus-thickness aggregates with Hermite deflection interpolation, feature lines kept at every coarse level, banded Cholesky on the coarsest level) and an IC(0) fallback (it no longer converges on the refined meshes); warm starts by Galerkin projection on previous solutions.
- The steps of the thermal path (independent solves; the main worker and its helpers take blocks of consecutive steps from a shared queue, and helpers return their displacement increments) and the bump submodels (cycling fields are transferred) run in parallel on nested helper workers; the worker count is a run setting (Parallel workers in step 6, offered up to the CPU core count divided by 1.5, rounded down) and also sizes the sensitivity worker pool.
- Post-processing per JEITA ED-7306 / JESD22-B112 (warpage, with a shape class and a sign-confidence metric from the diagonals), fixed-patch corner metrics, per-bump forces from the solder phase, interface tractions.
- Anand viscoplastic SAC305 with backward-Euler radial return and consistent tangent; bump screening across all sites with each joint as a free-standing column (axial and transverse shear strain from the bump layer, zero in-plane stress); one-pitch bump submodel with B-bar hexahedra, cut-boundary displacements, Newton-Raphson and incremental elastic parts, its cross-section optionally with the global 25 °C residual added; Syed and Darveaux life models.

See the in-app "Assumptions and limitations" panel for every modeling assumption and build decision.

## Verification status

Last headless run (Node 22, 4-core container, PR 34), 18 of 18 pass: V1 to V14 and V16 to V18 in one run of 59 minutes, V15 (the timing benchmark of the default package, whose code is unchanged) from its last run. `dist/verification.json` holds the full text of each measurement.

| ID | Test | Measured | Criterion | Result |
|---|---|---|---|---|
| V1 | Free thermal expansion | displacement error 3.3e-12 relative, stress 1.2e-13 × EαΔT | 1e-9 / 1e-8 | pass |
| V2 | Patch test, incompatible-mode hex, distorted mesh | displacement 6.8e-17, strain 6.5e-16 | 1e-9 | pass |
| V3 | Bimaterial plate curvature vs Timoshenko | 2.0692e-3 vs 2.0692e-3 1/mm (0.00 %) | 3 % | pass |
| V4 | Three-layer laminate vs classical lamination theory | kx 0.01 %, ky 0.17 % | 3 % | pass |
| V5 | Layered integration vs one element per layer | 104.25 vs 104.47 µm (0.21 %) | 1 % | pass |
| V6 | Anand saturation stress vs closed form | 42.04 / 22.81 / 13.02 MPa vs 42.09 / 22.83 / 13.04 | 1 % | pass |
| V7 | Submodel consistency with homogenized bump layer | 0.38 % (bump-layer domain, uniform phases, stepped with the global up branch); 0.83 % with the production domain, reported as information | 2 % | pass |
| V8 | Symmetry of the warpage field | 2.1e-10 (x), 2.2e-10 (y), 2.2e-11 (diagonal), 1.3e-10 mirrored | 1e-6 | pass |
| V9 | Physical sanity on the presets | bare RT +220 µm convex; backside +64 MPa tensile; 0.8 mm core 162 vs 280 µm; 795G LH 168 vs 705G 261 µm | all four | pass |
| V10 | Mesh convergence, Standard vs Fine | warpage 0.40 %, die interior peak 2.72 % (506k vs 1.18M DOF; peak 3.4 GB in one Node process) | 5 % | pass |
| V11 | Solver integrity (last process step S3 30 to 25 °C) | residual 8.4e-11, reactions 1.1e-10 of the force scale, energy balance 1.2e-13 | 1e-8 / 1e-9 | pass |
| V12 | JEITA sign and magnitude on synthetic domes | signs +1 / -1, magnitude error 0.0 | exact / 1e-9 | pass |
| V13 | Unit checks (Si CTE, rotated Si moduli, SAC305 E, AlSiC-9 strain, Turner, Voigt, Reuss) | all exact | 1e-9 (formulas), printed precision (rounded references) | pass |
| V14 | JSON save / load round trip, with and without stacked modules; a file from before stacked modules | identical hashes; geometry and process hashes unchanged | identical | pass |
| V15 | Timing benchmark | see below | report | pass |
| V16 | Underfill cooled through its Tg (165 to 25 °C) on the thermal path: free block; block held at its sides | free 9.0e-14 × EαΔT; held 45.52 vs 45.52 MPa exact (0.00 %); a secant form gives 125.47 MPa | 1e-8; 0.1 % | pass |
| V17 | Results file round trip (small bare-die package, full thermal path, 63 steps, 9.1k DOF since h_min stops at the preset h_max under its 6k cap) | warpage at 25 °C 1.2e-9, interpolated near 125 °C 8.9e-10; die stress map, CPI shear, cross-section and bump strain history identical; NaN, Infinity, Map, Set and typed arrays kept; changed mesh and truncated file refused | 1e-6 | pass |
| V18 | Stacked modules (small Si-base module, two chiplets, bare): uniform-CTE module through its process stages; module support reactions; package sign, silicon stresses, microbump loads and wCUF tractions; series microbump column against the closed form | max stress 2.17e-4 × EαΔT (the 1e-6 pull of the unborn bumps and underfill); reactions 7.95e-9 of the force scale; RT warpage +21.69 µm convex; chiplet backside 42.5 MPa, Si base top 60.5 MPa (whole-face Gauss-point peaks); worst microbump shear 23.7 mN, wCUF sidewall shear 4.25 MPa; series column 1.6e-13, in-plane 5.5e-14 | 1e-3; 1e-6; convex, finite; 1e-4, 1e-3 | pass |

## Measured performance

Headless Chromium on a 4-core cloud container with 3 workers, Section 13 targets in the last column. A 2023-class laptop should be somewhat faster per core. Since the through-thickness refinement (deviation 13) the meshes hold about 2.7 times the DOF at the same in-plane element sizes; since the incremental thermal path (deviation 15) a full analysis solves one step per piece of the path (67 on the default package instead of 42 evaluations), each with a fresh preconditioner and spread over the workers, and the lid foot edges are refined (deviation 17). Values before the incremental path are in brackets.

| Job | Measured | Target |
|---|---|---|
| Quick preview (Draft, step 6 button: the 15 process-chain steps; the drag preview was removed) | 58 s at 77k DOF on 3 workers (22 s for 4 solves at 74k on one) | none (drag preview target 2 s no longer applies) |
| Full Draft analysis (thermal path of 67 steps: process chain, chip-join branch, sweep to 260 °C and down to the cycling minimum) | 187 s at 77k DOF (163 s at 74k) | none |
| Full Standard analysis | 912 s at 506k DOF with the lid foot refined to h_min, in the desktop compute process on 3 workers (867 s at 302k); 913 s in Chromium with the edges at 1.5 × h_min (420k DOF) | 90 s |
| Full Fine analysis | not run end to end; at 1.18M DOF (850k cap, h_min 0.138 mm) expect well over an hour | 10 min |
| Screening over all 17,424 bumps of the default die (free-standing column, deviation 16) | 14 s (9 s) | 10 s |
| Four bump submodels of the default package, 16×16×14, 3 cycles | 1243 s on 3 workers, 650 s per corner bump with 1485 adaptive steps (286 s, 145 s per bump): the corner joints creep more (ΔW 0.40 MPa per cycle), so the step control on the inelastic strain increment takes about 2.5 times the steps | 120 s |
| Quick preview of the Foveros-S-like stacked-module preset (Draft, the 25 steps of the module stages and the process chain) | 1216 s at 112k DOF on one thread in Node (other jobs sharing the 4 cores); 17 to 633 PCG iterations per step, 288 on average (the default package's 15 preview steps: 22 to 97, 41 on average); RT warpage −59.2 µm, chiplet backside interior peaks 39 to 40 MPa | none |
| Sensitivity (Draft, default input set, worker pool) | not re-measured | 3 min |
| Peak memory at Standard | 3.6 GB for the desktop compute process with its two helper threads at 506k DOF (2.9 GB on 2 workers): 2.1 GB for the main worker, 0.76 GB per helper; Draft 367 MB on 1 worker, 811 MB on 3. The run panel estimate is fitted to these four runs | 600 MB |
| V15, process chain to 25 °C (15 steps), Draft 77k DOF | multigrid 81.7 s (iterations 22 to 97); IC(0) on the first step does not converge in 2000 iterations (53 s, residual 3.2e-6, then the multigrid fallback) | report |
| V15, process chain to 25 °C (15 steps), Standard 420k DOF (measured with the lid foot edges at 1.5 × h_min; 506k DOF now) | multigrid 455 s (iterations 18 to 116); IC(0) on the first step does not converge in 2000 iterations (411 s, residual 8.6e-6) | report |

Multigrid is the default preconditioner; on the refined meshes IC(0) no longer converges within 2000 iterations and is kept only as the first fallback. Multigrid PCG iterations per step of the thermal path on the lidded default at Standard: 0 to 116, 33 on average, with a fresh preconditioner per step and the warm start from the previous steps (before the incremental path: 37 to 74 for the stage solves and 30 to 180 in the temperature sweep).

## Deviations from the specification

Each is also listed in the in-app "Assumptions and limitations" panel.

1. **Multigrid coarse space.** Plain semi-coarsening with nodal interpolation stalled at 110 to 200 iterations, growing with refinement, because interpolated bending modes carry far too much shear energy on thin layered structures. The coarse levels use per-column shell aggregates (rigid-body plus thickness modes of each stiff stack, split at compliant layers) with Hermite deflection interpolation, keep die, lid and stiffener feature lines at every level, and finish with a banded Cholesky. Smoother, Galerkin products and warm starts are as specified.
2. **Full symmetric block matrix stored** instead of the upper triangle, for faster smoothing sweeps; memory stays within target.
3. **Element integration** uses a closed-form 12-point box rule, identical to 2×2×2 Gauss for single-material elements and to two Gauss points per sub-layer for layered elements.
4. **Layered sub-layer stiffness** uses the continuum-shell form (plane-stress in-plane block, uncoupled thickness modulus); one thickness strain shared across a band's sub-layers over-constrained the softer ones (V5 at 1.5 %, now 0.15 %).
5. **Preconditioner rebuild policy.** Every step of the thermal path gets a fresh preconditioner, because the polymer moduli change from step to step and a build costs only a few iterations' worth (about 0.6 s against 3 to 14 s per Draft solve); on the bare-die process chain this needs 2.8 times fewer PCG iterations than reusing one. Otherwise (the generic solver rule) a stale preconditioner gets a budget of twice its iterations per decade of residual reduction measured after its build, then is rebuilt mid-solve; a raw iteration budget failed with warm starts, which leave few iterations right after a build.
6. **Reflow sweep sampling** is 15 °C above the cycling range and 10 °C near a Tg, plus the report temperatures and the solidus; the 10 / 5 °C rule of Section 9.2 applies to the cycling samples.
7. **V7** is run on a bump-layer-only domain of uniform homogenized phases (solder columns plus underfill, as in the global bump layer), stepped through the same temperatures as the global up branch; the production domain with materially consistent silicon and substrate slices is reported as information.
8. **V11** is solved to 1e-10 to meet the 1e-9 reaction criterion; **V13** compares rounded reference values at their printed precision.
9. **Submodel Newton** refreshes the consistent tangent on the first iterations and on stalls, and freezes it while the residual shrinks (modified Newton); the inner PCG uses an inexact-Newton tolerance.
10. **No drag preview and no auto-solve on die release** (Section 4.3 asks for both). Removed at the user's request: moving a die starts no solve, and the floorplan overlay is hidden while the geometry differs from the results it was computed for. The analysis runs from step 6 (full, or Quick preview on the Draft mesh).
11. **Rainbow colour scale by default** (Section 4.8 asks for colorblind-safe, perceptually uniform maps). Changed at the user's request; the rainbow is neither colorblind safe nor perceptually uniform, so bright yellow and cyan bands can look like features. The colorblind-safe scales remain one click away in the Results bar.
12. **Estimated material values** (rubbery moduli of ABF and solder resist, polymer Poisson ratios, core through-thickness and shear moduli, TIM gel) are flagged in the materials editor, listed in the run panel and report, and included in the default sensitivity set. SAC387 has measured elastic, CTE and solidus data with SAC305 Anand placeholders; the SAC405 Anand set comes from water-quenched specimens and overstates the strength of reflowed bumps. Above-Tg (rubbery) moduli of most underfills, adhesives and solder resists are not published and are estimated as a fixed fraction of the glassy modulus; through-thickness CTEs of most cores are not published and are taken from MCL-E-795G or HL832NS. Core in-plane CTE is held at its below-Tg value even where a data sheet gives a lower above-Tg value (MGC BT laminates), which matters only above the core's TMA Tg (200 to 270 °C).
13. **Finer through-thickness mesh and larger DOF caps** (Sections 5.3 and 13). At the user's request every region has at least 4 element layers through its thickness: bump-layer underfill, fillet height, each die, lid plate and foot, adhesives, stiffener, and each of the three substrate groups (bottom build-up, core, top build-up), which are split into 4 layered bands each instead of 1, 2 and 1. The TIM was included at first and later put back to one layer at the user's choice: on the default lidded package at a fixed in-plane grid (h_min 0.25 mm), four TIM layers changed RT warpage, die stress, bump forces and the underfill tractions by under 0.3 % and raised the lid-stage PCG iterations from 55 and 38 to 76 and 48. The default lidded package goes from 14 to 28 z-planes. To keep the previous in-plane element sizes, also at the user's choice, the DOF caps are 75k / 330k / 850k (Draft / Standard / Fine) instead of 30k / 120k / 400k. Fine had a 600k cap at first, which kept it within browser memory but left its in-plane elements about 25 % larger than before (h_min 0.174 instead of 0.14 mm on the default package); since the user runs only the desktop app, the 850k cap restores h_min 0.138 mm (1.18M DOF on the lidded default with the lid foot refinement of deviation 17). Runs take longer accordingly (see Measured performance).
14. **Continuous fillet wedge** (Section 5.4 accepts a stair-stepped fillet). Fillet cells above the die active face carry their stiffness and thermal load scaled by the fraction of the cell below the wedge surface (sampled 4 × 4 in plane, exact in z; cells under 5 % filled are void), and the fillet width gets up to 6 columns (never narrower than half of h_min). The fillet therefore acts as a continuous wedge without sloped elements, and the cross-section stress view clips the shading to the wedge. Peel and shear right at the fillet surface remain approximate.

15. **Incremental thermoelasticity instead of the total (secant) formulation** (Section 6.5). The specified form σ = D(T) (ε − ε_birth − [F(T) − F(T_birth)]) applies the modulus at the current temperature to all the thermal contraction since birth. For a polymer cooled through its glass transition that is several times too stiff: an underfill held at its sides and cooled from its 165 °C cure to 25 °C gets 125 MPa from the secant form against 45.5 MPa from the exact integral of E(T) α(T) dT (V16), and at -55 °C the stiffener preset showed stiffener adhesive stresses near 290 MPa and the bare-die preset a nearly uniform underfill stress through the bump layer. Stress now builds up as dσ = D(T) (dε − α dT) along the temperature path: steps of at most 30 °C (10 °C within 15 °C of the Tg of a material born by that stage, stops at every evaluation temperature and at the solidus), each one linear solve K(D̄) Δu = ∫ Bᵀ (∫ D dF) dV with D̄ the mean stiffness over the step and the thermal load integrated exactly over the 1 °C property tables, so polymers carry their rubbery modulus for the contraction made while rubbery. The only approximation is a strain linear in T within a step: on the bare-die chain the 30 / 10 °C steps (14 solves) differ from 2 °C steps (96 solves) by at most 0.25 % in warpage, die stress, bump forces, interface tractions and layer stresses (30 / 30 °C steps: 2.6 %). Every step is an independent solve, so steps split across workers; a state at an evaluation temperature is the sum of the chain and the branch steps that lead there, and element stresses are rebuilt from per-element histories (strain polynomial and thermal term per sub-layer) when a view asks for them. Consequences: a full analysis needs more solves than before (one per step instead of one per evaluation temperature), and every warpage, stress and force value changes, polymer-dominated ones most.
16. **Solder phase as separate columns, and column screening** (Sections 6.3 and 9.1). The iso-strain solder phase gave the joints the die's full in-plane strain and an isotropic continuum stiffness, which made them stiffer in-plane than separate joints are, made the tension side of a corner joint follow the die rather than the gap, and hid the shielding of a joint by a neighbouring die. The solder phase now has axial stiffness E and transverse shear G only (no in-plane membrane stiffness, no Poisson coupling, a 0.1 % numerical floor), and the screening drives each joint's Anand point with the bump layer's axial strain (minus the solder thermal strain) and transverse shear strains while Newton iterations hold its in-plane stresses at zero. The bump forces come from the same column phase.
17. **Mesh refinement at the lid foot and stiffener ring edges, beyond the DOF cap** (Section 5.2). The in-plane grid is graded from h_min at those edges as well as at the die edges, because the adhesive and the top solder resist carry their stress concentration there and the ring region had only three elements across. The refinement grades from the same h_min as the die edges and is added after the DOF cap has set h_min, so it never coarsens the dies; ringed packages end with 1.45 to 1.56 times the cap DOF (lidded default: 506k at Standard, 1.18M at Fine; stiffener preset: 460k and 1.20M). Fine at that size needs more memory than a browser tab allows; the user runs the desktop app, whose compute processes are bounded only by the computer's memory. The run panel reports the refinement as information.
18. **Submodel cross-section with total stress** (Section 9.3 defines the submodel as a perturbation from the as-assembled state). Besides the change from 25 °C, the view can add the global as-assembled stress at 25 °C at each submodel element: silicon from the die, underfill from the underfill phase of the bump layer, the substrate slice from the sub-layer at that height; the solder counts as relaxed at 25 °C, as the submodel assumes. The residual is constant within each voxel and homogenized at the joint scale.

19. **Stacked modules** (beyond the specification, which excludes stacking, interposers and bridges; added at the user's request in two parts, PR 34 and PR 35). The design follows the user's answers to the clarifying questions: one base per module (Si base die or passive Si interposer, or organic RDL interposer), with its chiplets inside the base footprint (overhang is an error) and placed relative to the module; one layer of chiplets, all of one package-wide thickness; one package-wide DDI technology, microbumps only (Cu pillar plus solder cap, no hybrid bonding), with the base thickness set per module; a Si base with an optional TSV Cu fraction (BEOL not modeled); an RDL interposer as a layer table homogenized and integrated layer by layer like the substrate; wafer mold flush with the chiplet backsides (no overmold) out to the base edge; DDI fill either wafer underfill (with its own fillet width and height) plus mold, or mold only; the flip chip underfill fillet height as a fraction of the module height; the lid TIM over the whole module top; module process stages (chiplet join at the microbump solidus, wafer underfill cure, wafer mold cure) before the substrate stage, with each module free (the wafer before singulation and an RDL-first carrier are not modeled); at least four element layers through the base, the DDI gap and the chiplets under the existing rule (the user was asked whether the thin DDI gap and RDL could drop to two and kept the defaults); the new wafer mold and RDL dielectric materials with their estimated values flagged; three illustrative presets that are not product dimensions. During its process stages each module rests on a statically determinate three-point support (zero reactions under its self-equilibrated load, V18); the not-yet-born flip chip bumps and underfill below it still pull with 1e-6 of their stiffness, about 2e-4 of E α ΔT in the module stress. Results: warpage, die stress on every chiplet and Si base, the flip chip bump loads, screening and underfill tractions under each module base (part 1, PR 34); the DDI microbump loads at 25 °C and at the end of chiplet join (a 'ddi' branch of the thermal path: the joined module cooled to 25 °C before its fill is born, the counterpart of the chip-join CPI state), microbump screening with each joint a solder cap on an elastic Cu pillar in series (`AnandPoint.stepSeriesColumn()`), the wafer underfill (or mold) tractions at every chiplet, the module parts of the cross-section view (the mold drawn over the wCUF wedge), the overlays and the report and CSV (part 2).
20. **h_min never grows past the preset h_max** when the DOF cap cannot be met (Section 5.2 enlarges both sizes until the DOF is under the cap). Stacked modules add element layers over their footprint, and the feature lines and minimum element counts then keep the DOF above the Draft cap whatever the sizes; growing h_min further only made the elements next to the thin layers extremely flat (aspect ratios above 1000) and the solver slower. The monolithic presets reach their caps below that limit and are unchanged; a custom cap far below them, such as the 6k of V17's small package, now ends above it (9.1k DOF). Module presets at Draft: Foveros-S-like 112k DOF, CoWoS-R-like 161k, mixed 265k (cap 75k); at Standard they reach the 330k cap with coarser in-plane elements than the monolithic default (h_min 0.60, 0.86 and 1.50 mm against 0.30 mm), so use Fine for decisions on module packages.

## Known issues and next steps

- **Performance targets are missed** by about 10× at Standard (912 s at 506k DOF against 90 s) and by about 10× for the submodels (1243 s for four corner bumps against 120 s); Fine has not been run end to end. The thermal path solves 67 steps on the default package; speed-ups must leave the results unchanged (the user puts model accuracy first, so fewer or longer steps, coarser meshes, looser tolerances and larger submodel steps are out); candidates: a coarse space that treats each compliant layer as a shear layer between its two stiff stacks, WebAssembly or SIMD kernels for the matrix-vector product and the column smoother, a sparse direct solver for the 13k-DOF submodel, and the bump screening split over the workers (14 s against the 10 s target).
- **Stacked module packages solve slowly**: the multigrid preconditioner needs about 2 to 3 times the PCG iterations per step of a monolithic package of the same size (Standard, cold stage 1 step: 265 against 121; stage 3: 135 against 54), and more in the first module-stage steps on coarse meshes (about 600 at Draft), so Draft gives little saving over Standard for them. The run panel estimate scales by 2.4 for module packages. Tried without gain: a compliant split at the DDI layer (`COMPLIANT_PARTS`), the mold as compliant, more smoothing sweeps, fewer shell levels. A coarse space that represents the base and the chiplet layer as two plates coupled through the DDI shear layer is the likely fix (see the run-time item below).
- **Stacked module results**: DDI microbump screening drives each joint from the homogenized DDI gap like the flip chip screening (the solder cap strain from a series column, not a resolved joint), on at most 5000 microbumps per chiplet; there are no microbump submodels, and flip chip submodels need a Si base at least 50 µm thick (not under RDL interposers). Sensitivity inputs do not include the module parameters yet, and a Draft sensitivity run of a module package takes hours at the current solver speed.
- **Fine preset** full analysis has not been timed; V10 covers its accuracy against Standard. With the 850k cap (h_min 0.138 mm) the lidded default has 1.18M DOF, which needs the desktop app (several GB per worker).
- **JEITA sign on ring and saddle surfaces** is inherently fragile (the lidded default at 25 °C is a ring profile); the shape class, the sign-confidence metric and the magnitude curve are shown so the user can judge. A customer-specific sign rule could be added as an option.
- **Peak memory grows with the worker count** (each helper holds its own model and preconditioner: 0.76 GB at Standard on the default package, the main worker 2.1 GB). The run panel estimate is fitted to four measured desktop runs (README "Measured performance") and should be refitted when the solver's storage changes. In a browser the whole tab is bounded by the browser's per-tab allowance; the desktop app removes that bound, leaving the computer's memory.
- **The desktop app** is what the user runs (the portable exe, on Windows, since October 2026); in development it is tested on Linux under a virtual display, and the Windows build and `desktop-check.mjs` run on the workflow's Windows runner. It is not code-signed, so SmartScreen warns on first start.
- **Results files and tool updates**: a results file holds the step increments of the analysis that wrote it, so after a change to the mesher or the thermal path an older file opens with its results but without its analysis (Restore analysis re-runs it). The portable exe registers no file type.
- **3D view** is exercised against the local three.js stub by the smoke test; the mesh overlay was also checked once with three.js r128 served locally (software WebGL). A check in a browser with CDN access is still worthwhile.
- **Submodel cross-section total stress** adds the global as-assembled residual at each voxel, which is the homogenized bump-layer value: the residual concentration around the joint itself is not resolved. Resolving it would need the process stages (element birth) in the submodel.
- **Possible future work**: mesh-independent corner metrics across presets (currently fixed physical patches), a warpage-only fast mode for sensitivity, calibrating effective stress-free temperatures against measured warpage, and an optional viscoelastic underfill model.
