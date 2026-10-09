// ===== UI: input panels for steps 1 to 5 =====================================

const STEPS = [
  { n: 1, label: 'Package', render: renderPackagePanel },
  { n: 2, label: 'Dies and floorplan', render: renderDiesPanel },
  { n: 3, label: 'Underfill, lid, stiffener', render: renderConstructPanel },
  { n: 4, label: 'Materials', render: renderMaterialsPanel },
  { n: 5, label: 'Process and loads', render: renderProcessPanel },
  { n: 6, label: 'Run and results', render: renderRunPanel },
];

function materialOptions(category) {
  return app.cfg.materials.filter(m => !category || (Array.isArray(category) ? category.includes(m.category) : m.category === category)).map(m => ({ value: m.id, label: m.name + (m.modified ? ' (modified)' : '') }));
}

// ---- step 1: package ----
function renderPackagePanel(root) {
  const cfg = app.cfg;
  root.append(h('h2', null, '1. Package'));
  root.append(h('div', { class: 'row' }, h('label', null, 'Preset package '), h('select', tip('presetPkg', { onchange: e => { if (e.target.value) loadPreset(e.target.value); e.target.value = ''; } }), h('option', { value: '' }, 'Load a preset...'), ...C.PRESET_LIST.map(p => h('option', { value: p.id }, p.label)))));
  root.append(h('div', { class: 'row' }, h('button', tip('saveCfg', { onclick: saveConfigFile }), 'Save configuration (JSON)'), h('button', tip('loadCfg', { onclick: loadConfigFile }), 'Load configuration'), h('input', tip('cfgName', { type: 'text', value: cfg.name, placeholder: 'configuration name', style: 'flex:1', onchange: e => { cfg.name = e.target.value; } }))));
  root.append(h('h3', null, 'Substrate outline'));
  root.append(numField('Size x', () => cfg.substrate.sx, v => { cfg.substrate.sx = v; }, { unit: 'mm', min: 1, max: 150, plo: 5, phi: 110, help: 'sx' }));
  root.append(numField('Size y', () => cfg.substrate.sy, v => { cfg.substrate.sy = v; }, { unit: 'mm', min: 1, max: 150, plo: 5, phi: 110, help: 'sy' }));
  root.append(h('h3', null, 'Layer stack (top to bottom)'));
  const gen = { n: 6, dielT: 25, cuT: 15, coreT: 800, srT: 20, pth: 2, rPlane: 0.75, rSignal: 0.45 };
  const genRow = h('div', { class: 'card' }, h('h4', null, 'Generate N-2-N stack'),
    h('div', { class: 'row small' }, 'N ', h('input', tip('genN', { type: 'number', value: 6, style: 'width:50px', onchange: e => { gen.n = +e.target.value; } })), ' dielectric µm ', h('input', tip('genDiel', { type: 'number', value: 25, style: 'width:60px', onchange: e => { gen.dielT = +e.target.value; } })), ' Cu µm ', h('input', tip('genCu', { type: 'number', value: 15, style: 'width:55px', onchange: e => { gen.cuT = +e.target.value; } }))),
    h('div', { class: 'row small' }, 'core µm ', h('input', tip('genCore', { type: 'number', value: 800, style: 'width:60px', onchange: e => { gen.coreT = +e.target.value; } })), ' SR µm ', h('input', tip('genSR', { type: 'number', value: 20, style: 'width:55px', onchange: e => { gen.srT = +e.target.value; } })), ' PTH % ', h('input', tip('genPTH', { type: 'number', value: 2, style: 'width:50px', onchange: e => { gen.pth = +e.target.value; } })), ' plane r ', h('input', tip('genRPlane', { type: 'number', value: 0.75, step: 0.05, style: 'width:60px', onchange: e => { gen.rPlane = +e.target.value; } })), ' signal r ', h('input', tip('genRSignal', { type: 'number', value: 0.45, step: 0.05, style: 'width:60px', onchange: e => { gen.rSignal = +e.target.value; } }))),
    h('div', { class: 'row' }, h('button', tip('genStack', { onclick: () => { cfg.substrate.layers = C.generateStack({ n: gen.n, dielT: gen.dielT / 1000, cuT: gen.cuT / 1000, coreT: gen.coreT / 1000, srT: gen.srT / 1000, pth: gen.pth / 100, rPlane: gen.rPlane, rSignal: gen.rSignal, diel: cfg.substrate.layers.find(r => r.type === 'diel')?.mat || 'abf_gl', core: cfg.substrate.layers.find(r => r.type === 'core')?.mat || 'mcl_e_795g', sr: cfg.substrate.layers.find(r => r.type === 'sr')?.mat || 'psr4000' }); onConfigChanged('geometry', { released: true }); renderContext(); } }), 'Generate stack'), h('span', { class: 'muted small' }, 'then edit rows below')));
  root.append(genRow);
  const total = cfg.substrate.layers.reduce((s, r) => s + r.t, 0);
  root.append(h('div', { class: 'row' }, h('b', null, 'Total substrate thickness: ' + fmt(total * 1000, 0) + ' µm'), helpTip('totalT')));
  const tbl = h('table', { class: 'stack-table' }, h('tr', null, h('th', null, 'Row'), h('th', null, 'Type', helpTip('rowType')), h('th', null, 'Material', helpTip('rowMat')), h('th', null, 'Thickness µm', helpTip('rowT')), h('th', null, 'Cu ratio / via / PTH', helpTip('rowFrac')), h('th', null, 'Kind', helpTip('rowKind')), h('th')));
  cfg.substrate.layers.forEach((r, i) => {
    const typeSel = h('select', { onchange: e => { changeRowType(r, e.target.value); onConfigChanged('geometry', { released: true }); renderContext(); } }, ...['sr', 'cu', 'diel', 'core'].map(t => h('option', { value: t, selected: r.type === t ? '' : null }, { sr: 'solder resist', cu: 'Cu pattern', diel: 'dielectric', core: 'core' }[t])));
    const matCat = r.type === 'sr' ? 'resist' : (r.type === 'core' ? 'core' : 'buildup');
    const matKey = r.type === 'cu' ? 'fill' : 'mat';
    const matSel = h('select', { onchange: e => { r[matKey] = e.target.value; onConfigChanged('materials'); } }, ...materialOptions(matCat).map(o => h('option', { value: o.value, selected: r[matKey] === o.value ? '' : null }, o.label)));
    const tIn = h('input', { type: 'number', step: 1, value: fmtInput(r.t * 1000), onchange: e => { r.t = +e.target.value / 1000; onConfigChanged('geometry', { released: true }); } });
    let frac = h('span');
    if (r.type === 'cu') frac = h('input', { type: 'number', step: 0.05, min: 0, max: 1, value: r.r, 'data-tip': HELP.residual, onchange: e => { r.r = Math.min(1, Math.max(0, +e.target.value)); onConfigChanged('materials'); } });
    if (r.type === 'diel') frac = h('input', { type: 'number', step: 0.01, min: 0, max: 1, value: r.via || 0, 'data-tip': HELP.via, onchange: e => { r.via = Math.min(1, Math.max(0, +e.target.value)); onConfigChanged('materials'); } });
    if (r.type === 'core') frac = h('input', { type: 'number', step: 0.01, min: 0, max: 1, value: r.pth || 0, 'data-tip': HELP.pth, onchange: e => { r.pth = Math.min(1, Math.max(0, +e.target.value)); onConfigChanged('materials'); } });
    const kind = r.type === 'cu' ? h('select', { 'data-tip': HELP.kind, onchange: e => { r.kind = e.target.value; onConfigChanged('materials'); } }, h('option', { value: 'plane', selected: r.kind === 'plane' ? '' : null }, 'plane'), h('option', { value: 'signal', selected: r.kind === 'signal' ? '' : null }, 'signal')) : h('span');
    const btns = h('span', null, h('button', { class: 'small', 'data-tip': TIPS.rowAdd, onclick: () => { cfg.substrate.layers.splice(i + 1, 0, { type: 'diel', t: 0.025, mat: 'abf_gl', via: 0 }); onConfigChanged('geometry', { released: true }); renderContext(); } }, '+'), h('button', { class: 'small', 'data-tip': TIPS.rowDel, onclick: () => { cfg.substrate.layers.splice(i, 1); onConfigChanged('geometry', { released: true }); renderContext(); } }, '−'));
    tbl.append(h('tr', null, h('td', null, r.type === 'cu' ? (r.name || 'L' + (i + 1)) : String(i + 1)), h('td', null, typeSel), h('td', null, matSel), h('td', null, tIn), h('td', null, frac), h('td', null, kind), h('td', null, btns)));
  });
  root.append(tbl);
  root.append(h('h3', null, 'BGA field'));
  root.append(selectField('Ball pitch', () => cfg.bga.pitch, v => { cfg.bga.pitch = +v; const j = C.JEITA_TABLE.find(r => Math.abs(r.pitch - +v) < 1e-6); if (j) cfg.bga.ballH = j.ballH; renderContext(); }, [0.4, 0.5, 0.65, 0.8, 1.0, 1.27].map(p => ({ value: String(p), label: p + ' mm' })), { help: 'pitch', unit: 'mm' }));
  root.append(numField('Ball height', () => cfg.bga.ballH, v => { cfg.bga.ballH = v; }, { unit: 'mm', min: 0.05, max: 1.5, help: 'ballH' }));
  root.append(numField('Field inset from edge', () => cfg.bga.inset, v => { cfg.bga.inset = v; }, { unit: 'mm', min: 0, max: 20, plo: 0.5, phi: 5, help: 'inset' }));
  root.append(checkField('Depopulated central region', () => cfg.bga.depop.on, v => { cfg.bga.depop.on = v; renderContext(); }, { help: 'depop' }));
  if (cfg.bga.depop.on) { root.append(numField('Depop size x', () => cfg.bga.depop.sx, v => { cfg.bga.depop.sx = v; }, { unit: 'mm', min: 0, help: 'depopSx' })); root.append(numField('Depop size y', () => cfg.bga.depop.sy, v => { cfg.bga.depop.sy = v; }, { unit: 'mm', min: 0, help: 'depopSy' })); }
  root.append(h('h3', null, 'Configuration'));
  const radios = h('div', { class: 'row' }, ...[['bare', 'Bare die', 'pkgBare'], ['lid', 'Lid (hat lid with foot ring)', 'pkgLid'], ['stiffener', 'Stiffener ring', 'pkgStiff']].map(([v, l, k]) => h('label', tip(k), h('input', { type: 'radio', name: 'pkgtype', value: v, checked: cfg.packageType === v ? '' : null, onchange: () => { cfg.packageType = v; onConfigChanged('geometry', { released: true }); renderContext(); } }), ' ' + l)));
  root.append(radios);
  renderValidation(root);
}
function changeRowType(r, t) {
  r.type = t;
  if (t === 'sr') { r.mat = r.mat && app.cfg.materials.find(m => m.id === r.mat && m.category === 'resist') ? r.mat : 'psr4000'; delete r.r; delete r.fill; }
  if (t === 'cu') { r.fill = r.fill || 'abf_gl'; r.r = r.r || 0.5; r.kind = r.kind || 'signal'; delete r.mat; }
  if (t === 'diel') { r.mat = r.mat && app.cfg.materials.find(m => m.id === r.mat && m.category === 'buildup') ? r.mat : 'abf_gl'; r.via = r.via || 0; }
  if (t === 'core') { r.mat = r.mat && app.cfg.materials.find(m => m.id === r.mat && m.category === 'core') ? r.mat : 'mcl_e_795g'; r.pth = r.pth || 0.02; }
}

