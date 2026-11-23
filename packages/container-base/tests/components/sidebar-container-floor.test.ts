import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { SidebarContainer } from '../../src/index';

// SidebarContainer — branch floor (ADR-0063 D5). Pins the arms the shell
// contract suite (sidebar-container.test.ts) never takes. Source
// branches cited by packages/container-base/src/components/
// SidebarContainer.svelte line:
//   L72-73  `{#if collapsedSkin}` → the skin layer's TRUTHY arm (the one
//           uncovered line: the sibling mounts collapsed with content only).
//           SSC#1 structural contract (SSC#1 lesson, style block L123-128):
//           skin and content are SEPARATE base-owned layers and paint order
//           is the DOM — the skin underlay MUST precede the content layer.
//   L82/L89 `{@render children?.()}` with NO children (optional snippet) —
//           an empty rail, never a throw.
//   L86     `{#if badge}` — the width-badge slot exists in the standalone
//           wrapper ONLY (prop doc L46), ahead of the rail.
//   L81     `{#if header}` on the EMBEDDED branch (the sibling's header
//           test mounts standalone).
//   L100    `onResizeStart?.(e)` with no callback — a bare no-op.
//   L85/L87/L96/L99/L101 consumer ids: testId / testIdCollapsed /
//           gutterLabel rename every hook (OCI ControlRail parity).

const targets: HTMLElement[] = [];
function host(): HTMLElement {
	const el = document.createElement('div');
	document.body.appendChild(el);
	targets.push(el);
	return el;
}
const instances: ReturnType<typeof mount>[] = [];
afterEach(() => {
	for (const i of instances) unmount(i);
	instances.length = 0;
	for (const el of targets) el.remove();
	targets.length = 0;
});

const textSnippet = (text: string) => createRawSnippet(() => ({ render: () => `<i>${text}</i>`, setup: () => {} }));

/** Mount the shell; returns the host element. Props are passed verbatim
 *  (no implicit defaults) so optional snippets can be left OUT. */
function mountShell(props: Record<string, unknown> = {}): HTMLElement {
	const root = host();
	instances.push(mount(SidebarContainer, { target: root, props }));
	flushSync();
	return root;
}

const q = (root: HTMLElement, testid: string): HTMLElement =>
	root.querySelector(`[data-testid="${testid}"]`) as HTMLElement;

describe('SidebarContainer — collapsed stub: the skin layer (L72-73, SSC#1)', () => {
	it('collapsed + collapsedSkin renders the skin INSIDE the stub, as its first child, under the content layer', () => {
		const root = mountShell({
			collapsed: true,
			collapsedSkin: textSnippet('SKIN'),
			collapsedContent: textSnippet('STUB')
		});
		const stub = q(root, 'sidebar-collapsed');
		expect(stub).toBeTruthy();
		const skin = stub.querySelector('.cb-stub-skin') as HTMLElement;
		const content = stub.querySelector('.cb-stub-content') as HTMLElement;
		expect(skin).toBeTruthy();
		expect(skin.textContent).toContain('SKIN');
		expect(content.textContent).toContain('STUB');
		// Paint order IS the DOM: the underlay first, the interactive layer above
		expect(stub.firstElementChild).toBe(skin);
		expect(skin.nextElementSibling).toBe(content);
		// two distinct base-owned layers — the skin never doubles as content
		expect(skin.classList.contains('cb-stub-content')).toBe(false);
		expect(content.classList.contains('cb-stub-skin')).toBe(false);
		// the stub branch still owns no rail / wrapper / gutter
		expect(root.querySelector('.cb-sidebar')).toBeNull();
		expect(root.querySelector('.cb-sidebar-wrap')).toBeNull();
		expect(root.querySelector('.cb-sidebar-gutter')).toBeNull();
	});

	it('collapsed + collapsedSkin WITHOUT collapsedContent renders the skin layer alone — no empty content layer', () => {
		const root = mountShell({ collapsed: true, collapsedSkin: textSnippet('SKIN') });
		const stub = q(root, 'sidebar-collapsed');
		expect(stub.children).toHaveLength(1);
		expect(stub.firstElementChild?.classList.contains('cb-stub-skin')).toBe(true);
		expect(stub.querySelector('.cb-stub-content')).toBeNull();
	});
});

