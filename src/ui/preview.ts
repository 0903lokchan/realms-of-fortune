// Where a pending movement choice would land you, for the stride and fork dialogs and
// their map markers. Pure functions of the game state, no DOM.

import { node, walksFrom } from '../engine/board';
import { hasEnchant, rentFor } from '../engine/rules';
import type { GameState, NodeId, PlayerId } from '../engine/types';
import { BEACON_TOLL, CROSSROADS_INCOME, LEVY_COST } from '../engine/types';

export type Tone = 'good' | 'bad' | 'own' | 'neutral';

export interface Landing {
  /** Ties a dialog option to its map markers: the step count, or the fork's next node. */
  key: string;
  /** Short marker label. */
  badge: string;
  end: NodeId;
  /** What happens on arrival, e.g. "Vex's land · rent 64g". */
  note: string;
  tone: Tone;
  /** Things passed on the way, e.g. "+150g at the Crossroads". */
  perks: string[];
}

export interface Preview {
  kind: 'stride' | 'fork';
  landings: Landing[];
}

function describeEnd(state: GameState, human: PlayerId, id: NodeId, dice: number): { note: string; tone: Tone } {
  const n = node(id);
  const o = state.ownership[id];
  if (o) {
    if (o.owner === null) return { note: `unclaimed · ${n.price}g`, tone: 'good' };
    if (o.owner === human) return { note: 'your land', tone: 'own' };
    const owner = state.players[o.owner].name;
    if (o.mortgaged) return { note: `${owner}'s land · mortgaged, no rent`, tone: 'neutral' };
    const rent = rentFor(state, state.players[human], id, dice);
    return { note: `${owner}'s land · rent ${rent}g${n.type === 'mana' ? ' (by dice)' : ''}`, tone: 'bad' };
  }
  switch (n.type) {
    case 'capital': return { note: `collect ${CROSSROADS_INCOME}g`, tone: 'good' };
    case 'fate': return { note: 'draw a Fate card', tone: 'neutral' };
    case 'quest': return { note: 'draw a Quest card', tone: 'good' };
    case 'tavern': return { note: 'a free Quest card', tone: 'good' };
    case 'levy': return { note: `King's Levy · pay ${LEVY_COST}g`, tone: 'bad' };
    default: return { note: 'a quiet trail', tone: 'neutral' };
  }
}

/** Gains and costs met while walking `path` (path[0] is the start, the last node is the landing). */
function perksOf(state: GameState, human: PlayerId, path: NodeId[]): string[] {
  const perks: string[] = [];
  const passed = path.slice(1, -1);
  if (passed.includes('crossroads')) perks.push(`+${CROSSROADS_INCOME}g at the Crossroads`);
  for (const id of path.slice(1)) {
    if (node(id).entryToll) perks.push(`−${node(id).entryToll}g ferry toll`);
  }
  const beacons = passed.filter(id => {
    const o = state.ownership[id];
    return o && o.owner !== null && o.owner !== human && !o.mortgaged && hasEnchant(o, 'beacon');
  }).length;
  if (beacons) perks.push(`−${BEACON_TOLL * beacons}g beacon toll${beacons > 1 ? 's' : ''}`);
  return perks;
}

function landingsFrom(
  state: GameState, human: PlayerId, start: NodeId, steps: number, dice: number,
  key: string, badge: string, prefix: NodeId[] = [],
): Landing[] {
  const seen = new Set<NodeId>();
  return walksFrom(start, steps)
    .filter(w => !seen.has(w.end) && (seen.add(w.end), true))
    .map(w => {
      const path = [...prefix, ...w.path];
      return { key, badge, end: w.end, perks: perksOf(state, human, path), ...describeEnd(state, human, w.end, dice) };
    });
}

/** Landing previews for the human's open movement decision, or null if there is none. */
export function previewFor(state: GameState, human: PlayerId): Preview | null {
  const pend = state.pending;
  if (!pend || pend.player !== human) return null;
  const pos = state.players[human].pos;

  if (pend.type === 'rangerAdjust') {
    return {
      kind: 'stride',
      landings: pend.options.flatMap(steps =>
        landingsFrom(state, human, pos, steps, pend.rolled, String(steps), String(steps))),
    };
  }
  if (pend.type === 'fork') {
    const remaining = state.movement?.remaining ?? 0;
    const r = state.movement?.rolled;
    const dice = r ? r[0] + r[1] : 7;
    return {
      kind: 'fork',
      landings: pend.options.flatMap((to, i) =>
        landingsFrom(state, human, to, remaining - 1, dice, to, String(i + 1), [pos])),
    };
  }
  return null;
}
