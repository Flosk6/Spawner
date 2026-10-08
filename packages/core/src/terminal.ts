/**
 * Longest terminal-input event, in UTF-16 code units: clients split what is
 * typed or pasted into pieces this long at most, and the terminal gateway
 * ignores longer ones. Once JSON-escaped, a code unit takes 6 bytes at most
 * (a control character becomes \u00XX), so a piece stays under 25 KiB.
 */
export const TERMINAL_INPUT_CHUNK = 4096;

/**
 * Splits terminal input (a large paste) into pieces of at most `size` UTF-16
 * code units, in order, never between the two halves of a surrogate pair.
 */
export function chunkTerminalInput(input: string, size: number = TERMINAL_INPUT_CHUNK): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < input.length) {
    let end = Math.min(start + size, input.length);
    if (end - start > 1 && isHighSurrogate(input.charCodeAt(end - 1)) && isLowSurrogate(input.charCodeAt(end))) {
      end -= 1;
    }
    chunks.push(input.slice(start, end));
    start = end;
  }
  return chunks;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
