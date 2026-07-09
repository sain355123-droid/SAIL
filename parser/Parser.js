// compiler/parser/Parser.js
// SAIL Parser v1.0
//
// Consumes the token array produced by Lexer.tokenize() and builds an AST.
// AST nodes are plain objects — serialisable to JSON, easy to inspect.
//
// Grammar (current subset):
//
//   program     → module
//   module      → "module" IDENTIFIER NEWLINE block
//   block       → "start" NEWLINE statement* "end" NEWLINE?
//   statement   → showStmt | letStmt | constStmt | ifStmt | whileStmt
//                 | forStmt | foreachStmt | taskStmt | returnStmt
//                 | breakStmt | continueStmt | importStmt | exportStmt
//                 | exprStmt | NEWLINE
//                                              (NEWLINE = blank line, skipped)
//   showStmt    → "show" expression NEWLINE
//   letStmt     → "let" IDENTIFIER accessor* "=" expression NEWLINE
//   constStmt   → "const" IDENTIFIER "=" expression NEWLINE
//   accessor    → "." IDENTIFIER | "[" expression "]"
//   ifStmt      → "if" expression block
//                    ( "else" "if" expression block )*
//                    ( "else" block )?
//   whileStmt   → "while" expression block
//   forStmt     → "for" IDENTIFIER "in" expression
//                    ( "to" expression ( "step" expression )? )? block
//   foreachStmt → "foreach" IDENTIFIER "in" expression block
//   taskStmt    → "task" IDENTIFIER "(" parameters? ")" block
//   parameters  → parameter ( "," parameter )*
//   parameter   → IDENTIFIER ( "=" expression )?      (default value)
//   returnStmt  → "return" expression? NEWLINE
//   breakStmt   → "break" NEWLINE
//   continueStmt→ "continue" NEWLINE
//   importStmt  → "import" "{" IDENTIFIER ("," IDENTIFIER)* "}" "from" STRING NEWLINE
//                 | "import" STRING "as" IDENTIFIER NEWLINE
//   exportStmt  → "export" ( letStmt | constStmt | taskStmt )
//   exprStmt    → expression NEWLINE      (e.g. a bare function call)
//
//   expression     → logicOr
//   logicOr        → logicAnd ( "or" logicAnd )*
//   logicAnd       → logicNot ( "and" logicNot )*
//   logicNot       → "not" logicNot | equality
//   equality       → comparison ( ( "==" | "!=" ) comparison )*
//   comparison     → additive ( ( ">" | "<" | ">=" | "<=" ) additive )*
//   additive       → multiplicative ( ( "+" | "-" ) multiplicative )*
//   multiplicative → unary ( ( "*" | "/" | "%" ) unary )*
//   unary          → "-" unary | call
//   call           → primary ( "(" arguments? ")" | "[" expression "]" | "." IDENTIFIER )*
//   primary        → NUMBER | STRING | TRUE | FALSE | NOTHING | IDENTIFIER
//                     | arrayLiteral | objectLiteral | anonymousTask
//                     | "(" expression ")"
//   arrayLiteral   → "[" ( expression ( "," expression )* )? "]"
//   objectLiteral  → "{" ( objectEntry ( "," objectEntry )* )? "}"
//   objectEntry    → ( IDENTIFIER | STRING ) ":" expression
//   anonymousTask  → "task" "(" parameters? ")" block
//
// Extending the parser:
//   To add a new statement type, add a case to _parseStatement().
//   The block loop never needs to change.
//   if/while/for/foreach/task reuse _parseBlock() for their bodies, so
//   nested control flow works for free — no special-casing needed anywhere
//   else.

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

function ConstNode(name, value, line, column) {
  return { type: "ConstNode", name, value, line, column };
}

function BooleanLiteralNode(value, line, column) {
  return { type: "BooleanLiteralNode", value, line, column };
}

