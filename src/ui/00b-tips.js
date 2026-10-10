// ===== UI: tooltips =============================================================
// One dictionary for every control and result quantity, rendered by a small
// custom tooltip (fast, themed, keyboard reachable) instead of the native title.

const TIPS = {
  // ---- shell ----
  step1: 'Substrate outline, layer stack, BGA field and the package configuration (bare, lid, stiffener).',
  step2: 'Die list and properties, bump fields, and the drag-and-drop floorplan.',
  step3: 'Underfill fillet, lid (plate, foot, adhesive, TIM) or stiffener ring geometry.',
  step4: 'The cited materials database: edit values, duplicate materials, switch presets.',
  step5: 'Process stress-free temperatures, reflow sweep, temperature cycling, limits and fatigue constants.',
  step6: 'Mesh fidelity, run controls, baseline comparison, results, sensitivity, verification and report.',
  tabFloorplan: 'Top-down floorplan with the warpage or stress overlay, plus the cross-section along the cut line A-A\'.',
  tabResults: 'All results views: warpage, die stress, bump loading, underfill interface, solder fatigue, 3D, sensitivity, verification, report.',
  tab3d: 'Exaggerated deformed shape of the package (three.js); needs a full analysis.',
  theme: 'Cycle the colour theme: automatic (follows the system), light, dark.',
  helpBtn: 'Every modeling assumption and build decision in plain language.',
  cancel: 'Stop the running job. The worker is restarted; results already in memory are kept.',
  limitations: 'Every modeling assumption and build decision in plain language.',
  // ---- step 1 ----
  presetPkg: 'Load one of the reference packages from the specification (Section 12). Replaces the current configuration.',
  saveCfg: 'Download the whole configuration (geometry, materials, process, loads, limits) as a JSON file. Nothing is stored in the browser.',
  loadCfg: 'Load a configuration JSON file saved by this tool.',
  cfgName: 'A name for this configuration; used in file names and the report.',
  genStack: 'Generate a symmetric N-2-N build-up stack from these parameters, then edit the rows below.',
  genN: 'Build-up layers per side (N in N-2-N).',
  genDiel: 'Dielectric (ABF) thickness per layer, µm.',
  genCu: 'Cu thickness of every build-up pattern layer, µm.',
  genCore: 'Core laminate thickness, µm. 0 generates a coreless stack.',
  genSR: 'Solder resist thickness on both sides, µm.',
  genPTH: 'Plated through hole Cu area fraction of the core, %.',
  genRPlane: 'Residual Cu ratio applied to plane layers.',
  genRSignal: 'Residual Cu ratio applied to signal layers.',
  totalT: 'Sum of all row thicknesses. Updates live.',
  rowType: 'Solder resist, Cu pattern layer, dielectric, or the core laminate. Changing the type resets the row\'s material to a matching default.',
  rowMat: 'Material of this row (for a Cu layer: the dielectric filling the etched areas).',
  rowT: 'Row thickness in µm.',
  rowFrac: 'Cu layers: residual Cu ratio after etching. Dielectrics: via Cu area fraction. Core: PTH Cu area fraction.',
  rowKind: 'Plane layers use the Voigt (parallel) mixture in-plane; signal layers the mean of Voigt and Reuss.',
  rowAdd: 'Insert a dielectric row below this one.',
  rowDel: 'Delete this row.',
  depop: 'Leave a rectangular region of the BGA field without balls (the measuring zone is unchanged).',
  depopSx: 'Width of the depopulated region, centred on the package.',
  depopSy: 'Height of the depopulated region, centred on the package.',
  pkgBare: 'Die on substrate with underfill only.',
  pkgLid: 'Single-piece hat lid: plate over the die with TIM1, continuous foot ring bonded with adhesive.',
  pkgStiff: 'Stiffener ring bonded to the substrate around the die; no plate over the die.',
  // ---- step 2 ----
  dieList: 'Click a die to select it; the floorplan highlights it. R rotates, Delete removes the selected die.',
  rotate: 'Rotate the die by 90° (swaps x and y size and the bump pitches).',
  duplicate: 'Copy this die next to itself.',
  deleteDie: 'Remove this die (at least one die must remain).',
  addDie: 'Add a new 10 × 10 mm die; then edit its size and position.',
  snapEdges: 'Snap the dragged die to the edges of other dies.',
  snapCenter: 'Snap the dragged die to the substrate centrelines.',
  splitLeft: 'Drag to resize the step list (narrow widths show step numbers only); arrow keys also work. Double-click to restore the default width.',
  splitRight: 'Drag to resize the context panel; text fields, dropdowns, tables and plots follow the width. Arrow keys also work; double-click to restore the default width.',
  splitXs: 'Drag to share the height between the floorplan (above) and the cross-section (below). Double-click to restore the default split.',
  split3d: 'Drag to change the height of the 3D view. Double-click to restore the default height.',
  plotResize: 'Drag the bottom edge to change the height; double-click the edge to restore it.',
  dieName: 'Label used in every result view and the report.',
  dieX: 'Die centre x in package coordinates (origin at the substrate centre). Synchronised with dragging.',
  dieY: 'Die centre y in package coordinates. Synchronised with dragging.',
  rot: 'Rotation of the die about z (0 or 90°).',
  arrayType: 'Full-area bump array, or peripheral rows only (N rows from the edge of the field).',
  rows: 'Number of bump rows along the perimeter for a peripheral array.',
  solder: 'Solder alloy of the bumps (package-global). Bundled data are SAC305; other alloys carry placeholders flagged Estimated.',
  deff: 'Diameter of the cylinder with the same height and volume as the truncated-sphere joint; used for the homogenized layer and the per-bump area.',
  nbumps: 'Bump count from the die size, keep-out and pitch.',
  fb: 'Solder area fraction of the homogenized bump layer: π d_eff² / (4 p_x p_y).',
  // ---- step 3 ----
  ufMat: 'Capillary underfill filling the bump layer and forming the fillet.',
  lidMat: 'Lid plate and foot material (Cu default; AlSiC and stainless alternatives).',
  adhMat: 'Adhesive under the lid foot or stiffener ring.',
  timMat: 'Thermal interface material between the die backside and the lid; its stiffness sets how strongly the lid loads the die.',
  stiffMat: 'Stiffener ring material.',
  stiffOuter: 'Stiffener outer outline; the ring sits inside it.',
  footH: 'Derived: standoff + max die thickness + TIM BLT − adhesive thickness.',
  bltDie: 'Derived TIM bond line over this die (thicker for thinner dies).',
  // ---- step 4 ----
  matSelect: 'Pick a material to inspect or edit. ● marks materials used by the current configuration.',
  matDup: 'Create an editable copy of this material (for variants or what-if studies).',
  matReset: 'Restore every property of this material to the database default.',
  corePreset: 'Switch the core laminate of the whole stack to this preset.',
  abfPreset: 'Switch every build-up dielectric (and the Cu-layer fill) to this ABF grade.',
  matValue: 'Edit the value. The confidence badge becomes User and the material is marked modified.',
  matConf: 'Datasheet: manufacturer typical value. Literature: peer-reviewed or conference source. Handbook: generic engineering value. Estimated: placeholder without a source. User: edited here.',
  matRange: 'Datasheet range where the source gives one; used by the sensitivity analysis.',
  matResetOne: 'Reset this property to its database default.',
  matTableEdit: 'Edit the temperature table (one temperature, value pair per line).',
  plotE: 'Modulus versus temperature exactly as the solver uses it; dashed lines mark the Tg values.',
  plotCTE: 'Instantaneous CTE versus temperature as used for the thermal strain integral F(T).',
  // ---- step 5 ----
  TsubBtn: 'Set the substrate stress-free temperature to the solder solidus (217 °C).',
  TsubBtn2: 'Set the substrate stress-free temperature to the ABF cure temperature (200 °C).',
  Tmin: 'Cold extreme of the temperature cycle.',
  Tmax: 'Hot extreme of the temperature cycle.',
  jeitaHot: 'JEITA ED-7306 Table 1 maximum permissible warpage at elevated temperature for this pitch. Editable; customer limits often differ.',
  jeitaRT: 'Room-temperature coplanarity reference value from JEITA ED-7306. Editable.',
  dieStrength: 'Optional. When set, the die stress cards show the margin to this value.',
  bumpAxialN: 'Optional per-bump axial force threshold used to flag the bump loading maps.',
  bumpShearN: 'Optional per-bump shear force threshold used to flag the bump loading maps.',
  CW: 'Syed energy-based life: N_f = 1 / (C_W ΔW). Default 0.00165 1/MPa (Syed 2004 via Amalu et al. 2015); other sources quote 0.0019. Fitted to a different constitutive model and joint geometry.',
  Cstrain: 'Syed strain-based life: N_f = 1 / (C ε_acc) with the accumulated equivalent inelastic strain per cycle.',
  K1: 'Darveaux crack initiation: N_0 = K1 ΔW^K2. No default: K1 depends on element size and averaging scheme.',
  K2: 'Darveaux crack initiation exponent.',
  K3: 'Darveaux crack growth: da/dN = K3 ΔW^K4. No default: K3 depends on element size and averaging scheme.',
  K4: 'Darveaux crack growth exponent.',
  // ---- step 6 ----
  workers: 'The temperature sweep and the bump submodels are split over this many Web Workers. Each holds its own copy of the model, so memory scales with the count; 1 keeps everything in one worker.',
  runFull: 'Process stages, as-assembled state at 25 °C, chip-join state, reflow sweep, cycling samples, bump screening and 3D fields, at the selected fidelity.',
  quickPreview: 'Draft mesh, stages and the 25 °C state only; fast look at the warpage overlay. Edits never start an analysis on their own.',
  pinBaseline: 'Keep the current results as the baseline; later runs show deltas and ratios against it.',
  clearBaseline: 'Remove the pinned baseline.',
  meshCheck: 'Rerun the current case at the next finer preset and compare RT warpage, die interior peak stress and worst-bump force.',
  exportCsv: 'Download all scalar results plus the warpage at every ball site and the per-bump loads as CSV.',
  report: 'Open a printable report (inputs, assumptions, results, confidence labels, verification, materials with sources); print it to PDF from the browser.',
  coreStudy: 'Run the 0.4 mm and 0.8 mm core variants of the study preset back to back and compare them.',
  estCard: 'Placeholder (Estimated) properties the current configuration depends on. Replace them with measured data before trusting absolute numbers.',
  estEdit: 'Open this material in the Materials step.',
  solverLog: 'Iterations, residual and preconditioner of every linear solve of the last run.',
  // ---- results views ----
  viewWarpage: 'Substrate-bottom warpage per JEITA ED-7306 / JESD22-B112: contour, ball-site values, diagonals, sweep versus temperature.',
  viewDieStress: 'Maximum principal stress maps on the die backside and active face; interior peaks and comparative corner patches.',
  viewBumps: 'Per-bump axial and shear forces from the solder-phase stress, at chip join (before underfill) and as assembled.',
  viewUf: 'Peel and shear tractions along each die perimeter at the sidewall-to-fillet and active-face interfaces.',
  viewFatigue: 'Screening index over all bumps, and detailed bump submodels with hysteresis loops and life estimates.',
  view3d: 'Exaggerated deformed shape coloured by displacement or stress, with part visibility toggles.',
  viewSens: 'Tornado charts: each input moved to the low and high end of its range, effect on four outputs.',
  viewVerify: 'The verification suite (V1 to V15) with measured values and pass / fail.',
  viewReport: 'Printable report and CSV export.',
  tempSelect: 'Evaluation temperature of the displayed state. States between computed samples are interpolated linearly in temperature.',
  overlay: 'Field drawn on the floorplan: warpage of the substrate bottom or top, die stress, bump forces at chip join or as assembled, or the fatigue screening index.',
  cutAxis: 'Direction of the cross-section line A-A\' drawn under the floorplan.',
  cutPos: 'Position of the cut line, mm.',
  exagg: 'Vertical exaggeration of the cross-section drawing (the package is much wider than it is tall).',
  fit: 'Zoom the floorplan to the substrate (double-click does the same; wheel zooms, dragging the background pans).',
  // warpage quantities
  warpSigned: 'JEITA sign × magnitude. Positive is convex: the package centre is farther from the board than the corners.',
  warpShape: 'Shape class from the diagonal profiles (dome, bowl, saddle, ring) and |AB_max + AB_min + CD_max + CD_min| / |C| as a sign confidence; below 25 % the sign is marginal.',
  warpMag: 'Peak-to-valley of the substrate-bottom surface over the ball field after removing the least-squares plane.',
  warpLimitHot: 'JEITA ED-7306 maximum permissible warpage at elevated temperature for the selected pitch (editable in step 5).',
  warpLimitRT: 'JEITA ED-7306 room-temperature coplanarity reference for the selected pitch.',
  warpDiag: 'Largest positive and negative displacement along the diagonal relative to the straight line joining its end points (toward the package top positive); these set the sign.',
  warpTop: 'Peak-to-valley of the substrate top surface (for completeness; the JEITA value uses the bottom).',
  relCurv: 'Difference between the fitted curvature of the die backside and of the substrate top under the die; a measure of the bending transmitted through the bump layer.',
  diagPlot: 'Displacement along the two measuring-zone diagonals relative to their corner-to-corner lines; corners are at the ends.',
  sweepPlot: 'Signed warpage while heating to the peak; the cooling half mirrors the same states (the formulation is reversible). The grey dashed line is the magnitude; orange ticks mark marginal-sign states; the band is the JEITA limit.',
  tempPlot: 'Signed warpage at every evaluated state, with the baseline when one is pinned.',
  // die stress
  faceTop: 'Die backside (top surface): where the bending-induced tensile stress is largest at room temperature.',
  faceBottom: 'Active face (bottom surface, bump side).',
  peakNodal: 'Largest maximum principal stress over the face excluding a 0.5 mm edge band, from Gauss-point stresses extrapolated to the nodes and averaged within the die. Moderate confidence.',
  peakGauss: 'The same peak evaluated directly at the Gauss points (no extrapolation); the two differ for steep gradients.',
  peakAll: 'Gauss-point peak over the whole face including the singular edge region; for information only.',
  cornerPatch: 'Maximum principal stress averaged over a fixed 100 µm × 100 µm patch at the corner or mid-edge. Singular location: compare designs, do not read as a strength.',
  margin: 'Die strength (step 5) minus the interior peak.',
  // bumps
  stateCpi: 'End of chip-join cooldown at 25 °C, before underfill: the bumps alone carry the mismatch. Elastic upper bound (real joints relax by creep).',
  stateAsm: 'As-assembled state at the selected temperature.',
  compV: 'Shear force per bump: sqrt(τxz² + τyz²) × A_bump.',
  compN: 'Axial force per bump: σzz × A_bump (tension positive).',
  worstV: 'Largest shear force over all bumps of this die.',
  worstN: 'Largest-magnitude axial force over all bumps of this die.',
  abump: 'π d_eff² / 4, the area used to convert the solder-phase stress to a force.',
  worstTable: 'The ten most loaded bumps by combined axial and shear force.',
  // underfill
  ufSide: 'Traction on the die sidewall-to-fillet interface, from underfill-side stresses averaged over 50 µm × 50 µm patches stepped along the perimeter.',
  ufFace: 'Traction on the die active-face-to-underfill interface just inside the die edge.',
  peel: 'Normal traction, tension positive (tends to open the interface).',
  shearT: 'In-plane traction magnitude (tends to slide the interface).',
  // fatigue
  dWproxy: 'Inelastic work density of the stabilized cycle from the Anand model integrated at the bump site under the homogenized-layer strain history. Ranks locations; not a life.',
  dEproxy: 'Equivalent inelastic strain range of the stabilized cycle at the site.',
  stab: 'Relative change of ΔW between the last two cycles; large values mean the cycle has not stabilized.',
  selectSite: 'Include this bump in the submodel run.',
  subRes: 'Submodel voxel grid (in-plane × through-thickness). Finer grids resolve the joint better and take longer.',
  runSub: 'Build and run one-pitch Anand submodels for the selected sites, split over the parallel workers.',
  subDW: 'Inelastic work density of the last cycle, volume-averaged over a 25 µm layer at the die-side and substrate-side interfaces; the larger one is used.',
  subDE: 'Equivalent inelastic strain range averaged the same way.',
  subStab: 'Relative change of ΔW between the last two cycles; above 5 % run more cycles.',
  lifeSyedE: 'N_f = 1 / (C_W ΔW). Order-of-magnitude; best used as a ratio against the baseline.',
  lifeSyedS: 'N_f = 1 / (C ε_acc) with the accumulated inelastic strain per cycle.',
  lifeDarv: 'N_f = N_0 + a / (da/dN) with a the joint diameter at the critical interface; needs K1 to K4 calibrated to this averaging scheme (step 5).',
  lifeRatio: 'Life divided by the baseline\'s life for the first submodel; the most trustworthy fatigue output.',
  subSteps: 'Time steps, cutbacks on the inelastic strain increment limit, and Newton iterations per step.',
  hysteresis: 'Shear stress versus shear strain (radial direction) volume-averaged in the interface layers through the cycles.',
  // 3D
  exag3d: 'Multiplies the displacements before drawing.',
  color3d: 'Colour the surface by out-of-plane displacement, by the nodal max principal stress of each part, or by part.',
  partToggle: 'Show or hide this part.',
  // sensitivity
  sensInput: 'Input moved to the low and high end of its range in the tornado run. "est." marks Estimated database values.',
  sensRun: 'Runs 2 × (inputs) + 1 Draft analyses on the worker pool; results are cached by configuration hash.',
  tornado: 'Blue: input at its low end; orange: at its high end. Bar length is the change of the output from the base value.',
  // verification
  verifyFast: 'Run the quick tests (unit checks, element tests, plate and laminate benchmarks, Anand, JEITA, round trip).',
  verifyAll: 'Also run the slow tests (submodel consistency, symmetry, physical sanity, mesh convergence Standard vs Fine, solver integrity, timing benchmark).',
  // materials badges in tables
  badgeEst: 'Estimated: no published source; placeholder to replace with measured data.',
};

