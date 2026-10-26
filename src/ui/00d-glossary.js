// ===== UI: glossary of acronyms and variables ==================================
// GLOSSARY lists every technical acronym and variable symbol the UI shows. Trade-name
// acronyms of materials (ABF, PSR, MCL and the like) are deliberately left out.
// Terms found in rendered text are wrapped in a span.gl that shows the spelled-out
// term and a short description on hover and opens the glossary at that entry on click.
// Entry fields: term (as listed), full (spelled out), desc (short phrase), match (strings
// linked wherever they appear, longest first), exact (strings linked only when they are
// the whole text of an element, for one-letter symbols), not (regex the next characters
// must not match, to skip trade names such as "UF 9000AE").

const GLOSSARY = [
  // ---- packaging and process ----
  { id: 'fcbga', term: 'FCBGA', full: 'Flip chip ball grid array', desc: 'package with the die bumped face-down on a substrate that carries a solder ball array', match: ['FCBGA', 'FC-BGA'] },
  { id: 'fc', term: 'FC', full: 'Flip chip', desc: 'die mounted face-down on its bumps', match: ['FC'] },
  { id: 'bga', term: 'BGA', full: 'Ball grid array', desc: 'array of solder balls on the package bottom that joins it to the board', match: ['BGA'] },
  { id: 'csp', term: 'CSP', full: 'Chip scale package', desc: 'package only slightly larger than its die', match: ['CSP'] },
  { id: 'ic', term: 'IC', full: 'Integrated circuit', desc: 'the silicon chip, or the package family built around it', match: ['ICs', 'IC'] },
  { id: 'pcb', term: 'PCB, PWB', full: 'Printed circuit board, printed wiring board', desc: 'system board the package is soldered to (second level, not modeled)', match: ['PCB', 'PWB'] },
  { id: 'cpi', term: 'CPI', full: 'Chip-package interaction', desc: 'stress the package imposes on the die and its on-chip wiring', match: ['CPI'] },
  { id: 'beol', term: 'BEOL', full: 'Back end of line', desc: 'on-chip copper wiring and low-k dielectric layers on the die active face', match: ['BEOL'] },
  { id: 'dnp', term: 'DNP', full: 'Distance from neutral point', desc: 'distance from the package center to a die corner or bump', match: ['DNP'] },
  { id: 'uf', term: 'UF', full: 'Underfill', desc: 'filled epoxy that fills the gap between die and substrate around the bumps', match: ['UF'], not: '\\s?\\d' },
  { id: 'tim', term: 'TIM, TIM1', full: 'Thermal interface material (level 1)', desc: 'compliant layer between the die backside and the lid', match: ['TIM1', 'TIM'] },
  { id: 'blt', term: 'BLT', full: 'Bond line thickness', desc: 'thickness of a TIM or adhesive layer', match: ['BLT'] },
  { id: 'sr', term: 'SR', full: 'Solder resist', desc: 'protective polymer layer on both substrate surfaces', match: ['SR'], not: '[-\\d]' },
  { id: 'sro', term: 'SRO', full: 'Solder resist opening', desc: 'opening in the solder resist under each bump pad', match: ['SRO'] },
  { id: 'ubm', term: 'UBM', full: 'Under-bump metallization', desc: 'die-side pad stack the solder bump wets to', match: ['UBM'] },
  { id: 'pth', term: 'PTH', full: 'Plated through hole', desc: 'copper-plated hole through the core connecting its two sides', match: ['PTH'] },
  { id: 'bt', term: 'BT', full: 'Bismaleimide triazine', desc: 'resin family used in many package core laminates', match: ['BT'] },
  { id: 'sac', term: 'SAC', full: 'Tin-silver-copper (Sn-Ag-Cu) solder', desc: 'lead-free solder family; the digits give the silver and copper content', match: ['SAC'] },
  { id: 'alsic', term: 'AlSiC', full: 'Aluminum silicon carbide', desc: 'metal-matrix composite with a low CTE, used for lids', match: ['AlSiC'] },
  { id: 'rt', term: 'RT', full: 'Room temperature', desc: '25 °C in this tool', match: ['RT'] },
  { id: 'msl', term: 'MSL', full: 'Moisture sensitivity level', desc: 'JEDEC rating of how long a package may sit in room air before reflow', match: ['MSL'] },
  { id: 'uv', term: 'UV', full: 'Ultraviolet', desc: 'light used to expose photo-imageable solder resist', match: ['UV'] },
  // ---- materials characterization ----
  { id: 'cte', term: 'CTE', full: 'Coefficient of thermal expansion', desc: 'thermal strain per degree of temperature change', match: ['CTE'] },
  { id: 'ppm', term: 'ppm', full: 'Parts per million', desc: '1e-6; CTE is quoted in ppm/°C', match: ['ppm'] },
  { id: 'tg', term: 'Tg', full: 'Glass transition temperature', desc: 'where a polymer turns from glassy and stiff to rubbery and soft', match: ['Tg'] },
  { id: 'tma', term: 'TMA', full: 'Thermomechanical analysis', desc: 'measures dimensional change with temperature, giving CTE and Tg', match: ['TMA'] },
  { id: 'dma', term: 'DMA, DMTA', full: 'Dynamic mechanical (thermal) analysis', desc: 'measures modulus against temperature, giving E(T) and Tg', match: ['DMTA', 'DMA'] },
  { id: 'nist', term: 'NIST', full: 'National Institute of Standards and Technology', desc: 'US standards laboratory; source of reviewed solder data', match: ['NIST'] },
  { id: 'astm', term: 'ASTM', full: 'ASTM International (American Society for Testing and Materials)', desc: 'body that publishes materials test standards', match: ['ASTM'] },
  { id: 'en', term: 'EN', full: 'European Norm', desc: 'European standard designation, used here for steel grades', match: ['EN'] },
  // ---- standards ----
  { id: 'jeita', term: 'JEITA ED-7306', full: 'Japan Electronics and Information Technology Industries Association, standard ED-7306', desc: 'package warpage measurement method and permissible warpage limits', match: ['JEITA', 'ED-7306'] },
  { id: 'jedec', term: 'JEDEC', full: 'JEDEC Solid State Technology Association', desc: 'publishes the JESD22 package reliability test standards', match: ['JEDEC'] },
  { id: 'jesd104', term: 'JESD22-A104', full: 'JEDEC temperature cycling standard', desc: 'defines cycling conditions such as G (-40 to 125 °C)', match: ['JESD22-A104'] },
  { id: 'jesd112', term: 'JESD22-B112', full: 'JEDEC package warpage standard', desc: 'warpage measurement at elevated temperature, same sign convention as JEITA', match: ['JESD22-B112'] },
  // ---- modeling and solver ----
  { id: 'fe', term: 'FE, FEA', full: 'Finite element (analysis)', desc: 'numerical method that splits the structure into small elements to compute stress and deformation', match: ['FEA', 'FE'] },
  { id: 'dof', term: 'DOF', full: 'Degrees of freedom', desc: 'unknown nodal displacements the solver computes; sets run time and memory', match: ['DOFs', 'DOF'] },
  { id: 'pcg', term: 'PCG', full: 'Preconditioned conjugate gradient', desc: 'iterative solver for the stiffness equations', match: ['PCG'] },
  { id: 'ic0', term: 'IC(0)', full: 'Incomplete Cholesky factorization with zero fill', desc: 'fallback preconditioner for PCG', match: ['IC(0)'] },
  { id: 'bbar', term: 'B-bar', full: 'Mean-dilatation element formulation', desc: 'avoids locking when nearly incompressible solder flows', match: ['B-bar'] },
  { id: 'clt', term: 'CLT', full: 'Classical lamination theory', desc: 'closed-form plate theory used to check laminate curvature (test V4)', match: ['CLT'] },
  { id: 'cpu', term: 'CPU', full: 'Central processing unit', desc: 'processor; each core can run one Web Worker', match: ['CPU'] },
  { id: 'csv', term: 'CSV', full: 'Comma-separated values', desc: 'plain-text table format used for the results export', match: ['CSV'] },
  { id: 'json', term: 'JSON', full: 'JavaScript Object Notation', desc: 'text format used to save and load configurations', match: ['JSON'] },
  { id: 'pdf', term: 'PDF', full: 'Portable Document Format', desc: 'print target for the report', match: ['PDF'] },
  // ---- material property symbols ----
  { id: 'E', term: 'E, E(T)', full: "Young's modulus (against temperature)", desc: 'stiffness in tension, in GPa', match: ['E(T)'], exact: ['E', 'E (isotropic option)', 'E(T) table'] },
  { id: 'Exyz', term: 'E_x, E_y, E_z', full: 'Directional Young\'s moduli', desc: 'in-plane (x, y) and through-thickness (z) moduli of an orthotropic material', match: ['E_x', 'E_y', 'E_z'] },
  { id: 'Eg', term: 'E_g', full: 'Glassy modulus', desc: 'polymer modulus well below Tg', match: ['E_g', 'E glassy', 'E_glassy'] },
  { id: 'Er', term: 'E_r', full: 'Rubbery modulus', desc: 'polymer modulus well above Tg; strongly affects reflow warpage', match: ['E_r', 'E rubbery'] },
  { id: 'nu', term: 'ν', full: 'Poisson ratio', desc: 'lateral contraction per unit axial strain', match: ['ν_xy', 'ν_xz', 'ν_yz', 'ν'] },
  { id: 'G', term: 'G, G_xy, G_xz, G_yz', full: 'Shear modulus', desc: 'stiffness in shear, in GPa', match: ['G_xy', 'G_xz', 'G_yz'], exact: ['G'] },
  { id: 'Cij', term: 'C11, C12, C44', full: 'Cubic stiffness constants', desc: 'the three elastic constants of single-crystal silicon', match: ['C11', 'C12', 'C44'] },
  { id: 'alpha', term: 'α', full: 'Coefficient of thermal expansion', desc: 'symbol for CTE', match: ['α'] },
  { id: 'a1', term: 'α1', full: 'CTE below Tg', desc: 'glassy-region thermal expansion coefficient', match: ['α1'] },
  { id: 'a2', term: 'α2', full: 'CTE above Tg', desc: 'rubbery-region thermal expansion coefficient', match: ['α2'] },
  // ---- geometry and process variables ----
  { id: 'deff', term: 'd_eff', full: 'Effective bump diameter', desc: 'diameter of the equal-height, equal-volume cylinder used to homogenize a bump', match: ['d_eff'] },
  { id: 'fb', term: 'f_b', full: 'Solder area fraction', desc: 'share of the bump layer occupied by solder', match: ['f_b'] },
  { id: 'Wf', term: 'W_f', full: 'Fillet width', desc: 'underfill fillet reach from the die edge on the substrate surface', match: ['W_f'] },
  { id: 'Hf', term: 'H_f', full: 'Fillet height', desc: 'underfill fillet height on the die sidewall, as a fraction of die thickness', match: ['H_f'] },
  { id: 'pxy', term: 'p_x, p_y', full: 'Bump pitch', desc: 'center-to-center bump spacing in x and y', match: ['p_x', 'p_y'] },
  { id: 'Abump', term: 'A_bump', full: 'Bump cross-section area', desc: 'π d_eff² / 4, converts solder stress to force per bump', match: ['A_bump'] },
  { id: 'hmin', term: 'h_min, h_max', full: 'Minimum and maximum element size', desc: 'mesh sizes near die edges and far from them', match: ['h_min', 'h_max'] },
  { id: 'Tsub', term: 'T_sub', full: 'Substrate stress-free temperature', desc: 'temperature at which the substrate is born stress-free', match: ['T_sub'] },
  { id: 'Tjoin', term: 'T_join', full: 'Chip join temperature', desc: 'solder solidification temperature at which die and bumps are born', match: ['T_join'] },
  { id: 'TUF', term: 'T_UF', full: 'Underfill stress-free temperature', desc: 'effective stress-free temperature of the cured underfill', match: ['T_UF'] },
  { id: 'Tatt', term: 'T_attach', full: 'Lid or stiffener attach temperature', desc: 'stress-free temperature of the lid, TIM and adhesive', match: ['T_attach'] },
  // ---- results and fatigue ----
  { id: 'sigma', term: 'σ', full: 'Normal stress', desc: 'force per area normal to a plane, in MPa', match: ['σ'] },
  { id: 'tau', term: 'τ', full: 'Shear stress', desc: 'force per area along a plane, in MPa', match: ['τ'] },
  { id: 'eps', term: 'ε', full: 'Strain', desc: 'relative deformation (dimensionless)', match: ['ε'] },
  { id: 'dW', term: 'ΔW, ΔW_proxy', full: 'Inelastic work density per cycle', desc: 'solder creep energy per stabilized cycle, in MPa; the proxy is the screening estimate', match: ['ΔW_proxy', 'ΔW'] },
  { id: 'epsacc', term: 'ε_acc', full: 'Accumulated equivalent inelastic strain per cycle', desc: 'input of the Syed strain-based life model', match: ['ε_acc'] },
  { id: 'Nf', term: 'N_f', full: 'Cycles to failure', desc: 'estimated solder joint fatigue life (order of magnitude)', match: ['N_f'] },
  { id: 'N0', term: 'N_0', full: 'Cycles to crack initiation', desc: 'first part of the Darveaux life model', match: ['N_0'] },
  { id: 'CW', term: 'C_W', full: 'Syed energy constant', desc: 'scales ΔW to life in N_f = 1 / (C_W ΔW)', match: ['C_W'] },
  { id: 'K14', term: 'K1 to K4', full: 'Darveaux constants', desc: 'crack initiation (K1, K2) and growth (K3, K4) fit constants, model dependent', match: ['K1', 'K2', 'K3', 'K4'] },
  // ---- Anand viscoplastic constants (labels in the materials editor) ----
  { id: 'anA', term: 'A (Anand)', full: 'Anand pre-exponential factor', desc: 'scales the inelastic strain rate, in 1/s', match: ['Anand A'] },
  { id: 'anQR', term: 'Q/R (Anand)', full: 'Activation energy over the gas constant', desc: 'temperature sensitivity of creep, in K', match: ['Anand Q/R', 'Q/R'] },
  { id: 'anxi', term: 'ξ (Anand)', full: 'Anand stress multiplier', desc: 'scales stress inside the sinh flow law', match: ['ξ'] },
  { id: 'anm', term: 'm (Anand)', full: 'Anand strain rate sensitivity', desc: 'exponent of the flow law (enters as 1/m)', match: ['Anand m'] },
  { id: 'anshat', term: 'ŝ (Anand)', full: 'Anand saturation coefficient', desc: 'sets the saturated deformation resistance, in MPa', match: ['ŝ'] },
  { id: 'ann', term: 'n (Anand)', full: 'Anand saturation rate sensitivity', desc: 'strain rate exponent of the saturation value', match: ['Anand n'] },
  { id: 'anh0', term: 'h0 (Anand)', full: 'Anand hardening constant', desc: 'rate of hardening or softening, in MPa', match: ['h0'] },
  { id: 'ana', term: 'a (Anand)', full: 'Anand hardening exponent', desc: 'strain rate sensitivity of hardening', match: ['Anand a'] },
  { id: 'ans0', term: 's0 (Anand)', full: 'Initial deformation resistance', desc: 'starting value of the Anand internal variable, in MPa', match: ['s0'] },
];

