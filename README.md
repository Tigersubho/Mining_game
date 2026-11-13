# Mining Haven

An explorable mining world: ~1.7 km across, a village, jungle, construction site with an open-pit mine, a mountain
mine with a cave network, a great lake with a dive base, a submarine and a flooded cave.
**Next.js + React** UI, **Three.js** rendering, **Rapier** physics. Keyboard + mouse, touch and gamepad.

```bash
npm install
npm run dev                          # http://localhost:3000
npm run build && npm start
npm test                             # unit tests (Vitest, ~130 tests, a few seconds)
npm run build && npm run test:uat    # acceptance tests in a real browser (Chrome; CHROME_PATH to override)
node tests/uat/shots.mjs shots.json  # visual check: screenshots at chosen positions
```

## Controls

| Action | Keyboard / mouse | Touch | Gamepad |
| --- | --- | --- | --- |
| Move | W A S D | left joystick | left stick |
| Look | mouse (captured) / arrows | drag the right side | right stick |
| Sprint | Shift | RUN | B / L3 |
| Jump / swim up | Space | JUMP / UP | A / RB |
| Dive / swim down | C or Ctrl | DOWN | LB |
| Pickaxe equip / use | F / E or click | EQUIP / SWING | Y / X |
| Scuba gear | G | SCUBA | - |
| Board / exit submarine | V | BOARD | - |
| Headlamp (caves, deep water) | L | - | - |
| Sub ballast / lights | B / L | - | - |
| Map / respawn / pause | M / R / Esc | tap map / - / pause | - |
| **Survey:** equipment menu / geophysical map | U / Z | - | - |
| Swap pickaxe <-> hand sensor / save anomaly / continue survey | Q / X / T | - | - |
| Drive car or rover, launch drone / drone off | K / O | - | - |
| Call the excavator to the selected target (ore deeper than 1.5 m) | Y | - | - |

## The world

| Place | What to find |
| --- | --- |
| Hub island | 25 m radius spawn plaza with a **roundabout**; three two-lane bridges (city, jungle, construction) all meet it, so any district can drive to any other |
| City (north) | street grid, towers, elevated highway, traffic |
| Jungle (west) | dense forest, camp, temple ruin, legacy mine, trails |
| Construction (east) | building frame + crane, container yard, **open-pit mine (flooded - diveable)**, gate, your pickup |
| **Ridge Mine** (far east) | rail line, portal, ~600 m of tunnels and chambers with stalactites; pitch dark without the headlamp (L); ore hidden in the rock |
| **Great Lake** (far west) | **dive base** (pier, shed, tanks), **submarine**, two wrecks, ore hidden in the bed, **flooded Sunken Grotto** (scuba + headlamp) |
| The river | feeds the lake; 9 bridges; deep enough to dive near the hub pool |

**Finding ore.** Nothing in the world looks like ore. Every outcrop is a plain grey rock (what is in it shows only when it breaks), nothing
glows, and the sonar lists hard contacts, not minerals. Ore is found with the survey instruments (below), in four places: under the surface
across the whole map, in the rock of the Ridge Mine, in the flooded grotto, and in the lake, river and pit beds.

**Getting it out.** A pickaxe opens the top 1.5 m and tells you nothing about what is deeper. Ore in the caves and in the beds is shallow,
so there it is always the pickaxe. On the surface, a target the survey puts deeper than 1.5 m needs the **excavator**: select the saved
location and press **Y** (or EXCAVATE in the map). It drives in from the yard on dry ground, scoops the soil out (15-40 s, longer the
deeper), tips it on a heap and leaves whatever is down there exposed: ore to collect with the pickaxe, or a barren dyke. One job at a time;
it cannot enter a cave or work under water.

**The caves.** The Ridge Mine and the flooded Sunken Grotto are pitch dark: press **L** for the headlamp (15 minutes of battery; it recharges
when off, quickly in daylight). The beam is warm and long in the dry mine, tinted and shorter under water. Carry a hand sensor in: a survey
inside a cave reads the rock of that cave, never the hill above it, and is kept on its own map layer.

**The 15-minute shift.** Every 15 minutes of play all the hidden deposits (and the barren decoys) move to new places, everywhere. You get
a one-minute warning; then readings, anomalies, saved locations and old pits are cleared, because they describe ground that no longer
holds anything. Ore that is already exposed stays until you collect it. The field kit shows the countdown.

Air: free-diving ~45 s (faster with depth), scuba ~12 min near the surface (a third of that at 20 m). Run out of air and the dive team
recovers you at the base. The tank refills there. The submarine has a sampling arm (E).

## Town life: traffic and people

**14 cars on closed loops (nothing ever spawns or vanishes) + 1 boat:** 3 taxis (city stands), 2 private cars (city), the **GMC Sierra** (city depot -> hub roundabout -> mine gate -> back, forever), 2 safari jeeps on the jungle **mud loop** (jeeps never leave the jungle), 1 pickup + 1 JCB backhoe (mining area), and 4 tourers: two city cars to the jungle's *edge*, one to the mine, one jeep on the jungle landing trail. Cars on their routes ride the bridge decks and never enter water; a car you leave behind drives home through the nearest bridge; a car that gets stuck brakes, backs up twice, then is moved to a dry spot out of sight. The **river boat** runs hub quay -> jungle landing -> dive-base pier and back, stopping at each.

