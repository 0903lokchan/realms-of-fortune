// Fate & Quest decks. Cards are referenced by id; effects are applied in engine.ts.

export interface CardDef {
  id: string;
  name: string;
  text: string;
}

export const FATE_CARDS: CardDef[] = [
  { id: 'rockfall',  name: 'Rockfall!',        text: 'Go to the Dungeon. Do not pass the Crossroads.' },
  { id: 'windfall',  name: 'Windfall',         text: 'A grateful noble pays you 100g.' },
  { id: 'tithe',     name: "Dragon's Tithe",   text: 'The wyrms demand tribute. Pay 80g.' },
  { id: 'tailwind',  name: 'Tailwind',         text: 'Ride to the Crossroads and collect 150g.' },
  { id: 'curse',     name: 'Withering Curse',  text: 'Curse any rival property. Its rent is halved until cleansed.' },
  { id: 'writ',      name: 'Writ of Release',  text: 'Keep this card. It opens the Dungeon doors once.' },
  { id: 'waystorm',  name: 'Wild Ley Storm',   text: 'The storm hurls you to the next Waygate.' },
  { id: 'bandits',   name: 'Bandit Raid',      text: 'Pay 20g for each Settlement tier you own.' },
  { id: 'market',    name: 'Market Day',       text: 'Collect 25g for each land you own.' },
  { id: 'busking',   name: 'Feast Day',        text: 'Every rival pays you 10g.' },
  { id: 'sinkhole',  name: 'Sinkhole',         text: 'The road swallows your purse. Lose 75g.' },
  { id: 'fortune',   name: "Seer's Fortune",   text: 'A glimpse of golden days. Collect 150g.' },
];

export const QUEST_CARDS: CardDef[] = [
  { id: 'harvest',   name: 'Bountiful Harvest', text: 'Collect 100g.' },
  { id: 'errand',    name: "Alchemist's Errand", text: 'Collect 50g.' },
  { id: 'gates',     name: 'Master of Gates',  text: 'KEPT QUEST — own 3 Waygates: collect 300g.' },
  { id: 'castle',    name: 'Raise a Castle',   text: 'KEPT QUEST — hold a 3-tier Settlement: collect 200g.' },
  { id: 'escort',    name: 'Caravan Escort',   text: 'Collect 75g.' },
  { id: 'treasury',  name: "Treasury Error",   text: 'The Crown miscounts in your favour. Collect 200g.' },
  { id: 'tithe2',    name: 'Temple Tithe',     text: 'Pay 25g.' },
  { id: 'banners',   name: 'Banners Raised',   text: 'Collect 100g for each full region you rule.' },
  { id: 'egg',       name: 'Dragon Egg',       text: 'A collector pays handsomely. Collect 150g.' },
  { id: 'roads',     name: 'Kept Roads',       text: 'Collect 10g for each land you own.' },
];

export const CARD_BY_ID: Map<string, CardDef> = new Map(
  [...FATE_CARDS, ...QUEST_CARDS].map(c => [c.id, c]),
);

/** Kept quests: id -> reward, checked at the end of the holder's turn. */
export const KEPT_QUESTS = new Set(['gates', 'castle']);
