// compiler/interpreter/Interpreter.js
// SAIL Interpreter v0.5
//
// Tree-walking interpreter. Accepts a ProgramNode produced by the Parser
// and executes it by recursively visiting each node.
//
// Scoping model:
//   Environment is a small chained scope object (Map + parent pointer).
//   - The Interpreter owns one global Environment, holding module-level
//     variables, task ("function") definitions, and the standard library.
//   - `let` searches the current scope chain for an existing binding and
//     mutates it if found (so "let count = count + 1" inside a while loop
//     updates the outer counter, exactly as in v0.2); otherwise it defines
//     a new binding in the *current* scope.
//   - `for` loops get one fresh child scope for their loop variable, shared
//     across all iterations, discarded when the loop ends.
//   - Calling a task creates a new scope whose parent is the *global* scope
//     (not the caller's scope) — tasks close over globals/other tasks, not
//     over whichever local variables happened to be in scope at the call
//     site. This keeps recursion and mutual task calls well defined.
//
// Non-local control flow (break / continue / return):
//   Modelled as internal signal classes thrown as JS exceptions and caught
//   by the nearest construct that understands them (loops catch
//   Break/Continue; task calls catch Return). If one escapes all the way to
//   the top of the program, that's a SAIL-level error ("break outside of a
//   loop", etc.) — this can only happen since break/continue/return are not
//   restricted by the parser, so the interpreter is the enforcement point.
//
// Extending the interpreter:
//   Each node type is handled by a dedicated _execute* or _evaluate* method.
//   Adding a new statement: add a case to _executeStatement().
//   Adding a new expression type: add a case to _evaluate().
//   The dispatch in _executeStatement() and _evaluate() never needs to change
//   structure — just add a new case.

import { SailError, suggest } from "../errors/SailError.js";
import { createStandardLibrary } from "./stdlib.js";

const MAX_CALL_DEPTH = 1000;

// ── Non-local control-flow signals ───────────────────────────────────────────

class BreakSignal {}
class ContinueSignal {}
class ReturnSignal {
  constructor(value) { this.value = value; }
}

// ── Environment (lexical scope chain) ────────────────────────────────────────

class Environment {
  constructor(parent = null) {
    this._vars = new Map();
    this._parent = parent;
  }

  has(name) {
    if (this._vars.has(name)) return true;
    return this._parent ? this._parent.has(name) : false;
  }

  get(name) {
    if (this._vars.has(name)) return this._vars.get(name);
    if (this._parent) return this._parent.get(name);
    return undefined; // caller is responsible for checking has() first
  }

  /** Force a binding in *this* scope (used for params, loop vars, tasks). */
  define(name, value) {
    this._vars.set(name, value);
  }

  /**
   * "let" semantics: mutate the nearest existing binding in the chain, or
   * define a new one locally if the name isn't bound anywhere yet.
   */
  assign(name, value) {
    let env = this;
    while (env) {
      if (env._vars.has(name)) {
        env._vars.set(name, value);
        return;
      }
      env = env._parent;
    }
    this._vars.set(name, value);
  }

  /** All names visible from this scope (own + inherited) — for suggestions. */
  allNames() {
    const names = new Set();
    let env = this;
    while (env) {
      for (const key of env._vars.keys()) names.add(key);
      env = env._parent;
    }
    return [...names];
  }
}

