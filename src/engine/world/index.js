import * as THREE from 'three';
import { createPhysics, addTerrainCollider } from './physics.js';
import { Dynamics } from './dynamics.js';
import { TERRAIN_SIZE } from '../config.js';
import { Batch, Flats } from './batch.js';
import { buildTerrain } from './terrainMesh.js';
import { cellHeld } from './terrain.js';
import { createWaterMaterial } from './water.js';
import { createSky, createClouds } from './sky.js';
import { buildRouteMesh, buildBridges } from './roads.js';
import { buildHub, SPAWN } from './hub.js';
import { buildCity } from './city.js';
import { buildJungle } from './jungle.js';
import { buildConstruction } from './construction.js';
import { buildFarms } from './farms.js';
import { buildRail, loadVehicles } from './rail.js';
import { SITES_LIST } from './caveSites.js';
import { buildDiveBase } from './diveBase.js';
import { windowTexture } from './textures.js';
import { OreField } from '../gameplay/ore.js';
import { Particles } from '../gameplay/particles.js';

const flatMat = (offset) => new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset,
});

/** Builds the whole Mining Haven world into `scene`. */
export async function buildWorld(scene, onProgress = () => {}) {
  const physics = await createPhysics();
  const col = physics.col;
  col.dyn = new Dynamics(scene, physics.R, physics.world);

  const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, flatShading: true });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const windowMat = new THREE.MeshStandardMaterial({ map: windowTexture(), vertexColors: true, roughness: 0.55, metalness: 0.1 });

  const ctx = {
    scene, col, propMat, windowMat,
    b: { hub: new Batch(), bridge: new Batch(), city: new Batch(), jungle: new Batch(), cons: new Batch(), ridge: new Batch(), grotto: new Batch(), dive: new Batch(), farm: new Batch() },
    glow: new Batch(),
    buildings: new Batch({ uv: true }),
    flats: { road: new Flats(), walk: new Flats(), mark: new Flats() },
    updaters: [],
    oreSpots: [],
  };

  // ground + water + sky
  SITES_LIST.forEach((s) => s.registerHoles()); // before the terrain is meshed
  const waterMat = createWaterMaterial();
  const terrain = buildTerrain(waterMat, (p) => onProgress(0.2 + p * 0.35, 'Generating terrain'));
  scene.add(terrain.group, terrain.waterGroup);
  addTerrainCollider(physics, terrain.heights, terrain.N, TERRAIN_SIZE, { zones: SITES_LIST.map((s) => s.zone()), isHole: cellHeld });
  const water = { material: waterMat };
  const sky = createSky();
  scene.add(sky);
  const clouds = createClouds();
  scene.add(clouds);

  // roads, bridges and the four regions
  scene.add(buildRouteMesh());
  buildBridges(ctx);
  buildHub(ctx);
  buildCity(ctx);
  buildJungle(ctx);
  buildConstruction(ctx);
  buildFarms(ctx);
  SITES_LIST.forEach((s) => s.build(ctx));
  const sub = buildDiveBase(ctx, physics);
  buildRail(ctx);

  // flush batches into single meshes
  for (const b of Object.values(ctx.b)) {
    const m = b.build(propMat);
    if (m) scene.add(m);
  }
  const bld = ctx.buildings.build(windowMat);
  if (bld) scene.add(bld);
  const glow = ctx.glow.build(glowMat, { castShadow: false, receiveShadow: false });
  if (glow) scene.add(glow);
  const walk = ctx.flats.walk.build(flatMat(-1));
  const road = ctx.flats.road.build(flatMat(-2));
  const mark = ctx.flats.mark.build(flatMat(-4));
  [walk, road, mark].forEach((m) => m && scene.add(m));

  const vehicles = Promise.resolve(); // the .glb tanker wagons are switched off for now (loadVehicles(ctx) brings them back)

  // gameplay
  const particles = new Particles(scene);
  const ore = new OreField(scene, ctx.oreSpots, particles);

  /** advance physics one frame (variable dt, clamped) and sync loose props */
  const step = (dt) => {
    physics.world.timestep = Math.min(1 / 30, Math.max(1 / 240, dt));
    physics.world.step();
    col.dyn.update();
  };

  return {
    physics, col, step, ore, vehicles, sub, propMat, caves: SITES_LIST.map((s) => s.cave()), particles, water, sky, clouds, terrain,
    fireflies: ctx.fireflies,
    updaters: ctx.updaters, forest: ctx.forest,
    spawn: SPAWN,
  };
}







