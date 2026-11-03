#!/bin/sh
# dsh-web-synced — run `dsh web` under a stdout watcher that keeps DSI's
# launch token fresh while the server runs.
#
# Why: DSH's ?token= launch token is keyed on the root Cordis context
# (packages/client/connection/src/index.ts, BrowserAuth.create(ctx.root, ...)).
# Every tree reboot — self-modification reload, bundle/patch change — mints a
# NEW token in the SAME process and prints the URL line again. DSI reads
# dsh.authToken from settings.yaml with no cache and re-reads on every 401
# retry (src/lib/server/dsh-connection.ts), so rewriting the file is enough —
# no DSI restart. This script is that rewrite: each "dsh web: http://...token="
# line on stdout updates the authToken within the same second the server
# re-announces.
#
# Usage:
#   scripts/dsh-web-synced.sh [same flags as dsh web]   (e.g. --no-open, --port N)
#
# The host runs from the PUBLISHED package: npx @deepseek-ai/dsh@VERSION web —
# no DSH checkout needed. VERSION comes from $DSH_WEB_VERSION, which `dsi dsh
# --sync` sets from DSI's package.json dsh.webVersion pin (exact version, so a
# registry release cannot change the API contract under DSI); unset, it falls
# back to the "latest" tag (the "next" tag can be a release ahead). To run a
# source tree instead, point DSH_WEB_CMD at a full command, e.g.
# DSH_WEB_CMD='pnpm --dir ~/agentic-ai/deepseek-harness dsh' — it wins over
# the pin.
#
# Config file resolution matches DSI's reader exactly: $DSI_CONFIG_PATH or
# ~/.dsi/settings.yaml. The yaml package is loaded from DSI's
# node_modules — run this script from anywhere.

set -eu

DSI_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CONFIG_PATH=${DSI_CONFIG_PATH:-$HOME/.dsi/settings.yaml}

update_token() {
  token=$1
  # The token rides an env var, not argv: a launch token is a credential and
  # argv is readable in ps(1) output by every local process.
  DSI_ROOT="$DSI_ROOT" CONFIG_PATH="$CONFIG_PATH" DSI_TOKEN="$token" node - <<'NODE'
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { createRequire } = require('node:module')
const requireFromDsi = createRequire(process.env.DSI_ROOT + '/package.json')
const { parse, stringify } = requireFromDsi('yaml')
const path = require('node:path')
const configPath = process.env.CONFIG_PATH
// First run (ENOENT 2026-11-04): settings.yaml may not exist yet — the token
// announce can be the very first thing to touch it. A missing file is the
// create case (same semantics as vt-plugins/lib/dsh-token-sink.ts); only a
// PRESENT-but-unparseable file stays a failure (a silent skip would leave
// DSI dialing a dead token forever).
let raw = null
try {
  raw = readFileSync(configPath, 'utf8')
} catch (e) {
  if (e.code !== 'ENOENT') throw e
}
const doc = raw === null ? {} : (parse(raw) ?? {})
if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
  throw new Error('settings.yaml is not a YAML mapping')
}
doc.dsh = { ...doc.dsh, authToken: process.env.DSI_TOKEN }
mkdirSync(path.dirname(configPath), { recursive: true })
writeFileSync(configPath, stringify(doc))
// Tilde-compress $HOME so the log line stays portable (no /Users/<you> leak).
const home = require('node:os').homedir()
console.log('dsh-web-synced: authToken updated in ' + (home && configPath.startsWith(home) ? '~' + configPath.slice(home.length) : configPath))
NODE
}

# The watcher body: echo every line through, rewrite dsh.authToken whenever
# the server re-announces its launch token URL.
watch_host_stdin() {
  while IFS= read -r line; do
    printf '%s\n' "$line"
    case "$line" in
      "dsh web: "http://*token=*)
        update_token "${line##*token=}" || echo 'dsh-web-synced: WARNING — token capture failed' >&2
        ;;
    esac
  done
}

# DSH_WEB_CMD overrides the default published-package launch wholesale; the
# value is word-split and "web" plus the caller's flags are appended.
if [ -n "${DSH_WEB_CMD:-}" ]; then
  # shellcheck disable=SC2086 # intentional word split: the override is a command line
  $DSH_WEB_CMD web "$@" 2>&1 | watch_host_stdin
else
  npx --yes "@deepseek-ai/dsh@${DSH_WEB_VERSION:-latest}" web "$@" 2>&1 | watch_host_stdin
fi
