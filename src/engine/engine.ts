// The game reducer: createGame() builds a state, applyAction() advances it.
// The engine is headless and deterministic (seeded RNG lives in the state).
// Whenever a player must decide something, state.pending names the decision;
// the UI answers for humans and src/ai answers for AI players.

import { BOARD, distancesFrom, node, OWNABLE_TYPES, PROPERTY_NODES, WAYGATES } from './board';
import { CARD_BY_ID, FATE_CARDS, KEPT_QUESTS, QUEST_CARDS } from './cards';
import { roll2d6, rollDie, shuffle } from './rng';
import {
  baseRent, buildError, garrison, hasEnchant, mortgageValue, netWorth, own, ownsFullSet,
  playerProps, rentFor, settlementTiers, unmortgageCost, upgradeCost, upgradeSaleValue,
} from './rules';
import type {
  Action, ClassId, GameState, NodeId, Player, PlayerId, TradeOffer, Upgrade,
} from './types';
import {
  ABILITY_COOLDOWN, AUTUMN_ROUND, BEACON_TOLL, CROSSROADS_INCOME, CURSE_CLEANSE_COST,
  DUNGEON_BRIBE, DUNGEON_BRUISES, LEVY_COST, ROUND_CAP, START_CASH, VAULT_INCOME, WINTER_ROUND,
} from './types';
import { GARRISON_UPKEEP } from './board';

export interface PlayerConfig { name: string; cls: ClassId; human?: boolean }

export function createGame(seed: number, players: PlayerConfig[]): GameState {
  const state: GameState = {
    seed, rngState: seed >>> 0,
    round: 1, season: 'summer', phase: 'preroll', current: 0,
    players: players.map((p, id) => ({
      id, name: p.name, cls: p.cls, human: !!p.human,
      cash: START_CASH, pos: 'crossroads', bankrupt: false,
      inDungeon: false, dungeonTurns: 0, abilityCooldown: 0,
      sanctuary: false, writs: 0, keptQuests: [], actionUsed: false,
    })),
    ownership: {}, pending: null, movement: null, auction: null,
    consecutiveDoubles: 0,
    fateDeck: [], questDeck: [],
    stock: { settlements: 32, enchants: { ward: 2, vault: 2, trap: 2, beacon: 2, orb: 2 } },
    lastTrade: null, lastRollDouble: false, lastRoll: null, rangerClaim: false, events: [], winner: null,
  };
  for (const n of BOARD.values()) {
    if (OWNABLE_TYPES.has(n.type)) {
      state.ownership[n.id] = {
        owner: null, mortgaged: false, upgrades: [],
        cursed: false, trapArmed: false, orbReady: false,
      };
    }
  }
  state.fateDeck = shuffle(state, FATE_CARDS.map(c => c.id));
  state.questDeck = shuffle(state, QUEST_CARDS.map(c => c.id));
  return state;
}

function log(state: GameState, text: string) {
  state.events.push({ round: state.round, text });
  if (state.events.length > 300) state.events.splice(0, state.events.length - 300);
}

const P = (state: GameState, id: PlayerId) => state.players[id];
const cur = (state: GameState) => state.players[state.current];
const alive = (state: GameState) => state.players.filter(p => !p.bankrupt);

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

/** Pay `amount` from payer to receiver (null = the bank), liquidating if needed. */
function charge(state: GameState, payerId: PlayerId, amount: number, toId: PlayerId | null) {
  if (amount <= 0) return;
  const payer = P(state, payerId);
  if (payer.bankrupt) return;
  if (payer.cash < amount) liquidate(state, payer, amount);
  const paid = Math.min(payer.cash, amount);
  payer.cash -= paid;
  if (toId !== null) P(state, toId).cash += paid;
  if (payer.cash <= 0 && paid < amount) bankrupt(state, payer, toId);
}

/** Auto-liquidate: sell upgrades (half value), then mortgage, until `target` cash. */
function liquidate(state: GameState, player: Player, target: number) {
  const props = playerProps(state, player.id);
  // 1) sell garrisons & settlements
  for (const id of props) {
    const o = own(state, id);
    while (player.cash < target && o.upgrades.length > 0) {
      const up = o.upgrades.pop()!;
      returnToStock(state, up);
      const v = upgradeSaleValue(state, player, id, up);
      player.cash += v;
      log(state, `${player.name} tears down works on ${node(id).name} for ${v}g.`);
    }
    if (player.cash >= target) return;
  }
  // 2) mortgage, cheapest first (keeps the best income)
  const unmortgaged = props
    .filter(id => !own(state, id).mortgaged)
    .sort((a, b) => node(a).price! - node(b).price!);
  for (const id of unmortgaged) {
    if (player.cash >= target) return;
    own(state, id).mortgaged = true;
    player.cash += mortgageValue(id);
    log(state, `${player.name} mortgages ${node(id).name} for ${mortgageValue(id)}g.`);
  }
}

