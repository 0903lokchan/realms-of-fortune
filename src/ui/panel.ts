// Right-hand HUD: round/season, players, dice, buttons, event log.

import { node } from '../engine/board';
import { netWorth, playerProps } from '../engine/rules';
import { actingPlayer } from '../engine/engine';
import type { GameState } from '../engine/types';
import { CLASS_INFO, esc, REGION_COLORS, SEAT_COLORS } from './theme';

const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

function die(v: number): string {
  return `<div class="die">${Array.from({ length: 9 }, (_, i) =>
    `<span class="pip" style="visibility:${PIPS[v]?.includes(i) ? 'visible' : 'hidden'}"></span>`).join('')}</div>`;
}

function chips(state: GameState, pid: number): string {
  return playerProps(state, pid).slice(0, 12).map(id => {
    const n = node(id);
    const color = n.type === 'prop' ? REGION_COLORS[n.region!] : n.type === 'way' ? '#3fd0c9' : '#4fa8e0';
    const dim = state.ownership[id].mortgaged ? 'opacity:.35' : '';
    return `<span class="chip" style="background:${color};${dim}"></span>`;
  }).join('');
}

export function renderPanel(root: HTMLElement, state: GameState, human: number) {
  const seasonLabel = state.season === 'summer' ? 'SUMMER' : state.season === 'autumn' ? 'AUTUMN · RENTS +25%' : 'WINTER · RENTS +50%';
  const acting = actingPlayer(state);
  const me = state.players[human];
  const cls = CLASS_INFO[me.cls];
  const myTurn = acting === human && state.winner === null;
  const preroll = state.phase === 'preroll' && !state.pending && state.current === human;
  const postroll = state.phase === 'postroll' && !state.pending && state.current === human;
  const abilityReady = me.abilityCooldown === 0 && !me.actionUsed && !me.bankrupt;
  const abilityNote = me.cls === 'rogue' ? 'triggers when you pay rent'
    : me.abilityCooldown > 0 ? `ready in ${me.abilityCooldown} turn${me.abilityCooldown > 1 ? 's' : ''}`
    : me.actionUsed ? 'action already taken' : cls.active;

  const players = state.players.map(p => {
    const active = p.id === state.current && state.winner === null;
    const flags = [
      p.inDungeon ? '⛓' : '',
      p.sanctuary ? '✧' : '',
      p.writs > 0 ? '📜'.repeat(p.writs) : '',
    ].join('');
    return `
    <div class="player ${active ? 'active' : ''} ${p.bankrupt ? 'dead' : ''}" style="--pc:${SEAT_COLORS[p.id]}">
      <div class="portrait">${esc(p.name[0])}</div>
      <div class="info">
        <div class="pname">${esc(p.name)} ${flags}</div>
        <div class="pclass">${CLASS_INFO[p.cls].label}${p.id === human ? ' · you' : ''}${p.bankrupt ? ' · ruined' : ''}</div>
        <div class="chips">${p.bankrupt ? '' : chips(state, p.id)}</div>
      </div>
      <div class="gold">${p.bankrupt ? '☠' : p.cash + 'g'}<small>${p.bankrupt ? '' : 'net ' + netWorth(state, p) + 'g'}</small></div>
    </div>`;
  }).join('');

  const [d1, d2] = state.lastRoll ?? [1, 1];
  const waitNote = !myTurn && state.winner === null
    ? `<div class="wait-note">${esc(state.players[acting].name)} is scheming…</div>` : '';

  root.innerHTML = `
    <h3>ROUND ${Math.min(state.round, 20)} of 20</h3>
    ${players}
    <div class="dice-row">${die(d1)}${die(d2)}<span class="season">${seasonLabel}</span></div>
    <div class="btn-row">
      <button class="btn" id="btn-roll" ${preroll ? '' : 'disabled'}>ROLL THE DICE</button>
      <button class="btn secondary" id="btn-ability" ${myTurn && abilityReady && cls.targeting !== 'reactive'
        && (cls.targeting === 'blink' ? preroll : (state.phase === 'preroll' || state.phase === 'postroll') && state.current === human)
        && !state.pending ? '' : 'disabled'}>
        ✦ ${cls.activeName.toUpperCase()} <small>${esc(abilityNote)}</small>
      </button>
      <div class="btn-pair">
        <button class="btn ghost" id="btn-trade" ${myTurn && !me.actionUsed && !state.pending && state.winner === null ? '' : 'disabled'}>TRADE</button>
        <button class="btn ghost" id="btn-end" ${postroll ? '' : 'disabled'}>END TURN</button>
      </div>
    </div>
    ${waitNote}
    <div class="log">${state.events.slice(-14).reverse().map(e =>
      `<p><span class="lr">r${e.round}</span> ${esc(e.text)}</p>`).join('')}</div>
  `;
}
