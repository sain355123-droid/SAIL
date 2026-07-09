// compiler/runtime/ModuleSystem.js
// SAIL Module System v1.0
//
// Resolves and loads imported .sai files, synchronously, with a cache so
// a module imported from several places is only read/parsed/executed once
// — its exports are simply reused after the first load. Also detects
// circular imports (module A imports B which imports A) and reports them
// as a friendly error rather than recursing forever.
//
// The Interpreter class is injected rather than imported directly, to
// avoid a circular ES-module import between Interpreter.js and this file
// (Interpreter needs to trigger loads; loads need to construct Interpreters).

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

import { Lexer }  from "../lexer/Lexer.js";
import { Parser } from "../parser/Parser.js";

export class ModuleSystem {
  /**
   * @param {typeof import("../interpreter/Interpreter.js").Interpreter} InterpreterClass
   */
  constructor(InterpreterClass) {
    this._Interpreter = InterpreterClass;
    this._cache = new Map(); // absolutePath -> { loading: bool, exports: object }
  }

  /**
   * Turn an import source string like "./utils" or "./lib/math.sai" into
   * an absolute file path, relative to the file doing the importing.
   * @param {string|null} fromFilePath - Absolute path of the importing file,
   *   or null if the import is happening outside any file (e.g. the REPL).
   * @param {string} importSource
   */
  resolve(fromFilePath, importSource) {
    const baseDir = fromFilePath ? dirname(fromFilePath) : process.cwd();
    let resolved = resolve(baseDir, importSource);
    if (!resolved.endsWith(".sai")) {
      resolved += ".sai";
    }
    return resolved;
  }

  /**
   * Load a module (from cache if possible) and return its exports object
   * (a plain JS object mapping exported name -> value).
   * @param {string} resolvedPath - Absolute path, as produced by resolve().
   */
  load(resolvedPath) {
    const cached = this._cache.get(resolvedPath);
    if (cached) {
      if (cached.loading) {
        throw new Error(
          `Circular import detected: "${resolvedPath}" is still loading ` +
          `when something it imports (directly or indirectly) tries to ` +
          `import it again.\n` +
          `Tip: two modules can't depend on each other's exports at load ` +
          `time — restructure so one of them doesn't need to import the other.`
        );
      }
      return cached.exports;
    }

    if (!existsSync(resolvedPath)) {
      throw new Error(
        `Couldn't find the module "${resolvedPath}".\n` +
        `Tip: check the path is correct and the file ends in .sai.`
      );
    }

    this._cache.set(resolvedPath, { loading: true, exports: {} });

    const source = readFileSync(resolvedPath, "utf8");
    const tokens = new Lexer(source).tokenize();
    const ast    = new Parser(tokens).parse();

    const interpreter = new this._Interpreter(ast, {
      filePath:     resolvedPath,
      moduleSystem: this,
    });
    interpreter.run();

    const exportsObject = interpreter.getExports();
    this._cache.set(resolvedPath, { loading: false, exports: exportsObject });
    return exportsObject;
  }
}
