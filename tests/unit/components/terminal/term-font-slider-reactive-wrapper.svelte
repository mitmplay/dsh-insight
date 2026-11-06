<script lang="ts">
	import TermFontSlider from '$lib/components/terminal/TermFontSlider.svelte';
	let font = $state(12);
	let cls = $state('');
</script>

<button onclick={() => { font = 18; cls = 'justify-end extra'; }}>bump</button>
<TermFontSlider {font} onchange={(px) => (font = px)} label="rw" testid="rw" class={cls} />
