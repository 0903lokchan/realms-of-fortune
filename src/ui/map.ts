// SVG world-map renderer. Static layers (terrain, trails, node markers, labels)
// build once; a dynamic layer (ownership, upgrades, tokens, markers) redraws per state.

import { BOARD, node } from '../engine/board';
import { garrison, hasEnchant, own, settlementTiers } from '../engine/rules';
import type { GameState, NodeId } from '../engine/types';
import { REGION_COLORS, SEAT_COLORS } from './theme';
import type { Landing } from './preview';

const SVGNS = 'http://www.w3.org/2000/svg';
const CX = 530, CY = 402, RX = 400, RY = 308;
const WOBBLE = [1.00, 1.04, 0.97, 1.05, 0.99, 1.03, 0.96, 1.02, 1.06, 0.98, 1.03, 0.97, 1.04, 1.00, 1.05, 0.98, 1.02, 0.96, 1.04, 0.99, 1.03, 0.97, 1.05, 1.00, 0.97, 1.04, 0.99];

const OFF_POS: Record<string, [number, number]> = {
  rockfall: [300, 412], delve: [462, 442], wyvern: [628, 408], cliff: [788, 330],
  gull: [1006, 256], tavern: [1054, 420], cove: [978, 598], dungeon: [530, 322],
};

export const POS: Record<NodeId, { x: number; y: number; out?: number }> = (() => {
  const pos: Record<NodeId, { x: number; y: number; out?: number }> = {};
  let at: NodeId = 'crossroads';
  for (let i = 0; i < 27; i++) {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / 27;
    pos[at] = { x: CX + RX * WOBBLE[i] * Math.cos(a), y: CY + RY * WOBBLE[i] * Math.sin(a), out: a };
    at = node(at).out[0];
  }
  for (const [id, [x, y]] of Object.entries(OFF_POS)) pos[id] = { x, y };
  pos['crossroads'].y += 6;
  return pos;
})();

const NODEFILL: Record<string, string> = {
  capital: '#e8c96a', way: '#2ba8a2', mana: '#4fa8e0', fate: '#5a3f8f', quest: '#c9a25f',
  tavern: '#b5763f', dungeon: '#454a55', levy: '#b08d2e', trail: '#c9bd9a',
};
const NODEICON: Record<string, string> = {
  capital: 'i-keep', way: 'i-portal', mana: 'i-drop', fate: 'i-star', quest: 'i-scroll',
  tavern: 'i-mug', dungeon: 'i-bars', levy: 'i-crown',
};

export function nodeRadius(id: NodeId): number {
  const t = node(id).type;
  return t === 'capital' ? 21 : t === 'trail' ? 5.5 : t === 'prop' ? 13.5 : 12;
}

function el(parent: Element, tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVGNS, tag) as SVGElement;
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent.appendChild(e);
  return e;
}

function smoothPath(pts: number[][]): string {
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
  }
  return d + ' Z';
}

const REGION_LABELS: Array<{ ids: [NodeId, NodeId]; label: string; push: number }> = [
  { ids: ['bramble', 'millbrook'], label: 'THE SHIRELANDS', push: 36 },
  { ids: ['ferry', 'quay'], label: 'SILVERBROOK', push: 48 },
  { ids: ['elder', 'thorn'], label: 'THE WILDWOOD', push: 36 },
  { ids: ['forge', 'karak'], label: 'IRONVEIN MTS', push: 36 },
  { ids: ['coral', 'sunspire'], label: 'SUNSPIRE COAST', push: 34 },
  { ids: ['rune', 'arcanum'], label: 'MAGE DISTRICTS', push: 46 },
  { ids: ['ash', 'wyrm'], label: 'DRAGONSPINE', push: 40 },
  { ids: ['high', 'citadel'], label: 'CELESTIAL REACH', push: 34 },
];

