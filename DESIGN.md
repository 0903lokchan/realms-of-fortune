# Realms of Fortune — Game Design Document

A web-based, fantasy-themed board game inspired by Monopoly. Players roll dice to travel a board of fantasy territories, invest in properties, and try to bankrupt their rivals — but every player is a character class with unique traits, and properties grow through multiple upgrade paths instead of a single house-to-hotel ladder.

**Status:** Draft v0.3 — core decisions locked:

- **Single-player:** one human vs 1–3 AI opponents (see §9).
- **Tone:** spicy — targeted abilities, Curses, and Traps stay in.
- **Session length:** ~30 minutes, snappy (compact board, steep curve, round cap).
- **Board:** not a square ring — an organic **world map of connected nodes** with a main loop, forks, and shortcut routes (see §2).
- **Art:** painted high-fantasy (Warcraft-like) — an illustrated continent map with terrain, glowing node markers, and dark gold-trimmed UI panels. Rendered in HTML/SVG.

---

## 1. Core Loop

1. On your turn, roll 2d6 and move clockwise around the board.
2. Resolve the tile you land on (buy, pay rent, draw a card, trigger an event).
3. Optionally take **one Action**: build an upgrade, use your class ability, propose a trade, or mortgage/redeem.
4. Doubles grant an extra roll (three doubles in a row → thrown into the **Dungeon**).
5. Last solvent player wins; if the round cap is reached first, highest net worth wins (see §8).

The Monopoly skeleton is intact on purpose: passing the start tile pays out, color sets exist, rent scales with development, trading is free-form. The fantasy layer adds decisions on top rather than replacing the familiar core.

---

## 2. Theme & Board

The board is a **continent map**, not a square ring: ~35 nodes connected by trails. The spine is a **27-node main loop** around the continent, with two **shortcut routes** cutting across it and a **Dungeon spur** in the mountains. Movement is still dice-driven — roll 2d6, walk that many nodes — but the map gives players route choices Monopoly never had.

### Movement on the map

- Roll 2d6 and move node by node along connected trails.
- **Forks:** when your move reaches a fork node, you choose which way to continue. No reversing mid-move.
- **Laps:** income comes from *passing through* The Crossroads (the capital city node on the main loop), not from an abstract "Go" — 150g each time you walk through it.
- Some shortcut steps are **trail nodes** — plain waypoints where nothing happens. They keep shortcut hops honest without adding events.

### Shortcut routes

- **The Ironvein Pass** (forks at Silver Quay, rejoins at Rune Court): a mountain crossing that skips nearly half the loop — the Wildwood, the far Waygates, the whole northern stretch. In exchange it is dangerous: two Fate nodes, a Quest node at the Old Delve, and it passes the very gates of **the Dungeon**. Fast, cheap, risky.
- **The Underway** (forks at Sunspire, rejoins at High Court): a smugglers' sea route down the east coast via island nodes — Gull Rock, **The Tavern** (free Quest card), and Smuggler's Cove (Fate). Costs a **50g ferry toll** to board, but it skips the expensive Mage/Dragonspine stretch *and* dodges the King's Levy entirely. The rich player's escape route — and the AI knows it.

Shortcuts skip buying opportunities and Crossroads income as well as danger, so the main loop stays the default; shortcuts are tempo plays (racing to an unbought region, fleeing a developed death-stretch).

The 8 regions of ascending value have **2 properties each** — small sets complete fast, so the investing and building game starts within the first few laps:

| Region (color set) | Flavor | Monopoly analog |
|---|---|---|
| The Shirelands | farming villages | Brown |
| Silverbrook | riverside towns | Light blue |
| The Wildwood | elven forests | Pink |
| Ironvein Mountains | dwarven mines | Orange |
| The Sunspire Coast | trade ports | Red |
| The Mage Districts | arcane academies | Yellow |
| Dragonspine Peaks | dragon-hoard territory | Green |
| The Celestial Citadel | seat of power | Dark blue |

