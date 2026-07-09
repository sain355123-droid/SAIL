// compiler/errors/ErrorReporter.js
// SAIL Error Reporter v1.0
//
// Every error SAIL throws — from lexing, parsing, or running a program —
// is a plain Error/SyntaxError/TypeError/ReferenceError whose `.message`
// may contain an embedded "\nTip: ..." line written for a human. This
// module is the single place that turns any such error into the
// consistent, friendly, beginner-oriented format SAIL always shows,
// instead of a raw JavaScript stack trace.
//
// Used by both compiler/index.js (running a single file) and
// compiler/cli.js (the `sail` command-line tool), so a program behaves
// identically whichever way it's launched.

const STAGE_LABELS = {
  reading:  "reading your code (lexing)",
  parsing:  "understanding your code's structure (parsing)",
  running:  "running your program",
};

/**
 * Build the friendly, multi-line error report for the terminal.
 * @param {"reading"|"parsing"|"running"} stage
 * @param {Error} err
 * @returns {string}
 */
export function formatError(stage, err) {
  const label   = STAGE_LABELS[stage] || stage;
  const message = err && err.message ? err.message : String(err);
  const indented = message.replace(/\n/g, "\n  ");
  return `\nSAIL found a problem while ${label}:\n\n  ${indented}\n`;
}

/**
 * Print the friendly error report to stderr.
 * @param {"reading"|"parsing"|"running"} stage
 * @param {Error} err
 */
export function reportError(stage, err) {
  console.error(formatError(stage, err));
}

/**
 * Print a non-fatal warning (e.g. from the optimizer's static checks) to
 * stderr, in a visually distinct but calm style — warnings never stop
 * execution.
 * @param {string} message
 */
export function reportWarning(message) {
  console.error(`SAIL warning: ${message}`);
}