function renderValidation(root) {
  const v = app.validation;
  const box = h('div', { id: 'validation-box' });
  for (const e of v.errors) box.append(h('div', { class: 'msg error' }, '⛔ ' + e.text));
  for (const w of v.warnings) box.append(h('div', { class: 'msg warning' }, '⚠ ' + w.text));
  if (app.meshWarnings) for (const w of app.meshWarnings) box.append(h('div', { class: 'msg ' + (w.level === 'info' ? 'info' : 'warning') }, (w.level === 'info' ? 'ℹ ' : '⚠ ') + w.text));
  if (!v.errors.length && !v.warnings.length) box.append(h('div', { class: 'msg info' }, '✓ Configuration is valid.'));
  root.append(h('h3', null, 'Checks'), box);
}

// ---- step 2: dies ----
function renderDiesPanel(root) {
  const cfg = app.cfg;
  root.append(h('h2', null, '2. Dies and floorplan'));
  root.append(h('div', { class: 'muted small' }, 'Drag dies on the floorplan, press R to rotate, Delete to remove. Double-click the floorplan to fit. Scroll to zoom, drag the background to pan.'));
  const list = h('div', tip('dieList', { class: 'die-list' }));
  cfg.dies.forEach((d, i) => list.append(h('div', { class: 'die-row' + (i === app.selectedDie ? ' sel' : '') }, h('span', { style: 'flex:1;cursor:pointer', onclick: () => { app.selectedDie = i; renderContext(); floorplan.draw(); } }, d.name + ' ' + d.sx + '×' + d.sy + '×' + d.t + ' mm at (' + d.x + ', ' + d.y + ')' + (d.rot ? ' rot 90°' : '')), h('button', tip('rotate', { class: 'small', onclick: () => rotateDie(i) }), 'Rotate'), h('button', tip('duplicate', { class: 'small', onclick: () => duplicateDie(i) }), 'Duplicate'), h('button', tip('deleteDie', { class: 'small', onclick: () => deleteDie(i) }), 'Delete'))));
  root.append(list, h('div', { class: 'row' }, h('button', tip('addDie', { onclick: addDie }), '+ Add die')));
  root.append(h('h3', null, 'Floorplan snapping'));
  root.append(h('div', { class: 'field' }, h('label', null, 'Grid snap', help('snap')), h('select', { onchange: e => { floorplan.snap = +e.target.value; } }, ...[0.01, 0.05, 0.1, 0.25, 0.5, 1].map(s => h('option', { value: s, selected: floorplan.snap === s ? '' : null }, s + ' mm'))), h('span')));
  root.append(h('div', { class: 'row small' }, h('label', tip('snapEdges'), h('input', { type: 'checkbox', checked: floorplan.snapEdges ? '' : null, onchange: e => { floorplan.snapEdges = e.target.checked; } }), ' snap to other dies\' edges'), h('label', tip('snapCenter'), h('input', { type: 'checkbox', checked: floorplan.snapCenter ? '' : null, onchange: e => { floorplan.snapCenter = e.target.checked; } }), ' snap to substrate centerlines'), h('label', tip('autoSolve'), h('input', { type: 'checkbox', checked: app.autoSolve ? '' : null, onchange: e => { app.autoSolve = e.target.checked; } }), ' auto-solve on release')));
  const d = cfg.dies[app.selectedDie];
  if (!d) return;
  root.append(h('h3', null, 'Selected die: ' + d.name));
  root.append(h('div', { class: 'field' }, h('label', null, 'Name', helpTip('dieName')), h('input', { type: 'text', value: d.name, onchange: e => { d.name = e.target.value; onConfigChanged('geometry'); } }), h('span')));
  root.append(numField('Center x', () => d.x, v => { d.x = v; }, { unit: 'mm', min: -100, max: 100, help: 'dieX' }));
  root.append(numField('Center y', () => d.y, v => { d.y = v; }, { unit: 'mm', min: -100, max: 100, help: 'dieY' }));
  root.append(numField('Size x', () => d.sx, v => { d.sx = v; }, { unit: 'mm', min: 0.5, max: 60, plo: 2, phi: 35, help: 'dieSize' }));
  root.append(numField('Size y', () => d.sy, v => { d.sy = v; }, { unit: 'mm', min: 0.5, max: 60, plo: 2, phi: 35, help: 'dieSize' }));
  root.append(numField('Thickness', () => d.t, v => { d.t = v; }, { unit: 'mm', min: 0.05, max: 1.5, plo: 0.1, phi: 0.8, help: 'dieT' }));
  root.append(selectField('Rotation', () => d.rot, v => { d.rot = +v; }, [{ value: '0', label: '0°' }, { value: '90', label: '90°' }], { help: 'rot' }));
  root.append(selectField('Si elastic model', () => d.si, v => { d.si = v; }, [{ value: 'aniso', label: 'anisotropic cubic (100), edges <110>' }, { value: 'iso', label: 'isotropic 130 GPa, ν 0.28' }], { help: 'siModel', section: 'materials' }));
  root.append(h('h4', null, 'Bump field'));
  root.append(selectField('Array type', () => d.bump.type, v => { d.bump.type = v; renderContext(); }, [{ value: 'full', label: 'full area' }, { value: 'peripheral', label: 'peripheral rows' }], { help: 'arrayType' }));
  if (d.bump.type === 'peripheral') root.append(numField('Peripheral rows', () => d.bump.rows, v => { d.bump.rows = Math.round(v); }, { min: 1, max: 50, step: 1, help: 'rows' }));
  root.append(numField('Pitch x', () => d.bump.px, v => { d.bump.px = v; }, { unit: 'µm', scale: 1000, min: 0.02, max: 2, plo: 0.08, phi: 0.5, help: 'bumpPitch' }));
  root.append(numField('Pitch y', () => d.bump.py, v => { d.bump.py = v; }, { unit: 'µm', scale: 1000, min: 0.02, max: 2, plo: 0.08, phi: 0.5, help: 'bumpPitch' }));
  root.append(numField('Edge keep-out', () => d.bump.keepout, v => { d.bump.keepout = v; }, { unit: 'µm', scale: 1000, min: 0, max: 5, help: 'keepout' }));
  root.append(numField('UBM diameter', () => d.bump.ubm, v => { d.bump.ubm = v; }, { unit: 'µm', scale: 1000, min: 0.005, max: 1, help: 'ubm' }));
  root.append(numField('SRO diameter', () => d.bump.sro, v => { d.bump.sro = v; }, { unit: 'µm', scale: 1000, min: 0.005, max: 1, help: 'sro' }));
  root.append(numField('Maximum bump diameter', () => d.bump.dmax, v => { d.bump.dmax = v; }, { unit: 'µm', scale: 1000, min: 0.005, max: 1.5, help: 'dmax' }));
  root.append(h('h4', null, 'Package-global bump technology'));
  root.append(numField('Standoff height', () => cfg.bump.standoff, v => { cfg.bump.standoff = v; }, { unit: 'µm', scale: 1000, min: 0.02, max: 0.2, help: 'standoff' }));
  root.append(selectField('Solder alloy', () => cfg.bump.solder, v => { cfg.bump.solder = v; if (v !== 'sac305') toast('Bundled data are SAC305 only; the selected alloy carries placeholder values flagged Estimated. Enter measured properties in the Materials step.', 'warn', 9000); }, materialOptions('solder'), { section: 'materials', help: 'solder' }));
  const gd = app.geom && app.geom.dies[app.selectedDie];
  if (gd) root.append(h('div', { class: 'kv' }, kl('d_eff (equal-volume cylinder)', 'deff'), h('span', null, fmt(gd.deff * 1000, 1) + ' µm'), kl('bumps', 'nbumps'), h('span', null, gd.nbx + ' × ' + gd.nby + (gd.peripheral ? ' peripheral' : '') + ' = ' + C.dieBumpSites(gd).x.length), kl('solder area fraction f_b', 'fb'), h('span', null, fmt(gd.density, 3)), h('span', { class: 'k' }, 'joint volume'), h('span', null, fmtE(gd.profile.volume, 3) + ' mm³')));
  renderValidation(root);
}

