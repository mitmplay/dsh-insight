/**
 * injected-path-table — parser pins (2026-10-29): the trio shape parses
 * into path/type/content rows; everything else is null.
 */
import { describe, expect, it } from 'vitest';
import { parseInjectedPathTable } from '$lib/utils/injected-path-table';

describe('parseInjectedPathTable', () => {
	it('parses the full trio into path/type/content rows', () => {
		const rows = parseInjectedPathTable(`<path>/Users/wharsojo/agentic-ai/deepseek-insight/conversation-header-gap-verified.png</path>\n<type>image</type>\n<content>\nimage/png image, 1215x852 px, 411798 bytes\n</content>`);
		expect(rows).not.toBeNull();
		expect(rows!.map((r) => r.key)).toEqual(['path', 'type', 'content']);
		expect(rows![0]).toEqual({
			key: 'path',
			value: '/Users/wharsojo/agentic-ai/deepseek-insight/conversation-header-gap-verified.png',
			href: '/Users/wharsojo/agentic-ai/deepseek-insight/conversation-header-gap-verified.png'
		});
		expect(rows![1]).toEqual({ key: 'type', value: 'image' });
		expect(rows![2].value).toContain('1215x852');
	});

	it('a path with spaces survives into the href', () => {
		const rows = parseInjectedPathTable(`<path>/Users/wharsojo/my folder/The Note.md</path>\n<type>file</type>\n<content>\nbytes 12\n</content>`);
		expect(rows).not.toBeNull();
		expect(rows![0].href).toBe('/Users/wharsojo/my folder/The Note.md');
	});

	it('returns null for a human prompt (no tags)', () => {
		expect(parseInjectedPathTable('please look at this file')).toBeNull();
	});

	it('returns null for a PARTIAL shape (path without type/content)', () => {
		expect(parseInjectedPathTable('<path>/tmp/x.png</path>')).toBeNull();
	});

	it('returns null when <path> holds only spaces (trim to empty path early return)', () => {
		// Exercises line 33: m[1] matches whitespace-only, trims to '', early return null.
		expect(parseInjectedPathTable('<path>    </path>\n<type>image</type>\n<content>x</content>')).toBeNull();
	});

	it('trims whitespace padding inside every tag', () => {
		const rows = parseInjectedPathTable(
			`  <path>   /tmp/padded.png   </path> \n\t<type>  image  </type>\n  <content>  \n a  b\nc  \n </content>   `
		);
		expect(rows).not.toBeNull();
		expect(rows![0].value).toBe('/tmp/padded.png');
		expect(rows![1].value).toBe('image');
		expect(rows![2].value).toBe('a  b c'); // newline → single space; existing inner double space stays
	});

	it('returns null for a truly empty <path> (regex fails, !m branch)', () => {
		expect(parseInjectedPathTable('<path></path><type>image</type><content>x</content>')).toBeNull();
	});

	it('returns null when prose surrounds the trio (quoting stays inert)', () => {
		const quoted = 'look: ' + `<path>/Users/wharsojo/agentic-ai/deepseek-insight/conversation-header-gap-verified.png</path>\n<type>image</type>\n<content>\nimage/png image, 1215x852 px, 411798 bytes\n</content>` + ' and marvel';
		expect(parseInjectedPathTable(quoted)).toBeNull();
	});
});
