// compiler/lexer/Lexer.js
// SAIL Lexer v1.0
//
// Reads source one character at a time. No split().
// Tracks line and column numbers from the first character.
// Line numbers start at 1; column numbers start at 1.
// Column resets to 1 after every newline.

import { Token }     from "./Token.js";
import { TokenType } from "./TokenType.js";

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

  // v0.5 — loops, functions, logic
  for:      TokenType.FOR,
  in:       TokenType.IN,
  to:       TokenType.TO,
  step:     TokenType.STEP,
  break:    TokenType.BREAK,
  continue: TokenType.CONTINUE,
  task:     TokenType.TASK,
  return:   TokenType.RETURN,
  and:      TokenType.AND,
  or:       TokenType.OR,
  not:      TokenType.NOT,

  // v1.0 — constants, null, objects, foreach, modules
  const:    TokenType.CONST,
  nothing:  TokenType.NOTHING,
  foreach:  TokenType.FOREACH,
  import:   TokenType.IMPORT,
  export:   TokenType.EXPORT,
  from:     TokenType.FROM,
  as:       TokenType.AS,
};

// Unambiguous single-character tokens (no two-character form exists for these).
const SINGLE_CHAR = {
  "+": TokenType.PLUS,
  "-": TokenType.MINUS,
  "*": TokenType.STAR,
  "%": TokenType.PERCENT,
  "(": TokenType.LPAREN,
  ")": TokenType.RPAREN,
  "[": TokenType.LBRACKET,
  "]": TokenType.RBRACKET,
  "{": TokenType.LBRACE,
  "}": TokenType.RBRACE,
  ",": TokenType.COMMA,
  ".": TokenType.DOT,
  ":": TokenType.COLON,
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
   *  Supports simple backslash escapes: \" \\ \n \t
   *  Throws a descriptive error on unterminated strings.
   */
  _readString(startLine, startCol) {
    let value = "";
    while (true) {
      const ch = this._peek();
      if (ch === null || ch === "\n") {
        throw new SyntaxError(
          `Unterminated string starting at ${startLine}:${startCol}\n` +
          `Tip: make sure the string has a closing " on the same line.`
        );
      }
      if (ch === '"') {
        this._advance(); // consume closing quote
        break;
      }
      if (ch === "\\") {
        this._advance(); // consume backslash
        const esc = this._peek();
        if (esc === "n")      { value += "\n"; this._advance(); }
        else if (esc === "t") { value += "\t"; this._advance(); }
        else if (esc === '"') { value += '"';  this._advance(); }
        else if (esc === "\\"){ value += "\\"; this._advance(); }
        else {
          // Unknown escape — keep the backslash literally rather than fail;
          // SAIL prefers to recover automatically from small mistakes.
          value += "\\";
        }
        continue;
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

      // ── Newline ────────────────────────────────────────────────────────────
      if (ch === "\n") {
        this._advance();
        tokens.push(new Token(TokenType.NEWLINE, "\\n", tokLine, tokCol));
        continue;
      }

      // ── Semicolons aren't part of SAIL — friendly redirect instead of a
      //    confusing "unexpected character" error, since most beginners will
      //    type one out of habit from other languages. ────────────────────
      if (ch === ";") {
        throw new SyntaxError(
          `Unexpected ";" at ${tokLine}:${tokCol}\n` +
          `Tip: SAIL doesn't use semicolons — just start a new line instead.`
        );
      }

      // ── Comment ────────────────────────────────────────────────────────────
      // "//" starts a comment that runs to the end of the line. The newline
      // itself is NOT consumed here — it falls through to the normal newline
      // handling above on the next loop iteration, so statement termination
      // still works exactly the same with or without a trailing comment.
      if (ch === "/" && this._source[this._pos + 1] === "/") {
        while (this._peek() !== null && this._peek() !== "\n") {
          this._advance();
        }
        continue;
      }

      // ── Division operator ─────────────────────────────────────────────────
      if (ch === "/") {
        this._advance();
        tokens.push(new Token(TokenType.SLASH, "/", tokLine, tokCol));
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
        throw new SyntaxError(
          `Unexpected character '!' at ${tokLine}:${tokCol}\n` +
          `Tip: SAIL uses the word "not" instead of "!" — try "not <condition>".`
        );
      }

      // ── Single-character tokens ────────────────────────────────────────────
      if (Object.prototype.hasOwnProperty.call(SINGLE_CHAR, ch)) {
        this._advance();
        tokens.push(new Token(SINGLE_CHAR[ch], ch, tokLine, tokCol));
        continue;
      }

      // ── Unknown character ──────────────────────────────────────────────────
      throw new SyntaxError(
        `Unexpected character '${ch}' at ${tokLine}:${tokCol}\n` +
        `Tip: check for a stray or non-English character — SAIL doesn't ` +
        `recognise "${ch}" as part of any keyword or operator.`
      );
    }

    return tokens;
  }
}
