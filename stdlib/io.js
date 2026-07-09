// compiler/stdlib/io.js
// Input/output and system utilities: print, input, random, time, clock,
// sleep, exit.

import { readSync } from "fs";
import { sailTypeOf } from "./typeUtils.js";

// Captured once, the first time this module is loaded, so clock() measures
// elapsed time since the program started rather than since the epoch.
const PROGRAM_START_MS = Date.now();

/** Read one line from stdin, synchronously, without any external package. */
function readLineSync() {
  const buf = Buffer.alloc(1);
  let line = "";
  while (true) {
    let bytesRead;
    try {
      bytesRead = readSync(0, buf, 0, 1, null);
    } catch (err) {
      // EOF (e.g. stdin closed/redirected from an empty source) — stop reading.
      if (err.code === "EAGAIN" || err.code === "EOF") break;
      throw err;
    }
    if (bytesRead === 0) break; // end of input
    const ch = buf.toString("utf8");
    if (ch === "\n") break;
    if (ch !== "\r") line += ch;
  }
  return line;
}

/** Block synchronously for `ms` milliseconds, without any external package. */
function sleepSyncMs(ms) {
  const sab = new SharedArrayBuffer(4);
  const int32 = new Int32Array(sab);
  Atomics.wait(int32, 0, 0, ms);
}

export const io = {
  // print(x) — like show, but usable as an expression/function call
  print(args, ctx) {
    const [value] = args;
    console.log(ctx._stringify(value));
    return null;
  },

  // input(prompt?) — print an optional prompt, then read a line from the user
  input(args) {
    const [prompt] = args;
    if (prompt !== undefined) {
      process.stdout.write(String(prompt));
    }
    return readLineSync();
  },

  // random() -> float in [0, 1)
  // random(max) -> integer in [0, max]
  // random(min, max) -> integer in [min, max]
  random(args, ctx) {
    if (args.length === 0) return Math.random();

    if (args.length === 1) {
      const [max] = args;
      if (typeof max !== "number") {
        ctx._runtimeError(`random() expects numbers, but got ${sailTypeOf(max)}.`);
      }
      return Math.floor(Math.random() * (max + 1));
    }

    const [min, max] = args;
    if (typeof min !== "number" || typeof max !== "number") {
      ctx._runtimeError(`random() expects numbers, but got ${sailTypeOf(min)} and ${sailTypeOf(max)}.`);
    }
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  // time() — seconds since the Unix epoch (fractional)
  time() {
    return Date.now() / 1000;
  },

  // clock() — seconds since the program started (a simple stopwatch)
  clock() {
    return (Date.now() - PROGRAM_START_MS) / 1000;
  },

  // sleep(seconds) — pause execution
  sleep(args, ctx) {
    const [seconds] = args;
    if (typeof seconds !== "number" || seconds < 0) {
      ctx._runtimeError(`sleep() expects a non-negative number of seconds, but got ${sailTypeOf(seconds)}.`);
    }
    sleepSyncMs(seconds * 1000);
    return null;
  },

  // exit(code?) — stop the program immediately
  exit(args) {
    const [code] = args;
    process.exit(typeof code === "number" ? code : 0);
  },
};
