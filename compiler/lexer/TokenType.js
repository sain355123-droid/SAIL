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

  // v0.5 keywords — loops & flow control
  FOR:        "FOR",
  IN:         "IN",
  BREAK:      "BREAK",
  CONTINUE:   "CONTINUE",

  // v0.5 keywords — functions
  TASK:       "TASK",
  RETURN:     "RETURN",

  // v0.5 keywords — logical operators
  AND:        "AND",
  OR:         "OR",
  NOT:        "NOT",

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

  // v0.5 grouping/structure — arrays, function params, ranges
  LBRACKET:   "[",
  RBRACKET:   "]",
  COMMA:      ",",
  DOTDOT:     "..",

  // Structure
  NEWLINE:    "NEWLINE",
  EOF:        "EOF",
};
