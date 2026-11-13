import * as THREE from 'three';
import { Puppet } from '../agents/puppet.js';
import { createPickaxe, createScubaGear } from './gear.js';

const SWING_TIME = 0.6, IMPACT_AT = 0.3;

/**
 * The player's body, low-poly: a merged-mesh Puppet (the miner costume) with the pickaxe and scuba gear attached.
 * Same API the Player uses as the .glb character: root, update(dt, state), setEquipped, setScuba, swing, onImpact, swingT.
 */
export class LowPolyCharacter {
  constructor(material) {
    this.puppet = new Puppet('miner', material, 0);
    this.root = this.puppet.root;
    this.swingT = -1; this.impacted = false; this.onImpact = null;
    this.equipped = false;
    this.tool = 'pick'; this.sensor = null; // the hand-mounted survey instrument (replaces the pickaxe in the hand)
    this.pick = createPickaxe();
    const gear = createScubaGear();
    this.scubaBack = gear.back; this.scubaMask = gear.mask;
    this.puppet.torso.add(this.scubaBack);
    this.puppet.head.add(this.scubaMask);
    this.lampMesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2c0 })); // the headlamp bulb on the hat
    this.lampMesh.position.set(0, 0.13, 0.19); this.lampMesh.visible = false; this.puppet.head.add(this.lampMesh);
    this.setEquipped(false);
  }

  setEquipped(on) {
    this.equipped = on;
    this.pick.removeFromParent();
    this.sensor?.removeFromParent();
    const p = this.puppet, sensorInHand = on && this.tool === 'sensor' && this.sensor;
    if (on && !sensorInHand) { p.armR.add(this.pick); this.pick.position.set(0, -0.57, 0.04); this.pick.rotation.set(0.5, 0, 0); }
    else { p.torso.add(this.pick); this.pick.position.set(0.04, 0.3, -0.2); this.pick.rotation.set(0.1, 0, -0.55); } // stowed on the back
    if (sensorInHand) { p.armR.add(this.sensor); this.sensor.position.set(0, -0.6, 0.02); this.sensor.rotation.set(0.45, 0, 0); }
  }

  /** the hand instrument model (null = none fitted) */
  setSensorModel(model) {
    this.sensor?.removeFromParent();
    this.sensor = model;
    this.setEquipped(this.equipped);
  }

  setLamp(on) { this.lampMesh.visible = on; }

  setScuba(on) { this.scubaBack.visible = this.scubaMask.visible = on; }

  swing() {
    if (!this.equipped || this.swingT >= 0 || (this.tool === 'sensor' && this.sensor)) return false;
    this.swingT = 0; this.impacted = false;
    return true;
  }

  /** state: {speed, grounded, vy, swimming} */
  update(dt, s) {
    const anim = s.swimming ? 'swim' : s.speed > 0.3 && s.grounded ? 'walk' : 'idle';
    this.puppet.animate(dt, anim, s.speed);
    const arm = this.puppet.armR;
    if (this.swingT >= 0) {
      this.swingT += dt;
      if (!this.impacted && this.swingT >= IMPACT_AT) { this.impacted = true; this.onImpact?.(); }
      if (this.swingT >= SWING_TIME) this.swingT = -1;
    }
    if (this.equipped && !s.swimming && this.tool === 'sensor' && this.sensor) arm.rotation.x = -0.45; // instrument held out in front
    else if (this.equipped && !s.swimming) {
      const t = this.swingT;
      arm.rotation.x = t < 0 ? -0.5 : t < IMPACT_AT ? THREE.MathUtils.lerp(-0.5, -2.6, t / IMPACT_AT) : THREE.MathUtils.lerp(-2.6, 0.2, (t - IMPACT_AT) / (SWING_TIME - IMPACT_AT));
    }
  }
}
