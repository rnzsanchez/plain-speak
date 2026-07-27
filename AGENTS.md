# AGENTS.md

**Read [CLAUDE.md](./CLAUDE.md) first. All of it applies here.** It is the single set of
project instructions for this repo — what the thing is, the architecture table, the traps
that will bite you, the benchmark honesty rules, commit style and the release checklist.
This file exists because Codex looks for `AGENTS.md`, not because the guidance differs.

Deliberately not duplicated below: two copies of the same rules drift, and the copy
someone is reading is always the stale one.

## The parts that are about you

- **Codex state is `~/.codex/plain-speak/`, never `~/.claude/`.** A mode switch, stats
  update or uninstall on one tool must not touch the other. Project pins are separate
  too: `.plain-speak-mode` for Claude Code, `.plain-speak-codex-mode` for Codex.
- **Codex has no custom slash commands.** The skills are `$plain-speak:init` and
  `$plain-speak:stats`, or plain language. The mode prompt is exactly
  `plain speak off|normal|cte`. Never document Codex commands as `/name`.
- **Codex has no statusline, so no badge.** `codex.tidy()` cleans stale `hooks.json`
  entries and makes sure `[features] hooks = true`. That is all it does.
- **Hooks need trust on first run**, and again after a version bump — the manifest hashes
  change. The installer does not bypass that prompt.
- **Releasing means bumping `.codex-plugin/plugin.json` too**, not just the Claude one.
  See the release section in CLAUDE.md.

## Benchmarking Codex

`bench/run.mjs` drives `codex exec`. Three traps there have each cost a full run of
silent zeros — `stdio` stdin must be `'ignore'`, `--json` is not the session-file format,
and `--skip-git-repo-check` is required. They are written up in CLAUDE.md under "Codex
benchmark traps". Read that before touching the runner.

Reasoning effort is not a style setting. Codex bills `reasoning_output_tokens` as output,
but no response rule governs how long a model thinks, so a benchmark that lets effort
drift measures thinking as much as reply length. Pin it with `--reasoning` and report
`visibleOutputTokens` alongside the billed figure.
