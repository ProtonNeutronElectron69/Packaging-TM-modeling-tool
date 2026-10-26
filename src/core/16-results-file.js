// ===== Results file (.fcbgares): every result of a session in one file ==========
//
// Layout (little endian):
//   bytes 0-7    RESULTS_FILE_MAGIC ("FCBGARES")
//   bytes 8-11   format version (uint32)
//   bytes 12-15  manifest length in bytes (uint32)
//   manifest     UTF-8 JSON: {tree, blobs}
//   data         the typed arrays of the tree, each at an 8-byte aligned offset from the start of the data
// The tree is the saved value with every typed array replaced by {__ta: index} (blobs[index] gives its
// type, offset and length; an array referenced twice is stored once), every Map by {__map: [[key, value],
// ...]}, every Set by {__set: [...]} and every non-finite number by {__num: 'NaN' | 'Infinity' |
// '-Infinity'}, so that JSON carries the rest exactly.

const RESULTS_TYPED = { Float64Array, Float32Array, Int32Array, Uint32Array, Int16Array, Uint16Array, Int8Array, Uint8Array };

/**
 * Replace the typed arrays, Maps, Sets and non-finite numbers of a value tree by references (typed arrays go
 * to blobs; `seen` maps an array already stored to its index).
 */
function packTree(v, blobs, seen) {
  if (typeof v === 'number') return isFinite(v) ? v : { __num: String(v) };
  if (v === null || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v)) {
    if (!RESULTS_TYPED[v.constructor.name]) throw new Error('Cannot save a ' + v.constructor.name + '.');
    if (!seen.has(v)) { blobs.push(v); seen.set(v, blobs.length - 1); }
    return { __ta: seen.get(v) };
  }
  if (v instanceof Map) return { __map: Array.from(v, ([k, x]) => [packTree(k, blobs, seen), packTree(x, blobs, seen)]) };
  if (v instanceof Set) return { __set: Array.from(v, x => packTree(x, blobs, seen)) };
  if (Array.isArray(v)) return v.map(x => packTree(x, blobs, seen));
  const o = {};
  for (const k of Object.keys(v)) if (v[k] !== undefined && typeof v[k] !== 'function') o[k] = packTree(v[k], blobs, seen);
  return o;
}

/** Inverse of packTree, with the typed arrays already read. */
function unpackTree(v, arrays) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(x => unpackTree(x, arrays));
  if (v.__ta !== undefined) return arrays[v.__ta];
  if (v.__num !== undefined) return Number(v.__num);
  if (v.__map !== undefined) return new Map(v.__map.map(([k, x]) => [unpackTree(k, arrays), unpackTree(x, arrays)]));
  if (v.__set !== undefined) return new Set(v.__set.map(x => unpackTree(x, arrays)));
  const o = {};
  for (const k of Object.keys(v)) o[k] = unpackTree(v[k], arrays);
  return o;
}

const alignUp = (n, a) => Math.ceil(n / a) * a;

/**
 * Encode a value tree as a results file. Returns {parts, size}: the byte chunks in order (for a Blob,
 * or joinParts in Node) and the total size in bytes.
 */
