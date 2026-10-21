/**
 * command-help (2026-08-30) — the composer's `?` help intent: a draft line
 * that is a known command with `?` as its ENTIRE first argument asks
 * "how do I use this?" instead of sending anything:
 *
 *   /new ?            /permission ?            @<session-id> ?
 *
 * Pure detection + the per-command help copy; the popup is
 * CommandHelpCard.svelte, hosted by Composer beside the Suggest Strip.
 * Submit is guarded upstream (Composer): a `?` help line never reaches
 * parseCommand's execute path, so `/permission ?` can never hit the host
 * wire as a bogus preset and `/new foo` keeps its existing usage error.
 *
 * Trigger grammar — the TRIMMED line is
 *   - a parseCommand-known slash command whose args are exactly `?`
 *     (`/new ?` — trim- and case-tolerant through the parser), or
 *   - `@` + one non-whitespace token + whitespace + `?`. The mention help
 *     deliberately accepts a non-uuid token too: a new user asking for
 *     help rarely has a real session uuid at hand, and parseCommand's
 *     uuid gate would strand them. Nothing real is shadowed — a genuine
 *     message is never literally `?`, and `@foo` without ` ?` stays
 *     ordinary text (the parser's own passthrough rule).
 *
 * Mutually exclusive with the Suggest Strip by construction: the finder
 * triggers only on a LEADING `?`/`!`, the help intent only on a leading
 * `/` or an `@token ?` tail.
 */

import { t } from '$lib/services/locale/locale-state.svelte';
import * as m from '$lib/paraglide/messages';
import type { DsiCommandRow, DsiGestureRow, DsiSkillRow } from '$lib/types';
import { parseCommand } from './command-parser';

/** One help topic — the command the `?` line asks about. */
export type CommandHelpTopic =
	| 'new'
	| 'workspace'
	| 'permission'
	| 'mention'
	| 'promptmanager'
	| 'terminal'
	| 'dsisettings'
	| 'dshsettings'
	| 'skillshelf'
	| 'pluginrack';

/**
 * The help topic a draft line asks for, or null when the line is not a
 * `?` help request (ordinary text, a real command, or an unknown token).
 */
export function commandHelpTopic(text: string): CommandHelpTopic | null {
	const trimmed = text.trim();
	if (trimmed === '') return null;
	if (trimmed.startsWith('@')) {
		return /^@\S+\s+\?$/.test(trimmed) ? 'mention' : null;
	}
	const command = parseCommand(trimmed);
	if (command === null || command.type === 'mention') return null;
	// Retired Typed Command ADR D1 (2026-09-17): /loadinjected has no help
	// topic — the union narrowed with the MENU_GESTURES row's removal.
	if (command.type === 'loadinjected') return null;
	return command.args === '?' ? command.type : null;
}

/** Help copy for one command — usage line, summary, parameters, examples. */
export interface CommandHelpEntry {
	/** The canonical usage line (the card's first line). */
	usage: string;
	/** One sentence: what the command does. */
	summary: string;
	/** Parameter rows — name and what it means. */
	params: { name: string; description: string }[];
	/** Concrete example lines with what each does. */
	examples: { line: string; description: string }[];
}

/** The help card copy, per topic. Preset names mirror the shipped
 *  PRESET_TABLE (permission-state); ids/examples mirror command-parser. */
