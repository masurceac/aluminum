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
 * Fires on the keydown of the press that follows a clean tap, when it arrives
 * within windowMs of that tap's keyup.
 */
export class DoubleTapDetector {
  private readonly codes: Set<number>;
  private readonly windowMs: number;
  private readonly now: () => number;

  /** timestamp of the keyup that completed the last clean tap, or null */
  private lastCleanTapUp: number | null = null;
  /** which target keycode is currently down, or null */
  private downCode: number | null = null;
  /** another key was pressed while target key was down */
  private sawOtherKey = false;
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
      if (this.downCode !== null) this.sawOtherKey = true;
      this.lastCleanTapUp = null;
      return false;
    }
    if (this.downCode !== null) {
      // a target key is already held: this is either auto-repeat of that key,
      // or the other shift being tapped while it is held — neither can fire,
      // and a second target key during this press means it is not a clean tap
      if (code !== this.downCode) this.sawOtherKey = true;
      return false;
    }
    const fired =
      this.lastCleanTapUp !== null &&
      this.now() - this.lastCleanTapUp <= this.windowMs;
    this.downCode = code;
    this.sawOtherKey = false;
    this.firedOnThisPress = fired;
    this.lastCleanTapUp = null; // pending tap is now either consumed or expired
    return fired;
  }

  /** Feed a keyup. */
  keyup(code: number): void {
    // ignore unmatched/stray keyups so they cannot destroy a pending tap
    if (code !== this.downCode) return;
    if (!this.sawOtherKey && !this.firedOnThisPress) {
      this.lastCleanTapUp = this.now();
    } else {
      this.lastCleanTapUp = null;
    }
    this.downCode = null;
    this.sawOtherKey = false;
    this.firedOnThisPress = false;
  }

  /**
   * Drop all state. Intended consumer: a hook-restart path, if one is ever
   * added — the detector self-heals from missed keyups otherwise. Currently
   * unwired; delete if no restart path materializes.
   */
  reset(): void {
    this.lastCleanTapUp = null;
    this.downCode = null;
    this.sawOtherKey = false;
    this.firedOnThisPress = false;
  }
}
