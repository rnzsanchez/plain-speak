---
name: plain-speak-doctor
description: Check that plain-speak's hooks, badge and commands are wired correctly.
disable-model-invocation: true
allowed-tools: Bash
---

Run this and show the output exactly as printed:

```sh
node "$HOME/.claude/plain-speak/bin/cli.js" doctor
```

If any line says `MISS`, tell the user to run `npx plain-speak install` again, and
that hooks load on the next session or after `/hooks`.