export const COMMAND_HELP: Record<CommandHelpTopic, CommandHelpEntry> = {
	new: {
		usage: '/new [@agent] [workspace] [--add]',
		summary: "Creates a fresh session — it inherits this session's workspace and agent. Name a registered workspace to land THERE instead of inheriting (unique title, or the full path). Default: it replaces this panel. With --add: it opens in a NEW panel to the right, and focus stays here.",
		params: [
			{
				name: '@agent',
				description:
					'Optional agent preset id for the new session (overrides the inherited agent). The host validates the id.'
			},
			{
				name: 'workspace',
				description:
					'Optional registered workspace — a unique title (recipe-ws) or the full path (/home/u/recipe-ws). The new session runs there instead of inheriting; an ambiguous name lists the candidates instead of guessing.'
			},
			{
				name: '--add',
				description:
					'Open the new session in a NEW panel placed to the RIGHT of the current panel; the current panel keeps the selection and the caret (the default panel swap never runs).'
			}
		],
		examples: [
			{ line: '/new', description: 'New session — same workspace, same agent, in this panel.' },
			{ line: '/new @reviewer', description: 'New session running the reviewer agent preset.' },
			{ line: '/new recipe-ws', description: 'New session inside the registered recipe-ws workspace.' },
			{ line: '/new @app-dev --add', description: 'New app-dev session in a panel to the right — this panel keeps focus.' }
		]
	},
	workspace: {
		usage: '/workspace <full-path> [name]',
		summary: 'Adopts a folder on the host as a workspace — the typed twin of the sidebar\u2019s Add-workspace picker. The folder must already exist (DSI never writes the filesystem; ask the agent to mkdir first). An optional name titles the workspace WHEN this command created it; the fresh-desk recipe: /workspace ~/workspace-ai, then /new workspace-ai.',
		params: [
			{
				name: '<full-path>',
				description:
					'Absolute or ~ path to the folder (a ~ expands against the host\u2019s home). A relative path is refused before anything is sent.'
			},
			{
				name: '[name]',
				description:
					'Optional display title — applied only when this command created the workspace; an already-adopted folder keeps its title (rename it from the chip menu).'
			}
		],
		examples: [
			{
				line: '/workspace ~/workspace-ai',
				description: 'Adopt the folder — the host titles it workspace-ai (the path\u2019s last segment).'
			},
			{
				line: '/workspace ~/workspace-ai MyWS',
				description: 'Adopt AND title it MyWS — the rename applies only when this command created it.'
			},
			{
				line: '/new workspace-ai',
				description: 'The follow-up: a fresh session running inside the adopted workspace.'
			}
		]
	},
	terminal: {
		usage: '/dsi-terminal [--new-tab | --split-down]',
		summary:
			'Aims the operator terminal desk: the open desk takes the focus; otherwise a NEW panel opens to the right of this conversation. --new-tab appends a tab; --split-down stacks another shell under the selected one; the two flags cannot combine. Renders the disabled note unless terminal.enabled is set in settings.',
		params: [],
		examples: [
			{
				line: '/dsi-terminal',
				description: 'The terminal desk comes forward — beside this conversation if it was closed.'
			},
			{
				line: '/dsi-terminal --new-tab',
				description: 'A new desk tab, selected; the previous tab keeps running, hidden.'
			},
			{
				line: '/dsi-terminal --split-down',
				description: 'Another shell stacked under the selected one, in the same tab.'
			}
		]
	},
	promptmanager: {
		usage: '/dsi-prompts',
		summary:
			'Aims the prompts manager panel: if one is already open it takes the focus; otherwise it opens in a NEW panel to the right of this conversation — and takes the focus. Nothing you have open is ever replaced.',
		params: [],
		examples: [
			{
				line: '/dsi-prompts',
				description: 'The prompts manager panel comes forward — opened beside this conversation if it was closed.'
			}
		]
	},
	dsisettings: {
		usage: '/dsi-settings',
		summary:
			'Aims the DSI settings home explorer (~/.dsi, titled “DSI - Settings”): the open explorer takes the focus; otherwise a NEW explorer opens to the right of this conversation, selected. settings.yaml opens as a tab and stays editable; saves are YAML-checked on read.',
		params: [],
		examples: [
			{
				line: '/dsi-settings',
				description: 'The DSI settings explorer comes forward — opened beside this conversation if it was closed.'
			}
		]
	},
	skillshelf: {
		usage: '/dsi-skills [--reload]',
		// The Shelf Voice W1.5 (BUG-2 fix): the shelf pilots localized help
		// copy - getters resolve the ACTIVE locale at read time, so the card
		// re-renders in the operator's language when the locale flips.
		get summary() {
			return t(m.commandHelpSkillshelfSummary);
		},
		params: [
			{
				name: '--reload',
				get description() {
					return t(m.commandHelpSkillshelfParamReload);
				}
			}
		],
		examples: [
			{
				line: '/dsi-skills',
				get description() {
					return t(m.commandHelpSkillshelfExampleBare);
				}
			},
			{
				line: '/dsi-skills --reload',
				get description() {
					return t(m.commandHelpSkillshelfExampleReload);
				}
			},
			{
				line: '/dsi-skills ?',
				get description() {
					return t(m.commandHelpSkillshelfExampleHelp);
				}
			}
		]
	},
	pluginrack: {
		usage: '/dsi-plugins [--reload]',
		// The rack pilots the shelf's localized-help grammar (The Shelf
		// Voice W1.5): getters resolve the ACTIVE locale at read time.
		get summary() {
			return t(m.commandHelpPluginrackSummary);
		},
		params: [
			{
				name: '--reload',
				get description() {
					return t(m.commandHelpPluginrackParamReload);
				}
			}
		],
		examples: [
			{
				line: '/dsi-plugins',
				get description() {
					return t(m.commandHelpPluginrackExampleBare);
				}
			},
			{
				line: '/dsi-plugins --reload',
				get description() {
					return t(m.commandHelpPluginrackExampleReload);
				}
			},
			{
				line: '/dsi-plugins ?',
				get description() {
					return t(m.commandHelpPluginrackExampleHelp);
				}
			}
		]
	},
	dshsettings: {
		usage: '/dsh-settings',
		summary:
			'Aims the harness settings home explorer (~/.dsh, titled “DSH - Settings”): the open explorer takes the focus; otherwise a NEW explorer opens to the right of this conversation, selected. settings.yaml opens as a tab and stays editable; the running harness picks edits up through its own file watcher.',
		params: [],
		examples: [
			{
				line: '/dsh-settings',
				description: 'The DSH settings explorer comes forward — opened beside this conversation if it was closed.'
			}
		]
	},
	permission: {
		usage: '/permission [preset]',
		summary: "Shows or switches this session's access mode. Bare, it prints the current preset.",
		params: [
			{
				name: 'preset',
				description:
					'Access-mode preset: read-only · workspace-write · danger-full-access — the same options the Access chip offers.'
			}
		],
		examples: [
			{ line: '/permission', description: 'Print the current access mode.' },
			{
				line: '/permission workspace-write',
				description: 'Allow writes inside the workspace; anything wider still asks.'
			}
		]
	},
	mention: {
		usage: '@<session-id> <message>',
		summary:
			'Sends your message to ANOTHER session as a queued prompt and opens its panel — the reply lands there.',
		params: [
			{
				name: '<session-id>',
				description: "The target session's id — 'session-<uuid>' or the bare uuid tail, as shown in the sidebar."
			},
			{
				name: '<message>',
				description: "The text to deliver. It queues behind the target's current turn when it is busy."
			}
		],
		examples: [
			{
				line: '@session-9f0c… what changed in the auth flow?',
				description: 'Ask that session a question; its panel opens with the reply.'
			}
		]
	}
};

