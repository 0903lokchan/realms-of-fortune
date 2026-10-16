// Pure rule helpers: rent, building, valuations. No state mutation here.

import { BOARD, BUILD_COST, ENCHANT_COST, GARRISON_COST, node, regionProps, WAYGATES, MANA_NODES } from './board';
import { hero } from './heroes';
import type { GameState, GarrisonType, HeroId, NodeId, Ownable, Player, PlayerId, Region, Upgrade } from './types';
import { CHAMPION_MIGHT, MILITIA_MIGHT, WITS_RENT_BONUS } from './types';

export function own(state: GameState, id: NodeId): Ownable {
  return state.ownership[id];
}

export function settlementTiers(o: Ownable): number {
  return o.upgrades.filter(u => u.kind === 'settlement').length;
}
export function enchantCount(o: Ownable): number {
  return o.upgrades.filter(u => u.kind === 'enchant').length;
}
export function hasEnchant(o: Ownable, e: string): boolean {
  return o.upgrades.some(u => u.kind === 'enchant' && u.enchant === e);
}
export function garrison(o: Ownable): GarrisonType | null {
  const g = o.upgrades.find(u => u.kind === 'garrison');
  return g && g.kind === 'garrison' ? g.garrison : null;
}

/* ---------------- heroes & challenges ---------------- */

/** Heroes a player owns that are not stationed on any land. */
export function retinue(state: GameState, pid: PlayerId): HeroId[] {
  const stationed = new Set(Object.values(state.ownership).map(o => o.hero).filter(Boolean));
  return state.players[pid].heroes.filter(h => !stationed.has(h));
}

/** The rested retinue hero who fights for a player: highest Might, or null (the champion fights alone). */
export function champion(state: GameState, pid: PlayerId): HeroId | null {
  const tired = new Set(state.players[pid].exhausted);
  const r = retinue(state, pid).filter(h => !tired.has(h));
  return r.length ? r.reduce((a, b) => (hero(b).might > hero(a).might ? b : a)) : null;
}

export function attackBase(state: GameState, pid: PlayerId): number {
  const h = champion(state, pid);
  return (h ? hero(h).might : CHAMPION_MIGHT) + (state.players[pid].cls === 'warrior' ? 2 : 0);
}

const GARRISON_DEFENSE: Record<GarrisonType, number> = { guard: 1, ogre: 2, drake: 3, tower: 3 };

/** A stationed hero leads the defense, but a frail scholar never fights worse than the town militia. */
export function defenseBase(state: GameState, id: NodeId): number {
  const o = own(state, id);
  const g = garrison(o);
  const leader = Math.max(o.hero ? hero(o.hero).might : 0, MILITIA_MIGHT);
  return leader + 2 * settlementTiers(o) + (g ? GARRISON_DEFENSE[g] : 0);
}

/** P(attack + d6 > defense + d6), exactly. */
export function winChance(attack: number, defense: number): number {
  let wins = 0;
  for (let a = 1; a <= 6; a++) for (let d = 1; d <= 6; d++) if (attack + a > defense + d) wins++;
  return wins / 36;
}

/** Wits of the hero stationed on a land, with its Academy. */
export function stationedWits(o: Ownable): number {
  return o.hero ? hero(o.hero).wits + (hasEnchant(o, 'academy') ? 3 : 0) : 0;
}

/** Best Wits among the given heroes (0 if none). */
export function bestWits(heroes: HeroId[]): number {
  return heroes.reduce((m, h) => Math.max(m, hero(h).wits), 0);
}

/** Chance a hostile tactic is seen through: 15% per point the target's Wits beats the caster's, max 60%. */
export function resistChance(state: GameState, caster: PlayerId, target: PlayerId): number {
  const gap = bestWits(state.players[target].heroes) - bestWits(retinue(state, caster));
  return Math.min(0.6, Math.max(0, gap) * 0.15);
}

/** Effective rent tier: settlements + half per enchantment, capped at 3. */
export function effectiveTier(o: Ownable): number {
  return Math.min(3, settlementTiers(o) + 0.5 * enchantCount(o));
}

/** Does `player` own every property in the region (mortgaged still counts for the set)? */
export function ownsFullSet(state: GameState, player: PlayerId, region: Region): boolean {
  return regionProps(region).every(n => own(state, n.id).owner === player);
}

/** Rent ladder factors by tier 0..3 (fraction of list price). */
const TIER_FACTOR = [0.08, 0.4, 1.1, 3.0];

export function seasonMult(state: GameState): number {
  return state.season === 'winter' ? 1.5 : state.season === 'autumn' ? 1.25 : 1;
}

/**
 * Rent owed for landing on `id`, before the payer's own discounts (Rogue).
 * `diceTotal` is the roll that landed there (mana nodes rent on dice).
 */
