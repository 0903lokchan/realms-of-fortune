import { describe, expect, it } from 'vitest';
import { walksFrom } from '../src/engine/board';
import { createGame } from '../src/engine/engine';
import { previewFor } from '../src/ui/preview';

function game() {
  return createGame(5, [
    { name: 'Fen', cls: 'ranger', human: true },
    { name: 'Vex', cls: 'rogue' },
  ]);
}

describe('walksFrom', () => {
  it('follows the loop when no fork is in reach', () => {
    expect(walksFrom('rune', 5).map(w => w.end)).toEqual(['wyrm']);
  });

  it('branches at a fork', () => {
    const walks = walksFrom('ferry', 3);
    expect(walks.map(w => w.end).sort()).toEqual(['delve', 'fate1']);
    expect(walks.find(w => w.end === 'delve')!.path).toEqual(['ferry', 'quay', 'rockfall', 'delve']);
  });
});

describe('landing previews', () => {
  it('describes each Ranger stride from the human point of view', () => {
    const s = game();
    s.players[0].pos = 'thorn';
    s.ownership['coral'].owner = 1;  // 6 steps: rival land
    s.ownership['rune'].owner = 0;   // 7 steps (sunspire) stays wild; 8 steps passes its fork
    s.pending = { type: 'rangerAdjust', player: 0, rolled: 7, options: [6, 7, 8] };

    const p = previewFor(s, 0)!;
    expect(p.kind).toBe('stride');
    const of = (key: string) => p.landings.filter(l => l.key === key);
    expect(of('6')).toMatchObject([{ end: 'coral', tone: 'bad', badge: '6' }]);
    expect(of('6')[0].note).toMatch(/^Vex's land · rent \d+g$/);
    expect(of('7')).toMatchObject([{ end: 'sunspire', tone: 'good', note: 'unclaimed · 230g' }]);
    expect(of('8')).toMatchObject([
      { end: 'rune', tone: 'own', note: 'your land' },
      { end: 'gull', tone: 'neutral', note: 'a quiet trail', perks: ['−50g ferry toll'] },
    ]);
  });

  it('lists what is passed on the way', () => {
    const s = game();
    s.players[0].pos = 'citadel';
    s.pending = { type: 'rangerAdjust', player: 0, rolled: 3, options: [2, 3, 4] };
    const two = previewFor(s, 0)!.landings.find(l => l.key === '2')!;
    expect(two.end).toBe('bramble');
    expect(two.perks).toEqual(['+150g at the Crossroads']);
  });

  it('previews where each road of a fork ends, including tolls', () => {
    const s = game();
    s.players[0].pos = 'sunspire';
    s.movement = { remaining: 3, rolled: [1, 2] };
    s.pending = { type: 'fork', player: 0, options: ['rune', 'gull'] };
    const p = previewFor(s, 0)!;
    expect(p.kind).toBe('fork');
    const road = p.landings.find(l => l.key === 'rune')!;
    const sea = p.landings.find(l => l.key === 'gull')!;
    expect(road).toMatchObject({ end: 'leyline', badge: '1' });
    expect(sea).toMatchObject({ end: 'cove', badge: '2', note: 'draw a Fate card' });
    expect(sea.perks).toEqual(['−50g ferry toll']);
  });

  it('is empty when the open decision belongs to someone else', () => {
    const s = game();
    s.pending = { type: 'rangerAdjust', player: 1, rolled: 7, options: [6, 7, 8] };
    expect(previewFor(s, 0)).toBeNull();
  });
});
