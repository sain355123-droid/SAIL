// compiler/parser/Parser.js
// SAIL Parser v0.0.2
//
// Consumes the token array produced by Lexer.tokenize() and builds an AST.
// AST nodes are plain objects — serialisable to JSON, easy to inspect.
//
// Grammar (current subset):
//
//   program     → module
//   module      → "module" IDENTIFIER NEWLINE block
//   block       → "start" NEWLINE statement* "end" NEWLINE?
//   statement   → showStmt | letStmt | ifStmt | whileStmt | NEWLINE
//                                              (NEWLINE = blank line, skipped)
//   showStmt    → "show" expression NEWLINE
//   letStmt     → "let" IDENTIFIER "=" expression NEWLINE
//   ifStmt      → "if" expression block ( "else" block )?
//   whileStmt   → "while" expression block
//
//   expression     → equality
//   equality       → comparison ( ( "==" | "!=" ) comparison )*
//   comparison     → additive ( ( ">" | "<" | ">=" | "<=" ) additive )*
//   additive       → multiplicative ( ( "+" | "-" ) multiplicative )*
//   multiplicative → unary ( ( "*" | "/" ) unary )*
//   unary          → "-" unary | primary
//   primary        → NUMBER | STRING | TRUE | FALSE | IDENTIFIER
//                     | "(" expression ")"
//
// Extending the parser:
//   To add a new statement type, add a case to _parseStatement().
//   The block loop never needs to change.
//   if/while reuse _parseBlock() for their bodies, so nested control flow
//   works for free — no special-casing needed anywhere else.

import { TokenType } from "../lexer/TokenType.js";

// ── AST node factories ────────────────────────────────────────────────────────
// Each factory returns a plain object tagged with `type`.
// `line` and `column` always refer to the token that opened the node.

function ProgramNode(module, line, column) {
  return { type: "ProgramNode", module, line, column };
}

function ModuleNode(name, body, line, column) {
  return { type: "ModuleNode", name, body, line, column };
}

function BlockNode(statements, line, column) {
  return { type: "BlockNode", statements, line, column };
}

function ShowNode(argument, line, column) {
  return { type: "ShowNode", argument, line, column };
}

function StringLiteralNode(value, line, column) {
  return { type: "StringLiteralNode", value, line, column };
}

function NumberLiteralNode(value, line, column) {
  // Store as a number, not a string — consumers get the right JS type
  return { type: "NumberLiteralNode", value: Number(value), line, column };
}

function IdentifierNode(name, line, column) {
  return { type: "IdentifierNode", name, line, column };
}

function LetNode(name, value, line, column) {
  return { type: "LetNode", name, value, line, column };
}

function BooleanLiteralNode(value, line, column) {
  return { type: "BooleanLiteralNode", value, line, column };
}

function IfNode(condition, thenBlock, elseBlock, line, column) {
  return { type: "IfNode", condition, thenBlock, elseBlock, line, column };
}

function WhileNode(condition, body, line, column) {
  return { type: "WhileNode", condition, body, line, column };
}

function BinaryExpressionNode(operator, left, right, line, column) {
  return { type: "BinaryExpressionNode", operator, left, right, line, column };
}

function UnaryExpressionNode(operator, operand, line, column) {
  return { type: "UnaryExpressionNode", operator, operand, line, column };
}

// ── Parser ────────────────────────────────────────────────────────────────────

