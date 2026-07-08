// compiler/parser/Parser.js
// SAIL Parser v0.5
//
// Consumes the token array produced by Lexer.tokenize() and builds an AST.
// AST nodes are plain objects — serialisable to JSON, easy to inspect.
//
// Grammar (current subset):
//
//   program     → module
//   module      → "module" IDENTIFIER NEWLINE block
//   block       → "start" NEWLINE statement* "end" NEWLINE?
//   statement   → showStmt | letStmt | ifStmt | whileStmt | forStmt
//                 | breakStmt | continueStmt | taskStmt | returnStmt
//                 | exprStmt | NEWLINE
//                                              (NEWLINE = blank line, skipped)
//   showStmt    → "show" expression NEWLINE
//   letStmt     → "let" IDENTIFIER ("[" expression "]")? "=" expression NEWLINE
//   ifStmt      → "if" expression block ( "else" block )?
//   whileStmt   → "while" expression block
//   forStmt     → "for" IDENTIFIER "in" expression ( ".." expression )? block
//                 (with "..": a numeric range, upper bound exclusive.
//                  without: iterate the elements of an array expression.)
//   breakStmt   → "break" NEWLINE
//   continueStmt→ "continue" NEWLINE
//   taskStmt    → "task" IDENTIFIER "(" params? ")" block
//   params      → IDENTIFIER ( "," IDENTIFIER )*
//   returnStmt  → "return" expression? NEWLINE
//   exprStmt    → expression NEWLINE   (only useful for its side effects,
//                                       e.g. a bare task call)
//
//   expression     → logicOr
//   logicOr        → logicAnd ( "or" logicAnd )*
//   logicAnd       → equality ( "and" equality )*
//   equality       → comparison ( ( "==" | "!=" ) comparison )*
//   comparison     → additive ( ( ">" | "<" | ">=" | "<=" ) additive )*
//   additive       → multiplicative ( ( "+" | "-" ) multiplicative )*
//   multiplicative → unary ( ( "*" | "/" ) unary )*
//   unary          → ( "-" | "not" ) unary | postfix
//   postfix        → primary ( "(" args? ")" | "[" expression "]" )*
//   args           → expression ( "," expression )*
//   primary        → NUMBER | STRING | TRUE | FALSE | IDENTIFIER
//                     | arrayLiteral | "(" expression ")"
//   arrayLiteral   → "[" ( expression ( "," expression )* )? "]"
//
// Extending the parser:
//   To add a new statement type, add a case to _parseStatement().
//   The block loop never needs to change.
//   if/while/for/task reuse _parseBlock() for their bodies, so nested
//   control flow works for free — no special-casing needed anywhere else.

import { TokenType } from "../lexer/TokenType.js";
import { SailError, suggest } from "../errors/SailError.js";

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

function LogicalExpressionNode(operator, left, right, line, column) {
  // Kept separate from BinaryExpressionNode because "and"/"or" short-circuit
  // — the interpreter must not eagerly evaluate the right-hand side.
  return { type: "LogicalExpressionNode", operator, left, right, line, column };
}

function UnaryExpressionNode(operator, operand, line, column) {
  return { type: "UnaryExpressionNode", operator, operand, line, column };
}

// ── v0.5 node factories ───────────────────────────────────────────────────────

function ForRangeNode(varName, from, to, body, line, column) {
  return { type: "ForRangeNode", varName, from, to, body, line, column };
}

function ForInNode(varName, iterable, body, line, column) {
  return { type: "ForInNode", varName, iterable, body, line, column };
}

function BreakNode(line, column) {
  return { type: "BreakNode", line, column };
}

function ContinueNode(line, column) {
  return { type: "ContinueNode", line, column };
}

function TaskNode(name, params, body, line, column) {
  return { type: "TaskNode", name, params, body, line, column };
}

function ReturnNode(value, line, column) {
  return { type: "ReturnNode", value, line, column };
}

function CallExpressionNode(callee, args, line, column) {
  return { type: "CallExpressionNode", callee, args, line, column };
}

function ExpressionStatementNode(expression, line, column) {
  return { type: "ExpressionStatementNode", expression, line, column };
}

