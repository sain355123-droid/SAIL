export const TokenType = {
  // Keywords
  MODULE:     "MODULE",
  START:      "START",
  END:        "END",
  SHOW:       "SHOW",
  LET:        "LET",
  IF:         "IF",
  ELSE:       "ELSE",
  WHILE:      "WHILE",
  TRUE:       "TRUE",
  FALSE:      "FALSE",

  // Literals and identifiers
  IDENTIFIER: "IDENTIFIER",
  STRING:     "STRING",
  NUMBER:     "NUMBER",

  // Arithmetic operators
  PLUS:       "+",
  MINUS:      "-",
  STAR:       "*",
  SLASH:      "/",

  // Assignment
  ASSIGN:     "=",

  // Comparison operators
  EQ:         "==",
  NEQ:        "!=",
  GT:         ">",
  LT:         "<",
  GTE:        ">=",
  LTE:        "<=",

  // Grouping
  LPAREN:     "(",
  RPAREN:     ")",

  // Structure
  NEWLINE:    "NEWLINE",
  EOF:        "EOF",
};