/**
 * The slash menu's DSI-gesture section (Slash Menu ADR §1.1, layer A):
 * the client gestures `command-parser` owns, surfaced beside the host's
 * two catalogs. Rows derive from COMMAND_HELP — the one copy source, so
 * the menu adds zero names of its own (§4.2). `/permission` is absent:
 * it rides the host's own command catalog (layer B) and needs no client
 * row. Pick semantics are insert-only (`seed` lands, nothing sends) —
 * the two-press rule; the seeded draft travels the existing submit
 * ladder unchanged.
 */
export const MENU_GESTURES: readonly DsiGestureRow[] = [
	{
		name: 'new',
		display: '/new',
		seed: '/new ',
		description: COMMAND_HELP.new.summary
	},
	{
		name: 'workspace',
		display: '/workspace',
		seed: '/workspace ',
		// Workspace Command ADR D6 (2026-09-15): the derived row — one more
		// COMMAND_HELP entry, the zero-extra-names rule holds.
		description: COMMAND_HELP.workspace.summary
	},
	{
		name: 'terminal',
		display: '/dsi-terminal',
		seed: '/dsi-terminal ',
		// Web Terminal spec (2026-09-24): one row per COMMAND_HELP, the
		// zero-extra-names rule holds.
		description: COMMAND_HELP.terminal.summary
	},
	{
		name: 'promptmanager',
		display: '/dsi-prompts',
		seed: '/dsi-prompts ',
		// W6 follow-up (2026-09-06): the D7 command joins the menu — one
		// row per COMMAND_HELP, the zero-extra-names rule holds.
		description: COMMAND_HELP.promptmanager.summary
	},
	{
		name: 'skillshelf',
		display: '/dsi-skills',
		seed: '/dsi-skills ',
		// The Shelf Voice W1 (RCA fix, 2026-09-21): one row per COMMAND_HELP,
		// the zero-extra-names rule holds - and the completeness guard now
		// enforces it. Getter (W1.5): the description resolves the ACTIVE
		// locale at render, never frozen at module init.
		get description() {
			return t(m.commandHelpSkillshelfSummary);
		}
	},
	{
		name: 'pluginrack',
		display: '/dsi-plugins',
		seed: '/dsi-plugins ',
		// The Plugin Rack ADR (2026-09-27, D1): one row per COMMAND_HELP,
		// the zero-extra-names rule holds. Getter: the description
		// resolves the ACTIVE locale at render, never frozen at init.
		get description() {
			return t(m.commandHelpPluginrackSummary);
		}
	},
	{
		name: 'dsisettings',
		display: '/dsi-settings',
		seed: '/dsi-settings ',
		// Settings Panel ADR D3 (2026-09-07): one row per COMMAND_HELP,
		// the zero-extra-names rule holds.
		description: COMMAND_HELP.dsisettings.summary
	},
	{
		name: 'dshsettings',
		display: '/dsh-settings',
		seed: '/dsh-settings ',
		description: COMMAND_HELP.dshsettings.summary
	},
	{
		name: '@mention',
		display: '@mention',
		seed: '@session-',
		description: COMMAND_HELP.mention.summary
	}
];

