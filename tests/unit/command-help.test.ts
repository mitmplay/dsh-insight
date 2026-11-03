/**
 * command-help tests (2026-08-30) — the composer's `?` help intent:
 * detection grammar (slash commands through parseCommand, the looser
 * `@token ?` mention shape) and the copy table's coverage.
 */
import { describe, expect, it } from 'vitest';
import {
	COMMAND_HELP,
	commandHelpTopic,
	gestureHelpCardView,
	MENU_GESTURES,
	helpQuery,
	hostHelpCardView
} from '$lib/services/chat/command-help';
import type { DsiCommandRow, DsiSkillRow } from '$lib/types';

const UUID = '9f0c1a2b-3d4e-4f5a-6b7c-8d9e0a1b2c3d';

describe('commandHelpTopic — slash commands (parser-routed)', () => {
	it('matches each command with a bare ? argument', () => {
		expect(commandHelpTopic('/new ?')).toBe('new');
		expect(commandHelpTopic('/permission ?')).toBe('permission');
	});

	it('is case-insensitive on the token (parser parity)', () => {
		expect(commandHelpTopic('/NEW ?')).toBe('new');
		expect(commandHelpTopic('/Permission ?')).toBe('permission');
	});

	it('is trim- and whitespace-tolerant', () => {
		expect(commandHelpTopic('  /new ?  ')).toBe('new');
		expect(commandHelpTopic('/new   ?')).toBe('new');
	});
});

describe('commandHelpTopic — mention help (looser @token shape)', () => {
	it('matches a full session-<uuid> ? line', () => {
		expect(commandHelpTopic(`@session-${UUID} ?`)).toBe('mention');
	});

	it('matches a bare uuid tail and a short non-uuid token', () => {
		expect(commandHelpTopic(`@${UUID} ?`)).toBe('mention');
		expect(commandHelpTopic('@abc123 ?')).toBe('mention');
	});

	it('is trim-tolerant', () => {
		expect(commandHelpTopic('  @abc ? ')).toBe('mention');
	});
});

describe('commandHelpTopic — null (never a help line)', () => {
	it.each([
		'', // empty draft
		'   ', // blank draft
		'/new', // real command, no ?
		'/permission', // real command, no ?
		'/new @reviewer', // real command with its real argument
		'/permission read-only', // real command with its real argument
		'/new ? x', // ? is not the entire argument
		'/permission ?read', // ? is not the entire argument
		'/permissionx ?', // unknown token — parser passthrough
		'/usr/bin/python', // ordinary text
		'hello world', // ordinary text
		'run /new ?', // command not at the start
		'@abc', // mention-shaped, no ? message
		'@abc ? extra', // message after the ? — not a help intent
		'@abc?', // no separating whitespace
		'@abc hi ?', // message containing a trailing ?
		'?load', // the Suggest Strip finder trigger
		'!deploy', // the Prompt Macro run trigger
		'? ' // blank finder query
	])('returns null for %j', (text) => {
		expect(commandHelpTopic(text)).toBeNull();
	});

	it('a real uuid mention with a real message stays a command, not help', () => {
		expect(commandHelpTopic(`@session-${UUID} what changed?`)).toBeNull();
	});
});