function encodeResultsFile(value) {
  const blobs = [], tree = packTree(value, blobs, new Map()), A = CONST.RESULTS_FILE_ALIGN;
  let off = 0;
  const table = blobs.map(b => { off = alignUp(off, A); const e = { type: b.constructor.name, offset: off, length: b.length }; off += b.byteLength; return e; });
  const json = new TextEncoder().encode(JSON.stringify({ tree, blobs: table }));
  const head = new ArrayBuffer(16), hv = new DataView(head);
  for (let i = 0; i < 8; i++) hv.setUint8(i, CONST.RESULTS_FILE_MAGIC.charCodeAt(i));
  hv.setUint32(8, CONST.RESULTS_FILE_VERSION, true);
  hv.setUint32(12, json.length, true);
  const dataStart = alignUp(16 + json.length, A);
  const parts = [new Uint8Array(head), json, new Uint8Array(dataStart - 16 - json.length)];
  let pos = 0;
  blobs.forEach((b, i) => {
    if (table[i].offset > pos) parts.push(new Uint8Array(table[i].offset - pos));
    parts.push(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    pos = table[i].offset + b.byteLength;
  });
  return { parts, size: dataStart + pos };
}

/** The parts of encodeResultsFile as one ArrayBuffer. */
function joinParts(parts, size) {
  const out = new Uint8Array(size);
  let p = 0;
  for (const x of parts) { out.set(x, p); p += x.length; }
  return out.buffer;
}

/** Decode a results file (ArrayBuffer) into its value tree; typed arrays are copied out of the file buffer. */
function decodeResultsFile(buffer) {
  if (buffer.byteLength < 16) throw new Error('Not a results file (too short).');
  const hv = new DataView(buffer);
  let magic = '';
  for (let i = 0; i < 8; i++) magic += String.fromCharCode(hv.getUint8(i));
  if (magic !== CONST.RESULTS_FILE_MAGIC) throw new Error('Not an FCBGA screening tool results file.');
  const version = hv.getUint32(8, true);
  if (version > CONST.RESULTS_FILE_VERSION) throw new Error('This results file was written by a newer version of the tool (format ' + version + ').');
  const len = hv.getUint32(12, true);
  const { tree, blobs } = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 16, len)));
  const dataStart = alignUp(16 + len, CONST.RESULTS_FILE_ALIGN);
  const arrays = blobs.map(b => {
    const T = RESULTS_TYPED[b.type];
    if (!T || dataStart + b.offset + b.length * T.BYTES_PER_ELEMENT > buffer.byteLength) throw new Error('The results file is damaged or incomplete.');
    return new T(buffer, dataStart + b.offset, b.length).slice();
  });
  return unpackTree(tree, arrays);
}

/**
 * Fingerprint of a mesh (grid lines, element groups, parts and fill fractions): a results file's step
 * increments belong to exactly this mesh, so a tool version that meshes the same configuration
 * differently cannot reuse them.
 */
function meshFingerprint(mesh) {
  let h1 = 0xdeadbeef ^ mesh.nn, h2 = 0x41c6ce57 ^ mesh.ne;
  for (const a of [mesh.xs, mesh.ys, mesh.zs, mesh.eGroup, mesh.ePart, mesh.eScale]) {
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < b.length; i++) { h1 = Math.imul(h1 ^ b[i], 2654435761); h2 = Math.imul(h2 ^ b[i], 1597334677); }
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * What a results file needs to bring an analysis back without solving: its configuration and run
 * options, the mesh fingerprint, the plan of the thermal path and (unless `withoutSteps`) every step's
 * displacement increment, single precision as the analysis keeps them.
 */
function exportAnalysisState(an, withoutSteps) {
  const st = {
    cfg: an.cfg, preset: an.opts.preset, evaluations: an.opts.evaluations, precond: an.opts.precond,
    meshOverride: { hmin: an.opts.hmin, hmax: an.opts.hmax, cap: an.opts.cap },
    fingerprint: meshFingerprint(an.mesh), nDof: an.model.ndof,
    plan: an.path.steps.map(s => [s.Ta, s.Tb, s.stage, s.branch]),
  };
  if (!withoutSteps) st.du = an.du;
  return st;
}

/** Steps of the thermal path per message when a results file's increments travel between the page and a worker. */
function resultsChunkSteps(nDof) { return Math.max(1, Math.floor(CONST.RESULTS_FILE_CHUNK_BYTES / (4 * nDof))); }

/**
 * Rebuild an analysis from exportAnalysisState: mesh and model from the configuration, then the saved
 * step increments in place of the solves. Throws when this tool version meshes the configuration or
 * plans the thermal path differently.
 */
function restoreAnalysisState(st, opts) {
  const an = new Analysis(st.cfg, Object.assign({ preset: st.preset, evaluations: st.evaluations, precond: st.precond }, st.meshOverride, opts || {}));
  an.build();
  if (an.model.ndof !== st.nDof || meshFingerprint(an.mesh) !== st.fingerprint) throw new Error('this version of the tool meshes the saved configuration differently');
  an.restorePath(st.du, st.plan);
  return an;
}
