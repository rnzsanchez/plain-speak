# Measuring it

Run these from a clone, or from the plugin's install directory. Both carry `bench/`; the
npm package does not, because the raw results are 100 KB nobody installing it needs.

```sh
node bench/run.mjs --dry-run                            # plan and cost, zero calls
node bench/run.mjs --models claude-haiku-4-5 --turns 3  # cheap real run
node bench/report.mjs --write                           # table, and feed the stats
```

Every call is a real API call and costs real money. Start narrow.

**Check your own model before believing the pitch.** The current results say plain-speak
cuts output 29–48% on Opus 5 and 36–59% on Sonnet 5, roughly nothing on Haiku 4.5, and nothing
reliable on any GPT model — `normal` made five of six GPT models *longer*. Full table in
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

The mode flag is global, so a run temporarily changes your live setting and puts it
back on exit — including on Ctrl-C, though not if the process is killed outright.

Benchmark sessions run with the hooks live, because that is exactly what is being
measured, but they set `PLAIN_SPEAK_BENCH=1` so their dozens of throwaway sessions
stay out of your lifetime stats.

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
