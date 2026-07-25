# Measuring it

Run these from a clone, or from the plugin's install directory — both carry `bench/`.

```sh
node bench/run.mjs --dry-run                            # plan and cost, zero calls
node bench/run.mjs --models claude-haiku-4-5 --turns 3  # cheap real run
node bench/report.mjs --write                           # table, and feed the stats
```

Every call is a real API call and costs real money. Start narrow.

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
| `--models a,b` | all six: three Claude, three Codex |
| `--modes off,normal,cte` | all three |
| `--turns N` | 3 |
| `--prompts <file>` | `bench/prompts.txt`, one per line |
| `--out <dir>` | `bench/results/` |
| `--dry-run` | show the plan and exit |

The mode flag is global, so a run temporarily changes your live setting and puts it
back on exit — including on Ctrl-C, though not if the process is killed outright.

Benchmark sessions run with the hooks live, because that is exactly what is being
measured, but they set `PLAIN_SPEAK_BENCH=1` so their dozens of throwaway sessions
stay out of your lifetime stats.

## What gets recorded

Per turn and per session: output tokens, uncached input, cache read, cache write,
and cost where the tool reports it. Claude reports a price; Codex does not, so
compare tokens across tools, not dollars.

## Feeding the stats

`node bench/report.mjs --write` writes `src/savings.json`, which is what puts the
`saved` line into `/plain-speak-stats`. Until that file has an entry for your model,
no savings figure is shown at all — an unmeasured number is worse than none.
