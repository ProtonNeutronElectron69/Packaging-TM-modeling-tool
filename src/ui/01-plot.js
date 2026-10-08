// ===== UI: canvas plotting, colormaps, contour maps ===========================

/** Viridis (perceptually uniform, colorblind safe) sampled at 17 points. */
const VIRIDIS = [[68, 1, 84], [71, 20, 103], [72, 38, 119], [70, 55, 132], [64, 72, 141], [57, 88, 147], [50, 103, 151], [44, 117, 154], [38, 130, 156], [33, 144, 156], [30, 158, 153], [37, 171, 147], [57, 184, 136], [87, 196, 120], [122, 207, 97], [162, 215, 69], [205, 220, 40]];
/** Blue-white-red diverging (RdBu reversed): blue negative, red positive. */
const RDBU = [[5, 48, 97], [33, 102, 172], [67, 147, 195], [146, 197, 222], [209, 229, 240], [247, 247, 247], [253, 219, 199], [244, 165, 130], [214, 96, 77], [178, 24, 43], [103, 0, 31]];
function colormap(table, t) {
  t = Math.max(0, Math.min(1, t));
  const x = t * (table.length - 1), i = Math.min(Math.floor(x), table.length - 2), f = x - i;
  const a = table[i], b = table[i + 1];
  return 'rgb(' + Math.round(a[0] + f * (b[0] - a[0])) + ',' + Math.round(a[1] + f * (b[1] - a[1])) + ',' + Math.round(a[2] + f * (b[2] - a[2])) + ')';
}
function colormapRGB(table, t) {
  t = Math.max(0, Math.min(1, t));
  const x = t * (table.length - 1), i = Math.min(Math.floor(x), table.length - 2), f = x - i;
  const a = table[i], b = table[i + 1];
  return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
}
/** Colour scale: diverging centered on zero (signed) or sequential (magnitude). */
function makeScale(vmin, vmax, signed) {
  if (signed) { const m = Math.max(Math.abs(vmin), Math.abs(vmax)) || 1; return { min: -m, max: m, signed: true, color: v => colormap(RDBU, (v + m) / (2 * m)), rgb: v => colormapRGB(RDBU, (v + m) / (2 * m)) }; }
  const lo = vmin, hi = vmax === vmin ? vmin + 1 : vmax;
  return { min: lo, max: hi, signed: false, color: v => colormap(VIRIDIS, (v - lo) / (hi - lo)), rgb: v => colormapRGB(VIRIDIS, (v - lo) / (hi - lo)) };
}

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  const w = Math.max(10, Math.round(r.width)), hh = Math.max(10, Math.round(r.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: hh };
}

/** Nice axis ticks. */
function ticks(lo, hi, n) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / (n || 5), p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p, step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * step; v += step) out.push(Number(v.toPrecision(10)));
  return out;
}

/**
 * Line plot. series: [{x, y, label, color, dash, points}]; opts: {xlabel, ylabel, title, band:[lo,hi], hlines:[{y,label,color}], vlines, xrange, yrange, legend}
 */
