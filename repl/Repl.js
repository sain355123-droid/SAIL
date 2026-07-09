// compiler/repl/Repl.js
// SAIL REPL v1.0
//
// An interactive read-eval-print loop built entirely on Node's built-in
// `readline` module — no external dependencies. `readline` gives arrow-key
// history navigation "for free" when `terminal: true` (the default for a
// TTY), so no separate history/arrow-key handling code is needed.
//
// Each REPL entry is wrapped as the body of an implicit module, so a
// single top-level SAIL program's worth of state (variables, tasks)
// persists across entries — typing `let x = 5` in one turn makes `x`
// available in the next.
//
// Multi-line input: if what's been typed so far contains more "start"
// keywords than "end" keywords, the REPL keeps prompting with a
// continuation prompt until the blocks balance, so multi-line if/while/
// for/task bodies can be typed naturally.
//
// Bare expressions: a line that parses cleanly as a standalone expression
// (not a full statement) is automatically wrapped in `show( ... )`, so
// typing `2 + 2` prints `4` the way most REPLs behave, without requiring
// "show" every time.

import readline from "readline";

import { Lexer }        from "../lexer/Lexer.js";
import { Parser }       from "../parser/Parser.js";
import { Interpreter }  from "../interpreter/Interpreter.js";
import { ModuleSystem } from "../runtime/ModuleSystem.js";
import { TokenType }    from "../lexer/TokenType.js";

// ── Minimal ANSI colour helpers (no external dependency) ───────────────────
const color = {
  reset:  (s) => `\x1b[0m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
};

const PROMPT      = color.cyan("sail> ");
const CONT_PROMPT = color.dim("  ... ");

/** Count how many more "start" tokens than "end" tokens appear in source. */
function unclosedBlockCount(source) {
  let tokens;
  try {
    tokens = new Lexer(source).tokenize();
  } catch {
    return 0; // can't tell yet — let the real parse attempt surface the error
  }
  let depth = 0;
  for (const tok of tokens) {
    if (tok.type === TokenType.START) depth++;
    if (tok.type === TokenType.END) depth--;
  }
  return depth;
}

/** True if `source` parses cleanly as a single standalone expression. */
function tryParseAsExpression(source) {
  try {
    const tokens = new Lexer(source).tokenize();
    const parser = new Parser(tokens);
    const expr = parser._parseExpression();
    // The expression must consume the entire input (aside from a trailing
    // newline/EOF) for this to count — otherwise it's actually a statement
    // that merely starts with something expression-shaped.
    if (!parser._check(TokenType.NEWLINE) && !parser._check(TokenType.EOF)) {
      return null;
    }
    return expr;
  } catch {
    return null;
  }
}

export class Repl {
  constructor() {
    this._globalEnv = null; // created lazily on first successful run, to reuse across turns
    this._moduleSystem = new ModuleSystem(Interpreter);
    this._buffer = "";
  }

  start() {
    console.log(color.bold("SAIL REPL v1.0"));
    console.log(color.dim(`Type SAIL code, or "exit" / Ctrl+D to quit. Multi-line blocks are supported.`));

    const rl = readline.createInterface({
      input:  process.stdin,
      output: process.stdout,
      prompt: PROMPT,
      terminal: true, // enables arrow-key history navigation automatically
      historySize: 500,
    });

    rl.prompt();

    rl.on("line", (line) => {
      if (this._buffer === "" && (line.trim() === "exit" || line.trim() === "quit")) {
        rl.close();
        return;
      }

      this._buffer += line + "\n";

      if (unclosedBlockCount(this._buffer) > 0) {
        rl.setPrompt(CONT_PROMPT);
        rl.prompt();
        return;
      }

      this._evaluateBuffer(this._buffer);
      this._buffer = "";
      rl.setPrompt(PROMPT);
      rl.prompt();
    });

    rl.on("close", () => {
      console.log(color.dim("\nGoodbye!"));
      process.exit(0);
    });
  }

  _evaluateBuffer(rawInput) {
    const trimmed = rawInput.trim();
    if (trimmed === "") return;

    // Try treating the whole entry as one expression first, so `2 + 2`
    // just prints its value like most REPLs do.
    const asExpr = tryParseAsExpression(trimmed);
    const wrapped = asExpr !== null
      ? `module REPL\nstart\nshow (${trimmed})\nend\n`
      : `module REPL\nstart\n${rawInput}end\n`;

    try {
      const tokens = new Lexer(wrapped).tokenize();
      const ast    = new Parser(tokens).parse();

      if (this._globalEnv === null) {
        const interp = new Interpreter(ast, { moduleSystem: this._moduleSystem });
        interp.run();
        this._globalEnv = interp.getGlobalEnvironment();
      } else {
        const interp = new Interpreter(ast, {
          moduleSystem: this._moduleSystem,
          globalEnv: this._globalEnv,
        });
        interp.run();
      }
    } catch (err) {
      console.error(color.red(`Error: ${err.message.replace(/\n/g, "\n  ")}`));
    }
  }
}
