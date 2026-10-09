// Minimal three.js API stub used by tools/smoke.mjs when the CDNs are unreachable
// (the sandbox blocks them). It exercises the 3D-view code path (geometry
// buffers, colour updates, camera maths) without WebGL; it is not three.js.
(function () {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    length() { return Math.hypot(this.x, this.y, this.z); }
    normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
    crossVectors(a, b) { this.x = a.y * b.z - a.z * b.y; this.y = a.z * b.x - a.x * b.z; this.z = a.x * b.y - a.y * b.x; return this; }
  }
  class Spherical { setFromVector3(v) { this.radius = v.length(); return this; } }
  class Color { constructor(c) { this.c = c; } }
  class BufferAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.needsUpdate = false; } }
  class BufferGeometry {
    constructor() { this.attributes = {}; }
    setAttribute(name, attr) { this.attributes[name] = attr; }
    computeVertexNormals() { const p = this.attributes.position; if (!p) return; for (let i = 0; i < p.array.length; i++) if (!isFinite(p.array[i])) throw new Error('non-finite vertex position at ' + i); }
    computeBoundingSphere() {}
  }
  class Material { constructor(o) { Object.assign(this, o); } }
  class Object3D { constructor() { this.children = []; this.position = new Vector3(); this.up = new Vector3(0, 1, 0); } add(o) { this.children.push(o); } }
  class Mesh extends Object3D { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
  class Scene extends Object3D {}
  class Light extends Object3D { constructor() { super(); } }
  class PerspectiveCamera extends Object3D {
    constructor(fov, aspect, near, far) { super(); this.fov = fov; this.aspect = aspect; this.near = near; this.far = far; this.target = new Vector3(); }
    lookAt(x, y, z) { this.target = typeof x === 'object' ? x.clone() : new Vector3(x, y, z); }
    getWorldDirection(v) { return v.copy(this.target).sub(this.position).normalize(); }
  }
  class WebGLRenderer {
    constructor() { this.domElement = document.createElement('canvas'); this.renders = 0; }
    setSize(w, h) { this.domElement.width = w; this.domElement.height = h; }
    setPixelRatio() {}
    render(scene, camera) { this.renders++; if (!scene || !camera) throw new Error('render without scene / camera'); window.__stubRenders = (window.__stubRenders || 0) + 1; }
    dispose() {}
  }
  window.THREE = { Vector3, Spherical, Color, BufferAttribute, BufferGeometry, MeshLambertMaterial: Material, Mesh, Scene, AmbientLight: Light, DirectionalLight: Light, PerspectiveCamera, WebGLRenderer, DoubleSide: 2, __stub: true };
})();
