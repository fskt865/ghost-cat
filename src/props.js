// Loads the artist's props (assets/props/<name>.glb) once each, converts them to toon materials,
// and hands out clones. Missing or broken files fall back to src/placeholders.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toonifyGltf } from './util.js';
import { fallbackProp } from './placeholders.js';

const loader = new GLTFLoader();
const cache = new Map();
export const loadReport = {}; // name -> 'glb' | 'placeholder'

// Every file the world loads at start (assets/preload.json, written by tools/preload-list.mjs) is requested at once as
// soon as this module runs, instead of area by area as the build reaches it: the downloads overlap each other and the
// build. A file missing from the list just loads when asked; a stale entry costs one unused download.
const bytes = new Map(); // url -> Promise<ArrayBuffer | null>
export function fetchBytes(url) {
  if (!bytes.has(url)) bytes.set(url, fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null));
  return bytes.get(url);
}
// the bytes of a JSON file as an object (a layout); taken out of the map once read
export async function fetchJSON(url) {
  const b = await fetchBytes(url); bytes.delete(url);
  if (!b) throw new Error('missing ' + url);
  return JSON.parse(new TextDecoder().decode(b));
}
fetch('assets/preload.json').then((r) => (r.ok ? r.json() : [])).then((list) => { for (const u of list) fetchBytes(u); }).catch(() => {});

function load(name) {
  const url = name.startsWith('assets/') || name.startsWith('./') ? name : `assets/props/${name}.glb`;
  if (!cache.has(name)) {
    cache.set(name, new Promise((resolve) => {
      const fail = () => { loadReport[name] = 'placeholder'; resolve(null); };
      fetchBytes(url).then((buf) => {
        bytes.delete(url); // parsed once, cloned from the cache after that
        if (!buf) return fail();
        loader.parse(buf, url.slice(0, url.lastIndexOf('/') + 1), (g) => {
          toonifyGltf(g.scene, { cast: true });
          loadReport[name] = 'glb';
          resolve(g.scene);
        }, fail);
      });
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
