# SAIL

SAIL is a small, readable scripting language with a hand-written lexer,
recursive-descent parser, and tree-walking interpreter — implemented in
plain JavaScript (ES modules), no external dependencies.

**Founder:** Kalangiri Sainath

## Project layout

```
compiler/
  lexer/
    Token.js            # Token value object
    TokenType.js        # Token type constants
    Lexer.js            # Source text → token stream (incl. // comments)
  parser/
    Parser.js           # Token stream → AST (recursive descent)
  interpreter/
    Interpreter.js       # Tree-walking evaluator for the AST
    stdlib.js            # Standard library (length, input, random, ...)
  errors/
    SailError.js         # Shared error type + "did you mean...?" suggestions
  examples/
    hello.sai             # Minimal example: let + show + arithmetic
    control_flow.sai      # if / else, while, comparisons, booleans
    loops_and_arrays.sai  # for, break, continue, arrays, logical ops
    tasks.sai             # task (functions), return, recursion
    stdlib.sai            # standard library functions
    input_demo.sai        # reading from stdin with input()
  index.js              # Entry point — runs an example file
```

## Running

```
node compiler/index.js                    # runs examples/hello.sai
node compiler/index.js control_flow.sai   # runs any file in examples/
node compiler/index.js loops_and_arrays.sai
node compiler/index.js tasks.sai
echo "Alice" | node compiler/index.js input_demo.sai
```

## Language features (v0.5)

- `module <n>` / `start` ... `end` block structure
- `let <n> = <expression>` — variable assignment / reassignment
- `let <n>[<index>] = <expression>` — array element assignment (or append,
  if `<index>` equals the array's current length)
- `show <expression>` — print to stdout
- `// comment` — runs to the end of the line, anywhere in a line
- Arithmetic: `+ - * /`, unary `-`, and parenthesised grouping
- Booleans: `true`, `false`
- Comparisons: `== != > < >= <=`
- Logical operators: `and`, `or`, `not` (short-circuiting)
- Arrays: `[1, 2, 3]` literals, `arr[i]` indexing (also works on strings),
  `+` concatenates two arrays, `length(arr)` for size
- Control flow:
  - `if <condition> start ... end`
  - `if <condition> start ... end else start ... end`
  - `while <condition> start ... end`
  - `for <n> in <a>..<b> start ... end` — numeric range, `b` exclusive
  - `for <n> in <array> start ... end` — iterate array elements
  - `break` / `continue` — inside any loop
- Functions ("tasks"):
  - `task <n>(<param>, ...) start ... end` — declare
  - `return <expression>` / bare `return` — exit early with/without a value
  - Tasks can call themselves (recursion) and each other
- Standard library (built in, callable like any task):
  - `length(x)` — size of an array or string
  - `input(prompt?)` — print an optional prompt, read one line from stdin
  - `random()` — float in `[0, 1)`; `random(min, max)` — integer in `[min, max]`
  - `time()` — milliseconds since the Unix epoch
  - `type(x)` — `"number" | "string" | "boolean" | "array" | "task" | "nothing"`
  - `number(x)` — convert a string/boolean to a number
  - `text(x)` — convert any value to its display string
- Intelligent error messages: syntax and runtime errors report line:column
  and, where possible, a "Did you mean ...?" suggestion (mistyped keywords,
  undefined variables, etc.) or a plain-language hint.

### Control flow syntax

`if`, `while`, `for`, and `task` bodies all use the same `start ... end`
block form as a module, so nesting works exactly the way you'd expect:

```
module ControlFlow
start
let count = 0
while count < 3 start
  if count == 1 start
    show "one"
  end
  else start
    show count
  end
  let count = count + 1
end
end
```

Note that the `end` closing an `if`'s body comes *before* `else` — `else`
opens its own `start ... end` block immediately after.

### Loops, arrays, and functions (new in v0.5)

```
module Demo
start
  task double(n) start
    return n * 2
  end

  let numbers = [1, 2, 3, 4, 5]
  let total = 0

  for n in numbers start
    if n == 4 start
      continue
    end
    let total = total + double(n)
  end

  show total          // 24 (skips n == 4)
  show length(numbers) // 5
  show numbers[0] and true
end
```

### Scoping

- `let` mutates the nearest existing binding with that name, or creates a
  new one in the current scope if none exists yet — so `let count = count + 1`
  inside a `while`/`for` updates an outer counter, just like in v0.2.
- Each `for` loop gets its own scope for the loop variable, discarded once
  the loop ends.
- Calling a `task` creates a fresh scope for its parameters; tasks can see
  other tasks and can recurse, but cannot see the caller's local variables.

## Error messages

Syntax and runtime errors are reported with a line and column and, when
possible, a suggestion:

```
$ node compiler/index.js broken.sai
SyntaxError: Unexpected identifier "shwo" at start of statement at 3:1
  Did you mean "show"?
```

```
RuntimeError: Undefined variable "coutn" at 4:6
  Did you mean "count"?
```
