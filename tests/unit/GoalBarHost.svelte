<script lang="ts">
	import GoalBar from '$lib/components/anchor/goal/GoalBar.svelte';
	import type { GoalResultGoal } from '$lib/utils/goals';

	let { goal = undefined as GoalResultGoal | null | undefined } = $props();

	const events = $state<string[]>([]);
</script>

<GoalBar
	{goal}
	onpause={() => events.push('pause')}
	onresume={() => events.push('resume')}
	onclear={() => events.push('clear')}
	oncreate={() => events.push('create')}
	onedit={() => events.push('edit')}
/>

<input id="event-log" type="hidden" value={events.join(',')} />