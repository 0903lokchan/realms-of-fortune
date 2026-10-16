import './style.css';
import { decide, type Difficulty } from '../ai/ai';
import { actingPlayer, applyAction, createGame } from '../engine/engine';
import type { Action, ClassId, GameState, NodeId, PlayerId } from '../engine/types';
import { CROSSROADS_INCOME } from '../engine/types';
import { AI_ROSTER, CLASS_INFO, esc, HERO_NAMES, SEAT_COLORS } from './theme';
import { buildMap, drawHints, floatAtNode, pingNode, updateMap, type MapLayers } from './map';
import { previewFor } from './preview';
import { renderPanel, setDieFace } from './panel';
import { TokenLayer, sleep } from './tokens';
import { clearSave, loadSave, writeSave, type SaveGame } from './save';
import { abilityTargets, endScreen, pendingDialog, propertySheet, tradeBuilder } from './dialogs';

const HUMAN = 0;
const app = document.getElementById('app')!;

let state: GameState | null = null;
let difficulty: Difficulty = 'knight';
let layers: MapLayers | null = null;
let tokens: TokenLayer | null = null;

/** A user-opened modal; `refresh` rebuilds it so it never shows stale numbers. */
let modal: { el: HTMLElement; refresh?: () => HTMLElement } | null = null;

/** Bumped on every new game/setup so in-flight animations and AI loops from an old game bail out. */
let gameId = 0;
/** An action's consequences are still animating: input is locked and the panel lags the engine. */
let busy = false;
/** The game whose AI loop is running, or -1; a stale loop from an abandoned game never blocks a new one. */
let aiLoopFor = -1;
/** Pause before the AI's next move, chosen from what the last move was. */
let aiDelay = 600;

/** Values the panel shows; they trail the engine while an animation plays. */
let shown = { cash: [] as number[], seq: 0, dice: [1, 1] as [number, number] };
let freshAfter = 0;

/* ---------------- animation speed ---------------- */

const SPEEDS = [1, 2, 3];
let speed = (() => {
  try {
    const saved = Number(localStorage.getItem('rof.speed'));
    if (SPEEDS.includes(saved)) return saved;
  } catch { /* storage unavailable */ }
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 3 : 1;
})();

function cycleSpeed() {
  speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
  try { localStorage.setItem('rof.speed', String(speed)); } catch { /* storage unavailable */ }
  render();
}

/* ---------------- setup screen ---------------- */

function showSetup() {
  state = null;
  gameId++;
  busy = false;
  let chosen: ClassId = 'wizard';
  let confirmAbandon = false;
  const classes = Object.entries(CLASS_INFO) as Array<[ClassId, typeof CLASS_INFO[ClassId]]>;

  const render = () => {
    const save = loadSave();
    app.innerHTML = `
    <div class="page setup-page">
      <header class="page-header"><h1>REALMS OF FORTUNE</h1>
        <p>Bankrupt three rivals — or be the richest when winter ends.</p></header>
      ${save ? continueCard(save, confirmAbandon) : ''}
      <div class="frame stage"><div class="setup">
        <h2 class="dialog-h">${save ? 'Or Choose a New Champion' : 'Choose Your Champion'}</h2>
        <p class="dialog-sub">One passive trait, always on. One ability, every 3 turns.</p>
        <div class="class-cards">${classes.map(([id, c]) => `
          <button class="ccard ${id === chosen ? 'sel' : ''}" data-cls="${id}">
            <span class="top"><span class="portrait" style="--pc:${c.color}">${c.label[0]}</span>
            <span class="cname">${c.label.toUpperCase()}</span></span>
            <span class="trait"><b>PASSIVE</b>${c.passive}</span>
            <span class="trait"><b>${c.activeName.toUpperCase()}</b>${c.active}</span>
          </button>`).join('')}
        </div>
        <div class="setup-foot">
          <div class="foot-group"><span class="foot-label">DIFFICULTY</span>
            <div class="diff">${(['squire', 'knight', 'warlord'] as Difficulty[]).map(d =>
              `<span class="${d === difficulty ? 'on' : ''}" data-diff="${d}">${d.toUpperCase()}</span>`).join('')}</div>
          </div>
          <div class="foot-group"><span class="foot-label">&nbsp;</span>
            <button class="btn" id="begin">BEGIN THE CONTEST</button></div>
        </div>
        ${save ? '<p class="dialog-sub">Beginning a new contest replaces your saved one.</p>' : ''}
      </div></div>
    </div>`;
    app.querySelectorAll<HTMLElement>('[data-cls]').forEach(b =>
      b.addEventListener('click', () => { chosen = b.dataset.cls as ClassId; render(); }));
    app.querySelectorAll<HTMLElement>('[data-diff]').forEach(b =>
      b.addEventListener('click', () => { difficulty = b.dataset.diff as Difficulty; render(); }));
    app.querySelector('#begin')!.addEventListener('click', () => startGame(chosen));
    app.querySelector('#continue')?.addEventListener('click', () => { if (save) resumeGame(save); });
    app.querySelector('#abandon')?.addEventListener('click', () => {
      if (!confirmAbandon) { confirmAbandon = true; render(); return; }
      clearSave();
      confirmAbandon = false;
      render();
    });
  };
  render();
}

