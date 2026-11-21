import type { Game } from './game/Game';

export const gameRef: { g: Game | null } = { g: null };
export const G = () => gameRef.g!;
