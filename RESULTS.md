# Results

> **Historical results:** these measurements predate the current CTE and normal rules.
> Do not use them to estimate current savings. Re-run the benchmark first.

Output tokens per turn, and the cut against the same model with rules off. Every cell is
the **median of 5 rounds**, each round a fresh three-turn session. Negative means the
replies got **longer** with the rules on.

## Claude models

`node bench/run.mjs --models claude-opus-5,claude-sonnet-5,claude-haiku-4-5 --repeat 5`

| Model | off | `normal` | cut | `cte` | cut | better mode |
|---|---:|---:|---:|---:|---:|---|
| claude-opus-5 | 865 | 393 | **55%** | 456 | 47% | `normal` |
| claude-sonnet-5 | 260 | 208 | 20% | 152 | **42%** | `cte` |
| claude-haiku-4-5 | 484 | 449 | 7% | 380 | **21%** | `cte` |

## Codex models

`node bench/run.mjs --models gpt-5.6-sol,gpt-5.6-terra,gpt-5.6-luna,gpt-5.5,gpt-5.4,gpt-5.4-mini --repeat 5 --reasoning medium`

Reasoning effort is pinned at `medium` so it cannot drift between arms. Codex bills
`reasoning_output_tokens` as output and the billed column sums both, but no response rule
governs how long a model thinks — so the visible-only column is the one these rules can
actually claim.

| Model | off | `normal` | cut | visible | `cte` | cut | visible | better mode |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| gpt-5.5 | 336 | 209 | 38% | 38% | 149 | **56%** | 56% | `cte` |
| gpt-5.6-sol | 386 | 237 | **39%** | 37% | 514 | −33% | 8% | `normal` |
| gpt-5.6-luna | 390 | 285 | 27% | 21% | 257 | **34%** | 39% | `cte` |
| gpt-5.6-terra | 281 | 204 | **27%** | 27% | 269 | 4% | 4% | `normal` |
| gpt-5.4-mini | 676 | 646 | 4% | 3% | 532 | **21%** | 23% | `cte` |
| gpt-5.4 | 443 | 391 | 12% | 12% | 369 | **17%** | 20% | `cte` |

gpt-5.6-sol under `cte` is the one place billed and visible disagree sharply: the reply
came out 8% shorter while reasoning tokens spiked enough to make the billed total 33%
longer. Everywhere else the two columns track within 6 points.

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
start and cache-read after, which is how they behave in use. A full nine-model sweep is
**135 sessions and 405 calls**.

Each child runs from an **empty directory**, so no project `CLAUDE.md` or `AGENTS.md` is
read, and the mode reaches it as `PLAIN_SPEAK_MODE` rather than by writing the global
flag. Hooks are live — they are the thing being measured — with `PLAIN_SPEAK_BENCH=1` so
the throwaway sessions stay out of the operator's own stats.

**What it still inherits:** the operator's global `~/.claude/CLAUDE.md` and installed
plugins. Setting `CLAUDE_CONFIG_DIR` to isolate that stops Claude Code reading credentials
from the keychain, so full isolation needs its own login — `bench/run.mjs --isolated`,
documented in [docs/benchmark.md](./docs/benchmark.md). Every cut above is therefore a
**floor**: the `off` arm is already somewhat terse.

The gpt-5.4 and gpt-5.4-mini `off` cells finished in a later runner invocation than their
`normal` and `cte` cells — same model, effort, prompts, turns and repeat count.
`bench/report.mjs` flags that split rather than hiding it.

## What this shows

**The better mode differs by model, and it is not guessable.** Opus wants `normal` (55%
against 47%); Sonnet and Haiku want `cte` (42% and 21%, against 20% and 7%). On Codex,
gpt-5.6-sol and gpt-5.6-terra want `normal` while the other four want `cte`. Picking the
"more extreme" mode costs Opus 8 points and gains Sonnet 22.

**Both families gain, at different sizes.** With effort held fixed, every Codex model
shortens under at least one mode, from 17% to 56%. Claude spans 21% to 55%.

**Some cells are noise.** gpt-5.4-mini under `normal` at 4% (3% visible) and Haiku under
`normal` at 7% mean "no useful effect", not "slightly better".

There is no honest single headline, and quoting one would misrepresent every model it was
not measured on. The defensible claim: **17–56% on the prose slice, with the right mode
per model.**

## What this does not show

- **Three prompts, all general questions.** No code, no tool use, no long context —
  nothing like a real coding session, which is mostly tool traffic. In a real session
  the prose these rules govern is often 10–15% of output.
- **Five rounds is enough to see 20-point effects, not 5-point ones.** Treat anything
  under about 10 points as noise.
- **One reasoning level on Codex.** These numbers hold at `medium`. Effort changes both
  arms and the gap between them; a different level is a different measurement.
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

The rules are written into the cache once and read back afterwards. A harness that opens a
fresh session per prompt pays that 12k every time, which buries the output difference
under cache-creation tokens and makes any cost figure meaningless.

## Reproduce

```sh
node bench/run.mjs --dry-run              # plan and cost, no calls
node bench/run.mjs --repeat 5             # 135 sessions, 405 calls
node bench/run.mjs --isolated --repeat 5  # the same, without your global config
node bench/report.mjs --write             # regenerate, and feed the stats
```

Raw per-turn data for every cell is in `bench/results/`.