export interface MapLayers {
  /** Ownership rings, upgrades, mortgage and curse marks — redrawn per state. */
  dyn: SVGGElement;
  /** Persistent player tokens (see tokens.ts). */
  tokens: SVGGElement;
  /** Clickable landing markers for an open stride or fork choice. */
  hints: SVGGElement;
  /** Transient pings and floating text. */
  fx: SVGGElement;
}

export function buildMap(svg: SVGSVGElement, onNodeClick: (id: NodeId) => void): MapLayers {
  svg.setAttribute('viewBox', '0 0 1120 830');
  svg.innerHTML = `
  <defs>
    <radialGradient id="sea" cx="50%" cy="40%" r="80%">
      <stop offset="0%" stop-color="#1e4258"/><stop offset="60%" stop-color="#143246"/><stop offset="100%" stop-color="#0c2233"/>
    </radialGradient>
    <radialGradient id="land" cx="45%" cy="40%" r="75%">
      <stop offset="0%" stop-color="#8fae62"/><stop offset="55%" stop-color="#7a9c55"/><stop offset="100%" stop-color="#5f8148"/>
    </radialGradient>
    <filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="16"/></filter>
    <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="2.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="coast" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="10" flood-color="#031017" flood-opacity="0.85"/>
    </filter>
  </defs>`;

  el(svg, 'rect', { x: 0, y: 0, width: 1120, height: 830, fill: 'url(#sea)' });
  for (const [x, y, r] of [[95, 120, 26], [1035, 700, 30], [80, 700, 20], [1060, 110, 22]]) {
    el(svg, 'circle', { cx: x, cy: y, r, fill: 'none', stroke: '#bfe3ef', opacity: .07, 'stroke-width': 1.5 });
    el(svg, 'circle', { cx: x, cy: y, r: r * 0.55, fill: 'none', stroke: '#bfe3ef', opacity: .07, 'stroke-width': 1.5 });
  }
  el(svg, 'text', { x: 70, y: 775, class: 'sealabel', 'font-size': 18 }).textContent = 'THE SUNDERED SEA';

  const COASTW = [1.16, 1.10, 1.20, 1.09, 1.17, 1.12, 1.22, 1.10, 1.15, 1.19, 1.09, 1.16, 1.05, 1.00, 1.03, 1.12, 1.13, 1.18];
  const coastPts = COASTW.map((w, i) => {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / COASTW.length;
    return [CX + RX * w * Math.cos(a), CY + (RY + 26) * w * Math.sin(a)];
  });
  const coastD = smoothPath(coastPts);
  el(svg, 'path', { d: coastD, fill: '#d8c68f', filter: 'url(#coast)' });
  const landG = el(svg, 'g', { transform: `translate(${CX} ${CY}) scale(0.985) translate(${-CX} ${-CY})` });
  el(landG, 'path', { d: coastD, fill: 'url(#land)' });

  for (const id of ['gull', 'tavern', 'cove']) {
    const p = POS[id];
    el(svg, 'ellipse', { cx: p.x, cy: p.y + 4, rx: 40, ry: 26, fill: '#d8c68f', filter: 'url(#coast)' });
    el(svg, 'ellipse', { cx: p.x, cy: p.y + 3, rx: 35, ry: 22, fill: 'url(#land)' });
  }

  for (const r of REGION_LABELS) {
    const [a, b] = r.ids.map(id => POS[id]);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    const region = node(r.ids[0]).region!;
    el(svg, 'ellipse', {
      cx: mx, cy: my, rx: 118, ry: 64, fill: REGION_COLORS[region], opacity: .30,
      filter: 'url(#soft)', transform: `rotate(${ang} ${mx} ${my})`,
    });
    const d = Math.hypot(mx - CX, my - CY);
    const px = mx + (mx - CX) / d * r.push * -1.9, py = my + (my - CY) / d * r.push * -1.9;
    const rot = Math.max(-24, Math.min(24, ang > 90 ? ang - 180 : (ang < -90 ? ang + 180 : ang)));
    el(svg, 'text', {
      x: px, y: py, class: 'rlabel', 'font-size': 15, 'text-anchor': 'middle',
      transform: `rotate(${rot} ${px} ${py})`,
    }).textContent = r.label;
  }

  const deco = (id: string, x: number, y: number, s: number, op: number, fill: string) =>
    el(svg, 'use', { href: '#' + id, width: 24, height: 24, fill, opacity: op, transform: `translate(${x} ${y}) scale(${s})` });
  [[480, 330], [565, 300], [420, 370], [640, 330], [720, 300], [600, 180], [680, 205], [520, 170]]
    .forEach(([x, y], i) => deco('i-mtn', x, y, 1.15 + (i % 3) * .25, .5, '#5a5142'));
  [[250, 300], [300, 240], [350, 300], [240, 360]].forEach(([x, y], i) => deco('i-pine', x, y, .95 + (i % 2) * .3, .55, '#2e5c38'));
  [[860, 690], [420, 600], [660, 560]].forEach(([x, y]) => deco('i-pine', x, y, .8, .35, '#3a5a34'));
  deco('i-ship', 940, 660, 1.15, .5, '#bfe3ef');

  // trails
  const SEAIDS = new Set(['gull', 'tavern', 'cove']);
  const PASSIDS = new Set(['rockfall', 'delve', 'wyvern', 'cliff']);
  const STYLES = {
    land: { under: 'rgba(15,10,4,.38)', over: '#f7ead0', dash: '0.1 9', w: 2.6 },
    pass: { under: 'rgba(15,10,4,.30)', over: '#d8c0a0', dash: '0.1 11', w: 2.2 },
    spur: { under: 'rgba(15,10,4,.30)', over: '#a89ab5', dash: '0.1 10', w: 2 },
    sea: { under: 'rgba(3,16,23,.5)', over: '#8fd0e8', dash: '0.1 11', w: 2.2 },
  };
  const edges: Array<{ a: NodeId; b: NodeId; kind: keyof typeof STYLES }> = [];
  for (const n of BOARD.values()) {
    for (const to of n.out) {
      const kind = SEAIDS.has(to) || SEAIDS.has(n.id) ? 'sea'
        : PASSIDS.has(to) || PASSIDS.has(n.id) ? 'pass' : 'land';
      edges.push({ a: n.id, b: to, kind });
    }
  }
  edges.push({ a: 'delve', b: 'dungeon', kind: 'spur' });
  edges.forEach((e, i) => {
    const s = STYLES[e.kind];
    const A = POS[e.a], B = POS[e.b];
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    const bow = (i % 2 ? 1 : -1) * Math.min(16, len * 0.10);
    const cx2 = mx - dy / len * bow, cy2 = my + dx / len * bow;
    const d = `M ${A.x} ${A.y} Q ${cx2} ${cy2} ${B.x} ${B.y}`;
    el(svg, 'path', { d, fill: 'none', stroke: s.under, 'stroke-width': s.w + 2.6, 'stroke-linecap': 'round' });
    el(svg, 'path', { d, fill: 'none', stroke: s.over, 'stroke-width': s.w, 'stroke-dasharray': s.dash, 'stroke-linecap': 'round' });
  });

  // node markers + labels
  for (const n of BOARD.values()) {
    const p = POS[n.id];
    const r = nodeRadius(n.id);
    const g = el(svg, 'g', { 'data-node': n.id, class: 'nodeg' });
    if (n.type === 'trail') {
      el(g, 'circle', { cx: p.x, cy: p.y, r, fill: NODEFILL.trail, stroke: '#0d1117', 'stroke-width': 1.6, opacity: .9 });
    } else {
      const fill = n.type === 'prop' ? REGION_COLORS[n.region!] : NODEFILL[n.type];
      el(g, 'circle', { cx: p.x, cy: p.y, r, fill, stroke: '#0d1117', 'stroke-width': 2.2 });
      el(g, 'circle', { cx: p.x, cy: p.y - r * 0.34, r: r * 0.55, fill: '#ffffff', opacity: .16 });
      if (NODEICON[n.type]) {
        const s = n.type === 'capital' ? 22 : 14;
        el(g, 'use', {
          href: '#' + NODEICON[n.type], x: p.x - s / 2, y: p.y - s / 2, width: s, height: s,
          fill: n.type === 'fate' ? '#d9c2ff' : (n.type === 'capital' ? '#4a3208' : '#0d1117'),
        });
      }
      if (node(n.id).out.length > 1) {
        el(g, 'circle', { cx: p.x, cy: p.y, r: r + 8, fill: 'none', stroke: '#f7ead0', 'stroke-width': 1, 'stroke-dasharray': '2 5', opacity: .7 });
      }
      // labels
      let lx: number, ly: number, anchor: string;
      if (p.out !== undefined) {
        const ox = Math.cos(p.out), oy = Math.sin(p.out);
        lx = p.x + ox * (r + 9); ly = p.y + oy * (r + 11) + 4;
        anchor = ox > 0.45 ? 'start' : (ox < -0.45 ? 'end' : 'middle');
        if (anchor === 'middle') ly = p.y + (oy > 0 ? r + 18 : -(r + 10));
      } else {
        lx = p.x; ly = p.y - (r + (['gull', 'tavern', 'cove'].includes(n.id) ? 16 : 10));
        anchor = 'middle';
      }
      el(g, 'text', { x: lx, y: ly, class: 'nlabel', 'text-anchor': anchor }).textContent = n.name.toUpperCase();
      const sub = n.price ? n.price + 'g'
        : n.id === 'crossroads' ? 'collect 150g'
        : n.id === 'levy' ? 'pay 100g'
        : n.id === 'tavern' ? 'free Quest' : '';
      if (sub) el(g, 'text', { x: lx, y: ly + 11, class: 'nprice', 'text-anchor': anchor }).textContent = sub;
    }
    if (state_clickable(n.id)) {
      (g as unknown as HTMLElement).style.cursor = 'pointer';
      g.addEventListener('click', () => onNodeClick(n.id));
    }
  }

  el(svg, 'text', { x: 36, y: 56, class: 'maptitle', 'font-size': 26 }).textContent = 'REALMS OF FORTUNE';
  el(svg, 'use', { href: '#i-compass', x: 34, y: 718, width: 64, height: 64, fill: '#e8c96a', opacity: .75, filter: 'url(#glow)' });
  el(svg, 'text', { x: 545, y: 472, class: 'mapsub', 'font-size': 12, 'text-anchor': 'middle', opacity: .85 }).textContent = '⟵ the Ironvein Pass ⟶';
  el(svg, 'text', { x: 1030, y: 326, class: 'mapsub', 'font-size': 12, 'text-anchor': 'middle', opacity: .85 }).textContent = 'the Underway';

  return {
    dyn: el(svg, 'g', { id: 'dyn' }) as SVGGElement,
    tokens: el(svg, 'g', { id: 'tokens' }) as SVGGElement,
    hints: el(svg, 'g', { id: 'hints' }) as SVGGElement,
    fx: el(svg, 'g', { id: 'fx', style: 'pointer-events:none' }) as SVGGElement,
  };
}

