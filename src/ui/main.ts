import './style.css';
import { decide, type Difficulty } from '../ai/ai';
import { actingPlayer, applyAction, createGame } from '../engine/engine';
import type { Action, ClassId, GameState, NodeId } from '../engine/types';
import { AI_ROSTER, CLASS_INFO, esc, HERO_NAMES } from './theme';
import { buildMap, updateMap } from './map';
import { renderPanel } from './panel';
import { abilityTargets, endScreen, pendingDialog, propertySheet, tradeBuilder } from './dialogs';

const HUMAN = 0;
const app = document.getElementById('app')!;

let state: GameState | null = null;
let difficulty: Difficulty = 'knight';
let dyn: SVGGElement | null = null;
let userModal: HTMLElement | null = null;
let aiTimer: number | null = null;

/* ---------------- setup screen ---------------- */

function showSetup() {
  state = null;
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  let chosen: ClassId = 'wizard';
  const classes = Object.entries(CLASS_INFO) as Array<[ClassId, typeof CLASS_INFO[ClassId]]>;

  const render = () => {
    app.innerHTML = `
    <div class="page setup-page">
      <header class="page-header"><h1>REALMS OF FORTUNE</h1>
        <p>Bankrupt three rivals — or be the richest when winter ends.</p></header>
      <div class="frame stage"><div class="setup">
        <h2 class="dialog-h">Choose Your Champion</h2>
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
      </div></div>
    </div>`;
    app.querySelectorAll<HTMLElement>('[data-cls]').forEach(b =>
      b.addEventListener('click', () => { chosen = b.dataset.cls as ClassId; render(); }));
    app.querySelectorAll<HTMLElement>('[data-diff]').forEach(b =>
      b.addEventListener('click', () => { difficulty = b.dataset.diff as Difficulty; render(); }));
    app.querySelector('#begin')!.addEventListener('click', () => startGame(chosen));
  };
  render();
}

/* ---------------- game screen ---------------- */

function startGame(cls: ClassId) {
  const rivals = AI_ROSTER.filter(r => r.cls !== cls).slice(0, 3);
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  state = createGame(seed, [
    { name: HERO_NAMES[cls], cls, human: true },
    ...rivals,
  ]);
  userModal = null;

  app.innerHTML = `
  <div class="page game-page">
    <div class="screen">
      <div class="frame map-wrap"><svg id="map"></svg></div>
      <aside class="frame panel" id="panel"></aside>
    </div>
    <div id="overlay"></div>
    <div id="toast"></div>
  </div>`;

  const svg = document.getElementById('map') as unknown as SVGSVGElement;
  dyn = buildMap(svg, onNodeClick);
  render();
  pumpAI();
}

function onNodeClick(id: NodeId) {
  if (!state || state.winner !== null) return;
  if (state.pending) return; // decisions first
  openModal(propertySheet(state, HUMAN, id, dispatch, closeModal));
}

function openModal(el: HTMLElement | null) {
  if (!el) return;
  userModal = el;
  render();
}
function closeModal() {
  userModal = null;
  render();
}

function toast(msg: string) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = `<div class="toast">${esc(msg)}</div>`;
  setTimeout(() => { if (t.firstChild) t.innerHTML = ''; }, 2200);
}

function dispatch(a: Action) {
  if (!state) return;
  const err = applyAction(state, a);
  if (err) { toast(err); return; }
  userModal = null; // any successful action closes user modals
  render();
  pumpAI();
}

function render() {
  if (!state || !dyn) return;
  updateMap(dyn, state);
  renderPanel(document.getElementById('panel')!, state, HUMAN);
  bindPanel();

  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = '';
  if (state.winner !== null) {
    overlay.appendChild(endScreen(state, HUMAN, showSetup));
    return;
  }
  const pend = pendingDialog(state, HUMAN, dispatch);
  if (pend) overlay.appendChild(pend);
  else if (userModal) overlay.appendChild(userModal);
}

function bindPanel() {
  const on = (id: string, fn: () => void) =>
    document.getElementById(id)?.addEventListener('click', fn);
  on('btn-roll', () => dispatch({ type: 'roll' }));
  on('btn-end', () => dispatch({ type: 'endTurn' }));
  on('btn-trade', () => { if (state) openModal(tradeBuilder(state, HUMAN, dispatch, closeModal)); });
  on('btn-ability', () => {
    if (!state) return;
    const el = abilityTargets(state, HUMAN, dispatch, closeModal);
    if (el) openModal(el);
  });
}

/* ---------------- AI driver ---------------- */

function pumpAI() {
  if (!state || state.winner !== null) return;
  if (actingPlayer(state) === HUMAN) return;
  if (aiTimer) return;
  aiTimer = window.setTimeout(() => {
    aiTimer = null;
    if (!state || state.winner !== null) { render(); return; }
    if (actingPlayer(state) !== HUMAN) {
      const action = decide(state, difficulty);
      const err = applyAction(state, action);
      if (err) {
        console.error('AI action rejected', action, err);
        // fail-safe so a stuck AI never freezes the game
        if (applyAction(state, { type: 'endTurn' }) && applyAction(state, { type: 'roll' })) {
          toast('An AI faltered — see console.');
          render();
          return;
        }
      }
      render();
    }
    pumpAI();
  }, 420);
}

showSetup();
