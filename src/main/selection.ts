import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { clipboard } from 'electron';

const REQUEST_TIMEOUT_MS = 1500;
/** how long to wait for the foreground app to service a synthesized Cmd+C —
 * the pasteboard write lands asynchronously after the key event */
const COPY_POLL_STEP_MS = 50;
const COPY_POLL_MS = 400;
/** cap captured text — the store rewrites the whole file on every mutation */
const MAX_CAPTURE_CHARS = 10_000;
/** a helper that dies repeatedly is broken, not unlucky: stop after this many
 * consecutive restarts so we don't spawn a process forever */
const MAX_RESPAWNS = 3;
const RESPAWN_DELAY_MS = 500;

/**
 * Client for the per-platform selection helper (SelectionHelper.exe / SelectionHelper).
 * Line protocol on stdio: CAPTURE → "OK <base64>" | "ERR <reason>"; COPYKEY → "OK".
 */
export class SelectionCapturer {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending: ((line: string) => void)[] = [];
  private buf = '';
  /** consecutive unexpected exits we have already restarted from */
  private respawns = 0;
  /** set by stop(): the exit that follows is ours, not a crash */
  private intentionalStop = false;

  constructor(
    private helperPath: string,
    /** injectable for tests; production always uses child_process.spawn */
    private spawnFn: typeof spawn = spawn,
    /** injectable for tests; production always uses process.platform */
    private platform: NodeJS.Platform = process.platform,
  ) {}

