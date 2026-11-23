/**
 * Type shims for prettier's standalone browser build (ADR-0077 Amendment
 * 1, D5): the .mjs entry points ship runtime ESM without their own d.ts
 * paths resolved by svelte-check; the public shapes we consume match the
 * `prettier` package types, re-exported here.
 */
declare module 'prettier/standalone.mjs' {
	export * from 'prettier';
}

declare module 'prettier/plugins/typescript.mjs' {
	export const printers: unknown[];
	export const parsers: Record<string, unknown>;
}

declare module 'prettier/plugins/estree.mjs' {
	export const printers: unknown[];
}
