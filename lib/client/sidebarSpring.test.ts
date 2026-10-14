import { describe, expect, it } from 'vitest';
import { stepSidebarSpring, type SpringState } from './sidebarSpring';

describe('sidebar spring', () => {
  it.each([0, 1])('has the same trajectory at different frame rates toward %s', (target) => {
    const start = { position: 0.3, velocity: 2 };
    let frames: SpringState = start;
    for (let i = 0; i < 60; i++) frames = stepSidebarSpring(frames, target, 1 / 120);
    const direct = stepSidebarSpring(start, target, 0.5);
    expect(frames.position).toBeCloseTo(direct.position, 10);
    expect(frames.velocity).toBeCloseTo(direct.velocity, 10);
    expect(Math.abs(frames.position - target)).toBeLessThan(0.001);
  });

  it('preserves momentum on a quick reversal and then settles at the new target', () => {
    const reversed = stepSidebarSpring({ position: 0.2, velocity: 5 }, 0, 1 / 60);
    expect(reversed.position).toBeGreaterThan(0.2);
    expect(reversed.position).toBeLessThan(0.3);
    const settled = stepSidebarSpring(reversed, 0, 0.5);
    expect(settled.position).toBeCloseTo(0, 4);
    expect(Math.abs(settled.velocity)).toBeLessThan(0.001);
  });
});
