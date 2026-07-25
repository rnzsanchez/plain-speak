<div align="center">

# plain-speak

### Rules that check themselves.

Terse-response modes for **Claude Code** and **Codex**, with a silent checker that
reads every reply and puts the rules back **only when the model drifts.**

[![licence](https://img.shields.io/badge/licence-MIT-2ea8a5)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518-2ea8a5)](https://nodejs.org)
[![dependencies](https://img.shields.io/badge/dependencies-0-2ea8a5)](./package.json)

</div>

---

A rules file only works while the model can still see it. So the usual fix is to
inject it on every prompt — and pay for it on every prompt, including the ones where
the model was behaving perfectly.

plain-speak injects once, then watches the output. Every reply is scored, and the
score decides whether the *next* prompt carries the rules.

| | You ask | It answers | Verdict | Next prompt carries |
|---|---|---|---|---|
| 1 | what's on port 3000? | `lsof -i :3000` | clean | nothing |
| 2 | and kill it? | "Certainly! It's worth noting you could leverage…" | **drift** | rules + the reason |
| 3 | thanks | "Anytime." | clean | nothing |
| 4 | why did it bind twice? | *(a long, careful explanation)* | exempt — you asked *why* | nothing |

The check is a scan of the text. No model call, no tokens, and nothing of it appears
in your transcript.

---

## Install

```
/plugin marketplace add rnzsanchez/plain-speak
/plugin install plain-speak@plain-speak
```

Or, to cover Codex as well as Claude Code:

```sh
npx github:rnzsanchez/plain-speak install
```

→ **[All install routes, what gets written, uninstall](./docs/install.md)**

---

## Modes

Same question to each: *"My deploy failed, is it the cache?"*

### `off` — nothing injected, nothing checked

```
Great question! There are several factors that could be at play here. It's worth
noting that a stale build cache is a very common culprit in situations like this,
and in order to determine whether that's what you're facing, you would generally
want to begin by examining your build logs to see whether…
```

### `normal` — the base voice

Plain, answer first, full thoughts welcome, zero fuss.

```
Maybe, but check the logs first. Cache trouble shows up as a build that succeeds
with stale output, which a failed deploy usually isn't. Paste the error.
```

### `cte` 🧠 — the same voice at twelve

Short. Blunt. Fragments.

```
Maybe. Logs first. Cache breaks builds, not deploys. Paste error.
```

---

## Commands

Everything runs inside a session. Installing is the only thing you do in a shell.

| Command | What it does |
|---|---|
| `/plain-speak` | Turn it on and show where it stands |
| `/plain-speak cte` | Switch mode — `off`, `normal`, `cte` |
| `/plain-speak-stats` | Token and drift report: this session, and lifetime |

Same in both tools. Neither can be triggered by the model — only by you.

Installed as a plugin, they carry the plugin's namespace:
`/plain-speak:plain-speak` and `/plain-speak:plain-speak-stats`. New commands load on
the next session start.

The badge shows what's live, next to your other plugin badges:

```
Opus 5 (1M) | plain-speak · main · [PONYTAIL] · [PLAIN 🧠 CTE]
```

---

## The checker

It scores **tone, not length.** A long, complete answer is fine; a fussy one is not.
Each hit is a point, and the mode's threshold decides when the points mean drift.

It stands down when the output was *meant* to be long — you asked for detail, a
walkthrough, a plan or a doc; the reply is mostly code; the turn was a plan.

And it will not nag: three reinjections a session, never two in a row, and two clean
turns give the budget back.

→ **[Signals, thresholds, exemptions, tuning](./docs/checker.md)**

---

## Stats

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

Counts are read from the transcript, so they are real. The `saved` line appears only
once a benchmark has run for that model — no data, no figure.

→ **[Measuring it yourself](./docs/benchmark.md)** · **[Current numbers](./RESULTS.md)**

---

## Before you install

The npx route edits your settings, three short node processes run per turn, and the
checker is a heuristic that will sometimes be wrong.

→ **[The honest downsides, in full](./docs/tradeoffs.md)**

---

## How it works

| Hook | Job |
|---|---|
| `SessionStart` | Injects the mode's rules — once |
| `UserPromptSubmit` | Injects **nothing**, unless drift was flagged or you switched mode |
| `Stop` | Scores the reply, records the verdict, prints nothing, never blocks |

Codex fires the same three events with the same payloads, so one set of scripts
serves both tools. Zero dependencies — Node, plus one bash script for the badge.

<div align="center">

---

**MIT** · for people who like short answers

</div>
