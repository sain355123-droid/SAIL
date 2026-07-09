// compiler/runtime/Environment.js
// SAIL Environment v1.0
//
// A variable scope with an optional parent, forming a chain from any inner
// scope back up to the global one. SAIL only creates a *new* Environment
// when a task (function) is called — if/while/for bodies keep sharing the
// scope they were already in. That is why `let count = count + 1` inside a
// while-loop body has always updated the same `count` from outside the
// loop: there was never a second scope for the loop body to shadow it in,
// and that stays true now that tasks exist too.
//
// v1.0 adds `const` support: a name declared with `const` is remembered in
// a per-scope set, and any later attempt to rebind that exact name (via
// either `let` or `const`) is rejected — but the *contents* of an array or
// object stored in a const are still free to change, matching the mental
// model most people already have from other languages.

export class Environment {
  /**
   * @param {Environment|null} parent - Enclosing scope, or null for the
   *   global/root environment.
   */
  constructor(parent = null) {
    this._parent    = parent;
    this._vars       = new Map();
    this._constants   = new Set(); // names declared with `const`, in this scope
  }

  /** Define a brand-new variable in *this* scope, shadowing any outer one. */
  define(name, value) {
    this._vars.set(name, value);
  }

  /** Define a brand-new constant in *this* scope. */
  defineConst(name, value) {
    this._vars.set(name, value);
    this._constants.add(name);
  }

  /** True if `name` is visible from this scope (this scope or any ancestor). */
  has(name) {
    if (this._vars.has(name)) return true;
    return this._parent !== null ? this._parent.has(name) : false;
  }

  /** Look up a variable's value, searching outward through parent scopes. */
  get(name) {
    if (this._vars.has(name)) return this._vars.get(name);
    if (this._parent !== null) return this._parent.get(name);
    throw new ReferenceError(`Undefined variable "${name}"`);
  }

  /**
   * Find which scope (this one or an ancestor) owns `name`, or null if it
   * isn't declared anywhere in the chain. Used to check const-ness before
   * allowing a reassignment.
   */
  _findOwner(name) {
    let env = this;
    while (env !== null) {
      if (env._vars.has(name)) return env;
      env = env._parent;
    }
    return null;
  }

  /** True if `name` was declared with `const` anywhere in the scope chain. */
  isConstant(name) {
    const owner = this._findOwner(name);
    return owner !== null && owner._constants.has(name);
  }

  /**
   * SAIL's `let` doubles as both "declare" and "reassign". This method
   * captures that: if `name` already exists somewhere in the scope chain,
   * update it there (so loops and tasks can mutate outer variables the way
   * they always could). Otherwise, define it fresh in *this* scope.
   *
   * Throws if `name` was declared with `const` — rebinding a constant is
   * always rejected, regardless of which scope the attempt comes from.
   */
  assignOrDefine(name, value) {
    const owner = this._findOwner(name);
    if (owner !== null) {
      if (owner._constants.has(name)) {
        throw new TypeError(
          `"${name}" is a constant and can't be reassigned.\n` +
          `Tip: use "let ${name} = ..." instead of "const" if you need to ` +
          `change it later, or pick a new name for this value.`
        );
      }
      owner._vars.set(name, value);
      return;
    }
    this._vars.set(name, value);
  }
}
