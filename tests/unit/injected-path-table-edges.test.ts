/**
 * injected-path-table — trim/collapse edges (2026-10-29): the doc comment
 * promises whole-trio whitespace tolerance, per-tag trimming, and
 * multi-line content collapsed to single-space-joined.
 */
import { describe, expect, it } from 'vitest';
import { parseInjectedPathTable } from '$lib/utils/injected-path-table';

const trio = (path: string, type: string, content: string) =>
	`<path>${path}</path>\n<type>${type}</type>\n<content>${content}</content>`;

describe('parseInjectedPathTable — trim/collapse edges', () => {
	it('trims leading/trailing whitespace around the whole trio', () => {
		const rows = parseInjectedPathTable('  \n\t' + trio('/tmp/a.png', 'image', 'x') + '\n  ');
		expect(rows).not.toBeNull();
		expect(rows!.map((r) => r.value)).toEqual(['/tmp/a.png', 'image', 'x']);
	});

	it('trims whitespace inside <path>...</path>', () => {
		const rows = parseInjectedPathTable(trio('  /tmp/spaced path.png  ', 'image', 'x'));
		expect(rows).not.toBeNull();
		expect(rows![0]).toEqual({ key: 'path', value: '/tmp/spaced path.png', href: '/tmp/spaced path.png' });
	});

	it('trims the <type> value', () => {
		const rows = parseInjectedPathTable(trio('/tmp/b.png', '  image  ', 'x'));
		expect(rows).not.toBeNull();
		expect(rows![1]).toEqual({ key: 'type', value: 'image' });
	});

	it('collapses multi-line <content> to single-space-joined', () => {
		const rows = parseInjectedPathTable(trio('/tmp/c.png', 'image', '\nline one\nline two\nline three\n'));
		expect(rows).not.toBeNull();
		expect(rows![2]).toEqual({ key: 'content', value: 'line one line two line three' });
	});

	it('trims leading/trailing blank lines in <content>', () => {
		const rows = parseInjectedPathTable(trio('/tmp/d.png', 'image', '\n\n\nonly line\n\n\n'));
		expect(rows).not.toBeNull();
		expect(rows![2]).toEqual({ key: 'content', value: 'only line' });
	});

	it('a full valid trio returns exactly 3 rows with href equal to the path value', () => {
		const rows = parseInjectedPathTable(trio('/tmp/full.png', 'image', 'image/png image, 10x10 px, 42 bytes'));
		expect(rows).not.toBeNull();
		expect(rows).toHaveLength(3);
		expect(rows!.map((r) => r.key)).toEqual(['path', 'type', 'content']);
		expect(rows![0].href).toBe('/tmp/full.png');
		expect(rows![0].value).toBe(rows![0].href);
	});
});