// ---- step 3: underfill, lid, stiffener ----
function renderConstructPanel(root) {
  const cfg = app.cfg;
  root.append(h('h2', null, '3. Underfill, lid, stiffener'));
  root.append(h('h3', null, 'Capillary underfill'));
  root.append(selectField('Material', () => cfg.underfill.mat, v => { cfg.underfill.mat = v; }, materialOptions('underfill'), { section: 'materials', help: 'ufMat' }));
  root.append(numField('Fillet width W_f', () => cfg.underfill.Wf, v => { cfg.underfill.Wf = v; }, { unit: 'mm', min: 0.05, max: 5, plo: 0.3, phi: 2, help: 'Wf' }));
  root.append(numField('Fillet height H_f (fraction of die thickness)', () => cfg.underfill.Hf, v => { cfg.underfill.Hf = v; }, { min: 0.05, max: 1, help: 'Hf' }));
  root.append(numField('Effective stress-free temperature', () => cfg.process.Tuf, v => { cfg.process.Tuf = v; }, { unit: '°C', min: 0, max: 300, help: 'Tuf', section: 'process' }));
  if (cfg.packageType === 'lid') {
    const L = cfg.lid;
    root.append(h('h3', null, 'Hat lid'));
    root.append(selectField('Lid material', () => L.mat, v => { L.mat = v; }, materialOptions('metal'), { section: 'materials', help: 'lidMat' }));
    root.append(numField('Outer size x', () => L.ox, v => { L.ox = v; }, { unit: 'mm', min: 1, max: 150, help: 'lidOuter' }));
    root.append(numField('Outer size y', () => L.oy, v => { L.oy = v; }, { unit: 'mm', min: 1, max: 150, help: 'lidOuter' }));
    root.append(numField('Plate thickness', () => L.tPlate, v => { L.tPlate = v; }, { unit: 'mm', min: 0.1, max: 5, help: 'tPlate' }));
    root.append(numField('Foot width', () => L.footW, v => { L.footW = v; }, { unit: 'mm', min: 0.2, max: 20, help: 'footW' }));
    root.append(selectField('Adhesive material', () => L.adhMat, v => { L.adhMat = v; }, materialOptions(['adhesive', 'tim']), { section: 'materials', help: 'adhMat' }));
    root.append(numField('Adhesive thickness', () => L.adhT, v => { L.adhT = v; }, { unit: 'µm', scale: 1000, min: 0.005, max: 1, help: 'adhT' }));
    root.append(selectField('TIM1 material', () => L.timMat, v => { L.timMat = v; }, materialOptions(['tim', 'adhesive']), { section: 'materials', help: 'timMat' }));
    root.append(numField('TIM1 bond line over thickest die', () => L.blt, v => { L.blt = v; }, { unit: 'µm', scale: 1000, min: 0.005, max: 1, help: 'blt' }));
    const g = app.geom;
    if (g && g.lid) root.append(h('div', { class: 'kv' }, kl('Derived foot height', 'footH'), h('span', null, fmt(g.lid.footH * 1000, 0) + ' µm (standoff + max die thickness + BLT − adhesive)'), ...g.dies.flatMap((d, i) => [kl('TIM BLT over ' + d.name, 'bltDie'), h('span', null, fmt(g.lid.blt[i] * 1000, 0) + ' µm')])));
  } else if (cfg.packageType === 'stiffener') {
    const S = cfg.stiffener;
    root.append(h('h3', null, 'Stiffener ring'));
    root.append(selectField('Material', () => S.mat, v => { S.mat = v; }, materialOptions('metal'), { section: 'materials', help: 'stiffMat' }));
    root.append(numField('Outer size x', () => S.ox, v => { S.ox = v; }, { unit: 'mm', min: 1, max: 150, help: 'stiffOuter' }));
    root.append(numField('Outer size y', () => S.oy, v => { S.oy = v; }, { unit: 'mm', min: 1, max: 150, help: 'stiffOuter' }));
    root.append(numField('Ring width', () => S.ringW, v => { S.ringW = v; }, { unit: 'mm', min: 0.2, max: 20, help: 'ringW' }));
    root.append(numField('Thickness', () => S.t, v => { S.t = v; }, { unit: 'mm', min: 0.1, max: 5, help: 'stiffT' }));
    root.append(selectField('Adhesive material', () => S.adhMat, v => { S.adhMat = v; }, materialOptions(['adhesive', 'tim']), { section: 'materials', help: 'adhMat' }));
    root.append(numField('Adhesive thickness', () => S.adhT, v => { S.adhT = v; }, { unit: 'µm', scale: 1000, min: 0.005, max: 1, help: 'adhT' }));
  } else {
    root.append(h('div', { class: 'msg info' }, 'Bare die configuration: no lid or stiffener. Change the configuration in step 1.'));
  }
  renderValidation(root);
}