/** Help icon bound to a tooltip key (or free text). */
function helpTip(keyOrText) {
  const text = TIPS[keyOrText] || HELP[keyOrText] || keyOrText;
  if (!text) return null;
  return h('span', { class: 'help', 'data-tip': text, tabindex: '0', 'aria-label': text }, '?');
}
/** Attribute bag that attaches a tooltip to any element: h('button', tip('runFull', {onclick}), ...). */
function tip(key, attrs) {
  const text = TIPS[key] || HELP[key] || key;
  return Object.assign({ 'data-tip': text }, attrs || {});
}
/** kv-grid label with a help icon. */
function kl(text, key) { return h('span', { class: 'k' }, text, key ? helpTip(key) : null); }

// ---- the tooltip element ----
(function setupTooltips() {
  let box = null, current = null, timer = null;
  const ensure = () => { if (!box) { box = h('div', { id: 'tooltip', role: 'tooltip' }); document.body.appendChild(box); } return box; };
  const show = el => {
    const text = el.getAttribute('data-tip'); if (!text) return;
    const b = ensure(); b.textContent = text; b.style.display = 'block';
    const r = el.getBoundingClientRect(), bw = b.offsetWidth, bh = b.offsetHeight;
    let x = Math.min(Math.max(8, r.left + r.width / 2 - bw / 2), window.innerWidth - bw - 8);
    let y = r.bottom + 8;
    if (y + bh > window.innerHeight - 8) y = r.top - bh - 8;
    b.style.left = x + 'px'; b.style.top = Math.max(4, y) + 'px';
    current = el;
  };
  const hide = () => { if (box) box.style.display = 'none'; current = null; if (timer) { clearTimeout(timer); timer = null; } };
  const target = e => e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
  document.addEventListener('mouseover', e => { const el = target(e); if (!el || el === current) return; if (timer) clearTimeout(timer); timer = setTimeout(() => show(el), 180); });
  document.addEventListener('mouseout', e => { const el = target(e); if (el && (!e.relatedTarget || !el.contains(e.relatedTarget))) hide(); });
  document.addEventListener('focusin', e => { const el = target(e); if (el) show(el); });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);
  document.addEventListener('pointerdown', e => { if (!target(e)) hide(); });
})();
