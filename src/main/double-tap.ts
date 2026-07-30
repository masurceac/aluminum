export interface DoubleTapOptions {
  /** uiohook keycodes that count as the tap key (e.g. left + right shift) */
  codes: number[];
  /** max ms between first tap's keyup and second tap's keydown */
  windowMs: number;
  /** clock injection for tests; defaults to Date.now */
  now?: () => number;
}

/**
 * Detects a double-tap of a (modifier) key from raw keydown/keyup events.
 * A "clean tap" = keydown then keyup with no other key pressed in between.
 * Fires on the keydown of the second clean-tap-started press within windowMs.
 */
export class DoubleTapDetector {
  private codes: Set<number>;
  private windowMs: number;
  private now: () => number;

  /** timestamp of the keyup that completed the last clean tap, or null */
  private lastCleanTapUp: number | null = null;
  /** target key is currently down */
  private isDown = false;
  /** another key was pressed while target key was down */
  private dirty = false;
  /** the current press already fired; its keyup must not seed a new sequence */
  private firedOnThisPress = false;

  constructor(opts: DoubleTapOptions) {
    this.codes = new Set(opts.codes);
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
  }

  /** Feed a keydown. Returns true when the double-tap fires. */
  keydown(code: number): boolean {
    if (!this.codes.has(code)) {
      // some other key: taints an in-progress tap and kills any pending first tap
      if (this.isDown) this.dirty = true;
      this.lastCleanTapUp = null;
      return false;
    }
    if (this.isDown) {
      // auto-repeat while held — ignore
      return false;
    }
    const fired =
      this.lastCleanTapUp !== null &&
      this.now() - this.lastCleanTapUp <= this.windowMs;
    this.isDown = true;
    this.dirty = false;
    this.firedOnThisPress = fired;
    if (fired) {
      this.lastCleanTapUp = null; // consume the sequence
      return true;
    }
    return false;
  }

  /** Feed a keyup. */
  keyup(code: number): void {
    if (!this.codes.has(code)) return;
    if (this.isDown && !this.dirty && !this.firedOnThisPress) {
      this.lastCleanTapUp = this.now();
    } else {
      this.lastCleanTapUp = null;
    }
    this.isDown = false;
    this.dirty = false;
    this.firedOnThisPress = false;
  }
}
