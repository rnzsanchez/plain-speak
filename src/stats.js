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
    turns: 0,
    replies: 0,
    outputTokens: 0,
    inputTokens: 0,
    cacheRead: 0,
    cacheCreate: 0,
    model: null,
  };
  let lines;
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n');
  } catch {
    return totals;
  }

  const seen = new Set();
  for (const line of lines) {
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }

    if (row.type === 'user') {
      const content = row.message && row.message.content;
      const isToolResult =
        Array.isArray(content) && content.some((c) => c && c.type === 'tool_result');
      if (!isToolResult) totals.turns += 1;
      continue;
    }

    if (row.type !== 'assistant' || !row.message) continue;
    const id = row.message.id;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);

    const u = row.message.usage || {};
    totals.replies += 1;
    totals.outputTokens += u.output_tokens || 0;
    totals.inputTokens += u.input_tokens || 0;
    totals.cacheRead += u.cache_read_input_tokens || 0;
    totals.cacheCreate += u.cache_creation_input_tokens || 0;
    totals.model = row.message.model || totals.model;
  }
  return totals;
}

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

  return {
    mode,
    session: {
      ...session,
      injectionsIncludingSessionStart: session.injections + 1,
      injectedTokensEstimate: (session.injections + 1) * perInjection,
      transcript,
      outputPerReply:
        transcript && transcript.replies
          ? Math.round(transcript.outputTokens / transcript.replies)
          : null,
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

// Only the numbers a user acts on: is it holding, is it nagging, how big are
// the replies. Cache and raw input counts were noise and are gone.
function format(r) {
  const s = r.session;
  const t = s.transcript;
  const out = [`plain-speak — ${r.mode}`, ''];

  if (s.turns > 0) {
    const clean = (s.turns - s.trips) / s.turns;
    out.push(
      'This session',
      `  holding      ${bar(clean)}  ${Math.round(clean * 100)}%   ${s.turns - s.trips} of ${s.turns} turns clean`,
      `  reinjections ${bar(s.injections / state.MAX_RETRIES)}  ${s.injections}/${state.MAX_RETRIES} budget used`
    );
  } else {
    out.push('This session', '  no turns recorded yet');
  }

  if (t && t.replies) {
    out.push(`  replies      ${n(t.outputTokens)} tokens · ${n(s.outputPerReply)} per reply`);
    const win = savingsFor(t.model, r.mode);
    if (win) {
      const cut = win.outputCutPct / 100;
      const saved = Math.round((t.outputTokens * cut) / (1 - cut));
      out.push(
        `  saved        ${bar(cut)}  ${win.outputCutPct}%   ~${n(saved)} tokens vs rules off`
      );
    }
  }
  if (s.reason) out.push(`  last drift   ${s.reason}`);

  const L = r.lifetime;
  out.push('', 'Lifetime');
  if (L.turns > 0) {
    const clean = (L.turns - L.trips) / L.turns;
    out.push(
      `  holding      ${bar(clean)}  ${Math.round(clean * 100)}%   ${n(L.turns)} turns across ${n(L.sessions)} session${L.sessions === 1 ? '' : 's'}`,
      `  reinjections ${n(L.injections)} total (~${n(L.injections * r.perInjection)} tokens)`
    );
  } else {
    out.push('  no history yet');
  }

  return out.join('\n');
}

module.exports = { fromTranscript, rulesTokens, report, format };