Special nodes:

- **The Crossroads** (capital city) — collect 150g when passing through.
- **Waygates** ×4 (Railroads) — teleportation circles at the compass points of the main loop. Rent scales with gates owned; the owner may also *pay a fee to fast-travel* between their own gates on their turn — the map's fourth "route."
- **Mana Well & Ley Line Nexus** (Utilities) — rent is dice-based, as in Monopoly.
- **The Dungeon** (Jail) — an off-path spur node by the Ironvein Pass; see §6. Players are *sent* there by cards or three doubles (there is no "Go to Jail" tile — the map doesn't need one).
- **The Tavern** (Free Parking analog) — an island node on the Underway; draw a free Quest card.
- **The King's Levy** (tax) — a toll fort on the main loop before the Celestial Reach; pay 100g. The Underway smuggles past it.
- **Fate cards** (Chance) and **Quest cards** (Community Chest) — see §7.

Node budget: 27-node main loop (Crossroads + 16 properties + 4 Waygates + 2 mana + 2 Fate + 1 Quest + King's Levy) + Ironvein Pass (2 Fate, 1 Quest, 1 trail) + Underway (Tavern, 1 Fate, 1 trail) + the Dungeon spur ≈ **35 nodes**.

Currency is **gold (g)**. Property prices mirror Monopoly's curve (60g → 400g) but starting cash is lower (**1200g**) and passing the Crossroads pays **150g**, so early purchases hurt and cash pressure arrives fast.

---

## 3. Character Classes (traits)

Each player picks a class at game start. A class has one **passive trait** (always on) and one **active ability** (usable on your turn, then on cooldown for 3 of your turns). Abilities are deliberately economic, not combat-focused — they bend the Monopoly rules in one specific way.

| Class | Passive trait | Active ability (3-turn cooldown) |
|---|---|---|
| **Warrior** | Pays no fee to leave the Dungeon; dungeon events never harm them | **Shakedown:** collect 25g from every player on or adjacent to your tile |
| **Wizard** | Enchantment upgrades cost 25% less | **Blink:** instead of rolling, teleport to any tile within 8 tiles (does not collect Crossroads gold) |
| **Rogue** | Pays 10% less rent (rounded down) | **Pickpocket:** when paying rent, roll a d6 — on 5–6, pay nothing (declare before paying) |
| **Cleric** | Immune to Curse cards; removes curses from own properties for free | **Sanctuary:** until your next turn, you cannot be targeted by abilities or Fate cards |
| **Bard** | Collects 10g from the bank whenever *any* player lands on an unowned property (word travels) | **Silver Tongue:** force one re-negotiation — copy any one trade another pair of players completed since your last turn, on the same terms, with either party |
| **Merchant** (dwarf) | All construction (settlement track, §4) costs 15% less | **Appraise:** buy any unowned property you are within 5 tiles of, without landing on it, at +20% price |
| **Ranger** | May choose to move 1 tile fewer or farther than rolled | **Track:** move directly to any unowned property and get first right to buy it |
| **Necromancer** | When any player goes bankrupt, take one of their mortgaged properties for the mortgage cost | **Raise Dead:** un-mortgage one of your properties for free |

Balance intent: every passive is worth roughly 5–8% economic edge; actives are stronger but gated by cooldown and timing. Classes should shape *strategy* (Ranger hunts sets, Merchant builds tall, Rogue survives late-game rent) without deciding games on their own.

---

## 4. Property Improvement — three upgrade paths

This replaces the flat house → hotel ladder. Every property has **3 upgrade slots**. Each slot holds one upgrade from any path, so players mix and match. You may only build if you own the full color set (kept from Monopoly — it preserves the trading game).

### Path A — Settlement (raw rent)

The classic ladder, renamed: **Hamlet → Village → Town → Keep → Castle** is compressed into stackable tiers. Each Settlement upgrade in a slot raises the property one rent tier (same rent curve as Monopoly houses; three Settlement upgrades ≈ a hotel). Cost: the region's house price per tier.

*The safe, high-ceiling path. All three slots as Settlement = maximum raw rent.*

### Path B — Enchantment (special effects)

One-time magical constructions. Each occupies a slot and gives an effect instead of a big rent bump (each also adds +½ rent tier so it's never a pure sacrifice):

- **Ward** — this property can't be targeted by class abilities, Curses, or hostile Fate cards.
- **Gilded Vault** — earn 25g from the bank each time you pass the Crossroads, per Vault owned.
- **Snare Trap** — first opponent to land here each round pays double rent, then the trap resets next lap.
- **Beacon** — opponents who pass (not land on) this property pay a 20g toll.
- **Scrying Orb** — once per lap, look at the top Fate card and choose to leave or bury it.

*The tricks path. Cheaper than Settlements (flat 100g each), scales sideways.*

### Path C — Garrison (defense & pressure)

Hire creatures to guard a property. One Garrison per property (occupies a slot):

- **Guard Post (50g)** — negates Rogue's Pickpocket and rent-avoidance effects on this property.
- **Ogre Mercenary (150g)** — +50% rent, but you pay the ogre 10g each time you pass the Crossroads (upkeep).
- **Drake Roost (250g)** — +100% rent, 25g upkeep, and the drake occasionally causes trouble (some Fate cards interact badly with drakes).

*The high-risk path. Big multipliers with ongoing costs — punishing if your cash flow dries up.*

### Why this structure works

- **Build diversity:** "3× Settlement" (tall), "2× Settlement + Ward" (protected), "Settlement + Vault + Beacon" (cash flow), "Settlement + Drake" (glass cannon) are all legitimate and legible.
- **Counterplay:** Wards answer Rogues and Curses; Guard Posts answer Rogues cheaply; upkeep answers runaway Garrison stacking.
- **Bounded complexity:** 3 slots × 3 paths is easy to render in a web UI (three icons on the property card) and easy to reason about at a glance.

Building limits: like Monopoly's housing shortage, the bank stocks a finite pool of Settlement pieces (32) and Enchantments (2 of each type). Scarcity creates races.

---

## 5. Rent, Mortgages, Bankruptcy

Standard Monopoly rules apply: double base rent on complete unimproved sets, mortgaging at half price (upgrades must be sold first, at half cost; Enchantments are *demolished* — they return to the bank pool but refund nothing, which makes them a commitment). A bankrupt player's estate goes to their creditor (or auction if bankrupted by the bank), except the Necromancer's passive, which skims one mortgaged property first.

---

## 6. The Dungeon (Jail)

A grim keep on a spur off the Ironvein Pass. Thrown in by: three doubles or certain Fate cards; travelers on the Pass also feel its shadow (its Fate nodes carry the nastiest cards). On release, you step out onto the Old Delve node and continue from there. Ways out reflect the fantasy layer:

- **Bribe the jailer** — 50g, leave immediately on your turn.
- **Roll for escape** — doubles within 3 turns, as Monopoly.
- **Fight your way out** — roll 2d6, escape on 8+; on a fail, pay 25g in "bruises." (Warriors auto-succeed via their passive.)
- **Writ of Release** card (Get Out of Jail Free).

While imprisoned you still collect rent — but your Garrisons demand double upkeep (the boss is away).

---

## 7. Cards

- **Fate cards (Chance):** movement, windfalls, and *targeted chaos* — including **Curses** placed on a property (halves its rent until cleansed: pay 50g at the Tavern, land a Cleric friend, or a Cleansing card). Fate is swingy on purpose.
- **Quest cards (Community Chest):** mostly-positive objectives and payouts. Some are **kept quests**: "Own three Waygates → 300g," "Build a Castle (3 Settlement tiers) in the Mountains → 200g." Kept quests give players personal side-goals, which helps direct early-game buying.

---

## 8. Win Conditions & Pacing (30-minute target)

- **Primary:** bankrupt all AI opponents.
- **Round cap:** if anyone survives to the end of **round 20**, highest net worth wins. The cap guarantees a ~25–35 minute session.
- Snappy-pacing levers, all on by default:
  - 2-property sets and a compact 27-node main loop (sets complete in laps 1–3); shortcuts let trailing players race to unbought regions.
  - Lower starting cash (1200g) and reduced Crossroads payout (150g) — cash pressure from lap 1.
  - **Mandatory auction** when a player declines to buy — properties never sit unowned for long.
  - **Seasons:** at rounds 8 and 15, all rents rise +25% ("Autumn," "Winter") — hoarding cash gets worse over time; developed sets get scarier.
  - AI turns resolve in ~1 second with a short animation, so a 4-player round takes well under a minute of real time.

---

## 9. AI Opponents

Single-player: the human plays against 1–3 AI opponents. Each AI plays a character class, and its **personality is its class** — the class kit doubles as the AI's strategy profile, which makes opponents legible ("the Merchant always builds tall; watch out when the Rogue is low on cash").

### Personality profiles (v1)

- **Merchant "Borin":** buys aggressively in cheap regions, builds Settlements early, rarely trades away a set piece. The economic snowball you must slow down.
- **Rogue "Vex":** hoards cash, under-builds, relies on Pickpocket and rent discounts to survive; buys Wards' counters (Guard Posts) late. The survivor you must outlast.
- **Wizard "Serane":** favors Enchantments (they're cheaper for her), builds Vault/Beacon cash-flow engines, uses Blink to snipe key unowned tiles. The tricks player you must out-tempo.
- **Warrior "Karg":** high-variance — Garrisons everywhere, Shakedown on cooldown, happy to visit the Dungeon. The glass cannon who either dies first or kills you.

### Decision model

Deliberately simple and shippable — no ML:

1. **Valuation function:** every purchasable thing (tile, upgrade, trade) gets a score = expected rent income over remaining rounds (landing probabilities from dice distribution × rent) − liquidity risk (keep a cash buffer ≥ the largest rent it could plausibly owe in the next 2 laps). Personality = per-class multipliers on this function (Borin overweights Settlements, Serane overweights Enchantments…).
2. **Route choice:** at forks, the AI scores each route over the next ~2 turns (expected rent paid on nodes ahead, Crossroads income missed, unbought properties reachable, Levy/toll costs) and takes the better one. Personalities skew it: Vex loves the Underway when rich, Karg takes the Ironvein Pass because danger is cheap for him.
3. **Trading:** AI proposes/accepts trades when both sides' valuation improves but its own improves more; it will *never* complete an opponent's set for cash alone unless desperate (cash < next-lap expected rent). The human can always propose trades; the AI counters at most once.
4. **Difficulty levels:** Easy = noisy valuations + no trading initiative; Normal = as designed; Hard = sharper cash-buffer management + AIs may make mutually-beneficial trades with each other (classic Monopoly kingmaking pressure — flagged in UI so it never feels like cheating).

Spice note: targeted abilities (Pickpocket, Curses, Shakedown) are *more* fun in single-player — the AI can play mean without hurt feelings, and the player can be mean back guilt-free. AIs target whoever has the highest net worth, not always the human.

---

## 10. Open Questions

1. **AI opponent count default:** always 3 opponents, or player-selectable 1–3? (Suggest selectable, default 3.)
2. **Class draft:** does the human pick their class and then AIs fill in, or is there a short draft (pick from 3 random) for replay variety?
3. **Meta-progression:** any unlocks between runs (new classes, cosmetics, harder AI personalities)? Big retention lever for a single-player web game, but scope.
4. **Undo policy:** since it's single-player, allow undo of build/trade actions before ending turn? (Suggest yes — kindness is free vs AI.)
