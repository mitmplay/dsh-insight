/**
 * reactive-props — a $state object for driving parent-style re-renders
 * from plain .ts test files. Runes only compile in .svelte.js modules,
 * so this helper is the bridge: mount(Component, { props: reactiveProps(...) })
 * and then mutate the returned object's fields — the component re-renders
 * exactly as it would when its owner replaces prop values.
 */
export function reactiveProps(init) {
	let props = $state(init);
	return props;
}
