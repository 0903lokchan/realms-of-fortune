// AI opponents. decide(state) returns the action for whoever must act.
// Simple valuation heuristics with per-class personality weights — see DESIGN.md §9.

import { BOARD, distancesFrom, node, regionProps, WAYGATES } from '../engine/board';
import { actingPlayer } from '../engine/engine';
import {
  baseRent, buildError, garrison, netWorth, own, ownsFullSet, playerProps, settlementTiers,
} from '../engine/rules';
import type {
  Action, ClassId, EnchantType, GameState, NodeId, Player, Region, Upgrade,
} from '../engine/types';

export type Difficulty = 'squire' | 'knight' | 'warlord';

interface Personality {
  buyEagerness: number;     // multiplier on property valuations
  settlementWeight: number; // preference among upgrade paths
  enchantWeight: number;
  garrisonWeight: number;
  cashBuffer: number;       // gold kept in reserve
  riskTolerance: number;    // shortcut / dangerous-route appetite
}

const PERSONALITIES: Partial<Record<ClassId, Personality>> = {
  merchant:    { buyEagerness: 1.15, settlementWeight: 1.5, enchantWeight: 0.6, garrisonWeight: 0.5, cashBuffer: 140, riskTolerance: 0.3 },
  rogue:       { buyEagerness: 1.0,  settlementWeight: 0.7, enchantWeight: 0.9, garrisonWeight: 0.6, cashBuffer: 220, riskTolerance: 0.6 },
  wizard:      { buyEagerness: 1.05, settlementWeight: 0.8, enchantWeight: 1.6, garrisonWeight: 0.5, cashBuffer: 180, riskTolerance: 0.5 },
  warrior:     { buyEagerness: 1.1,  settlementWeight: 0.9, enchantWeight: 0.5, garrisonWeight: 1.6, cashBuffer: 90,  riskTolerance: 0.9 },
};
const DEFAULT_PERSONALITY: Personality =
  { buyEagerness: 1, settlementWeight: 1, enchantWeight: 1, garrisonWeight: 1, cashBuffer: 150, riskTolerance: 0.5 };

function persona(p: Player): Personality {
  return PERSONALITIES[p.cls] ?? DEFAULT_PERSONALITY;
}

/** Rough value of owning `id` for `p`: expected rent income plus set synergy. */
function propValue(state: GameState, p: Player, id: NodeId): number {
  const n = node(id);
  let v = n.price! * 0.9;
  if (n.type === 'way') {
    const owned = WAYGATES.filter(w => own(state, w).owner === p.id).length;
    v = n.price! * (0.8 + 0.35 * owned);
  } else if (n.type === 'prop') {
    const sibs = regionProps(n.region!);
    const mine = sibs.filter(s => own(state, s.id).owner === p.id && s.id !== id).length;
    const rivals = sibs.some(s => own(state, s.id).owner !== null && own(state, s.id).owner !== p.id && s.id !== id);
    if (mine > 0) v *= 1.9;        // completes or advances a set
    else if (!rivals) v *= 1.15;   // open region
    if (rivals) v *= 1.25;         // denial value
  }
  return v * persona(p).buyEagerness;
}

function spendable(state: GameState, p: Player): number {
  return p.cash - persona(p).cashBuffer;
}

/** Expected rent paid over the next `steps` nodes down a route (fork scoring). */
function routeDanger(state: GameState, p: Player, start: NodeId, steps: number): number {
  let danger = 0, unownedUpside = 0, income = 0;
  let frontier = [start];
  const seen = new Set<NodeId>([start]);
  for (let d = 1; d <= steps; d++) {
    const next: NodeId[] = [];
    for (const at of frontier) {
      for (const to of node(at).out) {
        if (seen.has(to)) continue;
        seen.add(to);
        next.push(to);
        const o = state.ownership[to];
        if (o?.owner !== undefined && o.owner !== null && o.owner !== p.id) {
          danger += baseRent(state, to, 7) / 6; // ~landing chance
        } else if (o && o.owner === null) {
          unownedUpside += propValue(state, p, to) / 20;
        }
        if (to === 'crossroads') income += 150 / 2;
        if (node(to).entryToll) danger += node(to).entryToll!;
      }
    }
    frontier = next;
  }
  return danger - unownedUpside - income * (1 - persona(p).riskTolerance * 0.3);
}

