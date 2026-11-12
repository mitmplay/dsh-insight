/**
 * paste-chunks — the ADR-0061 D3 client-side splitter. Boundaries 0 / 1 /
 * 4095 / 4096 / 4097 / 8192 / 8193; rejoin(chunks) === input; every chunk
 * ≤ cap; order preserved. Exact-cap input is ONE chunk (no empty tail).
 */
import { describe, expect, it } from 'vitest';

import { pasteChunks } from '$lib/utils/paste-chunks.js';

const CAP = 4096;

describe('pasteChunks (ADR-0061 D3)', () => {
  const cases: Array<[string, string, number]> = [
    ['empty string → []', '', 0],
    ['one char → one chunk', 'a', 1],
    ['cap-1 → one chunk', 'x'.repeat(4095), 1],
    ['exact cap → one chunk, no empty tail', 'x'.repeat(4096), 1],
    ['cap+1 → two chunks', 'x'.repeat(4097), 2],
    ['2×cap → two chunks', 'x'.repeat(8192), 2],
    ['2×cap+1 → three chunks', 'x'.repeat(8193), 3]
  ];

  it.each(cases)('%s', (_label, input, expectedChunks) => {
    const chunks = pasteChunks(input);
    expect(chunks).toHaveLength(expectedChunks);
    expect(chunks.join('')).toBe(input); // rejoin === input, order preserved
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(CAP);
  });

  it('chunks are ORDERED slices of the input', () => {
    const input = Array.from({ length: 10_000 }, (_, i) => String(i % 10)).join('');
    const chunks = pasteChunks(input);
    let cursor = 0;
    for (const chunk of chunks) {
      expect(chunk).toBe(input.slice(cursor, cursor + chunk.length));
      cursor += chunk.length;
    }
    expect(cursor).toBe(input.length);
  });

  it('respects a custom cap', () => {
    expect(pasteChunks('abcdef', 2)).toEqual(['ab', 'cd', 'ef']);
    expect(pasteChunks('abc', 5)).toEqual(['abc']);
  });
});
