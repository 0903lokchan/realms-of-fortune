// Realms of Fortune — engine types. Mirrors DESIGN.md.

export type PlayerId = number;
export type NodeId = string;

export type Region =
  | 'shire' | 'silver' | 'wild' | 'iron'
  | 'sun' | 'mage' | 'dragon' | 'celest';

export type NodeType =
  | 'capital' | 'prop' | 'way' | 'mana'
  | 'fate' | 'quest' | 'tavern' | 'dungeon' | 'levy' | 'trail';

export interface BoardNode {
  id: NodeId;
  name: string;
  type: NodeType;
  region?: Region;
  price?: number;
  /** Directed out-edges (movement is one-way around the map). */
  out: NodeId[];
  /** Gold toll charged when moving onto this node (the Underway ferry). */
  entryToll?: number;
}

export type ClassId =
  | 'warrior' | 'wizard' | 'rogue' | 'cleric'
  | 'bard' | 'merchant' | 'ranger' | 'necromancer';

export type EnchantType = 'ward' | 'vault' | 'trap' | 'beacon' | 'orb';
export type GarrisonType = 'guard' | 'ogre' | 'drake';
export type Upgrade =
  | { kind: 'settlement' }
  | { kind: 'enchant'; enchant: EnchantType }
  | { kind: 'garrison'; garrison: GarrisonType };

export interface Ownable {
  owner: PlayerId | null;
  mortgaged: boolean;
  /** Up to 3 upgrade slots (properties only). */
  upgrades: Upgrade[];
  cursed: boolean;
  /** Snare trap armed (re-arms when the owner passes the Crossroads). */
  trapArmed: boolean;
  /** Scrying orb available this lap. */
  orbReady: boolean;
}

export interface KeptCard {
  id: string;
  name: string;
}

export interface Player {
  id: PlayerId;
  name: string;
  cls: ClassId;
  human: boolean;
  cash: number;
  pos: NodeId;
  bankrupt: boolean;
  inDungeon: boolean;
  dungeonTurns: number;
  /** Turns until the class active is ready again (0 = ready). */
  abilityCooldown: number;
  /** Cleric Sanctuary active until the start of their next turn. */
  sanctuary: boolean;
  writs: number;
  keptQuests: KeptCard[];
  /** One optional Action per turn (build / ability / trade / mortgage). */
  actionUsed: boolean;
}

export type Season = 'summer' | 'autumn' | 'winter';

export type Pending =
  | { type: 'fork'; player: PlayerId; options: NodeId[] }
  | { type: 'rangerAdjust'; player: PlayerId; rolled: number; options: number[] }
  | { type: 'buyOrPass'; player: PlayerId; node: NodeId; price: number }
  | { type: 'auctionBid'; player: PlayerId; node: NodeId; currentBid: number; leader: PlayerId | null }
  | { type: 'pickpocket'; player: PlayerId; node: NodeId; rent: number; owner: PlayerId }
  | { type: 'dungeon'; player: PlayerId }
  | { type: 'chooseCurseTarget'; player: PlayerId; options: NodeId[] }
  | { type: 'tradeOffer'; player: PlayerId; offer: TradeOffer };

export interface TradeOffer {
  from: PlayerId;
  to: PlayerId;
  giveProps: NodeId[];
  giveGold: number;
  getProps: NodeId[];
  getGold: number;
  /** True once the receiver has countered (counters happen at most once). */
  countered: boolean;
}

export interface AuctionState {
  node: NodeId;
  currentBid: number;
  leader: PlayerId | null;
  /** Players still in the auction, in bidding order. */
  active: PlayerId[];
  /** Index into `active` of whoever must act. */
  turn: number;
}

export interface MovementState {
  remaining: number;
  rolled: [number, number] | null;
}

export type Phase = 'preroll' | 'postroll' | 'gameover';

export interface GameEvent {
  round: number;
  text: string;
}

export interface CompletedTrade {
  from: PlayerId;
  to: PlayerId;
  giveProps: NodeId[];
  giveGold: number;
  getProps: NodeId[];
  getGold: number;
}

export interface GameState {
  seed: number;
  rngState: number;
  round: number;
  season: Season;
  phase: Phase;
  current: PlayerId;
  players: Player[];
  ownership: Record<NodeId, Ownable>;
  pending: Pending | null;
  movement: MovementState | null;
  auction: AuctionState | null;
  consecutiveDoubles: number;
  fateDeck: string[];
  questDeck: string[];
  /** Bank stock: settlements and 2 of each enchant type. */
  stock: { settlements: number; enchants: Record<EnchantType, number> };
  lastTrade: CompletedTrade | null;
  /** The most recent roll was doubles (grants another roll at end of turn). */
  lastRollDouble: boolean;
  /** Most recent dice shown in the HUD. */
  lastRoll: [number, number] | null;
  /** Current buyOrPass came from Ranger's Track (declining skips the auction). */
  rangerClaim: boolean;
  events: GameEvent[];
  winner: PlayerId | null;
}

export type Action =
  | { type: 'roll' }
  | { type: 'endTurn' }
  | { type: 'chooseFork'; to: NodeId }
  | { type: 'rangerAdjust'; steps: number }
  | { type: 'buy' }
  | { type: 'declineBuy' }
  | { type: 'bid'; amount: number }
  | { type: 'passBid' }
  | { type: 'pickpocket'; use: boolean }
  | { type: 'dungeonChoice'; choice: 'bribe' | 'roll' | 'fight' | 'writ' }
  | { type: 'chooseCurseTarget'; node: NodeId | null }
  | { type: 'build'; node: NodeId; upgrade: Upgrade }
  | { type: 'sellUpgrade'; node: NodeId; slot: number }
  | { type: 'mortgage'; node: NodeId }
  | { type: 'unmortgage'; node: NodeId }
  | { type: 'cleanse'; node: NodeId }
  | { type: 'useAbility'; target?: NodeId }
  | { type: 'proposeTrade'; offer: Omit<TradeOffer, 'countered'> }
  | { type: 'respondTrade'; response: 'accept' | 'decline' | 'counter'; counterGold?: number };

export const START_CASH = 1200;
export const CROSSROADS_INCOME = 150;
export const LEVY_COST = 100;
export const FERRY_TOLL = 50;
export const DUNGEON_BRIBE = 50;
export const DUNGEON_BRUISES = 25;
export const CURSE_CLEANSE_COST = 50;
export const ROUND_CAP = 20;
export const AUTUMN_ROUND = 8;
export const WINTER_ROUND = 15;
export const ABILITY_COOLDOWN = 3;
export const BEACON_TOLL = 20;
export const VAULT_INCOME = 25;