function bestBuild(state: GameState, p: Player): { node: NodeId; upgrade: Upgrade } | null {
  const per = persona(p);
  let best: { node: NodeId; upgrade: Upgrade; score: number } | null = null;
  for (const id of playerProps(state, p.id)) {
    const n = node(id);
    if (n.type !== 'prop' || !ownsFullSet(state, p.id, n.region!)) continue;
    const candidates: Array<{ up: Upgrade; score: number }> = [];
    candidates.push({ up: { kind: 'settlement' }, score: n.price! * per.settlementWeight });
    for (const e of ['vault', 'ward', 'trap', 'beacon'] as EnchantType[]) {
      candidates.push({ up: { kind: 'enchant', enchant: e }, score: 60 * per.enchantWeight * (e === 'vault' ? 1.3 : 1) });
    }
    candidates.push({ up: { kind: 'garrison', garrison: 'ogre' }, score: n.price! * 0.45 * per.garrisonWeight });
    for (const c of candidates) {
      if (buildError(state, p, id, c.up)) continue;
      if (!best || c.score > best.score) best = { node: id, upgrade: c.up, score: c.score };
    }
  }
  return best && spendable(state, p) > 0 ? { node: best.node, upgrade: best.upgrade } : null;
}

function abilityAction(state: GameState, p: Player): Action | null {
  if (p.abilityCooldown > 0 || p.actionUsed) return null;
  switch (p.cls) {
    case 'warrior': {
      const near = new Set<NodeId>([p.pos, ...node(p.pos).out]);
      for (const n of BOARD.values()) if (n.out.includes(p.pos)) near.add(n.id);
      const victims = state.players.filter(r => !r.bankrupt && r.id !== p.id && !r.sanctuary && near.has(r.pos));
      return victims.length >= 2 ? { type: 'useAbility' } : null;
    }
    case 'merchant': {
      const dist = distancesFrom(p.pos, 5);
      const targets = [...dist.keys()].filter(id => {
        const o = state.ownership[id];
        return o && o.owner === null && p.cash > node(id).price! * 1.2 + persona(p).cashBuffer
          && propValue(state, p, id) > node(id).price! * 1.2;
      });
      return targets.length ? { type: 'useAbility', target: targets[0] } : null;
    }
    case 'ranger': {
      const wild = Object.entries(state.ownership)
        .filter(([id, o]) => o.owner === null && node(id).type === 'prop'
          && propValue(state, p, id) > node(id).price! && p.cash > node(id).price! + 50)
        .map(([id]) => id);
      return wild.length ? { type: 'useAbility', target: wild[0] } : null;
    }
    case 'necromancer': {
      const target = playerProps(state, p.id).find(id => own(state, id).mortgaged);
      return target ? { type: 'useAbility', target } : null;
    }
    case 'cleric':
      return p.cash < 150 ? { type: 'useAbility' } : null; // hunker down when poor
    default:
      return null;
  }
}

const REGIONS: Region[] = ['shire', 'silver', 'wild', 'iron', 'sun', 'mage', 'dragon', 'celest'];

/** Offer cash for the missing half of a region we already hold a piece of. */
function tradeProposal(state: GameState, p: Player): Action | null {
  for (const r of REGIONS) {
    const sibs = regionProps(r);
    const mine = sibs.filter(s => own(state, s.id).owner === p.id);
    const theirs = sibs.filter(s => {
      const o = own(state, s.id);
      return o.owner !== null && o.owner !== p.id && o.upgrades.length === 0 && !o.mortgaged;
    });
    if (mine.length === 0 || theirs.length === 0) continue;
    const target = theirs[0];
    const offerGold = Math.min(
      Math.round(target.price! * 1.6),
      p.cash - Math.round(persona(p).cashBuffer * 0.8),
    );
    if (offerGold < Math.round(target.price! * 1.25)) continue;
    return {
      type: 'proposeTrade',
      offer: {
        from: p.id, to: own(state, target.id).owner!,
        giveProps: [], giveGold: offerGold,
        getProps: [target.id], getGold: 0,
      },
    };
  }
  return null;
}

