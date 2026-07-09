// compiler/tests/checks.js
// SAIL Targeted Tests v1.0
//
// Feature- and error-message-level checks that don't fit the "run a whole
// example, diff its output" model used by the golden tests in run.js —
// mostly making sure the friendly error system actually produces the
// right kind of message for each documented failure case.

import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir }                              from "os";
import { join }                                  from "path";

import { Lexer }       from "../lexer/Lexer.js";
import { Parser }      from "../parser/Parser.js";
import { optimize }    from "../optimizer/Optimizer.js";

/**
 * Run a snippet of SAIL source (auto-wrapped in a module) and return
 * { output, error }. Exactly one of the two will be set.
 */
function run(source, { runFile, captureOutput }) {
  const dir = mkdtempSync(join(tmpdir(), "sail-test-"));
  const filePath = join(dir, "snippet.sai");
  writeFileSync(filePath, source, "utf8");
  let output = null, error = null;
  try {
    output = captureOutput(() => runFile(filePath, { warnings: false }));
  } catch (err) {
    error = err;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { output, error };
}

function wrap(body) {
  return `module Snippet\nstart\n${body}\nend\n`;
}

export function runChecks({ runFile, captureOutput, examplesDir }) {
  const results = [];

  function check(name, fn) {
    try {
      const message = fn();
      if (message) {
        results.push({ name, pass: false, message });
      } else {
        results.push({ name, pass: true });
      }
    } catch (err) {
      results.push({ name, pass: false, message: `threw unexpectedly: ${err.message}` });
    }
  }

  // ── Error messages ─────────────────────────────────────────────────────

  check("const reassignment is rejected", () => {
    const { error } = run(wrap(`const X = 1\nlet X = 2`), { runFile, captureOutput });
    if (!error) return "expected an error, got none";
    if (!error.message.includes("constant")) return `error message missing "constant": ${error.message}`;
  });

  check("division by zero is rejected", () => {
    const { error } = run(wrap(`show 5 / 0`), { runFile, captureOutput });
    if (!error) return "expected an error, got none";
    if (!error.message.includes("Division by zero")) return `unexpected message: ${error.message}`;
  });

  check("undefined variable is rejected", () => {
    const { error } = run(wrap(`show doesNotExist`), { runFile, captureOutput });
    if (!error) return "expected an error, got none";
    if (!error.message.includes("Undefined variable")) return `unexpected message: ${error.message}`;
  });

  check("array out-of-bounds index is rejected", () => {
    const { error } = run(wrap(`let arr = [1, 2, 3]\nshow arr[10]`), { runFile, captureOutput });
    if (!error) return "expected an error, got none";
    if (!error.message.includes("out of bounds")) return `unexpected message: ${error.message}`;
  });

  check("unbounded recursion is caught with a friendly message", () => {
    const { error } = run(wrap(`task loop(n) start\n  return loop(n + 1)\nend\nshow loop(0)`), { runFile, captureOutput });
    if (!error) return "expected an error, got none";
    if (!error.message.includes("unbounded recursion")) return `unexpected message: ${error.message}`;
  });

  check("missing object key is rejected", () => {
    const { error } = run(wrap(`let obj = { a: 1 }\nshow obj.missing`), { runFile, captureOutput });
    if (!error) return "expected an error, got none";
    if (!error.message.includes("doesn't exist on this object")) return `unexpected message: ${error.message}`;
  });

  check("calling too many arguments is rejected", () => {
    const { error } = run(wrap(`task add(a, b) start\n  return a + b\nend\nshow add(1, 2, 3)`), { runFile, captureOutput });
    if (!error) return "expected an error, got none";
    if (!error.message.includes("argument")) return `unexpected message: ${error.message}`;
  });

  check("semicolons produce a friendly redirect", () => {
    const { error } = run(wrap(`let x = 1;`), { runFile, captureOutput });
    if (!error) return "expected an error, got none";
    if (!error.message.includes("semicolons")) return `unexpected message: ${error.message}`;
  });

  // ── Feature correctness ────────────────────────────────────────────────

  check("optional parameters default to nothing", () => {
    const { output, error } = run(
      wrap(`task f(a, b) start\n  show b\nend\nf(1)`),
      { runFile, captureOutput }
    );
    if (error) return `unexpected error: ${error.message}`;
    if (output !== "nothing\n") return `expected "nothing", got ${JSON.stringify(output)}`;
  });

  check("default parameter values are used when omitted", () => {
    const { output, error } = run(
      wrap(`task f(a, b = 10) start\n  show a + b\nend\nf(5)`),
      { runFile, captureOutput }
    );
    if (error) return `unexpected error: ${error.message}`;
    if (output !== "15\n") return `expected "15", got ${JSON.stringify(output)}`;
  });

  check("closures capture and mutate their own state independently", () => {
    const { output, error } = run(
      wrap(
        `task makeCounter() start\n` +
        `  let n = 0\n` +
        `  return task() start\n` +
        `    let n = n + 1\n` +
        `    return n\n` +
        `  end\n` +
        `end\n` +
        `let c1 = makeCounter()\n` +
        `let c2 = makeCounter()\n` +
        `show c1()\nshow c1()\nshow c2()`
      ),
      { runFile, captureOutput }
    );
    if (error) return `unexpected error: ${error.message}`;
    if (output !== "1\n2\n1\n") return `expected "1\\n2\\n1\\n", got ${JSON.stringify(output)}`;
  });

  check("else-if chains pick the first matching branch", () => {
    const { output, error } = run(
      wrap(
        `let x = 5\n` +
        `if x > 10 start\n  show "big"\nend\n` +
        `else if x > 3 start\n  show "medium"\nend\n` +
        `else start\n  show "small"\nend`
      ),
      { runFile, captureOutput }
    );
    if (error) return `unexpected error: ${error.message}`;
    if (output !== "medium\n") return `expected "medium", got ${JSON.stringify(output)}`;
  });

  check("foreach iterates an array", () => {
    const { output, error } = run(
      wrap(`foreach item in [1, 2, 3] start\n  show item\nend`),
      { runFile, captureOutput }
    );
    if (error) return `unexpected error: ${error.message}`;
    if (output !== "1\n2\n3\n") return `expected "1\\n2\\n3\\n", got ${JSON.stringify(output)}`;
  });

  check("object member assignment mutates nested structures", () => {
    const { output, error } = run(
      wrap(`let user = { address: { city: "A" } }\nlet user.address.city = "B"\nshow user.address.city`),
      { runFile, captureOutput }
    );
    if (error) return `unexpected error: ${error.message}`;
    if (output !== "B\n") return `expected "B", got ${JSON.stringify(output)}`;
  });

  // ── Optimizer ───────────────────────────────────────────────────────────

  check("constant folding reduces literal arithmetic at compile time", () => {
    const tokens = new Lexer(wrap(`show 2 + 3 * 4`)).tokenize();
    const ast = new Parser(tokens).parse();
    optimize(ast, { onWarning: () => {} });
    const showNode = ast.module.body.statements[0];
    if (showNode.argument.type !== "NumberLiteralNode" || showNode.argument.value !== 14) {
      return `expected folded literal 14, got ${JSON.stringify(showNode.argument)}`;
    }
  });

  check("dead code after return is detected and removed", () => {
    const tokens = new Lexer(
      wrap(`task f() start\n  return 1\n  show "unreachable"\nend\nshow f()`)
    ).tokenize();
    const ast = new Parser(tokens).parse();
    let warned = false;
    optimize(ast, { onWarning: (msg) => { if (msg.includes("unreachable")) warned = true; } });
    const taskNode = ast.module.body.statements[0];
    if (taskNode.body.statements.length !== 1) {
      return `expected dead code removed (1 statement left), got ${taskNode.body.statements.length}`;
    }
    if (!warned) return "expected an 'unreachable' warning";
  });

  check("unused variable produces a warning, not a removal", () => {
    const tokens = new Lexer(wrap(`let unused = 5\nshow "hi"`)).tokenize();
    const ast = new Parser(tokens).parse();
    let warned = false;
    optimize(ast, { onWarning: (msg) => { if (msg.includes(`"unused"`)) warned = true; } });
    if (ast.module.body.statements.length !== 2) return "unused variable declaration should not be removed";
    if (!warned) return "expected an unused-variable warning";
  });

  return results;
}