// ---- matcher ----
const GLOSSARY_EXACT = new Map();
const GLOSSARY_PIECES = new Map();
for (const g of GLOSSARY) {
  for (const s of g.exact || []) GLOSSARY_EXACT.set(s, g);
  for (const s of g.match || []) GLOSSARY_PIECES.set(s, g);
}
const GLOSSARY_RE = (() => {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = [...GLOSSARY_PIECES.keys()].sort((a, b) => b.length - a.length)
    .map(s => esc(s) + (GLOSSARY_PIECES.get(s).not ? '(?!' + GLOSSARY_PIECES.get(s).not + ')' : ''));
  // a term must not continue a word on the left; on the right a letter or digit (but not "_") ends it
  return new RegExp('(?<![A-Za-z0-9_\\u0370-\\u03FF])(?:' + parts.join('|') + ')(?![A-Za-z0-9\\u0370-\\u03FF])', 'g');
})();
const GLOSSARY_SKIP = 'script, style, textarea, select, option, button, input, canvas, svg, a, .gl, .no-gloss, .brand, .help, .tab, .step, .pill, #tooltip';

function glossaryTipText(g) { return g.term + ': ' + g.full + '; ' + g.desc + '. Click to open the glossary.'; }
/** Span for one term; a tooltip the surrounding element already had (for example a material source) is kept below the glossary text. */
function glossarySpan(g, text, parent) {
  const outer = parent && parent.closest('[data-tip]');
  return h('span', { class: 'gl', 'data-gl': g.id, 'data-tip': glossaryTipText(g) + (outer ? '\n\n' + outer.getAttribute('data-tip') : '') }, text);
}

