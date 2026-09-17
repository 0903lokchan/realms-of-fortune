import { describe, expect, it } from 'vitest';
import { ALL_NODES, BOARD, distancesFrom, node, PROPERTY_NODES, regionProps, WAYGATES } from '../src/engine/board';

describe('board graph', () => {
  it('has the designed node counts', () => {
    expect(ALL_NODES.length).toBe(35);
    expect(PROPERTY_NODES.length).toBe(16);
    expect(WAYGATES.length).toBe(4);
    expect(ALL_NODES.filter(n => n.type === 'mana').length).toBe(2);
  });

  it('gives every region exactly two properties with ascending prices', () => {
    const regions = ['shire', 'silver', 'wild', 'iron', 'sun', 'mage', 'dragon', 'celest'] as const;
    let last = 0;
    for (const r of regions) {
      const props = regionProps(r);
      expect(props.length).toBe(2);
      const max = Math.max(...props.map(p => p.price!));
      expect(max).toBeGreaterThan(last);
      last = max;
    }
  });

  it('walks the main loop back to the Crossroads in 27 steps', () => {
    let at = 'crossroads';
    for (let i = 0; i < 27; i++) at = node(at).out[0];
    expect(at).toBe('crossroads');
  });

  it('reaches every walkable node from the Crossroads', () => {
    const dist = distancesFrom('crossroads');
    for (const n of ALL_NODES) {
      if (n.id === 'dungeon') continue; // spur: sent, never walked
      expect(dist.has(n.id), n.id).toBe(true);
    }
  });

  it('has exactly two fork nodes (Silver Quay and Sunspire)', () => {
    const forks = ALL_NODES.filter(n => n.out.length > 1).map(n => n.id).sort();
    expect(forks).toEqual(['quay', 'sunspire']);
  });

  it('shortcuts are genuinely shorter', () => {
    const viaLoop = (from: string, to: string, avoid: string) => {
      // walk the loop only
      let at = from, d = 0;
      while (at !== to) { at = node(at).out[0]; d++; if (d > 40) break; }
      void avoid;
      return d;
    };
    const dist = distancesFrom('quay');
    expect(dist.get('rune')!).toBeLessThan(viaLoop('quay', 'rune', ''));
    const dist2 = distancesFrom('sunspire');
    expect(dist2.get('high')!).toBeLessThan(viaLoop('sunspire', 'high', ''));
  });

  it('charges the ferry toll on Gull Rock', () => {
    expect(BOARD.get('gull')!.entryToll).toBe(50);
  });
});
