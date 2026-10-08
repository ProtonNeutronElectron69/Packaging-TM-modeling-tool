// ===== Web Worker driver (appended to the core block in the worker Blob) =====
// Messages in: {type, id, ...}; out: {type: 'progress'|'result'|'error', id, ...}

(function () {
  const state = { an: null, hashes: null, db: null, screening: null };
  const post = m => self.postMessage(m);
  const progress = (id, frac, msg) => post({ type: 'progress', id, frac, msg });

  function toF32(a) { return a instanceof Float32Array ? a : Float32Array.from(a); }

  /** Result payload of a global analysis at temperature T (fields for the views). */
  function fieldsAt(an, T) {
    const cfg = an.cfg, g = an.mesh.geom, model = an.model, st = an.finalStage;
    const u = an.fields.has(T) ? an.fields.get(T) : an.fieldAt(T);
    const w = warpageJEITA(an.mesh, g, u, cfg);
    const top = substrateTopWarpage(an.mesh, g, u);
    const dies = g.dies.map((d, i) => ({
      name: d.name, rect: d.rect,
      top: dieSurfaceStress(model, g, i, 'top', T, st, u),
      bottom: dieSurfaceStress(model, g, i, 'bottom', T, st, u),
      bumps: bumpLoads(model, g, i, T, st, u),
      uf: ufTractions(model, g, i, T, st, u),
    }));
    const solidus = pv(findMaterial(cfg.materials, cfg.bump.solder).solidus || { v: 217 });
    return {
      T, molten: T > solidus,
      warpage: { signed: w.signed, mag: w.mag, sign: w.sign, limitHot: w.limitHot, limitRT: w.limitRT, grid: toF32(w.grid), rmin: w.rmin, rmax: w.rmax, ballX: toF32(g.bga.x), ballY: toF32(g.bga.y), ballRes: toF32(w.ballRes), ballW: toF32(w.ballW),
        diagAB: { s: toF32(w.diagAB.s), rel: toF32(w.diagAB.rel), w: toF32(w.diagAB.w), max: w.diagAB.max, min: w.diagAB.min }, diagCD: { s: toF32(w.diagCD.s), rel: toF32(w.diagCD.rel), w: toF32(w.diagCD.w), max: w.diagCD.max, min: w.diagCD.min }, plane: w.plane },
      substrateTop: { grid: toF32(top.grid), mag: top.mag, dies: top.dies },
      dies,
      u: toF32(u),
    };
  }

  function runAnalysis(msg) {
    const id = msg.id;
    const cfg = msg.cfg;
    const t0 = nowMs();
    const an = new Analysis(cfg, {
      preset: msg.preset, evaluations: msg.evaluations || 'full', precond: msg.precond || 'mg', quick: !!msg.quick,
      progress: (f, m) => progress(id, f, m),
    });
    an.build();
    const meshInfo = an.mesh.info;
    progress(id, 0.01, 'Mesh: ' + meshInfo.nDof + ' DOF, ' + meshInfo.nElem + ' elements');
    an.run();
    state.an = an;
    state.hashes = configHashes(cfg);
    const g = an.mesh.geom;
    const result = {
      hashes: state.hashes, preset: an.mesh.info.preset, meshInfo, timings: an.timings, solverLog: an.log, notes: an.notes,
      temps: an.temps, finalStage: an.finalStage,
      xs: toF32(an.mesh.xs), ys: toF32(an.mesh.ys), zs: toF32(an.mesh.zs), nx: an.mesh.nx, ny: an.mesh.ny, nz: an.mesh.nz,
      geometry: { substrate: g.substrate, dies: g.dies.map(d => ({ name: d.name, rect: d.rect, cx: d.cx, cy: d.cy, w: d.w, h: d.h, t: d.t, deff: d.deff, abump: d.abump, nbx: d.nbx, nby: d.nby, px: d.px, py: d.py })), bga: { zone: g.bga.zone, x: toF32(g.bga.x), y: toF32(g.bga.y) }, zt: g.zt, zaf: g.zaf, lid: g.lid ? { outer: g.lid.outer, inner: g.lid.inner, footH: g.lid.footH, blt: g.lid.blt } : null, stiff: g.stiff ? { outer: g.stiff.outer, inner: g.stiff.inner } : null },
      at25: fieldsAt(an, 25),
      sweep: an.temps.reflow.map(T => { const w = warpageJEITA(an.mesh, g, an.fields.get(T), cfg); return { T, signed: w.signed, mag: w.mag, sign: w.sign }; }),
      cpi: an.uCPI ? g.dies.map((d, i) => bumpLoads(an.model, g, i, 25, 1, an.uCPI)) : null,
      cycling: an.temps.cycling.map(T => { const w = warpageJEITA(an.mesh, g, an.fields.get(T), cfg); return { T, signed: w.signed }; }),
    };
    if (msg.evaluations !== 'preview') {
      progress(id, 0.94, 'Boundary faces and 3D fields');
      const faces = boundaryFaces(an.mesh);
      result.view3d = { quads: faces.quads, part: faces.part, coords: toF32(an.mesh.coords), stress25: faceStressField(an.model, faces, 25, an.finalStage, an.fields.get(25)) };
      an.faces = faces;
      if (an.temps.cycling.length > 1) {
        progress(id, 0.96, 'Screening all bumps');
        result.screening = g.dies.map((d, i) => screenBumps(an, i));
        state.screening = result.screening;
      }
    }
    result.totalMs = nowMs() - t0;
    return result;
  }

  self.onmessage = function (ev) {
    const msg = ev.data;
    const id = msg.id;
    try {
      switch (msg.type) {
        case 'init': state.db = msg.db; post({ type: 'result', id, payload: { ok: true } }); break;
        case 'run': post({ type: 'result', id, payload: runAnalysis(msg) }); break;
        case 'fieldsAt': {
          if (!state.an) throw new Error('No analysis in memory; run the analysis first.');
          const f = fieldsAt(state.an, msg.T);
          if (state.an.faces) f.stress = faceStressField(state.an.model, state.an.faces, msg.T, state.an.finalStage, state.an.fields.has(msg.T) ? state.an.fields.get(msg.T) : state.an.fieldAt(msg.T));
          post({ type: 'result', id, payload: f });
          break;
        }
        case 'submodel': {
          if (!state.an) throw new Error('No analysis in memory; run the analysis first.');
          const sm = new BumpSubmodel(state.an, msg.die, msg.site, { nxy: msg.nxy, nz: msg.nz, progress: (f, m) => progress(id, f, m) });
          post({ type: 'result', id, payload: sm.run() });
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