function ArrayLiteralNode(elements, line, column) {
  return { type: "ArrayLiteralNode", elements, line, column };
}

function IndexExpressionNode(object, index, line, column) {
  return { type: "IndexExpressionNode", object, index, line, column };
}

function IndexAssignNode(object, index, value, line, column) {
  return { type: "IndexAssignNode", object, index, value, line, column };
}

// Keywords a mistyped identifier at the start of a statement is most likely
// to have meant — used to power "did you mean...?" suggestions.
const STATEMENT_KEYWORDS = [
  "show", "let", "if", "else", "while", "for", "in",
  "break", "continue", "task", "return", "true", "false", "and", "or", "not",
];

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

  /** Return the token `offset` positions ahead without consuming anything. */
  _peekAhead(offset) {
    const idx = this._pos + offset;
    return idx < this._tokens.length ? this._tokens[idx] : this._tokens[this._tokens.length - 1];
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
   * Throws a SailError with position information (and a suggestion, where
   * one is available) if it does not match.
   */
  _expect(type) {
    const token = this._peek();
    if (token.type !== type) {
      throw this._unexpectedToken(token, `Expected ${type}`);
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
   * Consume exactly one NEWLINE (or EOF, or a token that closes the
   * enclosing block/expression) that terminates a statement.
   * Throws if the current token is none of those.
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
    throw new SailError(
      "Syntax",
      `Expected end of statement (newline) but found ${token.type} ("${token.value}")`,
      { line: token.line, column: token.column }
    );
  }

  /**
   * Build an intelligent "unexpected token" error. If the offending token is
   * an IDENTIFIER that closely resembles a SAIL keyword, suggest it.
   */
  _unexpectedToken(token, prefix) {
    let suggestion = null;
    if (token.type === TokenType.IDENTIFIER) {
      suggestion = suggest(token.value, STATEMENT_KEYWORDS);
    }
    return new SailError(
      "Syntax",
      `${prefix} but found ${token.type} ("${token.value}")`,
      { line: token.line, column: token.column, suggestion }
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
      throw this._unexpectedToken(modToken, `Expected 'module' at start of program`);
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
      throw new SailError(
        "Syntax",
        `Unexpected end of file — 'end' not found for block opened at ` +
        `${startToken.line}:${startToken.column}`,
        { line: startToken.line, column: startToken.column,
          hint: `Every "start" needs a matching "end". Check for a missing "end" somewhere above.` }
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
   * statement → showStmt | letStmt | ifStmt | whileStmt | forStmt
   *             | breakStmt | continueStmt | taskStmt | returnStmt
   *             | exprStmt | NEWLINE
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

      case TokenType.FOR:
        return this._parseFor();

      case TokenType.BREAK:
        return this._parseBreak();

      case TokenType.CONTINUE:
        return this._parseContinue();

      case TokenType.TASK:
        return this._parseTask();

      case TokenType.RETURN:
        return this._parseReturn();

      case TokenType.IDENTIFIER:
        return this._parseIdentifierStatement();

      default:
        throw this._unexpectedToken(token, `Unexpected token`);
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
   * letStmt → "let" IDENTIFIER ("[" expression "]")? "=" expression NEWLINE
   *
   * The optional "[" expression "]" turns this into an index-assignment
   * (e.g. "let scores[0] = 100"), rewriting an existing array element
   * instead of rebinding the name itself.
   */
  _parseLet() {
    const kwToken   = this._expect(TokenType.LET);
    const nameToken = this._expect(TokenType.IDENTIFIER);

    if (this._check(TokenType.LBRACKET)) {
      this._advance(); // consume "["
      const index = this._parseExpression();
      this._expect(TokenType.RBRACKET);
      this._expect(TokenType.ASSIGN);
      const value = this._parseExpression();
      this._expectEndOfStatement();
      const target = IdentifierNode(nameToken.value, nameToken.line, nameToken.column);
      return IndexAssignNode(target, index, value, kwToken.line, kwToken.column);
    }

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

  /**
   * forStmt → "for" IDENTIFIER "in" expression ( ".." expression )? block
   *
   * Expression parsing naturally stops before ".." (no rule in the
   * expression grammar consumes it), so we can just check for it here
   * without any special lookahead in the expression parser itself.
   */
  _parseFor() {
    const kwToken    = this._expect(TokenType.FOR);
    const nameToken  = this._expect(TokenType.IDENTIFIER);
    this._expect(TokenType.IN);
    const first = this._parseExpression();

    if (this._check(TokenType.DOTDOT)) {
      this._advance();
      const second = this._parseExpression();
      const body = this._parseBlock();
      return ForRangeNode(nameToken.value, first, second, body, kwToken.line, kwToken.column);
    }

    const body = this._parseBlock();
    return ForInNode(nameToken.value, first, body, kwToken.line, kwToken.column);
  }

  /** breakStmt → "break" NEWLINE */
  _parseBreak() {
    const kwToken = this._expect(TokenType.BREAK);
    this._expectEndOfStatement();
    return BreakNode(kwToken.line, kwToken.column);
  }

  /** continueStmt → "continue" NEWLINE */
  _parseContinue() {
    const kwToken = this._expect(TokenType.CONTINUE);
    this._expectEndOfStatement();
    return ContinueNode(kwToken.line, kwToken.column);
  }

  /**
   * taskStmt → "task" IDENTIFIER "(" params? ")" block
   * params   → IDENTIFIER ( "," IDENTIFIER )*
   */
  _parseTask() {
    const kwToken   = this._expect(TokenType.TASK);
    const nameToken = this._expect(TokenType.IDENTIFIER);
    this._expect(TokenType.LPAREN);

    const params = [];
    if (!this._check(TokenType.RPAREN)) {
      params.push(this._expect(TokenType.IDENTIFIER).value);
      while (this._check(TokenType.COMMA)) {
        this._advance();
        params.push(this._expect(TokenType.IDENTIFIER).value);
      }
    }
    this._expect(TokenType.RPAREN);

    // A task's header ("task name(...)") is immediately followed by its
    // "start ... end" body, exactly like if/while/for.
    const body = this._parseBlock();

    return TaskNode(nameToken.value, params, body, kwToken.line, kwToken.column);
  }

  /** returnStmt → "return" expression? NEWLINE */
  _parseReturn() {
    const kwToken = this._expect(TokenType.RETURN);

    // "return" with nothing after it (immediately end-of-statement) returns
    // no value; otherwise parse the expression being returned.
    let value = null;
    if (!this._check(TokenType.NEWLINE) && !this._check(TokenType.EOF) && !this._check(TokenType.END)) {
      value = this._parseExpression();
    }
    this._expectEndOfStatement();
    return ReturnNode(value, kwToken.line, kwToken.column);
  }

  /**
   * exprStmt → expression NEWLINE
   *
   * Reached when a statement begins with an IDENTIFIER that isn't "let".
   * The only useful case is a bare task call (e.g. "greet(\"world\")"),
   * kept for its side effects. Anything else is very likely a typo — for
   * example a mistyped keyword — so we try to say something more helpful
   * than a generic parse error.
   */
  _parseIdentifierStatement() {
    const token = this._peek();
    const next  = this._peekAhead(1);
    const looksLikeCallOrAssign =
      next.type === TokenType.LPAREN ||
      next.type === TokenType.LBRACKET ||
      next.type === TokenType.ASSIGN;

    if (!looksLikeCallOrAssign) {
      // Not a call, not an index-assign — most likely a mistyped keyword
      // (e.g. "shwo x" instead of "show x").
      const suggestion = suggest(token.value, STATEMENT_KEYWORDS);
      if (suggestion) {
        throw new SailError(
          "Syntax",
          `Unexpected identifier "${token.value}" at start of statement`,
          { line: token.line, column: token.column, suggestion }
        );
      }
    }

    const expr = this._parseExpression();
    this._expectEndOfStatement();

    if (expr.type !== "CallExpressionNode") {
      throw new SailError(
        "Syntax",
        `A standalone value doesn't do anything on its own`,
        {
          line: expr.line, column: expr.column,
          hint: `Use "show <expression>" to print a value, or "let name = <expression>" to store it.`,
        }
      );
    }

    return ExpressionStatementNode(expr, expr.line, expr.column);
  }

  // ── Expression parsing (recursive descent) ───────────────────────────────
  //
  // Precedence (lowest → highest):
  //   logicOr        → or
  //   logicAnd       → and
  //   equality       → == !=
  //   comparison     → > < >= <=
  //   additive       → + -
  //   multiplicative → * /
  //   unary          → - (prefix) | not (prefix)
  //   postfix        → call "(" ")" | index "[" "]"
  //   primary         → NUMBER | STRING | TRUE | FALSE | IDENTIFIER
  //                      | arrayLiteral | "(" expression ")"

  _parseExpression() {
    return this._parseLogicOr();
  }

  /** logicOr → logicAnd ( "or" logicAnd )* */
  _parseLogicOr() {
    let left = this._parseLogicAnd();
    while (this._check(TokenType.OR)) {
      const opToken = this._advance();
      const right = this._parseLogicAnd();
      left = LogicalExpressionNode("or", left, right, opToken.line, opToken.column);
    }
    return left;
  }

  /** logicAnd → equality ( "and" equality )* */
  _parseLogicAnd() {
    let left = this._parseEquality();
    while (this._check(TokenType.AND)) {
      const opToken = this._advance();
      const right = this._parseEquality();
      left = LogicalExpressionNode("and", left, right, opToken.line, opToken.column);
    }
    return left;
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

  /** unary → ( "-" | "not" ) unary | postfix */
  _parseUnary() {
    if (this._check(TokenType.MINUS)) {
      const opToken = this._advance();
      const operand = this._parseUnary();
      return UnaryExpressionNode(opToken.value, operand, opToken.line, opToken.column);
    }
    if (this._check(TokenType.NOT)) {
      const opToken = this._advance();
      const operand = this._parseUnary();
      return UnaryExpressionNode("not", operand, opToken.line, opToken.column);
    }
    return this._parsePostfix();
  }

  /**
   * postfix → primary ( "(" args? ")" | "[" expression "]" )*
   *
   * Handles task calls ("greet(\"world\")") and array indexing
   * ("scores[0]"), including chains like "matrix[0][1]" or "getList()[2]".
   */
  _parsePostfix() {
    let node = this._parsePrimary();

    while (true) {
      if (this._check(TokenType.LPAREN)) {
        const opToken = this._advance();
        const args = [];
        if (!this._check(TokenType.RPAREN)) {
          args.push(this._parseExpression());
          while (this._check(TokenType.COMMA)) {
            this._advance();
            args.push(this._parseExpression());
          }
        }
        this._expect(TokenType.RPAREN);
        node = CallExpressionNode(node, args, opToken.line, opToken.column);
        continue;
      }

      if (this._check(TokenType.LBRACKET)) {
        const opToken = this._advance();
        const index = this._parseExpression();
        this._expect(TokenType.RBRACKET);
        node = IndexExpressionNode(node, index, opToken.line, opToken.column);
        continue;
      }

      break;
    }

    return node;
  }

  /**
   * primary → NUMBER | STRING | TRUE | FALSE | IDENTIFIER
   *           | arrayLiteral | "(" expression ")"
   */
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

    if (token.type === TokenType.LBRACKET) {
      return this._parseArrayLiteral();
    }

    if (token.type === TokenType.LPAREN) {
      this._advance(); // consume "("
      const expr = this._parseExpression();
      this._expect(TokenType.RPAREN);
      return expr;
    }

    throw this._unexpectedToken(token, `Expected expression`);
  }

  /** arrayLiteral → "[" ( expression ( "," expression )* )? "]" */
  _parseArrayLiteral() {
    const openToken = this._expect(TokenType.LBRACKET);
    const elements = [];
    if (!this._check(TokenType.RBRACKET)) {
      elements.push(this._parseExpression());
      while (this._check(TokenType.COMMA)) {
        this._advance();
        elements.push(this._parseExpression());
      }
    }
    this._expect(TokenType.RBRACKET);
    return ArrayLiteralNode(elements, openToken.line, openToken.column);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Parse the token stream and return a ProgramNode.
   * Throws SailError with line:column information (and suggestions, where
   * available) on any parse failure.
   *
   * @returns {ProgramNode}
   */
  parse() {
    return this._parseProgram();
  }
}
