# Results

> **These numbers are being replaced.** Every row below was measured with the child
> process running inside this repo, so it loaded the repo's `CLAUDE.md` as well as the
> operator's global one — which already asks for short answers. That makes the `off`
> baseline terser than a default model and the measured cut a floor, not the effect of
> these rules alone. A five-round re-run on the corrected harness (empty working
> directory, fresh session per run, mode passed by environment) is in progress; this
> page updates when it lands. Method and the remaining caveats:
> [docs/benchmark.md](./docs/benchmark.md).

## v2 — nine models, three modes

`node bench/run.mjs --turns 3`, 2026-07-25. Each cell is a real multi-turn session of
3 prompts from `bench/prompts.txt`. Output tokens per turn, and the cut against the same
model with rules off. Negative means the replies got **longer** with the rules on.

**Opus 5 is the median of 5 runs** (`--repeat 5`, 2026-07-26). Every other row is still a
single run, so treat those as indicative only — the Opus re-run moved `cte` by 23 points.

| Model | off | `normal` | cut | `cte` | cut |
|---|---:|---:|---:|---:|---:|
| claude-opus-5 · 5 runs | 618 | 322 | **48%** | 437 | 29% |
| claude-sonnet-5 | 237 | 152 | **36%** | 97 | **59%** |
| claude-haiku-4-5 | 535 | 483 | 10% | 507 | 5% |
| gpt-5.6-sol | 340 | 393 | **−16%** | 306 | 10% |
| gpt-5.6-terra | 281 | 293 | −4% | 271 | 4% |
| gpt-5.6-luna | 449 | 515 | **−15%** | 449 | 0% |
| gpt-5.5 | 335 | 334 | 0% | 314 | 6% |
| gpt-5.4 | 404 | 426 | −5% | 463 | **−15%** |
| gpt-5.4-mini | 635 | 588 | 7% | 772 | **−22%** |

## What this shows

**It works on the large Claude models, and only there.** Opus 5 and Sonnet 5 both cut
output substantially. Nothing else came close.

**On Opus, `normal` beats `cte`.** The first pass had `cte` ahead at 52% against 45%.
Repeated five times, `normal` holds 48% while `cte` falls to 29% — the single run was
noise. `cte` writes shorter sentences but adds structure, headings and lists, and on this
model that costs more than the terse phrasing saves. Every single-run row in this table
is subject to the same doubt.

**On the Claude small model it barely registers.** Haiku 4.5 landed at 10% and 5% —
inside the noise of a 3-prompt sample.

**On GPT models, `normal` consistently backfires.** Five of the six went *up*: −16% on
gpt-5.6-sol, −15% on gpt-5.6-luna, −5% on gpt-5.4, −4% on gpt-5.6-terra, 0% on gpt-5.5.
Only gpt-5.4-mini improved, at 7%. Whatever the `normal` ruleset does to a GPT model, it
is not making it shorter — a plausible reading is that a list of style rules invites
more structure and more hedging, but this data does not establish why.

**`cte` is the better bet on GPT, and still not a win.** It was flat or slightly better
on the 5.5 and 5.6 family (0% to 10%), and clearly worse on the 5.4 pair (−15%, −22%).

So there is no honest single headline. The defensible claim is: **45–59% on Opus and
Sonnet, roughly nothing on Haiku, and no reliable gain on any GPT model.**

## What this does not show

- **One run per cell.** Reply length varies between identical calls. Treat anything under
  about 10 points as noise; the 45–59% figures are large enough to trust as direction,
  the rest are not. Use `--repeat 5` for numbers worth quoting.
- **Three prompts, all general questions.** No code, no tool use, no long context —
  nothing like a real coding session, which is mostly tool traffic.
- **Reasoning tokens.** Codex reports `output_tokens` and `reasoning_output_tokens`
  separately and this table sums them, because both are billed as output. For the three
  5.6 models the harness recorded them separately, and the visible-reply cut tracked the
  billed cut within 3 points — so reasoning is not what is driving the GPT results. The
  older six runs predate that split and cannot be broken down.
- **No cost column.** Claude reports a price and Codex does not, and per-session cache
  behaviour dominates the bill either way. Compare tokens, not dollars.

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
node bench/run.mjs --dry-run                        # plan and cost, no calls
node bench/run.mjs --turns 3                        # this table
node bench/run.mjs --models claude-opus-5 --repeat 5 # median of 5, less noise
node bench/report.mjs --write                       # regenerate, and feed the stats
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
