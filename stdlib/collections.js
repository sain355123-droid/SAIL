// compiler/stdlib/collections.js
// Array and object utilities: length, keys, values, contains, push, pop,
// insert, remove, sort, reverse, join.

import { sailTypeOf, isSailObject } from "./typeUtils.js";

function requireArray(value, fnName, ctx) {
  if (!Array.isArray(value)) {
    ctx._runtimeError(
      `${fnName}() expects an array, but got ${sailTypeOf(value)}.\n` +
      `Tip: try ${fnName}([1, 2, 3]).`
    );
  }
}

export const collections = {
  // length(x) — number of elements in an array, or characters in a string
  length(args, ctx) {
    const [value] = args;
    if (typeof value === "string" || Array.isArray(value)) {
      return value.length;
    }
    ctx._runtimeError(
      `length() expects an array or text, but got ${sailTypeOf(value)}.\n` +
      `Tip: try length("hello") or length(myArray).`
    );
  },

  // keys(obj) — array of an object's own keys
  keys(args, ctx) {
    const [value] = args;
    if (!isSailObject(value)) {
      ctx._runtimeError(`keys() expects an object, but got ${sailTypeOf(value)}.`);
    }
    return Object.keys(value);
  },

  // values(obj) — array of an object's own values
  values(args, ctx) {
    const [value] = args;
    if (!isSailObject(value)) {
      ctx._runtimeError(`values() expects an object, but got ${sailTypeOf(value)}.`);
    }
    return Object.values(value);
  },

  // contains(collection, item) — element in array, substring in text, or key in object
  contains(args, ctx) {
    const [collection, item] = args;
    if (Array.isArray(collection)) {
      return collection.some((el) => ctx._valuesEqual(el, item));
    }
    if (typeof collection === "string") {
      return collection.includes(ctx._stringify(item));
    }
    if (isSailObject(collection)) {
      return Object.prototype.hasOwnProperty.call(collection, ctx._stringify(item));
    }
    ctx._runtimeError(
      `contains() expects an array, text, or object, but got ${sailTypeOf(collection)}.`
    );
  },

  // push(arr, value) — append in place, returns the new length
  push(args, ctx) {
    const [arr, value] = args;
    requireArray(arr, "push", ctx);
    arr.push(value);
    return arr.length;
  },

  // pop(arr) — remove and return the last element
  pop(args, ctx) {
    const [arr] = args;
    requireArray(arr, "pop", ctx);
    if (arr.length === 0) {
      ctx._runtimeError(`pop() can't remove from an empty array.`);
    }
    return arr.pop();
  },

  // insert(arr, index, value) — insert value at index, shifting later elements right
  insert(args, ctx) {
    const [arr, index, value] = args;
    requireArray(arr, "insert", ctx);
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > arr.length) {
      ctx._runtimeError(
        `insert() needs a whole-number index from 0 to ${arr.length}, but got ${index}.`
      );
    }
    arr.splice(index, 0, value);
    return arr;
  },

  // remove(arr, index) — remove and return the element at index
  remove(args, ctx) {
    const [arr, index] = args;
    requireArray(arr, "remove", ctx);
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= arr.length) {
      ctx._runtimeError(
        `remove() needs a whole-number index from 0 to ${arr.length - 1}, but got ${index}.`
      );
    }
    return arr.splice(index, 1)[0];
  },

  // sort(arr, compareTask?) — sort in place, ascending by default
  sort(args, ctx) {
    const [arr, compareTask] = args;
    requireArray(arr, "sort", ctx);
    if (compareTask !== undefined) {
      if (!compareTask || !compareTask.__isTask) {
        ctx._runtimeError(`sort()'s second argument must be a task, but got ${sailTypeOf(compareTask)}.`);
      }
      arr.sort((a, b) => ctx._callTask(compareTask, [a, b], null));
      return arr;
    }
    arr.sort((a, b) => {
      if (typeof a === "number" && typeof b === "number") return a - b;
      const sa = ctx._stringify(a), sb = ctx._stringify(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
    return arr;
  },

  // reverse(arr) — reverse in place
  reverse(args, ctx) {
    const [arr] = args;
    requireArray(arr, "reverse", ctx);
    arr.reverse();
    return arr;
  },

  // join(arr, separator = ",") — combine array elements into text
  join(args, ctx) {
    const [arr, separator] = args;
    requireArray(arr, "join", ctx);
    const sep = separator === undefined ? "," : ctx._stringify(separator);
    return arr.map((el) => ctx._stringify(el)).join(sep);
  },
};
