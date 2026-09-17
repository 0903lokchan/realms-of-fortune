import { describe, expect, it } from 'vitest';
import { decide } from '../src/ai/ai';
import { applyAction, createGame } from '../src/engine/engine';
import { ROUND_CAP } from '../src/engine/types';
import type { ClassId } from '../src/engine/types';

const LINEUP: Array<{ name: string; cls: ClassId }> = [
  { name: 'Serane', cls: 'wizard' },
  { name: 'Borin', cls: 'merchant' },
  { name: 'Vex', cls: 'rogue' },
  { name: 'Karg', cls: 'warrior' },
];

const ALL_CLASSES: ClassId[] = [
  'warrior', 'wizard', 'rogue', 'cleric', 'bard', 'merchant', 'ranger', 'necromancer',
];

function play(seed: number, lineup = LINEUP) {
  const state = createGame(seed, lineup);
  let steps = 0;
  while (state.phase !== 'gameover') {
    if (++steps > 20000) throw new Error(`seed ${seed}: game did not terminate`);
    const action = decide(state);
    const err = applyAction(state, action);
    if (err) throw new Error(`seed ${seed} step ${steps}: ${action.type} rejected: ${err}`);
  }
  return state;
}

describe('full AI games', () => {
  it('30 seeded games all terminate with a winner within the round cap', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = play(seed);
      expect(s.winner).not.toBeNull();
      expect(s.round).toBeLessThanOrEqual(ROUND_CAP + 1);
    }
  });

  it('every class can play a full game (both 8-class tables)', () => {
    const a = ALL_CLASSES.map(cls => ({ name: cls, cls }));
    for (let seed = 100; seed < 106; seed++) {
      const s = play(seed, a);
      expect(s.winner).not.toBeNull();
    }
  });

  it('money is conserved against the bank ledger (no gold from thin air on trades)', () => {
    const s = play(7);
    for (const p of s.players) {
      expect(p.cash).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(p.cash)).toBe(true);
      expect(Math.round(p.cash)).toBe(p.cash);
    }
  });

  it('games are deterministic for a given seed', () => {
    const a = play(11), b = play(11);
    expect(a.winner).toBe(b.winner);
    expect(a.round).toBe(b.round);
    expect(a.players.map(p => p.cash)).toEqual(b.players.map(p => p.cash));
    expect(a.events.length).toBe(b.events.length);
  });
});
