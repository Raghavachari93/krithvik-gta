import * as THREE from 'three';
import type { Game } from '../Game';
import type { CharacterModel } from './CharacterModel';

export type Team = 'player' | 'civ' | 'gang' | 'police' | 'mission';
export type DamageKind = 'melee' | 'bullet' | 'vehicle' | 'explosion' | 'fall' | 'drown';

let NEXT = 1;
export const nextActorId = () => NEXT++;

export interface Actor {
  id: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  radius: number;
  height: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  team: Team;
  isPlayer: boolean;
  knockT: number;
  inVehicle: boolean;
  model: CharacterModel;
  blocking: boolean;
  takeDamage(amount: number, fromX: number, fromZ: number, kind: DamageKind, source: Actor | null, g: Game): void;
  knockdown(ix: number, iz: number, up: number, duration: number): void;
}
