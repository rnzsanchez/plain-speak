<div align="center">

# plain-speak

### Rules that check themselves.

**Terse-response modes for Claude Code and Codex — with a silent checker that reads
every reply and puts the rules back only when the model drifts.**

[![npm](https://img.shields.io/npm/v/plain-speak?color=2ea8a5&label=npm)](https://www.npmjs.com/package/plain-speak)
[![licence](https://img.shields.io/badge/licence-MIT-2ea8a5)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518-2ea8a5)](https://nodejs.org)
[![dependencies](https://img.shields.io/badge/dependencies-0-2ea8a5)](./package.json)

```
npx plain-speak install
```

</div>

---

## The problem

A rules file only works while the model can still see it. So the usual fix is to
inject it on every prompt — which means paying for it on every prompt, including
the ones where the model was behaving perfectly.

## The idea

Inject once. Then **watch the output.**

```
you   ▸ how do I check what's on port 3000?
        └ nothing injected

model ▸ Certainly! It's worth noting you could leverage `lsof`…
        └ scored: filler · corporate word · fussy phrasing → drift

you   ▸ and kill it?
        └ rules reinjected, once, silently, with the reason
```

No model call. No tokens. Nothing in your transcript. You never see it happen.

---

## Install

```sh
npx plain-speak install
```

<table>
<tr><td>

Wires three hooks, adds a statusline badge, installs four slash commands. Your
existing statusline is **kept** — the badge is prepended, not swapped in. Then
restart, or run `/hooks` once.

</td></tr>
</table>

```sh
npx plain-speak install --claude    # one tool only
npx plain-speak install --codex
npx plain-speak uninstall           # puts your settings back
```

---

## Modes

<table>
<tr>
<th align="left">Mode</th>
<th align="left">Voice</th>
</tr>
<tr>
<td><code>off</code></td>
<td>Nothing injected. Nothing checked.</td>
</tr>
<tr>
<td><b><code>normal</code></b></td>
<td>The base. Plain human voice, answer first, full thoughts welcome, zero fuss.</td>
</tr>
<tr>
<td><code>cte</code> 🧠</td>
<td>Turned to twelve. Short. Blunt. Fragments.</td>
</tr>
</table>

### One question, three modes

> *Is it safe to force-push to a shared branch?*

| | |
|---|---|
| **off** | "Great question! Force-pushing to a shared branch is generally considered risky, because it rewrites history that other collaborators may have already based their work on. It's worth noting that…" |
| **normal** | "No. It rewrites history other people already pulled. Use `--force-with-lease` if you must, and tell the branch's users first." |
| **cte** | "No. Breaks other people's clones. Need it? `--force-with-lease`. Tell them first." |

The badge tells you which one is live:

```
[PLAIN 🧠 CTE]  opus · plain-speak · main
```

---

## Commands

Everything runs **inside a session**. The installer is the only shell command.

| Command | What it does |
|---|---|
| `/plain-speak` | Show the active mode and the mode table |
| `/plain-speak-mode cte` | Switch mode — `off`, `normal`, `cte`. No argument prints the current one |
| `/plain-speak-stats` | Token and drift report: this session, and lifetime |
| `/plain-speak-doctor` | Check that hooks, badge and commands are wired |

Identical in Claude Code and Codex. None of them can be triggered by the model —
only by you. Prefer plain text? Typing `plain-speak cte` works too.

---

## The checker

It scores **tone, not length.** A long, complete answer is fine. A fussy one is not.
Each hit is a point; the mode's threshold decides when the points mean drift, so one
stray word never trips `normal`.

| Signal | Caught |
|---|---|
| 🪶 **Filler** | "Certainly", "Great question", "I hope this helps" |
| 💼 **Corporate** | leverage, utilize, facilitate, seamless, holistic |
| 🎩 **Fussy** | furthermore, subsequently, "it is important to note" |
| 🤖 **Robotic** | "I have completed the task", "please be advised", "kindly" |
| 🧱 **Walls** | multi-sentence paragraphs past the threshold |
| 📏 **Long sentences** | past the threshold |

### It knows when to shut up

Silent when the output was *meant* to be long:

- You asked for **detail**, a **walkthrough**, a **plan**, a **doc**, or **why**
- The reply is **mostly code**
- The turn was a **plan**

### It will not nag

**Three** reinjections per session · **never** two in a row · **two clean turns**
give the budget back.

```sh
PLAIN_SPEAK_MAX_RETRIES=1 claude   # stricter
```

---

## Stats

`/plain-speak-stats`

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

Token counts are read from the transcript, so they are the real numbers. The
`saved` line appears **only** once a benchmark has run for that model. No data, no
figure.

---

## Measure it yourself

```sh
node bench/run.mjs --dry-run                            # plan and cost, zero calls
node bench/run.mjs --models claude-haiku-4-5 --turns 3  # cheap real run
node bench/report.mjs --write                           # table, and feed the stats
```

Every benchmark session is **multi-turn**, because that is the only honest way to
measure this. Rules are injected once and cache-read afterwards; one-shot sessions
let cache-creation dominate the bill and hide the difference entirely.

Results land in `bench/results/`. Current numbers live in [`RESULTS.md`](./RESULTS.md).

---

## Before you install

<details open>
<summary><b>The honest downsides</b></summary>

<br>

| Downside | Detail |
|---|---|
| **It edits your settings** | `~/.claude/settings.json` and `~/.codex/hooks.json`. A `.plain-speak-backup` is written first; `uninstall` restores them. |
| **It removes one existing hook** | Only a hand-rolled `cat ~/.claude/response-rules.md` hook, which this supersedes. It is named in the install output. Nothing else is touched. |
| **Three node processes per turn** | Roughly 40–60 ms each. Invisible next to a model call, but not zero. |
| **The badge runs constantly** | Re-rendered as you type. That is why it is bash and reads one small file. |
| **The checker is a heuristic** | It will sometimes miss a fussy reply, and sometimes flag one that needed a long sentence — `cte` more than `normal`, since `cte` trips on a single hit. |
| **Terser is not always better** | A short answer can drop context you wanted. `cte` especially. Use `normal`, or ask for detail and the checker stands down. |
| **The mode is global** | One setting across every project. A benchmark run changes it temporarily and restores it on exit. |
| **Codex asks for trust** | Hooks must be trusted on first run. The installer tells you instead of bypassing the prompt. |
| **Node 18+ on `PATH`** | No dependencies, but the hooks need node. |
| **Uninstall keeps your data** | Mode and `state.json` stay. Delete `~/.claude/plain-speak/` to be rid of it. |

**On privacy:** counters only — turn counts, drift trips, reinjections. No prompt
text and no reply text is ever written to disk.

**On your other tools:** it only adds or removes hook entries whose command contains
`plain-speak`, it prepends to your statusline instead of replacing it, and its
commands are namespaced and flagged so the model can never invoke them.

</details>

---

## Under the hood

| Piece | Job |
|---|---|
| `SessionStart` hook | Injects the mode's rules — once |
| `UserPromptSubmit` hook | Injects **nothing**, unless drift was flagged or you switched mode |
| `Stop` hook | Scores the reply, records the verdict, prints nothing, never blocks |
| `src/drift.js` | The checker. Pure functions, fully unit-tested |
| `src/plain-speak-statusline.sh` | The badge |
| `~/.claude/plain-speak/` | Runtime, mode, state — one folder |

Codex fires the same three events with the same payloads, so the same scripts serve
both; only the config file differs. Zero dependencies — Node, plus one bash script
for the badge.

<div align="center">

---

**MIT** · built for people who like short answers

</div>
