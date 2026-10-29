# FCBGA Thermomechanical Screening Tool: project guide

## Project status (read this first)

The build specification that follows (from "Build Prompt" onward) has been **implemented in full** and merged to `main` through forty-three pull requests (three of code and two of documentation for the build, then UI updates, two materials database passes, a parallel-worker setting, a legend fix, a glossary, UX refinements, a cancel fix, a cross-section stress view, material data-quality colours, a finer through-thickness mesh (later trimmed for the TIM), a submodel cross-section view with a 3D mesh overlay, a Windows desktop app with automatic releases (now portable only), a live progress panel with a 3D view fix, incremental thermoelasticity with a column solder phase and lid-foot refinement, a results file to save and reopen a session, a cleanup before the next major update, stacked modules in two parts, floorplan and section colours, end-of-run dialogs, a module-stage fix, element layers per mesh preset with desktop 1.2.0, a turnable submodel cut and underfill traction maps, hand-off notes, status updates and an accuracy-over-speed rule requested by the user, and helper compute processes that fixed a crash of large multi-worker runs). A new session should treat it as the reference design of an existing, working application, not as a task to start.

| PR | Merged | Content |
|---|---|---|
| #1 | 2026-10-08 | Complete tool: physics core, worker, single-file UI, verification suite, build and test tooling |
| #2 | 2026-10-09 | Feature-preserving multigrid (lid convergence), parallel temperature sweep and submodels on nested workers, faster submodel, JEITA shape class and sign confidence, three.js CDN fallback and 3D smoke test, "Estimated inputs in use" card, V7 made consistent (suite 15/15) |
| #3 | 2026-10-09 | Tooltips on every control, dropdown, results tab and result quantity (344 elements) |
| #4 | 2026-10-09 | Documentation: this status section and the README status, layout, verification, performance, deviations and known-issues sections |
| #5 | 2026-10-09 | Documentation: listed the documentation PR in the status tables |
| #6 | 2026-10-10 | Resizable panes (side panels, floorplan and cross-section split, 3D view, plot edges) with content that follows the size; auto-solve on die release and the drag preview removed; floorplan overlay hidden while the geometry differs from the results |
| #7 | 2026-10-10 | Mouse-wheel zoom, drag pan and double-click reset on every results plot and map; rainbow colour scale by default with a colorblind-safe option |
| #8 | 2026-10-10 | Materials database expanded from 20 to 49 materials with a sanity pass on the original entries; PRs 5 to 7 added to the status tables |
| #9 | 2026-10-10 | Materials database second pass from primary sources, 49 to 101 materials, with corrections to existing entries; PR 8 added to the status tables |
| #10 | 2026-10-11 | Parallel worker count offered up to CPU cores / 1.5 (rounded down); the sensitivity run uses the chosen worker count |
| #11 | 2026-10-11 | Documentation: PRs 9 and 10 added to the status tables |
| #12 | 2026-10-11 | Results map legends show enough decimals to keep narrow ranges distinct (the fatigue map read 0.2 at both ends); CLAUDE.md now picks verification subsets by the nature of a change |
| #13 | 2026-10-11 | Documentation: PRs 11 and 12 added to the status tables |
| #14 | 2026-10-11 | Glossary of 83 acronyms and variable symbols: matching terms in the UI show the spelled-out form on hover and open the entry on click; glossary window (A–Z) and a glossary section in the report |
| #15 | 2026-10-13 | Colour-scale end labels to 4 significant figures (scientific notation below 1); die corners numbered 1 to 4 clockwise from the bottom-right corner everywhere (underfill perimeter plots, die stress map and patches); line key on the die stress map; verification criteria shown before a run with a plain-language description of each test; explainer tooltips on the fatigue, sensitivity and verification tabs |
| #16 | 2026-10-13 | Documentation: PRs 13 to 15 added to the status tables; standing rule to update them after every merge |
| #17 | 2026-10-13 | Cancelling a job no longer strands the results: verification, mesh check and core study run on a one-shot side worker; cancelling a main-worker job shows a notice with Restore analysis instead of "No analysis in memory"; cancel with nothing running keeps the analysis; a cancelled sensitivity run reports no false failures |
| #18 | 2026-10-14 | Documentation: PRs 16 and 17 added to the status tables |
| #19 | 2026-10-14 | Cross-section stress view: click a horizontal or vertical line on the package and see any stress component (invariants, package-axis and line-frame components) on the vertical cut under it, from the top solder resist to the package top; zoom, element mesh overlay, bump-layer phase toggle, vertical scale, hover readout and CSV export; solder resist sub-layer stress recovered with out-of-plane stresses continuous through the band |
| #20 | 2026-10-14 | Documentation: PRs 18 and 19 added to the status tables; from now on each PR adds its own row before it merges, with no separate status PR |
| #21 | 2026-10-15 | Material dropdowns in steps 1 to 3 sorted from fewest to most Estimated values and coloured green (none), orange (1 to 4) or red (5 or more), with the count in brackets and a legend; the glass-transition smoothing widths are not counted (doubling them moves RT and peak warpage and die stress by under 0.5 %) |
| #22 | 2026-10-16 | At least 4 element layers through every region (bump underfill, fillet, dies, TIM, lid, adhesives, stiffener; substrate groups split into 4 bands each), DOF caps 75k / 330k / 600k to keep the in-plane element sizes; continuous fillet wedge (partly filled cells scaled by their volume fraction, up to 6 columns), drawn as a triangle in the cross-section view; runs about 5 to 6 times longer (Standard full analysis 867 s) |
| #23 | 2026-10-18 | Documentation: hand-off notes for the next session ("Where to pick up" in CLAUDE.md), verify and smoke-test run times after the mesh refinement, repository layout and modeling summary refreshed, in-app limitations text updated for the twelve substrate bands |
| #24 | 2026-10-18 | TIM back to one element layer (the other regions keep at least four): four TIM layers changed no result by more than 0.3 % on the default lidded package and raised the lid-stage PCG iterations (55 and 38 to 76 and 48); stage chain plus 25 °C about 17 % faster at a fixed in-plane grid |
| #25 | 2026-10-18 | Submodel cross-section stress view: each bump submodel stores its stress field at the end of each ramp and dwell of the last cycle, shown on a vertical cut along x or y through the pitch cell (underfill or solder coloured, the rest grey; any stress component, voxel mesh overlay, plan view to place the cut, CSV export; change from the as-assembled 25 °C state); element mesh toggle in the 3D view |
| #26 | 2026-10-19 | Windows desktop app (Electron): the page runs in its own window and every worker is a separate compute process on the computer (running the page's own core and driver, helpers as worker threads), so runs are no longer bounded by the browser's per-tab memory allowance (Edge and Brave stopped at about 10 GB); installer and portable exe built by a GitHub Actions workflow on Windows; a stopped compute process is reported with Restore analysis; bundled three.js; 3D view shows a message when WebGL is missing; desktop smoke test and compute-process check |
| #27 | 2026-10-19 | Desktop workflow publishes a GitHub release from a manual run (release_tag and release_target inputs; the workflow's token creates the tag), used for desktop-v1.0.0 on the PR 26 merge |
| #28 | 2026-10-20 | Desktop app published automatically: every merge to main that changes the built page, desktop/ or the desktop workflow builds the installer and portable exe and publishes a GitHub release (next patch version after the latest desktop-v* tag, or the raised desktop/package.json version; tools/desktop-version.mjs), with the merged pull requests in its notes |
| #29 | 2026-10-21 | Live run progress: status-bar dot (green running, orange slow, red likely stuck), progress bar, elapsed and remaining time, and a Details panel updated once a second (steps with times, one row per worker with its PCG iterations and residual or submodel step, residual history, log); core live reports throttled to 1 s, helpers report on their own message ports; desktop compute process split into a relay thread and a driver thread; 3D view draws faces between parts so the full die, TIM and underfill volumes show |
| #30 | 2026-10-21 | Desktop app built and released as the portable exe only (the installer is no longer built; desktop-v1.0.0 to v1.0.2 keep theirs) |
| #31 | 2026-10-26 | Incremental thermoelasticity dσ = D(T)(dε − α dT) along the temperature path in place of the secant form (steps of at most 30 °C, 10 °C near a Tg, one solve each with a fresh preconditioner, spread over the workers; stresses from per-element histories; submodel elastic parts incremental too); column solder phase (axial and shear stiffness only) and free-standing column screening; lid foot and stiffener ring edges refined to h_min after the DOF cap (lidded default 506k DOF at Standard); submodel cross-section total-stress option; Fine cap 850k (1.18M DOF, h_min 0.138 mm); run-panel memory estimate fitted to measured peaks; V16 (suite 16/16); full Standard 912 s, 3.6 GB on 3 workers |
| #32 | 2026-10-26 | Results file (.fcbgares): one binary file holds the configuration, every result in memory (temperatures viewed, cross-sections, screening, bump submodels, baseline, sensitivity, verification), the view settings and the analysis behind them (every thermal-path step increment, Float32), so reopening rebuilds the analysis without solving; Save and Open in steps 1 and 6, drop on the window, desktop File menu (Ctrl+O, Ctrl+S) and a file on the command line; increments sent in 64 MB blocks; V17 round-trip test (suite 17/17); submodel plan view no longer draws before layout |
| #33 | 2026-10-26 | Cleanup before the next major update: unused code removed (the earlier assembly path's element and BCSR helpers, R_GAS, workerPool; page 827 to 821 kB); tools/desktop-run.mjs (one full analysis in a desktop compute process with time and peak memory, for refitting the run panel estimates); CLAUDE.md checklist for the next major update (reference values, results file compatibility, fitted constants, desktop version, checks); README brought up to date (desktop app as the way the tool is used, memory, helper scheduling, repository layout) |
| #34 | 2026-10-27 | Stacked modules, part 1: Si-base (base die or Si interposer, optional TSV Cu) and organic RDL-interposer modules with one layer of chiplets on DDI microbumps (Cu pillar and solder cap in series), wafer underfill plus mold or mold only; floorplan editing of modules and chiplets; module process stages before the substrate stage, each module free on its own support; die stress on every chiplet and Si base; wafer mold and RDL dielectric materials (106 materials); three illustrative presets; h_min stops at the preset h_max when the cap cannot be met; V14 extended, V18 (suite 18/18); results file format 2; desktop 1.1.0; module packages need about 2 to 3 times the PCG iterations per step |
| #35 | 2026-10-27 | Stacked modules, part 2: DDI microbump loads as assembled and at the end of chiplet join (a 'ddi' branch of the thermal path, the joined module cooled to 25 °C before its fill), microbump screening with each joint a solder cap on an elastic Cu pillar in series (at most 5000 sites per chiplet), wafer underfill (or mold) tractions at every chiplet; C4 / DDI layer toggles in the bump, underfill and fatigue views, floorplan overlays, report and CSV sections; the cross-section view draws the mold above the wCUF wedge; V18 extended; monolithic results unchanged |
| #36 | 2026-10-27 | Documentation: accuracy over speed recorded as a standing rule at the user's request (speed-ups only when they leave the results unchanged, with before and after reference values in the PR); fewer or longer thermal-path steps and a larger submodel step dropped from the open items |
| #37 | 2026-10-27 | One colour per material in the floorplan, section sketch and 3D view (all silicon blue, all underfill orange, lid and stiffener grey, RDL interposer light brown, wafer mold dark grey), colour key under the section, die and chiplet labels that fit their boxes, floorplan readout moved under the floorplan, section names over each die and module with seamless fills and a 240 px default height, grid and rulers kept inside the substrate |
| #38 | 2026-10-27 | End-of-run dialogs: a summary when a run finishes (total time, mesh, workers, solves, PCG iterations, solver time, screening, RT warpage, step times; warning banner for failed tests or unconverged solves) and the cause when it fails, crashes (worker or compute process died) or is cancelled (where it stopped, what is kept, Restore analysis, what to try, last log lines); helper solve records carry converged and fallback |
| #39 | 2026-10-28 | Stacked modules: well-posed module stages (only the born module parts are assembled and every other node is held, so no spurious substrate warpage; each module supported on three well-separated nodes of its base; multigrid aggregates from the born parts; h_min growth capped at 4 times the lowest module height); fixes the Draft aborts on thin modules; V18 RT warpage 21.69 to 10.28 µm; monolithic results unchanged |
| #40 | 2026-10-28 | Element layers per region by mesh preset: at least 1 at Draft, 2 at Standard and 4 at Fine (TIM 1; substrate groups and RDL interposers split into as many layered bands; die bands and the lid plate start at half, so Fine is unchanged); with the same caps Draft and Standard reach their preset h_min on the default package with fewer DOF (65k and 314k, from 77k and 506k): full Draft 133 s (187), Standard 611 s in Chromium; RT warpage Draft −69.34 µm (−68.58), Standard −69.30 µm (−69.08); V5 tests one band per group; run-time estimate refitted; smoke test returns to the floorplan tab before its reload |
| #41 | 2026-10-28 | Desktop app version raised to 1.2.0 at the user's request, so the release after the per-preset element layers of PR 40 is desktop-v1.2.0 (PR 40 itself went out as desktop-v1.1.5) |
| #42 | 2026-10-28 | Submodel cross-section cut turned about the bump axis in 15° steps and slid along its normal (offset in µm; segments cut at the voxel grid lines, bilinear in each voxel, so 0° and 90° on a grid line give the earlier cuts exactly; line-frame components turn with the cut); underfill interface view shows the perimeter line plots or up to 4 side contour maps stacked to fit the results pane (each die or chiplet side unfolded at the edge: sidewall above, active-face band below; peel, shear magnitude or components; shared or per-map rainbow scale; core tractionMap, worker message tractionMap, maps cached and saved in the results file) |
| #43 | 2026-10-29 | Desktop app: each parallel helper is a compute process of its own instead of a thread (Electron keeps the JavaScript heaps of all threads of a process in one cage of about 4 GB, about 2.4 GB usable with eight threads, and a Fine run with 10 workers on a 1.16M DOF stacked-module package aborted a third of the way through the thermal path with memory free); crash causes reported (the driver's error or the engine's fatal message) in the crash dialog; Galerkin coarse operator built in typed arrays (heap peak of a Fine step 409 to 171 MB, solution bitwise identical); per-helper memory estimate refitted; desktop-check tests the helper process and the crash cause; desktop-run takes a configuration file and runs in Electron's Node with --electron; that Fine package ran in full in Electron on 4 workers (8371 s, 8.7 GB peak) |