/**
 * Everything the help card renders, prebuilt — the card is fully
 * presentational and both feeders (DSI gesture copy, host catalog rows)
 * produce this one shape.
 */
export interface HelpCardView {
	/** The usage line (the card's first row, `<code>`). */
	usage: string;
	/** The tag chip beside the usage — 'help' (DSI gesture), 'command',
	 *  or 'skill' (host vocabulary). */
	tag: string;
	/** One-sentence summary. */
	summary: string;
	/** Parameter rows — name and what it means. */
	params: { name: string; description: string }[];
	/** Concrete example lines with what each does. */
	examples: { line: string; description: string }[];
	/** Optional run-path note — how the line travels when sent. */
	note?: string;
}

/** The card view for one DSI gesture — the COMMAND_HELP copy, verbatim. */
export function gestureHelpCardView(topic: CommandHelpTopic): HelpCardView {
	const help = COMMAND_HELP[topic];
	return {
		usage: help.usage,
		tag: 'help',
		summary: help.summary,
		params: help.params,
		examples: help.examples
	};
}

/**
 * The `?` help shape for a NON-gesture `/` draft: first token, then `?`
 * as the entire remainder. Null for everything else — DSI gestures keep
 * priority (parseCommand accepts their drafts first, so `/new ?` never
 * reaches here), a bare token is not a question, and a `?` in any other
 * position is ordinary text. The token is lowercased — the ladder and
 * the menu both match case-insensitively.
 */
export function helpQuery(text: string): { token: string } | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith('/') || trimmed.length < 2) return null;
	if (parseCommand(trimmed) !== null) return null;
	const at = trimmed.search(/\s/);
	if (at === -1) return null;
	if (trimmed.slice(at).trim() !== '?') return null;
	return { token: trimmed.slice(1, at).toLowerCase() };
}

/**
 * The host-vocabulary help card for a `/token ?` draft, or null when the
 * shape is absent or the token names nothing in the cached catalog. The
 * copy is the wire's own — description, `input.hint`, `whenToUse` — DSI
 * invents no parameter and no example (§4.2). A name in BOTH catalogs
 * resolves to the COMMAND (the native adjudication rule, §3.2). The run
 * path rides the note: a command is executed host-side and never reaches
 * the model; a skill ships as the prompt's first token and the host
 * injects the body (with the operator-only wording when the host marks
 * `modelInvocable: false`).
 */
export function hostHelpCardView(
	text: string,
	commands: readonly DsiCommandRow[],
	skills: readonly DsiSkillRow[]
): HelpCardView | null {
	const q = helpQuery(text);
	if (q === null || q.token === '') return null;
	const command = commands.find((c) => c.name.toLowerCase() === q.token);
	if (command !== undefined) {
		return {
			usage: `/${command.name}${command.input?.hint !== undefined ? ' ' + command.input.hint : ''}`,
			tag: 'command',
			summary: command.description,
			params:
				command.input?.hint !== undefined
					? [
							{
								name: command.input.hint,
								description: 'Arguments the host expects — the whole line rides one commands/execute.'
							}
						]
					: [],
			examples: [],
			note: 'Executed by the session host-side — this line never reaches the model.'
		};
	}
	const skill = skills.find((s) => s.name.toLowerCase() === q.token);
	if (skill !== undefined) {
		return {
			usage: `/${skill.name}`,
			tag: 'skill',
			summary: skill.description,
			params:
				skill.whenToUse !== undefined && skill.whenToUse !== ''
					? [{ name: 'when', description: skill.whenToUse }]
					: [],
			examples: [],
			note:
				skill.modelInvocable === false
					? 'Shipped as the first token of your prompt — only you can invoke this skill; the model cannot.'
					: 'Shipped as the first token of your prompt — the host injects the skill body for that turn.'
		};
	}
	return null;
}
