// Shared helpers: seeded random, the toon gradient, procedural textures, and the
// "baker" that merges many primitives into one vertex-coloured mesh (one draw call per prop).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function rng(seed = 1) {
  // mulberry32: small, fast, deterministic so the hand-made wobble is the same every load
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const damp = (k, dt) => 1 - Math.exp(-k * dt); // frame-rate independent lerp factor

export function dampAngle(cur, target, f) {
  let d = target - cur;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return cur + d * f;
}

// Four soft bands. Low floor (not black) so shadowed sides stay readable at night.
let _gradient = null;
export function toonGradient() {
  if (_gradient) return _gradient;
  const data = new Uint8Array([72, 128, 196, 255]);
  _gradient = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  _gradient.minFilter = THREE.NearestFilter;
  _gradient.magFilter = THREE.NearestFilter;
  _gradient.generateMipmaps = false;
  _gradient.needsUpdate = true;
  return _gradient;
}

export function toonMaterial(opts = {}) {
  return new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...opts });
}

// Soft round glow used by halos, stars, motes and the cat's blob shadow. Drawn in code: no image files.
const _texCache = new Map();
export function radialTexture(stops, size = 64) {
  const key = JSON.stringify(stops) + size;
  if (_texCache.has(key)) return _texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(key, tex);
  return tex;
}

export const glowTexture = () =>
  radialTexture([[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.75)'], [0.45, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']]);

// Smooth position-based wobble: identical positions get identical offsets, so seams never tear.
export function wobbleGeometry(geo, amount = 0.02, freq = 2.3, seed = 0) {
  const p = geo.attributes.position;
  const s = seed * 1.618;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(
      i,
      x + amount * Math.sin(y * freq * 1.3 + z * freq * 0.7 + s),
      y + amount * 0.6 * Math.sin(x * freq * 0.9 + z * freq * 1.1 + s * 2.1),
      z + amount * Math.sin(x * freq * 1.2 + y * freq * 0.8 + s * 3.7)
    );
  }
  p.needsUpdate = true;
  return geo;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color();

// Baker: add primitives with a colour (hex, or fn(worldPos)->hex/Color), get one merged geometry.
export class Baker {
  constructor() { this.parts = []; }
  add(geo, color, { pos = [0, 0, 0], rot = [0, 0, 0], order = 'XYZ', scl = [1, 1, 1], wobble = 0, seed = 0 } = {}) {
    const g = geo; // three's primitives are all indexed, which mergeGeometries needs
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    _e.set(rot[0], rot[1], rot[2], order);
    _q.setFromEuler(_e);
    _s.set(...(typeof scl === 'number' ? [scl, scl, scl] : scl));
    _m.compose(_v.set(...pos), _q, _s);
    g.applyMatrix4(_m);
    if (wobble) wobbleGeometry(g, wobble, 2.3, seed);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const pa = g.attributes.position;
    for (let i = 0; i < n; i++) {
      if (typeof color === 'function') {
        const r = color(pa.getX(i), pa.getY(i), pa.getZ(i));
        r && r.isColor ? _c.copy(r) : _c.set(r);
      } else _c.set(color);
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    return this;
  }
  build() {
    if (this.parts.some((p) => !p.index)) this.parts = this.parts.map((p) => (p.index ? p.toNonIndexed() : p));
    const merged = mergeGeometries(this.parts, false);
    if (!merged) throw new Error('Baker: could not merge ' + this.parts.map((p) => p.type).join(','));
    for (const p of this.parts) p.dispose();
    this.parts = [];
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

// Mix two hex colours (sRGB) -> THREE.Color in working (linear) space.
export function mix(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), clamp(t, 0, 1));
}

// Fresnel rim on a toon material: makes the ghost read as softly glowing at night.
export function addRim(m, glow, strength, power = 2.2) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = { value: new THREE.Color(glow).multiplyScalar(strength) };
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform vec3 uRim;\nvoid main() {')
      .replace('#include <opaque_fragment>', `
        float rimF = 1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
        outgoingLight += uRim * pow(rimF, ${power.toFixed(2)});
        diffuseColor.a = mix(diffuseColor.a, 1.0, pow(rimF, 3.0) * 0.6);
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'ghost-rim' + power.toFixed(2);
  return m;
}

// Swap a loaded glTF's PBR materials for toon ones, keeping vertex colours (RGBA fades included),
// translucency (with depthWrite on so inner folds never show through) and emissive glows.
// Materials flagged emissive in the asset's extras become unlit, so a lamp globe reads as a light.
export function toonifyGltf(root, { rim = null, rimStrength = 0.7, cast = false } = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const conv = (m) => {
      const ud = m.userData || {};
      const vc = !!o.geometry.attributes.color;
      if (ud.emissive) {
        // a pale warm core reads as light; the asset's light colour tints it
        const c = new THREE.Color(ud.lightColour || '#ffffff').lerp(new THREE.Color('#fff6e6'), 0.6);
        return new THREE.MeshBasicMaterial({ color: c, vertexColors: vc, name: m.name });
      }
      const t = toonMaterial({
        name: m.name, color: m.color ? m.color.clone() : new THREE.Color('#ffffff'), map: m.map || null, vertexColors: vc,
        transparent: m.transparent, opacity: m.opacity, side: m.side, depthWrite: true, alphaTest: m.alphaTest || 0,
        emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0), emissiveIntensity: m.emissiveIntensity ?? 1,
      });
      t.userData = { ...ud }; // keep the asset's hints (rimColour, glow, ghostRole, ...)
      return rim && (ud.translucent || m.transparent) ? addRim(t, rim, rimStrength) : t;
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    o.castShadow = cast; o.receiveShadow = !o.material.transparent;
  });
  return root;
}

// Scale a model so its height is `h` metres and stand it on y = 0, centred in x/z.
export function fitHeight(obj, h) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  obj.scale.multiplyScalar(h / Math.max(size.y, 1e-4));
  obj.updateMatrixWorld(true);
  box.setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= box.min.y;
  return obj;
}
