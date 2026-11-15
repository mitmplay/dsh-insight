import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionTable } from '../../src/index';

let table = createActionTable();
beforeEach(() => {
	table = createActionTable();
});

describe('createActionTable — register/invoke semantics', () => {
	it('invoke returns true when a handler ran, false when unregistered', () => {
		const fn = vi.fn();
		expect(table.invoke('act', {})).toBe(false);
		table.register('act', fn);
		expect(table.invoke('act', { n: 1 })).toBe(true);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith({ n: 1 });
	});

	it('unknown action errors are graceful: false, never a throw', () => {
		expect(() => table.invoke('nope')).not.toThrow();
		expect(table.invoke('nope', 1, 2, 3)).toBe(false);
	});

	it('register overwrites the previous handler (last registration wins)', () => {
		const first = vi.fn();
		const second = vi.fn();
		table.register('act', first);
		table.register('act', second);
		expect(table.invoke('act')).toBe(true);
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});

	it('registering null unregisters (the host destroy lifecycle)', () => {
		const fn = vi.fn();
		table.register('act', fn);
		table.register('act', null);
		expect(table.has('act')).toBe(false);
		expect(table.invoke('act')).toBe(false);
	});

	it('payload agnosticism: zero, multi-arg, and object payloads all pass through', () => {
		const fn = vi.fn();
		table.register('multi', fn);
		expect(table.invoke('multi')).toBe(true);
		expect(table.invoke('multi', 1, 'two', { three: 3 })).toBe(true);
		expect(fn).toHaveBeenNthCalledWith(1);
		expect(fn).toHaveBeenNthCalledWith(2, 1, 'two', { three: 3 });
	});

	it('has / isActive / reset — the host-mount probes', () => {
		expect(table.isActive()).toBe(false);
		table.register('a', () => null);
		table.register('b', () => null);
		expect(table.has('a')).toBe(true);
		expect(table.has('c')).toBe(false);
		expect(table.isActive()).toBe(true);
		table.reset();
		expect(table.isActive()).toBe(false);
		expect(table.has('a')).toBe(false);
	});

	it('invokeForResult returns the handler value; undefined when unregistered', () => {
		table.register('find', () => 'hit');
		expect(table.invokeForResult('find', 'x')).toBe('hit');
		expect(table.invokeForResult('missing')).toBeUndefined();
		// a false RESULT is distinct from 'no handler ran'
		table.register('miss', () => false);
		expect(table.invokeForResult('miss')).toBe(false);
		expect(table.invoke('miss')).toBe(true);
	});

	it('a throwing handler propagates — the table is a channel, not a guard', () => {
		table.register('bad', () => {
			throw new Error('handler bug');
		});
		expect(() => table.invoke('bad')).toThrow('handler bug');
	});
});