describe('SidebarContainer — optional snippets and consumer props', () => {
	it('standalone WITHOUT children renders an empty rail — the ?? noop arm, no throw, no words (L89)', () => {
		const root = mountShell();
		const rail = q(root, 'sidebar');
		expect(rail).toBeTruthy();
		expect(rail.textContent?.trim()).toBe('');
		// the geometry still stands
		expect(q(root, 'sidebar-wrap').style.width).toBe('400px');
		expect(q(root, 'sidebar-gutter')).toBeTruthy();
	});

	it('embedded WITHOUT children renders the same bare empty rail (L82)', () => {
		const root = mountShell({ embedded: true });
		expect(q(root, 'sidebar').textContent?.trim()).toBe('');
		expect(root.querySelector('[data-testid="sidebar-wrap"]')).toBeNull();
	});

	it('badge slot: standalone renders it inside the width wrapper AHEAD of the rail (L86)', () => {
		const root = mountShell({ badge: textSnippet('BADGE'), children: textSnippet('BODY') });
		const wrap = q(root, 'sidebar-wrap');
		const nodes = [...wrap.childNodes];
		const badgeIdx = nodes.findIndex((n) => n.textContent?.includes('BADGE'));
		const railIdx = nodes.indexOf(q(root, 'sidebar'));
		expect(badgeIdx).toBeGreaterThanOrEqual(0);
		expect(badgeIdx).toBeLessThan(railIdx);
		// the badge is the wrapper's, never the rail's
		expect(q(root, 'sidebar').textContent).not.toContain('BADGE');
	});

	it('badge slot: the EMBEDDED branch has none — a supplied badge is not rendered (prop doc L46)', () => {
		const root = mountShell({ embedded: true, badge: textSnippet('BADGE'), children: textSnippet('BODY') });
		expect(q(root, 'sidebar')).toBeTruthy();
		expect(root.textContent).toContain('BODY');
		expect(root.textContent).not.toContain('BADGE');
	});

	it('embedded + header: the header renders inside the bare rail, above the body (L81)', () => {
		const root = mountShell({ embedded: true, header: textSnippet('HEADER'), children: textSnippet('BODY') });
		const rail = q(root, 'sidebar');
		const text = rail.textContent ?? '';
		expect(text.indexOf('HEADER')).toBeGreaterThanOrEqual(0);
		expect(text.indexOf('HEADER')).toBeLessThan(text.indexOf('BODY'));
		expect(rail.classList.contains('cb-sidebar-embedded')).toBe(true);
	});

	it('consumer ids: testId / testIdCollapsed / gutterLabel rename every hook', () => {
		const root = mountShell({
			testId: 'ops-rail',
			gutterLabel: 'Resize operations',
			children: textSnippet('BODY')
		});
		expect(q(root, 'ops-rail')).toBeTruthy();
		expect(q(root, 'ops-rail-wrap').style.width).toBe('400px');
		const gutter = q(root, 'ops-rail-gutter');
		expect(gutter.getAttribute('aria-label')).toBe('Resize operations');
		expect(gutter.getAttribute('role')).toBe('separator');
		expect(root.querySelector('[data-testid="sidebar"]')).toBeNull();
		expect(root.querySelector('[data-testid="sidebar-gutter"]')).toBeNull();

		const stubRoot = mountShell({ collapsed: true, testIdCollapsed: 'ops-stub', collapsedContent: textSnippet('STUB') });
		expect(q(stubRoot, 'ops-stub').textContent).toContain('STUB');
		expect(stubRoot.querySelector('[data-testid="sidebar-collapsed"]')).toBeNull();
	});

	it('gutter mousedown with NO onResizeStart callback is a silent no-op (L100)', () => {
		const root = mountShell();
		const gutter = q(root, 'sidebar-gutter');
		expect(() => gutter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))).not.toThrow();
		expect(q(root, 'sidebar')).toBeTruthy(); // nothing tore down
	});
});
