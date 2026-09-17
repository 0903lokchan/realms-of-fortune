import type { GameState } from './types';

/** mulberry32 — small deterministic PRNG; state lives in GameState for replayability. */
export function nextRand(state: GameState): number {
  let t = (state.rngState += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rollDie(state: GameState): number {
  return 1 + Math.floor(nextRand(state) * 6);
}

export function roll2d6(state: GameState): [number, number] {
  return [rollDie(state), rollDie(state)];
}

/** Fisher–Yates shuffle using the game RNG. */
export function shuffle<T>(state: GameState, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand(state) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
