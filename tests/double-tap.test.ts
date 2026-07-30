import { describe, it, expect } from 'vitest';
import { DoubleTapDetector } from '../src/main/double-tap';

const SHIFT_L = 42;
const SHIFT_R = 54;
const KEY_A = 30;

function makeDetector() {
  let t = 0;
  const det = new DoubleTapDetector({
    codes: [SHIFT_L, SHIFT_R],
    windowMs: 300,
    now: () => t,
  });
  return { det, tick: (ms: number) => { t += ms; } };
}

describe('DoubleTapDetector', () => {
  it('fires on two clean shift taps within the window', () => {
    const { det, tick } = makeDetector();
    expect(det.keydown(SHIFT_L)).toBe(false);
    det.keyup(SHIFT_L);
    tick(100);
    expect(det.keydown(SHIFT_L)).toBe(true);
  });

  it('does not fire when taps are too slow', () => {
    const { det, tick } = makeDetector();
    det.keydown(SHIFT_L);
    det.keyup(SHIFT_L);
    tick(500);
    expect(det.keydown(SHIFT_L)).toBe(false);
  });

  it('does not fire when another key interleaves (shift used as modifier)', () => {
    const { det, tick } = makeDetector();
    det.keydown(SHIFT_L);
    det.keydown(KEY_A); // Shift+A
    det.keyup(KEY_A);
    det.keyup(SHIFT_L);
    tick(50);
    expect(det.keydown(SHIFT_L)).toBe(false);
  });

  it('does not fire on held-key auto-repeat (keydown repeats, no keyup)', () => {
    const { det, tick } = makeDetector();
    det.keydown(SHIFT_L);
    tick(50);
    expect(det.keydown(SHIFT_L)).toBe(false);
    tick(50);
    expect(det.keydown(SHIFT_L)).toBe(false);
  });

  it('treats left and right shift as the same tap target', () => {
    const { det, tick } = makeDetector();
    det.keydown(SHIFT_L);
    det.keyup(SHIFT_L);
    tick(100);
    expect(det.keydown(SHIFT_R)).toBe(true);
  });

  it('resets after firing (third tap starts a fresh sequence)', () => {
    const { det, tick } = makeDetector();
    det.keydown(SHIFT_L);
    det.keyup(SHIFT_L);
    tick(100);
    expect(det.keydown(SHIFT_L)).toBe(true);
    det.keyup(SHIFT_L);
    tick(100);
    expect(det.keydown(SHIFT_L)).toBe(false); // needs a full new tap first
  });

  it('non-shift keydown alone never fires', () => {
    const { det } = makeDetector();
    expect(det.keydown(KEY_A)).toBe(false);
  });

  it('does not fire when a key is typed between two taps', () => {
    const { det, tick } = makeDetector();
    det.keydown(SHIFT_L);
    det.keyup(SHIFT_L);
    det.keydown(KEY_A);
    det.keyup(KEY_A);
    tick(50);
    expect(det.keydown(SHIFT_L)).toBe(false);
  });

  it('fires at exactly the window boundary', () => {
    const { det, tick } = makeDetector();
    det.keydown(SHIFT_L);
    det.keyup(SHIFT_L);
    tick(300);
    expect(det.keydown(SHIFT_L)).toBe(true);
  });

  it('does not fire just past the window boundary', () => {
    const { det, tick } = makeDetector();
    det.keydown(SHIFT_L);
    det.keyup(SHIFT_L);
    tick(301);
    expect(det.keydown(SHIFT_L)).toBe(false);
  });

  it('does not fire when the other shift is tapped while one is held', () => {
    const { det, tick } = makeDetector();
    det.keydown(SHIFT_L); // held down throughout
    det.keydown(SHIFT_R);
    det.keyup(SHIFT_R);
    tick(50);
    expect(det.keydown(SHIFT_L)).toBe(false);
  });

  it('does not fire after both shifts overlap, regardless of release order', () => {
    const { det, tick } = makeDetector();
    det.keydown(SHIFT_L);
    det.keydown(SHIFT_R); // second shift during the press taints it
    det.keyup(SHIFT_L); // first-pressed released first
    det.keyup(SHIFT_R);
    tick(50);
    expect(det.keydown(SHIFT_R)).toBe(false);
  });

  it('reset() clears an in-progress sequence', () => {
    const { det, tick } = makeDetector();
    det.keydown(SHIFT_L);
    det.keyup(SHIFT_L);
    det.reset();
    tick(100);
    expect(det.keydown(SHIFT_L)).toBe(false);
  });
});
