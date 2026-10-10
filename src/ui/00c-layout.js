// ===== UI: resizable panes =====================================================
// Every window can be resized by dragging: the step list and the context panel
// (vertical splitters), the floorplan / cross-section split, the 3D view, and
// each plot or map (drag its bottom edge). Double-click a splitter or an edge to
// restore the default size. Sizes are a per-viewer convenience kept through
// prefs (localStorage, try/catch); without storage the defaults apply.

const LAYOUT_DEFAULTS = { stepperW: 190, contextW: 440, xsectionH: 190, view3dH: 560 };
const LAYOUT_LIMITS = {
  stepperW: [48, 420], contextW: [280, 1400], xsectionH: [80, 1600], view3dH: [200, 2000], canvasH: [90, 1600],
  centerMinW: 420,      // px kept for the central area when a side panel grows
  floorplanMinH: 160,   // px kept for the floorplan when the cross-section grows
  stepperNarrowW: 120,  // below this width the step list shows numbers only
  edgeGrip: 8,          // px band at the bottom edge of a plot or map that starts a resize
  keyStep: 16,          // px per arrow key press on a focused splitter
};

function loadLayout() {
  const stored = prefs.get('layout', {}) || {};
  const L = { canvasH: {} };
  for (const k of Object.keys(LAYOUT_DEFAULTS)) L[k] = isFinite(stored[k]) ? +stored[k] : LAYOUT_DEFAULTS[k];
  if (stored.canvasH && typeof stored.canvasH === 'object') for (const [k, v] of Object.entries(stored.canvasH)) if (isFinite(v)) L.canvasH[k] = +v;
  return L;
}
app.layout = loadLayout();
function saveLayout() { prefs.set('layout', app.layout); }
const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Clamp the side panels against the window so the central area keeps LAYOUT_LIMITS.centerMinW, then publish the sizes as CSS variables. */
function applyLayout() {
  const L = app.layout, lim = LAYOUT_LIMITS;
  const appW = $('#app') ? $('#app').clientWidth : window.innerWidth;
  L.stepperW = clampTo(L.stepperW, lim.stepperW[0], lim.stepperW[1]);
  L.contextW = clampTo(L.contextW, lim.contextW[0], Math.max(lim.contextW[0], Math.min(lim.contextW[1], appW - L.stepperW - lim.centerMinW - 12)));
  L.xsectionH = clampTo(L.xsectionH, lim.xsectionH[0], lim.xsectionH[1]);
  L.view3dH = clampTo(L.view3dH, lim.view3dH[0], lim.view3dH[1]);
  const st = document.documentElement.style;
  st.setProperty('--stepper-w', L.stepperW + 'px');
  st.setProperty('--context-w', L.contextW + 'px');
  st.setProperty('--xs-h', L.xsectionH + 'px');
  st.setProperty('--v3d-h', L.view3dH + 'px');
  const nav = $('#stepper'); if (nav) nav.classList.toggle('narrow', L.stepperW < lim.stepperNarrowW);
}

/** Pointer drag with capture: onMove(state, delta px along the axis). */
function bindDrag(el, axis, onStart, onMove, onEnd) {
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const state = onStart(e);
    if (state === null) return;
    e.preventDefault(); e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const p0 = axis === 'x' ? e.clientX : e.clientY;
    const cls = axis === 'x' ? 'resizing-x' : 'resizing-y';
    document.body.classList.add(cls); el.classList.add('active');
    const move = ev => onMove(state, (axis === 'x' ? ev.clientX : ev.clientY) - p0);
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      document.body.classList.remove(cls); el.classList.remove('active');
      if (onEnd) onEnd(state);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
}

/**
 * Splitter bound to one app.layout size. sign +1 grows the size when dragging right or down,
 * -1 when dragging left or up; range(start) returns the [min, max] allowed for this drag.
 */
function makeSplitter({ axis, key, sign, tipKey, range }) {
  const el = h('div', tip(tipKey, { class: 'splitter ' + axis, role: 'separator', tabindex: '0', 'aria-orientation': axis === 'x' ? 'vertical' : 'horizontal' }));
  const set = v => { const [lo, hi] = range ? range() : LAYOUT_LIMITS[key]; app.layout[key] = clampTo(Math.round(v), lo, hi); applyLayout(); };
  bindDrag(el, axis, () => ({ start: app.layout[key] }), (s, d) => set(s.start + sign * d), saveLayout);
  el.addEventListener('dblclick', () => { app.layout[key] = LAYOUT_DEFAULTS[key]; applyLayout(); saveLayout(); });
  el.addEventListener('keydown', e => {
    const grow = axis === 'x' ? { ArrowRight: 1, ArrowLeft: -1 } : { ArrowDown: 1, ArrowUp: -1 };
    if (!(e.key in grow)) return;
    e.preventDefault(); set(app.layout[key] + sign * grow[e.key] * LAYOUT_LIMITS.keyStep); saveLayout();
  });
  return el;
}

