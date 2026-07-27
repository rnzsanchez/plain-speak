# Results

## Codex refresh — six models, medium reasoning, five rounds

`node bench/run.mjs --models gpt-5.6-sol,gpt-5.6-terra,gpt-5.6-luna,gpt-5.5,gpt-5.4,gpt-5.4-mini --repeat 5 --reasoning medium`,
2026-07-27. Every cell is the median of 5 fresh three-turn Codex CLI sessions.

| Model | off | `normal` | cut | `cte` | cut | visible-only `cte` cut |
|---|---:|---:|---:|---:|---:|---:|
| gpt-5.6-sol | 386 | 237 | **39%** | 514 | −33% | 8% |
| gpt-5.6-terra | 281 | 204 | **27%** | 269 | 4% | 4% |
| gpt-5.6-luna | 390 | 285 | 27% | 257 | **34%** | 39% |
| gpt-5.5 | 336 | 209 | 38% | 149 | **56%** | 56% |
| gpt-5.4 | 443 | 391 | 12% | 369 | **17%** | 20% |
| gpt-5.4-mini | 676 | 646 | 4% | 532 | **21%** | 23% |

These runs reverse the old GPT result: at fixed medium reasoning, `normal` shortened all
six models, though mini's 4% is still noise. `cte` helped five models but made
gpt-5.6-sol's billed output 33% longer because reasoning tokens spiked; its visible reply
was still 8% shorter.

One Codex call hung and its whole cell was discarded and restarted. The gpt-5.4 and
gpt-5.4-mini off cells finished in later runner invocations than their on cells, with the
same model, effort, prompts, turns and repeat count; `bench/report.mjs` flags that split.

## v3 — nine models, three modes, five rounds each

`node bench/run.mjs --repeat 5`, 2026-07-26. Every cell is the **median of 5 rounds**.
Output tokens per turn, and the cut against the same model with rules off. Negative means
the replies got **longer** with the rules on.

| Model | off | `normal` | cut | `cte` | cut | better mode |
|---|---:|---:|---:|---:|---:|---|
| claude-opus-5 | 865 | 393 | **55%** | 456 | 47% | `normal` |
| claude-sonnet-5 | 260 | 208 | 20% | 152 | **42%** | `cte` |
| claude-haiku-4-5 | 484 | 449 | 7% | 380 | **21%** | `cte` |
| gpt-5.6-terra | 309 | 280 | 9% | 279 | 10% | either, barely |
| gpt-5.6-sol | 365 | 374 | −2% | 332 | 9% | `cte`, barely |
| gpt-5.6-luna | 401 | 445 | **−11%** | 395 | 1% | neither |
| gpt-5.5 | 317 | 320 | −1% | 339 | −7% | neither |
| gpt-5.4 | 404 | 430 | −6% | 412 | −2% | neither |
| gpt-5.4-mini | 762 | 772 | −1% | 823 | −8% | neither |

## How this was measured

A **session** is one `(model, mode, round)`. Nothing is shared across those three:

| Boundary | New session |
|---|---|
| Tool — `claude -p` vs `codex exec` | Yes, separate processes throughout |
| Model | Yes |
| Mode — `off`, `normal`, `cte` | Yes |
| Round — each of the 5 repeats | Yes |
| Turn, within one round | **No** — the 3 prompts share the session |

Turn 1 opens the session; turns 2 and 3 resume it. The rules are injected once at session
start and cache-read after, which is how they behave in use. That makes this run **135
sessions and 405 calls** per full sweep.

Each child runs from an **empty directory**, so no project `CLAUDE.md` or `AGENTS.md` is
read, and the mode reaches it as `PLAIN_SPEAK_MODE` rather than by writing the global
flag. Hooks are live — they are the thing being measured — with `PLAIN_SPEAK_BENCH=1` so
the throwaway sessions stay out of the operator's own stats.

**What it still inherits:** the operator's global `~/.claude/CLAUDE.md` and installed
plugins. Setting `CLAUDE_CONFIG_DIR` to isolate that stops Claude Code reading credentials
from the keychain, so full isolation needs its own login — `bench/run.mjs --isolated`,
documented in [docs/benchmark.md](./docs/benchmark.md). Every cut below is therefore a
**floor**: the `off` arm is already somewhat terse.

## What this shows

**Every Claude model gains; every GPT model roughly doesn't.** That split is the one
durable finding across both rounds of measurement.

**The better mode differs by model, and it is not guessable.** Opus wants `normal` (55%
against 47%). Sonnet and Haiku want `cte` (42% and 21%, against 20% and 7%). Picking the
"more extreme" mode costs Opus 8 points and gains Sonnet 22.

