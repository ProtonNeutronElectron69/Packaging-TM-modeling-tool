// ===== Verification suite (Section 14) =======================================

function linspace(a, b, n) { const o = []; for (let i = 0; i <= n; i++) o.push(a + (b - a) * i / n); return o; }

/** Isotropic test material record. */
function testMaterial(id, EGPa, nu, cte) {
  return { id, name: id, elastic: { type: 'iso', E: { type: 'const', E: { v: EGPa, u: 'GPa' } }, nu: { v: nu } }, cte: { type: 'const', a: { v: cte } } };
}

/** Box mesh model with homogeneous groups; assign(i,j,k) -> group index. */
function boxModel(lib, xs, ys, zs, groups, assign, tol) {
  const mesh = buildStructuredMesh(xs, ys, zs, groups, (i, j, k) => [{ group: assign(i, j, k), scale: 1, part: 0 }]);
  mesh.constraints = constraints321(mesh, 0.4 * Math.min((xs[xs.length - 1] - xs[0]) / 2, (ys[ys.length - 1] - ys[0]) / 2));
  const model = new FEModel(mesh, { materials: lib });
  const solver = new LinearSolver(model, { precond: 'mg', tol: tol || 1e-12 });
  return { mesh, model, solver };
}

/** One step of the thermal path from Ta to Tb (stage 0) on a box model: assemble, solve. Returns u. */
function boxStep(model, solver, Ta, Tb, label) {
  const rhs = new Float64Array(model.ndof);
  model.assembleStep(Ta, Tb, 0, rhs);
  return solver.solve(rhs, label).u;
}

/** Stress history states of every element of a box model after the steps [[Ta, Tb, du], ...]. */
function boxStates(model, steps) {
  const states = [];
  for (let e = 0; e < model.mesh.ne; e++) states.push(new Float64Array(model.stateSize(e)));
  for (const [Ta, Tb, du] of steps) {
    const rec = model.stepRecovery(Ta, Tb, 0);
    for (let e = 0; e < model.mesh.ne; e++) model.accumulateStep(e, rec, du, states[e]);
  }
  return states;
}

/** Quadratic fit curvature of a nodal w field over |x|,|y| <= half. */
function centreCurvature(mesh, u, k, half) {
  const xs = [], ys = [], ws = [];
  for (let i = 0; i < mesh.nx; i++) for (let j = 0; j < mesh.ny; j++) {
    const n = mesh.nodeId[(i * mesh.ny + j) * mesh.nz + k];
    if (n < 0 || Math.abs(mesh.xs[i]) > half + 1e-9 || Math.abs(mesh.ys[j]) > half + 1e-9) continue;
    xs.push(mesh.xs[i]); ys.push(mesh.ys[j]); ws.push(u[3 * n + 2]);
  }
  return fitCurvature(xs, ys, ws);
}

/** Classical lamination theory: free thermal curvature of a laminate (layers bottom to top). */
function cltCurvature(layers, dT) {
  const A = new Float64Array(9), B = new Float64Array(9), D = new Float64Array(9), NT = new Float64Array(3), MT = new Float64Array(3);
  let z0 = -layers.reduce((s, l) => s + l.t, 0) / 2;
  for (const L of layers) {
    const z1 = z0 + L.t;
    const nu21 = L.nu12 * L.E2 / L.E1, den = 1 - L.nu12 * nu21;
    const Q = [L.E1 / den, L.nu12 * L.E2 / den, 0, L.nu12 * L.E2 / den, L.E2 / den, 0, 0, 0, L.G12];
    const a = [L.a1, L.a2, 0];
    const h1 = z1 - z0, h2 = (z1 * z1 - z0 * z0) / 2, h3 = (z1 * z1 * z1 - z0 * z0 * z0) / 3;
    for (let q = 0; q < 9; q++) { A[q] += Q[q] * h1; B[q] += Q[q] * h2; D[q] += Q[q] * h3; }
    for (let i = 0; i < 3; i++) { let s = 0; for (let j = 0; j < 3; j++) s += Q[i * 3 + j] * a[j] * dT; NT[i] += s * h1; MT[i] += s * h2; }
    z0 = z1;
  }
  const M = new Float64Array(36), rhs = new Float64Array(6);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { M[i * 6 + j] = A[i * 3 + j]; M[i * 6 + 3 + j] = B[i * 3 + j]; M[(3 + i) * 6 + j] = B[i * 3 + j]; M[(3 + i) * 6 + 3 + j] = D[i * 3 + j]; }
  for (let i = 0; i < 3; i++) { rhs[i] = NT[i]; rhs[3 + i] = MT[i]; }
  const x = solveDense(M, 6, rhs);
  return { kx: x[3], ky: x[4], kxy: x[5] };
}

/** Run one global analysis with preview evaluations and return warpage and die stress. */
function quickCase(cfg, preset, extra) {
  const an = new Analysis(cfg, Object.assign({ preset, evaluations: 'preview' }, extra || {}));
  an.build(); an.run();
  const g = an.mesh.geom, u = an.fields.get(25);
  const w = warpageJEITA(an.mesh, g, u, cfg);
  const ds = dieSurfaceStress(an.view(25), g, 0, 'top');
  return { an, w, ds };
}

