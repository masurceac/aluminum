import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';

// selection.ts imports electron's clipboard at module load; the test runs in
// plain node, so stub the whole module with spies we can assert on
vi.mock('electron', () => ({
  clipboard: {
    readText: vi.fn(() => ''),
    readHTML: vi.fn(() => ''),
    readRTF: vi.fn(() => ''),
    writeText: vi.fn(),
    write: vi.fn(),
    clear: vi.fn(),
    availableFormats: vi.fn(() => [] as string[]),
  },
}));

import { clipboard } from 'electron';
import { SelectionCapturer } from '../src/main/selection';

/** stand-in for the helper child process: only what SelectionCapturer touches */
class FakeProc extends EventEmitter {
  stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  stdin = { write: vi.fn(), on: vi.fn() };
  kill = vi.fn();
}

let procs: FakeProc[];
let spawnFn: ReturnType<typeof vi.fn>;

/** the process the capturer is currently talking to */
function proc(): FakeProc {
  return procs[procs.length - 1];
}

/** deliver raw stdout bytes to the capturer */
function say(chunk: string): void {
  proc().stdout.emit('data', chunk);
}

function makeCapturer(): SelectionCapturer {
  const cap = new SelectionCapturer('helper.exe', spawnFn as unknown as typeof spawn);
  cap.start();
  return cap;
}

/** the request/response layer is private; the tests drive it directly */
function request(cap: SelectionCapturer, cmd: string): Promise<string> {
  return (cap as unknown as { request(c: string): Promise<string> }).request(cmd);
}

