// compiler/stdlib/core.js
// Core conversion and introspection functions: type(), number(), text().

import { sailTypeOf } from "./typeUtils.js";

export const core = {
  // type(x) — "number" | "text" | "boolean" | "array" | "object" | "task" | "nothing"
  type(args) {
    const [value] = args;
    return sailTypeOf(value);
  },

  // number(x) — convert text/boolean to a number
  number(args, ctx) {
    const [value] = args;
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "string") {
      const n = Number(value.trim());
      if (Number.isNaN(n)) {
        ctx._runtimeError(
          `number() couldn't turn "${value}" into a number.\n` +
          `Tip: make sure the text only contains digits, like "42" or "3.14".`
        );
      }
      return n;
    }
    ctx._runtimeError(`number() can't convert ${sailTypeOf(value)} to a number.`);
  },

  // text(x) — convert any value to its text representation
  text(args, ctx) {
    const [value] = args;
    return ctx._stringify(value);
  },
};
