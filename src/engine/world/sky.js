import * as THREE from 'three';
import { SUN_DIR } from './water.js';

export const HORIZON = new THREE.Color(0xcfe4f2);
export const ZENITH = new THREE.Color(0x3f86d6);

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uHorizon: { value: HORIZON },
      uTop: { value: ZENITH },
      uSun: { value: SUN_DIR },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon, uTop, uSun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uTop, pow(h, 0.5));
        float sd = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.86, 0.6) * (pow(sd, 900.0) * 4.0 + pow(sd, 14.0) * 0.28);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

/** a few lazy drifting clouds */
export function createClouds() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, fog: false });
  const geo = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Group();
    const n = 4 + ((i * 7) % 4);
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(geo, mat);
      const s = 14 + ((k * 13 + i * 5) % 14);
      m.scale.set(s * 1.5, s * 0.55, s);
      m.position.set((k - n / 2) * 18, ((k * 3) % 4) * 2, ((k * 5 + i) % 5) * 5);
      c.add(m);
    }
    const a = (i / 16) * Math.PI * 2 + i;
    const r = 150 + ((i * 97) % 650);
    c.position.set(Math.cos(a) * r, 150 + ((i * 17) % 40), Math.sin(a) * r);
    c.rotation.y = i;
    g.add(c);
  }
  g.userData.update = (dt) => {
    g.children.forEach((c) => {
      c.position.x += dt * 1.5;
      if (c.position.x > 900) c.position.x = -900;
    });
  };
  return g;
}

