// compiler/interpreter/Interpreter.js
// SAIL Interpreter v0.0.2
//
// Tree-walking interpreter. Accepts a ProgramNode produced by the Parser
// and executes it by recursively visiting each node.
//
// Symbol table:
//   A Map stored on the Interpreter instance. Currently read-only from the
//   outside — populated in future milestones when variable assignment is added.
//   IdentifierNode evaluation already looks names up here so that milestone
//   requires only the assignment side, not a redesign of this file.
//
// Extending the interpreter:
//   Each node type is handled by a dedicated _execute* or _evaluate* method.
//   Adding a new statement: add a case to _executeStatement().
//   Adding a new expression type: add a case to _evaluate().
//   The dispatch in _executeStatement() and _evaluate() never needs to change
//   structure — just add a new case.
//
// Control flow (IfNode / WhileNode):
//   Both carry ordinary BlockNode bodies, produced by the same _parseBlock()
//   the rest of the language uses, so their bodies are executed with the
//   existing _executeBlock() — no separate scoping mechanism required.
//   Truthiness follows normal JS rules (via _isTruthy) so booleans, numbers,
//   and strings can all be used directly as conditions.

export class Interpreter {
  /**
   * @param {object} ast - ProgramNode returned by Parser.parse()
   */
  constructor(ast) {
    if (!ast || ast.type !== "ProgramNode") {
      throw new Error("Interpreter requires a ProgramNode.");
    }
    this._ast     = ast;
    this._symbols = new Map(); // symbol table — name → value
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Execute the program. Returns when execution is complete.
   * Throws RuntimeError on any execution failure.
   */
  run() {
    this._executeProgram(this._ast);
  }

  // ── Runtime error helper ────────────────────────────────────────────────────

  /**
   * Throw a runtime error with the position of the offending AST node.
   * @param {string} message
   * @param {object} node - Any AST node with line and column fields
   */
  _runtimeError(message, node) {
    const pos = node ? ` at ${node.line}:${node.column}` : "";
    throw new Error(`RuntimeError: ${message}${pos}`);
  }

  // ── Node executors ──────────────────────────────────────────────────────────

  _executeProgram(node) {
    // ProgramNode has exactly one child: module
    this._executeModule(node.module);
  }

  _executeModule(node) {
    // ModuleNode: name (string) + body (BlockNode)
    this._executeBlock(node.body);
  }

  _executeBlock(node) {
    // BlockNode: statements (array of statement nodes)
    for (const statement of node.statements) {
      this._executeStatement(statement);
    }
  }

  /**
   * Dispatch a statement node to the correct executor.
   * Extension point: add new statement types here.
   */
  _executeStatement(node) {
    switch (node.type) {
      case "ShowNode":
        return this._executeShow(node);

      case "LetNode":
        return this._executeLet(node);

      case "IfNode":
        return this._executeIf(node);

      case "WhileNode":
        return this._executeWhile(node);

      default:
        this._runtimeError(`Unknown statement type "${node.type}"`, node);
    }
  }

  _executeShow(node) {
    const value = this._evaluate(node.argument);
    console.log(value);
  }

  _executeLet(node) {
    const value = this._evaluate(node.value);
    this._symbols.set(node.name, value);
  }

  _executeIf(node) {
    const condition = this._evaluate(node.condition);
    if (this._isTruthy(condition)) {
      this._executeBlock(node.thenBlock);
    } else if (node.elseBlock !== null) {
      this._executeBlock(node.elseBlock);
    }
  }

  _executeWhile(node) {
    while (this._isTruthy(this._evaluate(node.condition))) {
      this._executeBlock(node.body);
    }
  }

  // ── Expression evaluators ───────────────────────────────────────────────────

  /**
   * Evaluate an expression node to a JavaScript value.
   * Extension point: add new expression types here.
   *
   * @param {object} node - Any expression AST node
   * @returns {*} The evaluated value
   */
  _evaluate(node) {
    switch (node.type) {
      case "StringLiteralNode":
        return this._evaluateStringLiteral(node);

      case "NumberLiteralNode":
        return node.value;

      case "BooleanLiteralNode":
        return node.value;

      case "IdentifierNode":
        return this._evaluateIdentifier(node);

      case "BinaryExpressionNode":
        return this._evaluateBinaryExpression(node);

      case "UnaryExpressionNode":
        return this._evaluateUnaryExpression(node);

      default:
        this._runtimeError(`Cannot evaluate node type "${node.type}"`, node);
    }
  }

  _evaluateStringLiteral(node) {
    return node.value;
  }

  _evaluateIdentifier(node) {
    if (!this._symbols.has(node.name)) {
      this._runtimeError(`Undefined variable "${node.name}"`, node);
    }
    return this._symbols.get(node.name);
  }

  _evaluateBinaryExpression(node) {
    const left  = this._evaluate(node.left);
    const right = this._evaluate(node.right);

    switch (node.operator) {
      case "+": {
        // String concatenation if either operand is a string
        if (typeof left === "string" || typeof right === "string") {
          return String(left) + String(right);
        }
        return left + right;
      }
      case "-": return left - right;
      case "*": return left * right;
      case "/":
        if (right === 0) this._runtimeError("Division by zero", node);
        return left / right;
      case "==": return left === right;
      case "!=": return left !== right;
      case ">":  return left > right;
      case "<":  return left < right;
      case ">=": return left >= right;
      case "<=": return left <= right;
      default:
        this._runtimeError(`Unknown operator "${node.operator}"`, node);
    }
  }

  /**
   * Decide whether a runtime value should be treated as "true" in a
   * condition (if / while). Booleans are used as-is; other types fall back
   * to normal JS truthiness (0, "", NaN are falsy — everything else is truthy).
   */
  _isTruthy(value) {
    if (typeof value === "boolean") return value;
    return Boolean(value);
  }

  _evaluateUnaryExpression(node) {
    const operand = this._evaluate(node.operand);
    switch (node.operator) {
      case "-": return -operand;
      default:
        this._runtimeError(`Unknown unary operator "${node.operator}"`, node);
    }
  }
}