/** Side-panel splitters, inserted once around the central area. */
function initLayout() {
  const lim = LAYOUT_LIMITS;
  $('#stepper').after(makeSplitter({ axis: 'x', key: 'stepperW', sign: 1, tipKey: 'splitLeft' }));
  $('#context').before(makeSplitter({ axis: 'x', key: 'contextW', sign: -1, tipKey: 'splitRight', range: () => [lim.contextW[0], Math.max(lim.contextW[0], $('#app').clientWidth - app.layout.stepperW - lim.centerMinW - 12)] }));
  applyLayout();
  let t = null;
  window.addEventListener('resize', () => { if (t) cancelAnimationFrame(t); t = requestAnimationFrame(applyLayout); });
  initCanvasGrips();
}

/** Splitter between the floorplan and the cross-section; the floorplan takes the remaining height. */
function xsectionSplitter(wrap, xs) {
  return makeSplitter({ axis: 'y', key: 'xsectionH', sign: -1, tipKey: 'splitXs', range: () => [LAYOUT_LIMITS.xsectionH[0], Math.max(LAYOUT_LIMITS.xsectionH[0], wrap.offsetHeight + xs.offsetHeight - LAYOUT_LIMITS.floorplanMinH)] });
}
/** Grip under the 3D view. */
function view3dSplitter() { return makeSplitter({ axis: 'y', key: 'view3dH', sign: 1, tipKey: 'split3d' }); }

// ---- plots and maps: drag the bottom edge ----
const RESIZABLE_CANVAS = 'canvas.plot, canvas.map';
/** Key that identifies a plot across re-renders: panel, step or view, and its order in the panel. */
function canvasKey(c) {
  const ctx = c.closest('#context'), ctr = c.closest('#center-body');
  const root = ctx || ctr; if (!root) return null;
  const scope = ctx ? 'step' + app.step : app.centerTab + (app.centerTab === 'results' ? ':' + app.resultsView : '');
  return scope + ':' + Array.prototype.indexOf.call(root.querySelectorAll(RESIZABLE_CANVAS), c);
}
/** Apply remembered heights and the resize hint to the plots of a freshly rendered panel. */
function applyCanvasHeights(root) {
  for (const c of root.querySelectorAll(RESIZABLE_CANVAS)) {
    if (c.dataset.h0 === undefined) c.dataset.h0 = c.style.height || '';
    const k = canvasKey(c), v = k ? app.layout.canvasH[k] : undefined;
    if (v) c.style.height = v + 'px';
    const t = c.getAttribute('data-tip') || '';
    if (!t.includes(TIPS.plotResize)) c.setAttribute('data-tip', (t ? t + ' ' : '') + TIPS.plotResize);
  }
}
function initCanvasGrips() {
  const lim = LAYOUT_LIMITS;
  let hover = null, drag = null;
  const gripAt = e => {
    const c = e.target;
    if (!(c instanceof HTMLCanvasElement) || !c.matches(RESIZABLE_CANVAS)) return null;
    return e.clientY >= c.getBoundingClientRect().bottom - lim.edgeGrip ? c : null;
  };
  document.addEventListener('pointermove', e => {
    if (drag) { drag.c.style.height = clampTo(Math.round(drag.h0 + e.clientY - drag.y0), lim.canvasH[0], lim.canvasH[1]) + 'px'; return; }
    const c = gripAt(e);
    if (c !== hover) { if (hover) hover.classList.remove('grip-hover'); hover = c; if (c) c.classList.add('grip-hover'); }
  });
  document.addEventListener('pointerdown', e => {
    const c = gripAt(e); if (!c || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    c.setPointerCapture(e.pointerId);
    drag = { c, y0: e.clientY, h0: c.getBoundingClientRect().height };
    document.body.classList.add('resizing-y');
  }, true);
  const end = () => {
    if (!drag) return;
    const k = canvasKey(drag.c);
    if (k) { app.layout.canvasH[k] = Math.round(drag.c.getBoundingClientRect().height); saveLayout(); }
    document.body.classList.remove('resizing-y'); drag = null;
  };
  document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
  document.addEventListener('dblclick', e => {
    const c = gripAt(e); if (!c) return;
    const k = canvasKey(c); if (k) { delete app.layout.canvasH[k]; saveLayout(); }
    c.style.height = c.dataset.h0 || '';
  });
}
