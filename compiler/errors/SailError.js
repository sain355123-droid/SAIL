// compiler/errors/SailError.js
// SAIL v0.5 — shared error type and "did you mean...?" suggestion engine.
//
// Every SyntaxError/RuntimeError thrown by the Lexer, Parser, or Interpreter
// is a SailError. It carries a `kind` ("Lex" | "Syntax" | "Runtime"), a
// position, and an optional list of candidate names it can compare the
// offending token/identifier against to produce a suggestion.
//
// Why this exists as its own module: both the Parser (unexpected keyword,
// e.g. "shwo") and the Interpreter (undefined variable/task, e.g. "coutn")
// need the same "closest known name" logic. Centralising it here means the
// two never drift apart, and new callers just import `suggest()`.

/** Classic Levenshtein edit distance between two strings. */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Find the closest match to `name` among `candidates`.
 * Returns the candidate string, or null if nothing is close enough to be
 * a useful suggestion (avoids "did you mean X?" when X is unrelated).
 *
 * @param {string} name
 * @param {string[]} candidates
 * @returns {string|null}
 */
export function suggest(name, candidates) {
  if (!name || !candidates || candidates.length === 0) return null;

  let best = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    if (candidate === name) continue;
    const distance = levenshtein(name.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  // Only suggest when the edit distance is small relative to the word —
  // otherwise "did you mean" ends up pointing at something unrelated.
  const threshold = Math.max(2, Math.ceil(name.length / 2));
  return best !== null && bestDistance <= threshold ? best : null;
}

export class SailError extends Error {
  /**
   * @param {"Lex"|"Syntax"|"Runtime"} kind
   * @param {string} message
   * @param {{line?: number, column?: number, suggestion?: string, hint?: string}} [info]
   */
  constructor(kind, message, info = {}) {
    const pos = (info.line !== undefined && info.column !== undefined)
      ? ` at ${info.line}:${info.column}`
      : "";
    let full = `${kind}Error: ${message}${pos}`;
    if (info.suggestion) {
      full += `\n  Did you mean "${info.suggestion}"?`;
    }
    if (info.hint) {
      full += `\n  Hint: ${info.hint}`;
    }
    super(full);
    this.name = `${kind}Error`;
    this.kind = kind;
    this.line = info.line;
    this.column = info.column;
    this.suggestion = info.suggestion || null;
    this.hint = info.hint || null;
  }
}
