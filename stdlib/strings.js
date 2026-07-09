// compiler/stdlib/strings.js
// Text utilities: split, trim, upper, lower, replace, substring.

import { sailTypeOf } from "./typeUtils.js";

function requireText(value, fnName, ctx) {
  if (typeof value !== "string") {
    ctx._runtimeError(
      `${fnName}() expects text, but got ${sailTypeOf(value)}.\n` +
      `Tip: try ${fnName}("some text").`
    );
  }
}

export const strings = {
  // split(text, separator) — break text into an array
  split(args, ctx) {
    const [text, separator] = args;
    requireText(text, "split", ctx);
    const sep = separator === undefined ? "" : ctx._stringify(separator);
    return text.split(sep);
  },

  // trim(text) — remove leading/trailing whitespace
  trim(args, ctx) {
    const [text] = args;
    requireText(text, "trim", ctx);
    return text.trim();
  },

  // upper(text) — uppercase
  upper(args, ctx) {
    const [text] = args;
    requireText(text, "upper", ctx);
    return text.toUpperCase();
  },

  // lower(text) — lowercase
  lower(args, ctx) {
    const [text] = args;
    requireText(text, "lower", ctx);
    return text.toLowerCase();
  },

  // replace(text, search, replacement) — replace all occurrences of search
  replace(args, ctx) {
    const [text, search, replacement] = args;
    requireText(text, "replace", ctx);
    const searchText = ctx._stringify(search);
    const replacementText = ctx._stringify(replacement);
    return text.split(searchText).join(replacementText);
  },

  // substring(text, start, end?) — extract a portion of text
  substring(args, ctx) {
    const [text, start, end] = args;
    requireText(text, "substring", ctx);
    if (typeof start !== "number" || !Number.isInteger(start)) {
      ctx._runtimeError(`substring()'s start index must be a whole number, but got ${sailTypeOf(start)}.`);
    }
    if (end !== undefined && (typeof end !== "number" || !Number.isInteger(end))) {
      ctx._runtimeError(`substring()'s end index must be a whole number, but got ${sailTypeOf(end)}.`);
    }
    return text.substring(start, end === undefined ? text.length : end);
  },
};