beforeEach(() => {
  vi.useFakeTimers();
  procs = [];
  spawnFn = vi.fn(() => {
    const p = new FakeProc();
    procs.push(p);
    return p as unknown as ChildProcessWithoutNullStreams;
  });
  vi.mocked(clipboard.availableFormats).mockReturnValue([]);
  vi.mocked(clipboard.readText).mockReturnValue('');
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('SelectionCapturer line protocol', () => {
  it('pairs each reply with the request that asked for it', async () => {
    const cap = makeCapturer();
    const first = request(cap, 'CAPTURE');
    const second = request(cap, 'CAPTURE');

    say('OK one\nOK two\n');

    expect(await first).toBe('OK one');
    expect(await second).toBe('OK two');
    expect(proc().stdin.write).toHaveBeenNthCalledWith(1, 'CAPTURE\n');
    expect(proc().stdin.write).toHaveBeenNthCalledWith(2, 'CAPTURE\n');
  });

  it('reassembles a reply split across two stdout chunks', async () => {
    const cap = makeCapturer();
    const p = request(cap, 'CAPTURE');

    say('OK aGVs');
    say('bG8=\n');

    expect(await p).toBe('OK aGVsbG8=');
  });

  it('strips the \\r of a \\r\\n line ending', async () => {
    const cap = makeCapturer();
    const p = request(cap, 'COPYKEY');

    say('OK\r\n');

    expect(await p).toBe('OK');
  });

  it('strips a leading BOM', async () => {
    const cap = makeCapturer();
    const p = request(cap, 'COPYKEY');

    say('\uFEFFOK\r\n');

    expect(await p).toBe('OK');
  });

  it('never misdelivers a timed-out request’s late reply', async () => {
    const cap = makeCapturer();
    const timedOut = request(cap, 'CAPTURE');

    await vi.advanceTimersByTimeAsync(1500);
    expect(await timedOut).toBe('ERR timeout');

    // the helper is a serial read loop: its answer arrives after we gave up
    say('OK late\n');

    const next = request(cap, 'CAPTURE');
    say('OK mine\n');
    expect(await next).toBe('OK mine');
  });

  it('flushes pending requests when the helper exits', async () => {
    const cap = makeCapturer();
    const p = request(cap, 'CAPTURE');

    proc().emit('exit');

    expect(await p).toBe('ERR helper-exited');
    cap.stop();
  });
});

describe('SelectionCapturer.capture', () => {
  it('decodes an OK <base64> reply', async () => {
    const cap = makeCapturer();
    const p = cap.capture();

    say(`OK ${Buffer.from('hello', 'utf8').toString('base64')}\n`);

    expect(await p).toBe('hello');
    expect(clipboard.clear).not.toHaveBeenCalled();
  });

  it('falls back to the current clipboard when there is no selection', async () => {
    vi.mocked(clipboard.readText).mockReturnValue('already copied');
    const cap = makeCapturer();
    const p = cap.capture();

    say('ERR no-selection\n');

    expect(await p).toBe('already copied');
    // the fallback only reads: never synthesize a copy, never clear the clipboard
    expect(clipboard.clear).not.toHaveBeenCalled();
    expect(clipboard.write).not.toHaveBeenCalled();
    expect(proc().stdin.write).not.toHaveBeenCalledWith('COPYKEY\n');
    cap.stop();
  });

  it('returns null when neither the selection nor the clipboard has text', async () => {
    vi.mocked(clipboard.readText).mockReturnValue('   ');
    const cap = makeCapturer();
    const p = cap.capture();

    say('ERR no-selection\n');

    expect(await p).toBeNull();
    cap.stop();
  });

  it('falls back to the clipboard when the helper is gone', async () => {
    vi.mocked(clipboard.readText).mockReturnValue('already copied');
    const cap = makeCapturer();
    const p = cap.capture();

    proc().emit('exit'); // resolves the pending CAPTURE with ERR helper-exited

    expect(await p).toBe('already copied');
    expect(clipboard.clear).not.toHaveBeenCalled();
    cap.stop();
  });
});

describe('SelectionCapturer.forceForeground', () => {
  it('sends the hwnd and reports success', async () => {
    const cap = makeCapturer();
    const p = cap.forceForeground('12345');

    expect(proc().stdin.write).toHaveBeenCalledWith('FOREGROUND 12345\n');
    say('OK\n');
    expect(await p).toBe(true);
    cap.stop();
  });

  it('reports failure when the OS refuses the grab', async () => {
    const cap = makeCapturer();
    const p = cap.forceForeground('12345');

    say('ERR not-foreground\n');
    expect(await p).toBe(false);
    cap.stop();
  });
});

describe('SelectionCapturer respawn', () => {
  it('restarts the helper after an unexpected exit', async () => {
    const cap = makeCapturer();
    expect(spawnFn).toHaveBeenCalledTimes(1);

    proc().emit('exit');
    expect(spawnFn).toHaveBeenCalledTimes(1); // not synchronously

    await vi.advanceTimersByTimeAsync(500);
    expect(spawnFn).toHaveBeenCalledTimes(2);
    cap.stop();
  });

  it('gives up after three consecutive restarts', async () => {
    const cap = makeCapturer();

    for (let i = 0; i < 5; i++) {
      proc().emit('exit');
      await vi.advanceTimersByTimeAsync(500);
    }

    expect(spawnFn).toHaveBeenCalledTimes(1 + 3);
    cap.stop();
  });

  it('re-arms the restart budget after a healthy reply', async () => {
    const cap = makeCapturer();

    for (let i = 0; i < 3; i++) {
      proc().emit('exit');
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(spawnFn).toHaveBeenCalledTimes(4);

    const p = request(cap, 'CAPTURE');
    say('OK \n');
    await p;

    proc().emit('exit');
    await vi.advanceTimersByTimeAsync(500);
    expect(spawnFn).toHaveBeenCalledTimes(5);
    cap.stop();
  });

  it('does not restart after stop()', async () => {
    const cap = makeCapturer();
    const dying = proc();

    cap.stop();
    expect(dying.stdin.write).toHaveBeenCalledWith('EXIT\n');
    expect(dying.kill).toHaveBeenCalled();
    dying.emit('exit');

    await vi.advanceTimersByTimeAsync(2000);
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });
});
