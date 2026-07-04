import fs from "fs";
import { Lexer } from "./lexer/Lexer.js";

const source = fs.readFileSync("examples/hello.sai", "utf8");

const lexer = new Lexer(source);

const tokens = lexer.tokenize();

console.log(tokens);