Current state on `main`:

- Verification suite: **18/18 pass** headless in Node (V18 stacked modules added in PR 34, extended in PR 35; all 18 in one run of 47 minutes in PR 40, after the per-preset element layers) (README "Verification status" records the measured values; `dist/verification.json` is written by each run but is gitignored, so a fresh clone has none).
- Performance (4-core container, 3 workers; 67 thermal-path steps on the default package since PR 31), with the per-preset element layers of PR 40: full Standard analysis 611 s at 314k DOF in Chromium (target 90 s; 912 s at 506k with 4 layers in the desktop compute process before), full Draft 133 s and Quick preview 43 s at 65k DOF, screening 15 s (target 10 s), four corner submodels 1673 s (target 120 s); peak memory 3.6 GB at Standard with 4 layers (506k DOF; not re-measured at 314k, target 600 MB). Solver speed is the main open item; see README "Known issues and next steps". The drag preview and auto-solve of Section 4.3 were removed at the user's request (README deviations).
- Deliverable: `dist/fcbga_thermomech_tool.html` (about 973 kB, committed; rebuilt from `src/` by `node tools/build.mjs`). The Windows desktop app (portable exe only, about 100 MB; the installer was dropped after desktop-v1.0.2 at the user's request) is built from it by the "Desktop app (Windows)" workflow, which also runs `tools/desktop-check.mjs` on the Windows runner, and publishes a release on every merge that changes the app (the newest is at the top of the repository's Releases page). Its compute processes give the same results as a direct run in every check.

`README.md` carries the detailed status: verification table, measured timings, every deviation from the specification, known issues, repository layout and development workflow.

Before the next major update (a change to the physics, the mesh, the thermal path or the solver):

- **Reference values** to compare against (lidded default unless noted; RT = 25 °C as assembled). A change that moves them should be intended and explained in its PR:

  | Case | Quantity | Value |
  |---|---|---|
  | Default, Draft full (65k DOF, 1 layer per region) | RT signed warpage | −69.34 µm |
  | Default, Standard full (314k DOF, 2 layers per region) | RT signed warpage | −69.30 µm |
  | Default, Standard vs Fine preview (V10) | RT warpage; die interior peak | −69.3 vs −69.4 µm; 72.6 vs 70.0 MPa |
  | Bare die, Draft (V9) | RT warpage; die backside interior | +222.7 µm; +65.8 MPa |
  | Core study, Draft (V9) | RT warpage, 0.4 mm vs 0.8 mm core | 285.8 vs 166.0 µm |
  | Default, four corner submodels (Draft global) | ΔW per cycle (worst) | 0.45 MPa |
  | V16 held underfill block | in-plane stress at 25 °C | 45.52 MPa (exact 45.52) |

- **Results files** (`.fcbgares`) store the step increments of the analysis that wrote them. `restoreAnalysisState()` refuses them when the mesh fingerprint or the step plan differs, so a file saved before a mesh or path change opens with its results only (Restore analysis re-runs it). Raise `CONST.RESULTS_FILE_VERSION` when a saved field changes meaning or layout; older versions are read, newer ones refused, so keep reading the old version or say in the release notes that it no longer opens.
- **Fitted constants** to refit after a speed or storage change: `RUN_S_PER_STEP` (runtime estimate) and `MEM_MAIN_MB*` / `MEM_HELPER_MB*` (memory estimate) in `src/ui/00-app.js`, from desktop compute-process runs: `node tools/desktop-run.mjs <preset> <package> <workers>` prints the wall time, DOF, PCG iterations and the process's peak resident memory (the current fit uses Draft on 1 and 3 workers and Standard on 2 and 3).
- **Desktop version**: `desktop/package.json` is 1.2.0 since PR 41; raise it to the next minor version (or 2.0.0 when old results files no longer open) in the PR so the release says so; without it the next release is a patch step past the latest `desktop-v*` tag.
- **Checks**: the full suite (about 50 minutes), `node tools/smoke.mjs --full --workers 3 --submodels`, `--full --standard --workers 3`, and the two desktop checks. Start long runs detached and update the verification and performance tables in the same PR.
- **Housekeeping done in PR 33**: unused code removed (`boxElement`, `layeredBoxElement`, `elementK33` and the BCSR helpers of the earlier assembly path, `R_GAS`, `workerPool`), documentation brought up to date. The remote branches of PRs 5, 14 and 24 (`claude/keen-heisenberg-qn17kn`, `claude/kind-dirac-4co4n9`, `claude/optimistic-heisenberg-egirf7`) are fully merged and can be deleted on GitHub.

Where to pick up (open items, most important first; details in README "Known issues and next steps"):

1. **Solver cost of stacked-module packages** (about 2 to 3 times the PCG iterations per step of a monolithic package; README known issues): a coarse space that represents the base and the chiplet layer as two plates coupled through the DDI shear layer is the likely fix; then sensitivity inputs for the module parameters (chiplet thickness, mold and wCUF CTE and modulus, base thickness).
2. **Run time.** Since PR 31 a full analysis solves one step per piece of the thermal path (67 on the default package), each with a fresh preconditioner: full Standard 611 s at 314k DOF on 3 workers in Chromium (target 90 s), 30 PCG iterations per step on average. Speed-ups must leave the results unchanged (see "Accuracy over speed" below), so fewer or longer steps with fields interpolated in between are out: each step averages the stiffness over its range, so a different step plan moves the results near every Tg. The candidates are the solver itself: a coarse space that represents each compliant layer as a shear layer between its two stiff stacks (`buildShellLevel()`, `COMPLIANT_PARTS` in `src/core/10-solver.js`), WebAssembly or SIMD kernels. Measure with a Draft preview first (`Analysis` with `evaluations: 'preview'`, the 15 process-chain steps, iterations in `an.log`).
3. **Submodels** take about 850 s per corner bump in the browser (1888 adaptive steps, ΔW 0.45 MPa per cycle on the Draft global field since PR 40; the corner joints creep more since the incremental path and the column solder phase); a sparse direct solver for their 13k DOF is the candidate (a larger inelastic step limit would coarsen the creep integration, so it is out). Screening takes 14 s (target 10 s); splitting it over the workers would help.
4. **Memory** at Standard: 2.32 GB peak for the desktop compute process tree on 3 workers at 314k DOF since helpers are processes (PR 43; 0.63 GB per helper, about 90 MB of it the helper's own runtime); before that, 3.6 GB with two helper threads at 506k DOF (4 layers per region before PR 40; not re-measured at the 314k DOF of 2 layers): 2.1 GB for the main worker (it also keeps every step's displacement increment in single precision, the fields at every evaluation temperature and the post-processing states) and 0.76 GB per helper (target 600 MB per run). The run panel estimate (`estimateRun()`, `MEM_MAIN_MB*` and `MEM_HELPER_MB*` in `src/ui/00-app.js`) is fitted to these and to Draft (367 MB on 1 worker, 811 MB on 3); refit it when the solver's storage changes. Fine full analysis measured once, on a stacked-module package (Foveros-S-like Si base and RDL interposer modules, 1.16M DOF): 8371 s and 8.7 GB peak on 4 workers in Electron's Node in the 4-core container (PR 43). **Not re-measured:** Fine on the lidded default (1.18M DOF), sensitivity run time.

## Working in this repository

