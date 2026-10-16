// AI opponents. decide(state) returns the action for whoever must act.
// Simple valuation heuristics with per-class personality weights — see DESIGN.md §9.

import { BOARD, distancesFrom, node, regionProps, WAYGATES } from '../engine/board';
import { actingPlayer, lureTargets } from '../engine/engine';
import { hero, tactic } from '../engine/heroes';
import {
  attackBase, baseRent, buildError, champion, defenseBase, garrison, hasEnchant, netWorth, own, ownsFullSet,
  playerProps, resistChance, settlementTiers, winChance,
} from '../engine/rules';
import type {
  Action, ClassId, EnchantType, GameState, HeroId, NodeId, Player, Region, TacticId, Upgrade,
} from '../engine/types';
import { MAX_HEROES, MAX_TACTICS } from '../engine/types';

export type Difficulty = 'squire' | 'knight' | 'warlord';

interface Personality {
  buyEagerness: number;     // multiplier on property valuations
  settlementWeight: number; // preference among upgrade paths
  enchantWeight: number;
  garrisonWeight: number;
  cashBuffer: number;       // gold kept in reserve
  riskTolerance: number;    // shortcut / dangerous-route appetite
  /** Challenges when the expected cost (1 − P(win)) × 2 × rent is below rent × aggression. */
  aggression: number;
  /** Weight on Might (vs Wits) when judging heroes. */
  mightPref: number;
}

const PERSONALITIES: Partial<Record<ClassId, Personality>> = {
  merchant: { buyEagerness: 1.15, settlementWeight: 1.5, enchantWeight: 0.6, garrisonWeight: 0.5, cashBuffer: 140, riskTolerance: 0.3, aggression: 0.9, mightPref: 0.4 },
  rogue:    { buyEagerness: 1.0,  settlementWeight: 0.7, enchantWeight: 0.9, garrisonWeight: 0.6, cashBuffer: 220, riskTolerance: 0.6, aggression: 0.8, mightPref: 0.4 },
  wizard:   { buyEagerness: 1.05, settlementWeight: 0.8, enchantWeight: 1.6, garrisonWeight: 0.5, cashBuffer: 180, riskTolerance: 0.5, aggression: 0.9, mightPref: 0.3 },
  warrior:  { buyEagerness: 1.1,  settlementWeight: 0.9, enchantWeight: 0.5, garrisonWeight: 1.6, cashBuffer: 90,  riskTolerance: 0.9, aggression: 1.25, mightPref: 0.85 },
};
const DEFAULT_PERSONALITY: Personality = {
  buyEagerness: 1, settlementWeight: 1, enchantWeight: 1, garrisonWeight: 1, cashBuffer: 150, riskTolerance: 0.5,
  aggression: 1, mightPref: 0.5,
};

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
    candidates.push({ up: { kind: 'garrison', garrison: 'tower' }, score: n.price! * 0.4 * per.garrisonWeight });
    candidates.push({ up: { kind: 'enchant', enchant: 'academy' }, score: 70 * per.enchantWeight });
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

/* ---------------- heroes, challenges, tactics ---------------- */

function heroScore(p: Player, h: HeroId): number {
  const mp = persona(p).mightPref;
  return hero(h).might * mp + hero(h).wits * (1 - mp);
}

/**
 * Pay, challenge, or pickpocket. A challenge exhausts the fighting hero for the rest of the lap,
 * so it must save more than keeping that hero rested for a bigger toll is worth.
 */
function rentChoice(state: GameState, p: Player, land: NodeId, rent: number, canPickpocket: boolean): Action {
  const win = winChance(attackBase(state, p.id), defenseBase(state, land));
  const challengeSaving = rent - (1 - win) * 2 * rent;
  const biggestToll = Math.max(0, ...Object.keys(state.ownership)
    .filter(id => { const o = own(state, id); return o.owner !== null && o.owner !== p.id && !o.mortgaged; })
    .map(id => baseRent(state, id, 7)));
  const restedHeroWorth = champion(state, p.id) ? 30 + 0.25 * biggestToll : 0;
  const affordable = rent * 2 <= p.cash || win >= 0.75;

  const options: Array<{ choice: 'pay' | 'challenge' | 'pickpocket'; gain: number }> = [{ choice: 'pay', gain: 0 }];
  if (canPickpocket && rent >= 40) options.push({ choice: 'pickpocket', gain: rent / 3 - 15 });
  if (affordable) options.push({ choice: 'challenge', gain: challengeSaving * persona(p).aggression - restedHeroWorth });
  options.sort((a, b) => b.gain - a.gain);
  return { type: 'rentChoice', choice: options[0].choice };
}

/** Hire or buy at the Bazaar while it's open and it fits the budget. */
function bazaarAction(state: GameState, p: Player, buffer: number): Action | null {
  if (!p.bazaarOpen) return null;
  const spare = p.cash - buffer;
  if (p.heroes.length < MAX_HEROES && (p.heroes.length < 2 || spare > 450)) {
    const pick = state.forHire
      .filter(h => hero(h).cost <= spare)
      .sort((a, b) => heroScore(p, b) - heroScore(p, a))[0];
    const weakest = Math.min(...p.heroes.map(h => heroScore(p, h)));
    if (pick && (p.heroes.length === 0 || heroScore(p, pick) >= weakest)) {
      return { type: 'hireHero', hero: pick };
    }
  }
  // a Feint waits in hand for a rival's move, so only playable cards count toward "holding one"
  const playable = p.tactics.filter(t => t !== 'feint');
  if (p.tactics.length < MAX_TACTICS) {
    const developed = playerProps(state, p.id).some(id => baseRent(state, id, 7) >= 60);
    const rivalBuilt = state.players.some(r => r.id !== p.id && !r.bankrupt
      && playerProps(state, r.id).some(id => own(state, id).upgrades.length > 0));
    const wish: TacticId[] = [];
    if (!playable.length) {
      if (developed) wish.push('lure');
      if (rivalBuilt) wish.push('sabotage');
      if (farBehind(state, p)) wish.push('rooted');
    }
    if (!p.tactics.includes('feint')) wish.push('feint');
    const t = wish.find(w => tactic(w).price + 100 <= spare);
    if (t) return { type: 'buyTactic', tactic: t };
  }
  return null;
}

