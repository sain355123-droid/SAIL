// compiler/interpreter/stdlib.js
// SAIL Standard Library v0.5
//
// Each builtin is a plain object: { __sailBuiltin: true, name, fn }.
// `fn` receives (args, node) where `args` is the array of already-evaluated
// argument values and `node` is the CallExpressionNode (used only for
// line/column info in error messages). Builtins are seeded directly into
// the interpreter's global Environment, so calling them goes through the
// exact same lookup + CallExpressionNode path as calling a user task —
// there is no separate "builtin call" code path to keep in sync.
//
// Extending the standard library:
//   Add a new entry to the object returned by createStandardLibrary().
//   Use `interpreter._runtimeError(...)`, `interpreter._typeName(...)`, and
//   `interpreter._stringify(...)` to keep error messages and formatting
//   consistent with the rest of the language.

import { readFileSync } from "fs";

// Lazily read all of stdin exactly once, split into lines. This keeps
// input() synchronous (the interpreter is a plain synchronous tree-walker)
// without blocking on every call — the whole stream is read up front the
// first time input() is used.
let _stdinLines = null;
function _nextStdinLine() {
  if (_stdinLines === null) {
    let raw = "";
    try {
      raw = readFileSync(0, "utf8");
    } catch {
      raw = "";
    }
    _stdinLines = raw.length > 0 ? raw.split("\n") : [];
    // Drop a single trailing empty line caused by a final newline in the input.
    if (_stdinLines.length > 0 && _stdinLines[_stdinLines.length - 1] === "") {
      _stdinLines.pop();
    }
  }
  return _stdinLines.length > 0 ? _stdinLines.shift() : null;
}

function _builtin(name, fn) {
  return { __sailBuiltin: true, name, fn };
}

function _checkArity(interpreter, node, name, args, min, max) {
  if (args.length < min || args.length > max) {
    const expected = min === max ? `${min}` : `${min}-${max}`;
    interpreter._runtimeError(
      `${name}() expects ${expected} argument${max === 1 ? "" : "s"} but got ${args.length}`,
      node
    );
  }
}

export function createStandardLibrary(interpreter) {
  return {
    // length(x) — number of elements in an array, or characters in a string.
    length: _builtin("length", (args, node) => {
      _checkArity(interpreter, node, "length", args, 1, 1);
      const [value] = args;
      if (Array.isArray(value) || typeof value === "string") return value.length;
      interpreter._runtimeError(
        `length() expects an array or a string, got ${interpreter._typeName(value)}`,
        node
      );
    }),

    // input(prompt?) — print an optional prompt, read one line from stdin.
    input: _builtin("input", (args, node) => {
      _checkArity(interpreter, node, "input", args, 0, 1);
      if (args.length === 1) {
        if (typeof args[0] !== "string") {
          interpreter._runtimeError(`input() prompt must be a string, got ${interpreter._typeName(args[0])}`, node);
        }
        process.stdout.write(args[0]);
      }
      const line = _nextStdinLine();
      if (line === null) {
        interpreter._runtimeError("input() called but no more input was available", node, {
          hint: "Make sure input is piped in, or that the program isn't asking for more values than were provided.",
        });
      }
      return line;
    }),

    // random() → float in [0, 1)
    // random(min, max) → random integer in [min, max], inclusive
    random: _builtin("random", (args, node) => {
      _checkArity(interpreter, node, "random", args, 0, 2);
      if (args.length === 0) return Math.random();
      const [min, max] = args;
      if (typeof min !== "number" || typeof max !== "number") {
        interpreter._runtimeError(`random(min, max) expects two numbers`, node);
      }
      if (min > max) {
        interpreter._runtimeError(`random(min, max) needs min <= max, got random(${min}, ${max})`, node);
      }
      return Math.floor(Math.random() * (Math.floor(max) - Math.ceil(min) + 1)) + Math.ceil(min);
    }),

    // time() — current time in milliseconds since the Unix epoch.
    time: _builtin("time", (args, node) => {
      _checkArity(interpreter, node, "time", args, 0, 0);
      return Date.now();
    }),

    // type(x) — "number" | "string" | "boolean" | "array" | "task" | "nothing"
    type: _builtin("type", (args, node) => {
      _checkArity(interpreter, node, "type", args, 1, 1);
      const [value] = args;
      if (value === null || value === undefined) return "nothing";
      if (Array.isArray(value)) return "array";
      if (value.__sailTask || value.__sailBuiltin) return "task";
      if (typeof value === "string") return "string";
      if (typeof value === "number") return "number";
      if (typeof value === "boolean") return "boolean";
      return typeof value;
    }),

    // number(x) — convert a string or boolean to a number.
    number: _builtin("number", (args, node) => {
      _checkArity(interpreter, node, "number", args, 1, 1);
      const [value] = args;
      if (typeof value === "number") return value;
      if (typeof value === "boolean") return value ? 1 : 0;
      if (typeof value === "string") {
        const n = Number(value.trim());
        if (Number.isNaN(n) || value.trim() === "") {
          interpreter._runtimeError(`number() couldn't convert "${value}" to a number`, node, {
            hint: `Make sure the text contains only digits (and optionally a decimal point or a leading "-").`,
          });
        }
        return n;
      }
      interpreter._runtimeError(`number() can't convert ${interpreter._typeName(value)} to a number`, node);
    }),

    // text(x) — convert any value to its display string.
    text: _builtin("text", (args, node) => {
      _checkArity(interpreter, node, "text", args, 1, 1);
      return interpreter._stringify(args[0]);
    }),
  };
}
