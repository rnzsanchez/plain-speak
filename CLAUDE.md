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
npm test                          # node --test, drift + backoff unit tests
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
| `src/state.js` | Mode flag + counters. Claude Code uses `~/.claude/plain-speak/`; Codex uses `~/.codex/plain-speak/`. |
| `src/hooks/*.js` | `SessionStart` injects once, `UserPromptSubmit` usually injects nothing, `Stop` scores and records. |
| `src/install/*.js` | Settings patching for each tool; `shared.js` holds what both need. |
| `modes/*.md` | The rule text. `normal` is the base voice, `cte` is the same voice at twelve. |
| `.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/`, `hooks/` | Tool-specific plugin and marketplace manifests plus shared hooks. Claude Code uses `${CLAUDE_PLUGIN_ROOT}`; Codex resolves its own plugin runtime. Neither route edits settings. |
| `skills/` | Two skills. Claude Code namespaces plugin skills as `/plain-speak:init` and `/plain-speak:stats`. Codex invokes them with `$` or natural language; never document them as custom slash commands. |
| `docs/` | Install, checker, benchmark, tradeoffs. The README links out rather than growing. |

Claude Code and Codex fire the same three events with near-identical payloads, so
one set of hook scripts serves both. `src/hooks/lib.js` normalizes the one
difference that matters: the prompt field is `user_prompt` on Claude and `prompt`
on Codex.

## Things that will bite you

- **Only ever touch our own entries.** `isOurs()` matches commands containing
  `plain-speak`; nothing else is filtered out of a user's settings, ever. `tidy()`
  removes plain-speak's own superseded wiring and nothing besides.
- **The `Stop` hook must never block or print.** Making the model spend a turn
  being told to be shorter costs more than the drift did.
- **Hooks must always exit 0.** `lib.run()` swallows everything for that reason.
  A throwing hook breaks someone's session.
- **`copyRuntime()` is not optional.** A plugin directory carries its version in the
  path, so anything written into a settings file pointing there breaks on the next
  update. The badge and the Codex skills both resolve a fixed `plain-speak/` copy.
- **Transcript rows repeat.** One assistant message appears once per content
  block, all carrying the same `usage`. Dedupe on `message.id` or totals inflate
  roughly threefold.
- **`lastInjectTurn` is the completed-turn count at injection time**, so the
  cooldown compares against `turns - 1`. Off-by-one here means it nags every turn.
- **Inline code and quoted lines are stripped before the marker scan.** Without that,
  any reply *about* writing style trips the checker — including the ones you write
  while working on this repo. Shape checks still run on the full prose.
- **The mode-switch regex is anchored to the whole prompt.** Unanchored, "what does
  plain-speak off do?" silently switched the mode.
- **Only walls count as prose paragraphs** (2+ sentences and 25+ words). Counting
  every prose block made `cte` flag replies as short as "Done."
- **Never resolve a path with `ls A B | head -1`.** `ls` sorts its output, so it
  ignores the order you passed. That made the skills run a stale standalone runtime
  instead of the installed plugin. Test candidates in order with `[ -f ... ]`.
- **Claude Code and Codex state must stay isolated.** Claude uses
  `~/.claude/plain-speak/`; Codex uses `~/.codex/plain-speak/`. A mode switch, stats
  update or uninstall in one tool must not affect the other. Project pins are separate
  too: `.plain-speak-mode` for Claude and `.plain-speak-codex-mode` for Codex.
- **Codex has no custom plugin slash commands.** Document `$plain-speak:init`,
  `$plain-speak:stats` and exact mode prompt `plain speak off|normal|cte`. Keep
  Claude Code's existing slash commands unchanged.
- **Skill directory name and frontmatter `name` must match.** Change one without the
  other and the command silently fails to load, with nothing said about why.
- **The badge script must keep its `*-statusline.sh` name.** Statuslines that render
  plugin badges find it by globbing that pattern under the plugin's install path.
  Renaming it makes the badge silently vanish for plugin users.
- **The badge is prepended, never substituted.** `tidy()` adds it in front of whatever
  statusline is already configured, and that statusline keeps running. It writes only
  when the badge is absent, so running the mode command twice changes nothing.
- **A statusline that already renders plugin badges is left alone.** Those run every
  installed plugin's `*-statusline.sh` themselves, so prepending ours draws it twice.
  `rendersPluginBadges()` reads the scripts the statusline runs and looks for that glob.
  Never special-case a named statusline tool — match the convention, not the product.
