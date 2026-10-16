// Player tokens as persistent SVG groups that can be walked hop-by-hop or teleported.

import type { NodeId, Player, PlayerId } from '../engine/types';
import { el, nodeRadius, POS } from './map';
import { SEAT_COLORS } from './theme';

export interface XY { x: number; y: number }

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Drive `frame(t)` from 0 to 1 over `ms`. A timer backstop finishes the tween even when
 * requestAnimationFrame is throttled (background tab), so the game never stalls mid-move.
 */
export function tween(ms: number, frame: (t: number) => void): Promise<void> {
  return new Promise(resolve => {
    if (ms <= 0) { frame(1); resolve(); return; }
    const start = performance.now();
    let done = false;
    const finish = () => { if (done) return; done = true; frame(1); resolve(); };
    const tick = (now: number) => {
      if (done) return;
      const t = Math.min(1, (now - start) / ms);
      if (t >= 1) return finish();
      frame(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(finish, ms + 120);
  });
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class TokenLayer {
  private els: SVGGElement[] = [];
  private pulses: SVGElement[] = [];
  private at: XY[] = [];

  constructor(private layer: SVGGElement, players: Player[]) {
    layer.innerHTML = '';
    for (const p of players) {
      const g = el(layer, 'g', { class: 'token' }) as SVGGElement;
      const pulse = el(g, 'circle', {
        r: 12, fill: 'none', stroke: SEAT_COLORS[p.id], 'stroke-width': 1.5, class: 'pulse',
      });
      el(g, 'circle', { r: 8, fill: SEAT_COLORS[p.id], stroke: '#f0e6cc', 'stroke-width': 1.6, filter: 'url(#glow)' });
      el(g, 'text', {
        y: 3.2, 'text-anchor': 'middle', 'font-size': 8.5, 'font-weight': 700,
        fill: '#fdf6e3', style: 'font-family:Cinzel,serif',
      }).textContent = p.name[0];
      this.els.push(g);
      this.pulses.push(pulse);
      this.at.push({ x: 0, y: 0 });
    }
  }

  /** Where a token rests on `node`, fanned out among the living tokens sharing it. */
  static rest(positions: NodeId[], alive: boolean[], pid: PlayerId): XY {
    const nodeId = positions[pid];
    const p = POS[nodeId];
    const r = nodeRadius(nodeId);
    let j = 0;
    for (let other = 0; other < pid; other++) {
      if (alive[other] && positions[other] === nodeId) j++;
    }
    return { x: p.x + r * 0.85 + j * 9, y: p.y + r * 0.85 };
  }

  private set(pid: PlayerId, xy: XY, scale = 1, opacity = 1) {
    this.at[pid] = xy;
    const g = this.els[pid];
    g.setAttribute('transform', `translate(${xy.x} ${xy.y}) scale(${scale})`);
    g.style.opacity = String(opacity);
  }

  /** Snap every token to its resting spot. */
  place(positions: NodeId[], alive: boolean[], current: PlayerId | null) {
    for (let pid = 0; pid < this.els.length; pid++) {
      this.els[pid].style.display = alive[pid] ? '' : 'none';
      this.pulses[pid].style.display = pid === current ? '' : 'none';
      if (alive[pid]) this.set(pid, TokenLayer.rest(positions, alive, pid));
    }
  }

  private raise(pid: PlayerId) {
    this.layer.appendChild(this.els[pid]);
  }

  /** Hop node by node along `path`, landing on `finalXY`. Calls onStep as each node is reached. */
  async walk(pid: PlayerId, path: NodeId[], finalXY: XY, speed: number, onStep?: (id: NodeId) => void) {
    this.raise(pid);
    for (let i = 1; i < path.length; i++) {
      const from = this.at[pid];
      const anchor = POS[path[i]];
      const r = nodeRadius(path[i]);
      const to = i === path.length - 1 ? finalXY : { x: anchor.x + r * 0.85, y: anchor.y + r * 0.85 };
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      const ms = Math.min(320, Math.max(150, 90 + dist * 0.9)) / speed;
      const arc = Math.min(18, 6 + dist * 0.12);
      await tween(ms, t => {
        const e = easeInOut(t);
        const lift = Math.sin(Math.PI * t);
        this.set(pid, { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e - lift * arc }, 1 + 0.18 * lift);
      });
      onStep?.(path[i]);
    }
  }

  /** Fade out, reappear at the destination with a flare. */
  async teleport(pid: PlayerId, finalXY: XY, speed: number) {
    this.raise(pid);
    const from = this.at[pid];
    await tween(220 / speed, t => this.set(pid, from, 1 - 0.6 * t, 1 - t));
    await tween(260 / speed, t => this.set(pid, finalXY, 1.7 - 0.7 * t, t));
  }
}
