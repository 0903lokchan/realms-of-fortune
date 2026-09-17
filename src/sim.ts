// Headless AI-vs-AI simulation: sanity-checks pacing, balance, and that games terminate.
// Usage: npm run sim [-- games=50 seed=1 verbose=1]

import { decide, summarize } from './ai/ai';
import { applyAction, createGame } from './engine/engine';
import type { ClassId, GameState } from './engine/types';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=') as [string, string]));
const GAMES = Number(args.games ?? 25);
const SEED = Number(args.seed ?? 1);
const VERBOSE = !!args.verbose;

const LINEUP: Array<{ name: string; cls: ClassId }> = [
  { name: 'Serane', cls: 'wizard' },
  { name: 'Borin', cls: 'merchant' },
  { name: 'Vex', cls: 'rogue' },
  { name: 'Karg', cls: 'warrior' },
];

function runGame(seed: number): { state: GameState; steps: number } {
  const state = createGame(seed, LINEUP);
  let steps = 0;
  while (state.phase !== 'gameover') {
    if (++steps > 20000) throw new Error(`game ${seed} did not terminate`);
    const action = decide(state);
    const err = applyAction(state, action);
    if (err) throw new Error(`game ${seed} step ${steps}: AI action ${action.type} rejected: ${err}`);
  }
  return { state, steps };
}

const wins = new Map<string, number>();
let totalRounds = 0, totalBankruptcies = 0;

for (let g = 0; g < GAMES; g++) {
  const { state, steps } = runGame(SEED + g);
  const winner = state.players[state.winner!];
  wins.set(winner.cls, (wins.get(winner.cls) ?? 0) + 1);
  totalRounds += Math.min(state.round, 21);
  totalBankruptcies += state.players.filter(p => p.bankrupt).length;
  if (VERBOSE) {
    console.log(`\n=== game ${g + 1} (seed ${SEED + g}) — ${steps} steps, round ${state.round} ===`);
    console.log(summarize(state));
    for (const e of state.events.slice(-12)) console.log(`  [r${e.round}] ${e.text}`);
  }
}

console.log(`\n${GAMES} games complete.`);
console.log(`avg game length: ${(totalRounds / GAMES).toFixed(1)} rounds; avg bankruptcies: ${(totalBankruptcies / GAMES).toFixed(2)}`);
console.log('wins by class:', Object.fromEntries([...wins.entries()].sort((a, b) => b[1] - a[1])));
