# DSI Drive Terminal — DO-path

Drive the operator's live Terminal Desk tab (T1, T2, …) over DSI's terminal
wire with curl — no browser, no glass. Mechanics + contract:
`dev/feature-contract-scenario/terminal-driving.md` (read once; this skill is
the procedure). Display never needs a token; WRITES do.

## 0. Resolve the floor + baton

```sh
PORT=5175   # dev floor (or the serving port)
curl -s http://127.0.0.1:$PORT/api/terminal            # list sessions (id + exited)
ID=t-1                                                   # the desk tab you mean
curl -s -X POST http://127.0.0.1:$PORT/api/terminal/$ID/reattach -o /tmp/t.json
TOK=$(sed 's/.*"token":"\([^"]*\)".*/\1/' /tmp/t.json)   # the baton — one holder
OFF=$(sed 's/.*"fromByte":\([0-9]*\).*/\1/' /tmp/t.json) # resume offset
```

No session? `POST /api/terminal` opens one (appears on the desk as a new
T-tab). Reattach kills the OTHER holder's token — fine: the operator's tab
auto-heals on its next keystroke (heal badge), and you heal the same way.

## 1. Type

Build the JSON body with node (never inline-quote shell strings — one bad
escape is a silent `BAD_REQUEST`), then send:

```sh
node -e 'const fs=require("fs");const tok=fs.readFileSync("/tmp/t1-token","utf8").trim();
fs.writeFileSync("/tmp/t1-cmd.json",JSON.stringify({token:tok,action:"write",data:"uname -a\r\n"}))'
curl -s -X POST http://127.0.0.1:$PORT/api/terminal/$ID/send \
  -H 'content-type: application/json' --data-binary @/tmp/t1-cmd.json
```

- **Human pace when the operator watches**: one char per write, ~120 ms
  apart, checking each response is `{"written":true}`. Faster bursts hit the
  write fence and DROP characters (live: `sudo apt update` → `sudoaptupdate`).
- **Machine commands** (install/build): one whole-line write is fine.
- **Password prompts**: type the secret the same way — PTY echo is off, the
  desk shows dots, the secret never lands in the scrollback.
- **403 FOREIGN_SESSION** → someone else holds the baton: reattach (step 0),
  retry the SAME keystroke once.
- **NEVER type while a command is still running** — keystrokes go into that
  process's stdin, silently.

## 2. Read (promptly — the ring is SMALL, ~2–3 KB)

```sh
curl -s "http://127.0.0.1:$PORT/api/terminal/$ID/output?fromByte=$OFF"
```

- Capture `$OFF` BEFORE sending the command; read right after. Old offsets
  return empty (rotated) — re-read `fromByte=0` for the full retained ring.
- Strip ANSI in the shell: `sed 's/\\u001b\[[0-9;?]*[a-zA-Z=]//g; s/\\u0007//g; s/\\r\\n/\n/g; s/\\n/\n/g; s/\\r//g'`.
- Long commands: write an end marker (`; echo STEP-DONE-$?`) and poll until
  it appears.

## 3. Show, don't hide

The operator watches the desk live. Run commands UNPIPED so progress paints;
if you must trim (huge logs), redirect to a file and `cat` a slice — never
`| tail` a build the operator is trying to watch.

## 4. The silent eater (writes say `written:true`, nothing executes)

Something interactive is consuming stdin. Met live: a `git push` username
prompt, an open commit editor, a package-manager approve prompt. Escape:

```sh
data:"\u0003\u0003"            # Ctrl+C twice
data:"\u001b:qa!\r"            # ESC + :qa! + Enter (vi family)
data:"echo ALIVE\r\n"          # marker — prompt answers = recovered
```

If the marker echoes, re-send the real command. Interactive prompts that
WAIT (approve-builds, credentials) must be answered or killed — never typed
past.

## 5. Etiquette

- Take the baton only when you need to write; leave it at the prompt.
- Expect `403` after the operator types — heal and continue; do not
  re-mint in a loop.
- Committing on the remote box? Pass `-c core.editor=true` to git commit and
  redirect push output to a file — interactive prompts there ate keystrokes
  for minutes (live, 2026-11-04). A missing git identity fails commit with
  exit 128: set `git config user.name/user.email` (per-repo) if unset.
- Report what the operator saw on the desk, not just what you read.
