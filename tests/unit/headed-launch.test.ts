import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readBrowserConfig } from '../../src/lib/server/insight-config.js';

// Task 1.1-T — the launch-shape pins for The Headed Downgrade
// (ADR-0047 retirement amendment, 2026-11-05). open() is impure (a real
// chromium launch); the launch SHAPE is pinned at the source contract,
// exactly like the anti-bot pins in browser-registry.test.ts. The headed
// window itself is verified live (Wave 3, 3.2).

const src = readFileSync('src/lib/server/browser/registry.ts', 'utf8');

describe('headed launch shape (task 1.1-T)', () => {
	it('headedOpen forces headless:false on the DISPOSABLE profile — never the host root', () => {
		// the headless resolution: an explicit headedOpen wins, plain keeps cfg default
		expect(src).toContain('options.headedOpen ? false : (options.headless ?? cfg.headless)');
		// the profile dir is ALWAYS a fresh dir under the disposable root
		expect(src).toContain('join(cfg.profileRoot, id.slice(0, 8))');
	});

	it('the host Chrome root can never appear as profileDir — no borrow imports, no mount args, no host-root resolution', () => {
		expect(src).not.toContain('borrow.js');
		expect(src).not.toContain('resolveLastUsedProfile');
		expect(src).not.toContain('checkHostLock');
		expect(src).not.toContain('mountArgs');
		expect(src).not.toContain('--profile-directory');
		expect(src).not.toContain('borrowedRoot');
	});

	it('rmSync is path-guarded to the disposable root (the borrowed-wipe guard survives the downgrade)', () => {
		expect(src).toContain('profileDir.startsWith(disposableRoot)');
		expect(src).toContain('profile cleanup skipped - dir outside disposable root');
	});

	it('the disposable root is the config profileRoot (~/.dsi/browser-profiles)', () => {
		expect(readBrowserConfig().profileRoot).toContain('.dsi/browser-profiles');
	});

	it('the headed window is a normal-size window — the window-size arg is unconditional again', () => {
		expect(src).toContain("'--window-size='");
		expect(src).not.toContain('borrowedKey');
	});
});
