# plain-speak

Response rules for Claude Code and Codex that **check whether the model actually
followed them**, and put them back only when it drifts.

Most rule files are injected on every single prompt. That works, and it costs you
tokens on every single prompt — including the ones where the model was behaving
perfectly. plain-speak injects once at session start, then watches the output. A
silent check scores each reply; the rules go back in only when a reply stops
sounding like the mode.

```
you: how do I check what's on port 3000?
     → nothing injected

model: Certainly! It is worth noting that you could leverage `lsof`...
     → drift scored: filler, corporate word, fussy phrasing

you: and kill it?
     → rules reinjected, once, with the reason
```

## Install

```sh
npx plain-speak install
```

Wires three hooks, adds a statusline badge, installs `/plain-speak-stats`. Your
existing statusline is kept — the badge is prepended to it, not swapped for it.
Restart Claude Code, or run `/hooks` once.

```sh
npx plain-speak install --claude   # one tool only
npx plain-speak install --codex
npx plain-speak uninstall          # puts settings back
```

## Commands

In a Claude Code or Codex session:

| Command | What it does |
|---|---|
| `/plain-speak-stats` | The report below. Never runs on its own — you invoke it. |
| `plain-speak cte` | Switch to caveman mode mid-conversation. |
| `plain-speak normal` | Back to the base voice. |
| `plain-speak off` | Stop injecting and stop checking. |

The switch phrases are typed as ordinary text, not slash commands, and they are the
only thing plain-speak ever prints to you.

In a shell:

| Command | What it does |
|---|---|
| `npx plain-speak install` | Wire up hooks, badge and the stats command. `--claude` / `--codex` to pick one. |
| `npx plain-speak uninstall` | Remove everything it added; your settings go back. |
| `plain-speak mode` | Print the current mode. |
| `plain-speak mode cte` | Set the mode. `off`, `normal`, `cte` (`max` also means `cte`). |
| `plain-speak badge` | Print the statusline badge. |
| `plain-speak stats` | The report, for the most recent session. |
| `plain-speak doctor` | Check what is wired and what is missing. |
| `node bench/run.mjs --dry-run` | Show the benchmark plan and cost without calling anything. |
| `node bench/report.mjs --write` | Build the results table and feed the savings figure. |

## Modes

| Mode | Voice |
|---|---|
| `off` | Nothing injected, nothing checked. |
| `normal` | The base. Plain human voice, answer first, full thoughts fine, no fuss. |
| `cte` 🧠 | Caveman, turned to twelve. Short. Blunt. Fragments. |

```sh
plain-speak mode cte      # or: mode normal, mode off ("max" also means cte)
plain-speak mode          # prints the current one
```

Or mid-conversation, just type `plain-speak cte`.

The badge shows which one is live:

```
[PLAIN 🧠 CTE]  opus • plain-speak • main
```

### Same question, three modes

> Is it safe to force-push to a shared branch?

| Mode | Reply |
|---|---|
| `off` | "Great question! Force-pushing to a shared branch is generally considered risky because it rewrites history that other collaborators may have already based work on. It's worth noting that…" |
| `normal` | "No. It rewrites history other people already pulled. Use `--force-with-lease` if you must, and tell the branch's users first." |
| `cte` | "No. Breaks other people's clones. Need it? `--force-with-lease`. Tell them first." |

## The hygiene check

Runs on every reply. No model call, no tokens, and **you never see it**. The
score, the verdict and the reinjected rules all go to the model with
`suppressOutput`, so nothing lands in your transcript. The only thing plain-speak
ever shows you is a one-line confirmation when you switch mode yourself.

It scores tone, not length — a long, complete answer is fine; a fussy one is not.
Each hit is a point, and the mode's threshold decides when the points mean drift.

| Signal | Examples |
|---|---|
| Filler | "Certainly", "Great question", "I hope this helps" |
| Corporate words | leverage, utilize, facilitate, seamless, holistic |
| Fussy phrasing | furthermore, subsequently, "it is important to note" |
| Robot register | "I have completed the task", "please be advised", "kindly" |
| Walls of prose | multi-sentence paragraphs past the mode's threshold |
| Long sentences | past the mode's threshold |

