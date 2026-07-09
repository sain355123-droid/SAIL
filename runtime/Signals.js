// compiler/runtime/Signals.js
// SAIL Control-Flow Signals v1.0
//
// `break`, `continue`, and `return` all need to unwind out of however many
// nested statements/blocks they're inside, straight to the loop or task
// that should handle them. The simplest correct way to do that in a
// tree-walking interpreter is to throw a small signal object and catch it
// exactly where it belongs — the for/while loop executors catch Break and
// Continue, and the task-call executor catches Return.
//
// These are NOT user-facing errors. They never reach _runtimeError or the
// top-level error handler in normal programs — _executeFor/_executeWhile
// and _callTask always catch them internally.

export class BreakSignal {}

export class ContinueSignal {}

export class ReturnSignal {
  constructor(value) {
    this.value = value;
  }
}
