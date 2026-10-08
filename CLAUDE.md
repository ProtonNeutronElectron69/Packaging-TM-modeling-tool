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
