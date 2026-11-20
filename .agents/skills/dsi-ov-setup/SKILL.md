---
name: dsi-ov-setup
description: Use when OpenViking memory is broken or missing in DeepSeek Harness — server disconnected, server not installed, ov.conf missing, plugin not loaded, or a fresh machine needs the whole OpenViking + DSH memory integration set up (plugin, skill, server). Covers diagnosis, install, config, start, and verification.
---

# OpenViking + DSH Setup and Recovery

Companion KB: `dev/kb/setup/2026-09-16 - OpenViking Server + DSH Memory Plugin — From Cold Start to Recalled Memory.md` — read it for the why behind every step. This skill is the do-path.

## 0. Diagnose first — which failure is this?

Run in order; stop at the first failing gate:

| Gate | Command | Healthy looks like |
|---|---|---|
| Server process | `curl -s --max-time 3 http://127.0.0.1:1933/health` | `{"status":"ok","healthy":true,...}` |
| Server config | `ls ~/.openviking/ov.conf` | exists |
| Client config | `cat ~/.openviking/ovcli.conf` | `url` = `http://127.0.0.1:1933` |
| Package | `openviking-server --version` | prints a version |
| Plugin installed | `grep @openviking ~/.dsh/profiles/web/package.json` + `ls ~/.dsh/profiles/web/node_modules/@openviking/dsh-memory-plugin` | both the bundle entry and the package exist |
| MCP connection | harness tool list shows `mcp__openviking__*` | tools present |

- Health fails + `ov.conf` missing → **Recovery path (§2)**, the common case.
- Health fails + `ov.conf` exists → run `openviking-server doctor`, fix what it names, go to §2 step 4.
- Plugin missing from manifest or `node_modules` → reinstall via the sanctioned path (§2 step 6): from the running host's checkout, `pnpm dsh plugin --profile web add @openviking/dsh-memory-plugin`. This persists both the dependency and the `dsh.profile.bundles` entry, so profile rebuilds keep it. A bare `pnpm install` in the profile dir is a dead end — bundles are not `dependencies` and pnpm reports "Already up to date" while the plugin stays missing (RCA 2026-09-18 — The Vanished Plugin).
- Health ok but MCP disconnected → the plugin reconnects on its own within a turn or two; if not after a full turn, restart the harness session. Do not reinstall anything.
- Package missing → fresh install: do §2 steps 1–6 from scratch.

## 1. Facts to keep straight (most-confused pair)

- `~/.openviking/ovcli.conf` — **client** pointer: `{"url": "http://127.0.0.1:1933", "api_key": ""}`. Missing it breaks CLI commands only.
- `~/.openviking/ov.conf` — **server** model config (embedding + VLM). Missing it means the server process cannot start at all. This is the usual blocker.
- The DSH plugin (`@openviking/dsh-memory-plugin`, in the profile bundles at `~/.dsh/profiles/web/package.json`) is a **client only** — it never starts the server, and it reconnects automatically once the server is healthy. Never "fix" a disconnected MCP by touching the plugin.
- `openviking`/`ov` = CLI/SDK; `openviking-server` = the daemon. Same pip package.

## 2. Recovery / install path

### Step 1 — Install the package (skip if `openviking-server --version` works)

```sh
pip install openviking --upgrade --force-reinstall
```

Entry points land in `~/.local/bin`: `ov`, `openviking`, `openviking-server`, `vikingbot`.

### Step 2 — CLI housekeeping

```sh
ov language en        # v0.3.23+ refuses most commands without this; writes ovcli.settings.conf
ov config add custom --name local --url http://127.0.0.1:1933 --activate -o json   # only if ovcli.conf missing
```

Note: both write under `~/.openviking/` — they fail under a workspace-only file sandbox; run with full file access.

### Step 3 — Create the server config: `openviking-server init`

Preferred: run it interactively and let the human answer. If driving it with piped answers, the wizard's prompt order is exact and hidden prompts exist — the tested sequence for the recommended local setup:

```
1     # mode: step-by-step
3     # embedding: lightweight CPU (llama.cpp, bge-small-zh-v1.5-f16, no key)
1     # embedding model: (only option — EASY TO MISS; missing this shifts every later answer)
6     # VLM: GLM (subscription API key)
2     # GLM plan: coding
<key> # API key — pass via stdin from an env var; NEVER in the command line or logs
N     # query planner via Ollama: no
1     # bind 127.0.0.1 (dev, no auth)
1933  # port
Y     # save
```

After saving the wizard echoes the resolved API key in its summary — **redact any captured log** before storing it.

