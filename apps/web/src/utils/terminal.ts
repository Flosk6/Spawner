/**
 * Longest terminal-input event the API accepts, in UTF-16 code units: under
 * 25 KiB once JSON-escaped, within its 64 KiB message limit. The same as
 * TERMINAL_INPUT_CHUNK of @spawner/core, which the interface does not use.
 */
export const TERMINAL_INPUT_CHUNK = 4096;

/**
 * Splits terminal input (a large paste) into pieces of at most `size` UTF-16
 * code units, in order, never between the two halves of a surrogate pair.
 * A copy of chunkTerminalInput of @spawner/core, where it is tested.
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
