import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { clipboard } from 'electron';

const REQUEST_TIMEOUT_MS = 1500;
/** synthesized copy needs a beat to land in the clipboard before we read it */
const CLIPBOARD_SETTLE_MS = 200;
/** cap captured text — the store rewrites the whole file on every mutation */
const MAX_CAPTURE_CHARS = 10_000;

/**
 * Client for the per-platform selection helper (SelectionHelper.exe / SelectionHelper).
 * Line protocol on stdio: CAPTURE → "OK <base64>" | "ERR <reason>"; COPYKEY → "OK".
 */
export class SelectionCapturer {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending: ((line: string) => void)[] = [];
  private buf = '';

  constructor(private helperPath: string) {}

  start(): void {
    this.proc = spawn(this.helperPath, [], { windowsHide: true });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => {
      this.buf += chunk;
      let nl: number;
      while ((nl = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, nl).replace(/\r$/, ''); // C# writes \r\n
        this.buf = this.buf.slice(nl + 1);
        this.pending.shift()?.(line);
      }
    });
    this.proc.on('error', (err) => {
      // spawn failure (missing/blocked binary) must not go unhandled
      console.error('selection helper failed to start', err);
      this.proc = null;
      this.pending.splice(0).forEach((r) => r('ERR helper-spawn-failed'));
    });
    this.proc.on('exit', () => {
      this.proc = null;
      // flush waiters so callers don't hang
      this.pending.splice(0).forEach((r) => r('ERR helper-exited'));
    });
  }

  stop(): void {
    this.proc?.stdin.write('EXIT\n');
    this.proc?.kill();
    this.proc = null;
  }

  private request(cmd: string): Promise<string> {
    if (!this.proc) return Promise.resolve('ERR helper-not-running');
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = this.pending.indexOf(handler);
        if (i !== -1) this.pending.splice(i, 1);
        resolve('ERR timeout');
      }, REQUEST_TIMEOUT_MS);
      const handler = (line: string) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.pending.push(handler);
      this.proc!.stdin.write(cmd + '\n');
    });
  }

  /**
   * Returns the selected text of the focused foreign app, or null.
   * Primary: native accessibility API (UIA TextPattern / AXSelectedText).
   * Fallback: synthesized Ctrl+C / Cmd+C + clipboard save/restore, for apps
   * that don't expose a selection to the accessibility tree.
   */
  async capture(): Promise<string | null> {
    const res = await this.request('CAPTURE');
    if (res.startsWith('OK ')) {
      const text = Buffer.from(res.slice(3), 'base64').toString('utf8');
      if (text.trim()) return text.slice(0, MAX_CAPTURE_CHARS);
    }

    // fallback: clipboard trick
    const saved = clipboard.readText();
    clipboard.clear();
    const copyRes = await this.request('COPYKEY');
    if (!copyRes.startsWith('OK')) {
      clipboard.writeText(saved);
      return null;
    }
    await new Promise((r) => setTimeout(r, CLIPBOARD_SETTLE_MS));
    const grabbed = clipboard.readText();
    clipboard.writeText(saved); // restore the user's clipboard
    return grabbed.trim() ? grabbed.slice(0, MAX_CAPTURE_CHARS) : null;
  }
}
