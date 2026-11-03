import { describe, expect, it } from 'vitest';
import { VARIANT_TITLES, classifyTool, toolTitle, TOOL_TITLE_MESSAGES } from '$lib/utils/tool-titles';

describe('classifyTool', () => {
	it.each([
		['bash', 'bash'],
		['pwsh', 'bash'],
		['read', 'read'],
		['web_fetch', 'read'],
		['web_search', 'search'],
		['grep', 'search'],
		['glob', 'search'],
		['write', 'write'],
		['edit', 'edit'],
		['run_code', 'code']
	])('%s -> %s', (name, variant) => {
		expect(classifyTool(name)).toBe(variant);
	});

	it('unknown tool names fall back to others', () => {
		expect(classifyTool('totally_made_up')).toBe('others');
		expect(classifyTool('')).toBe('others');
	});
});

describe('toolTitle / VARIANT_TITLES (BC-F byte parity)', () => {
	it('maps every variant to its literal title', () => {
		expect(VARIANT_TITLES).toEqual({
			search: 'Search', read: 'Read', bash: 'Bash', write: 'Write',
			edit: 'Edit', code: 'Code', others: 'Tool call'
		});
	});
	it('names a tool through the classifier', () => {
		expect(toolTitle('bash')).toBe('Bash');
		expect(toolTitle('grep')).toBe('Search');
		expect(toolTitle('nope')).toBe('Tool call');
	});
});

describe('TOOL_TITLE_MESSAGES (reactive render-site getters)', () => {
	it('every variant resolves to a non-empty localized string', () => {
		for (const variant of ['search', 'read', 'bash', 'write', 'edit', 'code', 'others'] as const) {
			const title = TOOL_TITLE_MESSAGES[variant]();
			expect(typeof title).toBe('string');
			expect(title.length).toBeGreaterThan(0);
		}
	});
});