export function baseRent(state: GameState, id: NodeId, diceTotal: number, withHero = true): number {
  const n = node(id);
  const o = own(state, id);
  if (o.owner === null || o.mortgaged) return 0;
  let rent: number;
  if (n.type === 'way') {
    const count = WAYGATES.filter(w => own(state, w).owner === o.owner && !own(state, w).mortgaged).length;
    rent = 25 * 2 ** (count - 1);
  } else if (n.type === 'mana') {
    const count = MANA_NODES.filter(m => own(state, m).owner === o.owner && !own(state, m).mortgaged).length;
    rent = diceTotal * (count >= 2 ? 10 : 4);
  } else {
    const price = n.price!;
    const tier = effectiveTier(o);
    const lo = Math.floor(tier), hi = Math.ceil(tier);
    const f = TIER_FACTOR[lo] + (TIER_FACTOR[hi] - TIER_FACTOR[lo]) * (tier - lo);
    rent = price * f;
    if (tier === 0 && n.region && ownsFullSet(state, o.owner, n.region)) rent *= 2;
    const g = garrison(o);
    if (g === 'ogre') rent *= 1.5;
    if (g === 'drake') rent *= 2;
    if (withHero) rent *= 1 + WITS_RENT_BONUS * stationedWits(o);
  }
  rent *= seasonMult(state);
  if (o.cursed) rent *= 0.5;
  return Math.round(rent);
}

/** Rent after the payer's class discount and an armed snare trap. */
export function rentFor(state: GameState, payer: Player, id: NodeId, diceTotal: number): number {
  let rent = baseRent(state, id, diceTotal);
  const o = own(state, id);
  if (o.trapArmed && hasEnchant(o, 'trap')) rent *= 2;
  if (payer.cls === 'rogue') rent = Math.floor(rent * 0.9);
  return Math.round(rent);
}

export function upgradeCost(state: GameState, player: Player, id: NodeId, up: Upgrade): number {
  const region = node(id).region!;
  if (up.kind === 'settlement') {
    let c = BUILD_COST[region];
    if (player.cls === 'merchant') c = Math.round(c * 0.85);
    return c;
  }
  if (up.kind === 'enchant') {
    let c = ENCHANT_COST;
    if (player.cls === 'wizard') c = Math.round(c * 0.75);
    return c;
  }
  return GARRISON_COST[up.garrison];
}

/** Why a build is illegal, or null if allowed. */
export function buildError(state: GameState, player: Player, id: NodeId, up: Upgrade): string | null {
  const n = BOARD.get(id);
  if (!n || n.type !== 'prop') return 'not a property';
  const o = own(state, id);
  if (o.owner !== player.id) return 'not yours';
  if (o.mortgaged) return 'mortgaged';
  if (o.upgrades.length >= 3) return 'no free slot';
  if (!ownsFullSet(state, player.id, n.region!)) return 'need the full region';
  if (up.kind === 'settlement' && state.stock.settlements <= 0) return 'bank has no settlements';
  if (up.kind === 'enchant') {
    if (state.stock.enchants[up.enchant] <= 0) return 'bank has none left';
    if (hasEnchant(o, up.enchant)) return 'already enchanted so';
  }
  if (up.kind === 'garrison' && garrison(o) !== null) return 'already garrisoned';
  if (up.kind === 'enchant' && up.enchant === 'academy' && !o.hero) return 'needs a stationed hero';
  if (player.cash < upgradeCost(state, player, id, up)) return 'not enough gold';
  return null;
}

/** Sale value of an upgrade (half build cost; enchantments refund nothing). */
export function upgradeSaleValue(state: GameState, player: Player, id: NodeId, up: Upgrade): number {
  if (up.kind === 'enchant') return 0;
  // sale value ignores class discounts to avoid arbitrage
  if (up.kind === 'settlement') return Math.floor(BUILD_COST[node(id).region!] / 2);
  return Math.floor(GARRISON_COST[up.garrison] / 2);
}

export function mortgageValue(id: NodeId): number {
  return Math.floor(node(id).price! / 2);
}
export function unmortgageCost(id: NodeId): number {
  return Math.ceil(mortgageValue(id) * 1.1);
}

/** Total net worth for the round-cap winner: cash + land + improvements. */
export function netWorth(state: GameState, player: Player): number {
  if (player.bankrupt) return 0;
  let worth = player.cash;
  for (const [id, o] of Object.entries(state.ownership)) {
    if (o.owner !== player.id) continue;
    worth += o.mortgaged ? mortgageValue(id) : node(id).price!;
    for (const up of o.upgrades) {
      if (up.kind === 'settlement') worth += Math.floor(BUILD_COST[node(id).region!] / 2);
      else if (up.kind === 'garrison') worth += Math.floor(GARRISON_COST[up.garrison] / 2);
    }
  }
  for (const h of player.heroes) worth += Math.floor(hero(h).cost / 2);
  return worth;
}

export function playerProps(state: GameState, player: PlayerId): NodeId[] {
  return Object.entries(state.ownership)
    .filter(([, o]) => o.owner === player)
    .map(([id]) => id);
}
