# Realms of Fortune

A single-player, web-based fantasy board game inspired by Monopoly: roll dice, travel an
organic continent map, invest in territories, and bankrupt three AI rivals — as one of
eight character classes with unique traits.

**Play it:** https://0903lokchan.github.io/realms-of-fortune/ — every push to `main` is
tested and redeployed by [the workflow](.github/workflows/deploy.yml). Games autosave
in the browser; pick **Continue** on the title screen to resume.

- **[DESIGN.md](DESIGN.md)** — full game design (board, classes, upgrade paths, AI, pacing).
- **[mockups/](mockups/)** — visual mockups: `game-screen.html` (map + HUD), `screens.html` (dialogs).
- **[src/engine/](src/engine/)** — headless, deterministic rules engine (TypeScript).
- **[src/ai/](src/ai/)** — AI opponents: valuation heuristics with class personalities.
- **[src/ui/](src/ui/)** — the playable web game (Vite + vanilla TS, SVG map): `npm run dev`.

## Engine architecture

The engine is a pure state machine with no UI dependencies:

- `createGame(seed, players)` builds a `GameState`; all randomness flows through a seeded
  RNG stored in the state, so games are fully reproducible.
- `applyAction(state, action)` advances the game and returns `null` or a rejection reason.
- Whenever a player must decide something (buy or pass, fork in the road, auction bid,
  dungeon escape, trade response…), `state.pending` names the decision and who owes it.
  The UI answers for the human; `decide(state)` in `src/ai/ai.ts` answers for AI players.
- `state.events` is a running log ready for the game screen's turn feed, and `state.fx`
  lists the dice rolls and token paths of the last action for the UI to animate.
- The whole `GameState` is plain JSON, so a save is just the serialized state.

## Commands

```bash
npm install       # once
npm run dev       # play the game at http://localhost:5173
npm test          # vitest: board graph, rent/build rules, turn flow, full AI games
npm run sim       # AI-vs-AI batch: npm run sim -- games=100 seed=1 verbose=1
npm run typecheck
npm run build     # production bundle
```

## Status

- Rules engine: complete for DESIGN.md v0.3 (movement with forks and shortcut routes,
  properties + 3-path upgrades, rent with seasons/curses/garrisons, Fate & Quest decks,
  the Dungeon, auctions, trading with counter-offers, all 8 class kits, bankruptcy,
  both win conditions).
- AI: playable heuristics with per-class personalities; balance is first-pass
  (the Merchant still overperforms in AI-vs-AI sims).
- UI: playable — class select, live SVG map (click a land for its sheet), HUD,
  and dialogs for every engine decision (buy/auction, forks, dungeon, trades,
  ability targeting, Fate curses). Tokens hop along the trails, dice tumble, gold
  changes and land changes are called out, and banners announce each turn;
  a 1×/2×/3× speed toggle sits in the panel header.
- Saves: one autosave slot in `localStorage`, written after every action.
- Heroes, challenges and tactics (DESIGN.md §11, inspired by 富甲天下4): hire heroes and buy
  tactic cards at the Crossroads Bazaar, station heroes to guard lands, and challenge a rival's
  land instead of paying rent. Duels and tactic cards play out as short reveals over the map.