export class Interpreter {
  /**
   * @param {object} ast - ProgramNode returned by Parser.parse()
   */
  constructor(ast) {
    if (!ast || ast.type !== "ProgramNode") {
      throw new Error("Interpreter requires a ProgramNode.");
    }
    this._ast = ast;
    this._globalEnv = new Environment(null);
    this._callDepth = 0;

    // Standard library — see stdlib.js. Seeded directly into the global
    // scope so calling them ("length(x)") goes through the exact same
    // CallExpressionNode / identifier-lookup path as calling a user task.
    for (const [name, builtin] of Object.entries(createStandardLibrary(this))) {
      this._globalEnv.define(name, builtin);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Execute the program. Returns when execution is complete.
   * Throws a SailError on any execution failure.
   */
  run() {
    try {
      this._executeProgram(this._ast, this._globalEnv);
    } catch (err) {
      if (err instanceof BreakSignal) {
        this._runtimeError("'break' used outside of a loop", this._ast, {
          hint: `"break" only makes sense inside a "for" or "while" loop.`,
        });
      }
      if (err instanceof ContinueSignal) {
        this._runtimeError("'continue' used outside of a loop", this._ast, {
          hint: `"continue" only makes sense inside a "for" or "while" loop.`,
        });
      }
      if (err instanceof ReturnSignal) {
        this._runtimeError("'return' used outside of a task", this._ast, {
          hint: `"return" only makes sense inside a "task" definition.`,
        });
      }
      throw err;
    }
  }

  // ── Runtime error helper ────────────────────────────────────────────────────

  /**
   * Throw a runtime error with the position of the offending AST node, and
   * (optionally) a "did you mean...?" suggestion or a plain-language hint.
   * @param {string} message
   * @param {object} node - Any AST node with line and column fields
   * @param {{suggestion?: string, hint?: string}} [extra]
   */
  _runtimeError(message, node, extra = {}) {
    throw new SailError("Runtime", message, {
      line: node ? node.line : undefined,
      column: node ? node.column : undefined,
      suggestion: extra.suggestion,
      hint: extra.hint,
    });
  }

  // ── Node executors ──────────────────────────────────────────────────────────

  _executeProgram(node, env) {
    this._executeModule(node.module, env);
  }

  _executeModule(node, env) {
    this._executeBlock(node.body, env);
  }

  _executeBlock(node, env) {
    for (const statement of node.statements) {
      this._executeStatement(statement, env);
    }
  }

  /**
   * Dispatch a statement node to the correct executor.
   * Extension point: add new statement types here.
   */
  _executeStatement(node, env) {
    switch (node.type) {
      case "ShowNode":
        return this._executeShow(node, env);

      case "LetNode":
        return this._executeLet(node, env);

      case "IndexAssignNode":
        return this._executeIndexAssign(node, env);

      case "IfNode":
        return this._executeIf(node, env);

      case "WhileNode":
        return this._executeWhile(node, env);

      case "ForRangeNode":
        return this._executeForRange(node, env);

      case "ForInNode":
        return this._executeForIn(node, env);

      case "BreakNode":
        throw new BreakSignal();

      case "ContinueNode":
        throw new ContinueSignal();

      case "TaskNode":
        return this._executeTaskDeclaration(node, env);

      case "ReturnNode":
        throw new ReturnSignal(node.value ? this._evaluate(node.value, env) : null);

      case "ExpressionStatementNode":
        this._evaluate(node.expression, env);
        return;

      default:
        this._runtimeError(`Unknown statement type "${node.type}"`, node);
    }
  }

  _executeShow(node, env) {
    const value = this._evaluate(node.argument, env);
    console.log(this._stringify(value));
  }

  _executeLet(node, env) {
    const value = this._evaluate(node.value, env);
    env.assign(node.name, value);
  }

  _executeIndexAssign(node, env) {
    const arr = this._evaluate(node.object, env);
    if (!Array.isArray(arr)) {
      this._runtimeError(
        `Cannot index into ${this._typeName(arr)} — only arrays support "[index] = value"`,
        node
      );
    }
    const index = this._evaluate(node.index, env);
    if (typeof index !== "number" || !Number.isInteger(index)) {
      this._runtimeError(`Array index must be a whole number, got ${this._stringify(index)}`, node);
    }
    const value = this._evaluate(node.value, env);

    if (index >= 0 && index < arr.length) {
      arr[index] = value;
    } else if (index === arr.length) {
      arr.push(value); // convenient append: arr[length] = x
    } else {
      this._runtimeError(
        `Index ${index} is out of bounds for an array of length ${arr.length}`,
        node,
        { hint: `Valid indices are 0 to ${Math.max(arr.length - 1, 0)}${arr.length === 0 ? " (the array is empty)" : ""}, or ${arr.length} to append.` }
      );
    }
  }

  _executeIf(node, env) {
    const condition = this._evaluate(node.condition, env);
    if (this._isTruthy(condition)) {
      this._executeBlock(node.thenBlock, env);
    } else if (node.elseBlock !== null) {
      this._executeBlock(node.elseBlock, env);
    }
  }

  _executeWhile(node, env) {
    while (this._isTruthy(this._evaluate(node.condition, env))) {
      try {
        this._executeBlock(node.body, env);
      } catch (err) {
        if (err instanceof BreakSignal) break;
        if (err instanceof ContinueSignal) continue;
        throw err;
      }
    }
  }

  _executeForRange(node, env) {
    const from = this._evaluate(node.from, env);
    const to = this._evaluate(node.to, env);
    if (typeof from !== "number" || typeof to !== "number") {
      this._runtimeError(
        `A "for ... in a..b" range needs two numbers, got ${this._typeName(from)}..${this._typeName(to)}`,
        node
      );
    }

    const loopEnv = new Environment(env);
    for (let i = from; i < to; i++) {
      loopEnv.define(node.varName, i);
      try {
        this._executeBlock(node.body, loopEnv);
      } catch (err) {
        if (err instanceof BreakSignal) break;
        if (err instanceof ContinueSignal) continue;
        throw err;
      }
    }
  }

  _executeForIn(node, env) {
    const iterable = this._evaluate(node.iterable, env);
    if (!Array.isArray(iterable)) {
      this._runtimeError(
        `"for ${node.varName} in ..." needs an array to iterate over, got ${this._typeName(iterable)}`,
        node,
        { hint: `Did you mean a range instead, like "for ${node.varName} in 0..${this._stringify(iterable)}"?` }
      );
    }

    const loopEnv = new Environment(env);
    for (const item of iterable) {
      loopEnv.define(node.varName, item);
      try {
        this._executeBlock(node.body, loopEnv);
      } catch (err) {
        if (err instanceof BreakSignal) break;
        if (err instanceof ContinueSignal) continue;
        throw err;
      }
    }
  }

  _executeTaskDeclaration(node, env) {
    const task = {
      __sailTask: true,
      name: node.name,
      params: node.params,
      body: node.body,
      closureEnv: this._globalEnv, // tasks close over globals, not call-site locals
    };
    env.define(node.name, task);
  }

  // ── Calling tasks & builtins ─────────────────────────────────────────────────

  _callTask(task, args, node) {
    if (args.length !== task.params.length) {
      this._runtimeError(
        `Task "${task.name}" expects ${task.params.length} argument${task.params.length === 1 ? "" : "s"} ` +
        `but got ${args.length}`,
        node,
        { hint: `${task.name}(${task.params.join(", ")})` }
      );
    }

    if (this._callDepth >= MAX_CALL_DEPTH) {
      this._runtimeError(
        `Maximum call depth (${MAX_CALL_DEPTH}) exceeded while calling "${task.name}" — likely infinite recursion`,
        node
      );
    }

    const callEnv = new Environment(task.closureEnv);
    task.params.forEach((paramName, i) => callEnv.define(paramName, args[i]));

    this._callDepth++;
    try {
      this._executeBlock(task.body, callEnv);
      return null; // no explicit return statement reached
    } catch (err) {
      if (err instanceof ReturnSignal) return err.value;
      throw err;
    } finally {
      this._callDepth--;
    }
  }

  // ── Expression evaluators ───────────────────────────────────────────────────

  /**
   * Evaluate an expression node to a JavaScript value.
   * Extension point: add new expression types here.
   *
   * @param {object} node - Any expression AST node
   * @param {Environment} env
   * @returns {*} The evaluated value
   */
  _evaluate(node, env) {
    switch (node.type) {
      case "StringLiteralNode":
        return node.value;

      case "NumberLiteralNode":
        return node.value;

      case "BooleanLiteralNode":
        return node.value;

      case "IdentifierNode":
        return this._evaluateIdentifier(node, env);

      case "BinaryExpressionNode":
        return this._evaluateBinaryExpression(node, env);

      case "LogicalExpressionNode":
        return this._evaluateLogicalExpression(node, env);

      case "UnaryExpressionNode":
        return this._evaluateUnaryExpression(node, env);

      case "ArrayLiteralNode":
        return node.elements.map((el) => this._evaluate(el, env));

      case "IndexExpressionNode":
        return this._evaluateIndexExpression(node, env);

      case "CallExpressionNode":
        return this._evaluateCallExpression(node, env);

      default:
        this._runtimeError(`Cannot evaluate node type "${node.type}"`, node);
    }
  }

  _evaluateIdentifier(node, env) {
    if (!env.has(node.name)) {
      this._runtimeError(`Undefined variable "${node.name}"`, node, {
        suggestion: suggest(node.name, env.allNames()),
      });
    }
    return env.get(node.name);
  }

  _evaluateBinaryExpression(node, env) {
    const left  = this._evaluate(node.left, env);
    const right = this._evaluate(node.right, env);

    switch (node.operator) {
      case "+": {
        if (Array.isArray(left) && Array.isArray(right)) {
          return [...left, ...right]; // array concatenation
        }
        // String concatenation if either operand is a string
        if (typeof left === "string" || typeof right === "string") {
          return this._stringify(left) + this._stringify(right);
        }
        if (typeof left === "number" && typeof right === "number") {
          return left + right;
        }
        this._runtimeError(
          `Cannot use "+" between ${this._typeName(left)} and ${this._typeName(right)}`,
          node
        );
        return;
      }
      case "-":
      case "*":
      case "/": {
        if (typeof left !== "number" || typeof right !== "number") {
          this._runtimeError(
            `Cannot use "${node.operator}" between ${this._typeName(left)} and ${this._typeName(right)} — both sides must be numbers`,
            node
          );
        }
        if (node.operator === "-") return left - right;
        if (node.operator === "*") return left * right;
        if (right === 0) this._runtimeError("Division by zero", node);
        return left / right;
      }
      case "==": return this._valuesEqual(left, right);
      case "!=": return !this._valuesEqual(left, right);
      case ">": case "<": case ">=": case "<=": {
        if (typeof left !== "number" || typeof right !== "number") {
          this._runtimeError(
            `Cannot compare ${this._typeName(left)} and ${this._typeName(right)} with "${node.operator}" — comparisons need two numbers`,
            node
          );
        }
        if (node.operator === ">")  return left > right;
        if (node.operator === "<")  return left < right;
        if (node.operator === ">=") return left >= right;
        return left <= right;
      }
      default:
        this._runtimeError(`Unknown operator "${node.operator}"`, node);
    }
  }

  _evaluateLogicalExpression(node, env) {
    const left = this._evaluate(node.left, env);
    if (node.operator === "or") {
      if (this._isTruthy(left)) return left;
      return this._evaluate(node.right, env);
    }
    // "and"
    if (!this._isTruthy(left)) return left;
    return this._evaluate(node.right, env);
  }

  _evaluateUnaryExpression(node, env) {
    const operand = this._evaluate(node.operand, env);
    switch (node.operator) {
      case "-":
        if (typeof operand !== "number") {
          this._runtimeError(`Cannot negate ${this._typeName(operand)} — "-" needs a number`, node);
        }
        return -operand;
      case "not":
        return !this._isTruthy(operand);
      default:
        this._runtimeError(`Unknown unary operator "${node.operator}"`, node);
    }
  }

  _evaluateIndexExpression(node, env) {
    const object = this._evaluate(node.object, env);
    if (!Array.isArray(object)) {
      if (typeof object === "string") {
        const index = this._evaluate(node.index, env);
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= object.length) {
          this._runtimeError(
            `Index ${this._stringify(index)} is out of bounds for a string of length ${object.length}`,
            node
          );
        }
        return object[index];
      }
      this._runtimeError(`Cannot index into ${this._typeName(object)} — only arrays and strings support "[index]"`, node);
    }
    const index = this._evaluate(node.index, env);
    if (typeof index !== "number" || !Number.isInteger(index)) {
      this._runtimeError(`Array index must be a whole number, got ${this._stringify(index)}`, node);
    }
    if (index < 0 || index >= object.length) {
      this._runtimeError(
        `Index ${index} is out of bounds for an array of length ${object.length}`,
        node,
        { hint: object.length === 0 ? "The array is empty." : `Valid indices are 0 to ${object.length - 1}.` }
      );
    }
    return object[index];
  }

  _evaluateCallExpression(node, env) {
    const callee = this._evaluate(node.callee, env);
    const args = node.args.map((arg) => this._evaluate(arg, env));

    if (callee && callee.__sailBuiltin) {
      return callee.fn(args, node);
    }
    if (callee && callee.__sailTask) {
      return this._callTask(callee, args, node);
    }

    const name = node.callee.type === "IdentifierNode" ? node.callee.name : null;
    this._runtimeError(
      name ? `"${name}" is not a task — it can't be called with (...)` : `This value is not a task and can't be called with (...)`,
      node,
      { hint: name ? `Check that "${name}" was declared with "task ${name}(...) start ... end".` : undefined }
    );
  }

  // ── Value helpers ────────────────────────────────────────────────────────────

  /**
   * Decide whether a runtime value should be treated as "true" in a
   * condition (if / while / and / or / not). Booleans are used as-is;
   * other types fall back to normal JS truthiness (0, "", NaN, empty array
   * are falsy — everything else is truthy).
   */
  _isTruthy(value) {
    if (typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value);
  }

  _valuesEqual(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((item, i) => this._valuesEqual(item, b[i]));
    }
    return a === b;
  }

  /** Human-readable type name, used throughout error messages. */
  _typeName(value) {
    if (value === null || value === undefined) return "nothing";
    if (Array.isArray(value)) return "an array";
    if (value && (value.__sailTask || value.__sailBuiltin)) return "a task";
    if (typeof value === "string") return "a string";
    if (typeof value === "number") return "a number";
    if (typeof value === "boolean") return "a boolean";
    return typeof value;
  }

  /**
   * Render a runtime value as text — used by `show`, the `text()` builtin,
   * and string concatenation. Nested strings inside arrays are quoted so
   * "[1, 2]" and "[\"1\", \"2\"]" stay visually distinguishable.
   */
  _stringify(value, insideArray = false) {
    if (value === null || value === undefined) return "nothing";
    if (typeof value === "string") return insideArray ? `"${value}"` : value;
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return String(value);
    if (Array.isArray(value)) {
      return "[" + value.map((v) => this._stringify(v, true)).join(", ") + "]";
    }
    if (value.__sailTask) return `<task ${value.name}>`;
    if (value.__sailBuiltin) return `<builtin ${value.name}>`;
    return String(value);
  }
}
