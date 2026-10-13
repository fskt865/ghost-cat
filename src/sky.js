// The night outside: sky dome, stars, moon, and a distant city with lit windows.
// Shared by every area; seen through windows indoors and in full from the balcony.
import * as THREE from 'three';
import { Baker, rng, mix, glowTexture, radialTexture, clamp } from './util.js';

const PI = Math.PI;

export function buildSky(scene, { fog = '#2c2347', fogNear = 9, fogFar = 46, centre = new THREE.Vector3(), moonPos = new THREE.Vector3(-30, 26, -70), seed = 7, cityRadius = [42, 34], cityArc = 1.7, cityCount = 34, cityLift = 0 } = {}) {
  const R = rng(seed);
  scene.fog = new THREE.Fog(fog, fogNear, fogFar);
  scene.background = new THREE.Color(fog);
  const group = new THREE.Group();
  group.position.copy(centre);
  scene.add(group);

  // dome: deep indigo overhead, plum haze at the horizon, a warm city glow low down
  {
    const g = new THREE.SphereGeometry(95, 32, 16);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 95;
      if (y < 0) c.copy(mix('#3a2b52', '#241b38', -y * 1.5));
      else c.copy(mix('#5a3d64', '#3b2d5c', clamp(y / 0.18, 0, 1)).lerp(mix('#241d4c', '#0c0a22', (y - 0.15) / 0.8), clamp((y - 0.08) / 0.3, 0, 1)));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10;
    group.add(sky);
  }

  // stars
  const stars = (() => {
    const n = 380, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = R() * 2 * PI, v = 0.06 + R() * 0.9, rr = 85;
      pos.set([Math.cos(u) * Math.sqrt(1 - v * v) * rr, v * rr, Math.sin(u) * Math.sqrt(1 - v * v) * rr], i * 3);
      const b = 0.35 + R() * 0.65, tint = R() < 0.2 ? [1, 0.9, 0.75] : [0.85, 0.9, 1];
      col.set([tint[0] * b, tint[1] * b, tint[2] * b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    pts.renderOrder = -9;
    group.add(pts);
    return pts;
  })();

  // moon
  const moonTex = radialTexture([[0, '#fffdf2'], [0.40, '#fff3d2'], [0.44, 'rgba(255,240,210,0.30)'], [0.7, 'rgba(255,230,210,0.06)'], [1, 'rgba(255,230,210,0)']], 128);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, depthWrite: false, transparent: true }));
  moon.position.copy(moonPos); moon.scale.setScalar(14); moon.renderOrder = -8;
  group.add(moon);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#8f86d8', opacity: 0.25, fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
  halo.position.copy(moonPos); halo.scale.setScalar(48); halo.renderOrder = -8;
  group.add(halo);

  // city: buildings below and around, lit windows
  {
    const bld = new Baker(), win = bld; // one mesh: both are unlit vertex colour
    const n = cityCount;
    for (let i = 0; i < n; i++) {
      const phi = -cityArc + (2 * cityArc * (i + R() * 0.7)) / n;
      const rad = cityRadius[0] + R() * cityRadius[1];
      const x = Math.sin(phi) * rad, z = -Math.cos(phi) * rad;
      const w = 4 + R() * 6, d = 4 + R() * 4, top = -12 + cityLift + R() * 14 + (R() < 0.15 ? 9 : 0), base = -50;
      const h = top - base, ry = -phi + (R() - 0.5) * 0.2;
      const shade = mix('#1d1832', '#2c2445', R());
      bld.add(new THREE.BoxGeometry(w, h, d), shade, { pos: [x, base + h / 2, z], rot: [0, ry, 0] });
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0));
      const local = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(new THREE.Vector3(x, 0, z));
      if (R() < 0.35) {
        const t = local((R() - 0.5) * w * 0.5, top, 0);
        bld.add(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 10), shade, { pos: [t.x, top + 1.5, t.z] });
        bld.add(new THREE.ConeGeometry(1.05, 0.7, 10), shade, { pos: [t.x, top + 2.65, t.z] });
      }
      const cols = Math.max(2, Math.floor(w / 1.2)), rows = Math.floor((top + 40) / 1.4);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (R() > 0.2) continue;
        const lx = -w / 2 + (c + 0.5) * (w / cols), ly = top - 0.9 - r * 1.4;
        const p = local(lx, ly, d / 2 + 0.02);
        const wc = R() < 0.12 ? '#9fcfff' : ['#ffcf7a', '#ffb067', '#ffe2a6', '#ffc28a'][Math.floor(R() * 4)];
        win.add(new THREE.PlaneGeometry(0.55, 0.7), wc, { pos: [p.x, ly, p.z], rot: [0, ry, 0] });
      }
    }
    group.add(new THREE.Mesh(bld.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
  }

  const setStarScale = (pr) => { stars.material.size = 2.4 * pr; };
  return { group, moon, stars, setStarScale };
}
