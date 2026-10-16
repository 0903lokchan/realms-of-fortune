import { describe, expect, it } from 'vitest';
import { _test, applyAction, createGame } from '../src/engine/engine';
import { hero } from '../src/engine/heroes';
import { attackBase, baseRent, champion, defenseBase, resistChance, retinue, winChance } from '../src/engine/rules';
import type { Action, GameState, TacticId } from '../src/engine/types';

function game(seed = 3): GameState {
  return createGame(seed, [
    { name: 'A', cls: 'merchant' },
    { name: 'B', cls: 'wizard' },
  ]);
}

function ok(state: GameState, action: Action) {
  const err = applyAction(state, action);
  expect(err, `${action.type}: ${err}`).toBeNull();
}

/** Give player `pid` exactly these heroes, all in the retinue. */
function crew(s: GameState, pid: number, ...ids: string[]) {
  s.players[pid].heroes = ids;
}

describe('heroes and the Bazaar', () => {
  it('starts everyone with one distinct hero and three for hire', () => {
    const s = createGame(9, [
      { name: 'A', cls: 'merchant' }, { name: 'B', cls: 'wizard' },
      { name: 'C', cls: 'rogue' }, { name: 'D', cls: 'warrior' },
    ]);
    const owned = s.players.flatMap(p => p.heroes);
    expect(s.players.every(p => p.heroes.length === 1)).toBe(true);
    expect(new Set(owned).size).toBe(4);
    expect(s.forHire).toHaveLength(3);
    expect(s.forHire.some(h => owned.includes(h))).toBe(false);
  });

  it('hires at the Bazaar, refills the line-up, and caps the band at three', () => {
    const s = game();
    const pick = s.forHire[0];
    ok(s, { type: 'hireHero', hero: pick });
    expect(s.players[0].heroes).toContain(pick);
    expect(s.players[0].cash).toBe(1200 - hero(pick).cost);
    expect(s.forHire).toHaveLength(3);
    expect(s.forHire).not.toContain(pick);
    ok(s, { type: 'hireHero', hero: s.forHire[0] });
    s.players[0].cash = 5000;
    expect(applyAction(s, { type: 'hireHero', hero: s.forHire[0] })).toBe('you lead 3 heroes already');
  });

  it('closes the Bazaar when the turn passes', () => {
    const s = game();
    s.phase = 'postroll';
    ok(s, { type: 'endTurn' });
    expect(s.players[0].bazaarOpen).toBe(false);
  });

  it('stations heroes only after moving, on your own land, and Wits raises the rent', () => {
    const s = game();
    crew(s, 0, 'zahra');                  // Wits 8
    s.ownership['forge'].owner = 0;
    expect(applyAction(s, { type: 'stationHero', hero: 'zahra', node: 'forge' })).toBe('station heroes after you move');
    s.phase = 'postroll';
    expect(applyAction(s, { type: 'stationHero', hero: 'zahra', node: 'karak' })).toBe('station heroes on your own lands');
    expect(baseRent(s, 'forge', 7)).toBe(Math.round(180 * 0.08));
    ok(s, { type: 'stationHero', hero: 'zahra', node: 'forge' });
    expect(baseRent(s, 'forge', 7)).toBe(Math.round(180 * 0.08 * 1.32));
    expect(retinue(s, 0)).toEqual([]);
    ok(s, { type: 'stationHero', hero: 'zahra', node: null });
    expect(retinue(s, 0)).toEqual(['zahra']);
  });
});

describe('challenges', () => {
  it('computes attack, defense and exact odds', () => {
    const s = game();
    crew(s, 0, 'gruk');                   // Might 8
    expect(attackBase(s, 0)).toBe(8);
    const o = s.ownership['forge'];
    o.owner = 1;
    expect(defenseBase(s, 'forge')).toBe(3);                  // militia
    o.hero = 'tobias';                                        // Might 1: the militia still holds at 3
    expect(defenseBase(s, 'forge')).toBe(3);
    o.upgrades.push({ kind: 'settlement' }, { kind: 'garrison', garrison: 'tower' });
    o.hero = 'dain';                                          // Might 6
    expect(defenseBase(s, 'forge')).toBe(6 + 2 + 3);
    expect(winChance(5, 5)).toBeCloseTo(15 / 36);
    expect(winChance(8, 3)).toBeCloseTo(35 / 36);  // only a 1 against a 6 fails
    expect(winChance(9, 3)).toBe(1);
  });

  /** Land player 0 on rival land and challenge; retry seeds until the duel goes the wanted way. */
  function duel(want: boolean) {
    for (let seed = 1; seed < 200; seed++) {
      const s = game(seed);
      crew(s, 0, 'aldric');                                   // Might 7
      crew(s, 1, 'dain');
      const o = s.ownership['forge'];
      o.owner = 1;
      o.upgrades.push({ kind: 'settlement' });
      o.hero = 'dain';                                        // defense 6 + 2 = 8
      s.players[0].pos = 'forge';
      _test.resolveLanding(s, 7);
      const rent = s.pending?.type === 'rentDue' ? s.pending.rent : 0;
      const cash = s.players[0].cash;
      ok(s, { type: 'rentChoice', choice: 'challenge' });
      const fx = s.fx.find(f => f.type === 'duel');
      if (fx?.type === 'duel' && fx.won === want) return { s, rent, cash, fx };
    }
    throw new Error('no such duel in 200 seeds');
  }

  it('a win pays nothing, routs the defender, and tires the attacker', () => {
    const { s, cash, fx } = duel(true);
    expect(s.players[0].cash).toBe(cash);
    expect(s.ownership['forge'].hero).toBeNull();
    expect(retinue(s, 1)).toContain('dain');
    expect(s.players[0].exhausted).toEqual(['aldric']);
    expect(champion(s, 0)).toBeNull();
    expect(fx.attackBase).toBe(7);
    expect(fx.defenseBase).toBe(8);
    expect(s.phase).toBe('postroll');
  });

  it('a loss pays double rent', () => {
    const { s, rent, cash } = duel(false);
    expect(s.players[0].cash).toBe(cash - rent * 2);
    expect(s.ownership['forge'].hero).toBe('dain');
  });

  it('exhausted heroes rest when passing the Crossroads', () => {
    const { s } = duel(true);
    _test.crossedCapital(s, s.players[0]);
    expect(s.players[0].exhausted).toEqual([]);
    expect(champion(s, 0)).toBe('aldric');
  });
});

