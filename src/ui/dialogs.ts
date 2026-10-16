// Dialog overlays: engine pending decisions, the property sheet, ability targeting,
// the trade builder, and the endgame screen.

import { distancesFrom, node, regionProps } from '../engine/board';
import {
  baseRent, buildError, mortgageValue, netWorth, own, playerProps, unmortgageCost, upgradeCost, upgradeSaleValue,
} from '../engine/rules';
import type { Action, GameState, NodeId, Upgrade } from '../engine/types';
import { CLASS_INFO, esc, REGION_COLORS, REGION_NAMES, SEAT_COLORS } from './theme';

type Dispatch = (a: Action) => void;

const ROUTE_FLAVOR: Record<string, { name: string; desc: string; tag: string; cls: string }> = {
  way_w: { name: 'THE COAST ROAD', desc: 'North through the Wildwood and the far Waygates. Passes the Crossroads for 150g.', tag: 'SAFER · LONGER', cls: 'safe' },
  rockfall: { name: 'THE IRONVEIN PASS', desc: "Over the mountains, past the Dungeon's gates. Skips half the realm — and its rents.", tag: 'FAST · PERILOUS', cls: 'risky' },
  rune: { name: 'THE HIGH ROAD', desc: 'On through the Mage Districts and Dragonspine — and the King’s Levy.', tag: 'THE LONG WAY', cls: 'safe' },
  gull: { name: 'THE UNDERWAY', desc: 'A smugglers’ sea route. 50g ferry toll, but it dodges the King’s Levy.', tag: 'TOLL · SNEAKY', cls: 'risky' },
};

/** `docked` dialogs sit at the bottom over a light backdrop so the map stays readable. */
function dialog(title: string, sub: string, body: string, docked = false): string {
  return `<div class="dialog-backdrop ${docked ? 'docked' : ''}"><div class="dialog">
    <h2 class="dialog-h">${title}</h2>
    ${sub ? `<p class="dialog-sub">${sub}</p>` : ''}
    ${body}
  </div></div>`;
}

