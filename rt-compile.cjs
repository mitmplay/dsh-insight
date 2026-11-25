
const s = require(require.resolve('svelte/compiler', { paths: ["/Users/wharsojo/agentic-ai/deepseek-insight"] }));
const f = require('fs');
const src = f.readFileSync('/Users/wharsojo/agentic-ai/deepseek-insight/src/lib/components/message/common/RelativeTime.svelte','utf8');
const out = s.compile(src, { generate: 'client', filename: 'RelativeTime.svelte' });
console.log(out.js.code);