/** Answer whatever the engine is waiting on. Difficulty adds noise / caution. */
export function decide(state: GameState, difficulty: Difficulty = 'knight'): Action {
  const pid = actingPlayer(state);
  const p = state.players[pid];
  const noisy = (v: number) => difficulty === 'squire' ? v * (0.6 + ((state.rngState >>> 8) % 100) / 125) : v;
  const buffer = difficulty === 'warlord' ? persona(p).cashBuffer * 1.4 : persona(p).cashBuffer;

  const pend = state.pending;
  if (pend) {
    switch (pend.type) {
      case 'fork': {
        const scored = pend.options
          .map(to => ({ to, s: routeDanger(state, p, to, 10) }))
          .sort((a, b) => a.s - b.s);
        return { type: 'chooseFork', to: scored[0].to };
      }
      case 'rangerAdjust': {
        let best = pend.options[0], bestScore = Infinity;
        for (const steps of pend.options) {
          // peek: where does a straight walk land? (approximate — takes first exits)
          let at = p.pos;
          for (let i = 0; i < steps; i++) at = node(at).out[0];
          const o = state.ownership[at];
          let score = 0;
          if (o?.owner != null && o.owner !== p.id) score = baseRent(state, at, pend.rolled);
          else if (o && o.owner === null) score = -propValue(state, p, at) / 10;
          if (score < bestScore) { bestScore = score; best = steps; }
        }
        return { type: 'rangerAdjust', steps: best };
      }
      case 'buyOrPass': {
        const worth = noisy(propValue(state, p, pend.node));
        if (worth >= pend.price && p.cash - pend.price >= buffer * 0.4) return { type: 'buy' };
        return { type: 'declineBuy' };
      }
      case 'auctionBid': {
        const a = state.auction!;
        const cap = Math.min(noisy(propValue(state, p, pend.node)), p.cash - buffer * 0.3);
        const next = a.currentBid + 10;
        if (next <= cap && a.leader !== p.id) return { type: 'bid', amount: next };
        return { type: 'passBid' };
      }
      case 'pickpocket':
        return { type: 'pickpocket', use: pend.rent >= 40 };
      case 'dungeon': {
        if (p.cls === 'warrior') return { type: 'dungeonChoice', choice: 'fight' };
        if (p.writs > 0) return { type: 'dungeonChoice', choice: 'writ' };
        if (p.cash > 400) return { type: 'dungeonChoice', choice: 'bribe' };
        return { type: 'dungeonChoice', choice: 'roll' };
      }
      case 'chooseCurseTarget': {
        const best = [...pend.options].sort((a, b) => baseRent(state, b, 7) - baseRent(state, a, 7))[0];
        return { type: 'chooseCurseTarget', node: best ?? null };
      }
      case 'tradeOffer': {
        const o = pend.offer;
        // Initial offers are answered by o.to; countered offers come back to o.from.
        const iAmTo = pid === o.to;
        const getProps = iAmTo ? o.giveProps : o.getProps;
        const getGold = iAmTo ? o.giveGold : o.getGold;
        const giveProps = iAmTo ? o.getProps : o.giveProps;
        const giveGold = iAmTo ? o.getGold : o.giveGold;
        const gain = getProps.reduce((s, id) => s + propValue(state, p, id), 0) + getGold;
        const loss = giveProps.reduce((s, id) => s + propValue(state, p, id) * 1.15, 0) + giveGold;
        if (gain >= loss) return { type: 'respondTrade', response: 'accept' };
        if (iAmTo && !o.countered && gain >= loss * 0.7) {
          return { type: 'respondTrade', response: 'counter', counterGold: Math.ceil((loss - gain) / 10) * 10 };
        }
        return { type: 'respondTrade', response: 'decline' };
      }
    }
  }

  if (state.phase === 'preroll') {
    const ability = abilityAction(state, p);
    if (ability && p.cls !== 'wizard') return ability;
    if (p.cls === 'wizard' && p.abilityCooldown === 0 && !p.actionUsed) {
      // blink to the best unowned property in range
      const dist = distancesFrom(p.pos, 8);
      const targets = [...dist.entries()]
        .filter(([id, d]) => d >= 1 && state.ownership[id]?.owner === null
          && propValue(state, p, id) > node(id).price! && p.cash - node(id).price! > buffer * 0.4)
        .sort((a, b) => propValue(state, p, b[0]) - propValue(state, p, a[0]));
      if (targets.length) return { type: 'useAbility', target: targets[0][0] };
    }
    return { type: 'roll' };
  }

  // postroll: build > trade for a set > unmortgage > cleanse > end
  if (!p.actionUsed) {
    const build = bestBuild(state, p);
    if (build) return { type: 'build', ...build };
    const trade = tradeProposal(state, p);
    if (trade) return trade;
    const cursed = playerProps(state, p.id).find(id => own(state, id).cursed);
    if (cursed && (p.cls === 'cleric' || p.cash > buffer + 50)) return { type: 'cleanse', node: cursed };
    const mortgaged = playerProps(state, p.id)
      .filter(id => own(state, id).mortgaged)
      .sort((a, b) => node(b).price! - node(a).price!)[0];
    if (mortgaged && spendable(state, p) > node(mortgaged).price! * 0.6) {
      return { type: 'unmortgage', node: mortgaged };
    }
  }
  return { type: 'endTurn' };
}

export function summarize(state: GameState): string {
  return state.players
    .map(p => `${p.name}(${p.cls})${p.bankrupt ? ' ☠' : ` ${p.cash}g/worth ${netWorth(state, p)}g, ${playerProps(state, p.id).length} lands`}`)
    .join(' | ');
}

// re-exported for the sim/tests
export { actingPlayer };
export { garrison, settlementTiers };
