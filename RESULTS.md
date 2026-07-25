# Results

## v2 — six models, three modes

`node bench/run.mjs --turns 3`, 2026-07-25. Each cell is one real multi-turn session
of 3 prompts from `bench/prompts.txt`. Output tokens per turn, and the cut against the
same model with rules off.

| Model | off | `normal` | cut | `cte` | cut |
|---|---:|---:|---:|---:|---:|
| claude-opus-5 | 673 | 373 | **45%** | 321 | **52%** |
| claude-sonnet-5 | 237 | 152 | **36%** | 97 | **59%** |
| claude-haiku-4-5 | 535 | 483 | 10% | 507 | 5% |
| gpt-5.5 | 335 | 334 | 0% | 314 | 6% |
| gpt-5.4 | 404 | 426 | **−5%** | 463 | **−15%** |
| gpt-5.4-mini | 635 | 588 | 7% | 772 | **−22%** |

Negative means the replies got *longer* with the rules on.

## What this shows

**It works on the large Claude models.** Opus 5 and Sonnet 5 both cut output
substantially, and `cte` beat `normal` on both.

**It does close to nothing on the small ones.** Haiku 4.5 and gpt-5.5 landed between
0% and 10%. Those models are already terse, so there is little to trim.

**On two models it backfired.** gpt-5.4 got longer in both modes, and gpt-5.4-mini's
`cte` was 22% longer than no rules at all. Whatever `cte` does to a GPT model, it is
not making it shorter.

So the honest headline is *"45–59% on Opus and Sonnet, little or nothing elsewhere,
worse on two GPT models"* — not a single number.

## What this does not show

- **One run per cell.** Reply length varies between identical calls. A 5-point
  difference here is noise; the 45–59% figures are large enough to trust as direction,
  the 0–10% ones are not. Use `--repeat 5` for numbers worth quoting.
- **Three prompts, all general questions.** No code, no tool use, no long context —
  nothing like a real coding session, which is mostly tool traffic.
- **Codex figures include reasoning tokens.** `codex exec` reports
  `output_tokens` and `reasoning_output_tokens`; this run summed them, because both are
  billed as output. Response rules do not govern how long a model *thinks*, so part of
  the GPT movement above is reasoning effort rather than reply length. The harness now
  records the two separately, so the next run can split them — these numbers cannot.
- **No cost column.** Claude reports a price and Codex does not, and per-session
  cache behaviour dominates the bill either way. Compare tokens, not dollars.

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
