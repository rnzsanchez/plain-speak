# A/B results

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

- Output tokens saved: **2154 (18%)**
- Rules injected: ~183 tok/prompt × 10 = ~1830 tok
- Net token change: ~324 fewer, roughly break-even on raw count

## Cost

`off=$1.2602  on=$1.2725` — the "on" run cost *more*.

That number is noise, not a result. Every prompt runs in a fresh session, so
~12k cache-creation tokens per run dominate the bill and swamp a 200-token
output delta. Cost per run here is ~$0.12 regardless of the rules.

## What this does and does not show

- **Does show:** responses get ~18% shorter, consistently. 9 of 10 prompts shrank.
- **Does not show:** a cost win. On input-heavy real sessions the injected 183
  tok/prompt is cached after the first turn, so the output saving should win —
  but this harness cannot measure that, because it never reuses a session.
- One prompt (database index) got *longer* with rules on. Sample is 10; treat
  the 18% as a signal, not a measurement.

## To re-run

```sh
./ab.sh              # uses prompts.txt
./ab.sh my-list.txt  # one prompt per line
```

Costs roughly $2.50 per full run on Opus.
