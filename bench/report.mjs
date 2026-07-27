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

// Latest run wins for a given model+effort+mode. Effort has to be part of the key: a
// `--reasoning none` run and a `--reasoning medium` run of the same cell are different
// experiments, and keying on model+mode alone let the later one silently replace the
// earlier one in the table.
const byModel = new Map();
for (const f of files.sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const key = `${r.model} ${r.reasoningEffort || ''}`;
  if (!byModel.has(key)) byModel.set(key, {});
  byModel.get(key)[r.mode] = { ...r, stamp: f.slice(0, 19) };
}

const pct = (from, to) => (from ? ((from - to) / from) * 100 : 0);
const rows = [];
const savings = {};

const warnings = [];

for (const [, modes] of byModel) {
  const base = modes.off;
  for (const mode of ['normal', 'cte']) {
    const run = modes[mode];
    if (!run) continue;
    const model = run.model;
    // The baseline and the arm it is compared against are picked independently, so they
    // can come from different invocations. Same numbers, different conditions, and
    // nothing in the table would say so.
    if (base && base.stamp !== run.stamp) {
      warnings.push(
        `${model} ${mode}: compared against an \`off\` baseline from a different run (${base.stamp} vs ${run.stamp})`
      );
    }
    if (base && (base.runs || 1) !== (run.runs || 1)) {
      warnings.push(
        `${model} ${mode}: ${run.runs || 1} run(s) compared against a baseline of ${base.runs || 1}`
      );
    }
    const cut = base ? pct(base.outputPerTurn, run.outputPerTurn) : null;
    // Where reasoning tokens are reported, the visible-reply cut is the figure that
    // response rules actually influence. Both are shown.
    const visibleCut =
      base && base.visibleOutputTokens && run.visibleOutputTokens
        ? pct(base.visibleOutputTokens, run.visibleOutputTokens)
        : null;
    rows.push({
      model,
      effort: run.reasoningEffort || null,
      mode,
      turns: run.turns,
      perTurn: run.outputPerTurn,
      base: base ? base.outputPerTurn : null,
      cut,
      visibleCut,
      stamp: run.stamp,
    });
    // A pinned reasoning effort is a controlled experiment, not the setting anyone runs
    // day to day, so it must not become the number `plain-speak stats` quotes at them.
    // Codex models are skipped for a different reason: savings.json is read by
    // `plain-speak stats`, which measures a session from a Claude Code transcript and has
    // no way to reach a Codex one. A gpt-* row there can never match anything — it just
    // reads as published data. The GPT numbers live in RESULTS.md, where people read them.
    if (cut != null && !run.reasoningEffort && !model.startsWith('gpt')) {
      savings[model] = savings[model] || {};
      savings[model][mode] = { outputCutPct: Number(cut.toFixed(1)), turns: run.turns };
    }
  }
}

const cell = (v, d = '—') => (v == null ? d : v);
console.log(
  '| Model | Effort | Mode | Turns | Billed out/turn | Rules off | Cut | Visible-only cut | Measured |'
);
console.log('|---|---|---|---:|---:|---:|---:|---:|---|');
for (const r of rows.sort(
  (a, b) =>
    a.model.localeCompare(b.model) ||
    String(a.effort).localeCompare(String(b.effort)) ||
    a.mode.localeCompare(b.mode)
)) {
  const cut = r.cut == null ? '—' : `${r.cut.toFixed(0)}%`;
  const vis = r.visibleCut == null ? '—' : `${r.visibleCut.toFixed(0)}%`;
  console.log(
    `| ${r.model} | ${cell(r.effort, 'inherited')} | ${r.mode} | ${r.turns} | ${cell(r.perTurn)} | ${cell(r.base)} | ${cut} | ${vis} | ${r.stamp} |`
  );
}

// Loud on purpose. A mismatched pairing still prints a number, and a number that looks
// measured is exactly how the contaminated v1 figures got published.
for (const w of warnings) console.log(`\n! ${w}`);

if (process.argv.includes('--write')) {
  // Written into src/ because it is runtime data: `plain-speak stats` reads it
  // to turn "18% shorter on this model" into a real number for your session.
  const out = path.join(import.meta.dirname, '..', 'src', 'savings.json');
  fs.writeFileSync(out, `${JSON.stringify(savings, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(process.cwd(), out)} — plain-speak stats will use it.`);
}
