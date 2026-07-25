'use strict';
// Deterministic hygiene check: did the last reply still sound like the mode?
// No LLM call. Pure functions, so all of it is unit-testable.
//
// What this polices is TONE, not length. A long, complete thought is fine —
// fussy, pretentious, robotic phrasing is not. Nothing here is a rule the model
// must obey; crossing the threshold is only the signal that it drifted.

// Score-based: each hit is one point, and the mode's threshold decides when
// enough points mean drift.
//   normal — the base voice. Full thoughts welcome, so this is tone-led and one
//            stray word never trips it.
//   cte    — blunt, dialled to twelve. Any single hit is drift.
const THRESHOLDS = {
  normal: { points: 3, sentenceWords: 30, walls: 3 },
  cte: { points: 1, sentenceWords: 8, walls: 1 },
};

// Filler and throat-clearing.
const FILLER = [
  'certainly',
  "i'd be happy to",
  'i would be happy to',
  'great question',
  'i hope this helps',
  'feel free to',
  'let me know if you need anything',
  'as an ai',
];

// Corporate and pretentious register.
const PRETENTIOUS = [
  'leverage',
  'utilize',
  'facilitate',
  'seamless',
  'holistic',
  'paradigm',
  'synergy',
  'best-in-class',
  'cutting-edge',
  'myriad',
  'plethora',
  'delve into',
  'endeavor',
  'commence',
];

// Fussy connectors and padding.
const FUSSY = [
  'furthermore',
  'moreover',
  'subsequently',
  'in conclusion',
  'it is important to note',
  "it's worth noting",
  'it is worth noting',
  'please note that',
  'as previously mentioned',
  'aforementioned',
  'in order to',
  'generally speaking',
  'it depends on your specific use case',
  'there are several factors',
];

// Sounding like a machine reading a manual.
const ROBOTIC = [
  'i have completed the task',
  'the operation was successful',
  'please be advised',
  'kindly',
  'the following is',
  'i am unable to comply',
];

const MARKERS = [
  ['filler', FILLER],
  ['corporate word', PRETENTIOUS],
  ['fussy phrasing', FUSSY],
  ['robot register', ROBOTIC],
];

// The user asking for length or detail outranks every threshold below. Without
// this the checker would nag on exactly the replies meant to be long.
const LENGTH_REQUESTED =
  /\b(in detail|detailed|deep[- ]dive|walk ?through|step[- ]by[- ]step|comprehensive|verbose|elaborate|expand on|full (explanation|breakdown|write-?up)|explain why|teach me|write (me )?(a |an |the )?(plan|doc|document|report|readme|essay|guide|spec|summary))\b/i;

// Fenced blocks only. Inline `code` stays prose — it's part of a sentence.
const FENCE = /```[\s\S]*?(?:```|$)/g;

function splitFences(text) {
  const code = (text.match(FENCE) || []).join('\n');
  return { code, prose: text.replace(FENCE, '\n') };
}

const words = (s) => s.split(/\s+/).filter(Boolean);

function blocks(text) {
  return text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

// Tables, lists, headings and quotes are the formats the rules ask for, so they
// are not "prose paragraphs" and their sentence length is not measured.
const isProse = (block) => !/^([-*+>|#]|\d+[.)]\s)/.test(block);

const sentences = (block) =>
  block
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * @returns {{drift: boolean, reason: string|null, exempt: string|null,
 *            points: number, hits: string[]}}
 */
function check({
  reply = '',
  prompt = '',
  mode = 'normal',
  permissionMode = '',
  // The Stop hook never sees the prompt, so the prompt hook decides this at
  // submit time and passes the boolean through — no prompt text is stored.
  lengthRequested = false,
} = {}) {
  const clean = { drift: false, reason: null, points: 0, hits: [] };
  const threshold = THRESHOLDS[mode];
  if (!threshold) return { ...clean, exempt: 'mode-off' };
  if (permissionMode === 'plan') return { ...clean, exempt: 'plan-mode' };
  if (lengthRequested || LENGTH_REQUESTED.test(prompt)) {
    return { ...clean, exempt: 'length-requested' };
  }

  const { code, prose } = splitFences(reply);
  if (reply.length > 0 && code.length / reply.length > 0.5) {
    return { ...clean, exempt: 'code-heavy' };
  }

  const hits = [];
  const lower = prose.toLowerCase();
  for (const [label, list] of MARKERS) {
    for (const phrase of list) {
      if (lower.includes(phrase)) hits.push(`${label}: "${phrase}"`);
    }
  }

  const proseBlocks = blocks(prose).filter(isProse);
  // Only walls count. "Done." is a prose block too, and a mode that flagged it
  // would fire on every correct short answer.
  const walls = proseBlocks.filter((b) => sentences(b).length >= 2 && words(b).length >= 25);
  if (walls.length > threshold.walls) {
    hits.push(`${walls.length} paragraphs of prose (threshold ${threshold.walls})`);
  }

  const longest = proseBlocks
    .flatMap(sentences)
    .map((s) => words(s).length)
    .reduce((a, b) => Math.max(a, b), 0);
  if (longest > threshold.sentenceWords) {
    hits.push(`a ${longest}-word sentence (threshold ${threshold.sentenceWords})`);
  }

  if (hits.length < threshold.points) {
    return { ...clean, exempt: null, points: hits.length, hits };
  }
  return {
    drift: true,
    reason: hits.slice(0, 3).join('; '),
    exempt: null,
    points: hits.length,
    hits,
  };
}

module.exports = { check, THRESHOLDS, MARKERS, LENGTH_REQUESTED };
