// ---------------------------------------------------------------
//  MINING HAVEN - world layout constants
//
//  Top-down: the world is a disc (radius ~238 m) split into 3 sectors
//  by a Y-shaped river that starts in a central pool:
//
//        CITY            (centre angle  90deg  -> +Z)
//   ---- river 150deg    river 30deg ----
//   JUNGLE (210deg)          CONSTRUCTION (330deg)
//             river 270deg
//
//  Angles are measured in the XZ plane from +X towards +Z.
// ---------------------------------------------------------------
export const DEG = Math.PI / 180;

export const LAND_Y = 1.5;
export const WATER_Y = -0.2;
export const BED_Y = -5.5;

export const POOL_R = 37; // central pool radius
export const ISLAND_R = 25; // hub island radius (the spawn plaza + the roundabout every bridge feeds into)
export const HUB_RING = 14.5; // centre line of the hub roundabout
export const HUB_BRIDGE = { from: ISLAND_R - 3, to: POOL_R + 12, width: 9 }; // hub bridges: island edge -> far bank
export const HUB_END = HUB_BRIDGE.to; // where the trails / haul roads / avenue leave the hub bridges on the far bank
export const RIVER_HALF = 9; // half width of river branches
export const WORLD_R = 780; // playable radius (mountain rim starts here)

export const TERRAIN_SIZE = 1700; // metres across (~1.7 km)
export const TERRAIN_SEG = 850; // 2 m cells
export const CHUNK = 85; // cells per terrain chunk edge (170 m): the unit of GPU culling

export const SECTOR_ANGLES = { city: 90, jungle: 210, construction: 330 };
export const BRANCHES = [30, 150, 270]; // river branch directions

export const polar = (r, deg) => [r * Math.cos(deg * DEG), r * Math.sin(deg * DEG)];

// construction sector local frame: f = distance along sector axis, l = lateral
export const CONS_AXIS = [Math.cos(330 * DEG), Math.sin(330 * DEG)];
export const CONS_LAT = [-CONS_AXIS[1], CONS_AXIS[0]];
export const consLoc = (f, l) => [
  CONS_AXIS[0] * f + CONS_LAT[0] * l,
  CONS_AXIS[1] * f + CONS_LAT[1] * l,
];

// open pit mine (construction sector)
export const PIT = (() => {
  const [x, z] = consLoc(135, 0);
  return {
    x, z, R: 48, depth: 12, floorFrac: 0.2,
    vx: -CONS_AXIS[0], vz: -CONS_AXIS[1], // from pit centre towards the hub
    nx: -(-CONS_AXIS[1]), nz: -CONS_AXIS[0],
  };
})();

export const SITES = {
  camp: polar(80, 206),
  temple: polar(128, 230),
  mine: polar(108, 186),
};

// terrain gets flattened around these (x,z,radius,blend)
export const PADS = [
  { x: SITES.camp[0], z: SITES.camp[1], r: 15, blend: 12 },
  { x: SITES.temple[0], z: SITES.temple[1], r: 20, blend: 16 },
  { x: SITES.mine[0], z: SITES.mine[1], r: 17, blend: 12 },
].concat([]);

// ---- outer world (beyond the 240 m core village) ------------------------
// Great Lake: the 150deg river flows into it. Deep enough for scuba and a submarine.
export const LAKE = (() => {
  const [x, z] = polar(560, 150);
  return { x, z, R: 170, depth: 36 };
})();

// Dive base on the lake shore (dock, shed, sub pen), 50deg round the shore from the river mouth
export const DIVE = (() => {
  const a = -80 * DEG;
  const x = LAKE.x + Math.cos(a) * (LAKE.R + 10), z = LAKE.z + Math.sin(a) * (LAKE.R + 10);
  return { x, z, toWater: [-Math.cos(a), -Math.sin(a)] };
})();

// Ridge Mine: a mountain in the construction sector with a cave network under it (axis aligned, enters toward +X)
export const RIDGE = (() => {
  const [x, z] = polar(540, 330);
  return { x, z, R: 110, height: 70, mouth: { x: x - 160, z, y: 0 } };
})();

// Sunken grotto: a flooded cave entered from the lake bed on the east side of the lake (enters toward +X, under the rising bed)
export const GROTTO = (() => ({ x: LAKE.x + 95, z: LAKE.z, mouth: { x: LAKE.x + 95, z: LAKE.z, y: 0 } }))();

export const PADS_OUTER = [
  { x: GROTTO.mouth.x, z: GROTTO.mouth.z, r: 12, blend: 12 },
  { x: RIDGE.mouth.x, z: RIDGE.mouth.z, r: 16, blend: 14 },
  { x: DIVE.x, z: DIVE.z, r: 22, blend: 14 },
];

PADS.push(...PADS_OUTER);

