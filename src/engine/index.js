import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildWorld } from './world/index.js';
import { Player } from './player/player.js';
import { loadCharacter } from './player/loadCharacter.js';
import { createFleet } from './agents/vehicles.js';
import { createNpcs } from './agents/npcs.js';
import { createFarmers } from './agents/farmers.js';
import { Input } from './input.js';
import { SUN_DIR } from './world/water.js';
import { HORIZON } from './world/sky.js';
import { BRIDGES } from './world/layout.js';
import { drawMinimapBg, drawMinimapFg } from './minimap.js';
import { damp } from './math.js';
import { caveFactor, blend, insideCave, underwaterOptics } from './ambience.js';
import { waterLevelAt } from './world/terrain.js';
import { Particles } from './gameplay/particles.js';
import { createSurvey } from './survey/survey.js';
import { createMineralSpread } from './gameplay/mineralSpread.js';
import { lampBeam } from './player/headlamp.js';

export const QUALITY = {
  low: { pixelRatio: 1, shadow: 0 },
  medium: { pixelRatio: 1.25, shadow: 1024 },
  high: { pixelRatio: 1.75, shadow: 2048 },
};
const SHADOW_R = 56;

/**
 * Boots the 3D world into `canvas`. All UI talks to it through `store` (state out) and the
 * returned handle (commands in). Nothing here touches React.
 */