function linePlot(canvas, series, opts) {
  opts = opts || {};
  const { ctx, w, h: H } = setupCanvas(canvas);
  const text = cssVar('--text'), muted = cssVar('--muted'), grid = cssVar('--grid'), panel = cssVar('--panel');
  ctx.fillStyle = panel; ctx.fillRect(0, 0, w, H);
  const L = 54, R = 12, T = opts.title ? 24 : 10, B = 34;
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const s of series) for (let i = 0; i < s.x.length; i++) { if (!isFinite(s.y[i])) continue; xmin = Math.min(xmin, s.x[i]); xmax = Math.max(xmax, s.x[i]); ymin = Math.min(ymin, s.y[i]); ymax = Math.max(ymax, s.y[i]); }
  for (const hl of opts.hlines || []) { ymin = Math.min(ymin, hl.y); ymax = Math.max(ymax, hl.y); }
  if (opts.band) { ymin = Math.min(ymin, opts.band[0]); ymax = Math.max(ymax, opts.band[1]); }
  if (opts.xrange) { xmin = opts.xrange[0]; xmax = opts.xrange[1]; }
  if (opts.yrange) { ymin = opts.yrange[0]; ymax = opts.yrange[1]; }
  if (!isFinite(xmin)) { xmin = 0; xmax = 1; ymin = 0; ymax = 1; }
  if (ymax === ymin) { ymax += 1; ymin -= 1; }
  if (xmax === xmin) { xmax += 1; xmin -= 1; }
  const pad = (ymax - ymin) * 0.08; ymin -= pad; ymax += pad;
  if (opts.zero !== false && ymin > 0 && ymin < (ymax - ymin)) ymin = 0;
  const X = x => L + (x - xmin) / (xmax - xmin) * (w - L - R), Y = y => T + (ymax - y) / (ymax - ymin) * (H - T - B);
  ctx.font = '11px ' + cssVar('--font');
  ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const t of ticks(xmin, xmax, 6)) { ctx.beginPath(); ctx.moveTo(X(t), T); ctx.lineTo(X(t), H - B); ctx.stroke(); ctx.fillText(String(t), X(t), H - B + 4); }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const t of ticks(ymin, ymax, 5)) { ctx.beginPath(); ctx.moveTo(L, Y(t)); ctx.lineTo(w - R, Y(t)); ctx.stroke(); ctx.fillText(String(t), L - 5, Y(t)); }
  if (opts.band) { ctx.fillStyle = 'rgba(255,170,0,0.13)'; ctx.fillRect(L, Y(opts.band[1]), w - L - R, Y(opts.band[0]) - Y(opts.band[1])); }
  for (const hl of opts.hlines || []) { ctx.strokeStyle = hl.color || muted; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(L, Y(hl.y)); ctx.lineTo(w - R, Y(hl.y)); ctx.stroke(); ctx.setLineDash([]); if (hl.label) { ctx.fillStyle = hl.color || muted; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(hl.label, L + 4, Y(hl.y) - 2); } }
  for (const vl of opts.vlines || []) { ctx.strokeStyle = vl.color || muted; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(vl.x), T); ctx.lineTo(X(vl.x), H - B); ctx.stroke(); ctx.setLineDash([]); if (vl.label) { ctx.fillStyle = vl.color || muted; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(vl.label, X(vl.x), T + 10); } }
  const palette = [cssVar('--accent'), cssVar('--accent2'), cssVar('--warn'), cssVar('--err'), '#9b59b6', '#16a085'];
  series.forEach((s, si) => {
    ctx.strokeStyle = s.color || palette[si % palette.length]; ctx.lineWidth = s.width || 1.6; ctx.setLineDash(s.dash || []);
    ctx.beginPath(); let pen = false;
    for (let i = 0; i < s.x.length; i++) { if (!isFinite(s.y[i])) { pen = false; continue; } if (!pen) { ctx.moveTo(X(s.x[i]), Y(s.y[i])); pen = true; } else ctx.lineTo(X(s.x[i]), Y(s.y[i])); }
    ctx.stroke(); ctx.setLineDash([]);
    if (s.points) { ctx.fillStyle = ctx.strokeStyle; for (let i = 0; i < s.x.length; i++) if (isFinite(s.y[i])) { ctx.beginPath(); ctx.arc(X(s.x[i]), Y(s.y[i]), 2.5, 0, 6.3); ctx.fill(); } }
  });
  ctx.fillStyle = text; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  if (opts.xlabel) ctx.fillText(opts.xlabel, L + (w - L - R) / 2, H - 2);
  if (opts.ylabel) { ctx.save(); ctx.translate(12, T + (H - T - B) / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'top'; ctx.fillText(opts.ylabel, 0, -6); ctx.restore(); }
  if (opts.title) { ctx.textBaseline = 'top'; ctx.font = '600 12px ' + cssVar('--font'); ctx.fillText(opts.title, w / 2, 4); }
  if (opts.legend !== false && series.length > 1) {
    ctx.font = '11px ' + cssVar('--font'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let ly = T + 6;
    series.forEach((s, si) => { if (!s.label) return; ctx.strokeStyle = s.color || palette[si % palette.length]; ctx.lineWidth = 2; ctx.setLineDash(s.dash || []); ctx.beginPath(); ctx.moveTo(w - R - 110, ly); ctx.lineTo(w - R - 92, ly); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = text; ctx.fillText(s.label, w - R - 88, ly); ly += 14; });
  }
  return { X, Y, xmin, xmax, ymin, ymax };
}

/** Horizontal tornado bars: rows [{label, lo, hi}], base value. */
function tornadoPlot(canvas, rows, base, opts) {
  opts = opts || {};
  const { ctx, w, h: H } = setupCanvas(canvas);
  const text = cssVar('--text'), muted = cssVar('--muted'), grid = cssVar('--grid'), panel = cssVar('--panel');
  ctx.fillStyle = panel; ctx.fillRect(0, 0, w, H);
  const L = 180, R = 20, T = 24, B = 24;
  let m = 0;
  for (const r of rows) m = Math.max(m, Math.abs(r.lo), Math.abs(r.hi));
  if (!(m > 0)) m = 1;
  const X = v => L + (v + m) / (2 * m) * (w - L - R);
  const rh = Math.min(22, (H - T - B) / Math.max(rows.length, 1));
  ctx.font = '11px ' + cssVar('--font');
  ctx.strokeStyle = grid;
  for (const t of ticks(-m, m, 5)) { ctx.beginPath(); ctx.moveTo(X(t), T); ctx.lineTo(X(t), H - B); ctx.stroke(); ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(String(t), X(t), H - B + 4); }
  ctx.strokeStyle = text; ctx.beginPath(); ctx.moveTo(X(0), T); ctx.lineTo(X(0), H - B); ctx.stroke();
  rows.forEach((r, i) => {
    const y = T + i * rh + 3;
    ctx.fillStyle = cssVar('--accent'); ctx.fillRect(Math.min(X(0), X(r.lo)), y, Math.abs(X(r.lo) - X(0)), rh - 6);
    ctx.fillStyle = cssVar('--warn'); ctx.fillRect(Math.min(X(0), X(r.hi)), y, Math.abs(X(r.hi) - X(0)), rh - 6);
    ctx.fillStyle = text; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(r.label, L - 6, y + (rh - 6) / 2);
  });
  ctx.fillStyle = text; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = '600 12px ' + cssVar('--font');
  ctx.fillText((opts.title || '') + ' (base ' + fmt(base, opts.digits === undefined ? 1 : opts.digits) + ' ' + (opts.unit || '') + ')', L + (w - L - R) / 2, 4);
  ctx.font = '10px ' + cssVar('--font'); ctx.fillStyle = muted; ctx.textAlign = 'left';
  ctx.fillText('blue: input at its low end, orange: at its high end; bar = change of the output', L, H - 12);
}

/** Legend strip for a scale. */
function drawLegend(canvas, scale) {
  const { ctx, w, h: H } = setupCanvas(canvas);
  for (let i = 0; i < w; i++) { ctx.fillStyle = scale.color(scale.min + (scale.max - scale.min) * i / (w - 1)); ctx.fillRect(i, 0, 1, H); }
}

/**
 * Draw a scalar grid (values at grid lines xs x ys, NaN = void) as filled cells
 * with bilinear colour interpolation, in world coordinates through transform.
 */
function drawGridField(ctx, xs, ys, grid, scale, X, Y, alpha) {
  const nx = xs.length, ny = ys.length;
  ctx.globalAlpha = alpha === undefined ? 0.85 : alpha;
  const sub = 2;
  for (let i = 0; i + 1 < nx; i++) for (let j = 0; j + 1 < ny; j++) {
    const v00 = grid[i * ny + j], v10 = grid[(i + 1) * ny + j], v01 = grid[i * ny + j + 1], v11 = grid[(i + 1) * ny + j + 1];
    if (!isFinite(v00) || !isFinite(v10) || !isFinite(v01) || !isFinite(v11)) continue;
    for (let a = 0; a < sub; a++) for (let b = 0; b < sub; b++) {
      const tx = (a + 0.5) / sub, ty = (b + 0.5) / sub;
      const v = (1 - tx) * (1 - ty) * v00 + tx * (1 - ty) * v10 + (1 - tx) * ty * v01 + tx * ty * v11;
      const x0 = xs[i] + (xs[i + 1] - xs[i]) * a / sub, x1 = xs[i] + (xs[i + 1] - xs[i]) * (a + 1) / sub;
      const y0 = ys[j] + (ys[j + 1] - ys[j]) * b / sub, y1 = ys[j] + (ys[j + 1] - ys[j]) * (b + 1) / sub;
      ctx.fillStyle = scale.color(v);
      const px = X(x0), py = Y(y1);
      ctx.fillRect(px, py, X(x1) - px + 0.7, Y(y0) - py + 0.7);
    }
  }
  ctx.globalAlpha = 1;
}

/** Contour lines by marching squares on a grid (values at nodes), levels array. */
function drawContours(ctx, xs, ys, grid, levels, X, Y, color) {
  const nx = xs.length, ny = ys.length;
  ctx.strokeStyle = color; ctx.lineWidth = 0.8;
  for (const lv of levels) {
    ctx.beginPath();
    for (let i = 0; i + 1 < nx; i++) for (let j = 0; j + 1 < ny; j++) {
      const v = [grid[i * ny + j], grid[(i + 1) * ny + j], grid[(i + 1) * ny + j + 1], grid[i * ny + j + 1]];
      if (v.some(q => !isFinite(q))) continue;
      const px = [xs[i], xs[i + 1], xs[i + 1], xs[i]], py = [ys[j], ys[j], ys[j + 1], ys[j + 1]];
      const pts = [];
      for (let e = 0; e < 4; e++) {
        const a = v[e], b = v[(e + 1) % 4];
        if ((a < lv) !== (b < lv)) { const t = (lv - a) / (b - a); pts.push([px[e] + t * (px[(e + 1) % 4] - px[e]), py[e] + t * (py[(e + 1) % 4] - py[e])]); }
      }
      if (pts.length >= 2) { ctx.moveTo(X(pts[0][0]), Y(pts[0][1])); ctx.lineTo(X(pts[1][0]), Y(pts[1][1])); if (pts.length === 4) { ctx.moveTo(X(pts[2][0]), Y(pts[2][1])); ctx.lineTo(X(pts[3][0]), Y(pts[3][1])); } }
    }
    ctx.stroke();
  }
}

/** Scatter of points coloured by value (bumps, balls). */
function drawPoints(ctx, xs, ys, vals, scale, X, Y, r) {
  for (let q = 0; q < xs.length; q++) { if (!isFinite(vals[q])) continue; ctx.fillStyle = scale.color(vals[q]); ctx.beginPath(); ctx.arc(X(xs[q]), Y(ys[q]), r, 0, 6.3); ctx.fill(); }
}
