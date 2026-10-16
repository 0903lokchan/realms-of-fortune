// One autosave slot in localStorage. The whole GameState is plain JSON (the RNG state
// included), so a resumed game continues exactly as it would have.

import type { Difficulty } from '../ai/ai';
import { OWNABLE_NODES } from '../engine/board';
import type { GameState } from '../engine/types';

const KEY = 'rof.save';
/** Bump when GameState changes shape; older saves are then discarded. */
const VERSION = 2;

export interface SaveGame {
  version: number;
  savedAt: number;
  difficulty: Difficulty;
  state: GameState;
}

export function writeSave(state: GameState, difficulty: Difficulty) {
  try {
    const save: SaveGame = { version: VERSION, savedAt: Date.now(), difficulty, state };
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch { /* storage full or unavailable: the game simply isn't resumable */ }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

/** The saved game if it is present, current, and still in progress. */
export function loadSave(): SaveGame | null {
  let save: SaveGame;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    save = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isValid(save)) {
    clearSave();
    return null;
  }
  return save;
}

function isValid(save: SaveGame): boolean {
  const s = save?.state;
  return save?.version === VERSION
    && ['squire', 'knight', 'warlord'].includes(save.difficulty)
    && !!s && typeof s === 'object'
    && Array.isArray(s.players) && s.players.length >= 2
    && typeof s.rngState === 'number' && typeof s.eventSeq === 'number'
    && Array.isArray(s.events) && Array.isArray(s.fx)
    && s.winner === null
    && OWNABLE_NODES.every(n => s.ownership?.[n.id] !== undefined);
}