Decision guardrails (from the KB §4): embedding `[3]` CPU is the default because it is keyless and tiny; offer `[1]` cloud embedding only when the user cares about retrieval quality and has a key; VLM is the piece worth a strong model — GLM via an existing subscription beats skipping it. `[9]` skip-VLM gives a server that stores but extracts poorly.

### Step 4 — Wait out the build

Choosing CPU embedding triggers `pip install "openviking[local-embed]"`, which **builds `llama-cpp-python` from source** — several minutes of silent wheel-building. It is not hung. Do not kill it; verify with `ps aux | grep "openviking-server init"`.

### Step 5 — Validate and start

```sh
openviking-server doctor    # expect: all checks PASS (config, auth, disk ≥ several GB)
openviking-server           # foreground proof; then move to a supervisor
```

Sandbox warning: server startup acquires a PID lock at
`~/.openviking/data/.openviking.pid` — under a workspace-only file sandbox it
dies with `PermissionError` / exit 3 at once. Start the server with full file
access (same as step 2's CLI housekeeping).

For persistence: launchd/systemd — never rely on an agent shell outliving the
session. In a harness session, never start the daemon with `nohup … &` inside a
**foreground** bash call: the harness reaps the call's process group when the
call returns and the daemon dies seconds later, health-ok inside the call but
connection-refused on the next one (RCA 2026-09-21 — The Server That Slept).
Run it as a harness background job instead. Verify:

```sh
curl -s http://127.0.0.1:1933/health   # {"status":"ok","healthy":true,...}
ov status                              # "Connected (Healthy)", queue 0 pending / 0 errors
```

A stale `~/.openviking/pending/` queue (hundreds of files) from the downtime drains on its own — do not delete it.

### Step 6 — Confirm the integration

Within a turn of the server going healthy, the plugin reconnects (MCP tools answer, `<openviking-context>` appears at the next session start). If MCP tools still error after a full turn: restart the harness session once. Only then suspect the bundle (`~/.dsh/profiles/web/package.json` must list `@openviking/dsh-memory-plugin` in `dsh.profile.bundles`).

If the plugin must be (re)installed, run from the **running host's checkout** (find it: `lsof -p <dsh-web-pid> | grep cwd`):

```sh
pnpm dsh plugin --profile web add @openviking/dsh-memory-plugin
```

This is the only install path that reconciles `dsh.profile.bundles` and survives profile rebuilds. With `patchReload: "live"` in the manifest the profile recomposes without a host restart and `<openviking-context>` returns mid-session.

## 3. Verification checklist (all seven, in order)

1. `openviking-server --version` → prints version
2. `ls ~/.openviking/ov.conf ~/.openviking/ovcli.conf` → both exist
3. `openviking-server doctor` → all PASS
4. `curl -s http://127.0.0.1:1933/health` → `"healthy":true`
5. `ov status` → Connected (Healthy), 0 errors
6. `ov find "smoke test"` after any resource exists → ranked hits, not a connection error
7. New session → `<openviking-context>` block present

## 4. Known traps

- `ov status` saying "Unreachable" while the server is fine → the language gate; run `ov language en` first.
- Two config files, one directory (§1) — check the right one for the symptom.
- `auth_mode: "dev"` = no auth, localhost only. Never bind `0.0.0.0` without switching to API-key auth (docs: Authentication guide).
- Piped `init` answers are prompt-order-fragile (Step 3) — count prompts, don't trust defaults.
---
name: dsi-ov-setup
description: Use when OpenViking memory is broken or missing in DeepSeek Harness — server disconnected, server not installed, ov.conf missing, plugin not loaded, or a fresh machine needs the whole OpenViking + DSH memory integration set up (plugin, skill, server). Covers diagnosis, install, config, start, and verification.
---

# OpenViking + DSH Setup and Recovery

Companion KB: `dev/kb/setup/2026-09-16 - OpenViking Server + DSH Memory Plugin — From Cold Start to Recalled Memory.md` — read it for the why behind every step. This skill is the do-path.

## 0. Diagnose first — which failure is this?

Run in order; stop at the first failing gate:

| Gate | Command | Healthy looks like |
|---|---|---|
| Server process | `curl -s --max-time 3 http://127.0.0.1:1933/health` | `{"status":"ok","healthy":true,...}` |
| Server config | `ls ~/.openviking/ov.conf` | exists |
| Client config | `cat ~/.openviking/ovcli.conf` | `url` = `http://127.0.0.1:1933` |
| Package | `openviking-server --version` | prints a version |
| Plugin installed | `grep @openviking ~/.dsh/profiles/web/package.json` + `ls ~/.dsh/profiles/web/node_modules/@openviking/dsh-memory-plugin` | both the bundle entry and the package exist |
| MCP connection | harness tool list shows `mcp__openviking__*` | tools present |

- Health fails + `ov.conf` missing → **Recovery path (§2)**, the common case.
- Health fails + `ov.conf` exists → run `openviking-server doctor`, fix what it names, go to §2 step 4.
- Plugin missing from manifest or `node_modules` → reinstall via the sanctioned path (§2 step 6): from the running host's checkout, `pnpm dsh plugin --profile web add @openviking/dsh-memory-plugin`. This persists both the dependency and the `dsh.profile.bundles` entry, so profile rebuilds keep it. A bare `pnpm install` in the profile dir is a dead end — bundles are not `dependencies` and pnpm reports "Already up to date" while the plugin stays missing (RCA 2026-09-18 — The Vanished Plugin).
- Health ok but MCP disconnected → the plugin reconnects on its own within a turn or two; if not after a full turn, restart the harness session. Do not reinstall anything.
- Package missing → fresh install: do §2 steps 1–6 from scratch.

## 1. Facts to keep straight (most-confused pair)

- `~/.openviking/ovcli.conf` — **client** pointer: `{"url": "http://127.0.0.1:1933", "api_key": ""}`. Missing it breaks CLI commands only.
- `~/.openviking/ov.conf` — **server** model config (embedding + VLM). Missing it means the server process cannot start at all. This is the usual blocker.
- The DSH plugin (`@openviking/dsh-memory-plugin`, in the profile bundles at `~/.dsh/profiles/web/package.json`) is a **client only** — it never starts the server, and it reconnects automatically once the server is healthy. Never "fix" a disconnected MCP by touching the plugin.
- `openviking`/`ov` = CLI/SDK; `openviking-server` = the daemon. Same pip package.

## 2. Recovery / install path

### Step 1 — Install the package (skip if `openviking-server --version` works)

```sh
pip install openviking --upgrade --force-reinstall
```

Entry points land in `~/.local/bin`: `ov`, `openviking`, `openviking-server`, `vikingbot`.

### Step 2 — CLI housekeeping

```sh
ov language en        # v0.3.23+ refuses most commands without this; writes ovcli.settings.conf
ov config add custom --name local --url http://127.0.0.1:1933 --activate -o json   # only if ovcli.conf missing
```

Note: both write under `~/.openviking/` — they fail under a workspace-only file sandbox; run with full file access.

### Step 3 — Create the server config: `openviking-server init`

Preferred: run it interactively and let the human answer. If driving it with piped answers, the wizard's prompt order is exact and hidden prompts exist — the tested sequence for the recommended local setup:

```
1     # mode: step-by-step
3     # embedding: lightweight CPU (llama.cpp, bge-small-zh-v1.5-f16, no key)
1     # embedding model: (only option — EASY TO MISS; missing this shifts every later answer)
6     # VLM: GLM (subscription API key)
2     # GLM plan: coding
<key> # API key — pass via stdin from an env var; NEVER in the command line or logs
N     # query planner via Ollama: no
1     # bind 127.0.0.1 (dev, no auth)
1933  # port
Y     # save
```

After saving the wizard echoes the resolved API key in its summary — **redact any captured log** before storing it.

Decision guardrails (from the KB §4): embedding `[3]` CPU is the default because it is keyless and tiny; offer `[1]` cloud embedding only when the user cares about retrieval quality and has a key; VLM is the piece worth a strong model — GLM via an existing subscription beats skipping it. `[9]` skip-VLM gives a server that stores but extracts poorly.

### Step 4 — Wait out the build

Choosing CPU embedding triggers `pip install "openviking[local-embed]"`, which **builds `llama-cpp-python` from source** — several minutes of silent wheel-building. It is not hung. Do not kill it; verify with `ps aux | grep "openviking-server init"`.

### Step 5 — Validate and start

```sh
openviking-server doctor    # expect: all checks PASS (config, auth, disk ≥ several GB)
openviking-server           # foreground proof; then move to a supervisor
```

Sandbox warning: server startup acquires a PID lock at
`~/.openviking/data/.openviking.pid` — under a workspace-only file sandbox it
dies with `PermissionError` / exit 3 at once. Start the server with full file
access (same as step 2's CLI housekeeping).

For persistence: launchd/systemd — never rely on an agent shell outliving the
session. In a harness session, never start the daemon with `nohup … &` inside a
**foreground** bash call: the harness reaps the call's process group when the
call returns and the daemon dies seconds later, health-ok inside the call but
connection-refused on the next one (RCA 2026-09-21 — The Server That Slept).
Run it as a harness background job instead. Verify:

```sh
curl -s http://127.0.0.1:1933/health   # {"status":"ok","healthy":true,...}
ov status                              # "Connected (Healthy)", queue 0 pending / 0 errors
```

A stale `~/.openviking/pending/` queue (hundreds of files) from the downtime drains on its own — do not delete it.

### Step 6 — Confirm the integration

Within a turn of the server going healthy, the plugin reconnects (MCP tools answer, `<openviking-context>` appears at the next session start). If MCP tools still error after a full turn: restart the harness session once. Only then suspect the bundle (`~/.dsh/profiles/web/package.json` must list `@openviking/dsh-memory-plugin` in `dsh.profile.bundles`).

If the plugin must be (re)installed, run from the **running host's checkout** (find it: `lsof -p <dsh-web-pid> | grep cwd`):

```sh
pnpm dsh plugin --profile web add @openviking/dsh-memory-plugin
```

This is the only install path that reconciles `dsh.profile.bundles` and survives profile rebuilds. With `patchReload: "live"` in the manifest the profile recomposes without a host restart and `<openviking-context>` returns mid-session.

## 3. Verification checklist (all seven, in order)

1. `openviking-server --version` → prints version
2. `ls ~/.openviking/ov.conf ~/.openviking/ovcli.conf` → both exist
3. `openviking-server doctor` → all PASS
4. `curl -s http://127.0.0.1:1933/health` → `"healthy":true`
5. `ov status` → Connected (Healthy), 0 errors
6. `ov find "smoke test"` after any resource exists → ranked hits, not a connection error
7. New session → `<openviking-context>` block present

## 4. Known traps

- `ov status` saying "Unreachable" while the server is fine → the language gate; run `ov language en` first.
- Two config files, one directory (§1) — check the right one for the symptom.
- `auth_mode: "dev"` = no auth, localhost only. Never bind `0.0.0.0` without switching to API-key auth (docs: Authentication guide).
- Piped `init` answers are prompt-order-fragile (Step 3) — count prompts, don't trust defaults.
- When a D4 peer-dependency rejection forces `dsh plugin allow-version`, allow the **exact** plugin version and then install by **exact pin** (`add pkg@0.5.16`, not a `^` range) — a caret range can resolve to a sibling version the exemption does not cover, and the install rolls back (RCA 2026-09-24).
- Re-examine actual prompt output on every version bump; this sequence was tested against OpenViking 0.4.20 / plugin 0.3.2 (2026-09-16) and the wizard's prompts are not a stable contract.
- **Prompt-order drift (seen 2026-11-20, OV 0.4.20):** the wizard may skip the "GLM plan" prompt entirely — the API-key prompt follows GLM selection directly, so a piped plan answer is consumed AS the key and the key lands in `model`. Always re-read `ov.conf` (redacted) after init and assert the `model` field holds a model name (e.g. `glm-4.6v`), never a key; repair programmatically from the env var if swapped.

## 5. Report the run — always, before finishing

Every execution of this skill — recovery, install, or clean-bill-of-health —
ends by writing an RCA report so the next run diffs from a written baseline.

- Path: `~/.dsi/dev/ov/YYYY-MM-DD HH-MM - <Short Name> — <What Happened>.md`
  (mkdir the directory first; date = when the analysis ran, 24h `HH-MM` to
  keep colons out of the filename).
- Required sections: TL;DR (+ layman glossary), symptom & diagnosis path
  (the §0 gate table with pass/fail per gate), one RCA block per root cause
  with file/line evidence, a mermaid **flowchart** (the journey, failed
  branches colored) and a mermaid **sequenceDiagram** (who talks to whom),
  fix application & testing (command → result table), corrective actions,
  and a closing **open question**.
- Exemplar: `~/.dsi/dev/ov/2026-09-18 09-56 - The Vanished Plugin and the
  Sandboxed Lock — OpenViking Recovery RCA.md`.
- If the run surfaced a new trap or fixed a gap in this skill, update this
  SKILL.md (repo copy at `deepseek-insight/.agents/skills/dsi-ov-setup/`),
  then re-copy to the mirror `~/.agents/skills/dsi-ov-setup/` — a skill the
  slash menu never sees is a skill nobody invokes.