/**
 * Ring each landing node and pin its option badge on the side away from the node's label:
 * inland of coastal nodes (whose labels face the sea), left of inland ones (labelled above).
 * Badges sharing a node stack downward.
 */
export function drawHints(layer: SVGGElement, landings: Landing[], onPick: (key: string) => void) {
  layer.innerHTML = '';
  const perNode = new Map<NodeId, number>();
  for (const l of landings) {
    const p = POS[l.end];
    const r = nodeRadius(l.end);
    const n = perNode.get(l.end) ?? 0;
    perNode.set(l.end, n + 1);
    const g = el(layer, 'g', { class: `hint ${l.tone}`, 'data-opt': l.key });
    if (n === 0) el(g, 'circle', { cx: p.x, cy: p.y, r: r + 7, class: 'hint-ring' });
    const [dx, dy] = p.out !== undefined ? [-Math.cos(p.out), -Math.sin(p.out)] : [-1, 0];
    const bx = p.x + dx * (r + 16), by = p.y + dy * (r + 16) + n * 22;
    el(g, 'circle', { cx: bx, cy: by, r: 10, class: 'hint-badge' });
    el(g, 'text', { x: bx, y: by + 4, 'text-anchor': 'middle', class: 'hint-num' }).textContent = l.badge;
    g.addEventListener('click', () => onPick(l.key));
  }
}

