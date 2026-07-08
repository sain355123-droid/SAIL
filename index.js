// compiler/index.js

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname }  from "path";

import { Lexer }       from "./lexer/Lexer.js";
import { Parser }      from "./parser/Parser.js";
import { Interpreter } from "./interpreter/Interpreter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Usage: node index.js [example-file]   (defaults to hello.sai)
const exampleFile = process.argv[2] || "hello.sai";
const source = readFileSync(join(__dirname, "examples", exampleFile), "utf8");

const tokens = new Lexer(source).tokenize();
const ast    = new Parser(tokens).parse();

new Interpreter(ast).run();
