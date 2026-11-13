/**
 * Minerals that can be found by digging on a geophysical target. Merged into the ore registry (gameplay/ore.js),
 * so a recovered sample shows up in the field kit like any other.
 */
export const DEPOSIT_MINERALS = {
  copper: { name: 'Copper Ore (Cu)', color: 0xc7783a, formula: 'CuFeS2 / Cu5FeS4' },
  gold: { name: 'Gold Ore (Au)', color: 0xe3b72a, formula: 'Au in quartz' },
  silver: { name: 'Silver Ore (Ag)', color: 0xc9d0d6, formula: 'Ag2S' },
  iron: { name: 'Iron Ore', color: 0x8a3b2e, formula: 'Fe2O3' },
  magnetite: { name: 'Magnetite', color: 0x2c2f36, formula: 'Fe3O4' },
  bauxite: { name: 'Bauxite (Al)', color: 0xb4623f, formula: 'Al(OH)3 / AlO(OH)' },
  nickel: { name: 'Nickel Ore (Ni)', color: 0x6fa58a, formula: '(Fe,Ni)9S8' },
  cobalt: { name: 'Cobalt Ore (Co)', color: 0x3a62b8, formula: 'CoAsS' },
  lithium: { name: 'Lithium (Spodumene)', color: 0xd8c6e8, formula: 'LiAlSi2O6' },
  graphite: { name: 'Graphite', color: 0x4a4d52, formula: 'C' },
  tin: { name: 'Tin Ore (Sn)', color: 0x9a8f7a, formula: 'SnO2' },
  tungsten: { name: 'Tungsten Ore (W)', color: 0x7a6a9a, formula: 'CaWO4' },
  uranium: { name: 'Uranium Ore (U)', color: 0xd6e03a, formula: 'UO2' },
  thorium: { name: 'Thorium Ore (Th)', color: 0xe08a3a, formula: 'ThSiO4' },
  ree: { name: 'Rare Earth Ore (REE)', color: 0xc45ab0, formula: '(Ce,La,Nd)CO3F' },
  cee: { name: 'Critical Element Ore (CEE)', color: 0x4ab8c4, formula: 'Nb-Ta-Zr oxides' },
};
