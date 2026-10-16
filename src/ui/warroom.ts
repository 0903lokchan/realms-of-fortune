// Heroes and tactics: the Crossroads Bazaar, the tactic picker, and the duel / tactic reveals.

import { node } from '../engine/board';
import { lureTargets, tacticBlocker } from '../engine/engine';
import { hero, SHORTCUT_ENTRANCES, tactic, TACTICS } from '../engine/heroes';
import { baseRent, hasEnchant, playerProps, rentFor, resistChance } from '../engine/rules';
import type { Action, Fx, GameState, PlayerId, TacticId } from '../engine/types';
import { MAX_HEROES, MAX_TACTICS } from '../engine/types';
import { esc, SEAT_COLORS } from './theme';
import { sleep } from './tokens';

type Dispatch = (a: Action) => void;

function pips(n: number, cls: string): string {
  return `<span class="pips ${cls}">${'<i></i>'.repeat(n)}${'<i class="off"></i>'.repeat(9 - n)}</span>`;
}

/* ------------------------------------------------------------------ */
/* Bazaar                                                              */
/* ------------------------------------------------------------------ */

export function bazaarDialog(state: GameState, human: PlayerId, dispatch: Dispatch, close: () => void): HTMLElement {
  const me = state.players[human];
  const fullBand = me.heroes.length >= MAX_HEROES;
  const fullHand = me.tactics.length >= MAX_TACTICS;
  const heroes = state.forHire.map(id => {
    const h = hero(id);
    const why = fullBand ? 'band full' : me.cash < h.cost ? 'not enough gold' : '';
    return `<div class="hire-card">
      <span class="portrait" style="--pc:${h.might >= h.wits ? '#c0563f' : '#7a5cc0'}">${esc(h.name[0])}</span>
      <b>${esc(h.name)}</b><small>${esc(h.title)}</small>
      <span class="stat">MIGHT ${pips(h.might, 'might')}</span>
      <span class="stat">WITS ${pips(h.wits, 'wits')}</span>
      <button class="btn small" data-hire="${id}" ${why ? 'disabled' : ''} title="${why}">${why ? why.toUpperCase() : `HIRE · ${h.cost}g`}</button>
    </div>`;
  }).join('') || '<p class="dialog-sub">No heroes left for hire.</p>';
  const tactics = TACTICS.map(t => {
    const why = fullHand ? 'hand full' : me.cash < t.price ? 'not enough gold' : '';
    return `<div class="tactic-row">
      <span class="tcard">✦</span>
      <span class="tinfo"><b>${esc(t.name)}</b>${t.classic ? ` <span class="classic">${t.classic}</span>` : ''}<small>${esc(t.text)}</small></span>
      <button class="btn small ghost" data-buy="${t.id}" ${why ? 'disabled' : ''}>${why ? why.toUpperCase() : `${t.price}g`}</button>
    </div>`;
  }).join('');

  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="dialog-backdrop" id="b-back"><div class="dialog bazaar">
    <h2 class="dialog-h">The Crossroads Bazaar</h2>
    <p class="dialog-sub">Purse ${me.cash}g · ${me.heroes.length}/${MAX_HEROES} heroes · ${me.tactics.length}/${MAX_TACTICS} tactics · open until your turn ends</p>
    <h5 class="sec">HEROES FOR HIRE</h5>
    <div class="hire-grid">${heroes}</div>
    <h5 class="sec">TACTICS <small>one may be played each turn</small></h5>
    <div class="tactic-list">${tactics}</div>
    <div class="foot"><button class="btn ghost" id="b-close">LEAVE THE BAZAAR</button></div>
  </div></div>`;
  wrap.querySelector('#b-close')!.addEventListener('click', close);
  wrap.querySelector('#b-back')!.addEventListener('click', e => { if ((e.target as HTMLElement).id === 'b-back') close(); });
  wrap.querySelectorAll<HTMLElement>('[data-hire]').forEach(b =>
    b.addEventListener('click', () => dispatch({ type: 'hireHero', hero: b.dataset.hire! })));
  wrap.querySelectorAll<HTMLElement>('[data-buy]').forEach(b =>
    b.addEventListener('click', () => dispatch({ type: 'buyTactic', tactic: b.dataset.buy as TacticId })));
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Playing a tactic                                                    */
/* ------------------------------------------------------------------ */

/** Pick a tactic from hand, then its target. `start` preselects a card. */
export function tacticDialog(
  state: GameState, human: PlayerId, dispatch: Dispatch, close: () => void, start?: TacticId,
): HTMLElement {
  const wrap = document.createElement('div');
  const me = state.players[human];
  const rivals = state.players.filter(p => p.id !== human && !p.bankrupt);
  let chosen: TacticId | undefined = start;
  let lureVictim: PlayerId | undefined;

  const option = (label: string, sub: string, action: Action, blocker: string | null) =>
    `<button class="dopt" data-act='${JSON.stringify(action)}' ${blocker ? 'disabled' : ''}>
      <span><span class="dname">${esc(label)}</span><span class="ddesc">${esc(blocker ?? sub)}</span></span>
    </button>`;
  const cunning = (pid: PlayerId) => {
    const r = Math.round(resistChance(state, human, pid) * 100);
    return r ? `${r}% chance they see through it` : 'they cannot outwit you';
  };

  const render = () => {
    let body = '';
    if (!chosen) {
      body = `<div class="hand">${me.tactics.map((t, i) => `
        <button class="hand-card" data-pick="${t}" data-i="${i}">
          <b>${esc(tactic(t).name)}</b>${tactic(t).classic ? `<span class="classic">${tactic(t).classic}</span>` : ''}
          <small>${esc(tactic(t).text)}</small>
        </button>`).join('') || '<p class="dialog-sub">Your hand is empty. Tactics are sold at the Crossroads Bazaar.</p>'}</div>`;
    } else {
      const t = chosen;
      const rows: string[] = [];
      if (t === 'rooted') {
        for (const r of rivals) {
          const a: Action = { type: 'playTactic', tactic: t, target: r.id };
          rows.push(option(r.name, cunning(r.id), a, tacticBlocker(state, human, t, r.id)));
        }
      } else if (t === 'lure' && lureVictim === undefined) {
        for (const r of rivals) {
          const lands = lureTargets(state, human, r.id);
          const blocker = r.inDungeon ? 'they are in the Dungeon' : r.sanctuary ? `${r.name} is under Sanctuary`
            : lands.length ? null : 'none of your lands lie within 6 steps of them';
          rows.push(`<button class="dopt" data-victim="${r.id}" ${blocker ? 'disabled' : ''}>
            <span><span class="dname">${esc(r.name)}</span><span class="ddesc">${esc(blocker ?? `${lands.length} of your lands in reach · ${cunning(r.id)}`)}</span></span></button>`);
        }
      } else if (t === 'lure') {
        const victim = state.players[lureVictim!];
        for (const id of lureTargets(state, human, victim.id)) {
          const a: Action = { type: 'playTactic', tactic: t, target: victim.id, node: id };
          rows.push(option(node(id).name, `${victim.name} would owe ${rentFor(state, victim, id, 7)}g`, a, tacticBlocker(state, human, t, victim.id, id)));
        }
      } else if (t === 'sabotage') {
        for (const r of rivals) {
          for (const id of playerProps(state, r.id).filter(x => state.ownership[x].upgrades.length)) {
            const a: Action = { type: 'playTactic', tactic: t, target: r.id, node: id };
            const o = state.ownership[id];
            const up = o.upgrades[o.upgrades.length - 1];
            const what = up.kind === 'settlement' ? 'a Settlement' : up.kind === 'garrison' ? 'its garrison' : 'an Enchantment';
            rows.push(option(`${node(id).name} (${r.name})`, `wreck ${what} · rent ${baseRent(state, id, 7)}g · ${cunning(r.id)}`, a,
              hasEnchant(o, 'ward') ? 'a Ward protects it' : tacticBlocker(state, human, t, r.id, id)));
          }
        }
        if (!rows.length) rows.push('<p class="dialog-sub">No rival has built anything yet.</p>');
      } else if (t === 'bridge') {
        for (const [entrance, name] of Object.entries(SHORTCUT_ENTRANCES)) {
          rows.push(option(`Close ${name}`, 'everyone else must take the long road until your next turn',
            { type: 'playTactic', tactic: t, node: entrance }, tacticBlocker(state, human, t, undefined, entrance)));
        }
      } else if (t === 'march') {
        rows.push(option('March!', 'your next roll adds a third die', { type: 'playTactic', tactic: t }, tacticBlocker(state, human, t)));
      } else {
        rows.push('<p class="dialog-sub">A Feint is never played: it waits in your hand and turns the next hostile tactic back on its caster.</p>');
      }
      body = `<div class="dungeon-opts scrolly">${rows.join('')}</div>`;
    }
    const title = chosen ? tactic(chosen).name : 'Your Tactics';
    const sub = chosen
      ? (chosen === 'lure' && lureVictim !== undefined ? `Pull ${state.players[lureVictim].name} onto which land?` : tactic(chosen).text)
      : me.tacticUsed ? 'You have already played a tactic this turn.' : 'Play one tactic each turn, before or after you move.';
    wrap.innerHTML = `<div class="dialog-backdrop" id="t-back"><div class="dialog">
      <h2 class="dialog-h">${esc(title)}</h2><p class="dialog-sub">${esc(sub)}</p>
      ${body}
      <div class="foot">
        ${chosen ? '<button class="btn ghost" id="t-backbtn">BACK</button>' : ''}
        <button class="btn ghost" id="t-close">CLOSE</button>
      </div>
    </div></div>`;
    wrap.querySelector('#t-close')!.addEventListener('click', close);
    wrap.querySelector('#t-back')!.addEventListener('click', e => { if ((e.target as HTMLElement).id === 't-back') close(); });
    wrap.querySelector('#t-backbtn')?.addEventListener('click', () => {
      if (lureVictim !== undefined) lureVictim = undefined; else chosen = undefined;
      render();
    });
    wrap.querySelectorAll<HTMLElement>('[data-pick]').forEach(b =>
      b.addEventListener('click', () => { chosen = b.dataset.pick as TacticId; render(); }));
    wrap.querySelectorAll<HTMLElement>('[data-victim]').forEach(b =>
      b.addEventListener('click', () => { lureVictim = Number(b.dataset.victim); render(); }));
    wrap.querySelectorAll<HTMLElement>('[data-act]').forEach(b =>
      b.addEventListener('click', () => dispatch(JSON.parse(b.dataset.act!))));
  };
  render();
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Reveals                                                             */
/* ------------------------------------------------------------------ */

type DuelFx = Extract<Fx, { type: 'duel' }>;
type TacticFx = Extract<Fx, { type: 'tactic' }>;

function stage(): HTMLElement | null {
  return document.getElementById('clash');
}

/** Two sides square off, the dice tumble, and the verdict lands. */
export async function playDuel(f: DuelFx, state: GameState, speed: number) {
  const host = stage();
  if (!host) return;
  const atk = state.players[f.attacker], def = state.players[f.owner];
  const side = (color: string, who: string, heroName: string, base: number, cls: string) => `
    <div class="clash-side ${cls}" style="--pc:${color}">
      <span class="portrait">${esc(heroName[0])}</span>
      <b>${esc(heroName)}</b><small>${esc(who)}</small>
      <span class="clash-sum">${base} + <span class="clash-die">?</span> = <span class="clash-total">?</span></span>
    </div>`;
  host.innerHTML = `<div class="clash" style="animation-duration:${2600 / speed}ms">
    <span class="clash-title">CHALLENGE AT ${esc(node(f.node).name.toUpperCase())}</span>
    <div class="clash-row">
      ${side(SEAT_COLORS[atk.id], atk.name, f.attackHero ? hero(f.attackHero).name : atk.name, f.attackBase, 'atk')}
      <span class="clash-vs">⚔</span>
      ${side(SEAT_COLORS[def.id], def.name, f.defendHero ? hero(f.defendHero).name : 'Town Militia', f.defenseBase, 'def')}
    </div>
    <span class="clash-verdict"></span>
  </div>`;
  const dice = host.querySelectorAll<HTMLElement>('.clash-die');
  for (let i = 0; i < 8; i++) {
    dice.forEach(d => { d.textContent = String(1 + Math.floor(Math.random() * 6)); });
    await sleep(70 / speed);
  }
  dice[0].textContent = String(f.attackDie);
  dice[1].textContent = String(f.defenseDie);
  const totals = host.querySelectorAll<HTMLElement>('.clash-total');
  totals[0].textContent = String(f.attackBase + f.attackDie);
  totals[1].textContent = String(f.defenseBase + f.defenseDie);
  host.querySelector(`.clash-side.${f.won ? 'atk' : 'def'}`)?.classList.add('victor');
  const verdict = host.querySelector<HTMLElement>('.clash-verdict')!;
  verdict.textContent = f.won ? (f.sacked ? 'VICTORY — THE LAND IS SACKED!' : 'VICTORY — NO RENT PAID') : 'REPELLED — DOUBLE RENT';
  verdict.classList.add(f.won ? 'won' : 'lost');
  await sleep(1500 / speed);
  host.innerHTML = '';
}

/** A tactic card is revealed, with its fate: it lands, is seen through, or is turned back. */
export async function playTacticReveal(f: TacticFx, state: GameState, human: PlayerId, speed: number) {
  const host = stage();
  if (!host) return;
  const t = tactic(f.tactic);
  const caster = state.players[f.player];
  const name = (pid: PlayerId) => (pid === human ? 'you' : state.players[pid].name);
  const line = f.target === null
    ? `${caster.id === human ? 'You play' : `${caster.name} plays`} ${t.name}`
    : `${caster.id === human ? 'You play' : `${caster.name} plays`} ${t.name} on ${name(f.target)}`;
  const outcome = f.reflected ? `FEINT! TURNED BACK ON ${name(f.player).toUpperCase()}` : f.resisted ? 'SEEN THROUGH!' : '';
  host.innerHTML = `<div class="tactic-reveal" style="animation-duration:${1900 / speed}ms">
    <span class="tr-card"><span class="tr-classic">${t.classic ?? '✦'}</span><b>${esc(t.name.toUpperCase())}</b></span>
    <span class="tr-line">${esc(line)}</span>
    ${outcome ? `<span class="tr-outcome">${esc(outcome)}</span>` : ''}
  </div>`;
  await sleep(1900 / speed);
  host.innerHTML = '';
}