describe('tactics', () => {
  function withTactic(t: TacticId) {
    const s = game();
    s.players[0].tactics = [t];
    return s;
  }

  it('Rooted skips the next move, then grants immunity until the Crossroads', () => {
    const s = withTactic('rooted');
    ok(s, { type: 'playTactic', tactic: 'rooted', target: 1 });
    expect(s.players[1].rooted).toBe(true);
    s.current = 1;
    s.phase = 'preroll';
    const pos = s.players[1].pos;
    ok(s, { type: 'roll' });
    expect(s.players[1].pos).toBe(pos);
    expect(s.phase).toBe('postroll');
    s.current = 0;
    s.players[0].tactics = ['rooted'];
    s.players[0].tacticUsed = false;
    expect(applyAction(s, { type: 'playTactic', tactic: 'rooted', target: 1 })).toMatch(/cannot be Rooted again/);
  });

  it('Lure pulls a rival onto your land; they owe rent while your turn carries on', () => {
    const s = withTactic('lure');
    s.ownership['millbrook'].owner = 0;
    s.players[1].pos = 'bramble';
    expect(applyAction(s, { type: 'playTactic', tactic: 'lure', target: 1, node: 'forge' }))
      .toBe('not one of your lands within reach of them');
    ok(s, { type: 'playTactic', tactic: 'lure', target: 1, node: 'millbrook' });
    expect(s.players[1].pos).toBe('millbrook');
    expect(s.pending).toMatchObject({ type: 'rentDue', player: 1, lured: true });
    const cash = s.players[1].cash;
    ok(s, { type: 'rentChoice', choice: 'pay' });
    expect(s.players[1].cash).toBeLessThan(cash);
    expect(s.phase).toBe('preroll');                          // still the lurer's turn, before rolling
    expect(s.current).toBe(0);
  });

  it('Sabotage wrecks the newest upgrade, and a Ward blocks it', () => {
    const s = withTactic('sabotage');
    const o = s.ownership['forge'];
    o.owner = 1;
    o.upgrades.push({ kind: 'settlement' }, { kind: 'enchant', enchant: 'ward' });
    expect(applyAction(s, { type: 'playTactic', tactic: 'sabotage', target: 1, node: 'forge' })).toBe('a Ward protects it');
    o.upgrades = [{ kind: 'settlement' }, { kind: 'settlement' }];
    ok(s, { type: 'playTactic', tactic: 'sabotage', target: 1, node: 'forge' });
    expect(o.upgrades).toHaveLength(1);
  });

  it('a Feint turns a hostile tactic back on its caster', () => {
    const s = withTactic('rooted');
    s.players[1].tactics = ['feint'];
    ok(s, { type: 'playTactic', tactic: 'rooted', target: 1 });
    expect(s.players[1].rooted).toBe(false);
    expect(s.players[0].rooted).toBe(true);
    expect(s.players[1].tactics).toEqual([]);
    expect(s.fx.find(f => f.type === 'tactic')).toMatchObject({ reflected: true });
  });

  it('cunning heroes may see through a tactic: 15% per point of Wits, at most 60%', () => {
    const s = game();
    crew(s, 0, 'brannoc');                 // Wits 1
    crew(s, 1, 'ilwen');                   // Wits 9
    expect(resistChance(s, 0, 1)).toBeCloseTo(0.6);
    crew(s, 0, 'zahra');                   // Wits 8
    expect(resistChance(s, 0, 1)).toBeCloseTo(0.15);
    expect(resistChance(s, 1, 0)).toBe(0);
  });

  it('Burn the Bridge forces others past the fork without a choice', () => {
    const s = withTactic('bridge');
    ok(s, { type: 'playTactic', tactic: 'bridge', node: 'rockfall' });
    s.current = 1;
    s.players[1].pos = 'ferry';
    s.phase = 'preroll';
    s.movement = null;
    // walk 3 from Ferry Cross: Silver Quay's fork must not open, so the road goes west
    _test.walk(s, 3);
    expect(s.pending?.type === 'fork').toBe(false);
    expect(s.players[1].pos).toBe('fate1');
  });

  it('Sanctuary shields a rival from tactics', () => {
    const s = withTactic('rooted');
    s.players[1].sanctuary = true;
    expect(applyAction(s, { type: 'playTactic', tactic: 'rooted', target: 1 })).toBe('B is under Sanctuary');
  });

  it('only one tactic per turn', () => {
    const s = game();
    s.players[0].tactics = ['rooted', 'march'];
    ok(s, { type: 'playTactic', tactic: 'march' });
    expect(applyAction(s, { type: 'playTactic', tactic: 'rooted', target: 1 })).toBe('one tactic per turn');
  });
});