const VERIFICATION_TESTS = [
  {
    id: 'V1', name: 'Free thermal expansion of a block', slow: false,
    criterion: 'displacement to 1e-9 relative, stress below 1e-8 x E alpha dT',
    about: 'Heats a single block of one material evenly with nothing holding it. It should simply grow by its thermal expansion with no stress at all, which checks that thermal loads are applied correctly.',
    run(ctx) {
      const lib = [testMaterial('A', 130, 0.28, 2.6)];
      const { mesh, model, solver } = boxModel(lib, linspace(0, 10, 6), linspace(0, 8, 5), linspace(0, 2, 2), [{ name: 'A', kind: 'homog', mat: 'A', stage: 0, part: 0 }], () => 0, 1e-14);
      const u = boxStep(model, solver, 25, 125, 'V1');
      const n0 = mesh.constraints.nodes[0], a = 2.6e-6 * 100;
      let dispErr = 0;
      for (let n = 0; n < mesh.nn; n++) for (let c = 0; c < 3; c++) dispErr = Math.max(dispErr, Math.abs(u[3 * n + c] - a * (mesh.coords[3 * n + c] - mesh.coords[3 * n0 + c])));
      dispErr /= a * 10;
      const states = boxStates(model, [[25, 125, u]]);
      let smax = 0;
      for (let e = 0; e < mesh.ne; e++) { const o = model.stateStress(e, states[e], 0.3, -0.2, 0.5); for (let i = 0; i < 6; i++) smax = Math.max(smax, Math.abs(o.sig[i])); }
      const sRel = smax / (130000 * a);
      return { pass: dispErr < 1e-9 && sRel < 1e-8, measured: 'displacement error ' + dispErr.toExponential(2) + ' relative, stress ' + sRel.toExponential(2) + ' x E alpha dT' };
    },
  },
  {
    id: 'V2', name: 'Patch test, incompatible-mode hex on a distorted mesh', slow: false,
    criterion: 'exact to 1e-9 relative',
    about: 'Stretches a small mesh of deliberately skewed elements by a uniform amount. Every element must report exactly that uniform strain, which shows the element works even when it is not a perfect box.',
    run(ctx) {
      // 2x2x2 distorted mesh of a unit cube; prescribe u = A x on boundary nodes, solve interior node
      const D = isoD(100000, 0.3, 0.45);
      const X = new Float64Array(27 * 3);
      const dist = [0.15, -0.1, 0.12];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) {
        const n = (i * 3 + j) * 3 + k;
        X[3 * n] = i / 2; X[3 * n + 1] = j / 2; X[3 * n + 2] = k / 2;
        if (i === 1 && j === 1 && k === 1) { X[3 * n] += dist[0]; X[3 * n + 1] += dist[1]; X[3 * n + 2] += dist[2]; }
        // also distort mid-face / mid-edge nodes slightly (keep them on their faces)
        if (i === 1 && j === 1 && k !== 1) { X[3 * n] += 0.08; X[3 * n + 1] -= 0.05; }
        if (i === 1 && k === 1 && j !== 1) { X[3 * n] -= 0.06; X[3 * n + 2] += 0.07; }
        if (j === 1 && k === 1 && i !== 1) { X[3 * n + 1] += 0.09; X[3 * n + 2] -= 0.04; }
      }
      const Amat = [1e-3, 2e-4, -3e-4, 5e-4, -2e-3, 4e-4, -1e-4, 3e-4, 1.5e-3];
      const exact = n => [Amat[0] * X[3 * n] + Amat[1] * X[3 * n + 1] + Amat[2] * X[3 * n + 2], Amat[3] * X[3 * n] + Amat[4] * X[3 * n + 1] + Amat[5] * X[3 * n + 2], Amat[6] * X[3 * n] + Amat[7] * X[3 * n + 1] + Amat[8] * X[3 * n + 2]];
      const K = new Float64Array(81 * 81);
      const loc = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
      const recs = [];
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
        const nodes = loc.map(l => ((i + l[0]) * 3 + j + l[1]) * 3 + k + l[2]);
        const Xe = new Float64Array(24);
        nodes.forEach((n, a) => { Xe[3 * a] = X[3 * n]; Xe[3 * a + 1] = X[3 * n + 1]; Xe[3 * a + 2] = X[3 * n + 2]; });
        const rec = generalElement(Xe, D, null);
        recs.push({ nodes, Xe, X: Float64Array.from(rec.X) });
        for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) K[(3 * nodes[a] + p) * 81 + 3 * nodes[b] + q] += rec.Kc[(3 * a + p) * 24 + 3 * b + q];
      }
      const centre = 13; // (1,1,1)
      const free = [3 * centre, 3 * centre + 1, 3 * centre + 2];
      const Kff = new Float64Array(9), rhs = new Float64Array(3);
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) Kff[a * 3 + b] = K[free[a] * 81 + free[b]];
        let s = 0;
        for (let n = 0; n < 27; n++) { if (n === centre) continue; const ue = exact(n); for (let q = 0; q < 3; q++) s -= K[free[a] * 81 + 3 * n + q] * ue[q]; }
        rhs[a] = s;
      }
      const uc = solveDense(Kff, 3, rhs);
      const ex = exact(centre);
      let err = 0;
      for (let c = 0; c < 3; c++) err = Math.max(err, Math.abs(uc[c] - ex[c]));
      const scale = Math.max(...Amat.map(Math.abs));
      err /= scale;
      // constant strain check in every element
      const ufull = new Float64Array(81);
      for (let n = 0; n < 27; n++) { const ue = n === centre ? uc : exact(n); for (let c = 0; c < 3; c++) ufull[3 * n + c] = ue[c]; }
      const epsExact = [Amat[0], Amat[4], Amat[8], Amat[1] + Amat[3], Amat[5] + Amat[7], Amat[2] + Amat[6]];
      let serr = 0;
      for (const r of recs) {
        const ue = new Float64Array(24);
        r.nodes.forEach((n, a) => { for (let c = 0; c < 3; c++) ue[3 * a + c] = ufull[3 * n + c]; });
        const alpha = new Float64Array(9);
        for (let i = 0; i < 9; i++) { let s = 0; for (let j = 0; j < 24; j++) s -= r.X[i * 24 + j] * ue[j]; alpha[i] = s; }
        for (const pt of [[0.3, -0.5, 0.7], [-0.8, 0.2, -0.1]]) {
          const e = generalStrainAt(r.Xe, ue, alpha, pt[0], pt[1], pt[2]);
          for (let c = 0; c < 6; c++) serr = Math.max(serr, Math.abs(e[c] - epsExact[c]) / scale);
        }
      }
      const m = Math.max(err, serr);
      return { pass: m < 1e-9, measured: 'displacement error ' + err.toExponential(2) + ', strain error ' + serr.toExponential(2) + ' (relative)' };
    },
  },
  {
    id: 'V3', name: 'Bimaterial plate curvature versus Timoshenko', slow: false,
    criterion: 'center curvature within 3 % of Timoshenko',
    about: 'Bonds two plates with different expansion coefficients and cools them, so the pair curls like a bimetal strip. The computed curvature is compared with Timoshenko\'s textbook formula.',
    run(ctx) {
      const lib = [testMaterial('A', 130, 0.28, 2.6), testMaterial('B', 110, 0.34, 16.4)];
      const n = 28;
      const { mesh, model, solver } = boxModel(lib, linspace(-20, 20, n), linspace(-20, 20, n), [0, 0.25, 0.5, 0.75, 1.0], [{ name: 'B', kind: 'homog', mat: 'B', stage: 0, part: 0 }, { name: 'A', kind: 'homog', mat: 'A', stage: 0, part: 1 }], (i, j, k) => k < 2 ? 0 : 1, 1e-10);
      const u = boxStep(model, solver, 25, -75, 'V3');
      const c = centreCurvature(mesh, u, 0, 5);
      const kappa = -c.kxx;
      const MA = 130000 / (1 - 0.28), MB = 110000 / (1 - 0.34);
      const m = 1, nn = MA / MB, h = 1, da = (2.6 - 16.4) * 1e-6, dT = -100;
      const kt = 6 * da * dT * (1 + m) ** 2 / (h * (3 * (1 + m) ** 2 + (1 + m * nn) * (m * m + 1 / (m * nn))));
      const err = Math.abs(kappa / kt - 1);
      return { pass: err < 0.03, measured: 'FE curvature ' + kappa.toExponential(4) + ' 1/mm, Timoshenko ' + kt.toExponential(4) + ' 1/mm, error ' + (100 * err).toFixed(2) + ' %' };
    },
  },
  {
    id: 'V4', name: 'Asymmetric three-layer laminate versus classical lamination theory', slow: false,
    criterion: 'curvatures within 3 % of classical lamination theory',
    about: 'Builds an unbalanced three-layer stack, one layer stiffer in one direction than the other, and lets it warp on cooling. The curvature is compared with an independent laminate theory calculation.',
    run(ctx) {
      const ortho = { id: 'O', name: 'O', elastic: { type: 'ortho', Ex: { v: 36, u: 'GPa' }, Ey: { v: 20, u: 'GPa' }, Ez: { v: 12, u: 'GPa' }, Gxy: { v: 8, u: 'GPa' }, Gxz: { v: 5, u: 'GPa' }, Gyz: { v: 5, u: 'GPa' }, nuxy: { v: 0.15 }, nuxz: { v: 0.3 }, nuyz: { v: 0.3 } }, cteXY: { type: 'const', a: { v: 4 } }, cteZ: { type: 'const', a: { v: 12 } } };
      // orthotropic in-plane alphas differ: emulate via two CTE definitions is not supported, so use equal alpha x,y = 4 and an isotropic Cu + Si layer
      const lib = [ortho, testMaterial('Cu', 110, 0.34, 16.4), testMaterial('Si', 130, 0.28, 2.6)];
      const zs = [0, 0.15, 0.3, 0.4, 0.5, 0.75, 1.0];
      const n = 28;
      const { mesh, model, solver } = boxModel(lib, linspace(-20, 20, n), linspace(-20, 20, n), zs, [{ name: 'O', kind: 'homog', mat: 'O', stage: 0, part: 0 }, { name: 'Cu', kind: 'homog', mat: 'Cu', stage: 0, part: 1 }, { name: 'Si', kind: 'homog', mat: 'Si', stage: 0, part: 2 }], (i, j, k) => k < 2 ? 0 : (k < 4 ? 1 : 2), 1e-10);
      const u = boxStep(model, solver, 25, -75, 'V4');
      const c = centreCurvature(mesh, u, 0, 5);
      const clt = cltCurvature([
        { t: 0.3, E1: 36000, E2: 20000, nu12: 0.15, G12: 8000, a1: 4e-6, a2: 4e-6 },
        { t: 0.2, E1: 110000, E2: 110000, nu12: 0.34, G12: 110000 / 2.68, a1: 16.4e-6, a2: 16.4e-6 },
        { t: 0.5, E1: 130000, E2: 130000, nu12: 0.28, G12: 130000 / 2.56, a1: 2.6e-6, a2: 2.6e-6 },
      ], -100);
      const ex = Math.abs(-c.kxx / clt.kx - 1), ey = Math.abs(-c.kyy / clt.ky - 1);
      return { pass: ex < 0.03 && ey < 0.03, measured: 'kx FE ' + (-c.kxx).toExponential(4) + ' vs CLT ' + clt.kx.toExponential(4) + ' (' + (100 * ex).toFixed(2) + ' %), ky FE ' + (-c.kyy).toExponential(4) + ' vs CLT ' + clt.ky.toExponential(4) + ' (' + (100 * ey).toFixed(2) + ' %)' };
    },
  },
  {
    id: 'V5', name: 'Layered-integration element versus one element per physical layer', slow: false,
    criterion: 'center warpage within 1 %',
    about: 'Models the same thin multilayer stack two ways: layers merged into one element with layer-by-layer integration (as the tool does for the substrate) and one element per real layer. Both must warp the same, which justifies the shortcut.',
    run(ctx) {
      const cfg = defaultConfig(ctx.db);
      // asymmetric substrate: remove the bottom build-up so the free substrate warps
      const layers = cfg.substrate.layers;
      const coreIdx = layers.findIndex(r => r.type === 'core');
      const asym = layers.slice(0, coreIdx + 2).concat([layers[layers.length - 1]]);
      const sb = substrateBands(asym);
      const lib = cfg.materials;
      const xs = linspace(-10, 10, 16), ys = linspace(-10, 10, 16);
      const run = (zs, groups, assign) => {
        const { mesh, model, solver } = boxModel(lib, xs, ys, zs, groups, assign, 1e-10);
        model.sections = sb.bands.map(b => buildBandSection(b, lib, CONST.NU_MAX_GLOBAL));
        mesh.subBand = new Int32Array(zs.length - 1);
        for (let k = 0; k + 1 < zs.length; k++) { const zc = 0.5 * (zs[k] + zs[k + 1]); mesh.subBand[k] = sb.bands.findIndex(b => zc > b.z0 && zc < b.z1); }
        const u = boxStep(model, solver, 25, 125, 'V5');
        const c = centreCurvature(mesh, u, 0, 5);
        const w = warpageOfGrid(mesh, u);
        return { kxx: c.kxx, w, dof: model.ndof };
      };
      const warpageOfGrid = (mesh, u) => { const g = planeGrid(mesh, u, 0, 2); const xs2 = [], ys2 = [], ws = []; for (let i = 0; i < mesh.nx; i++) for (let j = 0; j < mesh.ny; j++) { xs2.push(mesh.xs[i]); ys2.push(mesh.ys[j]); ws.push(g[i * mesh.ny + j]); } const pl = fitPlane(xs2, ys2, ws); let mn = Infinity, mx = -Infinity; ws.forEach((w, q) => { const r = w - pl.c0 - pl.c1 * xs2[q] - pl.c2 * ys2[q]; mn = Math.min(mn, r); mx = Math.max(mx, r); }); return mx - mn; };
      const a = run(sb.planes, [{ name: 'sub', kind: 'layered', stage: 0, part: 0 }], () => 0);
      const zsAll = [0]; const groupsB = []; const rowOfLayer = [];
      for (const r of sb.rows) { zsAll.push(r.z1); groupsB.push({ name: 'row' + r.idx, kind: 'rowmat', row: r.row, stage: 0, part: 0 }); rowOfLayer.push(groupsB.length - 1); }
      const b = run(zsAll, groupsB, (i, j, k) => rowOfLayer[k]);
      const err = Math.abs(a.w / b.w - 1);
      return { pass: err < 0.01, measured: 'centre warpage layered ' + (a.w * 1000).toFixed(3) + ' µm (' + a.dof + ' DOF) vs per-layer ' + (b.w * 1000).toFixed(3) + ' µm (' + b.dof + ' DOF), difference ' + (100 * err).toFixed(3) + ' %' };
    },
  },
  {
    id: 'V6', name: 'Anand material point versus closed-form saturation stress', slow: false,
    criterion: 'each saturation stress within 1 % (42.1, 22.8, 13.0 MPa)',
    about: 'Pulls a single point of SAC305 solder at a constant rate until its stress levels off. The levelled-off stress must match the exact formula of the Anand creep model at three temperatures and rates.',
    run(ctx) {
      const sac = findMaterial(buildMaterialLibrary(ctx.db), 'sac305');
      const cases = [[25, 1e-3, 42.1], [125, 1e-3, 22.8], [125, 1e-5, 13.0]];
      const rows = cases.map(([T, rate, ref]) => { const r = anandUniaxial(sac, T, rate, 0.05, 400); const cf = anandSaturationStress(sac, T, rate); return { T, rate, sim: r.sigFinal, cf, ref, err: Math.abs(r.sigFinal / cf - 1), errRef: Math.abs(r.sigFinal / ref - 1) }; });
      const pass = rows.every(r => r.err < 0.01 && r.errRef < 0.01);
      return { pass, measured: rows.map(r => r.T + ' °C, ' + r.rate + ' 1/s: ' + r.sim.toFixed(2) + ' MPa (closed form ' + r.cf.toFixed(2) + ', reference ' + r.ref + ')').join('; ') };
    },
  },
  {
    id: 'V7', name: 'Submodel consistency with homogenized bump-layer properties', slow: true,
    criterion: 'submodel strains within 2 % of the global strains',
    about: 'Runs the detailed bump submodel with the same smeared bump-layer properties as the global model. It must then reproduce the global strains at that bump, which checks that the two models are linked correctly.',
    run(ctx) {
      // Both models are incremental from the as-assembled 25 degC state, so the strain change 25 -> 125 degC
      // of the global bump layer at the site must be reproduced by a submodel made of the same homogenized layer.
      const cfg = presetConfig(ctx.db, 'bare');
      const an = new Analysis(cfg, { preset: 'draft', evaluations: 'preview' });
      an.build();
      an.evaluationTemperatures = () => ({ all: [25, 125], cycling: [25, 125], reflow: [25, 125] });
      an.run();
      const g = an.mesh.geom, d = g.dies[0];
      const sites = dieBumpSites(d);
      // a bump well inside the field, nearest to the centre of a global bump-layer element (where the
      // incompatible modes do not contribute to the strain, so the trilinear boundary data are exact)
      const mesh = an.mesh, model = an.model, zmid = g.zt + 0.5 * g.so, kb = findInterval(mesh.zs, zmid);
      let q = 0, best = Infinity;
      for (let s = 0; s < sites.x.length; s++) {
        if (Math.abs(sites.x[s] - d.cx) > d.w / 3 || Math.abs(sites.y[s] - d.cy) > d.h / 3) continue;
        const i = findInterval(mesh.xs, sites.x[s]), j = findInterval(mesh.ys, sites.y[s]);
        const dd = Math.hypot(sites.x[s] - 0.5 * (mesh.xs[i] + mesh.xs[i + 1]), sites.y[s] - 0.5 * (mesh.ys[j] + mesh.ys[j + 1]));
        if (dd < best) { best = dd; q = s; }
      }
      const site = { x: sites.x[q], y: sites.y[q], ix: sites.ix[q], iy: sites.iy[q] };
      // global strain change 25 -> 125 degC at the site (nodal plus incompatible-mode contributions)
      const e = elementInCell(mesh, findInterval(mesh.xs, site.x), findInterval(mesh.ys, site.y), kb, PART.SOLDER);
      const eA = new Float64Array(6), eB = new Float64Array(6);
      const [hx, hy, hz] = model.elementDims(e);
      const [xi, eta, zeta] = naturalCoords(mesh, e, site.x, site.y, zmid);
      const qs = an.qAlong(e, [25, 125]), q25 = qs.get(25), q125 = qs.get(125);
      boxStrainAt(hx, hy, hz, q25, q25.subarray(24), xi, eta, zeta, eA);
      boxStrainAt(hx, hy, hz, q125, q125.subarray(24), xi, eta, zeta, eB);
      const dEps = Array.from(eB, (v, c) => v - eA[c]);
      const scale = Math.max(...dEps.map(Math.abs));
      // the submodel follows the global steps of the up branch (same step means of the stiffness)
      const upTemps = an.path.up.map(k => an.path.steps[k].Tb);
      const march = sm => { let r = null; for (const T of upTemps) { r = sm.stepTo(T, 1); if (!r.converged) break; } return r; };
      // submodel strain at the voxel nearest the site centre, mid-height of the bump layer
      const subStrain = sm => {
        const m = sm.mesh;
        const ec = elementInCell(m, Math.floor((m.nx - 1) / 2), Math.floor((m.ny - 1) / 2), findInterval(m.zs, zmid), null);
        const Bb = new Float64Array(144), ue = new Float64Array(24), es = new Float64Array(6);
        const i = m.eIJK[3 * ec], j = m.eIJK[3 * ec + 1], k = m.eIJK[3 * ec + 2];
        bbarMatrix(m.xs[i + 1] - m.xs[i], m.ys[j + 1] - m.ys[j], m.zs[k + 1] - m.zs[k], 0, 0, 0, Bb);
        for (let a = 0; a < 8; a++) { const n = m.conn[8 * ec + a]; for (let c = 0; c < 3; c++) ue[3 * a + c] = sm.u[3 * n + c]; }
        for (let r = 0; r < 6; r++) { let s2 = 0; for (let c = 0; c < 24; c++) s2 += Bb[r * 24 + c] * ue[c]; es[r] = s2; }
        return es;
      };
      const errOf = es => { let err = 0; for (let c = 0; c < 6; c++) err = Math.max(err, Math.abs(es[c] - dEps[c]) / scale); return err; };
      // (a) the consistency case: domain = the bump layer, every voxel = the homogenized bump-layer phases, solder elastic
      const smA = new BumpSubmodel(an, 0, site, { nxy: 8, nz: 8, elasticSolder: true, uniformMaterial: true, layerOnly: true });
      const resA = march(smA);
      const esA = subStrain(smA), errA = errOf(esA);
      // (b) information: the production domain (50 um into Si and substrate) with materially consistent slices
      const smB = new BumpSubmodel(an, 0, site, { nxy: 8, nz: 8, elasticSolder: true, uniformMaterial: true });
      march(smB);
      const errB = errOf(subStrain(smB));
      const f = v => v.toExponential(3);
      return { pass: errA < 0.02 && resA.converged, measured: 'global strain change [xx, yy, zz, xy, yz, zx] ' + dEps.map(f).join(', ') + '; submodel (bump-layer domain, uniform homogenized phases) ' + Array.from(esA).map(f).join(', ') + ': max error ' + (100 * errA).toFixed(2) + ' % of the largest component; with the production domain and materially consistent Si / substrate slices the difference is ' + (100 * errB).toFixed(2) + ' % (coarse single-element layers versus the refined submodel)' };
    },
  },
  {
    id: 'V8', name: 'Symmetry of the warpage field', slow: true,
    criterion: 'symmetry and mirroring to 1e-6 relative',
    about: 'Places one die at the package center; the warpage must be identical when mirrored left to right, top to bottom and across both diagonals, and mirroring the floorplan must mirror the results.',
    run(ctx) {
      const cfg = presetConfig(ctx.db, 'bare');
      const run = c => { const an = new Analysis(c, { preset: 'draft', evaluations: 'preview' }); an.build(); an.solver.opts.tol = 1e-12; an.run(); return { an, w: warpageJEITA(an.mesh, an.mesh.geom, an.fields.get(25), c) }; };
      const a = run(cfg);
      const m = a.an.mesh, g = a.w.grid, nx = m.nx, ny = m.ny;
      let ex = 0, ey = 0, ed = 0, scale = a.w.mag;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const v = g[i * ny + j];
        ex = Math.max(ex, Math.abs(v - g[(nx - 1 - i) * ny + j]));
        ey = Math.max(ey, Math.abs(v - g[i * ny + (ny - 1 - j)]));
        if (nx === ny) ed = Math.max(ed, Math.abs(v - g[j * ny + i]));
      }
      // mirrored floorplan
      const c1 = presetConfig(ctx.db, 'offset'), c2 = presetConfig(ctx.db, 'offset');
      c2.dies[0].x = -c2.dies[0].x;
      const b1 = run(c1), b2 = run(c2);
      let em = 0;
      const m1 = b1.an.mesh, g1 = b1.w.grid, g2 = b2.w.grid;
      for (let i = 0; i < m1.nx; i++) for (let j = 0; j < m1.ny; j++) em = Math.max(em, Math.abs(g1[i * m1.ny + j] - g2[(m1.nx - 1 - i) * m1.ny + j]));
      const rel = Math.max(ex, ey, ed) / scale, relm = em / b1.w.mag;
      return { pass: rel < 1e-6 && relm < 1e-6, measured: 'centred die: x ' + (ex / scale).toExponential(2) + ', y ' + (ey / scale).toExponential(2) + ', diagonal ' + (ed / scale).toExponential(2) + '; mirrored floorplan ' + relm.toExponential(2) + ' (relative to warpage magnitude)' };
    },
  },
  {
    id: 'V9', name: 'Physical sanity on the presets', slow: true,
    criterion: 'all four hold',
    about: 'Checks four common-sense trends: a bare-die package bows convex at room temperature, the die backside is in tension, a thicker core warps less, and a lower-expansion core warps less.',
    run(ctx) {
      const bare = quickCase(presetConfig(ctx.db, 'bare'), 'draft');
      const A = quickCase(presetConfig(ctx.db, 'coreStudy', 'A'), 'draft'), B = quickCase(presetConfig(ctx.db, 'coreStudy', 'B'), 'draft');
      const c705 = presetConfig(ctx.db, 'bare'), cLH = presetConfig(ctx.db, 'bare');
      for (const r of c705.substrate.layers) if (r.type === 'core') r.mat = 'mcl_e_705g';
      for (const r of cLH.substrate.layers) if (r.type === 'core') r.mat = 'mcl_e_795g_lh';
      const w705 = quickCase(c705, 'draft'), wLH = quickCase(cLH, 'draft');
      const checks = [
        { name: 'bare-die RT warpage convex (positive)', ok: bare.w.signed > 0, value: (bare.w.signed * 1000).toFixed(1) + ' µm' },
        { name: 'die backside interior stress tensile', ok: bare.ds.peakInterior > 0, value: bare.ds.peakInterior.toFixed(1) + ' MPa' },
        { name: '0.8 mm core warps less than 0.4 mm core', ok: Math.abs(B.w.signed) < Math.abs(A.w.signed), value: (A.w.signed * 1000).toFixed(1) + ' µm (0.4 mm) vs ' + (B.w.signed * 1000).toFixed(1) + ' µm (0.8 mm)' },
        { name: '795G Type LH core warps less than 705G', ok: Math.abs(wLH.w.signed) < Math.abs(w705.w.signed), value: (w705.w.signed * 1000).toFixed(1) + ' µm (705G) vs ' + (wLH.w.signed * 1000).toFixed(1) + ' µm (795G LH)' },
      ];
      return { pass: checks.every(c => c.ok), measured: checks.map(c => c.name + ': ' + c.value + (c.ok ? ' ✓' : ' ✗')).join('; ') };
    },
  },
  {
    id: 'V10', name: 'Mesh convergence, Standard versus Fine', slow: true, verySlow: true,
    criterion: 'RT warpage and die interior peak stress within 5 %',
    about: 'Runs the default package on the Standard and the Fine mesh. Warpage and die stress should change by less than 5 %, showing the Standard mesh is fine enough for comparisons.',
    run(ctx) {
      const s = quickCase(presetConfig(ctx.db, 'default'), 'standard'), f = quickCase(presetConfig(ctx.db, 'default'), 'fine');
      const ew = Math.abs(s.w.signed / f.w.signed - 1), es = Math.abs(s.ds.peakInterior / f.ds.peakInterior - 1);
      return { pass: ew < 0.05 && es < 0.05, measured: 'RT warpage ' + (s.w.signed * 1000).toFixed(1) + ' vs ' + (f.w.signed * 1000).toFixed(1) + ' µm (' + (100 * ew).toFixed(2) + ' %); die interior peak ' + s.ds.peakInterior.toFixed(1) + ' vs ' + f.ds.peakInterior.toFixed(1) + ' MPa (' + (100 * es).toFixed(2) + ' %); DOF ' + s.an.mesh.info.nDof + ' vs ' + f.an.mesh.info.nDof };
    },
  },
  {
    id: 'V11', name: 'Solver integrity on the default package', slow: true,
    criterion: 'relative residual below 1e-8; reactions below 1e-9 of the internal force scale',
    about: 'Solves the default package and confirms that the equation solver really converged and that the three support points carry essentially no force, as they should for a free package.',
    run(ctx) {
      const cfg = presetConfig(ctx.db, 'default');
      const an = new Analysis(cfg, { preset: 'draft', evaluations: 'preview' });
      an.build();
      an.solver.opts.tol = 1e-10; // the reaction criterion (1e-9) needs a tighter residual than the production 1e-8
      an.run();
      // the last step of the process chain (to 25 degC): its log record, then its displacement increment in double
      // precision (a re-solve that starts from the stored solution) and the unconstrained system of that step
      const k = an.path.chain[an.path.chain.length - 1], step = an.path.steps[k];
      const rec = an.log.find(r => r.label === stepLabel(step));
      const u = an.solveStep(k).u, model = an.model;
      const f = new Float64Array(model.ndof);
      model.assembleStep(step.Ta, step.Tb, step.stage, f, true);
      const Ku = new Float64Array(model.ndof);
      fullMatVec(model.pattern, model.val, u, Ku);
      let fscale = 0, reac = 0;
      for (let q = 0; q < model.ndof; q++) fscale = Math.max(fscale, Math.abs(Ku[q]), Math.abs(f[q]));
      for (const d of model.constraints) reac = Math.max(reac, Math.abs(Ku[d] - f[d]));
      const uKu = dot(u, Ku), fu = dot(f, u);
      const eb = Math.abs(uKu - fu) / Math.abs(fu);
      const pass = rec.relres < 1e-8 && reac / fscale < 1e-9;
      return { pass, measured: 'last process step ' + stepLabel(step) + ': relative residual ' + rec.relres.toExponential(2) + ' (' + rec.iters + ' iterations, ' + rec.precond + ', solved to 1e-10); max reaction ' + (reac / fscale).toExponential(2) + ' of the internal force scale (max entry of K u and f); energy balance |uKu - fu| / |fu| = ' + eb.toExponential(2) };
    },
  },
  {
    id: 'V12', name: 'JEITA sign and magnitude on synthetic surfaces', slow: false,
    criterion: 'exact sign, magnitude to 1e-9',
    about: 'Feeds the warpage calculation made-up dome and bowl shapes with known answers. It must give a positive sign for the dome, a negative sign for the bowl, and the exact peak-to-valley height.',
    run(ctx) {
      const cfg = presetConfig(ctx.db, 'bare');
      const mesh = buildPackageMesh(cfg, { preset: 'draft' });
      const g = mesh.geom;
      const L = 30, c = 0.1;
      const dome = sign => (x, y) => sign * c * (1 - (x / L) ** 2 - (y / L) ** 2);
      const field = sign => { const u = new Float64Array(3 * mesh.nn); for (let n = 0; n < mesh.nn; n++) u[3 * n + 2] = dome(sign)(mesh.coords[3 * n], mesh.coords[3 * n + 1]); return u; };
      // the synthetic surface is sampled exactly at the ball sites (a quadratic is not reproduced by bilinear nodal interpolation)
      const wp = warpageJEITA(mesh, g, field(1), cfg, dome(1)), wm = warpageJEITA(mesh, g, field(-1), cfg, dome(-1));
      // analytic magnitude: the best-fit plane of a dome over the symmetric ball grid is horizontal, so the
      // magnitude is the dome value at the ball nearest the centre minus the value at the farthest corner ball
      let rmin = Infinity, rmax = -Infinity;
      for (let q = 0; q < g.bga.x.length; q++) { const r2 = g.bga.x[q] ** 2 + g.bga.y[q] ** 2; rmin = Math.min(rmin, r2); rmax = Math.max(rmax, r2); }
      const an = c * (rmax - rmin) / (L * L);
      const em = Math.abs(wp.mag - an) / an;
      const pass = wp.sign === 1 && wm.sign === -1 && em < 1e-9 && Math.abs(wm.mag - an) / an < 1e-9;
      return { pass, measured: 'dome sign ' + wp.sign + ', magnitude ' + wp.mag.toExponential(10) + ' vs analytic ' + an.toExponential(10) + ' (error ' + em.toExponential(2) + '); inverted dome sign ' + wm.sign };
    },
  },
  {
    id: 'V13', name: 'Unit checks', slow: false,
    criterion: 'formula values exact to 1e-9; rounded references to their printed precision',
    about: 'Compares individual material formulas with hand-calculated values: silicon expansion and stiffness, solder modulus, AlSiC expansion, and the mixing rules for patterned copper layers.',
    run(ctx) {
      const lib = buildMaterialLibrary(ctx.db);
      const si = findMaterial(lib, 'si');
      const checks = [];
      const push = (name, value, ref, tol) => checks.push({ name, value, ref, ok: Math.abs(value - ref) <= tol * Math.max(Math.abs(ref), 1e-30) });
      const siA = T => { const TK = T + 273.15; return (3.725 * (1 - Math.exp(-5.88e-3 * (TK - 124))) + 5.548e-4 * TK) * 1e-6; };
      push('Si CTE at 25 °C (formula)', cteAlpha(si.cte, 25), siA(25), 1e-9);
      push('Si CTE at 125 °C (formula)', cteAlpha(si.cte, 125), siA(125), 1e-9);
      push('Si CTE at 25 °C vs 2.553 ppm/K (rounded reference)', cteAlpha(si.cte, 25) * 1e6, 2.553, 2.5e-4);
      push('Si CTE at 125 °C vs 3.203 ppm/K (rounded reference)', cteAlpha(si.cte, 125) * 1e6, 3.203, 2.5e-4);
      const D = siliconD(si, 'aniso');
      push('Si modulus along die edge <110> vs 169 GPa', directionalModulus(D, [1, 0, 0]) / 1000, 169, 1e-3);
      push('Si modulus along diagonal <100> vs 130 GPa', directionalModulus(D, [Math.SQRT1_2, Math.SQRT1_2, 0]) / 1000, 130, 1.1e-3);
      push('SAC305 E at 25 °C', isoE(findMaterial(lib, 'sac305'), 25) / 1000, 46.5, 1e-9);
      const al = findMaterial(lib, 'alsic9');
      push('AlSiC-9 thermal strain 30 to 150 °C', thermalStrain(al.cte, 150) - thermalStrain(al.cte, 30), 8.37e-6 * 120, 1e-9);
      const cu = isoEC(110000, 0.34, 16.4e-6), d = isoEC(10000, 0.30, 20e-6);
      const mix = mixCuEC(cu, d, 0.5, 'signal');
      push('Turner CTE (r = 0.5)', mix.ax, (0.5 * 110000 * 16.4e-6 + 0.5 * 10000 * 20e-6) / (0.5 * 110000 + 0.5 * 10000), 1e-9);
      push('Voigt E_z (r = 0.5)', mix.Ez, 0.5 * 110000 + 0.5 * 10000, 1e-9);
      push('Signal-layer in-plane E (mean of Voigt and Reuss)', mix.Ex, 0.5 * (60000 + 1 / (0.5 / 110000 + 0.5 / 10000)), 1e-9);
      return { pass: checks.every(c => c.ok), measured: checks.map(c => c.name + ': ' + (typeof c.value === 'number' ? c.value.toPrecision(7) : c.value) + (c.ok ? ' ✓' : ' ✗ (ref ' + c.ref + ')')).join('; ') };
    },
  },
  {
    id: 'V14', name: 'Configuration save / load round trip', slow: false,
    criterion: 'identical configuration hash (with and without stacked modules); a file from before stacked modules keeps its geometry and process hashes',
    about: 'Saves a configuration to a JSON file and loads it back, once with monolithic dies and once with stacked modules. Nothing may change, confirmed by an identical configuration fingerprint (hash). A file saved before stacked modules existed must load with the same geometry and process fingerprints.',
    run(ctx) {
      const cfg = presetConfig(ctx.db, 'stiffener2');
      cfg.dies[1].x += 0.123456789;
      findMaterial(cfg.materials, 'abf_gl').cte.a1.v = 21.5;
      const h1 = configHashes(cfg).all;
      const back = parseConfig(serializeConfig(cfg));
      const h2 = configHashes(back).all;
      // stacked modules round trip too
      const mx = presetConfig(ctx.db, 'mixed');
      mx.modules[1].chiplets[0].x += 0.0123456789; mx.stack.wcuf.Wf = 0.271828; mx.modules[0].rdl[1].r = 0.4321;
      const m1 = configHashes(mx).all, m2 = configHashes(parseConfig(serializeConfig(mx))).all;
      // a file from before stacked modules (no modules or stack) loads with unchanged geometry and process hashes
      const old = presetConfig(ctx.db, 'default'), ho = configHashes(old);
      delete old.modules; delete old.stack;
      const hn = configHashes(parseConfig(serializeConfig(old), ctx.db));
      const compat = ho.geometry === hn.geometry && ho.process === hn.process;
      return { pass: h1 === h2 && m1 === m2 && compat, measured: 'hash before ' + h1 + ', after ' + h2 + '; stacked modules ' + m1 + ', after ' + m2 + '; configuration without modules: geometry and process hashes ' + (compat ? 'unchanged' : 'changed') };
    },
  },
  {
    id: 'V15', name: 'Timing benchmark of the default package per preset and preconditioner', slow: true, verySlow: true,
    criterion: 'report only; compare with the performance targets',
    about: 'Times the default package on each mesh preset with both solver preconditioners: the whole process chain with multigrid, and its first step with IC(0), which no longer converges on these meshes and would spend its full iteration budget on every step. It always passes and reports the speeds against the performance targets.',
    run(ctx) {
      const rows = [];
      for (const preset of ctx.presets || ['draft', 'standard']) for (const pc of ['mg', 'ic']) {
        const cfg = presetConfig(ctx.db, 'default');
        const t0 = nowMs();
        const an = new Analysis(cfg, { preset, evaluations: 'preview', precond: pc });
        an.build();
        if (pc === 'mg') an.run(); else { an.buildPath(); an.solveStep(0); }
        const r0 = an.log[0];
        rows.push({ preset, pc, dof: an.mesh.info.nDof, ms: nowMs() - t0, solves: an.log.length, iters: an.log.map(r => r.iters), fallback: r0.fallback, solveMs: an.timings.solve, assembleMs: an.timings.assemble });
      }
      const text = r => r.preset + '/' + r.pc + ': ' + r.dof + ' DOF, ' + (r.ms / 1000).toFixed(1) + ' s ' + (r.pc === 'mg'
        ? 'for the process chain to 25 °C (' + r.solves + ' solves, iterations ' + r.iters.join('/') + ')'
        : 'for the first chain step (' + (r.fallback ? 'IC(0) not converged after ' + r.fallback.iters + ' iterations, relative residual ' + r.fallback.relres.toExponential(1) + ', then the multigrid fallback, ' + (r.iters[0] - r.fallback.iters) + ' iterations' : 'IC(0) converged in ' + r.iters[0] + ' iterations') + ')');
      return { pass: true, measured: rows.map(text).join('; '), rows };
    },
  },
  {
    id: 'V16', name: 'Stress through a glass transition, incremental thermoelasticity', slow: false,
    criterion: 'free block stress below 1e-8 x E alpha dT; laterally held block within 0.1 % of -integral E / (1 - nu) alpha dT',
    about: 'Cools a block of underfill from its cure temperature through its glass transition along the thermal path the tool uses. Left free it must stay stress-free; held at its sides its in-plane stress must equal the exact sum of modulus times thermal contraction over each degree of cooling, which a single room-temperature modulus would overstate several times.',
    run(ctx) {
      const cfg = defaultConfig(ctx.db), lib = cfg.materials, mat = findMaterial(lib, cfg.underfill.mat), tab = materialTables(mat);
      const nu = Math.min(tab.nu, CONST.NU_MAX_GLOBAL), Ta = 165, Tb = 25;
      const pts = thermalPathPoints(Ta, Tb, materialTgs(mat).map(t => t.T), []);
      const run = held => {
        const { mesh, model, solver } = boxModel(lib, linspace(0, 1, 2), linspace(0, 1, 2), linspace(0, 0.5, 2), [{ name: 'UF', kind: 'homog', mat: mat.id, stage: 0, part: 0 }], () => 0, 1e-13);
        if (held) {
          // roller supports: ux = 0 on both x faces, uy = 0 on both y faces, uz = 0 at one node
          const dofs = [];
          for (let n = 0; n < mesh.nn; n++) {
            const x = mesh.coords[3 * n], y = mesh.coords[3 * n + 1];
            if (x < 1e-9 || x > 1 - 1e-9) dofs.push(3 * n);
            if (y < 1e-9 || y > 1 - 1e-9) dofs.push(3 * n + 1);
          }
          dofs.push(2);
          model.constraints = Int32Array.from(dofs);
        }
        const steps = [];
        for (let i = 1; i < pts.length; i++) steps.push([pts[i - 1], pts[i], boxStep(model, solver, pts[i - 1], pts[i], 'V16')]);
        const states = boxStates(model, steps);
        let sx = 0, sz = 0, smax = 0;
        for (let e = 0; e < mesh.ne; e++) { const o = model.stateStress(e, states[e], 0, 0, 0); sx += o.sig[0] / mesh.ne; sz = Math.max(sz, Math.abs(o.sig[2])); for (let c = 0; c < 6; c++) smax = Math.max(smax, Math.abs(o.sig[c])); }
        return { sx, sz, smax };
      };
      // exact in-plane stress of the held block: -integral of E(T) / (1 - nu) dF(T), on 0.01 degC steps
      let exact = 0;
      for (let T = Ta; T > Tb + 1e-9; T -= 0.01) exact -= gridAt(tab.E, T - 0.005) / (1 - nu) * (gridAt(tab.F, T - 0.01) - gridAt(tab.F, T));
      const secant = -gridAt(tab.E, Tb) / (1 - nu) * (gridAt(tab.F, Tb) - gridAt(tab.F, Ta));
      const free = run(false), held = run(true);
      const sref = gridAt(tab.E, Tb) * Math.abs(gridAt(tab.F, Tb) - gridAt(tab.F, Ta));
      const err = Math.abs(held.sx / exact - 1);
      const pass = free.smax < 1e-8 * sref && err < 0.001 && held.sz < 1e-6 * Math.abs(exact);
      return { pass, measured: pts.length - 1 + ' steps from ' + Ta + ' to ' + Tb + ' °C: free block ' + (free.smax / sref).toExponential(2) + ' x E alpha dT; held block ' + held.sx.toFixed(2) + ' MPa vs exact ' + exact.toFixed(2) + ' MPa (' + (100 * err).toFixed(2) + ' %); a secant (total) form would give ' + secant.toFixed(2) + ' MPa' };
    },
  },
  {
    id: 'V17', name: 'Results file round trip', slow: true,
    criterion: 'restored results within 1e-6 relative; values, Maps, Sets, typed arrays (shared ones once) and non-finite numbers kept exactly; a changed mesh and a truncated file refused',
    about: 'Runs a small bare-die package through the full thermal path, writes the analysis and a sample of results to a results file and reads it back. The reloaded analysis must give the same warpage, die stress, cross-section and bump strain history as the original without solving again, and a file whose mesh no longer matches must be refused.',
    run(ctx) {
      // a small bare-die package with an offset die, meshed to a DOF cap of its own (about 8k DOF, which the file
      // must bring back too), so the round trip takes about a minute
      const cfg = presetConfig(ctx.db, 'bare');
      cfg.substrate.sx = cfg.substrate.sy = 12;
      Object.assign(cfg.dies[0], { sx: 5, sy: 5, x: 0.5, y: -0.3 });
      const an = new Analysis(cfg, { preset: 'draft', evaluations: 'full', cap: 6000 });
      an.build(); an.run();
      const sample = a => {
        const g = a.mesh.geom, hot = a.cfg.cycling.Tmax, e = a.mesh.ne >> 1;
        const q = a.qAlong(e, a.temps.cycling);
        return {
          w25: warpageJEITA(a.mesh, g, a.fields.get(25), a.cfg).signed, wHot: warpageJEITA(a.mesh, g, a.fieldAt(hot - 2.5), a.cfg).signed,
          die: dieSurfaceStress(a.view(25), g, 0, 'top').smax, cpi: bumpLoads(a.view(25, 'cpi'), g, 0).worstV,
          sec: sectionStress(a.view(hot), g, { axis: 'x', c: 0.2, a0: -5, a1: 5 }).sig, q: q.get(a.temps.cycling[0]),
        };
      };
      const A = sample(an);
      const shared = Float64Array.of(0.1, 2);
      const extra = { nan: NaN, inf: -Infinity, map: new Map([[25, Int32Array.of(-3, 7)], [-40, 'x']]), set: new Set(['a:1', 2]), nested: [{ f: Float32Array.of(1.5, NaN) }, null, true, shared], shared };
      const enc = encodeResultsFile({ analysis: exportAnalysisState(an), extra });
      const back = decodeResultsFile(joinParts(enc.parts, enc.size));
      const bn = restoreAnalysisState(back.analysis);
      const B = sample(bn);
      const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), 1e-30);
      const arel = (a, b) => { let m = 0, s = 0; for (let i = 0; i < a.length; i++) { m = Math.max(m, Math.abs(a[i] - b[i])); s = Math.max(s, Math.abs(a[i])); } return a.length === b.length ? m / s : Infinity; };
      const errs = { 'warpage 25 °C': rel(A.w25, B.w25), 'warpage near Tmax (interpolated)': rel(A.wHot, B.wHot), 'die backside stress map': arel(A.die, B.die), 'CPI worst shear': rel(A.cpi, B.cpi), 'cross-section at Tmax': arel(A.sec, B.sec), 'bump strain history': arel(A.q, B.q) };
      const x = back.extra, m = x.map;
      const kept = Number.isNaN(x.nan) && x.inf === -Infinity && m instanceof Map && m.get(25) instanceof Int32Array && m.get(25)[1] === 7 && m.get(-40) === 'x' && x.nested[0].f instanceof Float32Array && Number.isNaN(x.nested[0].f[1]) && x.nested[1] === null && x.nested[2] === true
        && x.set instanceof Set && x.set.has('a:1') && x.set.has(2) && x.shared === x.nested[3] && x.shared[0] === 0.1;
      let refused = false;
      try { restoreAnalysisState(Object.assign({}, back.analysis, { fingerprint: '0' })); } catch (e) { refused = true; }
      let damaged = false;
      try { decodeResultsFile(joinParts(enc.parts, enc.size).slice(0, enc.size - 8)); } catch (e) { damaged = true; }
      const worst = Math.max(...Object.values(errs));
      return { pass: worst < 1e-6 && kept && refused && damaged, measured: an.path.steps.length + ' steps, ' + an.model.ndof + ' DOF, file ' + (enc.size / 1048576).toFixed(1) + ' MB; ' + Object.entries(errs).map(([k, v]) => k + ' ' + v.toExponential(1)).join(', ') + '; special values ' + (kept ? 'kept' : 'changed') + '; changed mesh ' + (refused ? 'refused' : 'accepted') + '; truncated file ' + (damaged ? 'refused' : 'accepted') };
    },
  },
  {
    id: 'V18', name: 'Stacked modules: free module stages and silicon stress', slow: true,
    criterion: 'uniform-CTE module stress-free after its process stages (below 1e-3 of E α ΔT); module support reactions below 1e-6 of the internal force scale; bare module package convex at 25 °C with finite chiplet and base stresses',
    about: 'A small package with one Si-base module and two chiplets. With every module material given the CTE of silicon, the module process stages (chiplet join, wafer underfill and mold cure) must leave the free module stress-free, apart from the pull of the not-yet-born bumps and underfill under it (stiffness 1e-6 of their own, about 2e-4 of E α ΔT here); with the real materials the temporary three-point support of the free module must carry essentially no force. The bare module package must come out convex (silicon on the higher-CTE substrate, as V9 for a bare die) with finite stresses on every chiplet and on the base.',
    run(ctx) {
      const small = () => {
        const cfg = presetConfig(ctx.db, 'bare');
        cfg.substrate.sx = cfg.substrate.sy = 14;
        const m = defaultModule('M1', 0, 0, 'si');
        Object.assign(m, { sx: 7, sy: 6 });
        m.chiplets = [defaultChiplet('C1', -1.75, 0, 3.0, 5.0), defaultChiplet('C2', 1.75, 0, 3.0, 5.0)];
        cfg.dies = []; cfg.modules = [m];
        return cfg;
      };
      const opts = { preset: 'draft', evaluations: 'preview', cap: 20000 };
      // (1) uniform CTE: every module material takes the silicon CTE (Okada and Tokumaru form)
      const cu = small(), si = findMaterial(cu.materials, 'si');
      for (const id of [cu.stack.moldMat, cu.stack.wcuf.mat, cu.stack.ddi.solder, 'cu']) { const mm = findMaterial(cu.materials, id); mm.cte = deepClone(si.cte); delete mm.cteXY; delete mm.cteZ; }
      const au = new Analysis(cu, opts);
      au.build();
      const steps = au.buildPath(), mod = au.path.chain.filter(k => steps[k].stage < 0);
      for (const k of mod) au.du[k] = au.solveStep(k).u;
      let smax = 0;
      const st = { eps: new Float64Array(6), sig: new Float64Array(6) }, modParts = new Set([PART.CHIPLET, PART.BASE_SI, PART.TSV, PART.DDI_SOLDER, PART.DDI_FILL, PART.WCUF_FILLET, PART.MOLD]);
      for (let e = 0; e < au.mesh.ne; e++) {
        if (!modParts.has(au.mesh.ePart[e])) continue;
        const h = au.elementHistory(e, mod);
        au.model.stateStress(e, h, 0, 0, 0, st);
        for (let c = 0; c < 6; c++) smax = Math.max(smax, Math.abs(st.sig[c]));
      }
      const T0 = cu.stack.process.Tddi, T1 = cu.process.Tsub;
      const scale = 130000 * 3e-6 * Math.max(Math.abs(T0 - cu.stack.process.Twcuf), Math.abs(cu.stack.process.Tmold - T1), 1);
      // (2) real materials: reactions at the module's support on the first module step
      const cfg = small();
      const an = new Analysis(cfg, opts);
      an.build();
      an.solver.opts.tol = 1e-10;
      an.buildPath();
      const k0 = an.path.chain[0], s0 = an.path.steps[k0];
      const u = an.solveStep(k0).u, model = an.model, f = new Float64Array(model.ndof), Ku = new Float64Array(model.ndof);
      model.assembleStep(s0.Ta, s0.Tb, s0.stage, f, true);
      fullMatVec(model.pattern, model.val, u, Ku);
      let fscale = 0, reac = 0;
      for (let q = 0; q < model.ndof; q++) fscale = Math.max(fscale, Math.abs(Ku[q]), Math.abs(f[q]));
      for (const d of model.moduleConstraints) reac = Math.max(reac, Math.abs(Ku[d] - f[d]));
      // (3) the whole path of the bare module package
      const bn = new Analysis(small(), opts);
      bn.build(); bn.run();
      const g = bn.mesh.geom, w = warpageJEITA(bn.mesh, g, bn.fields.get(25), bn.cfg), v25 = bn.view(25);
      // whole-face Gauss-point peaks: the chiplets of this small model are too narrow on its coarse grid for an interior (edge band excluded) value
      const sis = g.siParts.map((p, i) => ({ name: p.name, top: dieSurfaceStress(v25, g, i, 'top').gpPeakAll, bottom: dieSurfaceStress(v25, g, i, 'bottom').gpPeakAll }));
      const finite = sis.length === 3 && sis.every(p => isFinite(p.top) && isFinite(p.bottom));
      const pass = smax / scale < 1e-3 && reac / fscale < 1e-6 && w.sign > 0 && finite;
      return { pass, measured: 'uniform-CTE module after ' + mod.length + ' module steps: max |σ| ' + smax.toExponential(2) + ' MPa = ' + (smax / scale).toExponential(2) + ' of E α ΔT; module support reactions ' + (reac / fscale).toExponential(2) + ' of the internal force scale (' + stepLabel(s0) + '); bare module package (' + bn.model.ndof + ' DOF, ' + bn.path.steps.length + ' steps) RT warpage ' + (w.signed * 1000).toFixed(2) + ' µm (' + (w.sign > 0 ? 'convex' : 'concave') + '); whole-face Gauss-point peaks (top / bottom) ' + sis.map(p => p.name + ' ' + p.top.toFixed(1) + ' / ' + p.bottom.toFixed(1) + ' MPa').join(', ') };
    },
  },
];

/** Run selected verification tests. */
function runVerification(ids, ctx) {
  const out = [];
  for (const t of VERIFICATION_TESTS) {
    if (ids && !ids.includes(t.id)) continue;
    if (ctx.progress) ctx.progress(t.id, t.name);
    const t0 = nowMs();
    let r;
    try { r = t.run(ctx); } catch (e) { r = { pass: false, measured: 'error: ' + e.message }; }
    r.id = t.id; r.criterion = t.criterion; r.name = t.name; r.ms = nowMs() - t0;
    out.push(r);
    if (ctx.onResult) ctx.onResult(r);
  }
  return out;
}