/** Expanding ring plus a rising label over a node. */
export function pingNode(fx: SVGGElement, id: NodeId, color: string, label: string) {
  const p = POS[id];
  const r = nodeRadius(id);
  const ring = el(fx, 'circle', {
    cx: p.x, cy: p.y, r: r + 4, fill: 'none', stroke: color, 'stroke-width': 3, class: 'ping-ring',
  });
  const text = el(fx, 'text', {
    x: p.x, y: p.y - r - 22, 'text-anchor': 'middle', class: 'ping-label', fill: color,
  });
  text.textContent = label;
  setTimeout(() => { ring.remove(); text.remove(); }, 1700);
}

/** Small rising text at a node (e.g. "+150g" as a token walks through the Crossroads). */
export function floatAtNode(fx: SVGGElement, id: NodeId, text: string, color: string) {
  const p = POS[id];
  const t = el(fx, 'text', {
    x: p.x, y: p.y - nodeRadius(id) - 8, 'text-anchor': 'middle', class: 'map-float', fill: color,
  });
  t.textContent = text;
  setTimeout(() => t.remove(), 1400);
}

function state_clickable(id: NodeId): boolean {
  const t = node(id).type;
  return t === 'prop' || t === 'way' || t === 'mana';
}

/** Redraw the dynamic layer: ownership rings, upgrades, markers, tokens. */
export function updateMap(dyn: SVGGElement, state: GameState) {
  dyn.innerHTML = '';
  for (const [id, o] of Object.entries(state.ownership)) {
    const p = POS[id];
    const r = nodeRadius(id);
    if (o.owner !== null) {
      el(dyn, 'circle', {
        cx: p.x, cy: p.y, r: r + 4.5, fill: 'none',
        stroke: SEAT_COLORS[o.owner], 'stroke-width': 2.6, filter: 'url(#glow)',
        opacity: o.mortgaged ? 0.45 : 1,
      });
    }
    if (o.mortgaged) {
      el(dyn, 'line', {
        x1: p.x - r, y1: p.y + r, x2: p.x + r, y2: p.y - r,
        stroke: '#0d1117', 'stroke-width': 3, opacity: .8,
      });
    }
    if (o.cursed) {
      el(dyn, 'text', {
        x: p.x - r - 4, y: p.y - r + 2, 'font-size': 12, fill: '#c9aef5',
        'text-anchor': 'end', class: 'cursemark',
      }).textContent = '☠';
    }
    if (o.upgrades.length) {
      const w = 12;
      o.upgrades.forEach((up, j) => {
        const x0 = p.x - (o.upgrades.length * w + (o.upgrades.length - 1)) / 2 + j * (w + 1);
        const icon = up.kind === 'settlement' ? 'i-settle' : up.kind === 'enchant' ? 'i-star' : 'i-shield';
        el(dyn, 'use', { href: '#' + icon, x: x0, y: p.y - r - 16, width: w, height: w, fill: '#f7ead0', filter: 'url(#glow)' });
      });
    }
  }
}

export { el, garrison, hasEnchant, own, settlementTiers, SEAT_COLORS };