describe('COMMAND_HELP copy table', () => {
	it('covers every topic with usage, summary, and examples', () => {
		for (const topic of ['new', 'permission', 'mention'] as const) {
			const entry = COMMAND_HELP[topic];
			expect(entry.usage.length).toBeGreaterThan(0);
			expect(entry.summary.length).toBeGreaterThan(0);
			expect(entry.examples.length).toBeGreaterThan(0);
			for (const ex of entry.examples) {
				expect(ex.line.length).toBeGreaterThan(0);
				expect(ex.description.length).toBeGreaterThan(0);
			}
		}
	});

	it('usage lines start with the triggering token (slash or mention)', () => {
		expect(COMMAND_HELP.new.usage.startsWith('/new')).toBe(true);
		expect(COMMAND_HELP.permission.usage.startsWith('/permission')).toBe(true);
		expect(COMMAND_HELP.mention.usage.startsWith('@')).toBe(true);
	});

	it('the settings topics cover copy, examples, and `?` routing (W3 3.3-T)', () => {
		// display tokens renamed 2026-09-24 (dsi-/dsh- prefixes) — the topic
		// (internal name) is stable, so the trigger token is mapped per topic
		const tokens = { dsisettings: '/dsi-settings', dshsettings: '/dsh-settings' } as const;
		for (const topic of ['dsisettings', 'dshsettings'] as const) {
			const entry = COMMAND_HELP[topic];
			expect(entry.usage.length).toBeGreaterThan(0);
			expect(entry.summary.length).toBeGreaterThan(0);
			expect(entry.params).toEqual([]); // the --add flag retired (Focus Command D2)
			expect(entry.examples.length).toBeGreaterThan(0);
			expect(entry.usage.startsWith(tokens[topic])).toBe(true);
			expect(commandHelpTopic(tokens[topic] + ' ?')).toBe(topic);
		}
		expect(MENU_GESTURES.some((g) => g.name === 'dsisettings')).toBe(true);
		expect(MENU_GESTURES.some((g) => g.name === 'dshsettings')).toBe(true);
	});
});

const COMMANDS: DsiCommandRow[] = [
	{ name: 'compact', description: 'Compact the session context' },
	{ name: 'plan', description: 'Plan the next turn', input: { hint: '<goal>' } }
];
const SKILLS: DsiSkillRow[] = [
	{ name: 'dsh-doc', description: 'Answer from the DSH docs', modelInvocable: true },
	{
		name: 'compact',
		description: 'Compact — the skill twin (collision fixture)',
		modelInvocable: false
	}
];

describe('helpQuery — the host `?` shape (declined /-drafts only)', () => {
	it('matches a host command token with a bare ? argument', () => {
		expect(helpQuery('/plan ?')).toEqual({ token: 'plan' });
		expect(helpQuery('/dsh-doc ?')).toEqual({ token: 'dsh-doc' });
	});

	it('is case-insensitive and trim/whitespace tolerant', () => {
		expect(helpQuery('  /PLAN   ?  ')).toEqual({ token: 'plan' });
	});

	it('DSI gestures keep priority — parseCommand owns their drafts', () => {
		expect(helpQuery('/new ?')).toBeNull();
		expect(helpQuery('/permission ?')).toBeNull();
	});

	it.each([
		'/plan', // bare token — not a question
		'/plan x ?', // ? is not the entire remainder
		'/plan? x', // same
		'/plan?read', // no separating whitespace
		'/', // bare slash
		'@abc ?', // the mention help shape, not a host query
		'?load', // the strip's finder trigger
		'hello ?' // ordinary text
	])('returns null for %j', (text) => {
		expect(helpQuery(text)).toBeNull();
	});
});

