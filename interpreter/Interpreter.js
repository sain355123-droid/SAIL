// compiler/interpreter/Interpreter.js
// SAIL Interpreter v1.0
//
// Tree-walking interpreter. Accepts a ProgramNode produced by the Parser
// and executes it by recursively visiting each node.
//
// Scoping:
//   Variables live in Environment objects (see runtime/Environment.js),
//   chained from any inner scope back to the global one. A new Environment
//   is only created when a task (function) is called — if/while/for/foreach
//   bodies keep sharing whatever scope they were already in. That preserves
//   the behaviour where `let count = count + 1` inside a while-loop body
//   updates the outer `count`, with no special-casing required. It's also
//   what makes closures work "for free": an anonymous task remembers the
//   Environment it was created in, and that Environment keeps living as
//   long as the task value does.
//
// Control flow:
//   break / continue / return are implemented as small "signal" objects
//   (see runtime/Signals.js) thrown from the statement that triggers them
//   and caught exactly where they belong — for/while/foreach loops catch
//   Break and Continue, task calls catch Return.
//
// Modules:
//   import/export are handled by delegating to a ModuleSystem instance
//   (see runtime/ModuleSystem.js), which resolves relative paths, caches
//   already-loaded modules, and detects circular imports. Each module gets
//   its own Interpreter instance with its own global Environment; only the
//   values explicitly marked `export` cross the boundary into whatever
//   imports it.
//
// Extending the interpreter:
//   Each node type is handled by a dedicated _execute* or _evaluate* method.
//   Adding a new statement: add a case to _executeStatement().
//   Adding a new expression type: add a case to _evaluate().

import { Environment }                              from "../runtime/Environment.js";
import { BreakSignal, ContinueSignal, ReturnSignal } from "../runtime/Signals.js";
import { Stdlib, sailTypeOf, isSailObject }          from "../stdlib/index.js";

// A generous but finite recursion ceiling. This exists purely to turn an
// unbounded recursive task into a clear, friendly error instead of a raw
// "Maximum call stack size exceeded" crash from the JS engine itself.
// Tuned comfortably below the point where Node's own native stack limit
// is reached by this interpreter's per-call frame depth (~850-900 in
// testing) so SAIL's friendly message always fires first.
const MAX_CALL_DEPTH = 500;