function NullLiteralNode(line, column) {
  return { type: "NullLiteralNode", line, column };
}

function IfNode(condition, thenBlock, elseBlock, line, column) {
  // elseBlock is either null, a BlockNode, or (for "else if") another IfNode
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

// ── v0.5 AST node factories ─────────────────────────────────────────────────

function LogicalExpressionNode(operator, left, right, line, column) {
  return { type: "LogicalExpressionNode", operator, left, right, line, column };
}

function ForRangeNode(varName, start, end, step, body, line, column) {
  return { type: "ForRangeNode", varName, start, end, step, body, line, column };
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

function ReturnNode(argument, line, column) {
  return { type: "ReturnNode", argument, line, column };
}

function CallNode(callee, args, line, column) {
  return { type: "CallNode", callee, args, line, column };
}

function ArrayLiteralNode(elements, line, column) {
  return { type: "ArrayLiteralNode", elements, line, column };
}

function ExpressionStatementNode(expression, line, column) {
  return { type: "ExpressionStatementNode", expression, line, column };
}

// ── v1.0 AST node factories ─────────────────────────────────────────────────

// Unified member access: object.property (computed=false) or object[expr] (computed=true)
function MemberExpressionNode(object, property, computed, line, column) {
  return { type: "MemberExpressionNode", object, property, computed, line, column };
}

// A left-hand side used by `let`/`const` when it targets a member chain,
// e.g. `let user.name = "Sai"` or `let scores[0] = 100`.
function MemberAssignNode(name, accessors, value, line, column) {
  return { type: "MemberAssignNode", name, accessors, value, line, column };
}

function ObjectLiteralNode(entries, line, column) {
  // entries: [{ key: string, value: exprNode }]
  return { type: "ObjectLiteralNode", entries, line, column };
}

function AnonymousTaskNode(params, body, line, column) {
  return { type: "AnonymousTaskNode", params, body, line, column };
}

function ImportNode(specifiers, source, namespaceAlias, line, column) {
  // Destructured form: specifiers = ["foo", "bar"], namespaceAlias = null
  // Namespace form:     specifiers = null, namespaceAlias = "utils"
  return { type: "ImportNode", specifiers, source, namespaceAlias, line, column };
}

function ExportNode(declaration, line, column) {
  return { type: "ExportNode", declaration, line, column };
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

  /** Return the token `offset` positions ahead without consuming anything. */
  _peekAhead(offset) {
    const idx = Math.min(this._pos + offset, this._tokens.length - 1);
    return this._tokens[idx];
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

  /** Human-friendly description of a token type, for error messages. */
  _describe(type) {
    const names = {
      [TokenType.END]:      `the closing keyword "end"`,
      [TokenType.RPAREN]:   `a closing ")"`,
      [TokenType.RBRACKET]: `a closing "]"`,
      [TokenType.RBRACE]:   `a closing "}"`,
      [TokenType.LPAREN]:   `an opening "("`,
      [TokenType.LBRACKET]: `an opening "["`,
      [TokenType.LBRACE]:   `an opening "{"`,
      [TokenType.IDENTIFIER]: "a name",
      [TokenType.ASSIGN]:   `"="`,
      [TokenType.IN]:       `"in"`,
      [TokenType.START]:    `"start"`,
      [TokenType.COLON]:    `":"`,
      [TokenType.FROM]:     `"from"`,
    };
    return names[type] || type;
  }

  /**
   * Consume the current token if it matches `type` and return it.
   * Throws a SyntaxError with position information if it does not match.
   */
  _expect(type) {
    const token = this._peek();
    if (token.type !== type) {
      throw new SyntaxError(
        `Expected ${this._describe(type)} but found ${token.type} ("${token.value}") ` +
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
      `${token.type} ("${token.value}") at ${token.line}:${token.column}\n` +
      `Tip: only one statement is allowed per line in SAIL.`
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
        `${modToken.type} ("${modToken.value}") at ${modToken.line}:${modToken.column}\n` +
        `Tip: every SAIL file starts with "module <Name>".`
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
      throw new SyntaxError(
        `Unexpected end of file — 'end' not found for block opened at ` +
        `${startToken.line}:${startToken.column}\n` +
        `Tip: every "start" needs a matching "end".`
      );
    }

    this._expect(TokenType.END);
    // Deliberately NOT consuming a trailing newline here. When a block
    // closes a plain statement (if/while/for/task), the newline right
    // after "end" is harmlessly skipped as a blank line by the next call
    // to _parseStatement(). But when a block is part of an *expression*
    // (an anonymous task used inline, e.g. `let f = task() start ... end`),
    // that expression's enclosing statement (let/return/show) still needs
    // to see a NEWLINE next in order to terminate itself correctly — so
    // this method must never consume it on the block's behalf.

    return BlockNode(statements, startToken.line, startToken.column);
  }

  /**
   * statement → showStmt | letStmt | constStmt | ifStmt | whileStmt
   *             | forStmt | foreachStmt | taskStmt | returnStmt
   *             | breakStmt | continueStmt | importStmt | exportStmt
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

      case TokenType.CONST:
        return this._parseConst();

      case TokenType.IF:
        return this._parseIf();

      case TokenType.WHILE:
        return this._parseWhile();

      case TokenType.FOR:
        return this._parseFor();

      case TokenType.FOREACH:
        return this._parseForeach();

      case TokenType.TASK:
        return this._parseTask();

      case TokenType.RETURN:
        return this._parseReturn();

      case TokenType.BREAK:
        return this._parseBreak();

      case TokenType.CONTINUE:
        return this._parseContinue();

      case TokenType.IMPORT:
        return this._parseImport();

      case TokenType.EXPORT:
        return this._parseExport();

      // A statement that begins with an identifier, a "(" or a "-" isn't a
      // keyword statement — it's a bare expression used for its side effect,
      // most commonly a function call like `greet()`.
      case TokenType.IDENTIFIER:
      case TokenType.LPAREN:
      case TokenType.MINUS:
      case TokenType.NOT:
        return this._parseExpressionStatement();

      default:
        throw new SyntaxError(
          `Unexpected token ${token.type} ("${token.value}") ` +
          `at ${token.line}:${token.column}\n` +
          `Tip: a line inside a block must start with a keyword like ` +
          `show, let, const, if, while, for, foreach, task, return, break, ` +
          `continue, import, export — or be a function call.`
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
   * Parse a chain of member accessors following a base identifier, e.g.
   * the ".age" and "[0]" in "user.age" or "scores[0]". Used by both
   * expression parsing (_parseCall) and assignment-target parsing
   * (_parseLet/_parseConst), which is why it returns a plain accessor
   * list rather than nested MemberExpressionNodes — the two call sites
   * consume that list differently (read vs. write).
   */
  _parseAccessorChain() {
    const accessors = [];
    while (true) {
      if (this._check(TokenType.DOT)) {
        this._advance();
        const propToken = this._expect(TokenType.IDENTIFIER);
        accessors.push({ computed: false, key: propToken.value });
        continue;
      }
      if (this._check(TokenType.LBRACKET)) {
        this._advance();
        const indexExpr = this._parseExpression();
        this._expect(TokenType.RBRACKET);
        accessors.push({ computed: true, key: indexExpr });
        continue;
      }
      break;
    }
    return accessors;
  }

  /**
   * letStmt → "let" IDENTIFIER accessor* "=" expression NEWLINE
   *
   * With no accessors, "let" declares a new variable or reassigns an
   * existing one — both use the same keyword in SAIL. With one or more
   * accessors (".name" or "[index]"), it assigns into an existing array
   * or object instead, e.g. `let scores[0] = 100` or `let user.age = 21`.
   */
  _parseLet() {
    const kwToken   = this._expect(TokenType.LET);
    const nameToken = this._expect(TokenType.IDENTIFIER);
    const accessors = this._parseAccessorChain();

    this._expect(TokenType.ASSIGN);
    const value = this._parseExpression();
    this._expectEndOfStatement();

    if (accessors.length === 0) {
      return LetNode(nameToken.value, value, kwToken.line, kwToken.column);
    }
    return MemberAssignNode(nameToken.value, accessors, value, kwToken.line, kwToken.column);
  }

  /**
   * constStmt → "const" IDENTIFIER "=" expression NEWLINE
   * Constants can't be re-assigned once declared (enforced by the
   * interpreter/environment, not the parser).
   */
  _parseConst() {
    const kwToken   = this._expect(TokenType.CONST);
    const nameToken = this._expect(TokenType.IDENTIFIER);
    this._expect(TokenType.ASSIGN);
    const value = this._parseExpression();
    this._expectEndOfStatement();
    return ConstNode(nameToken.value, value, kwToken.line, kwToken.column);
  }

  /**
   * ifStmt → "if" expression block
   *             ( "else" "if" expression block )*
   *             ( "else" block )?
   *
   * "else if" is represented as a nested IfNode assigned directly as the
   * outer node's elseBlock (rather than wrapped in its own BlockNode), so
   * a chain of "else if"s becomes a chain of IfNodes. The interpreter
   * checks which shape elseBlock is and handles both.
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
      if (this._check(TokenType.IF)) {
        elseBlock = this._parseIf(); // chain — nested IfNode, own block(s)
      } else {
        elseBlock = this._parseBlock();
      }
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
   * forStmt → "for" IDENTIFIER "in" expression
   *              ( "to" expression ( "step" expression )? )? block
   *
   * Two forms share one keyword, distinguished by whether "to" follows the
   * first expression:
   *   for i in 0 to 10 start ... end          (range, exclusive of 10)
   *   for i in 0 to 10 step 2 start ... end    (range with a custom step)
   *   for item in myArray start ... end        (iterate over an array)
   *
   * Reading "for i in 0 to 10" out loud is exactly what it does — no
   * C-style init/condition/increment triplet to learn.
   */
  _parseFor() {
    const kwToken   = this._expect(TokenType.FOR);
    const nameToken = this._expect(TokenType.IDENTIFIER);
    this._expect(TokenType.IN);
    const first = this._parseExpression();

    if (this._check(TokenType.TO)) {
      this._advance();
      const end = this._parseExpression();

      let step = null;
      if (this._check(TokenType.STEP)) {
        this._advance();
        step = this._parseExpression();
      }

      const body = this._parseBlock();
      return ForRangeNode(nameToken.value, first, end, step, body, kwToken.line, kwToken.column);
    }

    const body = this._parseBlock();
    return ForInNode(nameToken.value, first, body, kwToken.line, kwToken.column);
  }

  /**
   * foreachStmt → "foreach" IDENTIFIER "in" expression block
   * Sugar for the iterate form of "for", offered as its own keyword for
   * programmers who want to say explicitly "I'm walking a collection, not
   * counting a range".
   */
  _parseForeach() {
    const kwToken   = this._expect(TokenType.FOREACH);
    const nameToken = this._expect(TokenType.IDENTIFIER);
    this._expect(TokenType.IN);
    const iterable = this._parseExpression();
    const body     = this._parseBlock();
    return ForInNode(nameToken.value, iterable, body, kwToken.line, kwToken.column);
  }

  /** parameters → parameter ( "," parameter )* ; parameter → IDENTIFIER ( "=" expression )? */
  _parseParameterList() {
    const params = [];
    if (!this._check(TokenType.RPAREN)) {
      params.push(this._parseParameter());
      while (this._check(TokenType.COMMA)) {
        this._advance();
        params.push(this._parseParameter());
      }
    }
    return params;
  }

  _parseParameter() {
    const nameToken = this._expect(TokenType.IDENTIFIER);
    let defaultValue = null;
    if (this._check(TokenType.ASSIGN)) {
      this._advance();
      defaultValue = this._parseExpression();
    }
    return { name: nameToken.value, defaultValue };
  }

  /**
   * taskStmt → "task" IDENTIFIER "(" parameters? ")" block
   * "task" is SAIL's word for a function — a named, callable unit of work.
   * Parameters may have default values: task greet(name, greeting = "Hi").
   */
  _parseTask() {
    const kwToken   = this._expect(TokenType.TASK);
    const nameToken = this._expect(TokenType.IDENTIFIER);
    this._expect(TokenType.LPAREN);
    const params = this._parseParameterList();
    this._expect(TokenType.RPAREN);

    const body = this._parseBlock();
    return TaskNode(nameToken.value, params, body, kwToken.line, kwToken.column);
  }

  /**
   * returnStmt → "return" expression? NEWLINE
   * A bare "return" (no expression) hands back nothing.
   */
  _parseReturn() {
    const kwToken = this._expect(TokenType.RETURN);

    let argument = null;
    if (!this._check(TokenType.NEWLINE) && !this._check(TokenType.EOF)) {
      argument = this._parseExpression();
    }
    this._expectEndOfStatement();
    return ReturnNode(argument, kwToken.line, kwToken.column);
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
   * importStmt → "import" "{" IDENTIFIER ("," IDENTIFIER)* "}" "from" STRING NEWLINE
   *            | "import" STRING "as" IDENTIFIER NEWLINE
   *
   * The first form pulls specific exported names into scope directly.
   * The second loads a whole module as a namespace object.
   */
  _parseImport() {
    const kwToken = this._expect(TokenType.IMPORT);

    if (this._check(TokenType.LBRACE)) {
      this._advance();
      const specifiers = [];
      if (!this._check(TokenType.RBRACE)) {
        specifiers.push(this._expect(TokenType.IDENTIFIER).value);
        while (this._check(TokenType.COMMA)) {
          this._advance();
          specifiers.push(this._expect(TokenType.IDENTIFIER).value);
        }
      }
      this._expect(TokenType.RBRACE);
      this._expect(TokenType.FROM);
      const sourceToken = this._expect(TokenType.STRING);
      this._expectEndOfStatement();
      return ImportNode(specifiers, sourceToken.value, null, kwToken.line, kwToken.column);
    }

    const sourceToken = this._expect(TokenType.STRING);
    this._expect(TokenType.AS);
    const aliasToken = this._expect(TokenType.IDENTIFIER);
    this._expectEndOfStatement();
    return ImportNode(null, sourceToken.value, aliasToken.value, kwToken.line, kwToken.column);
  }

  /**
   * exportStmt → "export" ( letStmt | constStmt | taskStmt )
   * Marks whatever declaration follows as visible to importing modules.
   */
  _parseExport() {
    const kwToken = this._expect(TokenType.EXPORT);
    const next = this._peek();

    let declaration;
    if (next.type === TokenType.LET) declaration = this._parseLet();
    else if (next.type === TokenType.CONST) declaration = this._parseConst();
    else if (next.type === TokenType.TASK) declaration = this._parseTask();
    else {
      throw new SyntaxError(
        `Expected "let", "const", or "task" after "export" but found ` +
        `${next.type} ("${next.value}") at ${next.line}:${next.column}\n` +
        `Tip: you can only export variables, constants, and tasks — ` +
        `e.g. "export task greet(name) start ... end".`
      );
    }
    return ExportNode(declaration, kwToken.line, kwToken.column);
  }

  /**
   * exprStmt → expression NEWLINE
   * Used for statements that are just a function call made for its
   * side effects, e.g. `greet("world")` on its own line.
   */
  _parseExpressionStatement() {
    const token = this._peek();
    const expr  = this._parseExpression();
    this._expectEndOfStatement();
    return ExpressionStatementNode(expr, token.line, token.column);
  }

  // ── Expression parsing (recursive descent) ───────────────────────────────
  //
  // Precedence (lowest → highest):
  //   logicOr        → or
  //   logicAnd       → and
  //   logicNot       → not (prefix)
  //   equality       → == !=
  //   comparison     → > < >= <=
  //   additive       → + -
  //   multiplicative → * / %
  //   unary          → - (prefix)
  //   call           → f(...) / arr[...] / obj.prop (postfix, chainable)
  //   primary        → NUMBER | STRING | TRUE | FALSE | NOTHING | IDENTIFIER
  //                     | arrayLiteral | objectLiteral | anonymousTask
  //                     | "(" expression ")"

  _parseExpression() {
    return this._parseLogicOr();
  }

  /** logicOr → logicAnd ( "or" logicAnd )* */
  _parseLogicOr() {
    let left = this._parseLogicAnd();
    while (this._check(TokenType.OR)) {
      const opToken = this._advance();
      const right   = this._parseLogicAnd();
      left = LogicalExpressionNode("or", left, right, opToken.line, opToken.column);
    }
    return left;
  }

  /** logicAnd → logicNot ( "and" logicNot )* */
  _parseLogicAnd() {
    let left = this._parseLogicNot();
    while (this._check(TokenType.AND)) {
      const opToken = this._advance();
      const right   = this._parseLogicNot();
      left = LogicalExpressionNode("and", left, right, opToken.line, opToken.column);
    }
    return left;
  }

  /** logicNot → "not" logicNot | equality */
  _parseLogicNot() {
    if (this._check(TokenType.NOT)) {
      const opToken = this._advance();
      const operand = this._parseLogicNot();
      return UnaryExpressionNode("not", operand, opToken.line, opToken.column);
    }
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

  /** multiplicative → unary ( ( "*" | "/" | "%" ) unary )* */
  _parseMultiplicative() {
    let left = this._parseUnary();

    while (this._check(TokenType.STAR) || this._check(TokenType.SLASH) || this._check(TokenType.PERCENT)) {
      const opToken = this._advance();
      const right   = this._parseUnary();
      left = BinaryExpressionNode(opToken.value, left, right, opToken.line, opToken.column);
    }

    return left;
  }

  /** unary → "-" unary | call */
  _parseUnary() {
    if (this._check(TokenType.MINUS)) {
      const opToken = this._advance();
      const operand = this._parseUnary();
      return UnaryExpressionNode(opToken.value, operand, opToken.line, opToken.column);
    }
    return this._parseCall();
  }

  /**
   * call → primary ( "(" arguments? ")" | "[" expression "]" | "." IDENTIFIER )*
   *
   * After parsing a primary expression, greedily consume any number of
   * call `(...)`, index `[...]`, or member `.name` suffixes — this is what
   * makes `matrix[0][1]`, `user.address.city`, or `makeTask()()`-style
   * chaining work without any extra grammar rules elsewhere.
   */
  _parseCall() {
    let expr = this._parsePrimary();

    while (true) {
      if (this._check(TokenType.LPAREN)) {
        const opToken = this._advance(); // consume "("
        const args = [];
        if (!this._check(TokenType.RPAREN)) {
          args.push(this._parseExpression());
          while (this._check(TokenType.COMMA)) {
            this._advance();
            args.push(this._parseExpression());
          }
        }
        this._expect(TokenType.RPAREN);
        expr = CallNode(expr, args, opToken.line, opToken.column);
        continue;
      }

      if (this._check(TokenType.LBRACKET)) {
        const opToken = this._advance(); // consume "["
        const index = this._parseExpression();
        this._expect(TokenType.RBRACKET);
        expr = MemberExpressionNode(expr, index, true, opToken.line, opToken.column);
        continue;
      }

      if (this._check(TokenType.DOT)) {
        const opToken = this._advance(); // consume "."
        const propToken = this._expect(TokenType.IDENTIFIER);
        expr = MemberExpressionNode(expr, propToken.value, false, opToken.line, opToken.column);
        continue;
      }

      break;
    }

    return expr;
  }

  /**
   * primary → NUMBER | STRING | TRUE | FALSE | NOTHING | IDENTIFIER
   *           | arrayLiteral | objectLiteral | anonymousTask
   *           | "(" expression ")"
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

    if (token.type === TokenType.NOTHING) {
      this._advance();
      return NullLiteralNode(token.line, token.column);
    }

    if (token.type === TokenType.LPAREN) {
      this._advance(); // consume "("
      const expr = this._parseExpression();
      this._expect(TokenType.RPAREN);
      return expr;
    }

    if (token.type === TokenType.LBRACKET) {
      return this._parseArrayLiteral();
    }

    if (token.type === TokenType.LBRACE) {
      return this._parseObjectLiteral();
    }

    if (token.type === TokenType.TASK) {
      return this._parseAnonymousTask();
    }

    throw new SyntaxError(
      `Expected expression but found ${token.type} ("${token.value}") ` +
      `at ${token.line}:${token.column}`
    );
  }

  /** arrayLiteral → "[" ( expression ( "," expression )* )? "]" */
  _parseArrayLiteral() {
    const opToken = this._expect(TokenType.LBRACKET);
    const elements = [];

    if (!this._check(TokenType.RBRACKET)) {
      elements.push(this._parseExpression());
      while (this._check(TokenType.COMMA)) {
        this._advance();
        elements.push(this._parseExpression());
      }
    }

    this._expect(TokenType.RBRACKET);
    return ArrayLiteralNode(elements, opToken.line, opToken.column);
  }

  /**
   * objectLiteral → "{" ( objectEntry ( "," objectEntry )* )? "}"
   * objectEntry   → ( IDENTIFIER | STRING ) ":" expression
   * Newlines are tolerated between/around entries so multi-line object
   * literals read naturally.
   */
  _parseObjectLiteral() {
    const opToken = this._expect(TokenType.LBRACE);
    this._skipNewlines();
    const entries = [];

    if (!this._check(TokenType.RBRACE)) {
      entries.push(this._parseObjectEntry());
      this._skipNewlines();
      while (this._check(TokenType.COMMA)) {
        this._advance();
        this._skipNewlines();
        if (this._check(TokenType.RBRACE)) break; // tolerate a trailing comma
        entries.push(this._parseObjectEntry());
        this._skipNewlines();
      }
    }

    this._skipNewlines();
    this._expect(TokenType.RBRACE);
    return ObjectLiteralNode(entries, opToken.line, opToken.column);
  }

  _parseObjectEntry() {
    const keyToken = this._peek();
    let key;
    if (keyToken.type === TokenType.IDENTIFIER) {
      this._advance();
      key = keyToken.value;
    } else if (keyToken.type === TokenType.STRING) {
      this._advance();
      key = keyToken.value;
    } else {
      throw new SyntaxError(
        `Expected an object key (a name or text) but found ` +
        `${keyToken.type} ("${keyToken.value}") at ${keyToken.line}:${keyToken.column}\n` +
        `Tip: object keys look like { name: "Sai" } or { "full name": "Sai" }.`
      );
    }
    this._expect(TokenType.COLON);
    const value = this._parseExpression();
    return { key, value };
  }

  /** anonymousTask → "task" "(" parameters? ")" block */
  _parseAnonymousTask() {
    const kwToken = this._expect(TokenType.TASK);
    this._expect(TokenType.LPAREN);
    const params = this._parseParameterList();
    this._expect(TokenType.RPAREN);
    const body = this._parseBlock();
    return AnonymousTaskNode(params, body, kwToken.line, kwToken.column);
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
