import { describe, expect, it } from 'vitest';
import { createGame } from '../src/engine/engine';
import { hero } from '../src/engine/heroes';
import { baseRent, buildError, effectiveTier, netWorth, rentFor, upgradeCost } from '../src/engine/rules';
import type { GameState } from '../src/engine/types';

function fresh(): GameState {
  return createGame(42, [
    { name: 'A', cls: 'wizard' },
    { name: 'B', cls: 'merchant' },
  ]);
}

describe('rent', () => {
  it('scales with the settlement ladder', () => {
    const s = fresh();
    const o = s.ownership['forge'];
    o.owner = 1;
    expect(baseRent(s, 'forge', 7)).toBe(Math.round(180 * 0.08)); // 14
    o.upgrades.push({ kind: 'settlement' });
    expect(baseRent(s, 'forge', 7)).toBe(Math.round(180 * 0.4)); // 72
    o.upgrades.push({ kind: 'settlement' }, { kind: 'settlement' });
    expect(baseRent(s, 'forge', 7)).toBe(Math.round(180 * 3)); // 540
  });

  it('doubles unimproved rent on a full set', () => {
    const s = fresh();
    s.ownership['forge'].owner = 1;
    s.ownership['karak'].owner = 1;
    expect(baseRent(s, 'forge', 7)).toBe(Math.round(180 * 0.08 * 2));
  });

  it('enchantments add half a tier', () => {
    const s = fresh();
    const o = s.ownership['forge'];
    o.owner = 1;
    o.upgrades.push({ kind: 'enchant', enchant: 'vault' });
    expect(effectiveTier(o)).toBe(0.5);
    // halfway between 0.08 and 0.4
    expect(baseRent(s, 'forge', 7)).toBe(Math.round(180 * 0.24));
  });

  it('garrisons multiply rent; seasons and curses stack', () => {
    const s = fresh();
    const o = s.ownership['forge'];
    o.owner = 1;
    o.upgrades.push({ kind: 'garrison', garrison: 'drake' });
    const base = Math.round(180 * 0.08 * 2); // drake x2
    expect(baseRent(s, 'forge', 7)).toBe(base);
    s.season = 'winter';
    expect(baseRent(s, 'forge', 7)).toBe(Math.round(180 * 0.08 * 2 * 1.5));
    o.cursed = true;
    expect(baseRent(s, 'forge', 7)).toBe(Math.round(180 * 0.08 * 2 * 1.5 * 0.5));
  });

  it('rogues pay 10% less', () => {
    const s = createGame(1, [{ name: 'R', cls: 'rogue' }, { name: 'B', cls: 'merchant' }]);
    s.ownership['forge'].owner = 1;
    const normal = baseRent(s, 'forge', 7);
    expect(rentFor(s, s.players[0], 'forge', 7)).toBe(Math.round(Math.floor(normal * 0.9)));
  });

  it('waygate rent doubles per gate owned; mortgaged pays nothing', () => {
    const s = fresh();
    s.ownership['way_s'].owner = 1;
    expect(baseRent(s, 'way_s', 7)).toBe(25);
    s.ownership['way_n'].owner = 1;
    s.ownership['way_e'].owner = 1;
    expect(baseRent(s, 'way_s', 7)).toBe(100);
    s.ownership['way_s'].mortgaged = true;
    expect(baseRent(s, 'way_s', 7)).toBe(0);
  });

  it('mana rent rides the dice', () => {
    const s = fresh();
    s.ownership['manawell'].owner = 1;
    expect(baseRent(s, 'manawell', 9)).toBe(36);
    s.ownership['leyline'].owner = 1;
    expect(baseRent(s, 'manawell', 9)).toBe(90);
  });
});

describe('building', () => {
  it('requires the full region', () => {
    const s = fresh();
    s.ownership['forge'].owner = 0;
    expect(buildError(s, s.players[0], 'forge', { kind: 'settlement' })).toBe('need the full region');
    s.ownership['karak'].owner = 0;
    expect(buildError(s, s.players[0], 'forge', { kind: 'settlement' })).toBeNull();
  });

  it('applies class discounts', () => {
    const s = fresh();
    // wizard: enchant 100 -> 75; merchant: iron settlement 100 -> 85
    expect(upgradeCost(s, s.players[0], 'forge', { kind: 'enchant', enchant: 'ward' })).toBe(75);
    expect(upgradeCost(s, s.players[1], 'forge', { kind: 'settlement' })).toBe(85);
  });

  it('respects bank stock and slot limits', () => {
    const s = fresh();
    s.ownership['forge'].owner = 0;
    s.ownership['karak'].owner = 0;
    s.stock.enchants.ward = 0;
    expect(buildError(s, s.players[0], 'forge', { kind: 'enchant', enchant: 'ward' })).toBe('bank has none left');
    s.ownership['forge'].upgrades = [
      { kind: 'settlement' }, { kind: 'settlement' }, { kind: 'settlement' },
    ];
    expect(buildError(s, s.players[0], 'forge', { kind: 'settlement' })).toBe('no free slot');
  });
});

describe('net worth', () => {
  it('counts cash, land, and improvements', () => {
    const s = fresh();
    const p = s.players[0];
    const crew = Math.floor(hero(p.heroes[0]).cost / 2); // the starting hero, at half its price
    expect(netWorth(s, p)).toBe(1200 + crew);
    s.ownership['forge'].owner = 0;
    expect(netWorth(s, p)).toBe(1380 + crew);
    s.ownership['forge'].upgrades.push({ kind: 'settlement' });
    expect(netWorth(s, p)).toBe(1430 + crew); // + half of 100 build cost
    s.ownership['forge'].mortgaged = true;
    expect(netWorth(s, p)).toBe(1340 + crew); // land at half value
  });
});
