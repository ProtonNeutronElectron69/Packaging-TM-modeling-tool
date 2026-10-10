// ===== UI: floorplan editor and cross-section (Section 4.3) =================

const PART_COLORS = {
  substrate: ['#d9c7a5', '#6b5a3c'], die: ['#7aa7d6', '#2d4f7c'], bump: ['#b8b8b8', '#6e6e6e'], uf: ['#e9b86b', '#8a5f12'],
  lid: ['#c08a5a', '#6e4a2a'], adh: ['#9ec9a5', '#3a6b45'], tim: ['#d7a0d7', '#7b3f7b'], stiff: ['#c08a5a', '#6e4a2a'], core: ['#bfa98a', '#5b4a30'], cu: ['#d99a5b', '#7a4d1e'], sr: ['#7bb67b', '#2f5f2f'],
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
    canvas.addEventListener('keydown', e => { if (e.key === 'r' || e.key === 'R') { rotateDie(app.selectedDie); } if (e.key === 'Delete') deleteDie(app.selectedDie); });
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
  onDown(e) {
    const r = this.canvas.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
    const wx = this.invX(px), wy = this.invY(py);
    const di = this.dieAtPoint(wx, wy);
    this.canvas.setPointerCapture(e.pointerId);
    if (di >= 0) {
      app.selectedDie = di;
      const d = app.cfg.dies[di];
      this.drag = { die: di, dx: d.x - wx, dy: d.y - wy, moved: false };
      this.canvas.style.cursor = 'move';
      document.dispatchEvent(new CustomEvent('dieselect'));
    } else {
      this.drag = { pan: true, px, py, ox: this.ox, oy: this.oy };
    }
  },
  snapValue(v, others, axis, size) {
    let s = Math.round(v / this.snap) * this.snap;
    const tol = Math.max(this.snap, 6 / this.scale);
    if (this.snapCenter && Math.abs(v) < tol) s = 0;
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
    const d = app.cfg.dies[this.drag.die];
    const g = app.geom, me = g.dies[this.drag.die];
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
      // dies
      const errDies = new Set(app.validation.errors.filter(e => e.die !== undefined).map(e => e.die));
      g.dies.forEach((d, i) => {
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
      for (const d of f.dies) for (const v of d[which].smax) if (isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
      scale = makeScale(mn, mx, mn < 0);
      for (const d of f.dies) drawGridField(ctx, d[which].xs, d[which].ys, d[which].smax, scale, X, Y, 0.95);
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
      const cv = h('canvas');
      legendEl.append(h('span', null, fmt(scale.min, 1)), cv, h('span', null, fmt(scale.max, 1)), h('span', { class: 'muted' }, label));
      drawLegend(cv, scale);
    }
  },

  drawReadout() {
    const el = $('#fp-readout'); if (!el) return;
    const g = app.geom; if (!g) { el.textContent = ''; return; }
    const lines = [];
    const di = app.selectedDie;
    if (di >= 0 && di < g.dies.length) {
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

// ---- die operations ----
function rotateDie(i) { const d = app.cfg.dies[i]; if (!d) return; d.rot = d.rot === 90 ? 0 : 90; onConfigChanged('geometry', { released: true }); }
function deleteDie(i) { if (app.cfg.dies.length <= 1) { toast('Keep at least one die.', 'warn'); return; } app.cfg.dies.splice(i, 1); app.selectedDie = Math.max(0, i - 1); onConfigChanged('geometry', { released: true }); }
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
      if (d) {
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
