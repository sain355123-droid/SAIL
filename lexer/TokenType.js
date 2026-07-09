export const TokenType = {
  // Keywords — core (v0.0.x)
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

  // Keywords — v0.5 (loops, functions, logic)
  FOR:        "FOR",
  IN:         "IN",
  TO:         "TO",
  STEP:       "STEP",
  BREAK:      "BREAK",
  CONTINUE:   "CONTINUE",
  TASK:       "TASK",
  RETURN:     "RETURN",
  AND:        "AND",
  OR:         "OR",
  NOT:        "NOT",

  // Keywords — v1.0 (constants, null, objects, foreach, modules)
  CONST:      "CONST",
  NOTHING:    "NOTHING",   // the null literal
  FOREACH:    "FOREACH",
  IMPORT:     "IMPORT",
  EXPORT:     "EXPORT",
  FROM:       "FROM",
  AS:         "AS",

  // Literals and identifiers
  IDENTIFIER: "IDENTIFIER",
  STRING:     "STRING",
  NUMBER:     "NUMBER",

  // Arithmetic operators
  PLUS:       "+",
  MINUS:      "-",
  STAR:       "*",
  SLASH:      "/",
  PERCENT:    "%",

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
  LBRACKET:   "[",
  RBRACKET:   "]",
  LBRACE:     "{",
  RBRACE:     "}",

  // Separators / member access
  COMMA:      ",",
  DOT:        ".",
  COLON:      ":",

  // Structure
  NEWLINE:    "NEWLINE",
  EOF:        "EOF",
};
