// compiler/stdlib/index.js
// SAIL Standard Library v1.0
//
// Combines every stdlib module into one lookup table. Kept separate from
// the core interpreter so it's easy to extend — add a function to the
// relevant module (or a new module) and re-export it here.
//
// Every entry is `name: (args, ctx) => value`, where `ctx` is the
// Interpreter instance (used for producing friendly, positioned errors,
// stringifying values consistently, and — for sort()'s comparator — calling
// back into user-defined tasks).
//
// Looked up only when a called name isn't a user-defined task, so a
// program can freely define its own `task length(x) ... end` and it will
// shadow the built-in — SAIL never gets in the programmer's way.

import { core }        from "./core.js";
import { collections } from "./collections.js";
import { strings }     from "./strings.js";
import { io }           from "./io.js";

export { sailTypeOf, isSailObject } from "./typeUtils.js";

export const Stdlib = {
  ...core,
  ...collections,
  ...strings,
  ...io,
};
