<script lang="ts">
	import ConversationHeader from '$lib/components/conversation/header/ConversationHeader.svelte';

	let {
		sessionId = 'ses_test',
		title = 'My session' as string | null,
		initialTitle = null as string | null,
		workspace = null as string | null,
		access = null as string | null,
		agent = 'DeepSeek' as string | null,
		agentId = null as string | null,
		isStreaming = false,
		subagent = false,
		focused = false,
		parentSessionId = null as string | null
	} = $props();

	const events = $state<string[]>([]);
</script>

<ConversationHeader
	{sessionId}
	{title}
	{initialTitle}
	ontitlechange={(t) => events.push('title:' + t)}
	{workspace}
	{access}
	{agent}
	{agentId}
	{isStreaming}
	transcript={document.body}
	{subagent}
	plan={null}
	{parentSessionId}
	{focused}
/>

<input id="event-log" type="hidden" value={events.join(',')} />
