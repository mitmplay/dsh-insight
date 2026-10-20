/**
 * auto-trace preprocessor — defensive nullish arms the real Svelte parser
 * can never produce (the parser always fills children/attributes), plus
 * the Element-name guard arms a real AST cannot reach (capitalized tags
 * parse as InlineComponent; svelte:* specials parse as their own node
 * types). The parse seam is mocked with an @@-JSON escape hatch so the
 * walker's `?? []` / `?.` fallbacks are exercised directly.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('svelte/compiler', async (importOriginal) => {
	const actual = await importOriginal<typeof import('svelte/compiler')>();
	return {
		...actual,
		// @@<json> is a test-only escape hatch: a hand-written sparse AST.
		parse(content: string) {
			if (content.startsWith('@@')) return JSON.parse(content.slice(2));
			return actual.parse(content);
		}
	};
});

import { autoTrace } from '$lib/preprocess/auto-trace.js';

const pp = autoTrace();

function markup(content: string, filename = 'src/lib/components/Foo.svelte') {
	return pp.markup({ content, filename });
}

/** A sparse-AST payload: the walker only ever reads type/name/start/attributes. */
const sparse = (o: unknown): string => '@@' + JSON.stringify(o);
const el = (name: string, start: number, attributes: unknown = []): unknown => ({
	type: 'Element',
	name,
	start,
	attributes
});

describe('autoTrace — nullish-walk defensive arms', () => {
	it('an AST with no html fragment yields no inserts', () => {
		expect(markup(sparse({}))).toBeUndefined();
	});

	it('an html fragment with no children yields no inserts', () => {
		expect(markup(sparse({ html: { children: null } }))).toBeUndefined();
	});

	it('an if block with null children and a null-children else walks nothing', () => {
		expect(
			markup(sparse({ html: { children: [{ type: 'IfBlock', children: null, else: { children: null } }] } }))
		).toBeUndefined();
	});

	it('an each block with null children and a null-children else walks nothing', () => {
		expect(
			markup(sparse({ html: { children: [{ type: 'EachBlock', children: null, else: { children: null } }] } }))
		).toBeUndefined();
	});

	it('an await block with null children everywhere walks nothing', () => {
		expect(
			markup(
				sparse({
					html: {
						children: [
							{
								type: 'AwaitBlock',
								children: null,
								pending: { children: null },
								then: { children: null },
								catch: { children: null }
							}
						]
					}
				})
			)
		).toBeUndefined();
	});

	it('an await block with missing pending/then still walks the null-children catch', () => {
		expect(
			markup(sparse({ html: { children: [{ type: 'AwaitBlock', children: null, catch: { children: null } }] } }))
		).toBeUndefined();
	});

	it('an element with NO attributes array still gets tagged (the ?.[0] fallback)', () => {
		const out = markup(sparse({ html: { children: [el('div', 0, null)] } }));
		expect(out?.code).toContain('data-svelte="Foo"');
	});
});

describe('autoTrace — element-name guard arms', () => {
	it('skips capitalized Element nodes and svelte:* named Element nodes; tags the plain one', () => {
		const out = markup(
			sparse({
				html: {
					children: [
						el('Div', 0),
						el('svelte:element', 20),
						el('div', 40),
						el('span', 80, [{ type: 'Attribute', name: 'data-svelte' }])
					]
				}
			})
		);
		// exactly ONE injection: the guarded arms and the already-tagged
		// span contribute none.
		expect(out?.code.match(/data-svelte="Foo"/g)).toHaveLength(1);
	});

	it('a Windows-style path still resolves the basename for the component name', () => {
		const out = markup('<b>x</b>', 'C:\\lib\\Bar.svelte');
		expect(out?.code).toContain('data-svelte="Bar"');
	});
});
