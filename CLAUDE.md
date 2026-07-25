# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

An npm package that installs three hooks into Claude Code and Codex. The point of
the whole thing is `src/drift.js`: rules are injected once at session start, and
after that only when a reply fails the tone check. Everything else exists to serve
that — the modes are the content, the badge and stats are the surface, the
benchmark proves the cost.

## Commands

```sh
npm test                          # node --test, drift + budget unit tests
node bin/cli.js doctor            # is the local install wired (no slash command — deliberate)
node bin/cli.js stats             # report for the most recent session
node bench/run.mjs --dry-run      # benchmark plan, no API calls
node bench/report.mjs --write     # results table, and feed src/savings.json
```

`node --test test/` fails — pass no path and let it discover.

## Architecture

| File | Role |
|---|---|
| `src/drift.js` | The check. Pure functions, no I/O. Score-based: each tone hit is a point, the mode's threshold decides when points mean drift. |
| `src/state.js` | Mode flag + counters. Everything under `~/.claude/plain-speak/`. |
| `src/hooks/*.js` | `SessionStart` injects once, `UserPromptSubmit` usually injects nothing, `Stop` scores and records. |
| `src/install/*.js` | Settings patching for each tool; `shared.js` holds what both need. |
| `modes/*.md` | The rule text. `normal` is the base voice, `cte` is the same voice at twelve. |
| `.claude-plugin/`, `hooks/` | Plugin + marketplace manifests. A plugin install needs no `settings.json` edits and no runtime copy, because `${CLAUDE_PLUGIN_ROOT}` is already stable. |
| `skills/` | Two commands, named short (`mode`, `stats`) because a plugin install namespaces them as `/plain-speak:mode`. `copySkills()` prefixes them for npx installs, where there is no namespace, and rewrites the frontmatter `name` to match the directory — the two must agree. |
| `docs/` | Install, checker, benchmark, tradeoffs. The README links out rather than growing. |

Claude Code and Codex fire the same three events with near-identical payloads, so
one set of hook scripts serves both. `src/hooks/lib.js` normalizes the one
difference that matters: the prompt field is `user_prompt` on Claude and `prompt`
on Codex.

## Things that will bite you

- **The `Stop` hook must never block or print.** Making the model spend a turn
  being told to be shorter costs more than the drift did.
- **Hooks must always exit 0.** `lib.run()` swallows everything for that reason.
  A throwing hook breaks someone's session.
- **`copyRuntime()` is not optional.** `npx` runs from a temp cache that gets
  pruned, so hooks can never point at the package directory.
- **Transcript rows repeat.** One assistant message appears once per content
  block, all carrying the same `usage`. Dedupe on `message.id` or totals inflate
  roughly threefold.
- **`lastInjectTurn` is the completed-turn count at injection time**, so the
  cooldown compares against `turns - 1`. Off-by-one here means it nags every turn.
- **Only walls count as prose paragraphs** (2+ sentences and 25+ words). Counting
  every prose block made `cte` flag replies as short as "Done."
- **Skill directory name and frontmatter `name` must match.** `copySkills()` renames
  both together. Change one without the other and the command silently fails to load.
- **The badge script must keep its `*-statusline.sh` name.** Statuslines that render
  plugin badges find it by globbing that pattern under the plugin's install path.
  Renaming it makes the badge silently vanish for plugin users.
- **The installer never touches a statusline that already exists** unless
  `--statusline` is passed. Rearranging someone's status bar is not its business.
- **The statusline is bash on purpose.** It runs on every keystroke; node's
  startup is too slow. It also refuses symlinks and strips control bytes, because
  its input file gets rendered straight to the terminal.
- **`bench/run.mjs` writes the live mode flag** and restores it on exit. Keep the
  restore path intact.

## Benchmark honesty

Every benchmark session is multi-turn. One-shot sessions make cache-creation
tokens dominate and hide the output difference — that mistake is why the v1 cost
numbers in `RESULTS.md` were noise. Don't present cost from a single-turn harness.

`plain-speak stats` shows a savings figure only when `src/savings.json` has an
entry for that model. No data, no number.

## Commit style

Single-line messages, `type: subject` (`feat:`, `fix:`, `docs:`). No body, no
`Co-Authored-By` trailer.
