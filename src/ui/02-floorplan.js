// ===== UI: floorplan editor and cross-section (Section 4.3) =================

const PART_COLORS = {
  substrate: ['#d9c7a5', '#6b5a3c'], die: ['#7aa7d6', '#2d4f7c'], bump: ['#b8b8b8', '#6e6e6e'], uf: ['#e9b86b', '#8a5f12'],
  lid: ['#c08a5a', '#6e4a2a'], adh: ['#9ec9a5', '#3a6b45'], tim: ['#d7a0d7', '#7b3f7b'], stiff: ['#c08a5a', '#6e4a2a'], core: ['#bfa98a', '#5b4a30'], cu: ['#d99a5b', '#7a4d1e'], sr: ['#7bb67b', '#2f5f2f'],
  base: ['#9db0c4', '#3f5468'], rdl: ['#c7b27c', '#6a5a2c'], mold: ['#8e8e8e', '#454545'], chiplet: ['#7aa7d6', '#2d4f7c'],
};
function partColor(key, dark) { return PART_COLORS[key][dark ? 1 : 0]; }
function isDark() { return getComputedStyle(document.documentElement).getPropertyValue('color-scheme').trim() === 'dark'; }

const floorplan = {
  canvas: null, ctx: null, scale: 10, ox: 0, oy: 0, drag: null, hover: null, snap: 0.1, snapEdges: true, snapCenter: true,
  autoFit: true, size: null,  // autoFit: refit on resize until the user zooms or pans
  zoomFit() {
    const c = this.canvas; if (!c) return;
    const r = c.getBoundingClientRect();
    this.autoFit = true; this.size = { w: r.width, h: r.height };
    const sx = app.cfg.substrate.sx, sy = app.cfg.substrate.sy;
    this.scale = Math.min((r.width - 70) / sx, (r.height - 70) / sy);
    this.ox = r.width / 2; this.oy = r.height / 2;
  },
  X(x) { return this.ox + x * this.scale; },
  Y(y) { return this.oy - y * this.scale; },
  invX(px) { return (px - this.ox) / this.scale; },
  invY(py) { return (this.oy - py) / this.scale; },

  init(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.zoomFit();
    canvas.addEventListener('pointerdown', e => this.onDown(e));
    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerup', e => this.onUp(e));
    canvas.addEventListener('pointercancel', e => this.onUp(e));
    canvas.addEventListener('wheel', e => { e.preventDefault(); const f = e.deltaY < 0 ? 1.15 : 1 / 1.15; const r = canvas.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top; const wx = this.invX(px), wy = this.invY(py); this.scale *= f; this.ox = px - wx * this.scale; this.oy = py + wy * this.scale; this.autoFit = false; this.draw(); }, { passive: false });
    canvas.addEventListener('dblclick', () => { this.zoomFit(); this.draw(); });
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', e => { if (e.key === 'r' || e.key === 'R') rotateSelected(); if (e.key === 'Delete') deleteSelected(); });
    new ResizeObserver(() => { if (this.canvas === canvas) { this.onResize(); this.draw(); } }).observe(canvas);
  },
  /** Keep the drawing fitted while the pane is resized; after a zoom or pan, keep the view centered instead. */
  onResize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (this.autoFit || !this.size) { this.zoomFit(); return; }
    this.ox += (r.width - this.size.w) / 2; this.oy += (r.height - this.size.h) / 2;
    this.size = { w: r.width, h: r.height };
  },

  dieAtPoint(wx, wy) {
    const g = app.geom; if (!g) return -1;
    for (let i = g.dies.length - 1; i >= 0; i--) { const r = g.dies[i].rect; if (wx >= r.x0 && wx <= r.x1 && wy >= r.y0 && wy <= r.y1) return i; }
    return -1;
  },
  /** Object on the bump layer under the point (index into the geometry's dies and module bases) and the chiplet hit in a module (or -1). */
  hitTest(wx, wy) {
    const di = this.dieAtPoint(wx, wy);
    if (di < 0) return null;
    const d = app.geom.dies[di];
    const ci = d.chiplets ? d.chiplets.findIndex(c => wx >= c.rect.x0 && wx <= c.rect.x1 && wy >= c.rect.y0 && wy <= c.rect.y1) : -1;
    return { di, ci };
  },
  onDown(e) {
    const r = this.canvas.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
    const wx = this.invX(px), wy = this.invY(py);
    const hit = this.hitTest(wx, wy);
    this.canvas.setPointerCapture(e.pointerId);
    if (hit) {
      app.selectedDie = hit.di; app.selectedChiplet = hit.ci;
      const sel = selectedObject();
      if (sel.kind === 'die') this.drag = { die: hit.di, dx: sel.die.x - wx, dy: sel.die.y - wy, moved: false };
      else if (hit.ci >= 0) { const gc = app.geom.dies[hit.di].chiplets[hit.ci]; this.drag = { die: hit.di, chip: hit.ci, dx: gc.cx - wx, dy: gc.cy - wy, moved: false }; }
      else this.drag = { die: hit.di, dx: sel.mod.x - wx, dy: sel.mod.y - wy, moved: false };
      this.canvas.style.cursor = 'move';
      document.dispatchEvent(new CustomEvent('dieselect'));
    } else {
      this.drag = { pan: true, px, py, ox: this.ox, oy: this.oy };
    }
  },
  snapValue(v, others, axis, size, center) {
    let s = Math.round(v / this.snap) * this.snap;
    const tol = Math.max(this.snap, 6 / this.scale);
    const c0 = center || 0;
    if (this.snapCenter && Math.abs(v - c0) < tol) s = c0;
    if (this.snapEdges) {
      const half = size / 2;
      for (const o of others) {
        for (const e of [o.lo, o.hi]) { if (Math.abs(v - half - e) < tol) s = e + half; if (Math.abs(v + half - e) < tol) s = e - half; }
      }
    }
    return s;
  },
  onMove(e) {
    const r = this.canvas.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
    const wx = this.invX(px), wy = this.invY(py);
    if (!this.drag) {
      const di = this.dieAtPoint(wx, wy);
      this.canvas.style.cursor = di >= 0 ? 'move' : 'crosshair';
      this.hover = { x: wx, y: wy };
      this.drawReadout();
      return;
    }
    if (this.drag.pan) { this.ox = this.drag.ox + (px - this.drag.px); this.oy = this.drag.oy + (py - this.drag.py); this.autoFit = false; this.draw(); return; }
    const g = app.geom, me = g.dies[this.drag.die];
    if (this.drag.chip !== undefined) {
      // a chiplet moves within its module: snap to the other chiplets' edges and the module centre lines
      const gc = me.chiplets[this.drag.chip], others = me.chiplets.filter((_, i) => i !== this.drag.chip);
      const nx = this.snapValue(wx + this.drag.dx, others.map(o => ({ lo: o.rect.x0, hi: o.rect.x1 })), 'x', gc.w, me.cx);
      const ny = this.snapValue(wy + this.drag.dy, others.map(o => ({ lo: o.rect.y0, hi: o.rect.y1 })), 'y', gc.h, me.cy);
      const m = app.cfg.modules[me.modIndex], c = m.chiplets[this.drag.chip];
      const rx = nx - m.x, ry = ny - m.y;
      const [cx, cy] = m.rot === 90 ? [ry, -rx] : [rx, ry];
      if (Math.abs(cx - c.x) > 1e-9 || Math.abs(cy - c.y) > 1e-9) { c.x = Number(cx.toFixed(6)); c.y = Number(cy.toFixed(6)); this.drag.moved = true; onConfigChanged('geometry', { dragging: true }); }
      return;
    }
    const sel = selectedObject(), d = sel.kind === 'die' ? sel.die : sel.mod;
    const othersX = g.dies.filter((_, i) => i !== this.drag.die).map(o => ({ lo: o.rect.x0, hi: o.rect.x1 }));
    const othersY = g.dies.filter((_, i) => i !== this.drag.die).map(o => ({ lo: o.rect.y0, hi: o.rect.y1 }));
    const nx = this.snapValue(wx + this.drag.dx, othersX, 'x', me.w), ny = this.snapValue(wy + this.drag.dy, othersY, 'y', me.h);
    if (nx !== d.x || ny !== d.y) {
      d.x = Number(nx.toFixed(6)); d.y = Number(ny.toFixed(6));
      this.drag.moved = true;
      onConfigChanged('geometry', { dragging: true });
    }
  },
  onUp(e) {
    if (!this.drag) return;
    const wasDrag = !this.drag.pan && this.drag.moved;
    this.drag = null;
    this.canvas.style.cursor = 'crosshair';
    if (wasDrag) onConfigChanged('geometry', { released: true });
    else this.draw();
  },

  draw() {
    const c = this.canvas; if (!c || !app.cfg) return;
    const { ctx, w, h: H } = setupCanvas(c);
    const dark = isDark();
    const text = cssVar('--text'), muted = cssVar('--muted'), grid = cssVar('--grid');
    ctx.clearRect(0, 0, w, H);
    const cfg = app.cfg, g = app.geom;
    const X = x => this.X(x), Y = y => this.Y(y);
    // grid
    const gstep = this.scale > 30 ? 1 : (this.scale > 8 ? 5 : 10);
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    const sx = cfg.substrate.sx / 2, sy = cfg.substrate.sy / 2;
    for (let x = -Math.ceil(sx / gstep) * gstep; x <= sx; x += gstep) { ctx.beginPath(); ctx.moveTo(X(x), Y(-sy)); ctx.lineTo(X(x), Y(sy)); ctx.stroke(); }
    for (let y = -Math.ceil(sy / gstep) * gstep; y <= sy; y += gstep) { ctx.beginPath(); ctx.moveTo(X(-sx), Y(y)); ctx.lineTo(X(sx), Y(y)); ctx.stroke(); }
    // substrate
    ctx.fillStyle = partColor('substrate', dark); ctx.globalAlpha = 0.35;
    ctx.fillRect(X(-sx), Y(sy), cfg.substrate.sx * this.scale, cfg.substrate.sy * this.scale);
    ctx.globalAlpha = 1; ctx.strokeStyle = text; ctx.lineWidth = 1.5;
    ctx.strokeRect(X(-sx), Y(sy), cfg.substrate.sx * this.scale, cfg.substrate.sy * this.scale);
    // overlay (warpage / stress) from results
    this.drawOverlay(ctx, X, Y);
    if (g) {
      // BGA zone
      const z = g.bga.zone;
      ctx.setLineDash([6, 4]); ctx.strokeStyle = muted; ctx.lineWidth = 1;
      ctx.strokeRect(X(z.x0), Y(z.y1), (z.x1 - z.x0) * this.scale, (z.y1 - z.y0) * this.scale); ctx.setLineDash([]);
      // lid / stiffener footprint (hatched ring)
      const ring = g.lid ? g.lid : g.stiff;
      if (ring) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(X(ring.outer.x0), Y(ring.outer.y1), (ring.outer.x1 - ring.outer.x0) * this.scale, (ring.outer.y1 - ring.outer.y0) * this.scale);
        ctx.rect(X(ring.inner.x0), Y(ring.inner.y1), (ring.inner.x1 - ring.inner.x0) * this.scale, (ring.inner.y1 - ring.inner.y0) * this.scale);
        ctx.clip('evenodd');
        ctx.strokeStyle = partColor('lid', dark); ctx.lineWidth = 1; ctx.globalAlpha = 0.7;
        const step = 8;
        for (let d = -H - w; d < w + H; d += step) { ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + H, H); ctx.stroke(); }
        ctx.globalAlpha = 1; ctx.restore();
        ctx.strokeStyle = partColor('lid', dark); ctx.lineWidth = 1.5;
        ctx.strokeRect(X(ring.outer.x0), Y(ring.outer.y1), (ring.outer.x1 - ring.outer.x0) * this.scale, (ring.outer.y1 - ring.outer.y0) * this.scale);
        ctx.strokeRect(X(ring.inner.x0), Y(ring.inner.y1), (ring.inner.x1 - ring.inner.x0) * this.scale, (ring.inner.y1 - ring.inner.y0) * this.scale);
      }
      // fillet band
      ctx.fillStyle = partColor('uf', dark); ctx.globalAlpha = 0.35;
      for (const d of g.dies) { const Wf = g.uf.Wf; ctx.beginPath(); ctx.roundRect(X(d.rect.x0 - Wf), Y(d.rect.y1 + Wf), (d.w + 2 * Wf) * this.scale, (d.h + 2 * Wf) * this.scale, Wf * this.scale); ctx.fill(); }
      ctx.globalAlpha = 1;
      // dies and stacked modules
      const errDies = new Set(app.validation.errors.filter(e => e.die !== undefined && e.chip === undefined).map(e => e.die));
      const errChips = new Set(app.validation.errors.filter(e => e.chip !== undefined).map(e => e.die + ':' + e.chip));
      g.dies.forEach((d, i) => {
        if (d.kind === 'module') { this.drawModule(ctx, X, Y, d, i, errDies.has(i), errChips, dark); return; }
        ctx.fillStyle = partColor('die', dark); ctx.globalAlpha = 0.75;
        ctx.fillRect(X(d.rect.x0), Y(d.rect.y1), d.w * this.scale, d.h * this.scale);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = errDies.has(i) ? cssVar('--err') : (i === app.selectedDie ? cssVar('--accent') : text); ctx.lineWidth = errDies.has(i) ? 3 : (i === app.selectedDie ? 2.5 : 1.2);
        ctx.strokeRect(X(d.rect.x0), Y(d.rect.y1), d.w * this.scale, d.h * this.scale);
        if (d.field) { ctx.setLineDash([3, 3]); ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.strokeRect(X(d.field.x0), Y(d.field.y1), (d.field.x1 - d.field.x0) * this.scale, (d.field.y1 - d.field.y0) * this.scale); if (d.inner) ctx.strokeRect(X(d.inner.x0), Y(d.inner.y1), (d.inner.x1 - d.inner.x0) * this.scale, (d.inner.y1 - d.inner.y0) * this.scale); ctx.setLineDash([]); }
        ctx.fillStyle = text; ctx.font = '12px ' + cssVar('--font'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(d.name + ' (' + d.w + ' × ' + d.h + ')', X(d.cx), Y(d.cy));
      });
    }
    // cut line
    const cl = app.cutLine;
    ctx.strokeStyle = cssVar('--accent2'); ctx.lineWidth = 1.5; ctx.setLineDash([8, 4]);
    ctx.beginPath();
    if (cl.axis === 'x') { ctx.moveTo(X(-sx - 2), Y(cl.pos)); ctx.lineTo(X(sx + 2), Y(cl.pos)); } else { ctx.moveTo(X(cl.pos), Y(-sy - 2)); ctx.lineTo(X(cl.pos), Y(sy + 2)); }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = cssVar('--accent2'); ctx.font = '11px ' + cssVar('--font');
    if (cl.axis === 'x') { ctx.textAlign = 'left'; ctx.fillText('A', X(-sx - 2) + 2, Y(cl.pos) - 6); ctx.textAlign = 'right'; ctx.fillText("A'", X(sx + 2) - 2, Y(cl.pos) - 6); }
    else { ctx.textAlign = 'center'; ctx.fillText('A', X(cl.pos) + 8, Y(sy + 2) + 10); ctx.fillText("A'", X(cl.pos) + 8, Y(-sy - 2) - 4); }
    // rulers
    ctx.fillStyle = muted; ctx.font = '10px ' + cssVar('--font'); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let x = -Math.ceil(sx / gstep) * gstep; x <= sx; x += gstep) ctx.fillText(String(x), X(x), Y(-sy) + 3);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let y = -Math.ceil(sy / gstep) * gstep; y <= sy; y += gstep) ctx.fillText(String(y), X(-sx) - 3, Y(y));
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('mm, origin at substrate center; x right, y up', X(-sx), Y(sy) - 4);
    this.drawReadout();
  },

  /** A stacked module: base (Si or RDL) filled with wafer mold, wafer underfill bands around the chiplets, chiplets with their DDI fields. */
  drawModule(ctx, X, Y, d, i, err, errChips, dark) {
    const text = cssVar('--text'), muted = cssVar('--muted'), sc = this.scale, r = d.rect;
    // fainter fills while a results overlay is shown, so the field under the module stays readable
    const fade = app.results && app.showOverlay !== 'none' ? 0.4 : 1;
    const box = (q, key, alpha) => { ctx.fillStyle = partColor(key, dark); ctx.globalAlpha = alpha * fade; ctx.fillRect(X(q.x0), Y(q.y1), (q.x1 - q.x0) * sc, (q.y1 - q.y0) * sc); ctx.globalAlpha = 1; };
    box(r, d.base === 'rdl' ? 'rdl' : 'base', 0.8);
    box(r, 'mold', 0.35);
    const g = app.geom;
    if (g.wcuf) {
      ctx.save(); ctx.beginPath(); ctx.rect(X(r.x0), Y(r.y1), d.w * sc, d.h * sc); ctx.clip();
      ctx.fillStyle = partColor('uf', dark); ctx.globalAlpha = 0.55 * fade;
      const W = g.wcuf.Wf;
      for (const c of d.chiplets) { ctx.beginPath(); ctx.roundRect(X(c.rect.x0 - W), Y(c.rect.y1 + W), (c.w + 2 * W) * sc, (c.h + 2 * W) * sc, W * sc); ctx.fill(); }
      ctx.globalAlpha = 1; ctx.restore();
    }
    const selMod = i === app.selectedDie;
    d.chiplets.forEach((c, ci) => {
      box(c.rect, 'chiplet', 0.85);
      const bad = errChips.has(i + ':' + ci), sel = selMod && ci === app.selectedChiplet;
      ctx.strokeStyle = bad ? cssVar('--err') : (sel ? cssVar('--accent') : text); ctx.lineWidth = bad ? 3 : (sel ? 2.5 : 1);
      ctx.strokeRect(X(c.rect.x0), Y(c.rect.y1), c.w * sc, c.h * sc);
      if (c.field) { ctx.setLineDash([2, 3]); ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.strokeRect(X(c.field.x0), Y(c.field.y1), (c.field.x1 - c.field.x0) * sc, (c.field.y1 - c.field.y0) * sc); if (c.inner) ctx.strokeRect(X(c.inner.x0), Y(c.inner.y1), (c.inner.x1 - c.inner.x0) * sc, (c.inner.y1 - c.inner.y0) * sc); ctx.setLineDash([]); }
      ctx.fillStyle = text; ctx.font = '11px ' + cssVar('--font'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(c.short + ' (' + c.w + ' × ' + c.h + ')', X(c.cx), Y(c.cy));
    });
    ctx.strokeStyle = err ? cssVar('--err') : (selMod && app.selectedChiplet < 0 ? cssVar('--accent') : text); ctx.lineWidth = err ? 3 : (selMod && app.selectedChiplet < 0 ? 2.5 : 1.5);
    ctx.strokeRect(X(r.x0), Y(r.y1), d.w * sc, d.h * sc);
    // module label just above the base outline, clear of the chiplet labels
    ctx.fillStyle = text; ctx.font = '11px ' + cssVar('--font'); ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(d.name + ' (' + (d.base === 'rdl' ? 'RDL' : 'Si') + ' base ' + d.w + ' × ' + d.h + ')', X(r.x0) + 2, Y(r.y1) - 2);
  },

  drawOverlay(ctx, X, Y) {
    const res = app.results; if (!res || app.showOverlay === 'none') return;
    const f = app.currentFields || res.at25;
    if (!f) return;
    const legendEl = $('#fp-legend');
    // results belong to the geometry they were computed for; hide them once the floorplan or stack changes
    if (res.hashes && res.hashes.geometry !== C.configHashes(app.cfg).geometry) {
      if (legendEl) legendEl.textContent = 'Overlay hidden: the geometry changed since the last analysis. Run the analysis in step 6 (or Quick preview) to update it.';
      return;
    }
    let scale, label;
    if (app.showOverlay === 'warpage') {
      const grid = f.warpage.grid;
      scale = makeScale(f.warpage.rmin * 1000, f.warpage.rmax * 1000, true);
      const scaled = Float32Array.from(grid, v => v * 1000);
      drawGridField(ctx, res.xs, res.ys, scaled, scale, X, Y, 0.85);
      const lv = ticks(scale.min, scale.max, 8);
      drawContours(ctx, res.xs, res.ys, scaled, lv, X, Y, 'rgba(0,0,0,0.35)');
      drawPoints(ctx, f.warpage.ballX, f.warpage.ballY, Float32Array.from(f.warpage.ballRes, v => v * 1000), scale, X, Y, Math.max(1.5, 0.18 * app.cfg.bga.pitch * this.scale));
      label = 'Substrate bottom warpage (relative to the best-fit plane over the BGA zone) at ' + f.T + ' °C, µm; + toward the package top';
    } else if (app.showOverlay === 'subtop') {
      const grid = Float32Array.from(f.substrateTop.grid, v => v * 1000);
      let mn = Infinity, mx = -Infinity; for (const v of grid) if (isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
      scale = makeScale(mn, mx, true);
      drawGridField(ctx, res.xs, res.ys, grid, scale, X, Y, 0.85);
      label = 'Substrate top surface warpage at ' + f.T + ' °C, µm';
    } else if (app.showOverlay === 'dieTop' || app.showOverlay === 'dieBottom') {
      const which = app.showOverlay === 'dieTop' ? 'top' : 'bottom';
      let mn = Infinity, mx = -Infinity;
      const parts = f.si || f.dies;
      for (const d of parts) for (const v of d[which].smax) if (isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
      scale = makeScale(mn, mx, mn < 0);
      for (const d of parts) drawGridField(ctx, d[which].xs, d[which].ys, d[which].smax, scale, X, Y, 0.95);
      label = 'Die ' + (which === 'top' ? 'backside' : 'active face') + ' maximum principal stress at ' + f.T + ' °C, MPa (nodal averaged)';
    } else if (app.showOverlay === 'bumpN' || app.showOverlay === 'bumpV' || app.showOverlay === 'cpiN' || app.showOverlay === 'cpiV') {
      const cpi = app.showOverlay.startsWith('cpi');
      const comp = app.showOverlay.endsWith('N') ? 'N' : 'V';
      const list = cpi ? res.cpi : f.dies.map(d => d.bumps);
      let mn = Infinity, mx = -Infinity;
      for (const b of list) for (const v of b[comp]) if (isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
      scale = makeScale(mn, mx, comp === 'N');
      for (const b of list) drawPoints(ctx, b.x, b.y, b[comp], scale, X, Y, Math.max(1, 0.35 * (app.geom ? app.geom.dies[0].px : 0.15) * this.scale));
      label = 'Per-bump ' + (comp === 'N' ? 'axial force (tension +)' : 'shear force') + ', N, ' + (cpi ? 'end of chip join at 25 °C (before underfill)' : 'as-assembled at ' + f.T + ' °C');
    } else if (app.showOverlay === 'screening' && res.screening) {
      let mn = Infinity, mx = -Infinity;
      for (const s of res.screening) for (const v of s.dW) if (isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
      scale = makeScale(mn, mx, false);
      for (const s of res.screening) drawPoints(ctx, s.x, s.y, s.dW, scale, X, Y, Math.max(1, 0.35 * (app.geom ? app.geom.dies[0].px : 0.15) * this.scale));
      label = 'Screening index ΔW_proxy (inelastic work density per stabilized cycle), MPa; ranks locations, not a life';
    }
    if (scale && legendEl) {
      legendEl.innerHTML = '';
      legendEl.append(...legendItems(scale, label, { class: 'muted' }));
    }
  },

  drawReadout() {
    const el = $('#fp-readout'); if (!el) return;
    const g = app.geom; if (!g) { el.textContent = ''; return; }
    const lines = [];
    const di = app.selectedDie;
    const chip = di >= 0 && di < g.dies.length && g.dies[di].chiplets ? g.dies[di].chiplets[app.selectedChiplet] : null;
    if (chip) {
      const m = g.dies[di], r = chip.rect;
      lines.push(chip.name + ': center (' + fmt(chip.cx, 3) + ', ' + fmt(chip.cy, 3) + ') mm, ' + fmt(chip.cx - m.cx, 3) + ', ' + fmt(chip.cy - m.cy, 3) + ' from the module centre');
      lines.push('edge to base edge: left ' + fmt(r.x0 - m.rect.x0, 2) + ', right ' + fmt(m.rect.x1 - r.x1, 2) + ', bottom ' + fmt(r.y0 - m.rect.y0, 2) + ', top ' + fmt(m.rect.y1 - r.y1, 2) + ' mm' + (g.wcuf ? ' (wCUF fillet ' + fmt(g.wcuf.Wf, 2) + ')' : ''));
      for (const o of m.chiplets) if (o !== chip) lines.push('gap to ' + o.short + ': ' + fmt(C.rectGap(r, o.rect), 3) + ' mm');
    } else if (di >= 0 && di < g.dies.length) {
      const d = g.dies[di], cl = C.dieClearances(g, di);
      lines.push(d.name + ': center (' + fmt(d.cx, 3) + ', ' + fmt(d.cy, 3) + ') mm');
      lines.push('edge to substrate edge: ' + ['left', 'right', 'bottom', 'top'].map(k => k + ' ' + fmt(cl.edges[k], 2)).join(', ') + ' mm');
      for (const gp of cl.gaps) lines.push('gap to ' + gp.to + ': ' + fmt(gp.gap, 3) + ' mm');
      if (cl.lidFoot !== null) lines.push('clearance to ' + (g.lid ? 'lid foot' : 'stiffener') + ': ' + fmt(cl.lidFoot, 2) + ' mm (fillet needs ' + fmt(g.uf.Wf, 2) + ')');
      lines.push('DNP (center to farthest die corner): ' + fmt(cl.dnp, 2) + ' mm');
    }
    if (this.hover) lines.push('cursor: ' + fmt(this.hover.x, 2) + ', ' + fmt(this.hover.y, 2) + ' mm');
    el.textContent = lines.join('\n');
  },
};

// ---- die, module and chiplet operations ----
// app.selectedDie indexes the objects on the bump layer: the monolithic dies (cfg.dies), then the stacked modules
// (cfg.modules); app.selectedChiplet is a chiplet of the selected module, or -1 for the module itself
function selectedObject() {
  const nd = app.cfg.dies.length, i = app.selectedDie;
  if (i >= 0 && i < nd) return { kind: 'die', die: app.cfg.dies[i], i };
  const mi = i - nd, mod = app.cfg.modules[mi];
  if (!mod) return { kind: 'none' };
  const ci = app.selectedChiplet >= 0 && app.selectedChiplet < mod.chiplets.length ? app.selectedChiplet : -1;
  return { kind: 'module', mod, mi, ci, chip: ci >= 0 ? mod.chiplets[ci] : null };
}
function objectCount() { return app.cfg.dies.length + app.cfg.modules.length; }
function selectObject(i, ci) { app.selectedDie = i; app.selectedChiplet = ci === undefined ? -1 : ci; renderContext(); floorplan.draw(); }
function rotateSelected() { const s = selectedObject(); if (s.kind === 'die') rotateDie(s.i); else if (s.kind === 'module') { if (s.chip) rotateChiplet(s.mi, s.ci); else rotateModule(s.mi); } }
function deleteSelected() { const s = selectedObject(); if (s.kind === 'die') deleteDie(s.i); else if (s.kind === 'module') { if (s.chip) deleteChiplet(s.mi, s.ci); else deleteModule(s.mi); } }
function rotateDie(i) { const d = app.cfg.dies[i]; if (!d) return; d.rot = d.rot === 90 ? 0 : 90; onConfigChanged('geometry', { released: true }); }
function deleteDie(i) { if (objectCount() <= 1) { toast('Keep at least one die or module.', 'warn'); return; } app.cfg.dies.splice(i, 1); app.selectedDie = Math.max(0, i - 1); app.selectedChiplet = -1; onConfigChanged('geometry', { released: true }); }
function rotateModule(mi) { const m = app.cfg.modules[mi]; if (!m) return; m.rot = m.rot === 90 ? 0 : 90; onConfigChanged('geometry', { released: true }); }
function deleteModule(mi) { if (objectCount() <= 1) { toast('Keep at least one die or module.', 'warn'); return; } app.cfg.modules.splice(mi, 1); app.selectedDie = Math.max(0, app.cfg.dies.length + mi - 1); app.selectedChiplet = -1; onConfigChanged('geometry', { released: true }); }
function duplicateModule(mi) { const m = C.deepClone(app.cfg.modules[mi]); const n = app.cfg.modules.length + 1; m.id = 'M' + n; m.name = 'Module ' + n; m.x += (m.rot === 90 ? m.sy : m.sx) + 1; app.cfg.modules.push(m); selectNewModule(); }
function addModule(base) { C.normalizeConfig(app.cfg, MATERIALS_DB); const n = app.cfg.modules.length + 1; const m = C.defaultModule('M' + n, n * 2, 0, base); app.cfg.modules.push(m); selectNewModule(); }
function selectNewModule() { app.selectedDie = app.cfg.dies.length + app.cfg.modules.length - 1; app.selectedChiplet = -1; onConfigChanged('geometry', { released: true }); }
function rotateChiplet(mi, ci) { const c = app.cfg.modules[mi].chiplets[ci]; c.rot = c.rot === 90 ? 0 : 90; onConfigChanged('geometry', { released: true }); }
function deleteChiplet(mi, ci) { const m = app.cfg.modules[mi]; if (m.chiplets.length <= 1) { toast('A module keeps at least one chiplet.', 'warn'); return; } m.chiplets.splice(ci, 1); app.selectedChiplet = Math.min(ci, m.chiplets.length - 1); onConfigChanged('geometry', { released: true }); }
function duplicateChiplet(mi, ci) { const m = app.cfg.modules[mi]; const c = C.deepClone(m.chiplets[ci]); const n = m.chiplets.length + 1; c.id = 'C' + n; c.name = 'Chiplet ' + n; c.x += (c.rot === 90 ? c.sy : c.sx) / 2; m.chiplets.push(c); app.selectedChiplet = m.chiplets.length - 1; onConfigChanged('geometry', { released: true }); }
function addChiplet(mi) { const m = app.cfg.modules[mi]; const n = m.chiplets.length + 1; m.chiplets.push(C.defaultChiplet('C' + n, 0, 0, Math.min(5, m.sx / 2), Math.min(5, m.sy / 2))); app.selectedChiplet = m.chiplets.length - 1; onConfigChanged('geometry', { released: true }); }
function duplicateDie(i) { const d = C.deepClone(app.cfg.dies[i]); d.id = 'D' + (app.cfg.dies.length + 1); d.name = 'Die ' + (app.cfg.dies.length + 1); d.x += d.sx + 1; app.cfg.dies.push(d); app.selectedDie = app.cfg.dies.length - 1; onConfigChanged('geometry', { released: true }); }
function addDie() { const n = app.cfg.dies.length + 1; const d = C.defaultDie('D' + n, 0, 0); d.sx = 10; d.sy = 10; d.x = n * 2; app.cfg.dies.push(d); app.selectedDie = app.cfg.dies.length - 1; onConfigChanged('geometry', { released: true }); }

// ---- cross-section ----
const xsection = {
  canvas: null,
  init(canvas) { this.canvas = canvas; new ResizeObserver(() => this.draw()).observe(canvas); },
  draw() {
    const c = this.canvas; if (!c || !app.geom) return;
    const { ctx, w, h: H } = setupCanvas(c);
    const dark = isDark(), text = cssVar('--text'), muted = cssVar('--muted');
    ctx.clearRect(0, 0, w, H);
    const cfg = app.cfg, g = app.geom, cl = app.cutLine;
    const along = cl.axis === 'x' ? 'x' : 'y';
    const L = along === 'x' ? cfg.substrate.sx : cfg.substrate.sy;
    const zmax = Math.max(g.zt, ...g.dies.map(d => d.ztop), g.lid ? g.lid.zLidTop : 0, g.stiff ? g.stiff.zTop : 0);
    const ex = app.exaggeration;
    const sX = (w - 60) / L;
    const sZ = Math.min(sX * ex, (H - 40) / zmax);
    const X = s => 30 + (s + L / 2) * sX, Z = z => H - 24 - z * sZ;
    const rect = (s0, s1, z0, z1, key, alpha) => { ctx.fillStyle = partColor(key, dark); ctx.globalAlpha = alpha === undefined ? 0.9 : alpha; ctx.fillRect(X(s0), Z(z1), (s1 - s0) * sX, (z1 - z0) * sZ); ctx.globalAlpha = 1; };
    // substrate rows
    for (const r of g.sub.rows) rect(-L / 2, L / 2, r.z0, r.z1, r.row.type === 'core' ? 'core' : (r.row.type === 'cu' ? 'cu' : (r.row.type === 'sr' ? 'sr' : 'substrate')));
    // sample along the cut
    const n = 400;
    const inter = (s) => { const x = along === 'x' ? s : cl.pos, y = along === 'x' ? cl.pos : s; return { x, y }; };
    // fillet and die and lid per sample column
    for (let k = 0; k < n; k++) {
      const s0 = -L / 2 + L * k / n, s1 = -L / 2 + L * (k + 1) / n, sm = 0.5 * (s0 + s1);
      const { x, y } = inter(sm);
      const d = C.dieAt(g, x, y);
      if (d && d.kind === 'module') {
        // stacked module: C4 bumps, base, DDI gap, then chiplet or wafer underfill fillet and mold
        rect(s0, s1, g.zt, g.zaf, 'bump'); rect(s0, s1, g.zaf, d.zBaseTop, d.base === 'rdl' ? 'rdl' : 'base');
        const c = C.chipletAt(d, x, y);
        if (c) { rect(s0, s1, d.zBaseTop, d.zDdiTop, 'bump'); rect(s0, s1, d.zDdiTop, d.ztop, 'chiplet'); }
        else {
          const w = C.wcufHeight(g, d, x, y);
          rect(s0, s1, d.zBaseTop, d.ztop, 'mold');
          if (w.inFootprint) rect(s0, s1, d.zBaseTop, d.zDdiTop + w.h, 'uf');
        }
        if (g.lid) rect(s0, s1, d.ztop, g.lid.zLidBot, 'tim');
      } else if (d) {
        rect(s0, s1, g.zt, g.zaf, 'bump'); rect(s0, s1, g.zaf, d.ztop, 'die');
        if (g.lid) rect(s0, s1, d.ztop, g.lid.zLidBot, 'tim');
      } else {
        const f = C.filletHeight(g, x, y);
        if (f.inFootprint) rect(s0, s1, g.zt, g.zaf + f.h, 'uf');
      }
      if (g.lid) {
        const inOuter = C.pointInRect(g.lid.outer, x, y), inInner = C.pointInRect(g.lid.inner, x, y);
        if (inOuter && !inInner) { rect(s0, s1, g.zt, g.lid.zAdhTop, 'adh'); rect(s0, s1, g.lid.zAdhTop, g.lid.zLidBot, 'lid'); }
        if (inOuter) rect(s0, s1, g.lid.zLidBot, g.lid.zLidTop, 'lid');
      }
      if (g.stiff) {
        const inOuter = C.pointInRect(g.stiff.outer, x, y), inInner = C.pointInRect(g.stiff.inner, x, y);
        if (inOuter && !inInner) { rect(s0, s1, g.zt, g.stiff.zAdhTop, 'adh'); rect(s0, s1, g.stiff.zAdhTop, g.stiff.zTop, 'stiff'); }
      }
    }
    // axis
    ctx.strokeStyle = muted; ctx.beginPath(); ctx.moveTo(X(-L / 2), Z(0)); ctx.lineTo(X(L / 2), Z(0)); ctx.stroke();
    ctx.fillStyle = text; ctx.font = '11px ' + cssVar('--font'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('Section A-A\' along ' + along + ' at ' + (along === 'x' ? 'y' : 'x') + ' = ' + fmt(cl.pos, 2) + ' mm, vertical exaggeration ' + ex + '×', 30, 4);
    ctx.textAlign = 'right'; ctx.fillText('total substrate ' + fmt(g.zt * 1000, 0) + ' µm; z up', w - 10, 4);
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const t of ticks(-L / 2, L / 2, 8)) ctx.fillText(String(t), X(t), H - 4);
  },
};