function continueCard(save: SaveGame, confirming: boolean): string {
  const s = save.state;
  const me = s.players[HUMAN];
  const mins = Math.round((Date.now() - save.savedAt) / 60000);
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
  return `
  <div class="frame continue">
    <span class="portrait" style="--pc:${SEAT_COLORS[HUMAN]}">${esc(me.name[0])}</span>
    <div class="continue-info">
      <b>${esc(me.name)} the ${CLASS_INFO[me.cls].label}</b>
      <small>Round ${Math.min(s.round, 20)} of 20 · ${me.bankrupt ? 'ruined' : me.cash + 'g'} ·
        ${save.difficulty[0].toUpperCase() + save.difficulty.slice(1)} · saved ${ago}</small>
    </div>
    <button class="btn" id="continue">CONTINUE</button>
    <button class="btn ${confirming ? 'danger' : 'ghost'} small" id="abandon">${confirming ? 'REALLY ABANDON?' : 'ABANDON'}</button>
  </div>`;
}

/* ---------------- game screen ---------------- */

function startGame(cls: ClassId) {
  const rivals = AI_ROSTER.filter(r => r.cls !== cls).slice(0, 3);
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  state = createGame(seed, [
    { name: HERO_NAMES[cls], cls, human: true },
    ...rivals,
  ]);
  writeSave(state, difficulty);
  enterGame();
  banner('YOUR TURN', SEAT_COLORS[HUMAN], `Round 1 · ${state.players[HUMAN].name} the ${CLASS_INFO[cls].label}`);
}

function resumeGame(save: SaveGame) {
  state = save.state;
  difficulty = save.difficulty;
  enterGame();
  const p = state.players[state.current];
  banner(p.id === HUMAN ? 'WELCOME BACK' : `${p.name.toUpperCase()}'S TURN`, SEAT_COLORS[p.id],
    `Round ${Math.min(state.round, 20)} · ${state.season[0].toUpperCase() + state.season.slice(1)}`);
  aiDelay = BANNER_MS - 150;
  aiLoop();
}

/** Build the game screen around the current `state`. */
function enterGame() {
  if (!state) return;
  gameId++;
  busy = false;
  modal = null;
  shown = { cash: state.players.map(p => p.cash), seq: state.eventSeq, dice: state.lastRoll ?? [1, 1] };
  freshAfter = state.eventSeq;

  app.innerHTML = `
  <div class="page game-page">
    <div class="screen">
      <div class="frame map-wrap"><svg id="map"></svg><div id="banner"></div></div>
      <aside class="frame panel" id="panel"></aside>
    </div>
    <div id="overlay"></div>
    <div id="toast"></div>
  </div>`;

  const svg = document.getElementById('map') as unknown as SVGSVGElement;
  layers = buildMap(svg, onNodeClick);
  tokens = new TokenLayer(layers.tokens, state.players);
  render();
}