It stays quiet when the output was *supposed* to be long:

- You asked for detail, a walkthrough, a plan, a doc, or an explanation of why.
- The reply is mostly code.
- The turn was a plan.

And it will not nag. Three reinjections per session, never two in a row, and two
clean turns give the budget back.

```sh
PLAIN_SPEAK_MAX_RETRIES=1 claude   # tighten it
```

## Stats

`/plain-speak-stats` in a session, or `plain-speak stats` in a shell:

```
plain-speak — cte

This session
  holding      ████████░░  83%   5 of 6 turns clean
  reinjections █░░░░░░░░░  1/3 budget used
  replies      4,180 tokens · 348 per reply
  saved        ██░░░░░░░░  18%   ~918 tokens vs rules off
  last drift   filler: "certainly"; corporate word: "leverage"

Lifetime
  holding      █████████░  91%   203 turns across 14 sessions
  reinjections 12 total (~2,196 tokens)
```

Token counts come from the transcript, so they are the real numbers. The `saved`
line appears only once a benchmark has been run for that model — no benchmark
data, no figure.

## Measuring it yourself

```sh
node bench/run.mjs --dry-run                                  # plan and cost, no calls
node bench/run.mjs --models claude-haiku-4-5 --turns 3         # cheap real run
node bench/report.mjs --write                                 # table + feed the stats
```

Each run is a real multi-turn session, because that is the only honest way to
measure this: the rules are injected once and cache-read afterwards, so one-shot
sessions make cache-creation dominate the bill and hide the difference.

Results land in `bench/results/`. `RESULTS.md` has the current numbers.

## What it costs you

Worth knowing before you install.

| Downside | Detail |
|---|---|
| It edits your settings | `~/.claude/settings.json` and `~/.codex/hooks.json`. A `.plain-speak-backup` copy is written first, and `uninstall` puts them back. |
| It removes one existing hook | Only a hand-rolled `cat ~/.claude/response-rules.md` hook, which this replaces. It is named in the install output. Nothing else is touched. |
| Three node processes per turn | Roughly 40–60 ms each. Unnoticeable next to a model call, but it is not zero. |
| The badge runs constantly | The statusline is re-rendered as you type. That is why it is bash and reads one small file. |
| The check is a heuristic | It scores phrasing. It will occasionally miss a fussy reply, and occasionally flag a reply that had to use a long sentence — `cte` more than `normal`, because `cte` trips on a single hit. |
| Terser is not always better | A shorter answer can leave out context you wanted. `cte` especially. If that bites, use `normal`, or ask for detail and the check stands down. |
| The mode is global | One setting across every project and session. A benchmark run changes it temporarily and restores it on exit. |
| Codex asks for trust | Hooks must be trusted on first run. The installer tells you rather than bypassing the prompt. |
| Node 18+ required | No dependencies, but node has to be on `PATH` for the hooks to run. |
| Uninstall keeps your data | Your mode and `state.json` stay behind. Delete `~/.claude/plain-speak/` to be rid of it. |

It stores counters only — turn counts, drift trips, reinjections. No prompt text
and no reply text is ever written to disk.

It also stays out of the way of everything else you have installed: it only ever
adds or removes hook entries whose command contains `plain-speak`, it prepends to
your statusline instead of replacing it, and its one command is namespaced and
marked so the model can never invoke it on its own.

## How it works

| Piece | What it does |
|---|---|
| `SessionStart` hook | Injects the mode's rules once |
| `UserPromptSubmit` hook | Injects nothing, unless drift was flagged or you switched mode |
| `Stop` hook | Scores the reply, records the verdict, prints nothing, never blocks |
| `src/statusline.sh` | The badge |
| `~/.claude/plain-speak/` | Runtime, mode file, and state — one folder |

Codex uses the same three events and the same scripts; only the config file
differs (`~/.codex/hooks.json`). Codex will ask you to trust the hooks on first
run — that prompt is the point, so the installer doesn't bypass it.

Everything is Node with no dependencies, plus one bash script for the badge.

## Licence

MIT
