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
