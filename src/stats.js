'use strict';
// Token accounting from the transcript itself — real numbers, not estimates.

const fs = require('fs');
const path = require('path');
const state = require('./state');

// A transcript writes one row per content block, so the same assistant message
// (and its usage) appears several times. Summing rows blind inflates the total
// roughly threefold — dedupe on message.id.
function fromTranscript(file) {
  const totals = {
    replies: 0,
    outputTokens: 0,
    proseTokens: 0,
    model: null,
  };
  let lines;
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n');
  } catch {
    return totals;
  }

  // One entry per message: usage is counted once, but the blocks arrive across the
  // repeated rows and all of them are needed to tell prose from tool traffic.
  const msgs = new Map();
  for (const line of lines) {
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }

    if (row.type !== 'assistant' || !row.message) continue;
    const id = row.message.id || `anon-${msgs.size}`;
    if (!msgs.has(id)) {
      msgs.set(id, { out: (row.message.usage || {}).output_tokens || 0, blocks: [] });
      totals.replies += 1;
      totals.outputTokens += (row.message.usage || {}).output_tokens || 0;
    }
    const blocks = Array.isArray(row.message.content) ? row.message.content : [];
    msgs.get(id).blocks.push(...blocks);
    totals.model = row.message.model || totals.model;
  }

  // Usage is per message, never per block, so the split is apportioned by size. Prose
  // runs ~4 chars a token and tool JSON ~3, which makes this an estimate — but the gap
  // between "what I said" and "what I did" is far too big to leave unsplit.
  for (const m of msgs.values()) {
    const seen = new Set();
    const blocks = m.blocks.filter((b) => {
      const key = `${b.type}:${blockSize(b)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const total = blocks.reduce((a, b) => a + blockSize(b), 0);
    if (!total) continue;
    for (const b of blocks) {
      if (b.type === 'text') totals.proseTokens += (m.out * blockSize(b)) / total;
    }
  }
  totals.proseTokens = Math.round(totals.proseTokens);
  return totals;
}

const blockSize = (b) =>
  b.type === 'text'
    ? (b.text || '').length
    : b.type === 'thinking'
      ? (b.thinking || '').length
      : JSON.stringify(b.input || {}).length;

// Rough size of one injection, for "what did the rules cost me" — the usual
// ~4 chars per token. Labelled as an estimate everywhere it is shown.
function rulesTokens(mode) {
  try {
    const file = path.join(__dirname, '..', 'modes', `${mode}.md`);
    return Math.round(fs.statSync(file).size / 4);
  } catch {
    return 0;
  }
}

// Written by `node bench/report.mjs --write`. Absent until a benchmark has run,
// and when it is absent no savings figure is shown at all — better than a
// number nobody measured.
function loadSavings() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'savings.json'), 'utf8'));
  } catch {
    return {};
  }
}

function savingsFor(model, mode) {
  if (!model) return null;
  const table = loadSavings();
  const key = Object.keys(table).find((m) => model.startsWith(m) || m.startsWith(model));
  const entry = key && table[key] && table[key][mode];
  return entry && entry.outputCutPct > 0 ? entry : null;
}

function report({ sessionId, transcriptPath } = {}) {
  const store = state.readStore();
  const session = state.readSession(sessionId, store);
  const mode = state.readMode();
  const transcript = transcriptPath ? fromTranscript(transcriptPath) : null;
  const perInjection = rulesTokens(session.mode || mode);
  const win = transcript ? savingsFor(transcript.model, mode) : null;

  // What the rules can possibly have saved. A cut of c means what you see is (1-c) of
  // what you would have got, so the difference is prose × c/(1-c) — and only the prose,
  // because tool calls and code are written normally in every mode.
  const cut = win ? win.outputCutPct / 100 : 0;
  const saved = win && transcript ? Math.round((transcript.proseTokens * cut) / (1 - cut)) : null;
  const spent = session.injections * perInjection;

  return {
    mode,
    session: {
      ...session,
      transcript,
      outputPerReply:
        transcript && transcript.replies
          ? Math.round(transcript.outputTokens / transcript.replies)
          : null,
      saved,
      spent,
      net: saved == null ? null : saved - spent,
      benchmark: win,
    },
    lifetime: store.lifetime,
    perInjection,
  };
}

const n = (v) => (v == null ? '—' : v.toLocaleString('en-US'));

function bar(fraction, width = 10) {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// Written to be read on a tired evening: the answer on the first line, plain words
// under it, and every rough number labelled rough.
const round100 = (v) => Math.round(v / 100) * 100;

function format(r) {
  const s = r.session;
  const t = s.transcript;
  const out = [`plain-speak — ${r.mode}`, ''];

  // The headline: did this thing pay for itself. Rough on purpose — the percentage
  // behind it comes from a benchmark, not from this session's own replies.
  if (r.mode === 'off') {
    out.push('  Off. Nothing is injected and nothing is checked.', '');
  } else if (s.saved != null) {
    out.push(
      `  Saved roughly ${n(round100(s.saved))} tokens. Cost ${n(round100(s.spent))} to do it.`,
      `  Rough: ${Math.round(s.benchmark.outputCutPct)}% comes from a benchmark on ${t.model}, not from this session.`,
      ''
    );
  } else if (t && t.model) {
    out.push(`  No benchmark for ${t.model} yet, so no savings figure. See docs/benchmark.md.`, '');
  }

  if (s.turns > 0) {
    const clean = (s.turns - s.trips) / s.turns;
    out.push(
      'This session',
      `  stayed short   ${bar(clean)}  ${s.turns - s.trips} of ${s.turns} replies`,
      `  had to remind  ${n(s.injections)} time${s.injections === 1 ? '' : 's'}${state.easedOff(s) ? ', now reminding less often' : ''}`
    );
  } else {
    out.push('This session', '  nothing checked yet');
  }

  if (t && t.replies) {
    // Two very different things, and the gap is the point: the rules only govern the
    // talking. Code, commits and tool calls are written normally in every mode.
    out.push(
      `  I talked       ${n(t.proseTokens)} tokens`,
      `  I worked       ${n(t.outputTokens - t.proseTokens)} tokens of tool calls and code — untouched by the rules`
    );
  }
  if (s.reason) out.push(`  last slip      ${s.reason}`);

  const L = r.lifetime;
  out.push('', 'Lifetime');
  if (L.turns > 0) {
    const clean = (L.turns - L.trips) / L.turns;
    out.push(
      `  stayed short   ${bar(clean)}  ${n(L.turns - L.trips)} of ${n(L.turns)} replies, across ${n(L.sessions)} session${L.sessions === 1 ? '' : 's'}`,
      `  reminders      ${n(L.injections)}, about ${n(round100(L.injections * r.perInjection))} tokens all in`
    );
  } else {
    out.push('  no history yet');
  }

  return out.join('\n');
}

module.exports = { report, format };