**18 NPCs** with their own routines: 4 office workers, 2 police, 3 civilians, 3 miners, 2 drivers, 2 scuba divers (dive off the pier), 1 fisherman, 1 safari guide. They walk a graph of sidewalks / trails / paths, wait at stops, and board only vehicles that suit them (office -> taxi, miners -> pickups + the GMC, scuba / fisherman -> boat, guide -> jeep, police ride nothing); riders vanish into the vehicle and step out at another stop. All vehicle and NPC models are low-poly placeholders (`src/engine/agents/vehicleModels.js`, `puppet.js`): send final GLBs and they swap in one by one.

## Geophysical exploration

Press **U** for the GEOPHYSICAL EQUIPMENT menu: seven instruments (GPR, magnetometer, gamma-ray spectrometer, EMI, resistivity, IP, seismic), each reading a *different* property of a hidden model of the ground (`src/engine/survey/geology.js`),
and three mountings: **hand** (replaces the pickaxe; Q swaps back), **rover** (K to drive; slows on rock, stops on steep or wet ground) and **drone** (K to launch; WASD / Space / C / Shift; O = DRONE OFF, the drone lands where it is).
Readings are georeferenced, splatted into sparse 2 m grids and interpolated incrementally; **Z** opens the geophysical map (TMI with sun-shading and contours, K-Th-U ternary, resistivity / IP / EMI / seismic maps, line profiles and a GPR radargram).
Anomalies are picked from the data (regional field removed), interpreted across instruments, and only ever called *possible*: decoys (dykes, clay, black shale, granite, faults, voids) light up some instruments with nothing to dig.
X saves a location to the site map and navigation, with an estimated depth that says whether a pickaxe will do or the excavator is needed; a real deposit exposes ore (16 minerals) you collect by swinging. The drone shows a live circular scanner and a 2.5D subsurface block.

## Architecture

```
src/
  app/ components/   Next.js UI: Game shell, Hud (+ dive gauges), Touch, Screens (start / pause / settings)
  ui/                store.js (engine -> UI), settings, format helpers
  engine/            framework-free game (never imports React)
    index.js           startEngine(): renderer, loop, pointer lock, lighting, underwater / cave ambience
    input.js           keyboard + touch + gamepad -> one model
    ambience.js        cave + underwater light/fog maths (pure)
    player/            motor.js (Rapier character), waterState.js, breath.js, intent.js (pure),
                       player.js, character.js (procedural miner), glbCharacter.js + animMap.js (your rigged model)
    agents/            path.js, follower.js (route following + stops), graph.js, brain.js (NPC behaviour),
                       fleet.js (the 14 + boat: routes, stops), walkWorld.js (NPC walk graph), vehicles.js (water guard, stuck recovery),
                       safety.js (wetAt / planCrossing over bridges), npcs.js, puppet.js
    survey/            geology.js (hidden deposits), sensors.js, grid.js, analysis.js, survey.js, platforms.js (rover, drone),
                       models.js (low-poly instruments, excavator), render.js (map / profile / scanner / 2.5D painters), minerals.js,
                       excavator.js (drive in, scoop cycle with joint IK, spoil heap)
    vehicles/          submarine.js (buoyancy / ballast / thrust / drag on a Rapier body), submarineView.js
    world/             terrain.js (height, colour, water levels, holes), terrainMesh.js (chunked), physics.js,
                       cave.js (pure cave generator) + caveSites.js (Ridge Mine, Sunken Grotto),
                       regions (hub, city, jungle, construction), diveBase.js, rail.js, assets.js (GLB helper)
    gameplay/          ore.js (plain-rock outcrops, exposed ore), mineralSpread.js (the 15-minute shift), sonar.js, particles.js
tests/
  unit/              Vitest: physics, motor, input, intent, store, format, terrain, caves, portal, submarine,
                     underwater (water state / breath / optics), assets, GLB character ...
  uat/               run.mjs (acceptance, real browser), lib.mjs, shots.mjs (visual inspection)
```

Rules: the engine talks to the UI only through the `store` and the handle from `startEngine()`. Anything that can be
pure is a small module with unit tests first. Caves are one generator shared by the dry mine and the flooded grotto.

## Your models (currently switched off: everything is low-poly until the models are final)

The `.glb` loaders are still in the code (`fleet.loadGmc()` etc., `loadSubmarineModel`, `loadTree`, `loadVehicles` for the wagons, `glbCharacter.js`); they are simply not called. The player is `player/lowPolyCharacter.js`.

* `public/models/gmc_sierra_hd2500.glb` - pickup (2 placed; the model's paint is black), `tanker_wagon.glb` - on the mine siding.
  Placed with `placeGLB()` (auto-scales to metres, merges ~400 meshes into ~100 draw calls).
* **Character:** put a rigged `.glb` (idle / walk / run / jump / swim animations; Mixamo works) in `public/models/` and set
  `"character": "<file>.glb"` in `public/models/manifest.json`. Clip names are matched fuzzily; the pickaxe and scuba gear
  attach to the hand / spine / head bones. Without it you get the built-in miner.
* Attribution: GMC Sierra HD2500 by "01" (CC-BY 4.0). The tanker wagon ("JoTrain The Aussie", Sketchfab Standard licence)
  is fine for private use but must not be redistributed publicly.

## Performance

Settings -> Graphics: LOW (pixel ratio 1, no shadows), MEDIUM, HIGH. Terrain, trees and ore are chunked so the GPU culls
whole groups; distant trees use lower-poly crowns. The whole ~1.7 km world builds in ~4-10 s.
