#!/usr/bin/env node
// Turns bench/results/*.json into the savings table, and writes the machine-
// readable summary that `plain-speak stats` reads to show real savings.
//
//   node bench/report.mjs            print the table
//   node bench/report.mjs --write    also update src/savings.json

import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(import.meta.dirname, 'results');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];

if (files.length === 0) {
  console.log('No results yet. Run: node bench/run.mjs --dry-run');
  process.exit(0);
}

// Latest run wins for a given model+mode.
const byModel = new Map();
for (const f of files.sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!byModel.has(r.model)) byModel.set(r.model, {});
  byModel.get(r.model)[r.mode] = r;
}

const pct = (from, to) => (from ? ((from - to) / from) * 100 : 0);
const rows = [];
const savings = {};

for (const [model, modes] of byModel) {
  const base = modes.off;
  for (const mode of ['normal', 'cte']) {
    const run = modes[mode];
    if (!run) continue;
    const cut = base ? pct(base.outputPerTurn, run.outputPerTurn) : null;
    // Where reasoning tokens are reported, the visible-reply cut is the figure that
    // response rules actually influence. Both are shown.
    const visibleCut =
      base && base.visibleOutputTokens && run.visibleOutputTokens
        ? pct(base.visibleOutputTokens, run.visibleOutputTokens)
        : null;
    rows.push({
      model,
      mode,
      turns: run.turns,
      perTurn: run.outputPerTurn,
      base: base ? base.outputPerTurn : null,
      cut,
      visibleCut,
    });
    if (cut != null) {
      savings[model] = savings[model] || {};
      savings[model][mode] = { outputCutPct: Number(cut.toFixed(1)), turns: run.turns };
    }
  }
}

const cell = (v, d = '—') => (v == null ? d : v);
console.log('| Model | Mode | Turns | Billed out/turn | Rules off | Cut | Visible-only cut |');
console.log('|---|---|---:|---:|---:|---:|---:|');
for (const r of rows.sort((a, b) => a.model.localeCompare(b.model) || a.mode.localeCompare(b.mode))) {
  const cut = r.cut == null ? '—' : `${r.cut.toFixed(0)}%`;
  const vis = r.visibleCut == null ? '—' : `${r.visibleCut.toFixed(0)}%`;
  console.log(
    `| ${r.model} | ${r.mode} | ${r.turns} | ${cell(r.perTurn)} | ${cell(r.base)} | ${cut} | ${vis} |`
  );
}

if (process.argv.includes('--write')) {
  // Written into src/ because it is runtime data: `plain-speak stats` reads it
  // to turn "18% shorter on this model" into a real number for your session.
  const out = path.join(import.meta.dirname, '..', 'src', 'savings.json');
  fs.writeFileSync(out, `${JSON.stringify(savings, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(process.cwd(), out)} — plain-speak stats will use it.`);
}
