import { describe, expect, it } from 'vitest';
import { BOARD } from '../src/engine/board';
import { _test, applyAction, createGame } from '../src/engine/engine';
import type { Action, GameState } from '../src/engine/types';

function twoPlayer(seed = 7): GameState {
  return createGame(seed, [
    { name: 'A', cls: 'merchant' },
    { name: 'B', cls: 'warrior' },
  ]);
}

function ok(state: GameState, action: Action) {
  const err = applyAction(state, action);
  expect(err, `${action.type}: ${err}`).toBeNull();
}

/** Force the current player through a fixed walk by teleporting, to test landings. */
function landOn(state: GameState, nodeId: string) {
  state.players[state.current].pos = nodeId;
}

describe('turn flow', () => {
  it('walks, offers unowned property, buys, and passes the turn', () => {
    const s = twoPlayer();
    ok(s, { type: 'roll' });
    // resolve any pending decisions conservatively until postroll
    let guard = 0;
    while (s.phase !== 'postroll' && guard++ < 20) {
      const p = s.pending!;
      if (p.type === 'buyOrPass') ok(s, { type: 'buy' });
      else if (p.type === 'fork') ok(s, { type: 'chooseFork', to: p.options[0] });
      else if (p.type === 'auctionBid') ok(s, { type: 'passBid' });
      else break;
    }
    expect(s.phase).toBe('postroll');
    const before = s.current;
    ok(s, { type: 'endTurn' });
    expect(s.phase === 'preroll' || s.phase === 'gameover').toBe(true);
    // either doubles (same player) or next player
    expect([before, (before + 1) % 2]).toContain(s.current);
  });

  it('declining a buy starts a mandatory auction', () => {
    const s = twoPlayer();
    s.pending = { type: 'buyOrPass', player: 0, node: 'forge', price: 180 };
    ok(s, { type: 'declineBuy' });
    expect(s.pending?.type).toBe('auctionBid');
    // A bids, B passes -> A wins
    ok(s, { type: 'bid', amount: 60 });
    ok(s, { type: 'passBid' });
    expect(s.ownership['forge'].owner).toBe(0);
    expect(s.players[0].cash).toBe(1200 - 60);
  });

  it('an unsold auction leaves the land wild', () => {
    const s = twoPlayer();
    s.pending = { type: 'buyOrPass', player: 0, node: 'forge', price: 180 };
    ok(s, { type: 'declineBuy' });
    ok(s, { type: 'passBid' });
    ok(s, { type: 'passBid' });
    expect(s.ownership['forge'].owner).toBeNull();
    expect(s.phase).toBe('postroll');
  });

  it('pays rent on landing; short payers liquidate, broke payers go bankrupt', () => {
    const s = twoPlayer();
    const o = s.ownership['citadel'];
    o.owner = 1;
    o.upgrades.push({ kind: 'settlement' }, { kind: 'settlement' }, { kind: 'settlement' });
    const rent = 1200; // 400 * 3.0
    // liquidation: A owns forge unimproved, cash 1150 -> mortgages to cover
    s.ownership['forge'].owner = 0;
    s.players[0].cash = rent - 50;
    landOn(s, 'citadel');
    _test.resolveLanding(s, 7);
    ok(s, { type: 'rentChoice', choice: 'pay' });
    expect(s.players[0].bankrupt).toBe(false);
    expect(s.ownership['forge'].mortgaged).toBe(true);
    expect(s.players[1].cash).toBe(1200 + rent);

    // bankruptcy: nothing left to liquidate
    const t = twoPlayer();
    const ot = t.ownership['citadel'];
    ot.owner = 1;
    ot.upgrades.push({ kind: 'settlement' }, { kind: 'settlement' }, { kind: 'settlement' });
    t.players[0].cash = 100;
    landOn(t, 'citadel');
    _test.resolveLanding(t, 7);
    ok(t, { type: 'rentChoice', choice: 'pay' });
    expect(t.players[0].bankrupt).toBe(true);
    expect(t.phase).toBe('gameover');
    expect(t.winner).toBe(1);
  });

  it('three doubles sends the player to the Dungeon', () => {
    const s = twoPlayer();
    s.consecutiveDoubles = 2;
    // force the next roll to be doubles by trying seeds until one lands
    let tries = 0;
    for (;;) {
      const t = twoPlayer(1000 + tries++);
      t.consecutiveDoubles = 2;
      const before = t.rngState;
      ok(t, { type: 'roll' });
      if (t.players[0].inDungeon) {
        expect(t.players[0].pos).toBe('dungeon');
        expect(t.phase).toBe('postroll');
        return;
      }
      void before;
      if (tries > 40) throw new Error('no doubles found in 40 seeds');
    }
  });

  it('dungeon bribe releases onto the Old Delve and lets you roll', () => {
    const s = twoPlayer();
    const p = s.players[0];
    p.inDungeon = true;
    p.pos = 'dungeon';
    s.pending = { type: 'dungeon', player: 0 };
    ok(s, { type: 'dungeonChoice', choice: 'bribe' });
    expect(p.inDungeon).toBe(false);
    expect(p.pos).toBe('delve');
    expect(p.cash).toBe(1200 - 50);
    expect(s.phase).toBe('preroll');
  });

  it('warriors bribe for free', () => {
    const s = twoPlayer();
    s.current = 1;
    const p = s.players[1];
    p.inDungeon = true;
    p.pos = 'dungeon';
    s.pending = { type: 'dungeon', player: 1 };
    ok(s, { type: 'dungeonChoice', choice: 'bribe' });
    expect(p.cash).toBe(1200);
  });

  it('forks pause movement for a choice', () => {
    const s = twoPlayer();
    landOn(s, 'ferry'); // quay is 1 step ahead; quay forks
    s.phase = 'preroll';
    // roll until the walk passes through quay with steps remaining
    let guard = 0;
    for (;;) {
      const t = twoPlayer(500 + guard);
      t.players[0].pos = 'ferry';
      ok(t, { type: 'roll' });
      if (t.pending?.type === 'fork') {
        expect(t.pending.options.sort()).toEqual(['rockfall', 'way_w']);
        ok(t, { type: 'chooseFork', to: 'rockfall' });
        // continued the walk down the pass
        expect(['rockfall', 'delve', 'wyvern', 'cliff', 'rune'].some(
          id => t.players[0].pos === id) || t.pending !== null).toBe(true);
        return;
      }
      if (guard++ > 60) throw new Error('never hit the fork');
    }
  });

  it('passing the Crossroads pays income and vault bonuses', () => {
    const s = twoPlayer();
    const p = s.players[0];
    s.ownership['bramble'].owner = 0;
    s.ownership['millbrook'].owner = 0;
    s.ownership['bramble'].upgrades.push({ kind: 'enchant', enchant: 'vault' });
    landOn(s, 'citadel'); // 1 step from crossroads
    const cash = p.cash;
    ok(s, { type: 'roll' });
    // any roll >= 1 passes/lands the crossroads from the citadel
    expect(p.cash).toBeGreaterThanOrEqual(cash + 150 + 25 - 20); // minus possible tolls
  });

  it('one Action per turn is enforced', () => {
    const s = twoPlayer();
    s.ownership['bramble'].owner = 0;
    s.ownership['millbrook'].owner = 0;
    ok(s, { type: 'build', node: 'bramble', upgrade: { kind: 'settlement' } });
    const err = applyAction(s, { type: 'build', node: 'millbrook', upgrade: { kind: 'settlement' } });
    expect(err).toBe('action already taken this turn');
  });

  it('trades transfer land and gold, with counters', () => {
    const s = twoPlayer();
    s.ownership['forge'].owner = 0;
    s.ownership['karak'].owner = 1;
    ok(s, {
      type: 'proposeTrade',
      offer: { from: 0, to: 1, giveProps: ['forge'], giveGold: 50, getProps: ['karak'], getGold: 0 },
    });
    expect(s.pending?.type).toBe('tradeOffer');
    ok(s, { type: 'respondTrade', response: 'counter', counterGold: 100 });
    // back to proposer with sweetened gold
    expect(s.pending?.type).toBe('tradeOffer');
    ok(s, { type: 'respondTrade', response: 'accept' });
    expect(s.ownership['forge'].owner).toBe(1);
    expect(s.ownership['karak'].owner).toBe(0);
    expect(s.players[0].cash).toBe(1200 - 150);
    expect(s.players[1].cash).toBe(1200 + 150);
    expect(s.lastTrade).not.toBeNull();
  });

  it('records a roll effect and a walk along real edges', () => {
    const s = twoPlayer(3);
    s.players[0].pos = 'rune'; // the next fork is 15 steps away, beyond any roll
    ok(s, { type: 'roll' });
    const roll = s.fx[0];
    expect(roll.type).toBe('roll');
    const walk = s.fx.find(f => f.type === 'move')!;
    expect(walk.type === 'move' && !walk.teleport).toBe(true);
    if (roll.type !== 'roll' || walk.type !== 'move') return;
    expect(walk.path[0]).toBe('rune');
    expect(walk.path.length).toBe(roll.dice[0] + roll.dice[1] + 1);
    for (let i = 1; i < walk.path.length; i++) {
      expect(BOARD.get(walk.path[i - 1])!.out).toContain(walk.path[i]);
    }
  });

  it('splits a move at a fork and clears effects between actions', () => {
    for (let seed = 500; seed < 560; seed++) {
      const t = twoPlayer(seed);
      t.players[0].pos = 'ferry';
      ok(t, { type: 'roll' });
      if (t.pending?.type !== 'fork') continue;
      const first = t.fx.filter(f => f.type === 'move');
      expect(first.length).toBe(1);
      if (first[0].type === 'move') expect(first[0].path).toEqual(['ferry', 'quay']);
      ok(t, { type: 'chooseFork', to: 'rockfall' });
      expect(t.fx.some(f => f.type === 'roll')).toBe(false);
      const second = t.fx.find(f => f.type === 'move')!;
      if (second.type === 'move') expect(second.path.slice(0, 2)).toEqual(['quay', 'rockfall']);
      return;
    }
    throw new Error('never hit the fork');
  });

  it('flags teleports such as leaving the Dungeon', () => {
    const s = twoPlayer();
    const p = s.players[0];
    p.inDungeon = true;
    p.pos = 'dungeon';
    s.pending = { type: 'dungeon', player: 0 };
    ok(s, { type: 'dungeonChoice', choice: 'bribe' });
    expect(s.fx).toEqual([{ type: 'move', player: 0, path: ['dungeon', 'delve'], teleport: true }]);
  });

  it('gives log events unique increasing ids', () => {
    const s = twoPlayer();
    ok(s, { type: 'roll' });
    const ids = s.events.map(e => e.id);
    expect(ids.length).toBeGreaterThan(0);
    for (let i = 1; i < ids.length; i++) expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    expect(s.eventSeq).toBe(ids[ids.length - 1]);
  });

  it('round cap crowns the richest player', () => {
    const s = twoPlayer();
    s.round = 20;
    s.players[0].cash = 5000;
    // cycle turns until the round advances
    let guard = 0;
    while (s.phase !== 'gameover' && guard++ < 200) {
      if (s.pending) {
        const p = s.pending;
        if (p.type === 'buyOrPass') ok(s, { type: 'declineBuy' });
        else if (p.type === 'auctionBid') ok(s, { type: 'passBid' });
        else if (p.type === 'fork') ok(s, { type: 'chooseFork', to: p.options[0] });
        else if (p.type === 'dungeon') ok(s, { type: 'dungeonChoice', choice: 'roll' });
        else if (p.type === 'rentDue') ok(s, { type: 'rentChoice', choice: 'pay' });
        else if (p.type === 'chooseCurseTarget') ok(s, { type: 'chooseCurseTarget', node: null });
        else break;
      } else if (s.phase === 'preroll') ok(s, { type: 'roll' });
      else if (s.phase === 'postroll') ok(s, { type: 'endTurn' });
    }
    expect(s.phase).toBe('gameover');
    expect(s.winner).toBe(0);
  });
});