function returnToStock(state: GameState, up: Upgrade) {
  if (up.kind === 'settlement') state.stock.settlements++;
  else if (up.kind === 'enchant') state.stock.enchants[up.enchant]++;
}

function bankrupt(state: GameState, player: Player, creditorId: PlayerId | null) {
  player.bankrupt = true;
  player.cash = 0;
  log(state, `☠ ${player.name} is ruined!`);
  const estate = playerProps(state, player.id);

  // Necromancer passive: claim one mortgaged property for its mortgage cost.
  const necro = alive(state).find(p => p.cls === 'necromancer' && p.id !== player.id);
  if (necro) {
    const claimable = estate
      .filter(id => own(state, id).mortgaged && necro.cash >= mortgageValue(id))
      .sort((a, b) => node(b).price! - node(a).price!);
    if (claimable.length) {
      const id = claimable[0];
      necro.cash -= mortgageValue(id);
      if (creditorId !== null) P(state, creditorId).cash += mortgageValue(id);
      own(state, id).owner = necro.id;
      log(state, `${necro.name} raises a claim on ${node(id).name} from the ruins.`);
    }
  }

  for (const id of playerProps(state, player.id)) {
    const o = own(state, id);
    for (const up of o.upgrades) returnToStock(state, up);
    o.upgrades = [];
    o.cursed = false;
    if (creditorId !== null) {
      o.owner = creditorId;
    } else {
      o.owner = null;
      o.mortgaged = false;
    }
  }
  if (creditorId !== null) log(state, `Their lands pass to ${P(state, creditorId).name}.`);

  const rest = alive(state);
  if (rest.length === 1) return endGame(state, rest[0].id, 'last house standing');

  // if the active player fell mid-turn, hand the turn on cleanly
  if (player.id === state.current) {
    state.movement = null;
    state.pending = null;
    state.lastRollDouble = false;
    endTurn(state);
  }
}

function endGame(state: GameState, winnerId: PlayerId, why: string) {
  state.winner = winnerId;
  state.phase = 'gameover';
  state.pending = null;
  state.movement = null;
  log(state, `👑 ${P(state, winnerId).name} rules the Realms (${why}).`);
}

/* ------------------------------------------------------------------ */
/* Movement                                                            */
/* ------------------------------------------------------------------ */

function startMove(state: GameState, steps: number, rolled: [number, number] | null) {
  state.movement = { remaining: steps, rolled };
  stepMove(state);
}

/** Advance until a fork needs a choice or the move ends. */
function stepMove(state: GameState) {
  const player = cur(state);
  while (state.movement && state.movement.remaining > 0) {
    const outs = node(player.pos).out;
    if (outs.length > 1) {
      state.pending = { type: 'fork', player: player.id, options: [...outs] };
      return;
    }
    advance(state, outs[0]);
    if (state.winner !== null || player.bankrupt) return;
  }
}

function advance(state: GameState, to: NodeId) {
  const player = cur(state);
  const mv = state.movement!;
  player.pos = to;
  mv.remaining--;
  const n = node(to);
  if (n.entryToll) {
    charge(state, player.id, n.entryToll, null);
    if (player.bankrupt) return;
    log(state, `${player.name} pays the ${n.entryToll}g ferry toll.`);
  }
  if (to === 'crossroads') {
    crossedCapital(state, player);
    if (player.bankrupt) return;
  }
  if (mv.remaining > 0) {
    // pass-through effects
    const o = state.ownership[to];
    if (o && o.owner !== null && o.owner !== player.id && hasEnchant(o, 'beacon') && !o.mortgaged) {
      charge(state, player.id, BEACON_TOLL, o.owner);
      if (player.bankrupt) return;
      log(state, `${player.name} pays a ${BEACON_TOLL}g beacon toll at ${n.name}.`);
    }
  } else {
    state.movement = null;
    resolveLanding(state);
  }
}

function crossedCapital(state: GameState, player: Player) {
  player.cash += CROSSROADS_INCOME;
  log(state, `${player.name} passes the Crossroads and collects ${CROSSROADS_INCOME}g.`);
  for (const id of playerProps(state, player.id)) {
    const o = own(state, id);
    const g = garrison(o);
    if (g && GARRISON_UPKEEP[g] > 0) charge(state, player.id, GARRISON_UPKEEP[g], null);
    if (hasEnchant(o, 'vault') && !o.mortgaged) player.cash += VAULT_INCOME;
    if (hasEnchant(o, 'trap')) o.trapArmed = true;
    if (hasEnchant(o, 'orb')) o.orbReady = true;
  }
}

function diceTotal(state: GameState): number {
  const r = state.movement?.rolled ?? null;
  return r ? r[0] + r[1] : 7; // teleports rent mana nodes at an average roll
}