/** Wrap glossary terms in the text under root (idempotent: wrapped terms and skipped elements are not revisited). */
function glossaryAnnotate(root) {
  if (!root || (root.nodeType !== 1 && root.nodeType !== 3)) return;
  const el0 = root.nodeType === 3 ? root.parentElement : root;
  if (!el0 || el0.closest(GLOSSARY_SKIP)) return;
  const nodes = [];
  if (root.nodeType === 3) nodes.push(root);
  else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => {
        const p = n.parentElement;
        if (!p || !/[A-Za-zͰ-Ͽ]/.test(n.nodeValue) || p.closest(GLOSSARY_SKIP)) return NodeFilter.FILTER_REJECT;
        const lab = p.closest('label'); if (lab && lab.querySelector('input, select')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  }
  for (const n of nodes) {
    const text = n.nodeValue, trimmed = text.trim();
    const ex = GLOSSARY_EXACT.get(trimmed);
    if (ex) { n.replaceWith(glossarySpan(ex, text, n.parentElement)); continue; }
    GLOSSARY_RE.lastIndex = 0;
    if (!GLOSSARY_RE.test(text)) continue;
    GLOSSARY_RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = GLOSSARY_RE.exec(text))) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      frag.append(glossarySpan(GLOSSARY_PIECES.get(m[0]), m[0], n.parentElement));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    n.replaceWith(frag);
  }
}