/** Render the dialog for a pending decision owed by the human, or null. */
export function pendingDialog(state: GameState, human: number, dispatch: Dispatch): HTMLElement | null {
  const p = state.pending;
  if (!p || p.player !== human) return null;
  const wrap = document.createElement('div');
  const me = state.players[human];

  switch (p.type) {
    case 'fork': {
      const routes = p.options.map(to => {
        const f = ROUTE_FLAVOR[to] ?? { name: node(to).name.toUpperCase(), desc: '', tag: 'ONWARD', cls: 'safe' };
        return `<button class="route" data-to="${to}">
          <h5>${f.name}</h5><p>${f.desc}</p><span class="tag ${f.cls}">${f.tag}</span>
        </button>`;
      }).join('');
      wrap.innerHTML = dialog('A Fork in the Road',
        `${state.movement ? state.movement.remaining + ' steps yet to walk' : ''}`,
        `<div class="routes">${routes}</div>`, true);
      wrap.querySelectorAll<HTMLElement>('.route').forEach(b =>
        b.addEventListener('click', () => dispatch({ type: 'chooseFork', to: b.dataset.to! })));
      return wrap;
    }
    case 'rangerAdjust': {
      const opts = p.options.map(s =>
        `<button class="btn" data-s="${s}">${s} STEPS${s === p.rolled ? ' (rolled)' : ''}</button>`).join('');
      wrap.innerHTML = dialog('Choose Your Stride', 'A Ranger bends the road by one step.', `<div class="foot">${opts}</div>`);
      wrap.querySelectorAll<HTMLElement>('[data-s]').forEach(b =>
        b.addEventListener('click', () => dispatch({ type: 'rangerAdjust', steps: Number(b.dataset.s) })));
      return wrap;
    }
    case 'buyOrPass': {
      const n = node(p.node);
      const region = n.region ? `${REGION_NAMES[n.region]} · ` : '';
      wrap.innerHTML = dialog(`Claim ${esc(n.name)}?`,
        `${region}price ${p.price}g — you hold ${me.cash}g`,
        `<div class="foot">
          <button class="btn" id="d-buy" ${me.cash < p.price ? 'disabled' : ''}>BUY — ${p.price}g</button>
          <button class="btn ghost" id="d-pass">${state.rangerClaim ? 'LEAVE IT' : 'SEND TO AUCTION'}</button>
        </div>`);
      wrap.querySelector('#d-buy')!.addEventListener('click', () => dispatch({ type: 'buy' }));
      wrap.querySelector('#d-pass')!.addEventListener('click', () => dispatch({ type: 'declineBuy' }));
      return wrap;
    }
    case 'auctionBid': {
      const a = state.auction!;
      const n = node(p.node);
      const leaderName = a.leader !== null ? state.players[a.leader].name : 'no one';
      const next = a.currentBid + 10;
      const bids = a.active.map(pid => {
        const lead = pid === a.leader;
        return `<div class="bid ${lead ? 'lead' : ''}" style="--pc:${SEAT_COLORS[pid]}">
          <div class="portrait">${esc(state.players[pid].name[0])}</div>
          <b>${lead ? a.currentBid + 'g' : '…'}</b><small>${lead ? 'leading' : 'in'}</small>
        </div>`;
      }).join('');
      wrap.innerHTML = dialog('Auction', `${esc(n.name)} · listed ${n.price}g · ${esc(leaderName)} leads`,
        `<div class="bids">${bids}</div>
         <div class="foot">
           <button class="btn" id="d-bid" ${me.cash < next ? 'disabled' : ''}>BID ${next}g</button>
           <button class="btn ghost" id="d-bid50" ${me.cash < a.currentBid + 50 ? 'disabled' : ''}>BID ${a.currentBid + 50}g</button>
           <button class="btn danger" id="d-abandon">PASS</button>
         </div>`);
      wrap.querySelector('#d-bid')!.addEventListener('click', () => dispatch({ type: 'bid', amount: next }));
      wrap.querySelector('#d-bid50')!.addEventListener('click', () => dispatch({ type: 'bid', amount: a.currentBid + 50 }));
      wrap.querySelector('#d-abandon')!.addEventListener('click', () => dispatch({ type: 'passBid' }));
      return wrap;
    }
    case 'pickpocket': {
      wrap.innerHTML = dialog('Pickpocket?',
        `${p.rent}g rent is due at ${esc(node(p.node).name)}. Roll a d6 — on 5–6 you pay nothing. Costs your ability (3-turn cooldown).`,
        `<div class="foot">
          <button class="btn secondary" id="d-yes">TRY THE LIFT</button>
          <button class="btn ghost" id="d-no">JUST PAY</button>
        </div>`);
      wrap.querySelector('#d-yes')!.addEventListener('click', () => dispatch({ type: 'pickpocket', use: true }));
      wrap.querySelector('#d-no')!.addEventListener('click', () => dispatch({ type: 'pickpocket', use: false }));
      return wrap;
    }
    case 'dungeon': {
      const bribe = me.cls === 'warrior' ? 0 : 50;
      wrap.innerHTML = dialog('The Dungeon', `Turn ${me.dungeonTurns + 1} of 3 · your garrisons cost double while you rot`,
        `<div class="dungeon-opts">
          <button class="dopt" id="d-bribe" ${me.cash < bribe ? 'disabled' : ''}><span><span class="dname">BRIBE THE JAILER</span><span class="ddesc">Leave at once.</span></span><span class="dcost">${bribe}g</span></button>
          <button class="dopt" id="d-roll"><span><span class="dname">ROLL FOR ESCAPE</span><span class="ddesc">Doubles set you free.</span></span><span class="dcost">2d6</span></button>
          <button class="dopt" id="d-fight"><span><span class="dname">FIGHT YOUR WAY OUT</span><span class="ddesc">Escape on 8+, else 25g in bruises.${me.cls === 'warrior' ? ' Warriors never fail.' : ''}</span></span><span class="dcost">8+</span></button>
          <button class="dopt" id="d-writ" ${me.writs <= 0 ? 'disabled' : ''}><span><span class="dname">WRIT OF RELEASE</span><span class="ddesc">${me.writs} held.</span></span><span class="dcost">📜</span></button>
        </div>`);
      const bind = (id: string, choice: 'bribe' | 'roll' | 'fight' | 'writ') =>
        wrap.querySelector(id)!.addEventListener('click', () => dispatch({ type: 'dungeonChoice', choice }));
      bind('#d-bribe', 'bribe'); bind('#d-roll', 'roll'); bind('#d-fight', 'fight'); bind('#d-writ', 'writ');
      return wrap;
    }
    case 'chooseCurseTarget': {
      const opts = p.options.map(id => {
        const o = own(state, id);
        return `<button class="dopt" data-id="${id}"><span><span class="dname">${esc(node(id).name)}</span>
          <span class="ddesc">${esc(state.players[o.owner!].name)} · rent ${baseRent(state, id, 7)}g</span></span><span class="dcost">☠</span></button>`;
      }).join('');
      wrap.innerHTML = dialog('Withering Curse', 'Choose a rival land — its rent is halved until cleansed.',
        `<div class="dungeon-opts">${opts}</div>
         <div class="foot"><button class="btn ghost" id="d-skip">WASTE THE CURSE</button></div>`);
      wrap.querySelectorAll<HTMLElement>('[data-id]').forEach(b =>
        b.addEventListener('click', () => dispatch({ type: 'chooseCurseTarget', node: b.dataset.id! })));
      wrap.querySelector('#d-skip')!.addEventListener('click', () => dispatch({ type: 'chooseCurseTarget', node: null }));
      return wrap;
    }
    case 'tradeOffer': {
      const o = p.offer;
      const iAmTo = human === o.to;
      const other = state.players[iAmTo ? o.from : o.to];
      const getProps = iAmTo ? o.giveProps : o.getProps;
      const getGold = iAmTo ? o.giveGold : o.getGold;
      const giveProps = iAmTo ? o.getProps : o.giveProps;
      const giveGold = iAmTo ? o.getGold : o.giveGold;
      const list = (props: NodeId[], gold: number) =>
        [...props.map(id => esc(node(id).name)), gold ? `${gold}g` : ''].filter(Boolean).join(', ') || 'nothing';
      wrap.innerHTML = dialog(o.countered ? `${esc(other.name)} Accepts — At a Price` : `${esc(other.name)} Proposes a Bargain`,
        '',
        `<div class="trade-sum">
           <p>You give: <b>${list(giveProps, giveGold)}</b></p>
           <p>You receive: <b>${list(getProps, getGold)}</b></p>
         </div>
         <div class="foot">
           <button class="btn" id="d-acc">ACCEPT</button>
           ${iAmTo && !o.countered ? '<button class="btn ghost" id="d-cnt">COUNTER +100g</button>' : ''}
           <button class="btn danger" id="d-dec">DECLINE</button>
         </div>`);
      wrap.querySelector('#d-acc')!.addEventListener('click', () => dispatch({ type: 'respondTrade', response: 'accept' }));
      wrap.querySelector('#d-cnt')?.addEventListener('click', () => dispatch({ type: 'respondTrade', response: 'counter', counterGold: 100 }));
      wrap.querySelector('#d-dec')!.addEventListener('click', () => dispatch({ type: 'respondTrade', response: 'decline' }));
      return wrap;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Property sheet                                                      */
/* ------------------------------------------------------------------ */

export function propertySheet(
  state: GameState, human: number, id: NodeId, dispatch: Dispatch, close: () => void,
): HTMLElement {
  const wrap = document.createElement('div');
  const n = node(id);
  const o = own(state, id);
  const me = state.players[human];
  const mine = o.owner === human;
  const canAct = state.current === human && !state.pending && !me.actionUsed
    && (state.phase === 'preroll' || state.phase === 'postroll') && state.winner === null;
  const ownerName = o.owner === null ? 'wild land' : state.players[o.owner].name + (mine ? ' (you)' : '');
  const region = n.region ? REGION_NAMES[n.region] : n.type === 'way' ? 'Waygate' : 'Mana source';
  const color = n.region ? REGION_COLORS[n.region] : '#3fd0c9';
  const rentNow = o.owner !== null ? baseRent(state, id, 7) : 0;

  let buildRows = '';
  if (mine && n.type === 'prop') {
    const options: Array<{ up: Upgrade; label: string; icon: string }> = [
      { up: { kind: 'settlement' }, label: 'Settlement — +1 rent tier', icon: 'i-settle' },
      { up: { kind: 'enchant', enchant: 'ward' }, label: 'Ward — blocks curses & abilities', icon: 'i-star' },
      { up: { kind: 'enchant', enchant: 'vault' }, label: 'Gilded Vault — +25g each lap', icon: 'i-star' },
      { up: { kind: 'enchant', enchant: 'trap' }, label: 'Snare Trap — first rent each lap ×2', icon: 'i-star' },
      { up: { kind: 'enchant', enchant: 'beacon' }, label: 'Beacon — 20g toll from passers-by', icon: 'i-star' },
      { up: { kind: 'garrison', garrison: 'guard' }, label: 'Guard Post — stops pickpockets', icon: 'i-shield' },
      { up: { kind: 'garrison', garrison: 'ogre' }, label: 'Ogre — rent ×1.5, 10g upkeep', icon: 'i-shield' },
      { up: { kind: 'garrison', garrison: 'drake' }, label: 'Drake — rent ×2, 25g upkeep', icon: 'i-shield' },
    ];
    buildRows = options.map((opt, i) => {
      const err = buildError(state, me, id, opt.up);
      const cost = upgradeCost(state, me, id, opt.up);
      return `<button class="opt-row" data-b="${i}" ${err || !canAct ? 'disabled' : ''} title="${esc(err ?? '')}">
        <svg class="ic"><use href="#${opt.icon}"/></svg><span>${opt.label}</span>
        <b>${err ? esc(err) : cost + 'g'}</b></button>`;
    }).join('');
    (wrap as unknown as { _opts: typeof options })._opts = options;
  }

  const slots = o.upgrades.map((up, i) => {
    const icon = up.kind === 'settlement' ? 'i-settle' : up.kind === 'enchant' ? 'i-star' : 'i-shield';
    const val = upgradeSaleValue(state, me, id, up);
    const sell = mine && canAct ? `<button class="slot-sell" data-sell="${i}">sell ${val}g</button>` : '';
    return `<span class="slot"><svg class="ic"><use href="#${icon}"/></svg>${sell}</span>`;
  }).join('') + (n.type === 'prop' ? '<span class="slot empty">+</span>'.repeat(3 - o.upgrades.length) : '');

  const manage = mine ? `
    <div class="foot">
      ${!o.mortgaged && o.upgrades.length === 0
        ? `<button class="btn ghost" id="s-mort" ${canAct ? '' : 'disabled'}>MORTGAGE +${mortgageValue(id)}g</button>` : ''}
      ${o.mortgaged
        ? `<button class="btn ghost" id="s-unmort" ${canAct && me.cash >= unmortgageCost(id) ? '' : 'disabled'}>REDEEM −${unmortgageCost(id)}g</button>` : ''}
      ${o.cursed
        ? `<button class="btn secondary" id="s-cleanse" ${canAct ? '' : 'disabled'}>CLEANSE ${me.cls === 'cleric' ? 'FREE' : '50g'}</button>` : ''}
    </div>` : '';

  wrap.innerHTML = `<div class="dialog-backdrop" id="s-back"><div class="dialog sheet">
    <div class="sheet-head" style="--rc:${color}">
      <div class="tregion">${esc(region).toUpperCase()}${n.price ? ` · ${n.price}g` : ''}</div>
      <div class="tname">${esc(n.name)}</div>
      <div class="towner">${esc(ownerName)}${o.mortgaged ? ' · mortgaged' : ''}${o.cursed ? ' · cursed ☠' : ''}</div>
    </div>
    ${o.owner !== null && !o.mortgaged ? `<p class="rent-now">Rent today: <b>${rentNow}g</b></p>` : ''}
    ${n.type === 'prop' ? `<div class="slots">${slots}</div>` : ''}
    ${buildRows ? `<div class="build-list">${buildRows}</div>` : ''}
    ${manage}
    <div class="foot"><button class="btn ghost" id="s-close">CLOSE</button></div>
  </div></div>`;

  wrap.querySelector('#s-close')!.addEventListener('click', close);
  wrap.querySelector('#s-back')!.addEventListener('click', e => { if ((e.target as HTMLElement).id === 's-back') close(); });
  wrap.querySelector('#s-mort')?.addEventListener('click', () => dispatch({ type: 'mortgage', node: id }));
  wrap.querySelector('#s-unmort')?.addEventListener('click', () => dispatch({ type: 'unmortgage', node: id }));
  wrap.querySelector('#s-cleanse')?.addEventListener('click', () => dispatch({ type: 'cleanse', node: id }));
  wrap.querySelectorAll<HTMLElement>('[data-sell]').forEach(b =>
    b.addEventListener('click', () => dispatch({ type: 'sellUpgrade', node: id, slot: Number(b.dataset.sell) })));
  const opts = (wrap as unknown as { _opts?: Array<{ up: Upgrade }> })._opts;
  wrap.querySelectorAll<HTMLElement>('[data-b]').forEach(b =>
    b.addEventListener('click', () => dispatch({ type: 'build', node: id, upgrade: opts![Number(b.dataset.b)].up })));
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Ability targeting                                                   */
/* ------------------------------------------------------------------ */

export function abilityTargets(
  state: GameState, human: number, dispatch: Dispatch, close: () => void,
): HTMLElement | null {
  const me = state.players[human];
  const info = CLASS_INFO[me.cls];
  let targets: Array<{ id: NodeId; note: string }> = [];

  if (info.targeting === 'none') { dispatch({ type: 'useAbility' }); return null; }
  if (info.targeting === 'blink') {
    const dist = distancesFrom(me.pos, 8);
    targets = [...dist.entries()].filter(([, d]) => d >= 1).map(([id, d]) => {
      const o = state.ownership[id];
      const note = o ? (o.owner === null ? `wild · ${node(id).price}g` : o.owner === human ? 'yours' :
        `${state.players[o.owner].name} · rent ~${baseRent(state, id, 7)}g`) : node(id).type;
      return { id, note: `${d} steps · ${note}` };
    });
  } else if (info.targeting === 'appraise') {
    const dist = distancesFrom(me.pos, 5);
    targets = [...dist.keys()]
      .filter(id => state.ownership[id]?.owner === null)
      .map(id => ({ id, note: `buy at ${Math.round(node(id).price! * 1.2)}g` }));
  } else if (info.targeting === 'track') {
    targets = Object.entries(state.ownership)
      .filter(([id, o]) => o.owner === null && node(id).type === 'prop')
      .map(([id]) => ({ id, note: `wild · ${node(id).price}g` }));
  } else if (info.targeting === 'raise') {
    targets = playerProps(state, human)
      .filter(id => own(state, id).mortgaged)
      .map(id => ({ id, note: `redeem free (worth ${node(id).price}g)` }));
  }

  const wrap = document.createElement('div');
  const rows = targets.map(t =>
    `<button class="dopt" data-id="${t.id}"><span><span class="dname">${esc(node(t.id).name)}</span>
     <span class="ddesc">${esc(t.note)}</span></span></button>`).join('')
    || '<p class="dialog-sub">No valid target.</p>';
  wrap.innerHTML = dialog(info.activeName, info.active,
    `<div class="dungeon-opts scrolly">${rows}</div>
     <div class="foot"><button class="btn ghost" id="t-close">CANCEL</button></div>`);
  wrap.querySelector('#t-close')!.addEventListener('click', close);
  wrap.querySelectorAll<HTMLElement>('[data-id]').forEach(b =>
    b.addEventListener('click', () => dispatch({ type: 'useAbility', target: b.dataset.id! })));
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Trade builder                                                       */
/* ------------------------------------------------------------------ */

export function tradeBuilder(
  state: GameState, human: number, dispatch: Dispatch, close: () => void,
): HTMLElement {
  const wrap = document.createElement('div');
  const rivals = state.players.filter(p => p.id !== human && !p.bankrupt);
  let rival = rivals[0].id;

  const render = () => {
    const tradeable = (pid: number) =>
      playerProps(state, pid).filter(id => own(state, id).upgrades.length === 0 && !own(state, id).mortgaged);
    const list = (pid: number, side: string) => tradeable(pid).map(id =>
      `<label class="asset"><input type="checkbox" data-side="${side}" value="${id}">
       ${esc(node(id).name)}<i>${node(id).price}g</i></label>`).join('')
      || '<p class="dialog-sub">no unimproved lands</p>';
    wrap.innerHTML = dialog('Strike a Bargain', '',
      `<div class="foot" style="margin-top:0">
        ${rivals.map(r => `<button class="btn ghost small ${r.id === rival ? 'sel' : ''}" data-r="${r.id}">${esc(r.name)}</button>`).join('')}
       </div>
       <div class="trade-cols">
        <div class="offer"><h5>YOU OFFER</h5>${list(human, 'give')}
          <div class="gold-input"><input id="tg-give" type="number" value="0" min="0" step="10"><span>gold</span></div></div>
        <div class="swap">⇄</div>
        <div class="offer"><h5>${esc(state.players[rival].name).toUpperCase()} GIVES</h5>${list(rival, 'get')}
          <div class="gold-input"><input id="tg-get" type="number" value="0" min="0" step="10"><span>gold</span></div></div>
       </div>
       <div class="foot">
         <button class="btn" id="t-go">PROPOSE</button>
         <button class="btn ghost" id="t-close">CANCEL</button>
       </div>`);
    wrap.querySelectorAll<HTMLElement>('[data-r]').forEach(b =>
      b.addEventListener('click', () => { rival = Number(b.dataset.r); render(); }));
    wrap.querySelector('#t-close')!.addEventListener('click', close);
    wrap.querySelector('#t-go')!.addEventListener('click', () => {
      const picks = (side: string) => [...wrap.querySelectorAll<HTMLInputElement>(`input[data-side="${side}"]:checked`)].map(i => i.value);
      dispatch({
        type: 'proposeTrade',
        offer: {
          from: human, to: rival,
          giveProps: picks('give'),
          giveGold: Number((wrap.querySelector('#tg-give') as HTMLInputElement).value) || 0,
          getProps: picks('get'),
          getGold: Number((wrap.querySelector('#tg-get') as HTMLInputElement).value) || 0,
        },
      });
    });
  };
  render();
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Endgame                                                             */
/* ------------------------------------------------------------------ */

export function endScreen(state: GameState, human: number, onRestart: () => void): HTMLElement {
  const wrap = document.createElement('div');
  const winner = state.players[state.winner!];
  const won = state.winner === human;
  const me = state.players[human];
  const ruined = state.players.filter(p => p.bankrupt && p.id !== human).length;
  wrap.innerHTML = `<div class="dialog-backdrop"><div class="dialog victory">
    <span class="kicker">${won ? 'THE REALMS HAVE A NEW MASTER' : 'THE CONTEST IS DECIDED'}</span>
    <div class="vword ${won ? '' : 'lost'}">${won ? 'VICTORY' : 'DEFEAT'}</div>
    <p class="vsub">${esc(winner.name)} the ${CLASS_INFO[winner.cls].label} rules the Known Realms.</p>
    <div class="vstats">
      <div class="vstat"><b>${Math.min(state.round, 20)}</b><span>ROUNDS</span></div>
      <div class="vstat"><b>${me.bankrupt ? 0 : netWorth(state, me)}g</b><span>YOUR WORTH</span></div>
      <div class="vstat"><b>${playerProps(state, human).length}</b><span>LANDS HELD</span></div>
      <div class="vstat"><b>${ruined}</b><span>RIVALS RUINED</span></div>
    </div>
    <div class="foot"><button class="btn" id="v-again">PLAY AGAIN</button></div>
  </div></div>`;
  wrap.querySelector('#v-again')!.addEventListener('click', onRestart);
  return wrap;
}