- **Target platform**: the user runs only the portable Windows desktop app (since October 2026), so browser tab memory no longer limits modeling choices; size models for the computer's memory, which the desktop run panel checks. The page itself is unchanged, and the browser smoke test stays the quickest harness for it.
- **Accuracy over speed** (user preference, October 2026): model accuracy comes first. Changes for computational efficiency are welcome only when they leave the results unchanged: a better preconditioner or coarse space, faster kernels (WebAssembly, SIMD), parallel work, exact direct solvers, storage that keeps the precision of what is stored. Never trade accuracy for speed: no coarser mesh or fewer element layers, no looser solver or Newton tolerances, no longer thermal-path steps or skipped evaluation stops, no larger submodel or screening time steps, no lower-order integration. A change made for speed must reproduce the reference values ("Before the next major update") to solver precision, with the before and after numbers in its PR; if a speed idea moves any result, drop it or ask the user first. Changes that improve accuracy at a cost in run time are worth proposing, but ask before making them.
- **Source of truth is `src/`.** Never hand-edit `dist/fcbga_thermomech_tool.html`; run `node tools/build.mjs` after any change to `src/` and commit the rebuilt file together with the sources.
- **Physics core** (`src/core/*.js`, concatenated in filename order) must stay free of DOM references: the same block runs on the UI thread, in the Web Worker and headless in Node. All constants live in `CONST` (`src/core/00-constants.js`); no magic numbers elsewhere. Large data in typed arrays only, including temporary data while a structure is built (typed arrays sit outside the JavaScript heap, which is capped at about 4 GB per desktop compute process).
- **UI** (`src/ui/*.js`, concatenated in filename order) uses the small `h()` element helper; every control gets a tooltip through `tip()`, `helpTip()` or `kl()` from `src/ui/00b-tips.js` (dictionary `TIPS`). Numeric inputs go through `numField()` so bounds and plausibility ranges apply.
- **Glossary** lives in `src/ui/00d-glossary.js` (`GLOSSARY`: term, spelled-out form, short description, strings to `match` anywhere or only as `exact` whole text). A MutationObserver wraps every matching term in rendered text in `span.gl` (hover tooltip, click opens the entry); buttons, selects, options, inputs, tabs, steps, checkbox labels and `.no-gloss` elements are skipped. Add an entry when UI text introduces a new technical acronym or variable symbol; leave trade-name acronyms of materials out.
- **Resizable panes** live in `src/ui/00c-layout.js` (splitters bound to `app.layout`, persisted through `prefs`). Plots and maps use `class: 'plot'` or `'map'` and draw through `linePlot()`, `tornadoPlot()` or `autoRedraw()` (`src/ui/01-plot.js`) so they redraw when their pane is resized; avoid fixed pixel widths on inputs (use `class: 'grow'` in rows). Plots in the Results area also zoom and pan through `plotZoom()`: a draw stores its mapping in `canvas.__tx` and reads the zoomed range from `canvas.__view`. Colour scales come from `makeScale()`, which follows `app.colorMap` (rainbow default, colorblind-safe option). Colour-scale end labels go through `legendItems()` (4 significant figures; magnitudes below 1 in scientific notation); line styles and markers drawn on a map get a `lineKey()`. Material colours come from one table, `PART_COLORS` in `src/ui/02-floorplan.js` (floorplan, section sketch and 3D view alike): all silicon blue, all underfill (bump layer, fillets, wafer underfill) orange, lid and stiffener grey, RDL interposer light brown, wafer mold dark grey; `partKeyItems()` builds the colour key under the section, and `fitLabel()` shrinks die and chiplet labels to fit.
- **Thermal path** (`src/core/11-analysis.js`, `09-assembly.js`): incremental thermoelasticity, dσ = D(T) (dε − α dT), replaces the spec's total (secant) form (README deviation 15). `buildPath()` lays out the steps (chain T_sub → T_join → T_UF → T_attach → 25 °C by stage, then `down` and `up` from 25 °C in the final stage, then the `cpi` branch in stage 1 for full runs; at most `INC_DT_MAX` = 30 °C, `INC_DT_TG` = 10 °C near a Tg, stops at every evaluation temperature and the solidus); each step is one independent solve `assembleStep(Ta, Tb, stage)` with the mean stiffness over the step and the exact ∫D dF (`gridMean()`, `gridStressIncrement()` in `src/core/03-materials.js`, midpoint rule per 1 °C grid interval) and a fresh preconditioner per step (step index as the solver key; 2.8 times fewer iterations than reusing one), so `runSweep()` in `src/worker.js` splits the steps over helpers (`evalSteps`). `finishPath()` sums the increments into `an.fields` (Float64, every evaluation temperature) and keeps `an.du` in Float32. Stresses never come from u alone: `an.view(T, 'final' | 'cpi')` returns a `StateView` whose `point(e, xi, eta, zeta, out)` gives `{eps, sig}` from the element's history (`accumulateStep()`: DOFs q, then per sub-layer 7 strain monomials and a thermal term, 6 components each; `stateStress()`), with the 25 °C states cached in `an.ck25`. Every post-processing function takes a view (`dieSurfaceStress(view, geom, die, which)`, `bumpLoads`, `ufTractions`, `sectionStress`, `faceStressField`, `layeredPointStress`); strain histories use `an.qAlong(e, temps)`.
- **Bump layer and screening**: the solder phase is a column material (`column: true` on the group, `columnD()` in `src/core/03-materials.js`: axial E and transverse shear G, in-plane terms only `COLUMN_INPLANE_FRACTION`); the screening drives each joint with `AnandPoint.stepColumn()` (axial and shear strains from the bump layer, in-plane stresses held at zero by Newton). The submodel's elastic parts are incremental too (`_elastic(mat, Ta, Tb)`, committed `sigE`, `eFn`, `uN`, `Tn`).
- **Mesh resolution** (user requirements, `src/core/06-mesher.js`, `04-homogenize.js`): every region except the TIM has at least the preset's `layers` element layers through its thickness, 1 at Draft, 2 at Standard and 4 at Fine (`CONST.MESH_PRESETS`, set by the user in PR 40; `g.layers` from `deriveGeometry(cfg, layers)`, which the mesher calls with the preset it builds at; `zPlanes()` starts die bands and the lid plate at half of it, rounded up, so Fine keeps the mesh of PRs 22 to 39; the TIM keeps one layer at the user's choice, since four changed no result by more than 0.3 % and cost lid-stage iterations; the three substrate groups and each RDL interposer are split into that many layered bands each in `substrateBands()` and `rdlBands()`), and preset DOF caps are 75k / 330k / 850k (the cap loop never grows h_min past the preset h_max: stacked modules can keep the DOF above the cap). With fewer layers, Draft and Standard reach their preset h_min (0.6 and 0.25 mm) under the cap on the default package; Fine keeps h_min 0.138 mm. The lid foot and stiffener ring edges are refined to h_min after the cap loop has set it (`ringEdges` of `axisFeatures()`, `RING_EDGE_ZONE`), so ringed packages end about 1.2 to 1.56 times above the capped grid (`info.capDof` is the capped grid's DOF; the lidded default has 314k DOF at Standard and 1.18M at Fine). A cap on that refinement for browser memory was tried and dropped, since the user runs only the desktop app. Fillet cells above the die active face are partly filled: stiffness and load scaled by the cell's volume fraction below the wedge (`fillFraction()`), with up to 6 columns across the fillet. Do not coarsen any of this further without asking.
- **Cross-section stress** (`src/ui/04b-section.js`, core `sectionStress()` in `src/core/12-post.js`, worker message `section`): stresses on the vertical plane under a horizontal or vertical floorplan line, from the bottom of the top solder resist to the package top; corner values are averaged within one material only, and the solder resist sub-layer of the layered substrate band is recovered by `layeredPointStress()` (out-of-plane stresses continuous through the band, in-plane strain from the element). Results are cached per temperature and line in `app.sectionCache`, cleared with each new run.
- **Submodel cross-section** (`src/ui/04c-subsection.js`, core `submodelSection()` in `src/core/13-fatigue.js`): each bump submodel result carries `section` with its voxel grid, material per voxel and corner stresses (`_stressSnapshot()`, Float32, 48 per element) at the end of each ramp and dwell of the last cycle; values are the change from the as-assembled 25 °C state. The view cuts them on a vertical plane turned about the bump axis in `SUBSEC_ANGLE_STEP` = 15° steps (0° along x, 90° along y) and slid along its normal n = (−sin, cos) by an offset in µm (`st.angle`, `st.off`; `submodelCutRange()` gives the offset range; views saved before PR 42 kept `axis` and a grid-line `pos` and are converted on opening): the line is split at every voxel grid line it crosses, each segment takes the bilinear corner values of its voxel's bottom and top faces, and a segment along a voxel face averages both voxels of one material or shows the one nearer the axis, so 0° and 90° on a grid line give the earlier cuts exactly; the line-frame components turn with the cut (`sec.theta`, `sectionValue(..., rot)`). It reuses `drawSectionPlot()` (the `submodel`, `labels`, `csv` fields of the section record and the `grey` plot option). No worker message is needed. The main worker adds `section.residual` (`submodelResidual()`: the global 25 °C stress at each submodel element centroid, Float32, 6 per element; solder 0) to every submodel result, and `submodelSection(sm, si, angle, off, total)` adds it for the "total stress" option. The 3D view's mesh overlay (`meshEdges3D()`, `updateMesh3D()` in `src/ui/04-results.js`) draws the unique edges of the boundary quads per part as `THREE.LineSegments`. The quads come from `boundaryFaces()` (`src/core/12-post.js`): a face is drawn where its cell faces void or a cell of another part, so every part is a closed surface and hiding one shows the parts it covered.
- **Underfill traction maps** (`src/ui/04e-ufmaps.js`, core `tractionMap()` with `ufTractionMap()` and `wcufTractionMap()` in `src/core/12-post.js`, worker message `tractionMap`): the Underfill interface view shows either the perimeter line plots or up to `UFMAP_MAX` = 4 contour maps stacked vertically (`app.ufMode` 'lines' or 'maps', never both). Each map is one side of a die (or chiplet, in the wafer-underfill layer) unfolded at its bottom edge: the sidewall interface above the edge line (up to the fillet top, or the chiplet top where the mold continues), the active-face band below it (`app.ufMapDepth`, at most half the die across that side); columns every `TRACTION_MAP_DS` along the side, `TRACTION_MAP_ROWS` rows per part, point values (peel, shear along and across the side; the view adds the magnitude) without patch averaging. Slots per layer in `app.ufMaps` ({o, side}), shared quantity, depth and colour scale (`app.ufMapShared`); maps cached per temperature, layer, die, side and depth in `app.tractionCache` (cleared with each run, saved in the results file).
- **Die corners** are numbered 1 to 4 clockwise seen from the top, starting at the bottom-right (+x, -y) corner (`dieCorners()` in `src/core/12-post.js`); a side is named by its corner pair (side 1-2 is the -y edge). Use this convention wherever a die corner or side is labelled.
- **Materials database** is `src/materials-db.json` (106 materials, references R1 to R74). Every leaf parameter is `{v, u, c, s, r, n}`: value, unit, confidence (Datasheet, Literature, Handbook, Estimated), source reference ids, datasheet range, note. A material's `category` decides which dropdowns offer it (`die`, `solder`, `buildup`, `core`, `resist`, `underfill` (also the wafer underfill), `adhesive`, `tim`, `metal`, `mold` (wafer mold), `rdl` (RDL interposer dielectric)); solders need `solidus` and a full `anand` set. `presetOf` + `override` makes a variant of a full record (presets of presets are not supported, and inherited values keep the base's sources, so override anything that differs); `placeholderOf` copies a record and flags it all Estimated. Substrate copper is always the `cu` record. Never present an assumed value as Datasheet: mark it Estimated with a note. The material dropdowns of steps 1 to 3 come from `materialOptions()` (`src/ui/03-panels.js`): sorted by the number of Estimated values (`materialEstimateCount()`, which skips the glass-transition smoothing widths `w` and `delta`), then Handbook values, and coloured green (none), orange (1 to `MAT_TIER_SOME` = 4) or red (more).
- **Stacked modules** (PR 34 and its follow-up): `cfg.modules` (each: base `si` or `rdl`, `tBase`, `tsv`, `rdl` rows top to bottom, C4 `bump` field, `chiplets` with positions relative to the module centre in module axes, own `rot` and `ddi` field) and `cfg.stack` (package-wide `chipletT`, `ddi` {standoff, pillarH, d, px, py, solder}, `fill` 'wcuf' or 'mold', `wcuf` {mat, Wf, Hf}, `moldMat`, `process` {Tddi, Twcuf, Tmold}). `normalizeConfig()` fills both in for files from earlier versions; the hashes include them only when modules exist, so earlier configurations keep their geometry and process hashes (V14). `deriveGeometry()`: `g.dies` are the objects on the bump layer, monolithic dies first (index = `cfg.dies` index) then module bases (`kind: 'module'`, `t` = module height above the bumps, `zBaseTop`, `zDdiTop`, `chiplets`, `rdl` bands); `g.siParts` are the silicon parts for the die stress (dies, chiplets, Si bases, each with `zb`, `ztop`, `gkey`, `part`); `wedgeHeight()` serves both the flip chip fillet (`filletHeight()`) and the wCUF fillet (`wcufHeight()`, clipped at the base edge). Mesher: parts `CHIPLET`, `BASE_SI`, `TSV` (superposed on the Si), `RDL` (a layered group whose `secK` maps each element layer to its own section, cut from the RDL rows, in `mesh.layeredBands` after the substrate bands), `DDI_SOLDER` (series Cu pillar and solder column, `_seriesColumn()`), `DDI_FILL`, `WCUF_FILLET`, `MOLD` (wCUF and mold superposed by volume fraction where the wedge cuts a cell); chiplet edges refine like die edges, DDI field lines are not grid lines, wCUF spans may drop to one column. Thermal path: module stages are negative (`CONST.STAGE` DDI -3, WCUF -2, MOLD -1), before S0, so module-free paths are unchanged; `stageTgs` is a Map; the path also stops at the DDI solidus; layered sections carry their group's birth stage (the substrate is unborn in module stages); in negative stages `assembleStep()` assembles only the born module parts and holds every other node plus each module's own 3-2-1 support (`moduleStageSet()`, `mesh.moduleConstraints` from `moduleSupport()`: three well-separated nodes of the module's base bottom), and the multigrid builds its aggregates from the born parts only (`activeSet()`, `buildShellLevel(..., act)`, a new hierarchy when `activeKey` changes); the cap loop grows h_min at most to `MODULE_HMIN_PER_HEIGHT` = 4 times the lowest module height. Bump submodels refuse module bases that are RDL or thinner than `SUB_MARGIN`. Microbump results: `ddiLoads()` (shared `jointLoads()` with `bumpLoads()`), `wcufTractions()` (shared `perimeterTractions()` with `ufTractions()`), the 'ddi' branch of the path (full analyses: the joined module cooled to 25 °C before its fill, `an.view(25, 'ddi')`), `screenDdi()` through `screenJoints()` with `AnandPoint.stepSeriesColumn()` (solder cap on an elastic Cu pillar, 6-unknown Newton, at most `SCREEN_MAX_DDI` sites per chiplet); results carry `ddi` (per chiplet, every temperature), `ddiJoin` and `ddiScreening`; the section plot draws the second quad of a wedge cell above the wedge (`idx2` in `sectionFields()`). UI: `app.selectedDie` indexes `g.dies` (dies then modules) and `app.selectedChiplet` a chiplet of the selected module (`selectedObject()` in `src/ui/02-floorplan.js`); results carry `si` (die stress per silicon part; `siList()` falls back to `dies` for older results). Solver cost: module packages need about 2 to 3 times the PCG iterations per step of a monolithic package of the same size (Standard: 265 against 121 on a cold stage 1 step), and Draft cannot reach its cap for them (h_min stops at the preset h_max); making the DDI layer a compliant split in `COMPLIANT_PARTS`, treating the mold as compliant, more smoothing sweeps or fewer shell levels did not help (see README known issues).
- **Desktop app** (`desktop/`, Electron, Windows): the window shows the staged built page (`desktop/stage.mjs` copies `dist/` and three.js r128 into `desktop/app/`); each page worker becomes a separate Node compute process (`desktop/compute-worker.js`, started by `desktop/main.js` with `ELECTRON_RUN_AS_NODE`) that runs the page's own `core` and `worker-driver` blocks (`desktop/core-source.js`; the process's main thread only relays messages and the driver runs in a worker thread), so it is bound by the computer's memory, not a browser tab. The driver's helpers are compute processes of their own (`HelperProcess` in the driver thread; the relay starts them, carries their messages and passes their live reports straight to the page), not threads: Electron keeps the JavaScript heaps of all threads of a process in one cage of about 4 GB (about 2.4 GB usable with eight threads; exceeding it aborts the process whatever the free memory), which stopped Fine runs with many workers up to desktop-v1.2.0. A failing driver sends its cause (`{__fatal}`) before its process exits, and each parent keeps the tail of its children's error output, so `computeExitMessage()` in `src/ui/00-app.js` and a failed helper report why. The page uses it only when `window.fcbgaDesktop` (from `desktop/preload.js`) exists: `DesktopWorker` behind `WorkerClient` in `src/ui/00-app.js`, a stopped process sets `app.analysisLost = 'stopped'` and is replaced on the next request. Versions are pinned in `desktop/package.json`; the workflow `.github/workflows/desktop-windows.yml` builds the portable exe on Windows (no installer: the user asked for the portable version only) and publishes a GitHub release by itself after every merge to `main` that changes `dist/fcbga_thermomech_tool.html`, `desktop/` or the workflow (version from `tools/desktop-version.mjs`: one patch step past the latest `desktop-v*` tag, or the `desktop/package.json` version when raised; raise it there for a minor or major release, never by hand-made tags) (this sandbox has no Wine for the installer step; `npm run pack:dir` builds the unpacked app here).
- **Run progress** (`src/ui/00e-progress.js`): `startRun()` and `runSensitivity()` open a record (`progressBegin()`, `progressMsg()`, `progressEnd()`) that drives the status-bar dot, bar, times and the Details panel, judged and redrawn once a second. The core reports live through `LIVE.post` / `liveReport()` (`src/core/10-solver.js`): the PCG solve (`start`, throttled `iter` with a downsampled residual history, `rebuild`, `fallback`, `solved`) and the bump submodel (`start`, `step`, `cutback`), at most once per `CONST.LIVE_INTERVAL_MS`; the green, orange and red thresholds are the `CONST.LIVE_*` values. The driver posts `{type: 'live', w, info}`: the main worker directly (w 0), each helper on a message port of its own (browser: a `liveport` message hands the page its end; desktop: `self.__livePort()`), so helper reports arrive while the main worker is inside a solve. When a job ends, `src/ui/00f-runreport.js` shows a dialog: `runFinishedDialog()` (total time, mesh, workers, solves, PCG iterations, solver time summed over the workers, screening, RT warpage, step times; a warning banner for failed verification tests or unconverged solves), `runFailedDialog()` (crashed: the worker or desktop compute process died, `err.crashed` set by `WorkerClient`; failed: the job threw; cancelled: from `defaultCancel()`; with where it stopped, what is kept, what to try and the last log lines) and `sensitivityDialog()`. They read a copy of the progress record (`progressSnapshot()`) taken before it closes. `startRun()` notifies for analyses, submodels and verification by default; `opts.notify: 'fail'` (mesh check, core study) shows only failures, and a failure shown in a dialog carries `err.reported` so callers skip their own toast.
- **Results file** (`.fcbgares`; format and analysis state in `src/core/16-results-file.js`, page side in `src/ui/04d-resultsfile.js`): `saveResultsFile()` writes the configuration, `app.results`, the temperature and section caches, screening, submodels, baseline, sensitivity, verification and the view settings (`RESULTS_VIEW_KEYS`), plus the analysis behind the results while the main worker holds it: `exportAnalysisState()` (configuration, run options, mesh override, `meshFingerprint()`, the step plan and every `an.du` increment in Float32). The container is binary: magic, version, a JSON manifest (`packTree()`: typed arrays by reference and stored once, Maps, Sets, non-finite numbers) and 8-byte aligned typed-array data. `openResultsFile()` shows the saved views at once (`applyResultsFile()`) and then rebuilds the analysis in the worker without solving (`restoreAnalysisState()`, `Analysis.restorePath()`, which refuses a different mesh or step plan); step increments travel in blocks of at most `CONST.RESULTS_FILE_CHUNK_BYTES` (`exportState` with `k0`/`k1`, `restoreSteps`, then `restore`) because the desktop app limits one page-to-process message. While it loads `app.analysisLost` is `'loading'`; a file without its analysis, or one that could not be loaded, sets `'file'` (`app.analysisLostWhy`), and Restore analysis re-runs it. Raise `RESULTS_FILE_VERSION` when the layout or the meaning of saved fields changes; files from a newer version are refused. Desktop: File > Open results (Ctrl+O) and Save results (Ctrl+S) reach the page as `fcbga:menu`; a `.fcbgares` path on the command line (Windows "Open with") is read by the page in blocks (`openedFile()`, `readOpenedFile()`).
- **Worker protocol** is in `src/worker.js` (message types `init`, `run`, `evalSteps`, `submodelRemote`, `submodels`, `fieldsAt`, `section`, `tractionMap`, `submodel`, `sensitivityCase`, `verify`, `meshInfo`, `exportState`, `restoreSteps`, `restore`; outgoing `progress`, `partial`, `result`, `error`, `live`, `liveport`). Nested helper workers are spawned from inside the main worker (`spawnHelper()`: a Web Worker from the source text in a browser, `self.__spawnHelper()` helper compute processes in the desktop app); keep a sequential fallback for every parallel path.
- **Before pushing**: always `node tools/build.mjs` when `src/` changed. Then choose checks by the nature and extent of the change (the user prefers targeted subsets over the full suite for small updates, and may waive checks for simple ones):
  - Broad or physics-affecting core changes (element, assembly, solver, process stages, default materials the tests use): full `node tools/verify.mjs` (about 50 minutes since every analysis solves the 15 or more steps of the thermal path: V10 about 30 minutes with Fine at 1.18M DOF, V15 about 12, V8 and V9 about 1 each; `node tools/verify.mjs V1,V2,V3,V4,V5,V6,V7,V8,V9,V10,V11,V12,V13,V14,V16,V17,V18` skips the timing benchmark) and `node tools/smoke.mjs --full`.
  - Small, local core changes: the tests that exercise the touched module, for example materials or homogenization V1, V4, V13; element or layered integration V1, V2, V5; thermal path and step integrals V1, V3, V5, V16; solver V3, V11; mesher or post-processing V8, V12; fatigue and submodel V6, V7; configuration and presets V9, V14; results file V14, V17; stacked modules V14, V18 (plus `node tools/smoke.mjs --full`, which saves, reloads the page and reopens). Add `node tools/smoke.mjs`.
  - UI-only changes (`src/ui/`, styles, tooltips): the suite tests only the core, so skip it; run `node tools/smoke.mjs` (`--full` when results views change) plus a targeted browser check of the changed element.
  - Materials database additions that leave the defaults unchanged: V13, V14 and a check that every material evaluates (finite E(T), CTE(T) and stiffness from -80 to 300 °C).
  - Desktop app (`desktop/`, or the worker protocol and `WorkerClient` it relies on): `node tools/desktop-check.mjs` and `xvfb-run -a node tools/desktop-smoke.mjs` (after `npm install` in `desktop/`), plus the browser `node tools/smoke.mjs` to confirm the page alone is unchanged.
  - Documentation only: no checks.
  Syntax: `node tools/verify.mjs V1,V2,V13` runs a subset; the smoke test uses Playwright and Chromium, with three.js served from a local stub because CDNs are blocked in the cloud sandbox. Browser timings: `node tools/smoke.mjs --full --workers 3` (Draft, about 5 min) and `--full --standard --workers 3` (about 17 min); `--submodels` adds about 21 min for the four corner bumps of the default package. For long runs in the cloud sandbox, start them detached (`setsid nohup ... &`) and poll the log, since the session's processes can be restarted. A verify run of a subset overwrites `dist/verification.json` with only that subset.