  start(): void {
    this.intentionalStop = false;
    this.proc = this.spawnFn(this.helperPath, [], { windowsHide: true });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => {
      this.buf += chunk;
      let nl: number;
      while ((nl = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf
          .slice(0, nl)
          .replace(/\r$/, '') // C# writes \r\n
          .replace(/^\uFEFF/, ''); // a BOM-emitting stdout encoding would poison "OK "
        this.buf = this.buf.slice(nl + 1);
        // the helper answered: whatever went wrong before, it is healthy now
        if (!line.startsWith('ERR')) this.respawns = 0;
        this.pending.shift()?.(line);
      }
    });
    // helper faults must be visible, and an unread stderr pipe would apply
    // backpressure if the runtime ever wrote diagnostics to it
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk: string) => console.error('helper stderr:', chunk));
    // a write to a dying helper's stdin errors before 'exit' is delivered;
    // without a listener that becomes an unowned uncaught exception
    this.proc.stdin.on('error', (err) => console.error('helper stdin error', err));
    this.proc.on('error', (err) => {
      // spawn failure (missing/blocked binary) must not go unhandled
      console.error('selection helper failed to start', err);
      this.proc = null;
      this.buf = '';
      this.pending.splice(0).forEach((r) => r('ERR helper-spawn-failed'));
    });
    this.proc.on('exit', () => {
      this.proc = null;
      this.buf = ''; // a partial line must not corrupt a future start()
      // flush waiters so callers don't hang
      this.pending.splice(0).forEach((r) => r('ERR helper-exited'));
      // a crashed helper leaves capture dead for the rest of the session;
      // bring it back, but never in a hot loop and never after stop()
      if (this.intentionalStop || this.respawns >= MAX_RESPAWNS) return;
      this.respawns++;
      setTimeout(() => {
        if (!this.intentionalStop && !this.proc) this.start();
      }, RESPAWN_DELAY_MS);
    });
  }

  stop(): void {
    this.intentionalStop = true;
    try {
      this.proc?.stdin.write('EXIT\n');
    } catch {
      /* already dead */
    }
    this.proc?.kill();
    this.proc = null;
  }

  private request(cmd: string): Promise<string> {
    if (!this.proc) return Promise.resolve('ERR helper-not-running');
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // the helper is a serial read loop: its reply is still coming. Replace
        // the handler with a tombstone that swallows the late line in place —
        // splicing it out would misdeliver the reply to the NEXT request.
        const i = this.pending.indexOf(handler);
        if (i !== -1) this.pending[i] = () => {};
        resolve('ERR timeout');
      }, REQUEST_TIMEOUT_MS);
      const handler = (line: string) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.pending.push(handler);
      try {
        this.proc!.stdin.write(cmd + '\n');
      } catch (err) {
        console.error('helper write failed', err);
      }
    });
  }

  /**
   * Ask the helper to hand OS foreground to `hwnd` (Windows only). Electron's
   * own show()/focus() can't: Windows denies foreground to a process that
   * didn't receive the last input event, which a global hotkey never does.
   * Returns false if the helper is missing, errored, or the grab was refused.
   */
  async forceForeground(hwnd: string): Promise<boolean> {
    const res = await this.request(`FOREGROUND ${hwnd}`);
    if (res !== 'OK') console.error('foreground grab failed:', res);
    return res === 'OK';
  }

  /**
   * Returns the selected text of the focused foreign app, tagged with where it
   * came from, or null. `from: 'selection'` is a real selection read via the
   * native accessibility API (UIA TextPattern / AXSelectedText) — unambiguous
   * user intent. `from: 'clipboard'` is the fallback — text the user copied at
   * some earlier point, which callers should treat as a guess, not a command.
   */
  async capture(opts?: {
    /** fires the moment the synthesized copy chord has been posted — from
     * here on the capture no longer depends on the foreign app keeping
     * focus, so the caller can show UI without waiting for the clipboard
     * poll to run its full budget */
    onCopyPosted?: () => void;
  }): Promise<{ text: string; from: 'selection' | 'clipboard' } | null> {
    const res = await this.request('CAPTURE');
    if (res.startsWith('OK ')) {
      const text = Buffer.from(res.slice(3), 'base64').toString('utf8').slice(0, MAX_CAPTURE_CHARS);
      if (text.trim()) return { text, from: 'selection' };
    }

    // No AX-readable selection. Selections that never reach the accessibility
    // tree — above all xterm.js terminals (VS Code, Hyper) — are still
    // reachable by asking the app itself to copy. On macOS the copy chord is
    // Cmd+C, which never doubles as interrupt the way Ctrl+C does in
    // terminals, so synthesizing it is safe there (and only there).
    if (this.platform === 'darwin') {
      const copied = await this.captureViaCopy(opts?.onCopyPosted);
      if (copied !== null) return { text: copied, from: 'selection' };
    }

    // Last resort: whatever the user already copied at some earlier point.
    // Read-only — never clear, never overwrite.
    const text = clipboard.readText().slice(0, MAX_CAPTURE_CHARS);
    return text.trim() ? { text, from: 'clipboard' } : null;
  }

  /**
   * Synthesize Cmd+C into the foreground app, read what appears on the
   * clipboard, and put the previous contents back (text, HTML and RTF
   * flavors). Returns null when nothing new was copied. Skipped entirely
   * when the clipboard holds a flavor we could not restore afterwards — an
   * image or a file list.
   */
  private async captureViaCopy(onCopyPosted?: () => void): Promise<string | null> {
    if (!this.proc) return null;
    const restorable = clipboard
      .availableFormats()
      .every((f) => f === 'text/plain' || f === 'text/html' || f === 'text/rtf');
    if (!restorable) return null;
    const prev = {
      text: clipboard.readText(),
      html: clipboard.readHTML(),
      rtf: clipboard.readRTF(),
    };
    // an unchanged clipboard must not read back as a fresh copy
    clipboard.clear();
    try {
      if ((await this.request('COPYKEY')) !== 'OK') return null;
      // the chord is in the HID stream: focus changes can no longer hurt it
      onCopyPosted?.();
      for (let waited = 0; waited < COPY_POLL_MS; waited += COPY_POLL_STEP_MS) {
        await new Promise((r) => setTimeout(r, COPY_POLL_STEP_MS));
        const text = clipboard.readText();
        if (text.trim()) return text.slice(0, MAX_CAPTURE_CHARS);
      }
      return null;
    } finally {
      // capture must not clobber the user's clipboard, whether it worked or not
      clipboard.clear();
      const flavors: { text?: string; html?: string; rtf?: string } = {};
      if (prev.text) flavors.text = prev.text;
      if (prev.html) flavors.html = prev.html;
      if (prev.rtf) flavors.rtf = prev.rtf;
      if (Object.keys(flavors).length > 0) clipboard.write(flavors);
    }
  }
}
