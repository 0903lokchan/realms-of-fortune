import type { BoardNode, NodeId, Region } from './types';
import { FERRY_TOLL } from './types';

// The map from DESIGN.md §2 / mockups: a 27-node main loop, the Ironvein Pass,
// the Underway sea route, and the Dungeon spur. Movement is one-way (directed).

const LOOP: Array<Partial<BoardNode> & { id: NodeId; name: string }> = [
  { id: 'crossroads', name: 'The Crossroads', type: 'capital' },
  { id: 'bramble',    name: 'Bramble Farm',   type: 'prop', region: 'shire',  price: 60 },
  { id: 'millbrook',  name: 'Millbrook',      type: 'prop', region: 'shire',  price: 70 },
  { id: 'quest1',     name: 'Quest',          type: 'quest' },
  { id: 'way_s',      name: 'South Waygate',  type: 'way',  price: 200 },
  { id: 'ferry',      name: 'Ferry Cross',    type: 'prop', region: 'silver', price: 100 },
  { id: 'quay',       name: 'Silver Quay',    type: 'prop', region: 'silver', price: 110 },
  { id: 'way_w',      name: 'West Waygate',   type: 'way',  price: 200 },
  { id: 'fate1',      name: 'Fate',           type: 'fate' },
  { id: 'elder',      name: 'Elder Glade',    type: 'prop', region: 'wild',   price: 140 },
  { id: 'thorn',      name: 'Thornholt',      type: 'prop', region: 'wild',   price: 150 },
  { id: 'manawell',   name: 'Mana Well',      type: 'mana', price: 150 },
  { id: 'way_n',      name: 'North Waygate',  type: 'way',  price: 200 },
  { id: 'forge',      name: 'Deep Forge',     type: 'prop', region: 'iron',   price: 180 },
  { id: 'karak',      name: 'Karak Mine',     type: 'prop', region: 'iron',   price: 190 },
  { id: 'fate2',      name: 'Fate',           type: 'fate' },
  { id: 'coral',      name: 'Coral Port',     type: 'prop', region: 'sun',    price: 220 },
  { id: 'sunspire',   name: 'Sunspire',       type: 'prop', region: 'sun',    price: 230 },
  { id: 'rune',       name: 'Rune Court',     type: 'prop', region: 'mage',   price: 260 },
  { id: 'arcanum',    name: 'Arcanum',        type: 'prop', region: 'mage',   price: 270 },
  { id: 'leyline',    name: 'Ley Line Nexus', type: 'mana', price: 150 },
  { id: 'way_e',      name: 'East Waygate',   type: 'way',  price: 200 },
  { id: 'ash',        name: 'Ash Crag',       type: 'prop', region: 'dragon', price: 300 },
  { id: 'wyrm',       name: "Wyrm's Rest",    type: 'prop', region: 'dragon', price: 320 },
  { id: 'levy',       name: "King's Levy",    type: 'levy' },
  { id: 'high',       name: 'High Court',     type: 'prop', region: 'celest', price: 350 },
  { id: 'citadel',    name: 'The Citadel',    type: 'prop', region: 'celest', price: 400 },
];

const OFFLOOP: Array<Partial<BoardNode> & { id: NodeId; name: string }> = [
  // Ironvein Pass: quay -> rockfall -> delve -> wyvern -> cliff -> rune
  { id: 'rockfall', name: 'Rockfall',       type: 'fate' },
  { id: 'delve',    name: 'The Old Delve',  type: 'quest' },
  { id: 'wyvern',   name: 'Wyvern Watch',   type: 'trail' },
  { id: 'cliff',    name: 'Cliff Stair',    type: 'trail' },
  // The Underway: sunspire -> gull (ferry toll) -> tavern -> cove -> high
  { id: 'gull',     name: 'Gull Rock',        type: 'trail' },
  { id: 'tavern',   name: 'The Tavern',       type: 'tavern' },
  { id: 'cove',     name: "Smuggler's Cove",  type: 'fate' },
  // Dungeon spur (not walkable; players are sent here and released onto the Old Delve)
  { id: 'dungeon',  name: 'The Dungeon',      type: 'dungeon' },
];

