// Web Storage stub (RCA 2026-10-25): Node 26 ships a built-in
// globalThis.localStorage/sessionStorage ACCESSOR that returns undefined
// unless --localstorage-file is provided ("ExperimentalWarning: localStorage
// is not available"). Vitest installs the happy-dom window over the Node
// global with window === globalThis, so Node's own getter SHADOWS the
// happy-dom storage on every path — typeof localStorage === 'undefined'
// in every happy-dom suite. The Node accessor is configurable, so this
// setup file replaces it with a deterministic Map-backed implementation
// before any test runs. Harmless under the node project too.
const store = (data = new Map<string, string>()) => {
	const storage: Storage = {
		get length() {
			return data.size;
		},
		key(index: number): string | null {
			const keys = [...data.keys()];
			return index >= 0 && index < keys.length ? keys[index] : null;
		},
		getItem(key: string): string | null {
			return data.has(key) ? data.get(key)! : null;
		},
		setItem(key: string, value: string): void {
			data.set(String(key), String(value));
		},
		removeItem(key: string): void {
			data.delete(key);
		},
		clear(): void {
			data.clear();
		}
	};
	return storage;
};

for (const name of ['localStorage', 'sessionStorage'] as const) {
	Object.defineProperty(globalThis, name, {
		value: store(),
		writable: true,
		configurable: true,
		enumerable: true
	});
}
