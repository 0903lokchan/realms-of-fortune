// Heroes for hire and tactic cards (DESIGN.md §11).

import type { HeroId, TacticId } from './types';

export interface HeroDef {
  id: HeroId;
  name: string;
  title: string;
  might: number;
  wits: number;
  cost: number;
  /** Starter tier: everyone begins with one of these. */
  starter?: boolean;
}

export const HEROES: HeroDef[] = [
  { id: 'pip',        name: 'Pip Thistlefoot',  title: 'Halfling Squire',      might: 3, wits: 3, cost: 90,  starter: true },
  { id: 'brannoc',    name: 'Brannoc',          title: 'Village Bruiser',      might: 5, wits: 1, cost: 100, starter: true },
  { id: 'tobias',     name: 'Old Tobias',       title: 'Quartermaster',        might: 1, wits: 5, cost: 100, starter: true },
  { id: 'kestrel',    name: 'Kestrel',          title: 'Border Scout',         might: 4, wits: 3, cost: 110, starter: true },
  { id: 'nell',       name: 'Nell of the Ferry', title: 'Smuggler',            might: 3, wits: 4, cost: 110, starter: true },
  { id: 'lyra',       name: 'Lyra Swiftbow',    title: 'Elven Archer',         might: 6, wits: 4, cost: 160 },
  { id: 'corvin',     name: 'Corvin the Grey',  title: 'Hedge Wizard',         might: 3, wits: 7, cost: 160 },
  { id: 'aldric',     name: 'Ser Aldric',       title: 'Knight-Errant',        might: 7, wits: 3, cost: 170 },
  { id: 'dain',       name: 'Dain Copperbeard', title: 'Dwarf Shieldwall',     might: 6, wits: 5, cost: 170 },
  { id: 'maren',      name: 'Sister Maren',     title: 'Battle-Cleric',        might: 5, wits: 6, cost: 170 },
  { id: 'zahra',      name: 'Zahra',            title: 'Alchemist',            might: 2, wits: 8, cost: 170 },
  { id: 'gruk',       name: 'Gruk Ironjaw',     title: 'Orc Warchief',         might: 8, wits: 2, cost: 200 },
  { id: 'ilwen',      name: 'Ilwen',            title: 'Seer of the Glade',    might: 2, wits: 9, cost: 210 },
  { id: 'valka',      name: 'Valka Stormshield', title: 'Shieldmaiden',        might: 7, wits: 5, cost: 220 },
  { id: 'eldrin',     name: 'Eldrin Moonweaver', title: 'Archmage',            might: 5, wits: 8, cost: 250 },
  { id: 'blackblade', name: 'The Black Blade',  title: 'Duelist',              might: 9, wits: 3, cost: 260 },
];

export const HERO_BY_ID: Map<HeroId, HeroDef> = new Map(HEROES.map(h => [h.id, h]));

export function hero(id: HeroId): HeroDef {
  const h = HERO_BY_ID.get(id);
  if (!h) throw new Error(`unknown hero: ${id}`);
  return h;
}

export interface TacticDef {
  id: TacticId;
  name: string;
  /** The 富甲天下 strategy it is modelled on, where there is one. */
  classic?: string;
  price: number;
  /** Targets a rival (and can be seen through, or turned back by a Feint). */
  hostile: boolean;
  text: string;
}

export const TACTICS: TacticDef[] = [
  { id: 'rooted',   name: 'Rooted',          classic: '故步自封', price: 100, hostile: true,  text: 'A rival skips their next move.' },
  { id: 'lure',     name: 'Lure',            classic: '調虎離山', price: 150, hostile: true,  text: 'Pull a rival onto one of your lands within 6 steps ahead of them; they owe rent there.' },
  { id: 'bridge',   name: 'Burn the Bridge', classic: '過河拆橋', price: 60,  hostile: false, text: 'Close the Ironvein Pass or the Underway to everyone else until your next turn.' },
  { id: 'feint',    name: 'Feint',           classic: '欲擒故縱', price: 90,  hostile: false, text: 'Kept in hand: the next hostile tactic played on you is turned back on its caster.' },
  { id: 'march',    name: 'Forced March',                         price: 50,  hostile: false, text: 'Roll a third die this turn.' },
  { id: 'sabotage', name: 'Sabotage',                             price: 140, hostile: true,  text: 'Destroy the newest upgrade on a rival land (a Ward protects it).' },
];

export const TACTIC_BY_ID: Map<TacticId, TacticDef> = new Map(TACTICS.map(t => [t.id, t]));

export function tactic(id: TacticId): TacticDef {
  return TACTIC_BY_ID.get(id)!;
}

/** Entrances of the two shortcuts, as offered by Burn the Bridge. */
export const SHORTCUT_ENTRANCES: Record<string, string> = { rockfall: 'the Ironvein Pass', gull: 'the Underway' };
