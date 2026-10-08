import { describe, expect, it } from 'vitest';
import { TERMINAL_INPUT_CHUNK, chunkTerminalInput } from './terminal';

/** A string with a lone surrogate comes back from UTF-8 with U+FFFD in its place. */
function survivesUtf8(text: string): boolean {
  return Buffer.from(text, 'utf8').toString('utf8') === text;
}

describe('chunkTerminalInput', () => {
  it('keeps keystrokes and short pastes in one piece', () => {
    expect(chunkTerminalInput('ls -la\r')).toEqual(['ls -la\r']);
    expect(chunkTerminalInput('x'.repeat(TERMINAL_INPUT_CHUNK))).toHaveLength(1);
    expect(chunkTerminalInput('')).toEqual([]);
  });

  it('splits a large paste into pieces of the size, in order', () => {
    const paste = Array.from({ length: 3000 }, (_, line) => `echo line ${line}\n`).join('');
    const chunks = chunkTerminalInput(paste);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= TERMINAL_INPUT_CHUNK)).toBe(true);
    expect(chunks.slice(0, -1).every((chunk) => chunk.length === TERMINAL_INPUT_CHUNK)).toBe(true);
    expect(chunks.join('')).toBe(paste);
  });

  it('never separates the halves of a surrogate pair', () => {
    const input = `ab${'\u{20BB7}'.repeat(5)}`;
    const chunks = chunkTerminalInput(input, 3);
    expect(chunks).toEqual(['ab', '\u{20BB7}', '\u{20BB7}', '\u{20BB7}', '\u{20BB7}', '\u{20BB7}']);
    expect(chunks.every(survivesUtf8)).toBe(true);

    const shifted = `$${'\u{20BB7}'.repeat(10_000)}`;
    const pieces = chunkTerminalInput(shifted);
    expect(pieces[0]).toHaveLength(TERMINAL_INPUT_CHUNK - 1);
    expect(pieces.every((chunk) => chunk.length <= TERMINAL_INPUT_CHUNK && survivesUtf8(chunk))).toBe(true);
    expect(pieces.join('')).toBe(shifted);
  });

  it('cuts lone surrogates like any other code unit', () => {
    expect(chunkTerminalInput('a\ud800b\udc00', 2)).toEqual(['a\ud800', 'b\udc00']);
  });

  it('keeps a piece under 25 KiB once JSON-escaped, whatever it holds', () => {
    const worst = '\u0001'.repeat(TERMINAL_INPUT_CHUNK);
    expect(Buffer.byteLength(JSON.stringify(worst))).toBeLessThan(25 * 1024);
    const wide = '\u{20BB7}'.repeat(TERMINAL_INPUT_CHUNK / 2);
    expect(Buffer.byteLength(JSON.stringify(wide))).toBeLessThan(25 * 1024);
  });
});