describe('hostHelpCardView — the wire copy, nothing invented', () => {
	it('a hint command renders the usage + the hint as its parameter row', () => {
		const view = hostHelpCardView('/plan ?', COMMANDS, SKILLS);
		expect(view).not.toBeNull();
		expect(view?.usage).toBe('/plan <goal>');
		expect(view?.tag).toBe('command');
		expect(view?.summary).toBe('Plan the next turn');
		expect(view?.params).toEqual([
			{ name: '<goal>', description: expect.stringContaining('commands/execute') }
		]);
		expect(view?.examples).toEqual([]);
		expect(view?.note).toContain('never reaches the model');
	});

	it('a hint-less command renders no parameter row', () => {
		const view = hostHelpCardView('/compact ?', COMMANDS, SKILLS);
		expect(view?.usage).toBe('/compact');
		expect(view?.params).toEqual([]);
	});

	it('a skill renders the whenToUse row and the model-injection note', () => {
		const view = hostHelpCardView('/dsh-doc ?', COMMANDS, SKILLS);
		expect(view?.tag).toBe('skill');
		expect(view?.usage).toBe('/dsh-doc');
		expect(view?.summary).toBe('Answer from the DSH docs');
		expect(view?.params).toEqual([]); // whenToUse absent — no row
		expect(view?.note).toContain('the host injects the skill body');
	});

	it('an operator-only skill says so and carries its whenToUse', () => {
		const view = hostHelpCardView('/compactx ?', [], [
			{
				name: 'compactx',
				description: 'Compact — the skill twin',
				whenToUse: 'When the context runs long',
				modelInvocable: false
			}
		]);
		expect(view?.params).toEqual([{ name: 'when', description: 'When the context runs long' }]);
		expect(view?.note).toContain('only you can invoke this skill');
	});

	it('a name in BOTH catalogs resolves to the COMMAND (the native rule)', () => {
		const view = hostHelpCardView('/compact ?', COMMANDS, SKILLS);
		expect(view?.tag).toBe('command');
		expect(view?.summary).toBe('Compact the session context');
	});

	it('token lookup is case-insensitive', () => {
		expect(hostHelpCardView('/PLAN ?', COMMANDS, SKILLS)?.usage).toBe('/plan <goal>');
	});

	it.each(['/nope ?', '/new ?', '/plan', 'hello ?'])('returns null for %j', (text) => {
		expect(hostHelpCardView(text, COMMANDS, SKILLS)).toBeNull();
	});
});

describe('gestureHelpCardView — the COMMAND_HELP copy, verbatim', () => {
	it('wraps a gesture entry with the help tag and no note', () => {
		const view = gestureHelpCardView('new');
		expect(view.usage).toBe(COMMAND_HELP.new.usage);
		expect(view.tag).toBe('help');
		expect(view.summary).toBe(COMMAND_HELP.new.summary);
		expect(view.params).toEqual(COMMAND_HELP.new.params);
		expect(view.examples).toEqual(COMMAND_HELP.new.examples);
		expect(view.note).toBeUndefined();
	});
});


// ── /dsi-prompts help (re-aimed 2026-09-17, The Focus Command ADR D2) ──
describe('COMMAND_HELP — /dsi-prompts (Focus Command)', () => {
	it('usage string pinned (flag retired)', () => {
		expect(COMMAND_HELP.promptmanager.usage).toBe('/dsi-prompts');
	});

	it('one shape: no params, a single aim example', () => {
		expect(COMMAND_HELP.promptmanager.params).toEqual([]);
		expect(COMMAND_HELP.promptmanager.examples.map((e) => e.line)).toEqual([
			'/dsi-prompts'
		]);
		expect(COMMAND_HELP.promptmanager.summary).toContain('focus');
		expect(COMMAND_HELP.promptmanager.summary).toContain('Nothing you have open is ever replaced');
	});

	it('/dsi-prompts ? routes to the topic through the parser', () => {
		expect(commandHelpTopic('/dsi-prompts ?')).toBe('promptmanager');
	});
});

