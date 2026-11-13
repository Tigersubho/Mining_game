import { LowPolyCharacter } from './lowPolyCharacter.js';

/** The player's body: a low-poly puppet for now (the Mixamo .glb character is switched off; see glbCharacter.js to bring it back). */
export async function loadCharacter(material) {
  return new LowPolyCharacter(material);
}