function resolveLanding(state: GameState, dice = diceTotal(state)): void {
  const player = cur(state);
  const n = node(player.pos);
  switch (n.type) {
    case 'prop': case 'way': case 'mana': {
      const o = own(state, n.id);
      if (o.owner === null) {
        state.pending = { type: 'buyOrPass', player: player.id, node: n.id, price: n.price! };
        return;
      }
      if (o.owner !== player.id) return payRent(state, player, n.id, dice);
      return finishLanding(state);
    }
    case 'fate': return drawFate(state, player);
    case 'quest': case 'tavern': return drawQuest(state, player);
    case 'levy': {
      charge(state, player.id, LEVY_COST, null);
      if (player.bankrupt) return;
      log(state, `${player.name} pays the King's Levy: ${LEVY_COST}g.`);
      return finishLanding(state);
    }
    default: return finishLanding(state);
  }
}

/** Landing fully resolved: settle into postroll (or let the dungeon/turn logic take over). */
function finishLanding(state: GameState) {
  if (state.winner === null) state.phase = 'postroll';
}

function payRent(state: GameState, player: Player, id: NodeId, dice: number) {
  const o = own(state, id);
  const rent = rentFor(state, player, id, dice);
  if (rent <= 0) return finishLanding(state);
  const guarded = garrison(o) === 'guard' || garrison(o) === 'ogre' || garrison(o) === 'drake';
  if (player.cls === 'rogue' && player.abilityCooldown === 0 && !guarded) {
    state.pending = { type: 'pickpocket', player: player.id, node: id, rent, owner: o.owner! };
    return;
  }
  settleRent(state, player, id, rent);
}

