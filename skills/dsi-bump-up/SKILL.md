---
name: dsi-bump-up
description: Use when the user runs /dsi-bump-up or says to bump up the version / vrelease DeepSeek Insight (DSI) — bumps package.json to the next version, writes the {vrelease} section in releases.md (bullets for every feature/fix landed since {prev-vrelease}), commits all and pushes, then runs the dsi-sync skill to mirror to GitHub.
---

# DSI Bump Up Release (vrelease)

Four-point release ritual for DSI. Run the points IN ORDER — each depends on
the previous one's output.

## 0. Determine {prev-vrelease} and {vrelease}

- {prev-vrelease}: the version currently in `package.json` `"version"`, or
  the last `chore: bump version` commit on `git log` — whichever is
  authoritative (package.json wins unless a bump commit landed without a
  version write).
- {vrelease}: the next version. Default to the next PATCH (0.5.35 → 0.5.36)
  unless the user names an explicit target or the diff is clearly a feature
  wave (then ask: minor?).
- Collect the work range: `git log --oneline <prev-bump-commit>..HEAD` plus
  any uncommitted changes (`git status -s`, `git diff`). Every bullet in
  releases.md must trace to a real commit or diff hunk — never invent.

## 1. Bump up version (vrelease)

Edit `package.json` `"version"` from {prev-vrelease} to {vrelease}.

```bash
grep -n '"version"' package.json | head -2   # verify after the edit
```

## 2. releases.md — the {vrelease} section

Open `releases.md` (create with a `# Releases` header if missing/empty).
Add a new section ABOVE any existing sections (newest first):

```markdown
## {vrelease}

Bumped from {prev-vrelease} — <one-line theme>.

### Features
- <feature> — <what it does, file/test references>

### Bug fixes
- <bug> — <root cause, the fix, regression test name>
```

- Drop a heading if that release has no entries of its kind.
- Bullets cover EVERYTHING after {prev-vrelease} up to {vrelease}: commits in
  the range, uncommitted work, and the release edits themselves where
  user-visible (the version bump is not a bullet).
- Name regression tests added with the work; the tests are the proof.

## 2.5 container-base sub-package bump (when the range touched packages/container-base)

If the work range (step 0) contains commits under `packages/container-base/`:

1. Bump `packages/container-base/package.json` `version` (pre-1.0 per
   ADR-0064 D3: MINOR for features, PATCH for fixes — an explicit operator
   target wins).
2. Append the release to `packages/container-base/RELEASE.md` under a
   `## <version>` Changelog heading (newest first, above the runbook's
   older entries; keep the OPERATOR publish runbook intact below it).
   Bullets trace to commits touching `packages/container-base/` only.
3. Machine gates from the RELEASE.md runbook step 1 (package test +
   build:package + lint:package at minimum) before committing.
4. Tag the release commit: `git tag container-base-v<version>`.
5. The npm publish itself stays OPERATOR-gated (2FA/OTP) — the executor
   never runs `npm publish` (task 4.2 boundary).

## 3. Commit all & push

```bash
git add -A
git -c core.pager=cat diff --cached --stat   # eyeball before committing
git commit -m "chore: bump version {prev-vrelease} -> {vrelease}" \
  -m "<short theme: the fixes/features of this release>"
git push
```

- One release commit (version bump + releases.md + the release's code, if any
  is still uncommitted). Check exit codes; report the commit hash and push
  result.
- If push is rejected (non-fast-forward), STOP and ask the user — never
  force-push.

## 4. Mirror — run the dsi-sync skill

Invoke the `dsi-sync` skill (repo copy: `.agents/skills/dsi-sync/`) and
follow it fully: rsync to `~/github/deepseek-insight` (excluding `dev/` and
`.git/`), verify the exclusions held, commit & push the mirror, and report
its result. The release is not done until the mirror push settles (or dsi-sync
reports "no changes", which should not happen after a real release).

## Report format

End with: {prev-vrelease} → {vrelease}, the release commit hash + push
result, and the mirror sync result.
