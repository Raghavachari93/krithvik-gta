import type { CharacterLook } from './CharacterModel';

export interface CharacterDef {
  id: string;
  name: string;
  tagline: string;
  bio: string;
  look: CharacterLook;
  health: number;
  speed: number;
  stamina: number;
  melee: number;
  accent: string;
}

export const ROSTER: CharacterDef[] = [
  {
    id: 'rico',
    name: 'Rico Santos',
    tagline: 'The Wheelman',
    bio: 'A getaway driver who skipped town five years ago. Now he is back in Neon Bay with nothing but a debt and a reputation.',
    look: { skin: 0xc68e64, shirt: 0xf2f2f2, pants: 0x2a3a5a, shoes: 0x111111, hair: 0x1a1410, hairStyle: 0, height: 1.02, build: 1.0, jacket: 0x2b4a8a },
    health: 100,
    speed: 1.0,
    stamina: 1.0,
    melee: 1.0,
    accent: '#29e6ff',
  },
  {
    id: 'jade',
    name: 'Jade Kimura',
    tagline: 'The Runner',
    bio: 'A courier and free-runner who knows every rooftop in Market Row. Fast on her feet, faster when things go wrong.',
    look: { skin: 0xf1d3b8, shirt: 0xff2d95, pants: 0x1c1c1e, shoes: 0xf0f0f0, hair: 0x2a2a2a, hairStyle: 1, height: 0.96, build: 0.92 },
    health: 90,
    speed: 1.1,
    stamina: 1.35,
    melee: 0.9,
    accent: '#ff2d95',
  },
  {
    id: 'marcus',
    name: "Marcus 'Tank' Cole",
    tagline: 'The Bruiser',
    bio: 'Former heavyweight who threw one fight too many. Slow to start, impossible to stop.',
    look: { skin: 0x6e4a2e, shirt: 0x3a8a5a, pants: 0x4a4a4e, shoes: 0x5a3a20, hair: 0x1a1410, hairStyle: 2, height: 1.06, build: 1.18 },
    health: 135,
    speed: 0.93,
    stamina: 0.9,
    melee: 1.4,
    accent: '#39ff88',
  },
];

export const characterById = (id: string) => ROSTER.find((c) => c.id === id) ?? ROSTER[0];
