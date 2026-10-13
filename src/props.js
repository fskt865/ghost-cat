// Loads the artist's props (assets/props/<name>.glb) once each, converts them to toon materials,
// and hands out clones. Missing or broken files fall back to src/placeholders.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toonifyGltf } from './util.js';
import { fallbackProp } from './placeholders.js';

const loader = new GLTFLoader();
const cache = new Map();
export const loadReport = {}; // name -> 'glb' | 'placeholder'

function load(name) {
  const url = name.startsWith('assets/') || name.startsWith('./') ? name : `assets/props/${name}.glb`;
  if (!cache.has(name)) {
    cache.set(name, new Promise((resolve) => {
      loader.load(url, (g) => {
        toonifyGltf(g.scene, { cast: true });
        loadReport[name] = 'glb';
        resolve(g.scene);
      }, undefined, () => { loadReport[name] = 'placeholder'; resolve(null); });
    }));
  }
  return cache.get(name);
}

// Returns a fresh Object3D for the prop. Geometry is shared between clones; materials are cloned
// per instance so one lamp can switch off without dimming another.
export async function getProp(name, { scale = 1, fallback = null } = {}) {
  const src = await load(name);
  const obj = src ? src.clone(true) : (fallback ? fallback() : fallbackProp(name));
  if (!obj) return null; // a fallback may decline (optional decor that is not built yet)
  obj.traverse((o) => {
    if (o.isMesh) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      if (o.material.transparent) o.castShadow = false;
    }
  });
  obj.scale.multiplyScalar(scale);
  obj.userData.prop = name;
  return obj;
}

export const preload = (names) => Promise.all(names.map(load));