**Haiku was written off too early.** The old table had it at 10%/5% — "barely registers".
Against a clean baseline `cte` cuts 21%, its best result.

**On GPT, `normal` still tends to backfire**, though far less than the old table claimed:
−11% on gpt-5.6-luna and −6% on gpt-5.4, against +9% on gpt-5.6-terra. `cte` is mildly
positive on the 5.6 family (1–10%) and mildly negative on 5.4, 5.5 and 5.4-mini (−2% to
−8%). Nothing there is worth quoting as a saving.

There is no honest single headline. The defensible claim: **20–55% on Claude models with
the right mode per model, and no reliable gain on any GPT model.**

## What changed from v2, and why the old numbers were wrong

The v2 table was measured with the child process running **inside this repo**, so every
call loaded this repo's `CLAUDE.md` and the operator's global one — which already asks
for short answers. The `off` arm was therefore not a default model.

| | v2 baseline | v3 baseline |
|---|---:|---:|
| claude-opus-5, `off`, tokens per turn | 618 | **865** |

Same model, same prompts, 40% longer once the repo's instructions are out of the picture.
Every v2 cut was measured against an artificially terse baseline, and several moved by
more than 20 points when it was removed. Two other harness faults were fixed in the same
pass: a `-s` sandbox flag that `codex exec resume` rejects, which killed every turn after
the first on Codex, and the run writing the operator's live mode flag, which a killed run
would leave wrong.

## What this still does not show

- **Three prompts, all general questions.** No code, no tool use, no long context —
  nothing like a real coding session, which is mostly tool traffic. In a real session
  the prose these rules govern is often 10–15% of output.
- **Five rounds is enough to see 20-point effects, not 5-point ones.** Treat anything
  under about 10 points as noise. `gpt-5.5` at −1% and `gpt-5.4-mini` at −1% mean "no
  effect", not "slightly worse".
- **Reasoning tokens.** Codex reports `output_tokens` and `reasoning_output_tokens`
  separately and this table sums them, because both are billed as output. Where the
  harness recorded them separately, the visible-reply cut tracked the billed cut within
  3 points — so reasoning is not what drives the GPT results.
- **No cost column.** Claude reports a price and Codex does not, and per-session cache
  behaviour dominates the bill either way. Compare tokens, not dollars.
- **Readability is not measured at all.** The point of these rules is an answer you can
  read once. Token count is the part that happens to be countable.

## Session continuity, measured

Why every run is multi-turn, from a Haiku session:

| | Turn 1 | Turn 2 |
|---|---:|---:|
| Cache creation | 12,380 | 434 |
| Cache read | 17,536 | 29,916 |

The rules are written into the cache once and read back afterwards. A harness that
opens a fresh session per prompt pays that 12k every time, which is what made the v1
cost numbers meaningless.

## Reproduce

```sh
node bench/run.mjs --dry-run              # plan and cost, no calls
node bench/run.mjs --repeat 5             # this table: 135 sessions, 405 calls
node bench/run.mjs --isolated --repeat 5  # the same, without your global config
node bench/report.mjs --write             # regenerate, and feed the stats
```

Raw per-turn data for every cell is in `bench/results/`.

---

## v1 — historical

Produced by `ab.sh`, since replaced by `bench/run.mjs`. Kept because the output-length
finding stood up, and because the cost flaw is worth remembering: every prompt ran in a
fresh session, so cache-creation tokens swamped the difference.

Run: `./ab.sh` — 10 prompts, each asked twice (rules off, rules on).
Model: Opus 5 (1M context). Date: 2026-07-25. Fresh headless session per prompt, cwd `/tmp`.

| Prompt | Off | On |
|---|---:|---:|
| git merge vs rebase | 1058 | 891 |
| UUID vs auto-increment PK | 1330 | 976 |
| what a database index does | 1005 | 1130 |
| Redis as a session store | 1168 | 1074 |
| which process uses port 3000 | 1059 | 960 |
| Go `defer` | 1300 | 1101 |
| env vars vs secrets manager | 1546 | 986 |
| TCP vs UDP | 1198 | 859 |
| point of a CDN | 1073 | 740 |
| force-push to a shared branch | 1143 | 1009 |
| **total output tokens** | **11880** | **9726** |

Output tokens saved: 2154 (18%). Rules injected on every prompt: ~183 tok × 10, so
roughly break-even on raw count — which is the problem v2 set out to fix.

Cost came out `off=$1.2602 on=$1.2725`. That number was noise, not a result: ~12k
cache-creation tokens per fresh session dominated the bill.