describe('COMMAND_HELP.skillshelf — locale-resolving getters (W1.5)', () => {
	it('summary resolves at read time through the active locale (non-empty)', () => {
		// The getters (lines that freeze at module init would miss) resolve
		// t(...) per read — assert they produce real copy, not a frozen string.
		expect(typeof COMMAND_HELP.skillshelf.summary).toBe('string');
		expect(COMMAND_HELP.skillshelf.summary.length).toBeGreaterThan(0);
		expect(COMMAND_HELP.skillshelf.usage).toBe('/dsi-skills [--reload]');
	});

	it('param and example getters resolve real copy on each read', () => {
		const [reload] = COMMAND_HELP.skillshelf.params;
		expect(reload?.name).toBe('--reload');
		expect(reload?.description.length).toBeGreaterThan(0);
		// re-read: a getter, not a once-frozen plain object field
		expect(COMMAND_HELP.skillshelf.params[0]?.description).toBe(reload?.description);

		const examples = COMMAND_HELP.skillshelf.examples;
		expect(examples.map((e) => e.line)).toEqual([
			'/dsi-skills',
			'/dsi-skills --reload',
			'/dsi-skills ?'
		]);
		for (const ex of examples) {
			expect(ex.description.length).toBeGreaterThan(0);
		}
		expect(COMMAND_HELP.skillshelf.examples[0]?.description).toBe(examples[0]?.description);
	});

	it('the MENU_GESTURES skillshelf row resolves its description lazily too', () => {
		const row = MENU_GESTURES.find((g) => g.name === 'skillshelf');
		expect(row).toBeDefined();
		expect(row?.description).toBe(COMMAND_HELP.skillshelf.summary);
		expect(row?.seed).toBe('/dsi-skills ');
	});

	it('/dsi-skills ? routes to the skillshelf topic', () => {
		expect(commandHelpTopic('/dsi-skills ?')).toBe('skillshelf');
	});
});

// ── Retired Typed Command 3.1-T — /loadinjected help retired (2026-09-17) ──
describe('COMMAND_HELP — /loadinjected retirement (3.1-T)', () => {
	it('the topic is gone from COMMAND_HELP and the topic union', () => {
		expect('loadinjected' in COMMAND_HELP).toBe(false);
		// /loadinjected ? no longer routes to help — the executor's D2
		// retirement note is the answer now.
		expect(commandHelpTopic('/loadinjected ?')).toBeNull();
	});

	it('the slash menu no longer carries the gesture row', () => {
		expect(MENU_GESTURES.find((g) => g.name === 'loadinjected')).toBeUndefined();
	});
});

// ── Workspace Command W3 3.1-T — /workspace help + /new copy (2026-09-15, ADR D6) ──
describe('COMMAND_HELP — /workspace (W3 3.1-T)', () => {
	it('/workspace ? routes to the topic through the parser', () => {
		expect(commandHelpTopic('/workspace ?')).toBe('workspace');
		expect(commandHelpTopic('/WORKSPACE ?')).toBe('workspace');
	});

	it('the usage pins the required-argument grammar', () => {
		expect(COMMAND_HELP.workspace.usage).toBe('/workspace <full-path> [name]');
		expect(COMMAND_HELP.workspace.usage.startsWith('/workspace')).toBe(true);
	});

	it('the copy keeps the ADR\u2019s honest facts: adopt-only, no client writes, rename-only-own-creates', () => {
		expect(COMMAND_HELP.workspace.summary).toContain('Adopts');
		expect(COMMAND_HELP.workspace.summary).toContain('never writes the filesystem');
		expect(COMMAND_HELP.workspace.summary).toContain('WHEN this command created it');
		expect(COMMAND_HELP.workspace.params.map((p) => p.name)).toEqual(['<full-path>', '[name]']);
	});

	it('the fresh-desk recipe is among the examples (D6)', () => {
		const lines = COMMAND_HELP.workspace.examples.map((e) => e.line);
		expect(lines).toContain('/workspace ~/workspace-ai');
		expect(lines).toContain('/new workspace-ai');
		for (const ex of COMMAND_HELP.workspace.examples) {
			expect(ex.description.length).toBeGreaterThan(0);
		}
	});

	it('the slash menu carries the derived row (zero-extra-names)', () => {
		const row = MENU_GESTURES.find((g) => g.name === 'workspace');
		expect(row).toBeDefined();
		expect(row?.seed).toBe('/workspace ');
		expect(row?.display).toBe('/workspace');
		expect(row?.description).toBe(COMMAND_HELP.workspace.summary);
	});
});