- **Status tables**: every pull request updates the status tables itself, in the same PR; never open a separate documentation PR for them. Just before merging (including a merge the user asks for during a session), push a last commit to the PR branch that adds the PR's own row to the table above and to the README table, updates the pull request count in both intro sentences, and refreshes "Current state" where it changed (suite result, timings, deliverable size); then merge. Use the merge date in the user's local time (the merge commits record UTC-7: `TZ=America/Los_Angeles date +%F` at merge time); if the merge commit records another date (`git log -1 --format=%cd --date=short <merge sha>`), correct the row in the next PR.
- **Git**: develop on the designated feature branch, open a pull request to `main`, and keep each PR focused. The only CI workflow builds the Windows desktop app; the headless suite and the smoke tests are the gate.
- **Writing style** in UI copy, tooltips, comments and documentation: plain language, no em dashes (use commas or semicolons), units on every number, confidence labels on every result.

---

# Build Prompt: FCBGA Thermomechanical Screening Tool (3D FE, in-browser)

## 0. Your task

Build, in one pass, a self-contained single-file HTML/JavaScript application that performs approximate 3D finite-element thermomechanical stress and warpage analysis of flip chip ball grid array (FCBGA) packages: SAC solder flip chip bonded monolithic silicon die(s) on a multilayer organic build-up (ABF-type) substrate with a glass-fiber prepreg core, with capillary underfill and an optional lid or stiffener ring.

The user defines package geometry with numeric inputs and places dies by drag and drop on a top-down floorplan of the substrate. The tool ships with a cited default materials database (Section 11) that the user can edit, and it reports warpage, die stress, bump loading, underfill interface loading, and solder fatigue estimates with explicit confidence labels.

This is a one-shot build. Do not stop to ask questions. Where this specification is ambiguous or a requirement proves infeasible, choose the most physically defensible option, record the decision in the in-app "Assumptions and limitations" panel and in your final report, and continue. Never silently reduce fidelity below what is specified here; if you must, say so explicitly in the final report with the measured reason.

## 1. Audience and tone of the tool

The users are packaging engineers who understand package construction and materials but have limited finite-element experience. The tool must therefore:

- Make sound modeling decisions on their behalf (mesh, element formulation, solver, homogenization) and explain them in plain language on demand.
- Guard against invalid or physically implausible inputs with clear messages.
- Label every result with what it means, how much to trust it, and which inputs dominate it.
- Present singular or mesh-dependent quantities (die corners, interface corners, fatigue life) as comparative metrics, never as absolute truths.

A persistent, unobtrusive banner states: "Screening tool. Results are approximate and intended for design comparison and trend studies, not sign-off."

## 2. Scope

In scope:

- One or more rectangular monolithic Si dies (no stacking, no interposer, no bridge, no HBM), flip chip attached with SAC solder bumps (SAC305 default) on a multilayer organic substrate.
- Substrate: glass-fabric reinforced core plus N build-up layers per side (asymmetric counts allowed), each with dielectric thickness, Cu thickness and residual Cu ratio; solder resist on both sides; core plated through hole (PTH) Cu area fraction.
- Capillary underfill including fillet geometry, and filling of narrow die-to-die gaps.
- Package configuration selectable among: bare die, single-piece hat lid (with TIM1 and lid adhesive), or stiffener ring (with adhesive).
- Uniform-temperature thermal loading only: process-sequence stress-free states, a reflow warpage temperature sweep, and JESD22-A104 style temperature cycling.

Out of scope (state these in the limitations panel): BGA balls and PCB (second-level), mold compound, passives, non-uniform temperature or power maps, moisture swelling, viscoelastic polymer relaxation (other than the user-adjustable effective stress-free temperature knob in Section 6.5), Cu plasticity, fracture mechanics, bare-substrate initial warpage from fabrication, gravity.

## 3. Deliverable and technical constraints

- One `.html` file, all application code inline. External scripts only from cdnjs.cloudflare.com, cdn.jsdelivr.net/npm, or unpkg.com. Use three.js for the 3D view only; everything else (UI, 2D plots, contour maps, linear algebra, meshing, solver) is dependency-free JavaScript. If three.js fails to load, hide the 3D view and keep every other feature working.
- Solver and all heavy computation run in a Web Worker created from an inline script via a Blob URL. The UI thread must never block for more than 50 ms. Progress messages stream from the worker; every long job is cancellable (terminate and restart the worker is acceptable).
- Put all physics code (materials, homogenization, mesher, elements, assembly, solvers, post-processing, Anand integrator, submodel, verification tests) in one inline `<script type="text/plain" id="core">` block with no DOM dependencies. The worker and the UI both load it. This also allows extracting it and running the verification suite headless in Node. If your environment can execute code, do run the suite headless before delivering (Section 14).
- Use `Float64Array` and `Int32Array` for all large data. No per-node or per-element JavaScript objects in hot paths.
- Light and dark themes (respect `prefers-color-scheme`, plus a manual toggle). Layout must remain usable at 1280 px width; phone layout is not required but nothing should overflow horizontally.
- Do not rely on `localStorage` for anything important. Configurations are saved and loaded as downloaded or uploaded JSON files. `localStorage` may hold only conveniences (last theme, last tab), wrapped in try/catch.
- Internal unit system: mm, N, MPa, s, °C (convert to K inside the Anand model). Display units: mm for package dimensions, µm for thin layers and displacements, MPa and GPa for stresses and moduli, ppm/°C for CTE, gf and N for bump forces.
- Coordinate system: origin at substrate center on the substrate bottom surface; x right and y up on the floorplan; z up through the stack (live-bug orientation, die on top).

## 4. Application structure and UI

### 4.1 Layout

A left sidebar stepper with six steps, a central canvas area, and a right-side context panel:

1. Package: substrate outline, layer stack, BGA field definition, configuration (bare, lid, stiffener).
2. Dies and floorplan: die list, die properties, bump fields, the drag-and-drop floorplan.
3. Underfill, lid, stiffener: geometry inputs for whichever constructs are active.
4. Materials: the materials database editor.
5. Process and loads: process sequence temperatures, reflow sweep, temperature cycling.
6. Run and results: mesh fidelity preset, run controls, results views, sensitivity, verification, report export.

