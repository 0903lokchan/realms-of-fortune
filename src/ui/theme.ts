import type { ClassId, Region } from '../engine/types';

export const REGION_COLORS: Record<Region, string> = {
  shire: '#a8b23f', silver: '#5fa7c9', wild: '#3f8f5a', iron: '#8f6a45',
  sun: '#e09a3f', mage: '#8f6fd0', dragon: '#d04038', celest: '#5a7fe0',
};

export const REGION_NAMES: Record<Region, string> = {
  shire: 'The Shirelands', silver: 'Silverbrook', wild: 'The Wildwood', iron: 'Ironvein Mts',
  sun: 'Sunspire Coast', mage: 'Mage Districts', dragon: 'Dragonspine', celest: 'Celestial Reach',
};

/** Seat colors: human is always seat 0. */
export const SEAT_COLORS = ['#4f8ef0', '#e0a832', '#b05fd0', '#e05038'];

export interface ClassInfo {
  label: string;
  color: string;
  passive: string;
  active: string;
  activeName: string;
  /** What the active ability needs as a target. */
  targeting: 'none' | 'blink' | 'appraise' | 'track' | 'raise' | 'reactive';
}

export const CLASS_INFO: Record<ClassId, ClassInfo> = {
  warrior: {
    label: 'Warrior', color: '#e05038',
    passive: 'Leaves the Dungeon free — its perils never touch him.',
    active: 'Collect 25g from every player on or beside your node.',
    activeName: 'Shakedown', targeting: 'none',
  },
  wizard: {
    label: 'Wizard', color: '#4f8ef0',
    passive: 'Enchantments cost 25% less.',
    active: 'Teleport up to 8 nodes instead of rolling.',
    activeName: 'Blink', targeting: 'blink',
  },
  rogue: {
    label: 'Rogue', color: '#b05fd0',
    passive: 'Pays 10% less rent.',
    active: 'When paying rent, roll a d6 — on 5–6 pay nothing.',
    activeName: 'Pickpocket', targeting: 'reactive',
  },
  cleric: {
    label: 'Cleric', color: '#e8c96a',
    passive: 'Immune to Curses; cleanses own lands freely.',
    active: 'Untargetable by abilities & Fate until your next turn.',
    activeName: 'Sanctuary', targeting: 'none',
  },
  bard: {
    label: 'Bard', color: '#e07a9a',
    passive: 'Earn 10g whenever anyone lands on unowned land.',
    active: 'Copy any trade struck since your last turn.',
    activeName: 'Silver Tongue', targeting: 'none',
  },
  merchant: {
    label: 'Merchant', color: '#c98a3f',
    passive: 'All construction costs 15% less.',
    active: 'Buy unowned land within 5 nodes at +20% price.',
    activeName: 'Appraise', targeting: 'appraise',
  },
  ranger: {
    label: 'Ranger', color: '#3f8f5a',
    passive: 'May move one node fewer or farther than rolled.',
    active: 'Travel to any unowned land; first right to buy.',
    activeName: 'Track', targeting: 'track',
  },
  necromancer: {
    label: 'Necromancer', color: '#8a95a5',
    passive: 'Claims one mortgaged land from every bankruptcy.',
    active: 'Un-mortgage one of your lands for free.',
    activeName: 'Raise Dead', targeting: 'raise',
  },
};

/** The human champion's name, by class (never collides with the AI roster). */
export const HERO_NAMES: Record<ClassId, string> = {
  warrior: 'Thorne', wizard: 'Serane', rogue: 'Whisper', cleric: 'Aveline',
  bard: 'Cadenza', merchant: 'Goldrun', ranger: 'Fen', necromancer: 'Vhal',
};

/** AI roster: three rivals are drawn from this pool, skipping the human's class. */
export const AI_ROSTER: Array<{ name: string; cls: ClassId }> = [
  { name: 'Borin', cls: 'merchant' },
  { name: 'Vex', cls: 'rogue' },
  { name: 'Karg', cls: 'warrior' },
  { name: 'Morda', cls: 'necromancer' },
  { name: 'Liriel', cls: 'ranger' },
];

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