// ---- step 4: materials ----
function paramRows(m, obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('v' in v) out.push({ path: prefix + k, par: v });
      else if (Array.isArray(v.T)) out.push({ path: prefix + k, par: v, table: true });
      else paramRows(m, v, prefix + k + '.', out);
    }
  }
  return out;
}
function paramLabel(path) {
  const map = { 'elastic.E.E': 'E', 'elastic.E.Eg': 'E glassy', 'elastic.E.Er': 'E rubbery', 'elastic.E.TgDMA': 'Tg (DMA) for E(T)', 'elastic.E.w': 'E(T) transition width', 'elastic.nu': 'ν', 'elastic.C11': 'C11', 'elastic.C12': 'C12', 'elastic.C44': 'C44', 'elastic.E_iso': 'E (isotropic option)', 'elastic.nu_iso': 'ν (isotropic option)', 'elastic.Ex': 'E_x', 'elastic.Ey': 'E_y', 'elastic.Ez': 'E_z', 'elastic.Gxy': 'G_xy', 'elastic.Gxz': 'G_xz', 'elastic.Gyz': 'G_yz', 'elastic.nuxy': 'ν_xy', 'elastic.nuxz': 'ν_xz', 'elastic.nuyz': 'ν_yz', 'elastic.rubberyRatio': 'rubbery ratio', 'elastic.TgDMA': 'Tg (DMA)', 'elastic.w': 'transition width', 'cte.a': 'CTE', 'cte.a1': 'α1 (below Tg)', 'cte.a2': 'α2 (above Tg)', 'cte.TgTMA': 'Tg (TMA)', 'cte.delta': 'CTE smoothing', 'cteXY.a': 'CTE x,y', 'cteZ.a1': 'CTE z below Tg', 'cteZ.a2': 'CTE z above Tg', 'cteZ.TgTMA': 'Tg (TMA) for CTE z', 'cteZ.delta': 'CTE z smoothing', 'cure': 'cure temperature', 'solidus': 'solidus', 'elastic.E': 'E(T) table', 'cte': 'CTE table' };
  if (map[path]) return map[path];
  if (path.startsWith('anand.')) return 'Anand ' + path.slice(6);
  return path;
}
function renderMaterialsPanel(root) {
  const cfg = app.cfg;
  root.append(h('h2', null, '4. Materials'));
  root.append(h('div', { class: 'muted small' }, 'Every value shows its confidence: ', h('span', { class: 'badge Datasheet' }, 'Datasheet'), h('span', { class: 'badge Literature' }, 'Literature'), h('span', { class: 'badge Handbook' }, 'Handbook'), h('span', { class: 'badge Estimated' }, 'Estimated'), ' (placeholder, replace with measured data). Editing marks a value ', h('span', { class: 'badge User' }, 'User'), '.'));
  const roles = C.materialRoles(cfg);
  const used = new Set(roles.map(r => r.id));
  const sel = h('select', tip('matSelect', { onchange: e => { app.selectedMaterial = e.target.value; renderContext(); } }));
  for (const m of cfg.materials) sel.append(h('option', { value: m.id, selected: m.id === (app.selectedMaterial || roles[0].id) ? '' : null }, (used.has(m.id) ? '● ' : '') + m.name + ' [' + m.category + ']' + (m.modified ? ' (modified)' : '')));
  if (!app.selectedMaterial) app.selectedMaterial = roles[0].id;
  root.append(h('div', { class: 'row' }, h('label', null, 'Material '), sel, h('button', tip('matDup', { onclick: () => duplicateMaterial(app.selectedMaterial) }), 'Duplicate'), h('button', tip('matReset', { onclick: () => resetMaterial(app.selectedMaterial) }), 'Reset to default')));
  root.append(h('div', { class: 'small muted' }, 'In use: ' + roles.map(r => r.role + ' → ' + C.findMaterial(cfg.materials, r.id).name).join('; ')));
  const m = C.findMaterial(cfg.materials, app.selectedMaterial);
  root.append(h('h3', null, m.name, h('span', { class: 'muted small' }, ' ' + (m.grade || ''))));
  if (m.notes) root.append(h('div', { class: 'msg info small' }, m.notes));
  if (m.category === 'core') {
    root.append(h('div', { class: 'row small' }, 'Core presets: ', ...cfg.materials.filter(x => x.category === 'core').map(x => h('button', { class: 'small', 'data-tip': TIPS.corePreset, onclick: () => { for (const r of cfg.substrate.layers) if (r.type === 'core') r.mat = x.id; app.selectedMaterial = x.id; onConfigChanged('materials'); renderContext(); } }, x.name))));
  }
  if (m.category === 'buildup') {
    root.append(h('div', { class: 'row small' }, 'ABF presets: ', ...cfg.materials.filter(x => x.category === 'buildup').map(x => h('button', { class: 'small', 'data-tip': TIPS.abfPreset, onclick: () => { for (const r of cfg.substrate.layers) { if (r.type === 'diel') r.mat = x.id; if (r.type === 'cu') r.fill = x.id; } app.selectedMaterial = x.id; onConfigChanged('materials'); renderContext(); } }, x.name))));
  }
  const rows = paramRows(m, { elastic: m.elastic, cte: m.cte, cteXY: m.cteXY, cteZ: m.cteZ, cure: m.cure, solidus: m.solidus, anand: m.anand }, '', []);
  const tbl = h('table', null, h('tr', null, h('th', null, 'Property'), h('th', null, 'Value', helpTip('matValue')), h('th', null, 'Unit'), h('th', null, 'Confidence', helpTip('matConf')), h('th', null, 'Range', helpTip('matRange')), h('th')));
  const defaults = C.buildMaterialLibrary(MATERIALS_DB);
  const def = defaults.find(x => x.id === m.defaultOf) || null;
  for (const r of rows) {
    const p = r.par;
    const src = (p.s || []).map(s => MATERIALS_DB.references[s] ? '[' + s + '] ' + MATERIALS_DB.references[s].cite + (MATERIALS_DB.references[s].url ? ' ' + MATERIALS_DB.references[s].url : '') : s).join('\n');
    const tipText = (p.n ? p.n + ' ' : '') + (src || 'No source: ' + (MATERIALS_DB.confidenceLabels[p.c] || ''));
    let valueCell;
    if (r.table) {
      valueCell = h('td', null, h('span', { class: 'mono' }, p.T.map((T, i) => T + ' °C: ' + p.v[i]).join('; ')), h('button', tip('matTableEdit', { class: 'small', onclick: () => editTable(m, r.path) }), 'edit'));
    } else {
      const inp = h('input', { type: 'number', step: 'any', value: fmtInput(p.v), onchange: e => { const v = parseFloat(e.target.value); if (!isFinite(v)) return; if (!checkMaterialBound(r.path, p, v)) { e.target.value = fmtInput(p.v); return; } p.v = v; p.c = 'User'; m.modified = true; onConfigChanged('materials'); renderContext(); } });
      valueCell = h('td', null, inp);
    }
    const dp = def ? C.getPath(def, r.path) : null;
    tbl.append(h('tr', null, h('td', { 'data-tip': tipText }, paramLabel(r.path), p.n ? h('span', { class: 'help', 'data-tip': p.n, tabindex: '0' }, 'i') : null), valueCell, h('td', null, p.u || ''), h('td', null, h('span', { class: 'badge ' + (p.c || 'Estimated'), 'data-tip': (MATERIALS_DB.confidenceLabels[p.c || 'Estimated'] || '') + (src ? ' Source: ' + src : '') }, p.c || 'Estimated')), h('td', { class: 'small', 'data-tip': p.r ? TIPS.matRange : null }, p.r ? p.r[0] + ' to ' + p.r[1] : ''), h('td', null, dp && !r.table ? h('button', { class: 'small', 'data-tip': 'Reset to the database default ' + dp.v + ' ' + (p.u || ''), onclick: () => { p.v = dp.v; p.c = dp.c; m.modified = rows.some(q => q.par.c === 'User'); onConfigChanged('materials'); renderContext(); } }, '↺') : null)));
  }
  root.append(tbl);
  // E(T) and CTE(T) plots
  const c1 = h('canvas', tip('plotE', { class: 'plot', style: 'height:170px' })), c2 = h('canvas', tip('plotCTE', { class: 'plot', style: 'height:170px' }));
  root.append(h('div', { class: 'grid2' }, c1, c2));
  requestAnimationFrame(() => {
    const Ts = [], Es = [], As = [], Az = [];
    const ctes = C.materialCte(m);
    for (let T = -60; T <= 280; T += 2) {
      Ts.push(T);
      if (m.elastic.type === 'iso') Es.push(C.isoE(m, T) / 1000); else if (m.elastic.type === 'ortho') Es.push(C.materialEC(m, T).Ex / 1000); else Es.push(NaN);
      As.push(C.cteAlpha(ctes.xy, T) * 1e6); Az.push(C.cteAlpha(ctes.z, T) * 1e6);
    }
    const tgs = C.materialTgs(m).map(t => ({ x: t.T, label: t.label }));
    linePlot(c1, [{ x: Ts, y: Es, label: m.elastic.type === 'ortho' ? 'E_x' : 'E' }], { title: 'E(T) used by the model', xlabel: '°C', ylabel: 'GPa', vlines: tgs, zero: true });
    linePlot(c2, [{ x: Ts, y: As, label: 'α (x,y)' }, { x: Ts, y: Az, label: 'α z', dash: [4, 3] }], { title: 'Instantaneous CTE(T)', xlabel: '°C', ylabel: 'ppm/°C', vlines: tgs, zero: true });
  });
}
function checkMaterialBound(path, p, v) {
  const b = C.CONST.BOUNDS;
  const last = path.split('.').pop();
  if (/^nu/.test(last) && (v < b.nu[0] || v > b.nu[1])) { toast('Poisson ratio must be between 0 and 0.49.', 'error'); return false; }
  if ((p.u === 'GPa' || p.u === 'MPa') && !path.startsWith('anand')) { const g = p.u === 'MPa' ? v / 1000 : v; if (g < b.modulusGPa[0] || g > b.modulusGPa[1]) { toast('Modulus must be between 0.0001 and 500 GPa.', 'error'); return false; } }
  if (p.u === 'ppm/°C' && (v < b.cte[0] || v > b.cte[1])) { toast('CTE must be between 0 and 300 ppm/°C.', 'error'); return false; }
  return true;
}
function editTable(m, path) {
  const p = C.getPath(m, path);
  const ta = h('textarea', { style: 'width:100%;height:120px;font-family:var(--mono)' }, p.T.map((T, i) => T + ', ' + p.v[i]).join('\n'));
  const box = h('div', null, h('p', null, 'One row per line: temperature (°C), value (' + (p.u || '') + ').'), ta, h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { const T = [], v = []; for (const line of ta.value.split('\n')) { const q = line.split(/[,\s]+/).filter(Boolean).map(Number); if (q.length >= 2 && q.every(isFinite)) { T.push(q[0]); v.push(q[1]); } } if (T.length) { p.T = T; p.v = v; p.c = 'User'; m.modified = true; onConfigChanged('materials'); closeModal(); renderContext(); } } }, 'Apply')));
  showModal('Edit table: ' + paramLabel(path), box);
}
function duplicateMaterial(id) {
  const m = C.deepClone(C.findMaterial(app.cfg.materials, id));
  m.id = id + '_copy' + (app.cfg.materials.length);
  m.name = m.name + ' (copy)';
  m.modified = true;
  app.cfg.materials.push(m);
  app.selectedMaterial = m.id;
  onConfigChanged('materials'); renderContext();
}
function resetMaterial(id) {
  const m = C.findMaterial(app.cfg.materials, id);
  const d = C.buildMaterialLibrary(MATERIALS_DB).find(x => x.id === m.defaultOf);
  if (!d) { toast('No default for this material.', 'warn'); return; }
  const i = app.cfg.materials.indexOf(m);
  const nd = C.deepClone(d); nd.id = m.id; nd.name = m.name.replace(/ \(copy\)$/, '');
  app.cfg.materials[i] = nd;
  onConfigChanged('materials'); renderContext();
}

