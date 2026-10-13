// Static batching: merges every mesh under the given roots that never moves into one opaque toon mesh
// and one unlit "glow" mesh (lit windows, lamp globes), so a whole street costs a few draw calls.
// Meshes it takes are hidden by material, so their children (animated nodes) still render.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMaterial } from './util.js';

const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });

export function batchStatic(scene, roots, { skip = () => false, toon = toonMaterial({ vertexColors: true }) } = {}) {
  const lists = { toon: [], glow: [] };
  const c = new THREE.Color();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || skip(o) || o.userData.batched) return;
      const m = o.material;
      if (Array.isArray(m) || m.transparent || o.geometry.morphAttributes.position || !m.visible) return;
      const kind = m.isMeshToonMaterial ? 'toon' : m.isMeshBasicMaterial ? 'glow' : null;
      if (!kind) return;
      const src = o.geometry, ca = src.attributes.color, n = src.attributes.position.count;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', src.attributes.position.clone());
      g.setAttribute('normal', src.attributes.normal ? src.attributes.normal.clone() : src.attributes.position.clone());
      const rgb = new Float32Array(n * 3);
      // vertex colour times material colour (toon props use white material colour)
      for (let i = 0; i < n; i++) {
        c.copy(m.color || new THREE.Color(1, 1, 1));
        if (ca && m.vertexColors) c.multiply(new THREE.Color(ca.getX(i), ca.getY(i), ca.getZ(i)));
        rgb[i * 3] = c.r; rgb[i * 3 + 1] = c.g; rgb[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
      if (src.index) g.setIndex(src.index.clone());
      if (!src.attributes.normal) g.computeVertexNormals();
      g.applyMatrix4(o.matrixWorld);
      lists[kind].push(g.index ? g.toNonIndexed() : g);
      o.material = HIDDEN; o.castShadow = false; o.userData.batched = true;
    });
  }
  const out = [];
  for (const [kind, list] of Object.entries(lists)) {
    if (!list.length) continue;
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, kind === 'toon' ? toon : new THREE.MeshBasicMaterial({ vertexColors: true }));
    mesh.receiveShadow = kind === 'toon'; mesh.name = 'batch-' + kind;
    scene.add(mesh); out.push(mesh);
  }
  return out;
}

// Live batching: every opaque mesh under the roots that the game may still move, hide or recolour (props that wobble,
// knocked-over mugs, the turntable's platter, piano keys, lamp shades that dim) drawn by a few BatchedMeshes (toon that
// casts a shadow, toon that does not, unlit glow). The source meshes stay in the scene graph exactly as before (the game
// keeps moving them, colliders and touch boxes still read them); they are only taken off the camera's layer. Before each
// draw the batch copies every source's world matrix, its effective visibility (itself and every parent) and its
// material colour, writing only what changed; a source that later gets a material of its own (a fade clones it, a
// vertex sway replaces it) or turns see-through is handed back to the renderer. Meshes with a texture, an emissive colour, morphs, skinning, a
// see-through material or a back/double side are left alone.
export function batchLive(scene, roots, { skip = () => false, name = 'live' } = {}) {
  const groups = new Map();
  const white = new THREE.Color(1, 1, 1), seen = new Set();
  for (const root of roots) {
    if (!root) continue;
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || seen.has(o) || o.isBatchedMesh || o.isInstancedMesh || o.isSkinnedMesh || o.userData.batched || skip(o)) return;
      seen.add(o);
      const m = o.material;
      if (Array.isArray(m) || !m.visible || m.transparent || m.map || m.alphaTest || m.side !== THREE.FrontSide || o.geometry.morphAttributes.position) return;
      if (m.onBeforeCompile && m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return; // a custom shader (rim)
      let kind;
      if (m.isMeshToonMaterial) { if (m.emissive && m.emissive.getHex() !== 0) return; kind = o.castShadow ? 'toon-cast' : 'toon'; }
      else if (m.isMeshBasicMaterial) kind = m.fog ? 'glow' : 'glow-nofog';
      else return;
      const src = o.geometry, ca = src.attributes.color, n = src.attributes.position.count;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', src.attributes.position.clone());
      g.setAttribute('normal', src.attributes.normal ? src.attributes.normal.clone() : src.attributes.position.clone());
      const rgb = new Float32Array(n * 3).fill(1);
      if (ca && m.vertexColors) for (let i = 0; i < n; i++) { rgb[i * 3] = ca.getX(i); rgb[i * 3 + 1] = ca.getY(i); rgb[i * 3 + 2] = ca.getZ(i); }
      g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
      if (src.index) g.setIndex(src.index.clone()); else g.setIndex([...Array(n).keys()]);
      if (!src.attributes.normal) g.computeVertexNormals();
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind).push({ mesh: o, mat: m, g });
    });
  }
  const batches = [];
  for (const [kind, list] of groups) {
    const verts = list.reduce((a, x) => a + x.g.attributes.position.count, 0), idx = list.reduce((a, x) => a + x.g.index.count, 0);
    const mat = kind.startsWith('toon') ? toonMaterial({ vertexColors: true }) : new THREE.MeshBasicMaterial({ vertexColors: true, fog: kind === 'glow' });
    const bm = new THREE.BatchedMesh(list.length, verts, idx, mat);
    bm.name = `${name}-${kind}`;
    bm.castShadow = kind === 'toon-cast'; bm.receiveShadow = kind.startsWith('toon');
    bm.frustumCulled = false; // the sources move; each instance is still culled on its own
    const recs = list.map((x) => {
      const id = bm.addInstance(bm.addGeometry(x.g));
      x.g.dispose();
      const mask = x.mesh.layers.mask;
      x.mesh.layers.disableAll(); x.mesh.userData.batched = true; // off every camera (and the shadow pass); still in the graph
      return { ...x, g: null, id, mask, m4: new THREE.Matrix4().set(NaN, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), c: new THREE.Color(NaN, 0, 0), vis: null, gone: false };
    });
    const sync = () => {
      for (const r of recs) {
        if (r.gone) continue;
        // the game gave it a material of its own (a fade, a vertex sway) or made it see-through: it draws itself again
        if (r.mesh.material !== r.mat || r.mat.transparent || r.mat.map) {
          r.gone = true; bm.setVisibleAt(r.id, false); r.mesh.layers.mask = r.mask; r.mesh.userData.batched = false; continue;
        }
        let vis = r.mat.visible;
        for (let p = r.mesh; vis && p; p = p.parent) if (!p.visible) vis = false;
        if (vis !== r.vis) { bm.setVisibleAt(r.id, vis); r.vis = vis; }
        if (!vis) continue;
        if (!r.m4.equals(r.mesh.matrixWorld)) { r.m4.copy(r.mesh.matrixWorld); bm.setMatrixAt(r.id, r.m4); }
        const c = r.mat.color || white;
        if (!r.c.equals(c)) { r.c.copy(c); bm.setColorAt(r.id, c); }
      }
    };
    sync();
    // the renderer has updated every world matrix by the time it draws (or shadows) the batch
    const draw = bm.onBeforeRender, shadow = bm.onBeforeShadow;
    bm.onBeforeRender = function (...a) { sync(); return draw.apply(this, a); };
    bm.onBeforeShadow = function (...a) { sync(); return shadow.apply(this, a); };
    scene.add(bm); batches.push(bm);
  }
  return batches;
}