export class Parser {
  /**
   * @param {import("../lexer/Token.js").Token[]} tokens
   *   The array returned by Lexer.tokenize(). Must end with an EOF token.
   */
  constructor(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      throw new Error("Parser requires a non-empty token array.");
    }
    this._tokens = tokens;
    this._pos    = 0;
  }

  // ── Token-level primitives ────────────────────────────────────────────────

  /** Return the current token without consuming it. */
  _peek() {
    return this._tokens[this._pos];
  }

  /** Consume and return the current token. */
  _advance() {
    const token = this._tokens[this._pos];
    if (token.type !== TokenType.EOF) {
      this._pos++;
    }
    return token;
  }

  /** Return true if the current token has the given type. */
  _check(type) {
    return this._peek().type === type;
  }

  /**
   * Consume the current token if it matches `type` and return it.
   * Throws a SyntaxError with position information if it does not match.
   */
  _expect(type) {
    const token = this._peek();
    if (token.type !== type) {
      throw new SyntaxError(
        `Expected ${type} but found ${token.type} ("${token.value}") ` +
        `at ${token.line}:${token.column}`
      );
    }
    return this._advance();
  }

  /** Skip any number of NEWLINE tokens. Used between structural elements. */
  _skipNewlines() {
    while (this._check(TokenType.NEWLINE)) {
      this._advance();
    }
  }

  /**
   * Consume exactly one NEWLINE (or EOF) that terminates a statement.
   * Throws if the current token is neither NEWLINE nor EOF.
   * Using EOF as a valid terminator means the last statement in a file
   * does not require a trailing newline.
   */
  _expectEndOfStatement() {
    if (this._check(TokenType.NEWLINE)) {
      this._advance();
      return;
    }
    if (this._check(TokenType.EOF)) {
      return; // final statement in the file — acceptable
    }
    const token = this._peek();
    throw new SyntaxError(
      `Expected end of statement (newline) but found ` +
      `${token.type} ("${token.value}") at ${token.line}:${token.column}`
    );
  }

  // ── Grammar rules ────────────────────────────────────────────────────────

  /**
   * program → module EOF
   */
  _parseProgram() {
    this._skipNewlines(); // tolerate leading blank lines

    const modToken = this._peek();
    if (!this._check(TokenType.MODULE)) {
      throw new SyntaxError(
        `Expected 'module' at start of program but found ` +
        `${modToken.type} ("${modToken.value}") at ${modToken.line}:${modToken.column}`
      );
    }

    const moduleNode = this._parseModule();

    this._skipNewlines(); // tolerate trailing blank lines
    this._expect(TokenType.EOF);

    return ProgramNode(moduleNode, moduleNode.line, moduleNode.column);
  }

  /**
   * module → "module" IDENTIFIER NEWLINE block
   */
  _parseModule() {
    const kwToken   = this._expect(TokenType.MODULE);
    const nameToken = this._expect(TokenType.IDENTIFIER);
    this._expectEndOfStatement();

    const block = this._parseBlock();

    return ModuleNode(
      nameToken.value,
      block,
      kwToken.line,
      kwToken.column
    );
  }

  /**
   * block → "start" NEWLINE statement* "end" NEWLINE?
   */
  _parseBlock() {
    const startToken = this._expect(TokenType.START);
    this._expectEndOfStatement();

    const statements = [];

    // Collect statements until we see "end" or EOF
    while (!this._check(TokenType.END) && !this._check(TokenType.EOF)) {
      const stmt = this._parseStatement();
      if (stmt !== null) {
        statements.push(stmt);
      }
    }

    if (this._check(TokenType.EOF)) {
      const t = this._peek();
      throw new SyntaxError(
        `Unexpected end of file — 'end' not found for block opened at ` +
        `${startToken.line}:${startToken.column}`
      );
    }

    this._expect(TokenType.END);
    // The "end" keyword may or may not be followed by a newline — both are valid
    if (this._check(TokenType.NEWLINE)) {
      this._advance();
    }

    return BlockNode(statements, startToken.line, startToken.column);
  }

  /**
   * statement → showStmt | letStmt | ifStmt | whileStmt | NEWLINE
   *             (blank lines are silently skipped)
   *
   * This is the extension point: to add a new statement keyword, add
   * a case here. The block loop does not change.
   */
  _parseStatement() {
    // Blank lines inside a block are ignored
    if (this._check(TokenType.NEWLINE)) {
      this._advance();
      return null;
    }

    const token = this._peek();

    switch (token.type) {
      case TokenType.SHOW:
        return this._parseShow();

      case TokenType.LET:
        return this._parseLet();

      case TokenType.IF:
        return this._parseIf();

      case TokenType.WHILE:
        return this._parseWhile();

      default:
        throw new SyntaxError(
          `Unexpected token ${token.type} ("${token.value}") ` +
          `at ${token.line}:${token.column}`
        );
    }
  }

  /**
   * showStmt → "show" expression NEWLINE
   */
  _parseShow() {
    const kwToken = this._expect(TokenType.SHOW);
    const argument = this._parseExpression();
    this._expectEndOfStatement();
    return ShowNode(argument, kwToken.line, kwToken.column);
  }

  /**
   * letStmt → "let" IDENTIFIER "=" expression NEWLINE
   */
  _parseLet() {
    const kwToken   = this._expect(TokenType.LET);
    const nameToken = this._expect(TokenType.IDENTIFIER);
    this._expect(TokenType.ASSIGN);
    const value = this._parseExpression();
    this._expectEndOfStatement();
    return LetNode(nameToken.value, value, kwToken.line, kwToken.column);
  }

  /**
   * ifStmt → "if" expression block ( "else" block )?
   *
   * Both the "then" and "else" bodies are ordinary blocks (the same
   * "start" ... "end" form used everywhere else in SAIL), so this simply
   * delegates to _parseBlock() twice.
   */
  _parseIf() {
    const kwToken   = this._expect(TokenType.IF);
    const condition = this._parseExpression();
    const thenBlock = this._parseBlock();

    // Blank lines between "end" and a following "else" are insignificant —
    // skipping them here has the same effect as if the outer block loop
    // had skipped them as empty statements.
    this._skipNewlines();

    let elseBlock = null;
    if (this._check(TokenType.ELSE)) {
      this._advance();
      elseBlock = this._parseBlock();
    }

    return IfNode(condition, thenBlock, elseBlock, kwToken.line, kwToken.column);
  }

  /**
   * whileStmt → "while" expression block
   */
  _parseWhile() {
    const kwToken   = this._expect(TokenType.WHILE);
    const condition = this._parseExpression();
    const body      = this._parseBlock();
    return WhileNode(condition, body, kwToken.line, kwToken.column);
  }

  // ── Expression parsing (recursive descent) ───────────────────────────────
  //
  // Precedence (lowest → highest):
  //   equality       → == !=
  //   comparison     → > < >= <=
  //   additive       → + -
  //   multiplicative → * /
  //   unary          → - (prefix)
  //   primary        → NUMBER | STRING | TRUE | FALSE | IDENTIFIER | "(" expression ")"

  _parseExpression() {
    return this._parseEquality();
  }

  /** equality → comparison ( ( "==" | "!=" ) comparison )* */
  _parseEquality() {
    let left = this._parseComparison();

    while (this._check(TokenType.EQ) || this._check(TokenType.NEQ)) {
      const opToken = this._advance();
      const right   = this._parseComparison();
      left = BinaryExpressionNode(opToken.value, left, right, opToken.line, opToken.column);
    }

    return left;
  }

  /** comparison → additive ( ( ">" | "<" | ">=" | "<=" ) additive )* */
  _parseComparison() {
    let left = this._parseAdditive();

    while (
      this._check(TokenType.GT)  || this._check(TokenType.LT) ||
      this._check(TokenType.GTE) || this._check(TokenType.LTE)
    ) {
      const opToken = this._advance();
      const right   = this._parseAdditive();
      left = BinaryExpressionNode(opToken.value, left, right, opToken.line, opToken.column);
    }

    return left;
  }

  /** additive → multiplicative ( ( "+" | "-" ) multiplicative )* */
  _parseAdditive() {
    let left = this._parseMultiplicative();

    while (this._check(TokenType.PLUS) || this._check(TokenType.MINUS)) {
      const opToken = this._advance();
      const right   = this._parseMultiplicative();
      left = BinaryExpressionNode(opToken.value, left, right, opToken.line, opToken.column);
    }

    return left;
  }

  /** multiplicative → unary ( ( "*" | "/" ) unary )* */
  _parseMultiplicative() {
    let left = this._parseUnary();

    while (this._check(TokenType.STAR) || this._check(TokenType.SLASH)) {
      const opToken = this._advance();
      const right   = this._parseUnary();
      left = BinaryExpressionNode(opToken.value, left, right, opToken.line, opToken.column);
    }

    return left;
  }

  /** unary → "-" unary | primary */
  _parseUnary() {
    if (this._check(TokenType.MINUS)) {
      const opToken = this._advance();
      const operand = this._parseUnary();
      return UnaryExpressionNode(opToken.value, operand, opToken.line, opToken.column);
    }
    return this._parsePrimary();
  }

  /** primary → NUMBER | STRING | TRUE | FALSE | IDENTIFIER | "(" expression ")" */
  _parsePrimary() {
    const token = this._peek();

    if (token.type === TokenType.NUMBER) {
      this._advance();
      return NumberLiteralNode(token.value, token.line, token.column);
    }

    if (token.type === TokenType.STRING) {
      this._advance();
      return StringLiteralNode(token.value, token.line, token.column);
    }

    if (token.type === TokenType.IDENTIFIER) {
      this._advance();
      return IdentifierNode(token.value, token.line, token.column);
    }

    if (token.type === TokenType.TRUE) {
      this._advance();
      return BooleanLiteralNode(true, token.line, token.column);
    }

    if (token.type === TokenType.FALSE) {
      this._advance();
      return BooleanLiteralNode(false, token.line, token.column);
    }

    if (token.type === TokenType.LPAREN) {
      this._advance(); // consume "("
      const expr = this._parseExpression();
      this._expect(TokenType.RPAREN);
      return expr;
    }

    throw new SyntaxError(
      `Expected expression but found ${token.type} ("${token.value}") ` +
      `at ${token.line}:${token.column}`
    );
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Parse the token stream and return a ProgramNode.
   * Throws SyntaxError with line:column information on any parse failure.
   *
   * @returns {ProgramNode}
   */
  parse() {
    return this._parseProgram();
  }
}
