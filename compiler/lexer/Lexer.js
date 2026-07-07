// Lexer.js
// First version of the SAIL lexer.

import { TokenType } from "./TokenType.js";
import { Token } from "./Token.js";

export class Lexer {
  constructor(source) {
    this.source = source;
  }

  tokenize() {
    const words = this.source.trim().split(/\s+/);
    const tokens = [];

    for (const word of words) {
      switch (word) {
        case "module":
          tokens.push(new Token(TokenType.MODULE, word, 1, 1));
          break;

        case "start":
          tokens.push(new Token(TokenType.START, word, 1, 1));
          break;

        case "end":
          tokens.push(new Token(TokenType.END, word, 1, 1));
          break;

        case "show":
          tokens.push(new Token(TokenType.SHOW, word, 1, 1));
          break;

        default:
          if (word.startsWith('"') && word.endsWith('"')) {
            tokens.push(
              new Token(
                TokenType.STRING,
                word.slice(1, -1),
                1,
                1
              )
            );
          } else {
            tokens.push(
              new Token(
                TokenType.IDENTIFIER,
                word,
                1,
                1
              )
            );
          }
      }
    }

    tokens.push(new Token(TokenType.EOF, "", 1, 1));

    return tokens;
  }
}