describe('COMMAND_HELP — /new copy for the workspace slot (W3 3.1-T)', () => {
	it('the usage carries the [workspace] slot (matches the executor\u2019s usage string grammar)', () => {
		// 2026-10-29, Workspace Command ADR amendment D7/D8: the --title
		// flag joins the grammar — the usage string moves in lockstep.
		expect(COMMAND_HELP.new.usage).toBe('/new [@agent] [workspace] [--title <title>] [--add]');
	});

	it('the workspace param documents title-or-path matching and the no-guess rule', () => {
		const ws = COMMAND_HELP.new.params.find((p) => p.name === 'workspace');
		expect(ws).toBeDefined();
		expect(ws!.description).toContain('recipe-ws');
		expect(ws!.description).toContain('candidates instead of guessing');
	});

	it('the summary says the named workspace replaces inheritance', () => {
		expect(COMMAND_HELP.new.summary).toContain('THERE instead of inheriting');
	});

	it('/new ? card reflects the new usage through the card view', () => {
		expect(commandHelpTopic('/new ?')).toBe('new');
		const view = gestureHelpCardView('new');
		expect(view.usage).toBe('/new [@agent] [workspace] [--title <title>] [--add]');
		expect(view.params.map((p) => p.name)).toEqual(['@agent', 'workspace', '--title <title>', '--add']);
	});
});

describe('MENU_GESTURES — the zero-extra-names invariant holds with workspace added', () => {
	it('every row\u2019s description equals its COMMAND_HELP summary, and every COMMAND_HELP slash topic has a row', () => {
		for (const row of MENU_GESTURES) {
			const topic = row.name as keyof typeof COMMAND_HELP;
			if (topic in COMMAND_HELP) {
				expect(row.description).toBe(COMMAND_HELP[topic].summary);
			}
		}
		for (const topic of ['new', 'workspace', 'promptmanager', 'dsisettings', 'dshsettings'] as const) {
			expect(MENU_GESTURES.some((g) => g.name === topic)).toBe(true);
		}
	});
});


// ── Plugin Rack — the rack's own localized getters (The Shelf Voice W1.5) ──
describe('COMMAND_HELP.pluginrack — locale-resolving getters', () => {
	it('summary and param getters resolve real copy on each read', () => {
		expect(COMMAND_HELP.pluginrack.usage).toBe('/dsi-plugins [--reload]');
		expect(typeof COMMAND_HELP.pluginrack.summary).toBe('string');
		expect(COMMAND_HELP.pluginrack.summary.length).toBeGreaterThan(0);
		const [reload] = COMMAND_HELP.pluginrack.params;
		expect(reload?.name).toBe('--reload');
		expect(reload?.description.length).toBeGreaterThan(0);
		expect(COMMAND_HELP.pluginrack.params[0]?.description).toBe(reload?.description);
	});

	it('example getters resolve real copy for all three rows', () => {
		const examples = COMMAND_HELP.pluginrack.examples;
		expect(examples.map((e) => e.line)).toEqual(['/dsi-plugins', '/dsi-plugins --reload', '/dsi-plugins ?']);
		for (const ex of examples) {
			expect(ex.description.length).toBeGreaterThan(0);
		}
		expect(COMMAND_HELP.pluginrack.examples[0]?.description).toBe(examples[0]?.description);
		expect(gestureHelpCardView('pluginrack').usage).toBe('/dsi-plugins [--reload]');
	});

	it('/dsi-plugins ? routes to the pluginrack topic and the menu row resolves lazily', () => {
		expect(commandHelpTopic('/dsi-plugins ?')).toBe('pluginrack');
		const row = MENU_GESTURES.find((g) => g.name === 'pluginrack');
		expect(row).toBeDefined();
		expect(row?.seed).toBe('/dsi-plugins ');
		expect(row?.description).toBe(COMMAND_HELP.pluginrack.summary);
	});
});

// ── hostHelpCardView — the empty-token guard (a slash + bare-question draft) ──
describe('hostHelpCardView — empty-token edge', () => {
	it('a slash + bare question-mark draft yields an empty token and no card', () => {
		expect(helpQuery('/ ?')).toEqual({ token: '' });
		expect(hostHelpCardView('/ ?', COMMANDS, SKILLS)).toBeNull();
	});
});