function onNodeClick(id: NodeId) {
  if (!state || state.winner !== null || busy) return;
  if (state.pending && actingPlayer(state) === HUMAN) return; // answer the open decision first
  const refresh = () => propertySheet(state!, HUMAN, id, dispatch, closeModal);
  modal = { el: refresh(), refresh };
  render();
}

function openModal(el: HTMLElement | null) {
  if (!el) return;
  modal = { el };
  render();
}
function closeModal() {
  modal = null;
  render();
}

function toast(msg: string) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = `<div class="toast">${esc(msg)}</div>`;
  setTimeout(() => { if (t.firstChild) t.innerHTML = ''; }, 2200);
}

function render() {
  if (!state || !layers || !tokens) return;
  if (!busy) {
    shown = { cash: state.players.map(p => p.cash), seq: state.eventSeq, dice: state.lastRoll ?? shown.dice };
    tokens.place(state.players.map(p => p.pos), state.players.map(p => !p.bankrupt),
      state.winner === null ? state.current : null);
  }
  updateMap(layers.dyn, state);
  const preview = !busy && state.winner === null ? previewFor(state, HUMAN) : null;
  drawHints(layers.hints, preview?.landings ?? [], key => dispatch(
    preview!.kind === 'stride' ? { type: 'rangerAdjust', steps: Number(key) } : { type: 'chooseFork', to: key }));
  renderPanel(document.getElementById('panel')!, state, HUMAN, {
    busy, cash: shown.cash, shownSeq: shown.seq, freshAfter, dice: shown.dice, speed,
  });
  bindPanel();

  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = '';
  if (busy) return;
  if (state.winner !== null) {
    overlay.appendChild(endScreen(state, HUMAN, showSetup));
    return;
  }
  const pend = pendingDialog(state, HUMAN, dispatch);
  if (pend) {
    overlay.appendChild(pend);
    if (preview) linkOptionHover();
  } else if (modal) {
    if (modal.refresh) modal.el = modal.refresh();
    overlay.appendChild(modal.el);
  }
}

/** Hovering a dialog option lights its map markers, and hovering a marker lights its option. */
function linkOptionHover() {
  const linked = document.querySelectorAll<HTMLElement | SVGElement>('[data-opt]');
  const light = (key: string, on: boolean) => linked.forEach(e => {
    if (e.dataset.opt === key) e.classList.toggle('hot', on);
  });
  linked.forEach(e => {
    const key = e.dataset.opt!;
    e.addEventListener('mouseenter', () => light(key, true));
    e.addEventListener('mouseleave', () => light(key, false));
  });
}

function bindPanel() {
  const on = (id: string, fn: () => void) =>
    document.getElementById(id)?.addEventListener('click', fn);
  on('btn-roll', () => dispatch({ type: 'roll' }));
  on('btn-end', () => dispatch({ type: 'endTurn' }));
  on('btn-speed', cycleSpeed);
  on('btn-menu', showSetup);
  on('btn-trade', () => { if (state && !busy) openModal(tradeBuilder(state, HUMAN, dispatch, closeModal)); });
  on('btn-ability', () => {
    if (!state || busy) return;
    const el = abilityTargets(state, HUMAN, dispatch, closeModal);
    if (el) openModal(el);
  });
}

/* ---------------- performing actions ---------------- */

interface Snapshot {
  cash: number[];
  pos: NodeId[];
  alive: boolean[];
  seq: number;
  current: PlayerId;
  season: GameState['season'];
  dice: [number, number];
  lands: Record<NodeId, { owner: PlayerId | null; ups: number; cursed: boolean; mortgaged: boolean }>;
}

