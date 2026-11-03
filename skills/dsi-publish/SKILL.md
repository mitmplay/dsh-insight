# DSI Publish (verified ritual)

Publish `@deepseek-insight/dsi` to npm with the machine sanity-checked FIRST —
so a shadowed build tool fails a 5-second probe, not the publish gate.
Run AFTER `dsi-bump-up` (the version must already be bumped and committed).

## 0. Preconditions

- Repo: `~/agentic-ai/deepseek-insight`, clean tree (`git status -s` empty).
- Version in `package.json` equals the latest `chore: bump version` commit
  (if not, run `/dsi-bump-up` first — never publish an unbumped version).
- `npm whoami` prints your account (log in with `npm login` if not).

## 1. Tool sanity gate ⛔ (the pnpm-from-another-planet guard)

A stray global install can shadow the real pnpm (RCA 2026-11-04: a
Linux-ARM binary at `~/node_modules/.bin/pnpm` won every PATH race and
killed the publish with exit 126).

```sh
which pnpm                 # expect: /Users/<you>/Library/pnpm/pnpm (or corepack)
pnpm --version             # expect: a number, no error
file "$(which pnpm)"       # expect: Mach-O / shell script — NEVER "ELF"
```

Any ELF answer, `~/node_modules/.bin` path, or "cannot execute binary file"
→ STOP: remove the stray install (verify its contents first: it should
contain only the bad package), `hash -r`, re-run this gate. Never chmod a
"cannot execute binary file" — a Linux binary is not a permission problem.

## 2. Build (the publish hook will run it anyway — fail here, loudly)

```sh
pnpm run build
test -f build/index.js && echo 'build ok'   # prepublishOnly runs it again; this is the dry run
```

## 3. Publish

```sh
cd ~/agentic-ai/deepseek-insight
npm publish --access public
```

- Check exit code; on failure read the npm error block before retrying —
  a failed prepublishOnly is usually the tool gate (step 1), not npm.
- First publish of a NEW version must come from a committed tree: if the
  bump commit is missing, stop and finish `dsi-bump-up` first.

## 4. Verify

```sh
npm view @deepseek-insight/dsi version   # expect the just-published version
```

The registry can lag a few minutes; `+ @deepseek-insight/dsi@<version>`
in the publish output is the primary proof.

## 5. Mirror

Run `/dsi-sync` — the release is not done until the GitHub mirror push
settles (a real release never reports "no changes").

## Report

End with: version published, npm push result (`+ @deepseek-insight/dsi@x.y.z`),
registry check result, mirror sync result.
