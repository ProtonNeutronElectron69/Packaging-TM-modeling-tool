// ===== Web Worker driver (appended to the core block in the worker Blob) =====
// Messages in: {type, id, ...}; out: {type: 'progress'|'result'|'error', id, ...}
// Live solver state (LIVE in the core) goes out as {type: 'live', w, info}: from this worker directly
// (w = 0), from each helper on a message port of its own (w = helper slot + 1), so the page hears
// from the helpers while this worker is busy with a solve of its own.

(function () {
  const state = { an: null, hashes: null, db: null, screening: null, src: null, w: 0, livePort: null, helper: false };
  const post = m => self.postMessage(m);
  const progress = (id, frac, msg) => post({ type: 'progress', id, frac, msg });
  LIVE.post = info => {
    if (state.livePort) state.livePort.postMessage({ type: 'live', w: state.w, info });
    else if (!state.helper) post({ type: 'live', w: 0, info });
  };

  function toF32(a) { return a instanceof Float32Array ? a : Float32Array.from(a); }

  // ---- helper workers (nested) for the temperature sweep and the submodels ----
  // In the desktop app this driver runs in a Node compute process, which provides self.__spawnHelper
  // (a worker thread with the Web Worker interface used below; desktop/compute-worker.js).
  const nodeHelpers = () => typeof self.__spawnHelper === 'function';
  const canNest = () => nodeHelpers() || (typeof Worker !== 'undefined' && typeof URL !== 'undefined' && !!state.src);
  function spawnHelper(slot) {
    const w = nodeHelpers() ? self.__spawnHelper() : new Worker(URL.createObjectURL(new Blob([state.src], { type: 'text/javascript' })));
    const port = livePort();
    w.postMessage({ type: 'init', db: state.db, id: 0, w: slot + 1, live: port }, port ? [port] : []);
    return w;
  }
  /** A message port whose other end is with the page (browser) or the compute process relay (desktop), for a helper's live reports. */
  function livePort() {
    if (nodeHelpers()) return typeof self.__livePort === 'function' ? self.__livePort() : null;
    if (typeof MessageChannel === 'undefined') return null;
    const ch = new MessageChannel();
    self.postMessage({ type: 'liveport', port: ch.port1 }, [ch.port1]);
    return ch.port2;
  }
  /** Run jobs on n helpers; onPartial(payload) per partial / result message; resolves with the result payloads. */
  function runOnHelpers(n, jobs, onPartial, onProgress) {
    return new Promise((resolve, reject) => {
      const helpers = [];
      const results = new Array(jobs.length);
      let next = 0, done = 0, failed = false;
      const finish = () => { for (const w of helpers) w.terminate(); };
      const launch = w => {
        if (next >= jobs.length) return;
        const j = next++;
        const job = jobs[j];
        w.onmessage = ev => {
          const m = ev.data;
          if (m.id !== j + 1) return; // init acknowledgement or a stale message
          if (m.type === 'progress') { if (onProgress) onProgress(j, m.frac, m.msg); return; }
          if (m.type === 'partial') { if (onPartial) onPartial(j, m.payload); return; }
          if (m.type === 'error') { if (!failed) { failed = true; finish(); reject(new Error(m.message)); } return; }
          results[j] = m.payload; done++;
          if (done === jobs.length) { finish(); resolve(results); } else launch(w);
        };
        w.onerror = ev => { if (!failed) { failed = true; finish(); reject(new Error(ev.message || 'helper worker error')); } };
        w.postMessage(Object.assign({ id: j + 1 }, job.msg), job.transfer || []);
      };
      for (let i = 0; i < Math.min(n, jobs.length); i++) helpers.push(spawnHelper(i));
      for (const w of helpers) launch(w);
    });
  }

  /** Helper: solve a subset of the steps of the thermal path of the main analysis (each step is an independent solve). */
  function evalSteps(msg) {
    const id = msg.id;
    const an = new Analysis(msg.cfg, { preset: msg.preset, evaluations: msg.evaluations, precond: msg.precond || 'mg' });
    an.build();
    const steps = an.buildPath();
    if (steps.length !== msg.nSteps) throw new Error('Helper thermal path differs from the main analysis (' + steps.length + ' versus ' + msg.nSteps + ' steps).');
    const out = [];
    msg.steps.forEach((k, i) => {
      progress(id, i / msg.steps.length, 'Thermal path: ' + stepLabel(steps[k]));
      const r = an.solveStep(k);
      post({ type: 'partial', id, payload: { k, du: r.u } }, [r.u.buffer]);
      out.push({ k, iters: r.iters, ms: r.ms, relres: r.relres, precond: r.precond, rebuilt: r.rebuilt, label: r.label, pcMs: r.pcMs, warm: r.warm });
    });
    return { log: out };
  }

  /** Helper: run one bump submodel from transferred cycling fields. */
  function submodelRemote(msg) {
    const id = msg.id;
    const mesh = buildPackageMesh(msg.cfg, { preset: msg.preset });
    const fields = new Map();
    msg.temps.forEach((T, i) => fields.set(T, msg.fields[i]));
    const an = { cfg: msg.cfg, mesh, temps: { all: msg.temps, cycling: msg.temps }, fields, fieldAt: Analysis.prototype.fieldAt };
    const sm = new BumpSubmodel(an, msg.die, msg.site, { nxy: msg.nxy, nz: msg.nz, progress: (f, m) => progress(id, f, m) });
    return sm.run();
  }

  /**
   * The thermal path: every step in this worker, or the steps split over helpers when asked and possible
   * (contiguous blocks in solve order, so each worker rebuilds its preconditioner only where its own block
   * changes stage or solder regime).
   */
  async function runSweep(an, msg, id) {
    const steps = an.buildPath(), n = steps.length;
    const nw = Math.max(1, Math.min(msg.workers || 1, n));
    const solveHere = k => { an.du[k] = an.solveStep(k).u; };
    if (nw <= 1 || !canNest()) {
      steps.forEach((s, k) => { progress(id, 0.02 + 0.86 * k / n, 'Thermal path: ' + stepLabel(s) + ' (' + (k + 1) + '/' + n + ')'); solveHere(k); });
      an.finishPath();
      return;
    }
    const chunks = Array.from({ length: nw }, (_, w) => { const out = []; for (let k = Math.round(w * n / nw); k < Math.round((w + 1) * n / nw); k++) out.push(k); return out; });
    const mine = chunks[0], jobs = [];
    for (let w = 1; w < nw; w++) jobs.push({ msg: { type: 'evalSteps', cfg: msg.cfg, preset: msg.preset, evaluations: msg.evaluations || 'full', precond: msg.precond || 'mg', steps: chunks[w], nSteps: n } });
    let doneCount = 0;
    const tick = k => { doneCount++; progress(id, 0.02 + 0.86 * doneCount / n, 'Thermal path: ' + stepLabel(steps[k]) + ' (' + doneCount + '/' + n + ', ' + nw + ' workers)'); };
    const helperP = runOnHelpers(nw - 1, jobs, (j, p) => { an.du[p.k] = p.du; tick(p.k); }, null);
    // this worker takes its own block meanwhile (solves are synchronous; helper messages are handled between them)
    for (const k of mine) { solveHere(k); tick(k); await new Promise(r => setTimeout(r, 0)); }
    const res = await helperP;
    for (const r of res) for (const l of r.log) an.log.push(Object.assign({ helper: true }, l));
    an.finishPath();
  }

  /** Result payload of a global analysis at temperature T (fields for the views), from a view of the solution at T. */
  function fieldsAt(an, T, view) {
    const cfg = an.cfg, g = an.mesh.geom;
    view = view || an.view(T);
    const u = view.u;
    const w = warpageJEITA(an.mesh, g, u, cfg);
    const top = substrateTopWarpage(an.mesh, g, u);
    const dies = g.dies.map((d, i) => ({
      name: d.name, rect: d.rect,
      top: dieSurfaceStress(view, g, i, 'top'),
      bottom: dieSurfaceStress(view, g, i, 'bottom'),
      bumps: bumpLoads(view, g, i),
      uf: ufTractions(view, g, i),
    }));
    const solidus = pv(findMaterial(cfg.materials, cfg.bump.solder).solidus || { v: 217 });
    return {
      T, molten: T > solidus,
      warpage: { signed: w.signed, mag: w.mag, sign: w.sign, signConf: w.signConf, marginal: w.marginal, shape: w.shape, limitHot: w.limitHot, limitRT: w.limitRT, grid: toF32(w.grid), rmin: w.rmin, rmax: w.rmax, ballX: toF32(g.bga.x), ballY: toF32(g.bga.y), ballRes: toF32(w.ballRes), ballW: toF32(w.ballW),
        diagAB: { s: toF32(w.diagAB.s), rel: toF32(w.diagAB.rel), w: toF32(w.diagAB.w), max: w.diagAB.max, min: w.diagAB.min }, diagCD: { s: toF32(w.diagCD.s), rel: toF32(w.diagCD.rel), w: toF32(w.diagCD.w), max: w.diagCD.max, min: w.diagCD.min }, plane: w.plane },
      substrateTop: { grid: toF32(top.grid), mag: top.mag, dies: top.dies },
      dies,
      u: toF32(u),
    };
  }

  async function runAnalysis(msg) {
    const id = msg.id;
    const cfg = msg.cfg;
    const t0 = nowMs();
    const an = new Analysis(cfg, {
      preset: msg.preset, evaluations: msg.evaluations || 'full', precond: msg.precond || 'mg',
      progress: (f, m) => progress(id, f, m),
    });
    progress(id, 0, 'Meshing and building the model');
    an.build();
    const meshInfo = an.mesh.info;
    progress(id, 0.01, 'Mesh: ' + meshInfo.nDof + ' DOF, ' + meshInfo.nElem + ' elements');
    await runSweep(an, msg, id);
    state.an = an;
    state.hashes = configHashes(cfg);
    const g = an.mesh.geom, view25 = an.view(25);
    const result = {
      hashes: state.hashes, preset: an.mesh.info.preset, meshInfo, timings: an.timings, solverLog: an.log, notes: an.notes,
      temps: an.temps, finalStage: an.finalStage,
      xs: toF32(an.mesh.xs), ys: toF32(an.mesh.ys), zs: toF32(an.mesh.zs), nx: an.mesh.nx, ny: an.mesh.ny, nz: an.mesh.nz,
      geometry: { substrate: g.substrate, dies: g.dies.map(d => ({ name: d.name, rect: d.rect, cx: d.cx, cy: d.cy, w: d.w, h: d.h, t: d.t, deff: d.deff, abump: d.abump, nbx: d.nbx, nby: d.nby, px: d.px, py: d.py })), bga: { zone: g.bga.zone, x: toF32(g.bga.x), y: toF32(g.bga.y) }, zt: g.zt, zaf: g.zaf, lid: g.lid ? { outer: g.lid.outer, inner: g.lid.inner, footH: g.lid.footH, blt: g.lid.blt } : null, stiff: g.stiff ? { outer: g.stiff.outer, inner: g.stiff.inner } : null },
      at25: fieldsAt(an, 25, view25),
      sweep: an.temps.reflow.map(T => { const w = warpageJEITA(an.mesh, g, an.fields.get(T), cfg); return { T, signed: w.signed, mag: w.mag, sign: w.sign, signConf: w.signConf, marginal: w.marginal, shape: w.shape }; }),
      cpi: an.uCPI ? (v => g.dies.map((d, i) => bumpLoads(v, g, i)))(an.view(25, 'cpi')) : null,
      cycling: an.temps.cycling.map(T => { const w = warpageJEITA(an.mesh, g, an.fields.get(T), cfg); return { T, signed: w.signed, mag: w.mag, marginal: w.marginal, shape: w.shape }; }),
    };
    if (msg.evaluations !== 'preview') {
      progress(id, 0.94, 'Boundary faces and 3D fields');
      const faces = boundaryFaces(an.mesh);
      result.view3d = { quads: faces.quads, part: faces.part, coords: toF32(an.mesh.coords), stress25: faceStressField(view25, faces) };
      an.faces = faces;
      if (an.temps.cycling.length > 1) {
        progress(id, 0.96, 'Screening all bumps');
        result.screening = g.dies.map((d, i) => screenBumps(an, i));
        state.screening = result.screening;
      }
    }
    result.totalMs = nowMs() - t0;
    result.workers = Math.max(1, Math.min(msg.workers || 1, an.path.steps.length));
    result.nested = canNest();
    return result;
  }

  /** Submodels for several sites: on helpers when possible, else sequentially here. */
  async function runSubmodels(msg, id) {
    const an = state.an;
    if (!an) throw new Error('No analysis in memory; run the analysis first.');
    const jobs = msg.jobs;
    const nw = Math.max(1, Math.min(msg.workers || 1, jobs.length));
    const results = [];
    if (nw <= 1 || !canNest()) {
      for (let j = 0; j < jobs.length; j++) {
        const sm = new BumpSubmodel(an, jobs[j].die, jobs[j].site, { nxy: msg.nxy, nz: msg.nz, progress: (f, m) => progress(id, (j + f) / jobs.length, 'Submodel ' + (j + 1) + '/' + jobs.length + ': ' + m) });
        const r = withResidual(an, sm.run()); r.dieIdx = jobs[j].die;
        post({ type: 'partial', id, payload: r });
        results.push(r);
      }
      return results;
    }
    const temps = an.temps.cycling;
    const hjobs = jobs.map(job => {
      const fields = temps.map(T => Float64Array.from(an.fields.get(T)));
      return { msg: { type: 'submodelRemote', cfg: an.cfg, preset: an.mesh.info.preset.toLowerCase(), die: job.die, site: job.site, nxy: msg.nxy, nz: msg.nz, temps, fields }, transfer: fields.map(f => f.buffer) };
    });
    const fr = new Float64Array(jobs.length);
    const res = await runOnHelpers(nw, hjobs, null, (j, f, m) => { fr[j] = f; let sum = 0; for (const v of fr) sum += v; progress(id, sum / jobs.length, 'Submodel ' + (j + 1) + '/' + jobs.length + ' (' + nw + ' workers): ' + m); });
    res.forEach((r, j) => { withResidual(an, r); r.dieIdx = jobs[j].die; post({ type: 'partial', id, payload: r }); results.push(r); });
    return results;
  }

  /** The as-assembled 25 degC stress of the global model at the submodel elements (total-stress view), added here
   * since only this worker holds the thermal path. */
  function withResidual(an, r) {
    if (r.section) r.section.residual = submodelResidual(an, r.section);
    return r;
  }

  self.onmessage = async function (ev) {
    const msg = ev.data;
    const id = msg.id;
    try {
      switch (msg.type) {
        case 'init':
          state.db = msg.db; if (msg.src) state.src = msg.src;
          if (msg.w) { state.helper = true; state.w = msg.w; state.livePort = msg.live || null; }
          post({ type: 'result', id, payload: { ok: true, nested: canNest() } }); break;
        case 'run': post({ type: 'result', id, payload: await runAnalysis(msg) }); break;
        case 'evalSteps': post({ type: 'result', id, payload: evalSteps(msg) }); break;
        case 'submodelRemote': post({ type: 'result', id, payload: submodelRemote(msg) }); break;
        case 'submodels': post({ type: 'result', id, payload: await runSubmodels(msg, id) }); break;
        case 'fieldsAt': {
          if (!state.an) throw new Error('No analysis in memory; run the analysis first.');
          const view = state.an.view(msg.T);
          const f = fieldsAt(state.an, msg.T, view);
          if (state.an.faces) f.stress = faceStressField(view, state.an.faces);
          post({ type: 'result', id, payload: f });
          break;
        }
        case 'section': {
          if (!state.an) throw new Error('No analysis in memory; run the analysis first.');
          const an = state.an;
          post({ type: 'result', id, payload: sectionStress(an.view(msg.T), an.mesh.geom, msg.cut) });
          break;
        }
        case 'submodel': {
          if (!state.an) throw new Error('No analysis in memory; run the analysis first.');
          const sm = new BumpSubmodel(state.an, msg.die, msg.site, { nxy: msg.nxy, nz: msg.nz, progress: (f, m) => progress(id, f, m) });
          post({ type: 'result', id, payload: withResidual(state.an, sm.run()) });
          break;
        }
        case 'sensitivityCase': {
          const r = runSensitivityCase(msg.cfg, { progress: (f, m) => progress(id, f, m) });
          post({ type: 'result', id, payload: r });
          break;
        }
        case 'verify': {
          const results = runVerification(msg.ids, { db: state.db, presets: msg.presets, progress: (tid, name) => progress(id, 0, 'Running ' + tid + ': ' + name), onResult: r => post({ type: 'partial', id, payload: r }) });
          post({ type: 'result', id, payload: results });
          break;
        }
        case 'meshInfo': {
          const mesh = buildPackageMesh(msg.cfg, { preset: msg.preset });
          post({ type: 'result', id, payload: { info: mesh.info, warnings: meshWarnings(mesh) } });
          break;
        }
        default: throw new Error('Unknown message type ' + msg.type);
      }
    } catch (e) {
      post({ type: 'error', id, message: e.message, stack: e.stack });
    }
  };
})();