function settleRent(state: GameState, player: Player, id: NodeId, rent: number) {
  const o = own(state, id);
  if (o.trapArmed && hasEnchant(o, 'trap')) {
    o.trapArmed = false;
    log(state, `A snare springs at ${node(id).name}!`);
  }
  const owner = o.owner!;
  charge(state, player.id, rent, owner);
  if (player.bankrupt) return;
  log(state, `${player.name} pays ${rent}g rent at ${node(id).name} to ${P(state, owner).name}.`);
  finishLanding(state);
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

function draw(state: GameState, deck: 'fateDeck' | 'questDeck'): string {
  const id = state[deck].shift()!;
  state[deck].push(id);
  return id;
}

function drawFate(state: GameState, player: Player): void {
  const id = draw(state, 'fateDeck');
  const card = CARD_BY_ID.get(id)!;
  log(state, `${player.name} draws Fate: ${card.name} — ${card.text}`);
  switch (id) {
    case 'rockfall': return sendToDungeon(state, player);
    case 'windfall': player.cash += 100; break;
    case 'tithe': charge(state, player.id, 80, null); break;
    case 'tailwind': {
      player.pos = 'crossroads';
      crossedCapital(state, player);
      break;
    }
    case 'curse': {
      const options = curseTargets(state, player.id);
      if (options.length) {
        state.pending = { type: 'chooseCurseTarget', player: player.id, options };
        return;
      }
      break;
    }
    case 'writ': player.writs++; break;
    case 'waystorm': {
      const dist = distancesFrom(player.pos);
      const gate = WAYGATES
        .filter(w => dist.has(w) && dist.get(w)! > 0)
        .sort((a, b) => dist.get(a)! - dist.get(b)!)[0];
      if (gate) {
        player.pos = gate;
        log(state, `${player.name} is hurled to ${node(gate).name}.`);
        return resolveLanding(state, 7);
      }
      break;
    }
    case 'bandits': {
      const tiers = playerProps(state, player.id)
        .reduce((s, pid) => s + settlementTiers(own(state, pid)), 0);
      charge(state, player.id, 20 * tiers, null);
      break;
    }
    case 'market': player.cash += 25 * playerProps(state, player.id).length; break;
    case 'busking':
      for (const rival of alive(state)) {
        if (rival.id !== player.id) charge(state, rival.id, 10, player.id);
      }
      break;
    case 'sinkhole': charge(state, player.id, 75, null); break;
    case 'fortune': player.cash += 150; break;
  }
  if (player.bankrupt) return;
  finishLanding(state);
}

function curseTargets(state: GameState, by: PlayerId): NodeId[] {
  return PROPERTY_NODES
    .map(n => n.id)
    .filter(id => {
      const o = own(state, id);
      return o.owner !== null && o.owner !== by && !o.cursed
        && !hasEnchant(o, 'ward') && !P(state, o.owner).sanctuary && !P(state, o.owner).bankrupt;
    });
}

function drawQuest(state: GameState, player: Player): void {
  const id = draw(state, 'questDeck');
  const card = CARD_BY_ID.get(id)!;
  log(state, `${player.name} draws a Quest: ${card.name} — ${card.text}`);
  switch (id) {
    case 'harvest': player.cash += 100; break;
    case 'errand': player.cash += 50; break;
    case 'escort': player.cash += 75; break;
    case 'treasury': player.cash += 200; break;
    case 'tithe2': charge(state, player.id, 25, null); break;
    case 'egg': player.cash += 150; break;
    case 'roads': player.cash += 10 * playerProps(state, player.id).length; break;
    case 'banners': {
      const sets = (['shire', 'silver', 'wild', 'iron', 'sun', 'mage', 'dragon', 'celest'] as const)
        .filter(r => ownsFullSet(state, player.id, r)).length;
      player.cash += 100 * sets;
      break;
    }
    default:
      if (KEPT_QUESTS.has(id) && !player.keptQuests.some(k => k.id === id)) {
        player.keptQuests.push({ id, name: card.name });
      }
  }
  if (player.bankrupt) return;
  finishLanding(state);
}

function checkKeptQuests(state: GameState, player: Player) {
  player.keptQuests = player.keptQuests.filter(k => {
    if (k.id === 'gates') {
      const gates = WAYGATES.filter(w => own(state, w).owner === player.id).length;
      if (gates >= 3) {
        player.cash += 300;
        log(state, `${player.name} completes "Master of Gates": +300g.`);
        return false;
      }
    }
    if (k.id === 'castle') {
      const done = playerProps(state, player.id)
        .some(id => settlementTiers(own(state, id)) >= 3);
      if (done) {
        player.cash += 200;
        log(state, `${player.name} completes "Raise a Castle": +200g.`);
        return false;
      }
    }
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Dungeon                                                             */
/* ------------------------------------------------------------------ */

function sendToDungeon(state: GameState, player: Player) {
  player.pos = 'dungeon';
  player.inDungeon = true;
  player.dungeonTurns = 0;
  state.movement = null;
  state.consecutiveDoubles = 0;
  state.pending = null;
  log(state, `${player.name} is thrown into the Dungeon!`);
  finishLanding(state);
}

function releaseFromDungeon(state: GameState, player: Player) {
  player.inDungeon = false;
  player.dungeonTurns = 0;
  player.pos = 'delve';
  log(state, `${player.name} steps out of the Dungeon at the Old Delve.`);
}

/* ------------------------------------------------------------------ */
/* Turn flow                                                           */
/* ------------------------------------------------------------------ */

function beginTurn(state: GameState) {
  if (state.winner !== null) return;
  const player = cur(state);
  player.actionUsed = false;
  player.sanctuary = false;
  if (player.abilityCooldown > 0) player.abilityCooldown--;
  state.consecutiveDoubles = 0;
  state.phase = 'preroll';
  state.pending = null;

  if (player.inDungeon) {
    // garrisons demand double upkeep while the boss is away
    for (const id of playerProps(state, player.id)) {
      const g = garrison(own(state, id));
      if (g && GARRISON_UPKEEP[g] > 0) charge(state, player.id, GARRISON_UPKEEP[g] * 2, null);
    }
    if (player.bankrupt || state.winner !== null) return;
    if (player.dungeonTurns >= 3) {
      charge(state, player.id, DUNGEON_BRUISES, null);
      log(state, `${player.name} is dragged out after ${DUNGEON_BRUISES}g in bruises.`);
      if (!player.bankrupt) releaseFromDungeon(state, player);
      return;
    }
    state.pending = { type: 'dungeon', player: player.id };
  }
}

function endTurn(state: GameState) {
  const player = cur(state);
  checkKeptQuests(state, player);
  if (state.winner !== null) return;

  const rolled = state.movement?.rolled ?? null;
  const wasDouble = state.lastRollDouble;
  state.lastRollDouble = false;
  if (wasDouble && !player.inDungeon && !player.bankrupt) {
    state.phase = 'preroll';
    log(state, `${player.name} rolled doubles and goes again.`);
    return;
  }

  // next living player; wrap increments the round
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const next = (state.current + step) % n;
    if (!state.players[next].bankrupt) {
      if (next <= state.current) advanceRound(state);
      state.current = next;
      break;
    }
  }
  beginTurn(state);
}

function advanceRound(state: GameState) {
  state.round++;
  if (state.round === AUTUMN_ROUND) {
    state.season = 'autumn';
    log(state, '— Autumn has come. All rents rise +25%. —');
  }
  if (state.round === WINTER_ROUND) {
    state.season = 'winter';
    log(state, '— Winter has come. All rents rise +50%. —');
  }
  if (state.round > ROUND_CAP) {
    const best = alive(state)
      .map(p => ({ p, w: netWorth(state, p) }))
      .sort((a, b) => b.w - a.w)[0];
    endGame(state, best.p.id, `richest at round ${ROUND_CAP}: ${best.w}g`);
  }
}

/* ------------------------------------------------------------------ */
/* Auctions                                                            */
/* ------------------------------------------------------------------ */

function startAuction(state: GameState, id: NodeId) {
  const order: PlayerId[] = [];
  const n = state.players.length;
  for (let i = 0; i < n; i++) {
    const p = state.players[(state.current + i) % n];
    if (!p.bankrupt) order.push(p.id);
  }
  state.auction = { node: id, currentBid: 0, leader: null, active: order, turn: 0 };
  log(state, `${node(id).name} goes to auction.`);
  promptAuction(state);
}

function promptAuction(state: GameState) {
  const a = state.auction!;
  state.pending = {
    type: 'auctionBid', player: a.active[a.turn],
    node: a.node, currentBid: a.currentBid, leader: a.leader,
  };
}

function auctionNext(state: GameState) {
  const a = state.auction!;
  if (a.active.length === 0) return settleAuction(state);
  a.turn = a.turn % a.active.length;
  // the leader never bids against themselves; skip them, and settle once only they remain
  while (a.active[a.turn] === a.leader) {
    if (a.active.length === 1) return settleAuction(state);
    a.turn = (a.turn + 1) % a.active.length;
  }
  promptAuction(state);
}

function settleAuction(state: GameState) {
  const a = state.auction!;
  state.auction = null;
  state.pending = null;
  if (a.leader !== null) {
    const winner = P(state, a.leader);
    charge(state, winner.id, a.currentBid, null);
    if (!winner.bankrupt) {
      own(state, a.node).owner = winner.id;
      log(state, `${winner.name} wins ${node(a.node).name} at auction for ${a.currentBid}g.`);
    }
  } else {
    log(state, `No one bids for ${node(a.node).name}; it stays wild.`);
  }
  finishLanding(state);
}

/* ------------------------------------------------------------------ */
/* Abilities                                                           */
/* ------------------------------------------------------------------ */

function useAbility(state: GameState, target?: NodeId): string | null {
  const player = cur(state);
  if (player.abilityCooldown > 0) return 'ability not ready';
  const arm = () => { player.abilityCooldown = ABILITY_COOLDOWN; player.actionUsed = true; };

  switch (player.cls) {
    case 'warrior': {
      const here = player.pos;
      const near = new Set<NodeId>([here, ...node(here).out]);
      for (const n of BOARD.values()) if (n.out.includes(here)) near.add(n.id);
      let hit = 0;
      for (const rival of alive(state)) {
        if (rival.id !== player.id && !rival.sanctuary && near.has(rival.pos)) {
          charge(state, rival.id, 25, player.id);
          hit++;
        }
      }
      if (hit === 0) return 'no one within reach';
      arm();
      log(state, `${player.name} shakes down ${hit} traveller(s) for 25g each.`);
      return null;
    }
    case 'wizard': {
      if (state.phase !== 'preroll' || state.movement) return 'blink replaces your roll';
      if (!target) return 'choose a destination';
      const dist = distancesFrom(player.pos, 8);
      const d = dist.get(target);
      if (d === undefined || d < 1 || d > 8) return 'out of range';
      arm();
      player.pos = target;
      log(state, `${player.name} blinks to ${node(target).name}.`);
      resolveLanding(state, 7);
      return null;
    }
    case 'cleric': {
      arm();
      player.sanctuary = true;
      log(state, `${player.name} calls a Sanctuary.`);
      return null;
    }
    case 'bard': {
      const t = state.lastTrade;
      if (!t) return 'no trade to echo';
      for (const [meAs, other] of [['from', t.to], ['to', t.from]] as const) {
        const iGive = meAs === 'from' ? t.giveProps : t.getProps;
        const iGiveGold = meAs === 'from' ? t.giveGold : t.getGold;
        const iGet = meAs === 'from' ? t.getProps : t.giveProps;
        const iGetGold = meAs === 'from' ? t.getGold : t.giveGold;
        const otherP = P(state, other);
        if (otherP.bankrupt || otherP.sanctuary) continue;
        const canGive = iGive.every(id => own(state, id).owner === player.id)
          && player.cash >= iGiveGold;
        const canTake = iGet.every(id => own(state, id).owner === other)
          && otherP.cash >= iGetGold;
        if (canGive && canTake) {
          arm();
          executeTrade(state, {
            from: player.id, to: other,
            giveProps: iGive, giveGold: iGiveGold,
            getProps: iGet, getGold: iGetGold, countered: false,
          });
          log(state, `${player.name} silver-tongues the same bargain with ${otherP.name}.`);
          return null;
        }
      }
      return 'the old bargain cannot be repeated';
    }
    case 'merchant': {
      if (!target) return 'choose a property';
      const o = state.ownership[target];
      if (!o || o.owner !== null) return 'not for sale';
      const d = distancesFrom(player.pos, 5).get(target);
      if (d === undefined) return 'too far';
      const price = Math.round(node(target).price! * 1.2);
      if (player.cash < price) return 'not enough gold';
      arm();
      player.cash -= price;
      o.owner = player.id;
      log(state, `${player.name} appraises and buys ${node(target).name} for ${price}g.`);
      return null;
    }
    case 'ranger': {
      if (!target) return 'choose a property';
      const o = state.ownership[target];
      if (!o || o.owner !== null || node(target).type !== 'prop') return 'not wild land';
      arm();
      player.pos = target;
      log(state, `${player.name} tracks a trail to ${node(target).name}.`);
      state.pending = {
        type: 'buyOrPass', player: player.id, node: target, price: node(target).price!,
      };
      state.rangerClaim = true;
      return null;
    }
    case 'necromancer': {
      if (!target) return 'choose a property';
      const o = state.ownership[target];
      if (!o || o.owner !== player.id || !o.mortgaged) return 'no mortgaged land chosen';
      arm();
      o.mortgaged = false;
      log(state, `${player.name} raises ${node(target).name} from its debts.`);
      return null;
    }
    case 'rogue':
      return 'pickpocket triggers when you pay rent';
  }
}

/* ------------------------------------------------------------------ */
/* Trades                                                              */
/* ------------------------------------------------------------------ */

function tradeError(state: GameState, offer: TradeOffer): string | null {
  const from = P(state, offer.from), to = P(state, offer.to);
  if (from.bankrupt || to.bankrupt) return 'party is bankrupt';
  for (const id of offer.giveProps) {
    const o = state.ownership[id];
    if (!o || o.owner !== offer.from) return 'you do not own that';
    if (o.upgrades.length) return 'improved lands cannot be traded';
  }
  for (const id of offer.getProps) {
    const o = state.ownership[id];
    if (!o || o.owner !== offer.to) return 'they do not own that';
    if (o.upgrades.length) return 'improved lands cannot be traded';
  }
  if (offer.giveGold > from.cash) return 'not enough gold';
  if (offer.getGold > to.cash) return 'they lack the gold';
  if (!offer.giveProps.length && !offer.getProps.length && !offer.giveGold && !offer.getGold) {
    return 'empty offer';
  }
  return null;
}

function executeTrade(state: GameState, offer: TradeOffer) {
  const from = P(state, offer.from), to = P(state, offer.to);
  from.cash += offer.getGold - offer.giveGold;
  to.cash += offer.giveGold - offer.getGold;
  for (const id of offer.giveProps) own(state, id).owner = offer.to;
  for (const id of offer.getProps) own(state, id).owner = offer.from;
  state.lastTrade = { ...offer };
  log(state, `${from.name} and ${to.name} strike a bargain.`);
}

/* ------------------------------------------------------------------ */
/* The reducer                                                         */
/* ------------------------------------------------------------------ */

export function applyAction(state: GameState, action: Action): string | null {
  if (state.winner !== null) return 'the game is over';
  const player = cur(state);
  const pend = state.pending;

  /* ---- pending decisions take priority ---- */
  if (pend) {
    switch (pend.type) {
      case 'fork': {
        if (action.type !== 'chooseFork') return 'choose a path';
        if (!pend.options.includes(action.to)) return 'not a road from here';
        state.pending = null;
        advance(state, action.to);
        if (!player.bankrupt && state.winner === null) stepMove(state);
        return null;
      }
      case 'rangerAdjust': {
        if (action.type !== 'rangerAdjust') return 'choose your stride';
        if (!pend.options.includes(action.steps)) return 'not within your gift';
        state.pending = null;
        startMove(state, action.steps, [pend.rolled, 0] as unknown as [number, number]);
        return null;
      }
      case 'buyOrPass': {
        if (action.type === 'buy') {
          if (player.cash < pend.price) return 'not enough gold';
          player.cash -= pend.price;
          own(state, pend.node).owner = player.id;
          bardTip(state, player);
          log(state, `${player.name} claims ${node(pend.node).name} for ${pend.price}g.`);
          state.pending = null;
          state.rangerClaim = false;
          finishLanding(state);
          return null;
        }
        if (action.type === 'declineBuy') {
          state.pending = null;
          bardTip(state, player);
          if (state.rangerClaim) {
            state.rangerClaim = false;
            finishLanding(state);
          } else {
            startAuction(state, pend.node);
          }
          return null;
        }
        return 'buy or decline';
      }
      case 'auctionBid': {
        const a = state.auction!;
        const bidder = P(state, pend.player);
        if (action.type === 'bid') {
          const min = a.currentBid + 10;
          if (action.amount < min) return `bid at least ${min}g`;
          if (action.amount > bidder.cash) return 'not enough gold';
          a.currentBid = action.amount;
          a.leader = bidder.id;
          a.turn = (a.active.indexOf(bidder.id) + 1) % a.active.length;
          state.pending = null;
          auctionNext(state);
          return null;
        }
        if (action.type === 'passBid') {
          const idx = a.active.indexOf(bidder.id);
          a.active.splice(idx, 1);
          a.turn = idx; // next bidder now sits at the same index
          state.pending = null;
          auctionNext(state);
          return null;
        }
        return 'bid or pass';
      }
      case 'pickpocket': {
        if (action.type !== 'pickpocket') return 'declare the pickpocket';
        state.pending = null;
        if (action.use) {
          player.abilityCooldown = ABILITY_COOLDOWN;
          const die = rollDie(state);
          if (die >= 5) {
            log(state, `${player.name} pickpockets the rent back (rolled ${die}) — pays nothing!`);
            finishLanding(state);
            return null;
          }
          log(state, `${player.name} fumbles the lift (rolled ${die}).`);
        }
        settleRent(state, player, pend.node, pend.rent);
        return null;
      }
      case 'dungeon': {
        if (action.type !== 'dungeonChoice') return 'choose how to face the Dungeon';
        state.pending = null;
        const bribe = player.cls === 'warrior' ? 0 : DUNGEON_BRIBE;
        switch (action.choice) {
          case 'bribe':
            if (player.cash < bribe) return 'not enough gold';
            charge(state, player.id, bribe, null);
            releaseFromDungeon(state, player);
            state.phase = 'preroll';
            return null;
          case 'writ':
            if (player.writs <= 0) return 'no writ held';
            player.writs--;
            releaseFromDungeon(state, player);
            state.phase = 'preroll';
            return null;
          case 'roll': {
            const [a, b] = roll2d6(state);
            state.lastRoll = [a, b];
            if (a === b) {
              log(state, `${player.name} rolls double ${a}s and escapes!`);
              releaseFromDungeon(state, player);
              startMove(state, a + b, [a, b]);
            } else {
              player.dungeonTurns++;
              log(state, `${player.name} rattles the bars in vain (${a}+${b}).`);
              state.phase = 'postroll';
            }
            return null;
          }
          case 'fight': {
            const [a, b] = roll2d6(state);
            const winFight = player.cls === 'warrior' || a + b >= 8;
            if (winFight) {
              log(state, `${player.name} fights free (${a}+${b})!`);
              releaseFromDungeon(state, player);
              const [c, d] = roll2d6(state);
              startMove(state, c + d, [c, d]);
            } else {
              charge(state, player.id, DUNGEON_BRUISES, null);
              if (player.bankrupt) return null;
              player.dungeonTurns++;
              log(state, `${player.name} is beaten back (${a}+${b}) — ${DUNGEON_BRUISES}g in bruises.`);
              state.phase = 'postroll';
            }
            return null;
          }
        }
        return 'unknown choice';
      }
      case 'chooseCurseTarget': {
        if (action.type !== 'chooseCurseTarget') return 'choose a curse target';
        state.pending = null;
        if (action.node) {
          if (!pend.options.includes(action.node)) return 'cannot curse that';
          own(state, action.node).cursed = true;
          log(state, `${P(state, pend.player).name} curses ${node(action.node).name}!`);
        }
        finishLanding(state);
        return null;
      }
      case 'tradeOffer': {
        if (action.type !== 'respondTrade') return 'answer the offer';
        const offer = pend.offer;
        state.pending = null;
        if (action.response === 'accept') {
          const err = tradeError(state, offer);
          if (err) { log(state, `The bargain collapses: ${err}.`); return null; }
          executeTrade(state, offer);
          return null;
        }
        if (action.response === 'counter' && !offer.countered) {
          const extra = Math.max(10, action.counterGold ?? 50);
          state.pending = {
            type: 'tradeOffer',
            player: offer.from,
            offer: {
              from: offer.from, to: offer.to,
              giveProps: offer.giveProps, giveGold: offer.giveGold + extra,
              getProps: offer.getProps, getGold: offer.getGold,
              countered: true,
            },
          };
          log(state, `${P(state, offer.to).name} counters: another ${extra}g.`);
          return null;
        }
        log(state, `${P(state, offer.to).name} declines the bargain.`);
        return null;
      }
    }
  }

  /* ---- no pending: phase actions ---- */
  switch (action.type) {
    case 'roll': {
      if (state.phase !== 'preroll') return 'not the time to roll';
      if (state.movement) return 'already moving';
      const [a, b] = roll2d6(state);
      state.lastRoll = [a, b];
      state.lastRollDouble = a === b;
      if (a === b) {
        state.consecutiveDoubles++;
        if (state.consecutiveDoubles >= 3) {
          log(state, `${player.name} rolls a third double — the watch takes notice!`);
          state.lastRollDouble = false;
          sendToDungeon(state, player);
          return null;
        }
      } else {
        state.consecutiveDoubles = 0;
      }
      log(state, `${player.name} rolls ${a}+${b}.`);
      if (player.cls === 'ranger') {
        const total = a + b;
        const options = [...new Set([Math.max(1, total - 1), total, total + 1])];
        state.pending = { type: 'rangerAdjust', player: player.id, rolled: total, options };
        state.movement = { remaining: 0, rolled: [a, b] };
        return null;
      }
      startMove(state, a + b, [a, b]);
      return null;
    }
    case 'endTurn': {
      if (state.phase !== 'postroll') return 'finish your move first';
      endTurn(state);
      return null;
    }
    case 'build': {
      const gate = actionGate(state, player); if (gate) return gate;
      const err = buildError(state, player, action.node, action.upgrade);
      if (err) return err;
      const cost = upgradeCost(state, player, action.node, action.upgrade);
      player.cash -= cost;
      own(state, action.node).upgrades.push(action.upgrade);
      if (action.upgrade.kind === 'settlement') state.stock.settlements--;
      if (action.upgrade.kind === 'enchant') {
        state.stock.enchants[action.upgrade.enchant]--;
        if (action.upgrade.enchant === 'trap') own(state, action.node).trapArmed = true;
        if (action.upgrade.enchant === 'orb') own(state, action.node).orbReady = true;
      }
      player.actionUsed = true;
      log(state, `${player.name} builds on ${node(action.node).name} (${cost}g).`);
      return null;
    }
    case 'sellUpgrade': {
      const gate = actionGate(state, player); if (gate) return gate;
      const o = state.ownership[action.node];
      if (!o || o.owner !== player.id) return 'not yours';
      const up = o.upgrades[action.slot];
      if (!up) return 'empty slot';
      o.upgrades.splice(action.slot, 1);
      returnToStock(state, up);
      player.cash += upgradeSaleValue(state, player, action.node, up);
      player.actionUsed = true;
      return null;
    }
    case 'mortgage': {
      const gate = actionGate(state, player); if (gate) return gate;
      const o = state.ownership[action.node];
      if (!o || o.owner !== player.id || o.mortgaged || o.upgrades.length) return 'cannot mortgage';
      o.mortgaged = true;
      player.cash += mortgageValue(action.node);
      player.actionUsed = true;
      return null;
    }
    case 'unmortgage': {
      const gate = actionGate(state, player); if (gate) return gate;
      const o = state.ownership[action.node];
      if (!o || o.owner !== player.id || !o.mortgaged) return 'not mortgaged';
      const cost = unmortgageCost(action.node);
      if (player.cash < cost) return 'not enough gold';
      player.cash -= cost;
      o.mortgaged = false;
      player.actionUsed = true;
      return null;
    }
    case 'cleanse': {
      const gate = actionGate(state, player); if (gate) return gate;
      const o = state.ownership[action.node];
      if (!o || o.owner !== player.id || !o.cursed) return 'nothing to cleanse';
      const cost = player.cls === 'cleric' ? 0 : CURSE_CLEANSE_COST;
      if (player.cash < cost) return 'not enough gold';
      player.cash -= cost;
      o.cursed = false;
      player.actionUsed = true;
      log(state, `${player.name} cleanses ${node(action.node).name}.`);
      return null;
    }
    case 'useAbility': {
      const gate = actionGate(state, player); if (gate) return gate;
      return useAbility(state, action.target);
    }
    case 'proposeTrade': {
      const gate = actionGate(state, player); if (gate) return gate;
      const offer: TradeOffer = { ...action.offer, countered: false };
      if (offer.from !== player.id) return 'propose your own bargains';
      const err = tradeError(state, offer);
      if (err) return err;
      player.actionUsed = true;
      state.pending = { type: 'tradeOffer', player: offer.to, offer };
      return null;
    }
    default:
      return 'nothing to do with that now';
  }
}

/** One optional Action per turn, taken while it is your turn and nothing is pending. */
function actionGate(state: GameState, player: Player): string | null {
  if (state.phase !== 'preroll' && state.phase !== 'postroll') return 'not now';
  if (player.actionUsed) return 'action already taken this turn';
  return null;
}

function bardTip(state: GameState, lander: Player) {
  for (const bard of alive(state)) {
    if (bard.cls === 'bard') bard.cash += 10;
  }
  void lander;
}

/** Which player must act right now (pending decisions can belong to non-current players). */
export function actingPlayer(state: GameState): PlayerId {
  return state.pending ? state.pending.player : state.current;
}

/** Internal hooks for the test suite only. */
export const _test = { resolveLanding, charge, sendToDungeon, crossedCapital };
