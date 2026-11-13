import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const SUB_LENGTH = 9.6; // metres, hull only (matches the physics capsule in submarine.js)
const PROP_PARTS = /^(Plane\.?00\d|Cylinder\.?001)$/; // the propeller hub + its five blades
const loader = new GLTFLoader();

/**
 * The submarine's visual holder: faces +Z, centred on the hull. It starts empty; loadSubmarineModel() fills it with
 * submarine.glb. userData.prop is the spinning propeller pivot, userData.lights the two headlamps.
 */
export function createSubmarineMesh() {
  const g = new THREE.Group(), prop = new THREE.Group(), lights = [], cones = [], nav = [];
  g.add(prop);
  const lens = new THREE.MeshBasicMaterial({ color: 0xfff4d0 });
  for (const s of [-1, 1]) {
    const sp = new THREE.SpotLight(0xdff6ff, 0, 95, 0.55, 0.55, 1.0); // headlamps: wide beam, soft edge
    sp.position.set(s * 0.4, 0.05, 4.5); sp.target.position.set(s * 0.25, -0.5, 18);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), lens); bulb.position.set(s * 0.4, 0.05, 4.55);
    // a faint cone of lit water in front of each lamp
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.4, 18, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xcfeeff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    cone.geometry.translate(0, -9, 0); cone.rotation.x = -Math.PI / 2 + 0.03; cone.position.set(s * 0.4, 0.05, 4.6); cone.visible = false;
    g.add(sp, sp.target, bulb, cone); lights.push(sp); cones.push(cone);
  }
  const flood = new THREE.PointLight(0xcfeeff, 0, 22, 1.6); flood.position.set(0, 0.2, 3.2); g.add(flood); lights.push(flood);
  // navigation lights: red to port, green to starboard, a white strobe above (always on)
  for (const [x, y, z, c] of [[0.34, 0.95, 1.6, 0xff2a2a], [-0.34, 0.95, 1.6, 0x2aff5a], [0, 1.5, 1.6, 0xffffff]]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); g.add(m); nav.push(m);
  }
  g.userData = { prop, lights, cones, nav, flood };
  return g;
}
/** load /models/submarine.glb into the holder: scaled to SUB_LENGTH, nose to +Z, propeller on its own pivot */
export async function loadSubmarineModel(holder, url = '/models/submarine.glb') {
  const model = (await loader.loadAsync(url)).scene;
  model.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  model.updateMatrixWorld(true);
  const node = (re) => { let f = null; model.traverse((o) => { if (!f && re.test(o.name)) f = o; }); return f; };
  const hullBox = new THREE.Box3().setFromObject(node(/^Cylinder\.?004_Material/));
  const size = hullBox.getSize(new THREE.Vector3()), long = size.z >= size.x ? 'z' : 'x';
  const s = SUB_LENGTH / size[long];
  const inner = new THREE.Group();
  inner.add(model);
  model.position.copy(hullBox.getCenter(new THREE.Vector3()).negate());
  inner.scale.setScalar(s);
  inner.rotation.y = Math.PI; // the model's bow points -Z
  holder.add(inner);
  holder.updateMatrixWorld(true);
  const prop = holder.userData.prop, parts = [];
  model.traverse((o) => { if (PROP_PARTS.test(o.name.replace(/\./g, '')) || PROP_PARTS.test(o.name)) parts.push(o); });
  prop.position.copy(new THREE.Box3().setFromObject(parts.find((o) => /^Cylinder\.?001$/.test(o.name)) ?? parts[0]).getCenter(new THREE.Vector3()));
  prop.updateMatrixWorld(true);
  for (const p of parts) prop.attach(p);
  return holder;
}

/** copy a physics body's pose onto the mesh; spin the propeller with the throttle */
export function syncSubmarine(mesh, sub, throttle, dt, lightsOn) {
  const t = sub.body.translation(), r = sub.body.rotation();
  mesh.position.set(t.x, t.y, t.z);
  mesh.quaternion.set(r.x, r.y, r.z, r.w);
  mesh.userData.prop.rotation.z += throttle * 14 * dt;
  const { lights, cones, nav, flood } = mesh.userData;
  for (const l of lights) l.intensity = lightsOn ? (l === flood ? 55 : 700) : 0;
  for (const c of cones) c.visible = lightsOn;
  const blink = Math.sin(performance.now() * 0.006) > 0.2;
  nav.forEach((n, i) => { n.visible = i < 2 || blink; });
}