// Token.js
// Represents a single token produced by the lexer.

export class Token {
  constructor(type, value, line, column) {
    this.type = type;
    this.value = value;
    this.line = line;
    this.column = column;
  }

  toString() {
    return `${this.type}(${this.value}) at ${this.line}:${this.column}`;
  }
}
