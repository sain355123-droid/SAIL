// compiler/lexer/Lexer.js
// SAIL Lexer v0.0.3
//
// Reads source one character at a time. No split().
// Tracks line and column numbers from the first character.
// Line numbers start at 1; column numbers start at 1.
// Column resets to 1 after every newline.

import { Token }     from "./Token.js";
import { TokenType } from "./TokenType.js";
import { SailError } from "../errors/SailError.js";

// Keywords recognised by SAIL. All other alphabetic sequences are IDENTIFIER.
const KEYWORDS = {
  module:   TokenType.MODULE,
  start:    TokenType.START,
  end:      TokenType.END,
  show:     TokenType.SHOW,
  let:      TokenType.LET,
  if:       TokenType.IF,
  else:     TokenType.ELSE,
  while:    TokenType.WHILE,
  true:     TokenType.TRUE,
  false:    TokenType.FALSE,

  // v0.5
  for:      TokenType.FOR,
  in:       TokenType.IN,
  break:    TokenType.BREAK,
  continue: TokenType.CONTINUE,
  task:     TokenType.TASK,
  return:   TokenType.RETURN,
  and:      TokenType.AND,
  or:       TokenType.OR,
  not:      TokenType.NOT,
};

// Unambiguous single-character tokens (no two-character form exists for these).
const SINGLE_CHAR = {
  "+": TokenType.PLUS,
  "-": TokenType.MINUS,
  "*": TokenType.STAR,
  "/": TokenType.SLASH,
  "(": TokenType.LPAREN,
  ")": TokenType.RPAREN,
  "[": TokenType.LBRACKET,
  "]": TokenType.RBRACKET,
  ",": TokenType.COMMA,
};

export class Lexer {
  /**
   * @param {string} source - The complete SAIL source text to lex.
   */
  constructor(source) {
    this._source = source;
    this._pos    = 0;        // current index into source
    this._line   = 1;        // current line (1-based)
    this._col    = 1;        // current column (1-based)
  }

  // ── Character-level primitives ─────────────────────────────────────────────

  /** Return the character at the current position, or null at end-of-source. */
  _peek() {
    return this._pos < this._source.length ? this._source[this._pos] : null;
  }