- **The statusline is bash on purpose.** It runs on every keystroke; node's
  startup is too slow. It also refuses symlinks and strips control bytes, because
  its input file gets rendered straight to the terminal.
- **`bench/run.mjs` passes the mode as `PLAIN_SPEAK_MODE`** and never writes the live
  flag. It used to write and restore, and a killed run left the operator in whatever mode
  it had reached. Do not reintroduce that.
- **Never set `CLAUDE_CONFIG_DIR` for a benchmark child** unless `--isolated` and a real
  login are in play. Setting it at all — even to its own default path — stops Claude Code
  reading credentials from the keychain, and every call returns "Not logged in" with zero
  output tokens, which reads exactly like a measured result.
- **The default baseline runs under the operator's own config**, so global rules and
  plugins are inside the `off` arm too. Say so wherever the numbers are published.

## Codex benchmark traps

Both of these cost a full run of silent zeros before they were found:

- **`stdio` stdin must be `'ignore'` for `codex exec`.** With an inherited pipe it
  treats stdin as extra prompt input, prints "Reading additional input from stdin…"
  and blocks until EOF.
- **`codex exec --json` is not the session-file format.** Usage arrives on a
  `turn.completed` event as `usage: {input_tokens, cached_input_tokens, output_tokens,
  reasoning_output_tokens}`, and the id for `exec resume` on `thread.started`. The
  `token_count` / `payload.info.last_token_usage` shape only exists in
  `~/.codex/sessions/*.jsonl`.
- **`--skip-git-repo-check` is required** or Codex refuses to run outside a repo.
- `run.mjs` refuses to save a result with zero output tokens. Keep that: a zero that
  gets written to disk reads as "measured" forever after.
- **Never push to this repo while a Codex benchmark is running.** Codex stores
  `last_revision` per marketplace and re-clones when upstream moves, rebuilding
  `~/.codex/.tmp/marketplaces/plain-speak/`, `~/.codex/plugins/cache/plain-speak/` and the
  `config.toml` entries. The swap is not atomic — orphaned `marketplace-upgrade-*`
  directories under `.tmp/marketplaces/.staging/` are ones that never completed. A push
  mid-run tears down the plugin being measured, and a failed swap turns the remaining
  cells into off-vs-off without saying anything.

## Benchmark honesty

Every benchmark session is multi-turn. One-shot sessions make cache-creation
tokens dominate and hide the output difference — that mistake is why the v1 cost
numbers in `RESULTS.md` were noise. Don't present cost from a single-turn harness.

`plain-speak stats` shows a figure only when `src/savings.json` has an entry for that
model. No data, no number. The saving it prints is the benchmark cut applied to the
**prose slice only** — output tokens apportioned to `text` blocks — never to the whole
session. In a real coding session the prose is ~10-15% of output and tool calls are the
rest, so scaling the percentage across the total would overstate it several times over.
The line says "roughly" and names where the percentage came from, because the split is
apportioned by character size (usage is per message, not per block) and the benchmark
measured a different kind of turn.

The results are strongly model-dependent and the docs must keep saying so. Medians of 5
rounds on a clean baseline: Opus 5 `normal` 55% / `cte` 47%; Sonnet 5 20% / 42%; Haiku
4.5 7% / 21%. GPT models at pinned `medium` reasoning: gpt-5.5 38% / 56%; gpt-5.6-sol
39% / −33% (visible 8%); gpt-5.6-luna 27% / 34%; gpt-5.6-terra 27% / 4%; gpt-5.4 12% /
17%; gpt-5.4-mini 4% / 21%. The better mode differs per model — do not describe `cte` as
"more savings". Do not reintroduce a single headline number.

Every GPT figure measured before 2026-07-27 was taken while the Codex hooks were not
firing, so all three arms were effectively `off`. Those numbers said "no GPT model gains";
they were comparing off against off. Never quote a GPT row without checking the run
injected.

One run is not a result, and neither is a contaminated baseline. Opus `cte` read 52% on
one run and 29% over five; Opus `off` read 618 tokens per turn measured inside this repo
and 865 from an empty directory.

## Memory

`lore` is the memory store for this repo. Use it, not an ad-hoc note file:

- `lore recall '<task>'` before non-trivial work here, ahead of reading project files.
- `lore log` for anything durable as it lands — a decision, a preference, a trap, a
  correction — and whenever the user says to remember, save or note something.
- `lore guide` for the save/recall rules; `/lore:handoff` at the end of a session.

Skip it only for trivial mechanical edits.

## Commit style

Single-line messages, `type: subject` (`feat:`, `fix:`, `docs:`). No body, no
`Co-Authored-By` trailer.