function snapshot(s: GameState): Snapshot {
  const lands: Snapshot['lands'] = {};
  for (const [id, o] of Object.entries(s.ownership)) {
    lands[id] = { owner: o.owner, ups: o.upgrades.length, cursed: o.cursed, mortgaged: o.mortgaged };
  }
  return {
    cash: s.players.map(p => p.cash),
    pos: s.players.map(p => p.pos),
    alive: s.players.map(p => !p.bankrupt),
    seq: s.eventSeq,
    current: s.current,
    season: s.season,
    dice: shown.dice,
    lands,
  };
}

/** Apply an action and play out its consequences. Returns the engine's rejection, if any. */
async function perform(action: Action): Promise<string | null> {
  if (!state) return 'no game';
  const before = snapshot(state);
  const err = applyAction(state, action);
  if (err) return err;
  if (state.winner !== null) clearSave();
  else writeSave(state, difficulty);
  const notable = await present(before, action);
  aiDelay = nextAiDelay(action, before, notable);
  return null;
}

/** Animate the effects of the last action, then reveal the new state. Returns how many lands changed. */
async function present(before: Snapshot, action: Action): Promise<number> {
  const s = state!;
  const gid = gameId;
  busy = true;
  shown = { cash: before.cash, seq: before.seq, dice: before.dice };
  render();
  tokens!.place(before.pos, before.alive, before.current);

  const displayPos = [...before.pos];
  for (const f of s.fx) {
    if (gid !== gameId) return 0;
    if (f.type === 'roll') {
      await rollDice(f.dice);
      shown.dice = f.dice;
    } else {
      displayPos[f.player] = f.path[f.path.length - 1];
      const finalXY = TokenLayer.rest(displayPos, before.alive, f.player);
      if (f.teleport) {
        await tokens!.teleport(f.player, finalXY, speed);
      } else {
        await tokens!.walk(f.player, f.path, finalXY, speed, id => {
          if (id === 'crossroads') floatAtNode(layers!.fx, id, `+${CROSSROADS_INCOME}g`, '#ffd97a');
        });
      }
    }
  }
  if (gid !== gameId) return 0;

  busy = false;
  freshAfter = before.seq;
  render();
  const changed = pingChanges(before);
  floatGold(before);
  announceTurn(before, action);
  return changed;
}

async function rollDice(final: [number, number]) {
  const frames = 7;
  for (let i = 0; i < frames; i++) {
    const dice = document.querySelectorAll('.dice-row .die');
    dice.forEach(d => {
      d.classList.add('rolling');
      setDieFace(d, 1 + Math.floor(Math.random() * 6));
    });
    await sleep(60 / speed);
  }
  document.querySelectorAll('.dice-row .die').forEach((d, i) => {
    d.classList.remove('rolling');
    setDieFace(d, final[i]);
  });
  await sleep(160 / speed);
}

function pingChanges(before: Snapshot): number {
  const s = state!;
  let changed = 0;
  const ping = (id: NodeId, color: string, label: string) => {
    pingNode(layers!.fx, id, color, label);
    changed++;
  };
  for (const [id, o] of Object.entries(s.ownership)) {
    const b = before.lands[id];
    if (b.owner !== o.owner) {
      if (o.owner === null) ping(id, '#9a917c', 'FREED');
      else if (b.owner === null) ping(id, SEAT_COLORS[o.owner], 'CLAIMED');
      else ping(id, SEAT_COLORS[o.owner], `TO ${s.players[o.owner].name.toUpperCase()}`);
    } else if (o.upgrades.length > b.ups) ping(id, '#e8c96a', 'BUILT');
    else if (o.upgrades.length < b.ups) ping(id, '#9a917c', 'RAZED');
    else if (o.cursed && !b.cursed) ping(id, '#c9aef5', 'CURSED');
    else if (!o.cursed && b.cursed) ping(id, '#8fd0a0', 'CLEANSED');
    else if (o.mortgaged && !b.mortgaged) ping(id, '#9a917c', 'MORTGAGED');
    else if (!o.mortgaged && b.mortgaged) ping(id, '#8fd0a0', 'REDEEMED');
  }
  s.players.forEach(p => {
    if (p.bankrupt && before.alive[p.id]) ping(before.pos[p.id], '#e05038', 'RUINED');
  });
  return changed;
}