  /**
   * Consume and return the current character, advancing position and
   * updating line/column tracking.
   */
  _advance() {
    const ch = this._source[this._pos];
    this._pos++;
    if (ch === "\n") {
      this._line++;
      this._col = 1;
    } else {
      this._col++;
    }
    return ch;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _isAlpha(ch) {
    return ch !== null && /[a-zA-Z_]/.test(ch);
  }

  _isAlphaNumeric(ch) {
    return ch !== null && /[a-zA-Z0-9_]/.test(ch);
  }

  _isDigit(ch) {
    return ch !== null && ch >= "0" && ch <= "9";
  }

  _isWhitespaceNonNewline(ch) {
    return ch === " " || ch === "\t" || ch === "\r";
  }

  // ── Token scanners ─────────────────────────────────────────────────────────

  /** Consume a quoted string. Opening quote has already been consumed.
   *  Returns a STRING token whose value is the content between the quotes.
   *  Throws a descriptive error on unterminated strings.
   */
  _readString(startLine, startCol) {
    let value = "";
    while (true) {
      const ch = this._peek();
      if (ch === null) {
        throw new SailError("Lex", "Unterminated string", {
          line: startLine,
          column: startCol,
          hint: `Every string needs a closing " — check the string that starts here.`,
        });
      }
      if (ch === '"') {
        this._advance(); // consume closing quote
        break;
      }
      value += this._advance();
    }
    return new Token(TokenType.STRING, value, startLine, startCol);
  }

  /** Consume a sequence of digits (and an optional decimal point).
   *  Opening digit has NOT yet been consumed.
   */
  _readNumber(startLine, startCol) {
    let value = "";
    while (this._isDigit(this._peek())) {
      value += this._advance();
    }
    // Decimal part
    if (this._peek() === "." && this._isDigit(this._source[this._pos + 1])) {
      value += this._advance(); // consume "."
      while (this._isDigit(this._peek())) {
        value += this._advance();
      }
    }
    return new Token(TokenType.NUMBER, value, startLine, startCol);
  }

  /** Consume a keyword or identifier.
   *  Opening alpha character has NOT yet been consumed.
   */
  _readWord(startLine, startCol) {
    let value = "";
    while (this._isAlphaNumeric(this._peek())) {
      value += this._advance();
    }
    // Check against keyword table; fall back to IDENTIFIER
    const type = Object.prototype.hasOwnProperty.call(KEYWORDS, value)
      ? KEYWORDS[value]
      : TokenType.IDENTIFIER;
    return new Token(type, value, startLine, startCol);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Tokenise the entire source and return an array of Token objects.
   * The last token in the array is always EOF.
   *
   * @returns {Token[]}
   */
  tokenize() {
    const tokens = [];

    while (true) {
      // Skip horizontal whitespace (spaces, tabs, carriage returns).
      // Newlines are significant — they become NEWLINE tokens.
      while (this._isWhitespaceNonNewline(this._peek())) {
        this._advance();
      }

      const ch = this._peek();

      // ── End of source ──────────────────────────────────────────────────────
      if (ch === null) {
        tokens.push(new Token(TokenType.EOF, "", this._line, this._col));
        break;
      }

      // Capture the token's start position before consuming any characters
      const tokLine = this._line;
      const tokCol  = this._col;

      // ── Comments ───────────────────────────────────────────────────────────
      // "//" runs to (but does not consume) the end of the line, so the
      // following newline is still emitted as a normal NEWLINE token.
      if (ch === "/" && this._source[this._pos + 1] === "/") {
        while (this._peek() !== null && this._peek() !== "\n") {
          this._advance();
        }
        continue;
      }

      // ── Newline ────────────────────────────────────────────────────────────
      if (ch === "\n") {
        this._advance();
        tokens.push(new Token(TokenType.NEWLINE, "\\n", tokLine, tokCol));
        continue;
      }

      // ── Quoted string ──────────────────────────────────────────────────────
      if (ch === '"') {
        this._advance(); // consume opening quote
        tokens.push(this._readString(tokLine, tokCol));
        continue;
      }

      // ── Number ─────────────────────────────────────────────────────────────
      if (this._isDigit(ch)) {
        tokens.push(this._readNumber(tokLine, tokCol));
        continue;
      }

      // ── Keyword or identifier ──────────────────────────────────────────────
      if (this._isAlpha(ch)) {
        tokens.push(this._readWord(tokLine, tokCol));
        continue;
      }

      // ── Operators (one or two characters) ─────────────────────────────────
      // Each of these characters may begin a two-character token, so we peek
      // at the next character before deciding which token to emit.
      if (ch === "=" || ch === "!" || ch === ">" || ch === "<") {
        this._advance();
        const next = this._peek();

        if (ch === "=" && next === "=") { this._advance(); tokens.push(new Token(TokenType.EQ,     "==", tokLine, tokCol)); continue; }
        if (ch === "!" && next === "=") { this._advance(); tokens.push(new Token(TokenType.NEQ,    "!=", tokLine, tokCol)); continue; }
        if (ch === ">" && next === "=") { this._advance(); tokens.push(new Token(TokenType.GTE,    ">=", tokLine, tokCol)); continue; }
        if (ch === "<" && next === "=") { this._advance(); tokens.push(new Token(TokenType.LTE,    "<=", tokLine, tokCol)); continue; }

        // Single-character fallbacks
        if (ch === "=") { tokens.push(new Token(TokenType.ASSIGN, "=",  tokLine, tokCol)); continue; }
        if (ch === ">") { tokens.push(new Token(TokenType.GT,     ">",  tokLine, tokCol)); continue; }
        if (ch === "<") { tokens.push(new Token(TokenType.LT,     "<",  tokLine, tokCol)); continue; }

        // "!" alone is not valid in SAIL
        throw new SailError("Lex", "Unexpected character '!'", {
          line: tokLine,
          column: tokCol,
          hint: `Did you mean "!=" (not equal)? A lone "!" isn't a SAIL operator — use "not" for logical negation.`,
        });
      }

      // ── Range operator (..) ──────────────────────────────────────────────
      if (ch === "." && this._source[this._pos + 1] === ".") {
        this._advance();
        this._advance();
        tokens.push(new Token(TokenType.DOTDOT, "..", tokLine, tokCol));
        continue;
      }

      // ── Single-character tokens ────────────────────────────────────────────
      if (Object.prototype.hasOwnProperty.call(SINGLE_CHAR, ch)) {
        this._advance();
        tokens.push(new Token(SINGLE_CHAR[ch], ch, tokLine, tokCol));
        continue;
      }

      // ── Unknown character ──────────────────────────────────────────────────
      throw new SailError("Lex", `Unexpected character '${ch}'`, {
        line: tokLine,
        column: tokCol,
        hint: ch === "."
          ? `A single "." isn't valid SAIL syntax — did you mean ".." for a range (e.g. "0..5")?`
          : undefined,
      });
    }

    return tokens;
  }
}
