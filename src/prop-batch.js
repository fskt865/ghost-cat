// Props that react (wobble + glow when Ghost walks into them) drawn with BatchedMesh: one draw call
// for all of them (two with lamp globes), while each prop keeps its own transform and tint.
import * as THREE from 'three';
import { toonMaterial } from './util.js';

const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });

export function createPropBatch(scene, objects) {
  const groups = { toon: [], glow: [] };
  const tmpC = new THREE.Color(), inv = new THREE.Matrix4();
  for (const obj of objects) {
    obj.updateMatrixWorld(true);
    inv.copy(obj.matrixWorld).invert();
    obj.traverse((m) => {
      if (!m.isMesh || m.userData.batched) return;
      const mat = m.material;
      if (Array.isArray(mat) || mat.transparent || !mat.visible || m.geometry.morphAttributes.position) return;
      const kind = mat.isMeshToonMaterial ? 'toon' : mat.isMeshBasicMaterial ? 'glow' : null;
      if (!kind) return;
      const src = m.geometry, ca = src.attributes.color, n = src.attributes.position.count;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', src.attributes.position.clone());
      g.setAttribute('normal', src.attributes.normal ? src.attributes.normal.clone() : src.attributes.position.clone());
      const rgb = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        tmpC.copy(mat.color || new THREE.Color(1, 1, 1));
        if (ca && mat.vertexColors) tmpC.multiply(new THREE.Color(ca.getX(i), ca.getY(i), ca.getZ(i)));
        rgb.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
      if (src.index) g.setIndex(src.index.clone()); else g.setIndex([...Array(n).keys()]);
      if (!src.attributes.normal) g.computeVertexNormals();
      // transform relative to the prop's root, so moving the root moves the batch instance
      const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      groups[kind].push({ obj, g, rel });
      m.material = HIDDEN; m.castShadow = false; m.userData.batched = true;
    });
  }
  const batches = [], byObj = new Map();
  for (const [kind, list] of Object.entries(groups)) {
    if (!list.length) continue;
    const verts = list.reduce((a, x) => a + x.g.attributes.position.count, 0), idx = list.reduce((a, x) => a + x.g.index.count, 0);
    const mat = kind === 'toon' ? toonMaterial({ vertexColors: true }) : new THREE.MeshBasicMaterial({ vertexColors: true });
    const bm = new THREE.BatchedMesh(list.length, verts, idx, mat);
    bm.name = 'props-' + kind;
    for (const x of list) {
      const gid = bm.addGeometry(x.g);
      const id = bm.addInstance(gid);
      bm.setMatrixAt(id, new THREE.Matrix4().multiplyMatrices(x.obj.matrixWorld, x.rel));
      bm.setColorAt(id, new THREE.Color(1, 1, 1));
      if (!byObj.has(x.obj)) byObj.set(x.obj, []);
      byObj.get(x.obj).push({ bm, id, rel: x.rel });
      x.g.dispose();
    }
    scene.add(bm); batches.push(bm);
  }
  const m4 = new THREE.Matrix4();
  // call after changing a prop root's position / rotation / scale
  const syncObject = (obj) => {
    obj.updateMatrixWorld(true);
    for (const r of byObj.get(obj) || []) r.bm.setMatrixAt(r.id, m4.multiplyMatrices(obj.matrixWorld, r.rel));
  };
  // tint > 1 brightens (the "glow" when touched); 1 is normal
  const tintObject = (obj, colour, amount) => {
    tmpC.set(colour);
    const c = new THREE.Color(1 + tmpC.r * amount, 1 + tmpC.g * amount, 1 + tmpC.b * amount);
    for (const r of byObj.get(obj) || []) r.bm.setColorAt(r.id, c);
  };
  // hide a prop (when it would block the camera's view of Ghost)
  const setObjectVisible = (obj, v) => { for (const r of byObj.get(obj) || []) r.bm.setVisibleAt(r.id, v); };
  return { batches, syncObject, tintObject, setObjectVisible, has: (o) => byObj.has(o) };
}
