import { describe, expect, it, vi } from 'vitest';

const addPanel = vi.fn();
vi.mock('$lib/services/panels/panel-registry', () => ({
	addPanelFromSidebar: (...a: unknown[]) => addPanel(...a)
}));

import { chipNameOf, subagentOpenOf } from '$lib/utils/context-chip';

describe('chipNameOf — every producer arm (BC-11 verbatim naming)', () => {
	it('skill-invocation reads the invoked skill name', () => {
		expect(chipNameOf('skill-invocation', { name: 'dsi-adr' })).toBe('dsi-adr');
	});
	it('recall reads the first reference label', () => {
		expect(chipNameOf('recall', { references: [{ label: 'ADR-0006a' }, { label: 'second' }] })).toBe('ADR-0006a');
	});
	it('plugin reads the injecting plugin string', () => {
		expect(chipNameOf('plugin', { plugin: 'compact' })).toBe('compact');
	});
	it('promoted producers read the wire string — plugin shape, then v4 kind shape (2026-11-02 ADR D3 + live-wire amendment)', () => {
		expect(chipNameOf('goal', { kind: 'plugin', plugin: 'goal' })).toBe('goal');
		expect(chipNameOf('tool-goal', { kind: 'plugin', plugin: 'tool-goal' })).toBe('tool-goal');
		expect(chipNameOf('time-context', { kind: 'plugin', plugin: 'time-context' })).toBe('time-context');
		// v4 ledgers ride source.kind — the fallback arm (live census shapes)
		expect(chipNameOf('goal', { kind: 'goal', goalId: 'goal-x', revision: 1, round: 1 })).toBe('goal');
		expect(chipNameOf('tool-goal', { kind: 'tool-goal', form: 'notice', summary: 's' })).toBe('tool-goal');
		expect(chipNameOf('time-context', { kind: 'time-context', form: 'snapshot' })).toBe('time-context');
		expect(chipNameOf('goal', {})).toBeUndefined();
	});
	it('injected reads the kind string', () => {
		expect(chipNameOf('injected', { kind: 'plan-mode' })).toBe('plan-mode');
	});
	it.each([
		['skill-invocation', { name: '' }],
		['skill-invocation', { name: 42 }],
		['recall', { references: 'not-an-array' }],
		['recall', { references: [] }],
		['recall', { references: [{ label: '' }] }],
		['recall', { references: [{}] }],
		['plugin', { plugin: '' }],
		['injected', {}],
		['injected', undefined]
	] as const)('unreadable source (%s %j) yields undefined', (meta, source) => {
		expect(chipNameOf(meta as never, source as Record<string, unknown>)).toBeUndefined();
	});
	it('unknown meta kinds yield undefined', () => {
		expect(chipNameOf('runtime-context' as never, { anything: 'x' })).toBeUndefined();
		expect(chipNameOf('runtime-context' as never, undefined)).toBeUndefined();
	});
});

describe('subagentOpenOf — sender-session affordance', () => {
	it('subagent-report with a senderSessionId opens that panel on call', () => {
		const open = subagentOpenOf('injected', { kind: 'subagent-report', senderSessionId: 'child-1' });
		expect(open).toBeTypeOf('function');
		open!();
		expect(addPanel).toHaveBeenCalledWith({ sessionId: 'child-1', agentPreset: null });
	});
	it('subagent-settled carries the same affordance', () => {
		const open = subagentOpenOf('injected', { kind: 'subagent-settled', senderSessionId: 'child-2' });
		open!();
		expect(addPanel).toHaveBeenLastCalledWith({ sessionId: 'child-2', agentPreset: null });
	});
	it.each([
		['skill-invocation', { kind: 'subagent-report', senderSessionId: 'child-1' }],
		['injected', { kind: 'some-other-kind', senderSessionId: 'child-1' }],
		['injected', { kind: 'subagent-report' }],
		['injected', { kind: 'subagent-report', senderSessionId: '' }],
		['injected', { kind: 'subagent-report', senderSessionId: 7 }],
		['injected', undefined]
	] as const)('no affordance for %s %j', (meta, source) => {
		expect(subagentOpenOf(meta as never, source as Record<string, unknown>)).toBeUndefined();
	});
});