/** Keep the strongest fighter in the retinue; station the rest on the richest lands. */
function stationAction(state: GameState, p: Player): Action | null {
  if (state.phase !== 'postroll') return null;
  // Rank by rent before any hero bonus: stationing a hero raises its land's rent, and ranking
  // on that would make the hero look better placed elsewhere and shuttle between lands forever.
  const worth = (id: NodeId) => baseRent(state, id, 7, false);
  const lands = playerProps(state, p.id)
    .filter(id => node(id).type === 'prop' && !own(state, id).mortgaged)
    .sort((a, b) => worth(b) - worth(a) || a.localeCompare(b));
  const byMight = [...p.heroes].sort((a, b) => hero(b).might - hero(a).might);
  const keepOne = p.heroes.length >= 2 || persona(p).aggression >= 1.1
    || !lands.some(id => settlementTiers(own(state, id)) >= 1);
  const toStation = keepOne ? byMight.slice(1) : byMight;
  const desired = new Map<HeroId, NodeId | null>(p.heroes.map(h => [h, null]));
  toStation.forEach((h, i) => { if (lands[i]) desired.set(h, lands[i]); });

  const at = (h: HeroId) => Object.entries(state.ownership).find(([, o]) => o.hero === h)?.[0] ?? null;
  for (const [h, want] of desired) {
    const now = at(h);
    if (now === want) continue;
    if (want === null) return { type: 'stationHero', hero: h, node: null };
    const occupant = own(state, want).hero;
    if (occupant && occupant !== h) return { type: 'stationHero', hero: occupant, node: null };
    return { type: 'stationHero', hero: h, node: want };
  }
  return null;
}

function leader(state: GameState, p: Player): Player | undefined {
  return state.players
    .filter(r => r.id !== p.id && !r.bankrupt)
    .sort((a, b) => netWorth(state, b) - netWorth(state, a))[0];
}

/** The leading rival is well ahead (worth 25% more) and not already Rooted this lap. */
function farBehind(state: GameState, p: Player): boolean {
  const top = leader(state, p);
  return !!top && !top.rooted && !top.rootImmune && netWorth(state, top) > netWorth(state, p) * 1.25;
}

function tacticAction(state: GameState, p: Player): Action | null {
  if (p.tacticUsed || !p.tactics.length) return null;
  const rivals = state.players.filter(r => r.id !== p.id && !r.bankrupt && !r.sanctuary);
  const fair = (r: Player) => resistChance(state, p.id, r.id) <= 0.3;

  if (p.tactics.includes('lure')) {
    let best: { target: number; node: NodeId; rent: number } | null = null;
    for (const r of rivals.filter(r => !r.inDungeon && fair(r))) {
      for (const id of lureTargets(state, p.id, r.id)) {
        const rent = baseRent(state, id, 7);
        if (rent >= 80 && (!best || rent > best.rent)) best = { target: r.id, node: id, rent };
      }
    }
    if (best) return { type: 'playTactic', tactic: 'lure', target: best.target, node: best.node };
  }
  if (p.tactics.includes('sabotage')) {
    let best: { target: number; node: NodeId; rent: number } | null = null;
    for (const r of rivals.filter(fair)) {
      for (const id of playerProps(state, r.id)) {
        const o = own(state, id);
        if (!o.upgrades.length || hasEnchant(o, 'ward')) continue;
        const rent = baseRent(state, id, 7);
        if (rent >= 100 && (!best || rent > best.rent)) best = { target: r.id, node: id, rent };
      }
    }
    if (best) return { type: 'playTactic', tactic: 'sabotage', target: best.target, node: best.node };
  }
  const top = leader(state, p);
  if (p.tactics.includes('rooted') && top && farBehind(state, p) && !top.sanctuary && !top.inDungeon && fair(top)) {
    return { type: 'playTactic', tactic: 'rooted', target: top.id };
  }
  if (p.tactics.includes('march') && state.phase === 'preroll' && !state.movement) {
    return { type: 'playTactic', tactic: 'march' };
  }
  if (p.tactics.includes('bridge')) {
    for (const [fork, entrance] of [['quay', 'rockfall'], ['sunspire', 'gull']] as const) {
      if (rivals.some(r => (distancesFrom(r.pos, 6).get(fork) ?? 99) <= 6)) {
        return { type: 'playTactic', tactic: 'bridge', node: entrance };
      }
    }
  }
  return null;
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
      case 'rentDue':
        return rentChoice(state, p, pend.node, pend.rent, pend.canPickpocket);
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

  const shop = bazaarAction(state, p, buffer);
  if (shop) return shop;
  const station = stationAction(state, p);
  if (station) return station;
  const play = tacticAction(state, p);
  if (play) return play;

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