export class Interpreter {
  /**
   * @param {object} ast - ProgramNode returned by Parser.parse()
   * @param {object} [options]
   * @param {string|null} [options.filePath] - Absolute path of the source
   *   file this AST came from. Used to resolve relative imports. null for
   *   sources with no file of their own (e.g. the REPL).
   * @param {import("../runtime/ModuleSystem.js").ModuleSystem|null} [options.moduleSystem]
   *   Shared module loader/cache. If null, import/export statements will
   *   raise a friendly error explaining they aren't available here.
   * @param {Environment|null} [options.globalEnv] - Reuse an existing
   *   global environment instead of creating a fresh one. Used by the REPL
   *   so variables persist between entries.
   */
  constructor(ast, options = {}) {
    if (!ast || ast.type !== "ProgramNode") {
      throw new Error("Interpreter requires a ProgramNode.");
    }
    this._ast          = ast;
    this._global        = options.globalEnv || new Environment();
    this._filePath        = options.filePath || null;
    this._moduleSystem      = options.moduleSystem || null;
    this._exports              = new Map(); // name -> value, populated by `export`
    this._callDepth               = 0;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Execute the program. Returns when execution is complete.
   * Throws RuntimeError on any execution failure.
   */
  run() {
    this._executeProgram(this._ast, this._global);
  }

  /** Names and values this module made visible via `export`. */
  getExports() {
    const obj = {};
    for (const [name, value] of this._exports) {
      obj[name] = value;
    }
    return obj;
  }

  /** The global environment — exposed so the REPL can reuse it across turns. */
  getGlobalEnvironment() {
    return this._global;
  }

  // ── Runtime error helper ────────────────────────────────────────────────────

  /**
   * Throw a runtime error with the position of the offending AST node.
   * The message may contain a "\nTip: ..." line — the top-level error
   * handler renders that as friendly, beginner-facing guidance.
   * @param {string} message
   * @param {object} [node] - Any AST node with line and column fields
   */
  _runtimeError(message, node) {
    const pos = node ? ` at ${node.line}:${node.column}` : "";
    throw new Error(`RuntimeError: ${message}${pos}`);
  }

  // ── Node executors ──────────────────────────────────────────────────────────

  _executeProgram(node, env) {
    // ProgramNode has exactly one child: module
    this._executeModule(node.module, env);
  }

  _executeModule(node, env) {
    // ModuleNode: name (string) + body (BlockNode)
    this._executeBlock(node.body, env);
  }

  _executeBlock(node, env) {
    // BlockNode: statements (array of statement nodes)
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

      case "ConstNode":
        return this._executeConst(node, env);

      case "MemberAssignNode":
        return this._executeMemberAssign(node, env);

      case "IfNode":
        return this._executeIf(node, env);

      case "WhileNode":
        return this._executeWhile(node, env);

      case "ForRangeNode":
        return this._executeForRange(node, env);

      case "ForInNode":
        return this._executeForIn(node, env);

      case "TaskNode":
        return this._executeTaskDeclaration(node, env);

      case "ReturnNode":
        return this._executeReturn(node, env);

      case "BreakNode":
        throw new BreakSignal();

      case "ContinueNode":
        throw new ContinueSignal();

      case "ImportNode":
        return this._executeImport(node, env);

      case "ExportNode":
        return this._executeExport(node, env);

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
    env.assignOrDefine(node.name, value);
  }

  _executeConst(node, env) {
    if (env.has(node.name) && env.isConstant(node.name)) {
      this._runtimeError(
        `"${node.name}" is already declared as a constant and can't be declared again.`,
        node
      );
    }
    const value = this._evaluate(node.value, env);
    env.defineConst(node.name, value);
  }

  /**
   * Resolve every accessor but the last to find the container being
   * written into, mutate the last step, and return nothing. Shared logic
   * for `let arr[0] = x`, `let user.name = x`, and deeper chains like
   * `let grid[0][1] = x` or `let user.address.city = x`.
   */
  _executeMemberAssign(node, env) {
    if (!env.has(node.name)) {
      this._runtimeError(
        `Can't assign to "${node.name}" because it doesn't exist yet.\n` +
        `Tip: create it first, e.g. let ${node.name} = [1, 2, 3] or ` +
        `let ${node.name} = { }.`,
        node
      );
    }

    let target = env.get(node.name);
    for (let i = 0; i < node.accessors.length - 1; i++) {
      const acc = node.accessors[i];
      const key = acc.computed ? this._evaluate(acc.key, env) : acc.key;
      target = this._getMember(target, key, node);
    }

    const lastAcc = node.accessors[node.accessors.length - 1];
    const key   = lastAcc.computed ? this._evaluate(lastAcc.key, env) : lastAcc.key;
    const value = this._evaluate(node.value, env);

    if (Array.isArray(target)) {
      this._checkIndex(key, target, node, /* forWrite */ true);
      if (key === target.length) {
        target.push(value); // writing one past the end grows the array
      } else {
        target[key] = value;
      }
      return;
    }

    if (isSailObject(target)) {
      if (typeof key !== "string") {
        this._runtimeError(`Object keys must be text, but got ${sailTypeOf(key)}.`, node);
      }
      target[key] = value; // objects may freely gain new keys
      return;
    }

    this._runtimeError(
      `Can't assign into ${sailTypeOf(target)} using [ ] or "." — ` +
      `only arrays and objects support that.`,
      node
    );
  }

  _executeIf(node, env) {
    const condition = this._evaluate(node.condition, env);
    if (this._isTruthy(condition)) {
      this._executeBlock(node.thenBlock, env);
      return;
    }
    if (node.elseBlock === null) return;

    // "else if" is represented as a nested IfNode; a plain "else" is a
    // BlockNode. Both are valid here — dispatch on which one we have.
    if (node.elseBlock.type === "IfNode") {
      this._executeIf(node.elseBlock, env);
    } else {
      this._executeBlock(node.elseBlock, env);
    }
  }

  _executeWhile(node, env) {
    while (this._isTruthy(this._evaluate(node.condition, env))) {
      try {
        this._executeBlock(node.body, env);
      } catch (signal) {
        if (signal instanceof BreakSignal) break;
        if (signal instanceof ContinueSignal) continue;
        throw signal;
      }
    }
  }

  /**
   * for i in start to end [step s] ... end
   * The loop variable lives in the enclosing scope (same rule as while),
   * so it's still readable after the loop — handy for tracking "how far
   * did we get".
   */
  _executeForRange(node, env) {
    const start = this._evaluate(node.start, env);
    const end   = this._evaluate(node.end, env);
    const step  = node.step !== null ? this._evaluate(node.step, env) : 1;

    if (typeof start !== "number" || typeof end !== "number" || typeof step !== "number") {
      this._runtimeError(
        `A "for ... to" loop needs numbers for its start, end, and step values.\n` +
        `Tip: try for i in 0 to 10 start ... end`,
        node
      );
    }
    if (step === 0) {
      this._runtimeError(`A "for" loop's step can't be 0 — it would never finish.`, node);
    }

    for (
      let i = start;
      step > 0 ? i < end : i > end;
      i += step
    ) {
      env.assignOrDefine(node.varName, i);
      try {
        this._executeBlock(node.body, env);
      } catch (signal) {
        if (signal instanceof BreakSignal) break;
        if (signal instanceof ContinueSignal) continue;
        throw signal;
      }
    }
  }

  /**
   * for item in someArray ... end   /   foreach item in someArray ... end
   * Walks an array (or the characters of text). "foreach" parses to the
   * same AST node as this iterate form of "for" — they are the same
   * feature offered under two names.
   */
  _executeForIn(node, env) {
    const iterable = this._evaluate(node.iterable, env);

    if (Array.isArray(iterable) || typeof iterable === "string") {
      const items = typeof iterable === "string" ? Array.from(iterable) : iterable;
      for (const item of items) {
        env.assignOrDefine(node.varName, item);
        try {
          this._executeBlock(node.body, env);
        } catch (signal) {
          if (signal instanceof BreakSignal) break;
          if (signal instanceof ContinueSignal) continue;
          throw signal;
        }
      }
      return;
    }

    if (isSailObject(iterable)) {
      for (const key of Object.keys(iterable)) {
        env.assignOrDefine(node.varName, key);
        try {
          this._executeBlock(node.body, env);
        } catch (signal) {
          if (signal instanceof BreakSignal) break;
          if (signal instanceof ContinueSignal) continue;
          throw signal;
        }
      }
      return;
    }

    this._runtimeError(
      `"for/foreach ... in" needs an array, text, or object to loop over, ` +
      `but got ${sailTypeOf(iterable)}.\n` +
      `Tip: try foreach item in [1, 2, 3] start ... end, or use ` +
      `"for i in 0 to 10" to count instead.`,
      node
    );
  }

  /**
   * task name(params) ... end
   * Declaring a task just stores a callable value under its name in the
   * current scope — calling it is handled later, in _evaluateCall(), the
   * same way calling any other value would be.
   */
  _executeTaskDeclaration(node, env) {
    const taskValue = {
      __isTask: true,
      name:     node.name,
      params:   node.params, // [{ name, defaultValue }]
      body:     node.body,
      closure:  env, // remember the scope the task was defined in
    };
    env.define(node.name, taskValue);
  }

  _executeReturn(node, env) {
    const value = node.argument !== null ? this._evaluate(node.argument, env) : null;
    throw new ReturnSignal(value);
  }

  /**
   * import { a, b } from "./file"
   * import "./file" as ns
   */
  _executeImport(node, env) {
    if (!this._moduleSystem) {
      this._runtimeError(
        `"import" isn't available here — this code isn't running from a file.`,
        node
      );
    }

    let resolvedPath;
    let exportsObject;
    try {
      resolvedPath = this._moduleSystem.resolve(this._filePath, node.source);
      exportsObject = this._moduleSystem.load(resolvedPath);
    } catch (err) {
      // Errors from inside the imported module (or a module *it* imports)
      // already carry their own full, friendly message — re-throw as-is
      // instead of wrapping it again, so nested imports don't produce
      // "RuntimeError: RuntimeError: RuntimeError: ..." chains.
      throw new Error(
        `While loading "${node.source}" (line ${node.line}):\n${err.message}`
      );
    }

    if (node.namespaceAlias) {
      env.define(node.namespaceAlias, exportsObject);
      return;
    }

    for (const name of node.specifiers) {
      if (!Object.prototype.hasOwnProperty.call(exportsObject, name)) {
        const available = Object.keys(exportsObject);
        this._runtimeError(
          `"${node.source}" has no export named "${name}".\n` +
          `Tip: ${available.length
            ? `this module exports: ${available.join(", ")}.`
            : `this module doesn't export anything yet — add "export" in front of a let, const, or task.`}`,
          node
        );
      }
      env.define(name, exportsObject[name]);
    }
  }

  /**
   * export let/const/task ...
   * Executes the wrapped declaration normally, then records its name so
   * getExports() can hand it to whatever imports this module.
   */
  _executeExport(node, env) {
    const decl = node.declaration;
    this._executeStatement(decl, env);

    const name = decl.name; // LetNode, ConstNode, and TaskNode all carry `.name`
    this._exports.set(name, env.get(name));
  }

  // ── Expression evaluators ───────────────────────────────────────────────────

  /**
   * Evaluate an expression node to a JavaScript value.
   * Extension point: add new expression types here.
   *
   * @param {object} node - Any expression AST node
   * @param {Environment} env - The scope to evaluate identifiers against
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

      case "NullLiteralNode":
        return null;

      case "ArrayLiteralNode":
        return node.elements.map((el) => this._evaluate(el, env));

      case "ObjectLiteralNode":
        return this._evaluateObjectLiteral(node, env);

      case "AnonymousTaskNode":
        return this._evaluateAnonymousTask(node, env);

      case "IdentifierNode":
        return this._evaluateIdentifier(node, env);

      case "BinaryExpressionNode":
        return this._evaluateBinaryExpression(node, env);

      case "LogicalExpressionNode":
        return this._evaluateLogicalExpression(node, env);

      case "UnaryExpressionNode":
        return this._evaluateUnaryExpression(node, env);

      case "MemberExpressionNode":
        return this._evaluateMember(node, env);

      case "CallNode":
        return this._evaluateCall(node, env);

      default:
        this._runtimeError(`Cannot evaluate node type "${node.type}"`, node);
    }
  }

  _evaluateObjectLiteral(node, env) {
    const obj = {};
    for (const entry of node.entries) {
      obj[entry.key] = this._evaluate(entry.value, env);
    }
    return obj;
  }

  _evaluateAnonymousTask(node, env) {
    return {
      __isTask: true,
      name:     "<anonymous>",
      params:   node.params,
      body:     node.body,
      closure:  env,
    };
  }

  _evaluateIdentifier(node, env) {
    if (!env.has(node.name)) {
      this._runtimeError(
        `Undefined variable "${node.name}".\n` +
        `Tip: declare it first with "let ${node.name} = ..." — ` +
        `also check for typos if you expected it to already exist.`,
        node
      );
    }
    return env.get(node.name);
  }

  /** Throw a friendly error unless `value` is a number. Used by arithmetic ops that don't make sense on other types. */
  _requireNumber(value, opSymbol, node) {
    if (typeof value !== "number") {
      this._runtimeError(
        `"${opSymbol}" needs numbers on both sides, but got ${sailTypeOf(value)}.\n` +
        `Tip: use number(x) to convert text to a number first, if that's what you meant.`,
        node
      );
    }
  }

  _evaluateBinaryExpression(node, env) {
    const left  = this._evaluate(node.left, env);
    const right = this._evaluate(node.right, env);

    switch (node.operator) {
      case "+": {
        // String concatenation if either operand is a string
        if (typeof left === "string" || typeof right === "string") {
          return this._stringify(left) + this._stringify(right);
        }
        this._requireNumber(left, "+", node);
        this._requireNumber(right, "+", node);
        return left + right;
      }
      case "-":
        this._requireNumber(left, "-", node);
        this._requireNumber(right, "-", node);
        return left - right;
      case "*":
        this._requireNumber(left, "*", node);
        this._requireNumber(right, "*", node);
        return left * right;
      case "/":
        this._requireNumber(left, "/", node);
        this._requireNumber(right, "/", node);
        if (right === 0) {
          this._runtimeError(
            `Division by zero.\n` +
            `Tip: check that the value on the right of "/" can never be 0 ` +
            `before dividing — e.g. "if divisor != 0 start ... end".`,
            node
          );
        }
        return left / right;
      case "%":
        this._requireNumber(left, "%", node);
        this._requireNumber(right, "%", node);
        if (right === 0) {
          this._runtimeError(`Can't use "%" with 0 on the right — that's division by zero.`, node);
        }
        return left % right;
      case "==": return this._valuesEqual(left, right);
      case "!=": return !this._valuesEqual(left, right);
      case ">":
        this._requireNumber(left, ">", node);
        this._requireNumber(right, ">", node);
        return left > right;
      case "<":
        this._requireNumber(left, "<", node);
        this._requireNumber(right, "<", node);
        return left < right;
      case ">=":
        this._requireNumber(left, ">=", node);
        this._requireNumber(right, ">=", node);
        return left >= right;
      case "<=":
        this._requireNumber(left, "<=", node);
        this._requireNumber(right, "<=", node);
        return left <= right;
      default:
        this._runtimeError(`Unknown operator "${node.operator}"`, node);
    }
  }

  /** and / or — short-circuiting, like every other version of these ever made. */
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
        this._requireNumber(operand, "-", node);
        return -operand;
      case "not": return !this._isTruthy(operand);
      default:
        this._runtimeError(`Unknown unary operator "${node.operator}"`, node);
    }
  }

  /** object.property or object[expr] — shared by array indexing, text indexing, and object property access. */
  _evaluateMember(node, env) {
    const object = this._evaluate(node.object, env);
    const key = node.computed ? this._evaluate(node.property, env) : node.property;
    return this._getMember(object, key, node);
  }

  /**
   * Core "read a member" logic, shared by expression evaluation
   * (_evaluateMember) and the read-then-write walk in _executeMemberAssign.
   */
  _getMember(object, key, node) {
    if (Array.isArray(object) || typeof object === "string") {
      this._checkIndex(key, object, node, /* forWrite */ false);
      return object[key];
    }

    if (isSailObject(object)) {
      if (typeof key !== "string") {
        this._runtimeError(`Object keys must be text, but got ${sailTypeOf(key)}.`, node);
      }
      if (!Object.prototype.hasOwnProperty.call(object, key)) {
        const available = Object.keys(object);
        this._runtimeError(
          `"${key}" doesn't exist on this object.\n` +
          `Tip: available keys are: ${available.length ? available.join(", ") : "(none — this object is empty)"}.`,
          node
        );
      }
      return object[key];
    }

    this._runtimeError(
      `Can't use [ ] or "." on ${sailTypeOf(object)} — that only works on ` +
      `arrays, text, and objects.`,
      node
    );
  }

  _checkIndex(index, collection, node, forWrite = false) {
    if (typeof index !== "number" || !Number.isInteger(index)) {
      this._runtimeError(
        `An index must be a whole number, but got ${sailTypeOf(index)}.`,
        node
      );
    }
    const maxValid = forWrite ? collection.length : collection.length - 1;
    if (index < 0 || index > maxValid) {
      this._runtimeError(
        `Index ${index} is out of bounds — this ${Array.isArray(collection) ? "array" : "text"} has ` +
        `${collection.length} item(s), so valid indexes are 0 to ${Math.max(collection.length - 1, 0)}.\n` +
        `Tip: use length(x) to check the size before indexing.`,
        node
      );
    }
  }

  /**
   * A call target can be:
   *   - a plain identifier naming a user-defined task, or (falling back)
   *     a standard-library function — e.g. greet(), length(arr)
   *   - a member expression whose value is a task — e.g. utils.greet()
   *   - any other expression that evaluates to a task — e.g. an
   *     immediately-invoked anonymous task, or calling the result of a
   *     call that returns a task (closures / currying)
   * Looking up user tasks before falling back to the standard library
   * means a program can freely define `task type(x) ... end` and it just
   * works, no reserved words to trip over.
   */
  _evaluateCall(node, env) {
    const args = node.args.map((arg) => this._evaluate(arg, env));

    if (node.callee.type === "IdentifierNode") {
      const name = node.callee.name;

      if (env.has(name)) {
        const value = env.get(name);
        if (value && value.__isTask) {
          return this._callTask(value, args, node);
        }
        this._runtimeError(
          `"${name}" is ${sailTypeOf(value)}, not a task — it can't be called with ( ).`,
          node
        );
      }

      if (Object.prototype.hasOwnProperty.call(Stdlib, name)) {
        return Stdlib[name](args, this);
      }

      this._runtimeError(
        `Unknown function "${name}".\n` +
        `Tip: check the spelling, or define it yourself with ` +
        `"task ${name}(...) start ... end" before calling it.`,
        node
      );
    }

    // Any other callee expression (member access, another call, a
    // parenthesised anonymous task, ...) is evaluated directly and must
    // produce a task value.
    const callee = this._evaluate(node.callee, env);
    if (callee && callee.__isTask) {
      return this._callTask(callee, args, node);
    }
    this._runtimeError(
      `This value is ${sailTypeOf(callee)}, not a task — it can't be called with ( ).`,
      node
    );
  }

  /**
   * Call a task value with the given already-evaluated arguments.
   * `callNode` may be null when the call originates from the standard
   * library (e.g. sort()'s comparator) rather than from source code — in
   * that case positional error info is simply omitted.
   */
  _callTask(taskValue, args, callNode) {
    if (args.length > taskValue.params.length) {
      this._runtimeError(
        `"${taskValue.name}" expects at most ${taskValue.params.length} argument(s), ` +
        `but got ${args.length}.\n` +
        `Tip: it's defined as task ${taskValue.name}(${taskValue.params.map((p) => p.name).join(", ")}).`,
        callNode
      );
    }

    this._callDepth++;
    if (this._callDepth > MAX_CALL_DEPTH) {
      this._callDepth--;
      this._runtimeError(
        `"${taskValue.name}" has called itself more than ${MAX_CALL_DEPTH} times in a row — ` +
        `this looks like unbounded recursion.\n` +
        `Tip: make sure the task has a base case that stops it — an "if" that ` +
        `returns without calling ${taskValue.name} again.`,
        callNode
      );
    }

    try {
      const callEnv = new Environment(taskValue.closure);
      taskValue.params.forEach((param, i) => {
        let value;
        if (i < args.length) {
          value = args[i];
        } else if (param.defaultValue !== null) {
          // Defaults are evaluated in callEnv, so later defaults may refer
          // to earlier parameters — e.g. task box(w, h = w).
          value = this._evaluate(param.defaultValue, callEnv);
        } else {
          value = null; // optional parameter with no default and no argument: "nothing"
        }
        callEnv.define(param.name, value);
      });

      try {
        this._executeBlock(taskValue.body, callEnv);
      } catch (signal) {
        if (signal instanceof ReturnSignal) return signal.value;
        throw signal;
      }
      return null; // a task that never hit "return" gives back "nothing"
    } finally {
      this._callDepth--;
    }
  }

  /**
   * Decide whether a runtime value should be treated as "true" in a
   * condition (if / while / for / and / or / not). Booleans are used
   * as-is; other types fall back to normal JS truthiness (0, "", NaN,
   * and null are falsy — everything else, including empty arrays and
   * empty objects, is truthy).
   */
  _isTruthy(value) {
    if (typeof value === "boolean") return value;
    return Boolean(value);
  }

  /** Structural equality for arrays and objects; identity/value equality otherwise. */
  _valuesEqual(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((el, i) => this._valuesEqual(el, b[i]));
    }
    if (isSailObject(a) && isSailObject(b)) {
      const aKeys = Object.keys(a), bKeys = Object.keys(b);
      if (aKeys.length !== bKeys.length) return false;
      return aKeys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && this._valuesEqual(a[k], b[k]));
    }
    return a === b;
  }

  /**
   * Render any SAIL value as text — used by `show`, string concatenation
   * with "+", and the text() builtin, so a value always looks the same
   * wherever it's printed.
   */
  _stringify(value) {
    if (value === null || value === undefined) return "nothing";
    if (typeof value === "string") return value;
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return String(value);
    if (value && value.__isTask) return `task ${value.name}`;
    if (Array.isArray(value)) {
      const inner = value.map((el) => this._stringifyForContainer(el)).join(", ");
      return `[${inner}]`;
    }
    if (isSailObject(value)) {
      const inner = Object.keys(value)
        .map((k) => `${k}: ${this._stringifyForContainer(value[k])}`)
        .join(", ");
      return `{ ${inner} }`;
    }
    return String(value);
  }

  /** Like _stringify, but quotes text so array/object contents are unambiguous. */
  _stringifyForContainer(value) {
    if (typeof value === "string") return `"${value}"`;
    return this._stringify(value);
  }
}