The central area always shows the floorplan (Section 4.3) plus a synchronized cross-section view along a user-movable cut line (A-A'), drawn to scale with a vertical exaggeration toggle (1x, 5x, 20x).

### 4.2 Package inputs (defaults in Section 12)

Substrate: x, y, layer stack table (rows from top to bottom; each row is either solder resist, a Cu pattern layer with thickness and residual Cu ratio and a "plane" or "signal" type, a dielectric layer with thickness and optional via Cu fraction, or the core laminate with thickness and PTH Cu area fraction). Provide "generate stack" helpers: N-2-N with given dielectric thickness, Cu thickness, residual ratio pattern, core thickness; the user then edits rows. Show total substrate thickness live.

BGA field (used only for warpage evaluation and JEITA limit lookup, since balls are not modeled): ball pitch (selectable 0.4, 0.5, 0.65, 0.8, 1.0, 1.27 mm), ball height, field inset from substrate edge, optional depopulated central region.

Configuration: radio buttons for bare die, lid, stiffener.

### 4.3 Floorplan editor

- Canvas drawn to scale with grid, rulers, zoom and pan. Substrate outline, BGA measuring zone (dashed), lid or stiffener footprint (hatched), underfill fillet footprint (computed and shown as a translucent band around dies), and dies.
- Dies are added from the die list, dragged with the mouse, rotated by 90° (keyboard R or button), duplicated, deleted. Each die also has numeric x, y center entry; the two stay synchronized.
- Snap to grid (default 0.1 mm, user selectable 0.01 to 1 mm) and optional snapping to other dies' edges and to substrate centerlines.
- Live dimension readouts while dragging: die-to-die gaps, die-to-substrate-edge distances, die-to-lid-foot clearance, die DNP (distance from package center to the farthest die corner).
- Validation, evaluated continuously, with red outlines and a plain-language message list:
  - Errors (block solving): die overlap; die outside substrate; die or fillet intersecting the lid foot or stiffener ring footprint; die top above the lid underside (negative TIM bond line); any dimension non-positive.
  - Warnings: die-to-die gap below 0.10 mm (underfill flow risk); fillet within 0.5 mm of lid foot or stiffener; die edge within 2 mm of substrate edge; element aspect ratios above 50 after meshing; DOF above preset cap.
- Live preview: while a die is being dragged, a Draft-mesh preview solve runs (Section 13) and the warpage contour on the floorplan updates with a "Preview (Draft)" badge. Debounce 250 ms after the pointer stops moving; cancel any in-flight preview when the die moves again. On pointer release, run the full global analysis at the selected fidelity if "auto-solve" is on (default on).

### 4.4 Die inputs

Per die: name, x size, y size, thickness, rotation (0 or 90°), Si elastic model (anisotropic cubic default, isotropic option), bump field: array type (full area or peripheral with N rows), pitch x and y, edge keep-out (distance from die edge to the first bump row center), plus bump geometry used by the homogenization and the submodel: die-side UBM diameter, substrate-side solder resist opening diameter, maximum bump diameter, standoff height.

Standoff height and solder alloy are package-global (one bump technology per package); everything else is per die. Die thickness may differ between dies.

The effective homogenization diameter `d_eff` is computed automatically as the diameter of the cylinder with the same height and volume as the truncated-sphere bump defined by the UBM diameter, SRO diameter, maximum diameter and standoff. Show it read-only.

### 4.5 Underfill, lid, stiffener inputs

- Underfill: material, fillet width W_f (distance from die edge at the substrate surface), fillet height H_f as a fraction of die thickness, effective stress-free temperature (default equals cure temperature).
- Lid (hat lid with continuous foot ring): material, outer x and y, plate thickness, foot width, adhesive material and thickness, TIM1 material and bond-line thickness over the thickest die. The foot height is derived: foot height = standoff + max die thickness + TIM BLT - adhesive thickness. TIM BLT over each thinner die is derived and shown. TIM covers each die footprint only.
- Stiffener ring: material, outer x and y, ring width, thickness, adhesive material and thickness.

### 4.6 Materials panel

A table of all materials (Section 11). Each property field shows: value with unit, a confidence badge (Datasheet, Literature, Handbook, Estimated), the datasheet range where one exists, a source tooltip with full citation and URL, and a reset-to-default button. Editing any value marks the material "modified" and the badge becomes "User". Provide "Duplicate material" to create variants, and preset dropdowns where Section 11 lists alternatives (for example ABF GL, GX-T31, GX92; core MCL-E-795G, 795G Type X, 795G Type LH, MCL-E-705G).

Each material shows small plots of E(T) and CTE(T) (instantaneous) with Tg markers, so users can see what the model will use.

### 4.7 Process and loads panel

Show the process sequence as an editable timeline (Section 6.5): stress-free reference temperatures for substrate, chip join, underfill, lid or stiffener attach. Reflow sweep settings: peak temperature (default 260 °C) and report temperatures (default 25, 150, 220, 260 °C per JEITA ED-7306 practice). Temperature cycling: condition presets JESD22-A104 G (-40/125 °C), B (-55/125 °C), J (0/100 °C), or custom; ramp rate (default 10 °C/min), dwell at each extreme (default 15 min), number of simulated cycles for the bump submodel (default 3).

### 4.8 Results views

1. Warpage: contour of out-of-plane displacement of the substrate bottom surface relative to the least-squares plane over the BGA measuring zone, at the selected temperature, overlaid on the floorplan, with values sampled at every BGA ball site. Signed warpage per JEITA ED-7306 convention, magnitude, and the JEITA maximum permissible value for the selected pitch. Diagonal profile plots. Warpage versus temperature plot over the reflow sweep (25 to peak, with the down-ramp mirrored and labeled as such), with the limit band.
2. Die stress: maximum principal stress maps on the die backside and active face; peak values in the die interior (excluding a 0.5 mm edge band) and comparative edge and corner values (Section 8.2).
3. Bump loading (CPI proxy): per-bump axial and shear force maps at the end of chip join cooldown (before underfill) and in the as-assembled state; worst bumps listed.
4. Underfill interface: normal (peel) and shear traction along each die perimeter at the die-sidewall and die-active-face interfaces, as perimeter plots, at the selected temperature.
5. Solder fatigue: per-bump screening map of the inelastic work proxy (Section 9.1); for the selected critical bumps, submodel hysteresis loops, ΔW per cycle, equivalent inelastic strain range, and life estimates (Section 9.3).
6. 3D view (three.js): exaggerated deformed shape of the package (scale slider), colored by warpage or by a stress quantity per part, with part visibility toggles.
7. Sensitivity: tornado charts (Section 10).
8. Verification: run and display the verification suite (Section 14).
9. Report: printable HTML page (browser print to PDF) containing inputs, assumptions, results, confidence labels, verification status, and the materials table with sources. Also CSV export of all scalar results and of sampled fields (warpage at ball sites, per-bump loads).

Every result card has a "What this means" expander with auto-generated plain-language interpretation (sign meaning, comparison against limits, dominant drivers from the most recent sensitivity run if available) and a confidence label:

- Warpage and its trend versus temperature: "Moderate confidence; most sensitive to stress-free temperature assumptions and polymer properties above Tg."
- Die interior stress: "Moderate confidence."
- Die corner, underfill corner, and interface tractions: "Comparative only; singular locations, mesh dependent."
- Bump forces and fatigue estimates: "Comparative only; use for ranking designs and locations."

Use colorblind-safe color maps: a perceptually uniform sequential map for magnitudes, and a diverging map centered on zero for signed quantities, with the legend always showing units and the sign convention.

### 4.9 Guidance features for engineers without FE background

- Preset packages (Section 12.2) loadable in one click.
- Inline help icons on every input explaining what it is and why it matters, in one or two sentences.
- Input guardrails: hard bounds (errors) and plausibility ranges (warnings) for every numeric input, for example die thickness 0.05 to 1.5 mm, standoff 20 to 200 µm, core thickness 0.1 to 2.0 mm, CTE 0 to 300 ppm/°C, modulus 0.0001 to 500 GPa, Poisson ratio 0 to 0.49.
- A "Check mesh sensitivity" button that reruns the current case at the next finer preset and reports the percentage change of RT warpage, die interior peak stress, and worst-bump force, with a verdict ("converged within 5%" or "results still mesh-sensitive; use the finer preset for decisions").
- A "Compare to baseline" feature: pin the current results as a baseline, then every subsequent run shows deltas and ratios against it. Encourage comparative use in the UI copy.
- An "Assumptions and limitations" panel listing every modeling assumption in plain language, including any decisions you made during the build.

## 5. Geometry to mesh

### 5.1 Approach

Use a structured, extruded hexahedral mesh: a tensor-product grid of x-lines and y-lines over the substrate outline, extruded through a set of global z-planes. Each cell (column i,j and band k) is either assigned a material (or a layered material, or a superposed pair, see 6.3) or is void (no element). Nodes exist only if attached to at least one active element. This yields conforming interfaces everywhere with no meshing robustness problems.

### 5.2 In-plane grid

1. Collect feature lines in x and y: substrate edges, every die edge, every fillet outer extent (die edge plus W_f), bump field boundaries, lid outer edges and foot inner edges, stiffener outer and inner edges.
2. Merge feature lines closer than 10 µm by snapping (report snapped features to the user).
3. Subdivide each interval between feature lines using a size function: target size `h_min` within a distance of 2x the local die thickness of any die edge, growing geometrically with ratio not above 1.3 to `h_max`. Ensure at least 3 elements across every fillet width and every lid foot or stiffener ring width; this minimum takes precedence over `h_min`.
4. Presets set `h_min`, `h_max`, and a DOF cap (Section 13). If the estimated DOF exceeds the cap, increase `h_min` and `h_max` proportionally until under the cap and tell the user.

### 5.3 z-planes and bands

Generate z-planes from the union of all physical interfaces: substrate bottom; each grouping boundary in the substrate (see below); substrate top; lid or stiffener adhesive top; bump layer top (die active face); fillet top (z at die bottom + H_f x die thickness); each die top; TIM top (lid underside); lid top; stiffener top. Merge planes closer than 1 µm.

Substrate grouping: do not create one element layer per physical substrate layer. Group the bottom solder resist plus bottom build-up stack into one band, the core into two bands, and the top build-up stack plus top solder resist into one band. Each of these bands uses layered integration through its physical sub-layers (Section 7.1). Additionally split each die band into at least two element layers, the die thickness into at least three element layers in total, the lid plate into two, and every other band into one element layer.

### 5.4 Cell material assignment

For each column (i,j) and band k, assign by the column centroid and the band:

- Substrate bands: the layered substrate material, everywhere inside the substrate outline.
- Bump band (between substrate top and die active face):
  - Under a die, inside its bump field: superposed solder phase plus underfill phase with solder volume fraction `f_b` (Section 6.3).
  - Under a die, outside its bump field (keep-out band): underfill only.
  - Outside dies, within the fillet footprint: underfill.
  - Under the lid foot or stiffener: adhesive where the adhesive band applies, else lid or stiffener material (bands are generated so that the adhesive thickness is resolved exactly).
  - Otherwise void.
- Die bands: Si inside a die footprint (respecting each die's own thickness); underfill in the fillet region if the cell z-centroid lies below the fillet surface; lid foot or stiffener material under those footprints; otherwise void.
- Fillet profile: linear wedge, height `h(d) = H_f x t_die x (1 - d / W_f)` for distance `d` from the nearest die edge with `0 <= d <= W_f`; for cells between two dies whose gap is below 2 W_f, use the larger of the two wedge heights; if the die-to-die gap is below W_f, fill the gap with underfill up to H_f. The stair-stepped fillet is an accepted approximation; document it.
- TIM band (between die top and lid underside): TIM over each die footprint, void elsewhere; lid foot material under the foot footprint.
- Lid plate bands: lid material inside the lid outline.

Compute `f_b` per cell as the area of intersection of the cell with the die's bump field rectangle (or peripheral rows) times the areal bump density `pi d_eff^2 / (4 p_x p_y)`, divided by the cell area.

### 5.5 Node numbering

Number nodes with z fastest, then y, then x, so each column's DOFs are contiguous. Store the mesh as flat typed arrays: node coordinates, element connectivity, element material or layered-section id, element phase-pair id, element band id.

### 5.6 Rigid body suppression

The package is free. Remove the six rigid body modes with a 3-2-1 constraint on substrate bottom nodes nearest to (0,0), (+a,0), (0,+a) where `a` is 40% of the smaller substrate half-dimension: fix ux, uy, uz at the first; uy, uz at the second; uz at the third. Verify that reaction forces are at round-off level (Section 14).

## 6. Material modeling

### 6.1 Material data model

Each material record holds: id, display name, grade, category, elastic symmetry (isotropic, orthotropic, cubic), E(T) definition, Poisson ratio(s), shear moduli where orthotropic, CTE definition, Tg values with method labels (TMA, DMA), cure or effective stress-free temperature, per-parameter source citation, per-parameter confidence, per-parameter datasheet range where available.

E(T) definitions supported:

- Constant.
- Table of (T, E) points, interpolated linearly in log(E) versus T, held constant beyond the end points.
- Glass transition sigmoid: `E(T) = E_r + (E_g - E_r) / (1 + exp((T - Tg_DMA) / w))`, default `w = 8 °C`.
- Linear table for metals (for example SAC305).

CTE definitions supported:

- Constant instantaneous.
- Bilinear around Tg_TMA with logistic smoothing over `delta = 3 °C`: `alpha(T) = alpha1 + (alpha2 - alpha1) / (1 + exp(-(T - Tg_TMA) / delta))`.
- Table of instantaneous alpha(T).
- Table of secant (mean) CTE referenced to `T_ref` (as many metal and composite datasheets give), converted to thermal strain directly as `eps(T) = alpha_sec(T) (T - T_ref)`, extrapolated linearly beyond the table.
- Closed-form function (silicon, Section 11).

For every material, precompute on a 1 °C grid from -80 °C to 300 °C: E(T) (or the full stiffness matrix for orthotropic and homogenized materials) and the cumulative thermal strain function `F(T) = integral of alpha from T0 to T` (per principal direction). All thermal strains in the solver are differences `F(T) - F(T_birth)`.

Poisson ratio is temperature independent in this tool. Clamp Poisson ratios used in the global hexahedral elements to at most 0.45; the bump submodel uses B-bar elements and accepts up to 0.49.

### 6.2 Substrate layer homogenization

For a Cu pattern layer with residual Cu ratio `r`, Cu properties (E_c, ν_c, α_c) and dielectric properties (E_d, ν_d, α_d) at temperature T, the phases sit side by side in-plane and both span the layer thickness:

- E_z, G_xz, G_yz: Voigt (parallel) average, `X = r X_c + (1 - r) X_d`.
- In-plane E_x = E_y and G_xy: "plane" layers use Voigt; "signal" layers use the arithmetic mean of Voigt and Reuss (`1/X = r/X_c + (1-r)/X_d`).
- Poisson ratios: rule of mixtures.
- In-plane and through-thickness CTE: Turner, `alpha = (r E_c alpha_c + (1-r) E_d alpha_d) / (r E_c + (1-r) E_d)`, computed with the same moduli used for that direction.

Dielectric layers with via Cu fraction `v` use the same formulas with `r = v`. The core uses its orthotropic laminate properties, modified by the PTH Cu area fraction `p` with the same parallel rules in z and a Turner CTE in z; in-plane properties use Voigt with `p`. Homogenize at every point of the 1 °C temperature grid, since the dielectric properties vary with temperature. Document these as approximations in the limitations panel.

### 6.3 Bump layer homogenization (superposed phases)

Inside a bump field, model the bump layer cell as two superposed elements sharing the same nodes: a solder-phase element whose stiffness is scaled by `f_b`, and an underfill-phase element scaled by `1 - f_b`. Each phase carries its own thermal strain and its own birth state. This is a Voigt (iso-strain) mixture: exact for the dominant through-thickness normal and transverse shear load paths of short columns between two plates, an upper bound for in-plane membrane stiffness. Before underfill birth only the solder phase is active.

Above the solder solidus (217 °C for SAC305), set the solder-phase modulus to 1% of E(217 °C) and flag results at those temperatures ("solder molten; constrained by underfill").

### 6.4 Silicon

Default: cubic anisotropic stiffness (C11, C12, C44) for a (100) wafer with die edges along <110>, implemented by rotating the cubic stiffness tensor 45° about z. Isotropic option: E = 130 GPa, ν = 0.28. Both give the same equal-biaxial in-plane modulus (about 180 GPa), which is why the isotropic option remains reasonable for warpage; the anisotropic model gives the correct in-plane modulus along the die edges (about 169 GPa). Unit-test the rotation (Section 14).

### 6.5 Process sequence and stress-free states (total formulation with element birth)

Use a total (secant) thermoelastic formulation with element birth:

`sigma = D_m(T) (eps - eps_birth - [F_m(T) - F_m(T_birth,m)])`

where `eps_birth` is the total strain at the Gauss point at the moment material m is born, `T_birth,m` is that material's stress-free (birth) temperature, and `D_m(T)` is evaluated at the current temperature. Rationale to document in the limitations panel: path-independent and reversible, one linear solve per evaluation temperature, standard practice in package warpage FE; it does not capture viscoelastic relaxation, so each polymer's effective stress-free temperature is exposed as a user knob (default equals its cure temperature; engineers sometimes calibrate it toward Tg to emulate relaxation).

Default sequence (all editable):

| Stage | Event | Birth temperature |
|---|---|---|
| S0 | Substrate born stress-free | T_sub = 217 °C (option: ABF cure, 200 °C) |
| S1 | Die(s) and solder phase born (chip join, solder solidification) | T_join = 217 °C |
| S2 | Underfill phase and fillet born (UF cure) | T_UF = 165 °C |
| S3 | Lid, TIM1 and lid adhesive born; or stiffener and its adhesive | T_attach = 150 °C |
| End | As-assembled state at 25 °C | (evaluation) |

Implementation:

- Not-yet-born elements are present with stiffness scaled by 1e-6 and no thermal load, so every node stays connected.
- To obtain `eps_birth` for stage s, solve the stage s-1 configuration at `T_birth,s` and store total Gauss-point strains (including enhanced-mode strains, Section 7.1) for every element of stage s. If `T_sub != T_join`, solve the free substrate at T_join first.
- Any evaluation at temperature T in stage s is one linear solve: `K_s(T) u = sum over born materials of integral B^T D_m(T) [eps_birth + F_m(T) - F_m(T_birth,m)] dV` (plus the enhanced-mode counterpart, condensed).
- Required evaluations: as-assembled at 25 °C; end of chip join cooldown at 25 °C with stage S1 only (for the CPI proxy); reflow sweep temperatures; temperature-cycling samples (Section 9.2).

## 7. Global solver

### 7.1 Element

8-node hexahedron with Wilson-Taylor incompatible modes (Hex8 with 9 enhanced modes, using Taylor's modification that evaluates the incompatible-mode derivatives with the Jacobian at the element center so the patch test passes), statically condensed per element. This element represents bending of thin layers well with one or two elements through the thickness, which is essential here.

Integration: 2x2x2 Gauss for single-material elements. Layered elements (substrate bands) integrate through each physical sub-layer separately with 2x2 in-plane by 2 through-thickness Gauss points per sub-layer, mapping each sub-layer's z-range into the element's natural coordinate. Thermal and birth-strain loads are integrated the same way, and condensed consistently with the stiffness (`f_c = f_u - K_ua K_aa^-1 f_a`). Store what is needed to recover the enhanced-mode parameters after solving.

Stress recovery: compute stresses at Gauss points (including enhanced strains); extrapolate to element nodes; average nodal values only among elements of the same material on the same side of an interface, never across interfaces. Report which sampling (Gauss or nodal-averaged) each displayed value uses; peak values from nodal extrapolation can differ meaningfully from Gauss-point values, so show both in the detail tooltip of every peak result.

### 7.2 Assembly and storage

Symmetric 3x3 block CSR (BCSR) storing the upper triangle, built from the structured connectivity (each node couples to at most 27 nodes). Reuse the sparsity pattern across all solves; reassemble values per temperature. Assemble with the 1 °C property tables.

### 7.3 Linear solver

Preconditioned conjugate gradient on the BCSR matrix, with:

- Symmetric diagonal (Jacobi) scaling first, to tame the very large stiffness contrast (gel TIM at MPa level next to Si at 10^5 MPa).
- Recommended preconditioner: a semi-coarsening geometric multigrid V-cycle exploiting the structured column grid. Coarsen in x and y only (drop every other grid line), keep all z-planes. Prolongation: linear interpolation in x and y within each z-plane, with weights renormalized over existing coarse nodes when some are absent (void cells). Coarse operators by Galerkin product `P^T K P`. Smoother: symmetric block Gauss-Seidel in which each block is one column (all DOFs of one (i,j) column, typically 30 to 50 DOFs), using prefactored dense Cholesky of each column block. Coarsest grid solved by dense Cholesky (or a few hundred DOFs by PCG). The column blocks capture the strong through-thickness coupling and the layer-wise stiffness contrast; the in-plane coarse grids capture plate bending.
- Fallback preconditioner: incomplete Cholesky IC(0) on the scaled matrix with Manteuffel diagonal shift on breakdown.
- Benchmark both on the default case at each preset and use the faster one by default; report the numbers in the final report.
- Warm start each solve with a Galerkin projection onto the span of up to 20 previous solutions of the same mesh (orthonormalize the stored vectors; solve the small dense projected system; use it as the initial guess). This sharply reduces iterations across the many temperature evaluations.
- Rebuild the preconditioner only when PCG iterations exceed twice those of the solve right after the last rebuild.
- Convergence: relative residual below 1e-8. Report iterations and residual per solve in a "Solver log" drawer. If not converged in 2000 iterations, rebuild the preconditioner with the other method once; if still not converged, show an error and keep the last valid results.

## 8. Post-processing definitions

### 8.1 Warpage (JEITA ED-7306 and JESD22-B112 convention)

- Surface: substrate bottom (BGA side). Measuring zone: the BGA field (outermost ball centers). Sample out-of-plane displacement w at every ball site by interpolation.
- Fit the least-squares plane through the sampled w; residual r = w - plane.
- Magnitude |C| = max(r) - min(r).
- Sign: along each measuring-zone diagonal (corner to corner), compute displacements relative to the straight base line joining that diagonal's end points, positive meaning toward the package top surface (away from the PWB). Let AB_max, AB_min, CD_max, CD_min be the largest positive and largest negative values on the two diagonals (use 0 when none). Sign = sign(AB_max + AB_min + CD_max + CD_min). Positive is convex: the top surface arches, the package center is farther from the PWB than the corners. Negative is concave.
- Report signed warpage = sign x |C|.
- Limits: JEITA ED-7306 Table 1 maximum permissible package warpage at elevated temperature (absolute, mm): pitch 0.4 mm (ball height 0.20): 0.10; 0.5 (0.25): 0.11; 0.65 (0.33): 0.14; 0.8 (0.35 or 0.40): 0.17; 1.0 (0.50): 0.22; 1.27 (0.60): 0.25. Room-temperature coplanarity reference values from the same document: 0.08, 0.08, 0.10, 0.10, 0.20, 0.20 mm for those pitches respectively (0.10 for both 0.8 mm cases). Show these as editable defaults labeled "JEITA ED-7306 (2007); customer limits for large FCBGA often differ."

Also report the substrate top-surface warpage map and the die-to-substrate relative curvature for completeness.

### 8.2 Die stress

- Die backside (top surface) and active face (bottom surface): maximum principal stress maps.
- Interior peak: maximum over the die face excluding a 0.5 mm band at the die edges. Moderate confidence.
- Edge and corner metrics: average of the maximum principal stress over a fixed physical patch of 100 µm x 100 µm (in-plane) at each die corner and at mid-edges, on both faces. Label comparative. A fixed physical averaging size, not one element, keeps the metric from changing arbitrarily with mesh refinement.
- Optional user-entered die strength (no default) to show a margin.

### 8.3 Bump loading (chip-package interaction proxy)

For each bump site, compute the solder-phase stress (iso-strain with the homogenized layer, Section 6.3) at that location, convert to per-bump axial force `N = sigma_zz x A_bump` and shear force `V = sqrt(tau_xz^2 + tau_yz^2) x A_bump` with `A_bump = pi d_eff^2 / 4`. Report at: (a) end of chip join cooldown at 25 °C before underfill (stage S1 only), which is typically the critical case for BEOL/ELK cracking at die corners because the bumps alone carry the mismatch; (b) as-assembled at 25 °C. Label (a) "elastic upper bound; real joints relax by creep during cooldown." Optional user-entered force thresholds (no default).

### 8.4 Underfill interface tractions

Along each die perimeter, at the die sidewall to fillet interface and at the die active face to underfill interface near the die edge, compute normal (peel, tension positive) and shear tractions from interface-adjacent Gauss-point stresses on the underfill side, averaged over 50 µm x 50 µm patches stepped along the perimeter. Plot versus perimeter position with die corners marked. Label comparative.

## 9. Solder fatigue

### 9.1 Screening across all bumps (fast)

For every bump site (subsample if more than 20,000 bumps per die, always keeping the outer 3 rows and a 10 x 10 corner block at each die corner):

- From the global model, interpolate the total strain tensor of the bump layer at the site at each temperature sample of the cycle (Section 9.2). Under the iso-strain assumption this is the solder's total strain; subtract the solder thermal strain increment.
- Integrate the Anand model (Section 9.4) at that material point through the simulated cycles with the same time history as the submodel, starting from zero stress at 25 °C.
- Report the stabilized-cycle inelastic work density ΔW_proxy and equivalent inelastic strain range per bump as a map. Label "screening index; ranks locations; not a life."

### 9.2 Global states for cycling

Solve the global model (as-assembled stage) at temperature samples spanning [T_min, T_max] of the cycle: every 10 °C, refined to every 5 °C within ±15 °C of any Tg present in the model, plus the extremes and 25 °C. The global response is reversible under the total formulation, so the displacement field at any time in the cycle is obtained by piecewise-linear interpolation in temperature.

### 9.3 Bump submodel (detailed, on demand)

For the user-selected critical bumps (default: the top 4 by ΔW_proxy, at least one per die), build a local 3D model:

- Domain: one pitch cell (p_x by p_y) centered on the bump; in z from 50 µm below the substrate top surface to 50 µm above the die active face. Materials: Si slice (anisotropic per die setting); solder as a truncated sphere defined by UBM diameter, SRO diameter, maximum diameter and standoff; underfill filling the rest of the bump layer; substrate slice using the homogenized properties of the top 50 µm of the substrate stack (top solder resist plus underlying layers).
- Mesh: structured voxel grid, default 16 x 16 in-plane and 14 in z (user option 12 or 20), material by voxel centroid; refine z so that interface layers of the averaging thickness are resolved. Element: Hex8 with B-bar (mean dilatation) for near-incompressible plastic flow.
- Boundary conditions: cut-boundary displacements on all six faces, interpolated from the global solution at the same physical points (trilinear within global elements), applied as the change from the as-assembled 25 °C state. Uniform temperature from the cycle profile.
- Formulation: perturbation from the as-assembled 25 °C state. Elastic materials use the total form relative to that state (`sigma = D(T)(eps - [F(T) - F(25)])`, with eps the strain change from the 25 °C state). Solder starts stress-free at 25 °C (assumes room-temperature relaxation of residual solder stress; state this).
- Time history: start at 25 °C, ramp to T_max, dwell, ramp to T_min, dwell, repeat for the configured number of cycles. Adaptive time steps: at most 5 °C per step on ramps, and limit the equivalent inelastic strain increment per step to 2e-4 (cut back and retry if exceeded), with dwells subdivided at least 10 steps.
- Global equilibrium iteration: Newton-Raphson with the algorithmic tangent from the Anand return mapping (Section 9.4); acceptable fallback: modified Newton with line search. Linear solves by PCG with IC(0). Convergence: relative residual force norm 1e-6 and displacement correction norm 1e-8 relative.
- Outputs: stabilized (last) cycle ΔW volume-averaged over a layer of thickness t_avg = 25 µm at the die-side interface and at the substrate-side interface (report both, use the larger); equivalent inelastic strain range averaged the same way; shear stress versus shear strain hysteresis loop (volume-averaged in the critical interface layer); cycle-to-cycle ΔW change as a stabilization check (warn if the last two cycles differ by more than 5%).
- Life estimates (all labeled comparative, order-of-magnitude):
  - Default energy model, Syed form: `N_f = 1 / (C_W x ΔW)` with ΔW in MPa per cycle and default C_W = 0.00165 MPa^-1, as cited by Amalu et al. (2015) from Syed (ECTC 2004). Note in the tooltip that other secondary sources quote 0.0019, and that the constants were fitted to accumulated creep energy from a different constitutive model and joint geometry.
  - Strain model, Syed form: `N_f = 1 / (0.0513 x eps_acc)` (same source).
  - Darveaux crack initiation and growth: `N_0 = K1 ΔW^K2`, `da/dN = K3 ΔW^K4`, `N_f = N_0 + a / (da/dN)` with a = the joint diameter at the critical interface. No default constants: K1 and K3 depend on element size and averaging scheme, so the user must enter constants calibrated to the same modeling approach; show this explanation.
  - Always show the ratio of life versus the pinned baseline when one exists; that ratio is the most trustworthy fatigue output.

### 9.4 Anand viscoplastic model (SAC305)

Flow and evolution equations (equivalent stress σ, equivalent inelastic strain rate ε̇p, deformation resistance s, absolute temperature T in K):

- `ε̇p = A [sinh(ξ σ / s)]^(1/m) exp(-Q/(R T))`
- `ṡ = h0 |B|^a sign(B) ε̇p`, with `B = 1 - s / s*`
- `s* = ŝ [ (ε̇p / A) exp(Q/(R T)) ]^n`
- Initial s = s0.

Integration: backward Euler with J2 radial return. Elastic predictor `s_trial = 2 G(T_{n+1}) (e_{n+1} - e^p_n)` (deviatoric), `σ_trial = sqrt(3/2) |s_trial|`. Unknowns Δε̄p and s_{n+1}; residuals: `Δε̄p - Δt A [sinh(ξ (σ_trial - 3 G Δε̄p) / s_{n+1})]^(1/m) exp(-Q/(R T))` and `s_{n+1} - s_n - h0 |B|^a sign(B) Δε̄p` with B evaluated at n+1. Solve the 2x2 system by Newton with a bracketing safeguard on Δε̄p in [0, σ_trial / (3 G)], substepping the time increment if Newton fails. Update the plastic strain along the fixed return direction `n = s_trial / |s_trial|`. Provide the consistent tangent. Use the temperature-dependent SAC305 elastic modulus and its Poisson ratio from Section 11. Accumulate inelastic work density `W += σ_eq Δε̄p` (midpoint stress) per material point.

## 10. Sensitivity analysis (tornado)

On demand, using the Draft preset, perturb one input at a time to the low and high ends of its range and record changes in: RT signed warpage, peak reflow warpage, die backside interior peak stress, worst-bump ΔW_proxy (screening only, no submodel). Range per input: the datasheet range where Section 11 gives one (for example core CTE x,y 3.0 to 5.0 ppm/°C), otherwise ±10% of the current value; for temperatures (stress-free temperatures, Tg) ±10 °C. Default input set: core CTE and modulus, core thickness, ABF α1, α2, E, Tg, residual Cu ratio (all layers scaled together), Cu CTE, underfill α1, α2, E_glassy, Tg, effective stress-free temperature, die thickness, standoff, fillet width, lid or stiffener material CTE and thickness, adhesive modulus, solder resist α1 and thickness. Show the top 10 per output as tornado charts, cache results with the configuration hash, and let users add or remove inputs.

## 11. Default materials database (embed as a JSON block in the HTML; every value carries its source and confidence)

Confidence labels: Datasheet (manufacturer typical value), Literature (peer-reviewed or conference source), Handbook (generic engineering value, verify), Estimated (no source found; placeholder that should be replaced with measured or DMA data; flag prominently in the UI).

### 11.1 Silicon (die)

- Cubic stiffness C11 = 165.7, C12 = 63.9, C44 = 79.6 GPa [R10]. Literature. Rotate 45° about z for die edges along <110>. Checks: E<100> = 130 GPa, E<110> = 169 GPa, equal-biaxial modulus on (100) about 180 GPa.
- Isotropic option: E = 130 GPa, ν = 0.28. Literature.
- CTE (instantaneous), Okada and Tokumaru [R11], T in K: `alpha(T) = [3.725 (1 - exp(-5.88e-3 (T - 124))) + 5.548e-4 T] x 1e-6 /K`. Checks: 1.89 ppm/K at -40 °C, 2.55 at 25 °C, 3.20 at 125 °C, 3.56 at 217 °C, 3.69 at 260 °C. Literature.

### 11.2 SAC305 solder (bumps)

- E(T) table: 57.4 GPa at -40 °C, 46.5 at 25 °C, 38.2 at 75 °C, 30.0 at 125 °C; extrapolate linearly beyond (about 14.8 GPa at 217 °C); 1% of E(217 °C) above the 217 °C solidus. ν = 0.40. CTE = 22.5 ppm/°C. [R8] Table 1. Literature.
- Anand constants (Motalab et al. 2012 [R9], as tabulated in [R8] Table 2): A = 3501 s^-1; Q/R = 9320 K; ξ = 4.0; m = 0.25; ŝ = 30.2 MPa; n = 0.01; h0 = 180,000 MPa; a = 1.78; s0 = 21.0 MPa. Literature. Tooltip: bulk-specimen constants; small C4 joints with different microstructure and aging state can deviate.
- Alternatives selectable but without bundled data: SAC105, SAC387 (the user enters properties; show a notice that defaults are SAC305 only).

### 11.3 Copper (substrate metallization, core foil, PTH, and default lid and stiffener)

- E = 110 GPa, ν = 0.34; CTE table (instantaneous): 15.3 ppm/°C at -40, 16.4 at 25, 16.7 at 50, 17.3 at 125 °C, extrapolated linearly [R8] Table 1. Literature. Elastic only (plasticity ignored; state this).

### 11.4 Build-up dielectric (ABF) [R1]

| Grade | α1 (25 to 150 °C) | α2 (150 to 240 °C) | Tg TMA | Tg DMA | E at 25 °C | Cure |
|---|---|---|---|---|---|---|
| ABF GL series (default; e.g. GL102) | 20 ppm/°C | 49 ppm/°C | 153 °C | 171 °C | 13 GPa | 200 °C, 90 min |
| ABF GX-T31 | 23 | 78 | 154 | 172 | 7.5 GPa | not stated |
| ABF GX92 | 39 | 117 | 153 | 168 | 5.0 GPa | not stated |

All Datasheet (manufacturer conference paper, x-y CTE by tensile TMA). Not given and therefore Estimated: ν = 0.30; rubbery modulus E_r = 0.08 x E_g (about 1.0 GPa for GL). The rubbery modulus strongly affects reflow-temperature warpage; flag it in the UI and include it in the default tornado set. Use the CTE in-plane and through-thickness alike unless the user edits it (state this).

### 11.5 Core laminate (glass-fabric prepreg core) [R2], [R3]

Default: Resonac MCL-E-795G (standard type), values at mid-range of the datasheet ranges:

- CTE x, y (30 to 120 °C): 4.0 ppm/°C (range 3.0 to 5.0). Datasheet.
- CTE z: 12.5 ppm/°C below Tg (range 10 to 15), 85 above Tg (range 70 to 100). Datasheet.
- Tg TMA 275 °C (range 260 to 290); Tg DMA 330 °C (range 315 to 345). Datasheet. (Above every analysis temperature, so the core stays glassy.)
- E_x = E_y = 36 GPa from flexural modulus lengthwise (range 35 to 37; measured at 800 µm thickness). Datasheet, with the approximation that flexural equals in-plane tensile modulus (state this).
- Estimated: E_z = 12 GPa, G_xy = 8 GPa, G_xz = G_yz = 5 GPa, ν_xy = 0.15, ν_xz = ν_yz = 0.30, rubbery ratio 0.3. Orthotropic ratios are in line with typical published laminate inputs, for example the orthotropic substrate data in [R8] Table 1.
- Presets: 795G Type X (CTE x,y 2.0 to 4.0, flexural 36 to 38 GPa); 795G Type LH (CTE x,y 0.5 to 3.0, flexural 40 to 42 GPa); MCL-E-705G (CTE x,y 5 to 7, Tg TMA 250 to 270, Tg DMA 295 to 305, flexural 32 to 34 GPa; from [R3], secondary summary of the manufacturer datasheet). Other values as the default.

### 11.6 Solder resist [R4]

Taiyo PSR-4000 AUS703 (FC package grade): Tg (TMA) 105 °C; α1 = 55 ppm/°C; α2 = 140 ppm/°C. Datasheet. Estimated: E_g = 3.0 GPa (published packaging inputs and patents place solder resist moduli around 2 to 4 GPa), E_r = 0.1 GPa, ν = 0.30.

### 11.7 Underfill [R5]

Henkel LOCTITE ECCOBOND UF 9000AE (large-die FCBGA capillary underfill): α1 = 23 ppm/°C, α2 = 85 ppm/°C; Tg DMA 111 °C, TMA 112 °C; storage modulus 13.5 GPa at 25 °C and 0.136 GPa at 250 °C (use these as E_g and E_r of the sigmoid centered at Tg DMA); recommended cure 100 °C for 90 min then 165 °C for 2 h. Datasheet. Estimated: ν = 0.30. Default effective stress-free temperature 165 °C.

### 11.8 Lid and stiffener adhesive [R6]

Henkel LOCTITE ECCOBOND 3005 (silicone lid attach for FCBGA; the datasheet also lists stiffener use): α1 = 32 ppm/°C, α2 = 136 ppm/°C, Tg (TMA) -15 °C; tensile modulus (DMTA) 7.918 GPa at -65 °C, 0.358 GPa at 25 °C, 0.052 GPa at 150 °C (use the table E(T) form); cure 30 min at 150 °C. Datasheet. Estimated: ν = 0.45.

### 11.9 TIM1

- Default: generic silicone gel TIM, E = 5 MPa, ν = 0.45, CTE = 200 ppm/°C. Estimated (patent guidance suggests gel TIM moduli below about 0.03 GPa to decouple the lid from the die [R12]). Flag prominently.
- Option: indium metal TIM, E ≈ 11 GPa, ν ≈ 0.45, CTE ≈ 32 ppm/°C. Handbook, verify; elastic only, so it overestimates stress transfer because indium creeps readily at these temperatures (state this).

### 11.10 Lid and stiffener materials

- Cu (Ni-plated): as 11.3. Default for lid and stiffener.
- AlSiC-9 [R7]: E = 188 GPa, G = 76 GPa (ν = 0.237 derived); secant CTE from 30 °C: 8.00 ppm/°C to 100 °C, 8.37 to 150 °C, 8.75 to 200 °C. Datasheet.
- AlSiC-12 [R7]: E = 167 GPa, G = 69 GPa (ν = 0.210 derived); secant CTE from 30 °C: 10.9 to 100 °C, 11.2 to 150 °C, 11.7 to 200 °C. Datasheet.
- Stainless steel 304 (stiffener option): E = 193 GPa, ν = 0.29, CTE 17.3 ppm/°C (0 to 100 °C). Handbook, verify.

## 12. Default configuration and presets

### 12.1 Default package (lidded, single die)

- Substrate 45.0 x 45.0 mm; stack 6-2-6, top to bottom: solder resist 20 µm; L1 Cu 15 µm r = 0.35 signal (C4 pad layer); ABF 25 µm; L2 Cu 15 µm r = 0.75 plane; ABF 25; L3 15 µm r = 0.45 signal; ABF 25; L4 15 µm r = 0.75 plane; ABF 25; L5 15 µm r = 0.45 signal; ABF 25; L6 15 µm r = 0.75 plane; ABF 25; L7 core Cu 18 µm r = 0.70 plane; core MCL-E-795G 800 µm with PTH Cu fraction 2%; L8 core Cu 18 µm r = 0.70 plane; then the bottom build-up mirrored (ABF 25 between each Cu layer) with L9 0.75, L10 0.45, L11 0.75, L12 0.45, L13 0.75, L14 (BGA pad layer) 0.55; solder resist 20 µm. Total about 1.356 mm (display it).
- BGA field: 1.0 mm pitch, ball height 0.50 mm, inset 1.0 mm from the substrate edge, fully populated.
- Die: 20.0 x 20.0 x 0.775 mm, centered, anisotropic Si; full-area bump array at 150 µm pitch, edge keep-out 150 µm; UBM 85 µm, SRO 90 µm, maximum bump diameter 105 µm, standoff 75 µm.
- Underfill UF 9000AE; fillet width 0.8 mm; fillet height 70% of die thickness.
- Lid: Cu, 43.0 x 43.0 mm, plate 1.0 mm, foot width 3.0 mm; adhesive ECCOBOND 3005, 100 µm; TIM1 gel, 50 µm over the die.
- Process: T_sub = T_join = 217 °C, T_UF = 165 °C, T_attach = 150 °C. Reflow sweep to 260 °C. Cycling JESD22-A104 condition G, -40/125 °C, 10 °C/min ramps, 15 min dwells, 3 cycles.

### 12.2 Presets

1. Default lidded single die (12.1).
2. Bare die: 12.1 without lid.
3. Stiffener, two dies side by side: substrate 55.0 x 55.0 mm; two 16.0 x 24.0 mm dies, 0.775 mm thick, 0.20 mm gap, centered as a pair; Cu stiffener 53.0 x 53.0 mm outer, 4.0 mm ring width, 0.8 mm thick, ECCOBOND 3005 50 µm; other settings as 12.1.
4. Offset die (asymmetry demo): 12.1 with a 15.0 x 15.0 mm die offset by (+8, +6) mm, bare.
5. Core thickness study (Resonac TEG-like, bare die) [R2]: substrate 40.0 x 40.0 mm, 3-2-3 stack with 20 µm build-up dielectric per layer, Cu 15 µm per layer (Cu thickness not stated by the source; state this), solder resist 19 µm, core MCL-E-795G at 0.4 mm (variant A) and 0.8 mm (variant B); die 20.0 x 20.0 x 0.775 mm. Provide a one-click "run both and compare" action.

## 13. Fidelity presets and performance targets

| Preset | h_min / h_max (mm) | DOF cap | Use |
|---|---|---|---|
| Draft | 0.6 / 3.0 | 30,000 | drag preview, sensitivity |
| Standard (default) | 0.25 / 1.5 | 120,000 | normal use |
| Fine | 0.10 / 0.6 | 400,000 | convergence checks, final comparisons |

Targets on a 2023-class laptop in a current Chromium browser (measure and report actual numbers):

- Drag preview (Draft; stage solves plus the 25 °C evaluation): under 2 s.
- Standard full global analysis (stages, 25 °C, CPI state, reflow sweep, cycling samples): under 90 s.
- Fine full global analysis: under 10 min, with progress.
- Screening over all bumps: under 10 s.
- Bump submodel, 3 cycles, 4 bumps, default resolution: under 120 s.
- Sensitivity (Draft, default input set): under 3 min.
- Peak memory: under 600 MB at Standard.

Cache: hash each configuration section (geometry, materials, process, loads, mesh) and recompute only what changed. Show estimated DOF, memory, and runtime before every run.

## 14. Verification suite and acceptance criteria

Implement these as an in-app Verification tab (runs in the worker, shows pass or fail with numbers) and, if your environment can execute code, run them headless in Node from the extracted core block before delivering. All must pass; if one cannot, report it with the measured values and the reason.

| ID | Test | Acceptance |
|---|---|---|
| V1 | Free uniform thermal expansion of a single-material block, ΔT = 100 °C | Stress below 1e-8 x E αΔT; displacements equal αΔT x position to 1e-9 relative |
| V2 | Patch test of the incompatible-mode hex on a distorted mesh (constant strain field) | Exact to 1e-9 relative |
| V3 | Bimaterial plate curvature: isotropic A (E 130 GPa, ν 0.28, α 2.6 ppm/°C, 0.5 mm) on B (E 110 GPa, ν 0.34, α 16.4 ppm/°C, 0.5 mm), 40 x 40 mm, ΔT = -100 °C; compare center curvature (fit over the central 10 x 10 mm) to Timoshenko with biaxial moduli M = E/(1-ν): κ = 6 Δα ΔT (1+m)^2 / (h [3(1+m)^2 + (1+mn)(m^2 + 1/(mn))]), m = t_A/t_B, n = M_A/M_B, h = t_A + t_B | Within 3% at Standard |
| V4 | Asymmetric three-layer laminate with one orthotropic layer, free thermal curvature versus classical lamination theory (an independent ABD implementation inside the suite) | Within 3% |
| V5 | Layered-integration element versus the same stack meshed with one element layer per physical layer | Center warpage within 1% |
| V6 | Anand material point, constant strain-rate uniaxial loading to saturation versus closed form σ* = (s*/ξ) asinh[((ε̇/A) exp(Q/RT))^m], s* = ŝ ((ε̇/A) exp(Q/RT))^n | 42.1 MPa at 25 °C and 1e-3 s^-1; 22.8 MPa at 125 °C and 1e-3 s^-1; 13.0 MPa at 125 °C and 1e-5 s^-1; each within 1% |
| V7 | Submodel consistency: with solder set elastic and all submodel materials replaced by the homogenized bump-layer phase properties, submodel strains reproduce the global strains at the bump site | Within 2% |
| V8 | Symmetry: centered single die gives a warpage field symmetric about x, y and both diagonals; mirroring the floorplan mirrors results | 1e-6 relative |
| V9 | Physical sanity on the bare-die preset: RT warpage is convex (positive per 8.1); die backside interior stress is tensile; preset 5 variant B (0.8 mm core) has lower absolute RT warpage than variant A (0.4 mm); switching the core from MCL-E-705G to MCL-E-795G Type LH lowers absolute RT warpage | All four hold |
| V10 | Mesh convergence on the default package: Standard versus Fine | RT warpage and die interior peak stress within 5% |
| V11 | Solver integrity on the default package: residual, sum of reaction forces at the 3-2-1 constraints, energy balance | Relative residual below 1e-8; reactions below 1e-9 of the internal force scale |
| V12 | JEITA sign and magnitude on synthetic surfaces: dome w = c(1 - (x/L)^2 - (y/L)^2) gives positive sign and the analytic magnitude; inverted dome gives negative | Exact sign; magnitude to 1e-9 |
| V13 | Unit checks: Si CTE at 25 and 125 °C (2.553, 3.203 ppm/K), Si rotated modulus along x (169 GPa) and along a diagonal (130 GPa), SAC305 E at 25 °C (46.5 GPa), AlSiC-9 thermal strain at 150 °C (8.37e-6 x 120), Turner CTE and Voigt or Reuss homogenization on hand-computed cases | Exact to 1e-9 |
| V14 | Save then load JSON configuration round trip | Identical configuration hash |
| V15 | Timing benchmark of the default package at each preset, both preconditioners | Report; compare against Section 13 |

## 15. Build order and delivery

Internal order (one pass, no approval stops): materials data model and the JSON database; homogenization; mesher; element; assembly; linear solvers and preconditioners; process sequencing and evaluations; post-processing; Anand integrator; screening; submodel; sensitivity; worker protocol; UI shell and theming; floorplan editor; package, die, materials, process panels; results views and 3D view; report and exports; verification tab. Write the verification tests alongside each physics module and run them as you go.

Code quality: comment every physics routine with its governing equation and the reference it implements; keep magic numbers in a single constants object; no dead code; meaningful names.

When finished, your final message must contain:

1. The HTML file.
2. A verification table (ID, measured value, criterion, pass or fail).
3. Measured timings per Section 13 and which preconditioner won.
4. Every deviation from this specification with what, why, and the observable consequence.
5. Known issues and suggested next steps.

## 16. Limitations to display in-app (at minimum)

Total thermoelastic formulation for all non-solder materials (no viscoelastic relaxation; effective stress-free temperature knob); polymer properties above Tg partly estimated; substrate layers homogenized with mixture rules; bumps homogenized in the global model (iso-strain); stair-stepped underfill fillet; solder molten above 217 °C represented by a modulus floor; uniform temperature only; no BGA balls or PCB; no moisture; no Cu plasticity; no initial substrate warpage; singular corner quantities are comparative only; fatigue constants come from other joint geometries and constitutive models, so lives are order-of-magnitude and best used as ratios.

## 17. References

- [R1] S. Tatsumi, S. Fujishima, H. Sakauchi (Ajinomoto), "Advanced Build-up Materials for High Speed Transmission Application," IMAPS 51st International Symposium on Microelectronics, 2018, Tables 1 and 2. https://imapsource.org/article/55935-advanced-build-up-materials-for-high-speed-transmission-application.pdf
- [R2] Resonac, MCL-E-795G product page, characteristics table (t0.4 mm laminate; flexural modulus at 800 µm) and warpage TEG description. https://www.resonac.com/products/pwb-materials/base/005.html
- [R3] Resonac, MCL-E-705G product page (Tg, CTE z). https://eu.resonac.com/project/e705g/ ; PCB Directory summary of the MCL-E-705G datasheet (CTE x,y 5 to 7 ppm/°C, flexural modulus 32 to 34 GPa). https://www.pcbdirectory.com/equipment/products/pcb-laminate/resonac-corporation/49-527-mcl-e-705g
- [R4] Taiyo America, PSR-4000 AUS703 technical data sheet. https://taiyo-america.com/docs/files/3913/8256/2650/TDS_PSR-4000_AUS703_022005.pdf
- [R5] Henkel, LOCTITE ECCOBOND UF 9000AE technical data sheet, February 2024 (distributed by CAPLINQ).
- [R6] Henkel, LOCTITE ECCOBOND 3005 technical data sheet, August 2012. https://datasheets.tdx.henkel.com/LOCTITE-ECCOBOND-3005-en_GL.pdf
- [R7] CPS Technologies, AlSiC material properties sheet, 2025. https://cpstechnologysolutions.com/wp-content/uploads/2025/09/CPS-Alsic-2025-Final.pdf
- [R8] Y. Xu, J. Xian, S. Stoyanov, C. Bailey, R. J. Coyle, C. M. Gourlay, F. P. E. Dunne, "A multi-scale approach to microstructure-sensitive thermal fatigue in solder joints," arXiv:2204.05583, Tables 1 and 2. https://arxiv.org/abs/2204.05583
- [R9] M. Motalab, Z. Cai, J. C. Suhling, P. Lall, "Determination of Anand constants for SAC solders using stress-strain or creep data," ITherm 2012, pp. 910 to 922.
- [R10] M. A. Hopcroft, W. D. Nix, T. W. Kenny, "What is the Young's Modulus of Silicon?" Journal of Microelectromechanical Systems 19(2), 2010.
- [R11] Y. Okada, Y. Tokumaru, "Precise determination of lattice parameter and thermal expansion coefficient of silicon between 300 and 1500 K," Journal of Applied Physics 56, 314 (1984).
- [R12] US Patent 6,784,535, composite lid for LGA flip chip package (gel TIM modulus guidance).
- [R13] JEITA ED-7306, "Measurement methods of package warpage at elevated temperature and the maximum permissible warpage," 2007. https://home.jeita.or.jp/tsc/std-pdf/ED-7306_E.pdf
- [R14] JEDEC JESD22-B112C, "Package Warpage Measurement of Surface-Mount Integrated Circuits at Elevated Temperature," November 2023 (same sign convention as [R13]).
- [R15] JEDEC JESD22-A104, Temperature Cycling (conditions G, B, J).
- [R16] E. H. Amalu, N. N. Ekere, C. F. Oduoza, M. T. Zarmai, "Evaluation of Garofalo creep model for lead-free solder joints in surface mount components," TechConnect Briefs 2015, pp. 282 to 285 (cites A. Syed, ECTC 2004, pp. 737 to 746, for the life models).
- [R17] R. Darveaux, "Effect of simulation methodology on solder joint crack growth correlation and fatigue life prediction," Journal of Electronic Packaging 124, 2002, pp. 147 to 154; and Altair OptiStruct PFATSDR documentation noting that K1 and K3 are model dependent.
