// compiler/index.js
// SAIL Engine v1.0
//
// The programmatic core of SAIL: lex -> parse -> optimize -> interpret.
// Exposes runSource()/runFile() for use by the CLI (bin/sail.js) and the
// REPL, and also runs directly when invoked as a script, for backward
// compatibility with earlier versions:
//
//   node compiler/index.js                 # runs examples/hello.sai
//   node compiler/index.js loops.sai       # runs any file in examples/
//
// (The full command set — run/build/version/help/repl/new — lives in
// bin/sail.js, which is the recommended way to use SAIL day-to-day.)

import { readFileSync, existsSync } from "fs";
import { fileURLToPath }             from "url";
import { join, dirname, resolve }     from "path";

import { Lexer }        from "./lexer/Lexer.js";
import { Parser }       from "./parser/Parser.js";
import { Interpreter }  from "./interpreter/Interpreter.js";
import { ModuleSystem } from "./runtime/ModuleSystem.js";
import { optimize }     from "./optimizer/Optimizer.js";
import { reportError, reportWarning } from "./errors/ErrorReporter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Run SAIL source text that has already been read from a file.
 * @param {string} source
 * @param {object} [options]
 * @param {string|null} [options.filePath] - Absolute path, for resolving
 *   relative imports. null if this source has no file of its own.
 * @param {boolean} [options.optimize] - Run the optimizer pass. Default true.
 * @param {boolean} [options.warnings] - Print optimizer warnings. Default true.
 * @param {Environment} [options.globalEnv] - Reuse a global environment
 *   (used by the REPL to keep variables between entries).
 * @returns {Interpreter} the Interpreter instance that ran the program
 */
export function runSource(source, options = {}) {
  const filePath   = options.filePath ?? null;
  const doOptimize = options.optimize ?? true;
  const doWarn     = options.warnings ?? true;

  const tokens = new Lexer(source).tokenize();
  let ast      = new Parser(tokens).parse();

  if (doOptimize) {
    ast = optimize(ast, {
      onWarning: doWarn ? (msg) => reportWarning(msg) : () => {},
    });
  }

  const moduleSystem = options.moduleSystem ?? new ModuleSystem(Interpreter);
  const interpreter = new Interpreter(ast, {
    filePath,
    moduleSystem,
    globalEnv: options.globalEnv,
  });
  interpreter.run();
  return interpreter;
}

/**
 * Read and run a SAIL file from disk.
 * @param {string} filePath - Absolute or relative path to a .sai file.
 * @param {object} [options] - See runSource().
 */
export function runFile(filePath, options = {}) {
  const absolutePath = resolve(filePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Couldn't find the file "${filePath}".`);
  }
  const source = readFileSync(absolutePath, "utf8");
  return runSource(source, { ...options, filePath: absolutePath });
}

// ── Backward-compatible standalone entry point ──────────────────────────────
// Only runs when this file is executed directly (not when imported).
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  const exampleFile = process.argv[2] || "hello.sai";
  const filePath = join(__dirname, "examples", exampleFile);

  if (!existsSync(filePath)) {
    console.error(`\nSAIL couldn't find the file "${exampleFile}".`);
    console.error(`  Tip: check the path, or place it in compiler/examples/.\n`);
    process.exit(1);
  }

  try {
    runFile(filePath);
  } catch (err) {
    // Best-effort stage guess for the legacy entry point — the CLI
    // (bin/sail.js) reports stage-specific errors more precisely.
    const stage = err instanceof SyntaxError ? "parsing" : "running";
    reportError(stage, err);
    process.exit(1);
  }
}
