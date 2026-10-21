<script lang="ts">
	// Test-only stub for FilterDateButton (sessions-list-header-view.test.ts):
	// mirrors its props into data-attributes so assertions are direct.
	let { value = '', dates = new Set<string>() }: { value?: string; dates?: Set<string> } =
		$props();
</script>

<div data-testid="filter-date-stub" data-value={value} data-dates={[...dates].sort().join(',')}>
</div>
