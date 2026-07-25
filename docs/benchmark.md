# Measuring it

Run these from a clone, or from the plugin's install directory. Both carry `bench/`; the
npm package does not, because the raw results are 100 KB nobody installing it needs.

```sh
node bench/run.mjs --dry-run                            # plan and cost, zero calls
node bench/run.mjs --models claude-haiku-4-5 --turns 3  # cheap real run
node bench/report.mjs --write                           # table, and feed the stats
```

Every call is a real API call and costs real money. Start narrow.

**Check your own model before believing the pitch.** Results are strongly model-dependent
and the published table says which are medians and which are single runs. Full table in
[RESULTS.md](../RESULTS.md).

```sh
node bench/run.mjs --models <your-model> --repeat 5   # the only figure that counts
```

## Why sessions, not prompts

Each run is a **real multi-turn session**. That is the only honest way to measure
this: the rules are injected once at session start and cache-read from then on.

Measured on Haiku, same session:

| | Turn 1 | Turn 2 |
|---|---:|---:|
| Cache creation | 12,380 | 434 |
| Cache read | 17,536 | 29,916 |

One-shot sessions pay that 12k cache-creation cost every single time, which buries a
200-token output difference completely. The v1 harness made exactly that mistake,
which is why the cost column in [`RESULTS.md`](../RESULTS.md) is noise and the
output-length column is not.

## Flags

| Flag | Default |
|---|---|
| `--models a,b` | all nine: three Claude, six Codex |
| `--modes off,normal,cte` | all three |
| `--turns N` | 3 |
| `--repeat N` | 1 — runs each cell N times and reports the median |
| `--prompts <file>` | `bench/prompts.txt`, one per line |
| `--out <dir>` | `bench/results/` |
| `--dry-run` | show the plan and exit |

| `--isolated` | off — see below |

Benchmark sessions run with the hooks live, because that is exactly what is being
measured, but they set `PLAIN_SPEAK_BENCH=1` so their dozens of throwaway sessions
stay out of your lifetime stats. The mode reaches each child as `PLAIN_SPEAK_MODE`,
which outranks both the global flag and a project pin, so a run never writes your live
setting and a run you kill cannot leave it wrong.

## What counts as one session

A session is one `(model, mode, round)`. Nothing is shared across those three.

| Boundary | New session |
|---|---|
| Tool — `claude -p` vs `codex exec` | Yes, separate processes throughout |
| Model | Yes |
| Mode — `off`, `normal`, `cte` | Yes |
| Round — each `--repeat` | Yes |
| Turn, inside one cell | **No** — the prompts share the session |

Turn 1 opens the session, turns 2 and 3 resume it (`--resume`, `exec resume`). That is
the whole point: the rules go in once at session start and are cache-read after, which
is how they behave in real use. Three one-shot sessions would each pay the cache-creation
cost instead, and that buries the output difference — the mistake that made the v1 cost
numbers meaningless.

So `--repeat 5` across nine models and three modes is 135 sessions and 405 calls.

## What the baseline includes

Every cell is a brand-new session — no cell or repeat resumes another — and every child
runs from an empty directory, so no project `CLAUDE.md` or `AGENTS.md` is discovered.

What it still inherits is **your own machine**: the global `~/.claude/CLAUDE.md`, your
installed plugins, and their session-start injections. If your global file already asks
for short answers, the `off` baseline is not a model without response rules, and the
measured cut is a floor rather than the effect of these rules alone. A smoke-test call
during this harness's development replied *"Ready. Ponytail mode active."* — from a
plugin, inside a benchmark.

`--isolated` removes that: separate `CLAUDE_CONFIG_DIR` and `CODEX_HOME` under
`~/.plain-speak-bench`, holding nothing but plain-speak. It needs one interactive login
per home, because **setting `CLAUDE_CONFIG_DIR` at all stops Claude Code reading
credentials from the OS keychain** — every call then returns "Not logged in" and zero
tokens. The harness checks for the login and refuses to start without it:

```sh
CLAUDE_CONFIG_DIR=~/.plain-speak-bench/claude claude      # then /login, then quit
CODEX_HOME=~/.plain-speak-bench/codex codex login
node bench/run.mjs --isolated --repeat 5
```

Codex runs with `-s workspace-write` so its tool access roughly matches `claude -p`.

## How much to trust one run

Model output length varies between identical calls, so a single 3-turn run per cell is
a signal, not a measurement. The numbers in [RESULTS.md](../RESULTS.md) say how many
runs and turns produced them; treat a difference smaller than about 10 percentage
points as noise unless `--repeat` was used.

`--repeat 5` costs five times as much and reports the median of the five.

## What gets recorded

Per turn and per session: output tokens, uncached input, cache read, cache write, and
cost where the tool reports it. Claude reports a price; Codex does not, so compare
tokens across tools, not dollars.

For Codex, `output_tokens` and `reasoning_output_tokens` are recorded separately as well
as summed. The sum is what you are billed; the visible-only figure is the part response
rules can actually influence. `report.mjs` shows both columns when the data is there —
the nine-model run has it for the three 5.6 models only, and on those the two tracked
each other within 3 points, which is what ruled reasoning out as the cause of the GPT
results.

## Feeding the stats

`node bench/report.mjs --write` writes `src/savings.json`, which is what puts the
`measured` line into the stats command. Until that file has an entry for your model,
no figure is shown at all — an unmeasured number is worse than none.

That line reports the benchmark percentage and its provenance. It is deliberately not
multiplied out into "you saved N tokens": the benchmark measures short question-and-
answer turns, a real session is mostly tool traffic, and scaling one onto the other
would invent a number.