/** Rising "+150g" / "−72g" beside each player's gold that changed. */
function floatGold(before: Snapshot) {
  state!.players.forEach(p => {
    const delta = p.cash - before.cash[p.id];
    if (delta === 0) return;
    const anchor = document.querySelector(`[data-gold="${p.id}"]`);
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const f = document.createElement('div');
    f.className = `gold-float ${delta > 0 ? 'up' : 'down'}`;
    f.textContent = `${delta > 0 ? '+' : '−'}${Math.abs(delta)}g`;
    f.style.left = `${r.left + window.scrollX - 8}px`;
    f.style.top = `${r.top + window.scrollY - 4}px`;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1500);
  });
}

function announceTurn(before: Snapshot, action: Action) {
  const s = state!;
  if (s.winner !== null) return;
  const p = s.players[s.current];
  const who = p.id === HUMAN ? 'YOUR TURN' : `${p.name.toUpperCase()}'S TURN`;
  if (s.season !== before.season) {
    const rise = s.season === 'autumn' ? '+25%' : '+50%';
    banner(`${s.season.toUpperCase()} HAS COME`, '#f0b060', `All rents rise ${rise} · ${p.name}'s turn`);
  } else if (s.current !== before.current) {
    banner(who, SEAT_COLORS[p.id], `Round ${Math.min(s.round, 20)} · ${CLASS_INFO[p.cls].label}`);
  } else if (action.type === 'endTurn' && s.phase === 'preroll') {
    banner('DOUBLES!', SEAT_COLORS[p.id], `${p.id === HUMAN ? 'You roll' : p.name + ' rolls'} again`);
  }
}

function banner(text: string, color: string, sub: string) {
  const host = document.getElementById('banner');
  if (!host) return;
  const ms = BANNER_MS / speed;
  host.innerHTML = `<div class="turn-banner" style="--bc:${color};animation-duration:${ms}ms">
    <span>${esc(text)}</span><small>${esc(sub)}</small></div>`;
  const el = host.firstElementChild;
  setTimeout(() => { if (host.firstElementChild === el) host.innerHTML = ''; }, ms + 50);
}
const BANNER_MS = 1300;

/** How long the AI waits before its next move, so notable moments get time to land. */
function nextAiDelay(action: Action, before: Snapshot, notable: number): number {
  const s = state!;
  if (s.current !== before.current || s.season !== before.season) return BANNER_MS - 150;
  if (notable > 0 || action.type === 'useAbility' || action.type === 'proposeTrade') return 950;
  if (action.type === 'bid' || action.type === 'passBid') return 380;
  if (action.type === 'roll' || action.type === 'chooseFork' || action.type === 'dungeonChoice') return 550;
  return 380;
}

async function dispatch(a: Action) {
  if (!state || busy) return;
  const err = await perform(a);
  if (err) { toast(err); return; }
  modal = null;
  render();
  aiLoop();
}

/* ---------------- AI driver ---------------- */

async function aiLoop() {
  const gid = gameId;
  if (aiLoopFor === gid) return;
  aiLoopFor = gid;
  try {
    while (state && gid === gameId && state.winner === null && actingPlayer(state) !== HUMAN) {
      await sleep(aiDelay / speed);
      if (!state || gid !== gameId || state.winner !== null || actingPlayer(state) === HUMAN) break;
      const action = decide(state, difficulty);
      const err = await perform(action);
      if (err) {
        console.error('AI action rejected', action, err);
        // fail-safe so a stuck AI never freezes the game
        if (await perform({ type: 'endTurn' }) && await perform({ type: 'roll' })) {
          toast('An AI faltered — see console.');
          break;
        }
      }
    }
  } finally {
    if (aiLoopFor === gid) aiLoopFor = -1;
  }
  if (gid === gameId) render();
}

showSetup();
