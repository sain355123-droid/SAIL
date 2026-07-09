// compiler/stdlib/typeUtils.js
// Shared type helpers used throughout the interpreter and standard library.

/** SAIL's own name for a value's type — used by type() and in error messages. */
export function sailTypeOf(value) {
  if (value === null || value === undefined) return "nothing";
  if (Array.isArray(value)) return "array";
  if (value && value.__isTask) return "task";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "text";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  return "unknown";
}

/** True for SAIL's plain-object values (not arrays, not tasks, not null). */
export function isSailObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !value.__isTask
  );
}