/** Glossary window: every entry, a filter box, and the requested entry scrolled into view and highlighted. */
function showGlossary(id) {
  const list = h('div', { class: 'gl-list' });
  const rows = GLOSSARY.map(g => {
    const row = h('div', { class: 'gl-entry', id: 'gl-' + g.id }, h('b', { class: 'gl-term' }, g.term), h('span', { class: 'gl-full' }, g.full), h('span', { class: 'gl-desc muted' }, g.desc));
    row.dataset.search = (g.term + ' ' + g.full + ' ' + g.desc).toLowerCase();
    return row;
  });
  list.append(...rows);
  const filter = h('input', tip('glossaryFilter', { type: 'search', placeholder: 'filter', class: 'grow', oninput: e => { const q = e.target.value.trim().toLowerCase(); for (const r of rows) r.hidden = q && !r.dataset.search.includes(q); } }));
  const box = h('div', { class: 'no-gloss' }, h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Technical acronyms and variable symbols used in this tool. Trade-name acronyms of materials are not listed. Hover a dotted term anywhere in the tool for its meaning; click it to come here.'), filter), list);
  showModal('Glossary', box);
  const target = id && document.getElementById('gl-' + id);
  if (target) { target.classList.add('gl-hit'); requestAnimationFrame(() => target.scrollIntoView({ block: 'center' })); setTimeout(() => target.classList.remove('gl-hit'), 2400); }
  else filter.focus();
}

/** Glossary section for the printable report. */
function glossaryReportSection() {
  return h('div', { class: 'no-gloss' }, h('h3', null, 'Glossary'), h('table', { class: 'small' }, ...GLOSSARY.map(g => h('tr', null, h('td', null, h('b', null, g.term)), h('td', null, g.full), h('td', null, g.desc)))));
}

// ---- wiring: annotate whatever the UI renders; clicks on a term open its entry ----
(function setupGlossary() {
  let pending = new Set(), scheduled = false, observer = null;
  const flush = () => {
    scheduled = false;
    const roots = [...pending]; pending = new Set();
    for (const r of roots) if (r.isConnected) glossaryAnnotate(r);
    if (observer) observer.takeRecords(); // ignore the mutations made by the annotation itself
  };
  observer = new MutationObserver(records => {
    for (const rec of records) for (const n of rec.addedNodes) if (n.nodeType === 1 || n.nodeType === 3) pending.add(n);
    if (pending.size && !scheduled) { scheduled = true; requestAnimationFrame(flush); }
  });
  const start = () => { glossaryAnnotate(document.body); observer.observe(document.body, { childList: true, subtree: true }); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  document.addEventListener('click', e => {
    const el = e.target && e.target.closest ? e.target.closest('.gl') : null;
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    showGlossary(el.dataset.gl);
  }, true);
})();