// ---- step 5: process and loads ----
function renderProcessPanel(root) {
  const cfg = app.cfg, p = cfg.process;
  root.append(h('h2', null, '5. Process and loads'));
  root.append(h('h3', null, 'Process sequence (stress-free temperatures)'));
  const tl = h('table', null, h('tr', null, h('th', null, 'Stage'), h('th', null, 'Event'), h('th', null, 'Birth temperature °C')));
  const stages = [['S0', 'Substrate born stress-free', 'Tsub', 'Tsub'], ['S1', 'Die(s) and solder born (chip join, solidification)', 'Tjoin', 'Tjoin'], ['S2', 'Underfill phase and fillet born (effective stress-free T)', 'Tuf', 'Tuf'], ['S3', cfg.packageType === 'bare' ? '(no lid or stiffener)' : (cfg.packageType === 'lid' ? 'Lid, TIM1 and lid adhesive born' : 'Stiffener and adhesive born'), 'Tattach', 'Tattach']];
  for (const [s, ev, key, hk] of stages) {
    const inp = cfg.packageType === 'bare' && key === 'Tattach' ? h('span', { class: 'muted' }, '–') : h('input', { type: 'number', step: 1, value: p[key], 'data-tip': HELP[hk], onchange: e => { p[key] = +e.target.value; onConfigChanged('process'); } });
    tl.append(h('tr', null, h('td', null, s), h('td', null, ev, help(hk)), h('td', null, inp)));
  }
  tl.append(h('tr', null, h('td', null, 'End'), h('td', null, 'As-assembled state'), h('td', null, '25 (evaluation)')));
  root.append(tl);
  root.append(h('div', { class: 'row small' }, h('button', tip('TsubBtn', { class: 'small', onclick: () => { p.Tsub = 217; onConfigChanged('process'); renderContext(); } }), 'T_sub = solder solidus (217)'), h('button', tip('TsubBtn2', { class: 'small', onclick: () => { p.Tsub = 200; onConfigChanged('process'); renderContext(); } }), 'T_sub = ABF cure (200)')));
  root.append(h('h3', null, 'Reflow warpage sweep'));
  root.append(numField('Peak temperature', () => cfg.reflow.peak, v => { cfg.reflow.peak = v; }, { unit: '°C', min: 30, max: 300, help: 'peak', section: 'loads' }));
  root.append(h('div', { class: 'field' }, h('label', null, 'Report temperatures', help('reportTemps')), h('input', { type: 'text', value: cfg.reflow.reportTemps.join(', '), onchange: e => { cfg.reflow.reportTemps = e.target.value.split(/[,\s]+/).filter(Boolean).map(Number).filter(isFinite); onConfigChanged('loads'); } }), h('span', { class: 'unit' }, '°C')));
  root.append(h('h3', null, 'Temperature cycling'));
  root.append(selectField('Condition', () => cfg.cycling.cond, v => { cfg.cycling.cond = v; if (C.CYCLING_CONDITIONS[v]) { cfg.cycling.Tmin = C.CYCLING_CONDITIONS[v].Tmin; cfg.cycling.Tmax = C.CYCLING_CONDITIONS[v].Tmax; } renderContext(); }, [...Object.entries(C.CYCLING_CONDITIONS).map(([k, c]) => ({ value: k, label: c.label })), { value: 'custom', label: 'custom' }], { help: 'cycling', section: 'loads' }));
  root.append(numField('T min', () => cfg.cycling.Tmin, v => { cfg.cycling.Tmin = v; cfg.cycling.cond = 'custom'; }, { unit: '°C', min: -80, max: 200, section: 'loads', help: 'Tmin' }));
  root.append(numField('T max', () => cfg.cycling.Tmax, v => { cfg.cycling.Tmax = v; cfg.cycling.cond = 'custom'; }, { unit: '°C', min: -80, max: 300, section: 'loads', help: 'Tmax' }));
  root.append(numField('Ramp rate', () => cfg.cycling.ramp, v => { cfg.cycling.ramp = v; }, { unit: '°C/min', min: 0.1, max: 100, help: 'ramp', section: 'loads' }));
  root.append(numField('Dwell at each extreme', () => cfg.cycling.dwell, v => { cfg.cycling.dwell = v; }, { unit: 'min', min: 0, max: 600, help: 'dwell', section: 'loads' }));
  root.append(numField('Simulated cycles (submodel)', () => cfg.cycling.cycles, v => { cfg.cycling.cycles = Math.max(1, Math.round(v)); }, { min: 1, max: 10, step: 1, help: 'cycles', section: 'loads' }));
  root.append(h('h3', null, 'Limits (editable)'));
  root.append(h('div', { class: 'small muted' }, 'JEITA ED-7306 (2007); customer limits for large FCBGA often differ.'));
  const jt = h('table', null, h('tr', null, h('th', null, 'Pitch mm'), h('th', null, 'Ball height'), h('th', null, 'Max at elevated T, mm', helpTip('jeitaHot')), h('th', null, 'RT coplanarity ref, mm', helpTip('jeitaRT'))));
  for (const r of cfg.limits.jeita) jt.append(h('tr', null, h('td', null, r.pitch), h('td', null, r.ballH), h('td', null, h('input', { type: 'number', step: 0.01, value: r.hot, onchange: e => { r.hot = +e.target.value; onConfigChanged('post'); } })), h('td', null, h('input', { type: 'number', step: 0.01, value: r.rt, onchange: e => { r.rt = +e.target.value; onConfigChanged('post'); } }))));
  root.append(jt);
  root.append(numField('Die strength (optional, for margin)', () => cfg.limits.dieStrength === null ? NaN : cfg.limits.dieStrength, v => { cfg.limits.dieStrength = isFinite(v) ? v : null; }, { unit: 'MPa', min: 0, section: 'post', help: 'dieStrength' }));
  root.append(numField('Bump axial force threshold (optional)', () => cfg.limits.bumpAxialN === null ? NaN : cfg.limits.bumpAxialN, v => { cfg.limits.bumpAxialN = isFinite(v) ? v : null; }, { unit: 'N', min: 0, section: 'post', help: 'bumpAxialN' }));
  root.append(numField('Bump shear force threshold (optional)', () => cfg.limits.bumpShearN === null ? NaN : cfg.limits.bumpShearN, v => { cfg.limits.bumpShearN = isFinite(v) ? v : null; }, { unit: 'N', min: 0, section: 'post', help: 'bumpShearN' }));
  root.append(h('h3', null, 'Fatigue model constants'));
  root.append(numField('Syed energy constant C_W', () => cfg.fatigue.CW, v => { cfg.fatigue.CW = v; }, { unit: '1/MPa', min: 1e-6, section: 'post', help: 'CW' }));
  root.append(h('div', { class: 'small muted' }, 'N_f = 1 / (C_W ΔW), ΔW in MPa per cycle. Default 0.00165 (Syed 2004 via Amalu et al. 2015); other sources quote 0.0019. Fitted to accumulated creep energy from a different constitutive model and joint geometry.'));
  root.append(numField('Syed strain constant', () => cfg.fatigue.Cstrain, v => { cfg.fatigue.Cstrain = v; }, { min: 1e-6, section: 'post', help: 'Cstrain' }));
  root.append(h('div', { class: 'small muted' }, 'Darveaux: N_0 = K1 ΔW^K2, da/dN = K3 ΔW^K4. No defaults: K1 and K3 depend on element size and averaging scheme, so enter constants calibrated to this modeling approach (25 µm averaging layers).'));
  for (const k of ['K1', 'K2', 'K3', 'K4']) root.append(numField('Darveaux ' + k, () => cfg.fatigue[k] === null ? NaN : cfg.fatigue[k], v => { cfg.fatigue[k] = isFinite(v) ? v : null; }, { section: 'post', help: k }));
}

// ---- configuration files and presets ----
function saveConfigFile() {
  const blob = new Blob([C.serializeConfig(app.cfg)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: (app.cfg.name || 'fcbga-config').replace(/[^\w.-]+/g, '_') + '.json' });
  document.body.appendChild(a); a.click(); a.remove();
}
function loadConfigFile() {
  const inp = h('input', { type: 'file', accept: '.json,application/json' });
  inp.addEventListener('change', () => {
    const f = inp.files[0]; if (!f) return;
    f.text().then(t => { try { const c = C.parseConfig(t); app.cfg = c; app.selectedDie = 0; app.results = null; app.currentFields = null; onConfigChanged('geometry', { released: true }); renderAll(); toast('Configuration loaded: ' + (c.name || f.name), 'ok'); } catch (e) { toast('Could not load: ' + e.message, 'error'); } });
  });
  inp.click();
}
function loadPreset(id) {
  const [w, v] = id.split(':');
  app.cfg = C.presetConfig(MATERIALS_DB, w, v);
  app.selectedDie = 0; app.results = null; app.currentFields = null;
  onConfigChanged('geometry', { released: true });
  floorplan.zoomFit();
  renderAll();
  toast('Preset loaded: ' + app.cfg.name, 'ok');
}