function buildBoard(): Map<NodeId, BoardNode> {
  const nodes = new Map<NodeId, BoardNode>();
  for (const n of [...LOOP, ...OFFLOOP]) {
    nodes.set(n.id, { out: [], ...n } as BoardNode);
  }
  // main loop edges
  for (let i = 0; i < LOOP.length; i++) {
    nodes.get(LOOP[i].id)!.out.push(LOOP[(i + 1) % LOOP.length].id);
  }
  // Ironvein Pass
  nodes.get('quay')!.out.push('rockfall');
  nodes.get('rockfall')!.out.push('delve');
  nodes.get('delve')!.out.push('wyvern');
  nodes.get('wyvern')!.out.push('cliff');
  nodes.get('cliff')!.out.push('rune');
  // The Underway
  nodes.get('sunspire')!.out.push('gull');
  nodes.get('gull')!.entryToll = FERRY_TOLL;
  nodes.get('gull')!.out.push('tavern');
  nodes.get('tavern')!.out.push('cove');
  nodes.get('cove')!.out.push('high');
  return nodes;
}

export const BOARD: Map<NodeId, BoardNode> = buildBoard();

export function node(id: NodeId): BoardNode {
  const n = BOARD.get(id);
  if (!n) throw new Error(`unknown node: ${id}`);
  return n;
}

export const ALL_NODES: BoardNode[] = [...BOARD.values()];
export const OWNABLE_TYPES = new Set(['prop', 'way', 'mana']);
export const OWNABLE_NODES: BoardNode[] = ALL_NODES.filter(n => OWNABLE_TYPES.has(n.type));
export const PROPERTY_NODES: BoardNode[] = ALL_NODES.filter(n => n.type === 'prop');
export const WAYGATES: NodeId[] = ALL_NODES.filter(n => n.type === 'way').map(n => n.id);
export const MANA_NODES: NodeId[] = ALL_NODES.filter(n => n.type === 'mana').map(n => n.id);

export function regionProps(region: Region): BoardNode[] {
  return PROPERTY_NODES.filter(n => n.region === region);
}

/** Settlement construction cost per region (Monopoly-style house prices). */
export const BUILD_COST: Record<Region, number> = {
  shire: 50, silver: 50, wild: 100, iron: 100,
  sun: 150, mage: 150, dragon: 200, celest: 200,
};

export const ENCHANT_COST = 100;
export const GARRISON_COST: Record<'guard' | 'ogre' | 'drake', number> = { guard: 50, ogre: 150, drake: 250 };
export const GARRISON_UPKEEP: Record<'guard' | 'ogre' | 'drake', number> = { guard: 0, ogre: 10, drake: 25 };

export interface Walk { end: NodeId; path: NodeId[] }

/** Every walk of exactly `steps` moves from `start`; a fork on the way yields one walk per road. */
export function walksFrom(start: NodeId, steps: number): Walk[] {
  let walks: Walk[] = [{ end: start, path: [start] }];
  for (let i = 0; i < steps; i++) {
    walks = walks.flatMap(w => node(w.end).out.map(to => ({ end: to, path: [...w.path, to] })));
  }
  return walks;
}

/** Directed BFS distances from a node (used by Blink / Appraise / AI lookahead). */
export function distancesFrom(start: NodeId, maxDepth = 99): Map<NodeId, number> {
  const dist = new Map<NodeId, number>([[start, 0]]);
  let frontier = [start];
  let d = 0;
  while (frontier.length && d < maxDepth) {
    d++;
    const next: NodeId[] = [];
    for (const id of frontier) {
      for (const to of node(id).out) {
        if (!dist.has(to)) { dist.set(to, d); next.push(to); }
      }
    }
    frontier = next;
  }
  return dist;
}