export async function startEngine({ canvas, store, onProgress = () => {} }) {
  const input = new Input();
  const detachInput = input.attach();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  // image-based lighting so metals (vehicles, ore, steel) reflect something instead of rendering black
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.4;
  scene.fog = new THREE.FogExp2(HORIZON, 0.0024);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 1100);
  const hemi = new THREE.HemisphereLight(0xc4d8ea, 0x6b5a3d, 1.0);
  scene.add(hemi, camera);
  // headlamp (L): a wide beam round you and a narrow long one ahead, both worn on the head and aimed where the camera looks
  const lamp = new THREE.SpotLight(0xfff0d0, 0, 46, 0.85, 0.7, 1.0), lampFar = new THREE.SpotLight(0xfff0d0, 0, 95, 0.26, 0.5, 0.8);
  scene.add(lamp, lamp.target, lampFar, lampFar.target);
  const lampDir = new THREE.Vector3(), lampAt = new THREE.Vector3();
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.8);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -SHADOW_R, right: SHADOW_R, top: SHADOW_R, bottom: -SHADOW_R, near: 1, far: 320 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);

  let shadowSize = 0;
  const applyQuality = (q = 'high') => {
    const p = QUALITY[q] ?? QUALITY.high;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatio));
    sun.castShadow = p.shadow > 0;
    if (p.shadow && p.shadow !== shadowSize) {
      shadowSize = p.shadow;
      sun.shadow.map?.dispose(); sun.shadow.map = null;
      sun.shadow.mapSize.set(shadowSize, shadowSize);
    }
    resize();
  };
  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);

  onProgress(0.1, 'Preparing');
  await new Promise((r) => setTimeout(r, 30)); // let the loading screen paint
  const world = await buildWorld(scene, onProgress);
  onProgress(0.85, 'Starting simulation');
  const bubbles = new Particles(scene, 140, { gravity: -1.3, sphere: true, size: 0.07, color: 0xdff6ff });
  const player = new Player({ scene, camera, world, input, store, bubbles, character: await loadCharacter(world.propMat) });
  const fleet = createFleet({ scene, world, propMat: world.propMat });
  player.fleet = fleet;
  fleet.observer = player.pos;
  const npcs = createNpcs({ scene, world, fleet, propMat: world.propMat, bubbles });
  const farmers = createFarmers({ scene, propMat: world.propMat });
  const survey = createSurvey({ scene, world, store, player });
  const spread = createMineralSpread({ geo: survey.geo, survey, store }); // the minerals shift every 15 min of play
  player.survey = survey;
  // .glb models are switched off for now: low-poly stand-ins only (fleet.loadGmc() / loadTaxi() / loadJeep() / loadJcb() / loadTruck() bring them back)
  store.set({ oreTotal: world.ore.total });
  applyQuality(store.get().settings.quality);

  // ---- simulation (shared by the render loop and by tests)
  let time = 0;
  const simulate = (dt) => {
    time += dt;
    input.poll();
    survey.input(input);
    player.update(dt, time);
    survey.update(dt);
    cave = damp(cave, caveFactor(insideCave(world.caves, player.pos.x, player.pos.z, player.pos.y)), 4, dt);
    world.step(dt);
    world.ore.update(dt, time);
    world.particles.update(dt);
    bubbles.update(dt);
    fleet.update(dt);
    world.forest?.update(player.pos.x, player.pos.z);
    npcs.update(dt);
    farmers.update(dt);
    spread.update(dt);
    for (const u of world.updaters) u(dt, time);
  };

  let minimap = null, last = performance.now(), running = true, cave = 0;
  const DARK = new THREE.Color(0x0b0e13), TEAL = new THREE.Color(0x0e6a74);
  const frame = (now) => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (store.get().phase === 'playing') simulate(dt);
    else time += dt;
    world.clouds.userData.update(dt);
    world.water.material.uniforms.uTime.value = time;
    const f = world.fireflies?.uniforms;
    if (f) { f.uTime.value = time; f.uCenter.value.set(player.pos.x, player.pos.y, player.pos.z); f.uAlpha.value = damp(f.uAlpha.value, player.jungleW * 0.6, 2, dt); }
    // underground: pitch dark and dusty - only the headlamp (L) lights it
    const uw = underwaterOptics(waterLevelAt(camera.position.x, camera.position.z) - camera.position.y);
    // (inside a cave it is dim and cold but you can still make out the rock; the headlamp is what really lights the way)
    scene.environmentIntensity = blend(cave, 0.4, 0.22); hemi.intensity = blend(cave, 1.0, 0.85); sun.intensity = blend(cave, 2.8, 0);
    hemi.color.setHex(cave > 0.5 ? 0x8aa0c0 : 0xc4d8ea);
    const beam = lampBeam(player.lamp, { cave, underwater: !!uw.f });
    const body = player.char.root.visible && !player.car && !player.drone && !player.vehicle;
    camera.getWorldDirection(lampDir);
    if (body) lampAt.set(player.pos.x, player.visY + 1.75, player.pos.z).addScaledVector(lampDir, 0.35); else lampAt.copy(camera.position);
    for (const [L, I, D] of [[lamp, beam.intensity, beam.distance], [lampFar, beam.reach, beam.reachDistance]]) {
      L.position.copy(lampAt); L.target.position.copy(lampAt).addScaledVector(lampDir, 12);
      L.intensity = damp(L.intensity, I, 14, dt); L.distance = D; L.color.setHex(beam.color);
    }
    scene.fog.color.copy(HORIZON).lerp(DARK, cave);
    // under water: green-blue, murky, dim; the sky disappears (the surface is overhead)
    world.sky.visible = world.clouds.visible = !uw.f;
    if (uw.f) {
      scene.fog.color.lerp(TEAL.clone().multiplyScalar(0.15 + 0.85 * uw.light), 1);
      sun.intensity *= uw.light; hemi.intensity *= uw.light; scene.environmentIntensity *= uw.light;
      hemi.intensity = Math.max(hemi.intensity, cave * 0.55); scene.environmentIntensity = Math.max(scene.environmentIntensity, cave * 0.16); // a flooded cave is still not black
      renderer.setClearColor(scene.fog.color);
    }
    scene.fog.density = uw.f ? uw.fog * blend(cave, 1, 0.55) : damp(scene.fog.density, blend(cave, 0.0024 + player.jungleW * 0.0016, 0.016), 3, dt);
    world.sky.position.copy(camera.position);
    const texel = (SHADOW_R * 2) / (shadowSize || 2048);
    const sx = Math.round(player.pos.x / texel) * texel, sz = Math.round(player.pos.z / texel) * texel, sy = Math.round(player.pos.y / texel) * texel;
    sun.target.position.set(sx, sy, sz);
    sun.position.set(sx + SUN_DIR.x * 150, sy + SUN_DIR.y * 150, sz + SUN_DIR.z * 150);
    renderer.render(scene, camera);
    if (minimap) drawMinimapFg(minimap.fg, player, { fleet, npcs, survey });
  };
  renderer.setAnimationLoop(frame);

  // ---- pointer lock (desktop)
  // the survey menu / map need the mouse: opening one frees the pointer WITHOUT pausing, closing one takes it back
  const uiOpen = () => store.get().surveyMenu || store.get().surveyMap;
  const onLockChange = () => {
    const locked = document.pointerLockElement === canvas;
    store.set({ locked });
    if (!locked && store.get().phase === 'playing' && !store.get().touch && !uiOpen()) store.set({ phase: 'paused' });
  };
  const onMouseMove = (e) => { if (document.pointerLockElement === canvas) input.addLook(e.movementX, e.movementY); };
  const onMouseDown = (e) => {
    if (document.pointerLockElement === canvas) { if (e.button === 0) input.press('swing'); }
    else if (store.get().phase === 'playing' && !store.get().touch && !uiOpen()) handle.lock();
  };
  const onWheel = (e) => player.zoom(Math.sign(e.deltaY) * 0.8);
  // pausing by ANY route (menu button, touch pause, ...) must hand the mouse back to the UI
  let wasUi = false;
  const offPhase = store.subscribe(() => {
    const st = store.get(), ui = !!uiOpen();
    if ((st.phase === 'paused' || ui) && document.pointerLockElement === canvas) document.exitPointerLock();
    if (wasUi && !ui && st.phase === 'playing' && !st.touch) handle.lock();
    wasUi = ui;
  });
  document.addEventListener('pointerlockchange', onLockChange);
  window.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('wheel', onWheel, { passive: true });

  const handle = {
    input, player, world, scene, camera, renderer, simulate, fleet, npcs, farmers, survey, spread,
    get caveFactor() { return cave; }, // 0 outdoors .. 1 deep underground
    /** pause / resume drawing (the simulation clock is separate). Handy for tests and for background tabs. */
    setRendering(on) { renderer.setAnimationLoop(on ? frame : null); },
    lock() { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* unsupported */ } },
    unlock() { document.exitPointerLock?.(); },
    applyQuality,
    attachMinimap(bg, fg) { minimap = { bg, fg }; drawMinimapBg(bg, world.terrain); },
    detachMinimap() { minimap = null; },
    dispose() {
      running = false;
      renderer.setAnimationLoop(null);
      detachInput();
      offPhase();
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onLockChange);
      renderer.dispose();
    },
  };
  onProgress(1, 'Ready');
  handle.BRIDGES = BRIDGES;
  return handle;
}








