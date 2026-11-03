import { describe, it, expect } from 'vitest';
import { parseTabCommand } from '$lib/browser/tab-grammar';

describe('parseTabCommand', () => {
  // open — URL-shaped
  it('glass with scheme URL → open url', () => {
    expect(parseTabCommand('glass https://example.com')).toEqual({
      kind: 'open',
      url: 'https://example.com'
    });
  });
  it('glass with dotted host → open url', () => {
    expect(parseTabCommand('glass example.com')).toEqual({
      kind: 'open',
      url: 'example.com'
    });
  });
  it('glass with non-URL text → open text', () => {
    expect(parseTabCommand('glass hello world')).toEqual({
      kind: 'open',
      text: 'hello world'
    });
  });
  it('glass alone → open with nothing', () => {
    expect(parseTabCommand('glass')).toEqual({ kind: 'open' });
  });

  // focus — reuse
  it('reuse tab:2 → focus', () => {
    expect(parseTabCommand('reuse tab:2')).toEqual({ kind: 'focus', tabId: 2 });
  });
  it('reuse tab:2 url → focus with url', () => {
    expect(parseTabCommand('reuse tab:2 https://example.com')).toEqual({
      kind: 'focus',
      tabId: 2,
      url: 'https://example.com'
    });
  });

  // focus — change [to]
  it('change tab:3 → focus', () => {
    expect(parseTabCommand('change tab:3')).toEqual({ kind: 'focus', tabId: 3 });
  });
  it('change to tab:3 → focus', () => {
    expect(parseTabCommand('change to tab:3')).toEqual({ kind: 'focus', tabId: 3 });
  });
  it('CHANGE TO TAB:3 case-insensitive → focus', () => {
    expect(parseTabCommand('CHANGE TO TAB:3')).toEqual({ kind: 'focus', tabId: 3 });
  });

  // focus — bare
  it('tab:1 → focus', () => {
    expect(parseTabCommand('tab:1')).toEqual({ kind: 'focus', tabId: 1 });
  });
  it('  tab:7  whitespace tolerated → focus', () => {
    expect(parseTabCommand('  tab:7  ')).toEqual({ kind: 'focus', tabId: 7 });
  });

  // close
  it('close tab:4 → close', () => {
    expect(parseTabCommand('close tab:4')).toEqual({ kind: 'close', tabId: 4 });
  });
  it('close active → close active', () => {
    expect(parseTabCommand('close active')).toEqual({ kind: 'close', tabId: 'active' });
  });

  // query-active
  it('active → query-active', () => {
    expect(parseTabCommand('active')).toEqual({ kind: 'query-active' });
  });

  // errors — non-positive-integer tab refs
  it('tab:0 → error', () => {
    expect(parseTabCommand('tab:0').kind).toBe('error');
  });
  it('tab:-1 → error', () => {
    expect(parseTabCommand('tab:-1').kind).toBe('error');
  });
  it('tab:abc → error', () => {
    expect(parseTabCommand('tab:abc').kind).toBe('error');
  });

  // fallback
  it('unmatched input → url-or-search with original text', () => {
    expect(parseTabCommand('what is the weather today')).toEqual({
      kind: 'url-or-search',
      text: 'what is the weather today'
    });
  });
  it('close with junk ref → url-or-search fallback', () => {
    expect(parseTabCommand('close something else')).toEqual({
      kind: 'url-or-search',
      text: 'close something else'
    });
  });
});
