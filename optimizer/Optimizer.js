// compiler/optimizer/Optimizer.js
// SAIL Optimizer v1.0
//
// A small, conservative AST-to-AST pass that runs after parsing and before
// interpretation. Every transformation here is chosen to be provably safe
// — it never changes what a correct program does, only how fast it runs
// or what it warns the programmer about.
//
//   1. Constant folding — expressions built entirely out of literals
//      (e.g. `2 + 3 * 4`) are computed once, here, instead of on every run.
//   2. Dead code elimination — statements that can never execute because
//      they come after a return/break/continue in the same block are
//      removed, with a warning explaining why.
//   3. Unused variable detection — a `let`/`const` whose name is never
//      read anywhere after its declaration gets a warning. This is
//      warning-only: the declaration itself is never removed, because its
//      right-hand side might have a side effect (e.g. `let x = input()`).
//
// The optimizer never touches control flow, function boundaries, or
// anything involving imports/exports — those always run exactly as
// written.

/**
 * @param {object} programNode - The ProgramNode from Parser.parse()
 * @param {object} [options]
 * @param {(message: string) => void} [options.onWarning] - Called once per
 *   warning discovered. Defaults to a no-op, so callers who don't care
 *   about warnings (e.g. imported modules) don't pay for console output.
 * @returns {object} The same AST, mutated in place and also returned for
 *   convenience.
 */
export function optimize(programNode, options = {}) {
  const onWarning = options.onWarning || (() => {});
  foldBlock(programNode.module.body);
  eliminateDeadCode(programNode.module.body, onWarning);
  checkUnusedVariables(programNode.module.body, onWarning);
  return programNode;
}

// ── 1. Constant folding ─────────────────────────────────────────────────────

function isLiteral(node) {
  return (
    node.type === "NumberLiteralNode" ||
    node.type === "StringLiteralNode" ||
    node.type === "BooleanLiteralNode" ||
    node.type === "NullLiteralNode"
  );
}

function literalValue(node) {
  switch (node.type) {
    case "NumberLiteralNode":  return node.value;
    case "StringLiteralNode":  return node.value;
    case "BooleanLiteralNode": return node.value;
    case "NullLiteralNode":    return null;
  }
}

function makeLiteralFor(value, line, column) {
  if (typeof value === "number")  return { type: "NumberLiteralNode",  value, line, column };
  if (typeof value === "string")  return { type: "StringLiteralNode",  value, line, column };
  if (typeof value === "boolean") return { type: "BooleanLiteralNode", value, line, column };
  return { type: "NullLiteralNode", line, column };
}

/** Recursively fold an expression node, returning a possibly-replaced node. */
function foldExpr(node) {
  if (!node || typeof node !== "object") return node;

  switch (node.type) {
    case "UnaryExpressionNode": {
      node.operand = foldExpr(node.operand);
      if (isLiteral(node.operand)) {
        const v = literalValue(node.operand);
        if (node.operator === "-" && typeof v === "number") {
          return makeLiteralFor(-v, node.line, node.column);
        }
        if (node.operator === "not") {
          return makeLiteralFor(!(v === true || (typeof v !== "boolean" && Boolean(v))), node.line, node.column);
        }
      }
      return node;
    }

    case "BinaryExpressionNode": {
      node.left  = foldExpr(node.left);
      node.right = foldExpr(node.right);
      if (isLiteral(node.left) && isLiteral(node.right)) {
        const a = literalValue(node.left);
        const b = literalValue(node.right);
        try {
          switch (node.operator) {
            case "+": if (typeof a === "number" && typeof b === "number") return makeLiteralFor(a + b, node.line, node.column);
                      if (typeof a === "string" || typeof b === "string") return node; // leave text concatenation to the interpreter's stringify rules
                      break;
            case "-": if (typeof a === "number" && typeof b === "number") return makeLiteralFor(a - b, node.line, node.column); break;
            case "*": if (typeof a === "number" && typeof b === "number") return makeLiteralFor(a * b, node.line, node.column); break;
            case "/": if (typeof a === "number" && typeof b === "number" && b !== 0) return makeLiteralFor(a / b, node.line, node.column); break;
            case "%": if (typeof a === "number" && typeof b === "number" && b !== 0) return makeLiteralFor(a % b, node.line, node.column); break;
            case "==": return makeLiteralFor(a === b, node.line, node.column);
            case "!=": return makeLiteralFor(a !== b, node.line, node.column);
            case ">":  if (typeof a === "number" && typeof b === "number") return makeLiteralFor(a > b,  node.line, node.column); break;
            case "<":  if (typeof a === "number" && typeof b === "number") return makeLiteralFor(a < b,  node.line, node.column); break;
            case ">=": if (typeof a === "number" && typeof b === "number") return makeLiteralFor(a >= b, node.line, node.column); break;
            case "<=": if (typeof a === "number" && typeof b === "number") return makeLiteralFor(a <= b, node.line, node.column); break;
          }
        } catch {
          // If anything about the fold is unsafe, just leave the original
          // expression for the interpreter to evaluate (and error on, if
          // it truly is invalid) at run time.
        }
      }
      return node;
    }

    case "LogicalExpressionNode": {
      node.left  = foldExpr(node.left);
      node.right = foldExpr(node.right);
      return node;
    }

    case "MemberExpressionNode": {
      node.object = foldExpr(node.object);
      if (node.computed) node.property = foldExpr(node.property);
      return node;
    }

    case "CallNode": {
      node.callee = foldExpr(node.callee);
      node.args = node.args.map(foldExpr);
      return node;
    }

    case "ArrayLiteralNode": {
      node.elements = node.elements.map(foldExpr);
      return node;
    }

    case "ObjectLiteralNode": {
      node.entries.forEach((entry) => { entry.value = foldExpr(entry.value); });
      return node;
    }

    default:
      return node;
  }
}

function foldBlock(block) {
  for (const stmt of block.statements) {
    foldStatement(stmt);
  }
}

function foldStatement(stmt) {
  switch (stmt.type) {
    case "ShowNode":
      stmt.argument = foldExpr(stmt.argument);
      break;
    case "LetNode":
    case "ConstNode":
      stmt.value = foldExpr(stmt.value);
      break;
    case "MemberAssignNode":
      stmt.accessors.forEach((acc) => { if (acc.computed) acc.key = foldExpr(acc.key); });
      stmt.value = foldExpr(stmt.value);
      break;
    case "IfNode":
      stmt.condition = foldExpr(stmt.condition);
      foldBlock(stmt.thenBlock);
      if (stmt.elseBlock) {
        if (stmt.elseBlock.type === "IfNode") foldStatement(stmt.elseBlock);
        else foldBlock(stmt.elseBlock);
      }
      break;
    case "WhileNode":
      stmt.condition = foldExpr(stmt.condition);
      foldBlock(stmt.body);
      break;
    case "ForRangeNode":
      stmt.start = foldExpr(stmt.start);
      stmt.end   = foldExpr(stmt.end);
      if (stmt.step) stmt.step = foldExpr(stmt.step);
      foldBlock(stmt.body);
      break;
    case "ForInNode":
      stmt.iterable = foldExpr(stmt.iterable);
      foldBlock(stmt.body);
      break;
    case "TaskNode":
      stmt.params.forEach((p) => { if (p.defaultValue) p.defaultValue = foldExpr(p.defaultValue); });
      foldBlock(stmt.body);
      break;
    case "ReturnNode":
      if (stmt.argument) stmt.argument = foldExpr(stmt.argument);
      break;
    case "ExpressionStatementNode":
      stmt.expression = foldExpr(stmt.expression);
      break;
    case "ExportNode":
      foldStatement(stmt.declaration);
      break;
    default:
      break; // BreakNode, ContinueNode, ImportNode — nothing to fold
  }
}

// ── 2. Dead code elimination ────────────────────────────────────────────────

const TERMINATORS = new Set(["ReturnNode", "BreakNode", "ContinueNode"]);

function eliminateDeadCode(block, onWarning) {
  eliminateInBlock(block, onWarning);
}

function eliminateInBlock(block, onWarning) {
  let cutIndex = -1;
  for (let i = 0; i < block.statements.length; i++) {
    recurseIntoStatement(block.statements[i], onWarning);
    if (cutIndex === -1 && TERMINATORS.has(block.statements[i].type)) {
      cutIndex = i;
    }
  }
  if (cutIndex !== -1 && cutIndex < block.statements.length - 1) {
    const removedCount = block.statements.length - cutIndex - 1;
    const line = block.statements[cutIndex + 1].line;
    onWarning(
      `${removedCount} unreachable statement(s) after ` +
      `${block.statements[cutIndex].type.replace("Node", "").toLowerCase()} ` +
      `at line ${line} — removed.`
    );
    block.statements.length = cutIndex + 1;
  }
}

function recurseIntoStatement(stmt, onWarning) {
  switch (stmt.type) {
    case "IfNode":
      eliminateInBlock(stmt.thenBlock, onWarning);
      if (stmt.elseBlock) {
        if (stmt.elseBlock.type === "IfNode") recurseIntoStatement(stmt.elseBlock, onWarning);
        else eliminateInBlock(stmt.elseBlock, onWarning);
      }
      break;
    case "WhileNode":
    case "ForRangeNode":
    case "ForInNode":
    case "TaskNode":
      eliminateInBlock(stmt.body, onWarning);
      break;
    case "ExportNode":
      recurseIntoStatement(stmt.declaration, onWarning);
      break;
    default:
      break;
  }
}

// ── 3. Unused variable detection (warning-only) ─────────────────────────────

/** Collect every identifier name *read* anywhere within a node (deep). */
function collectReads(node, out) {
  if (!node || typeof node !== "object") return;

  if (node.type === "IdentifierNode") {
    out.add(node.name);
    return;
  }

  for (const key of Object.keys(node)) {
    if (key === "type" || key === "line" || key === "column") continue;
    const val = node[key];
    if (Array.isArray(val)) {
      val.forEach((item) => collectReads(item, out));
    } else if (val && typeof val === "object") {
      collectReads(val, out);
    }
  }
}

function checkUnusedVariables(block, onWarning) {
  checkBlockScope(block, onWarning);
}

/**
 * Within one block-shaped scope (a module body or a task body — the two
 * places SAIL creates a real variable scope), check whether each `let`/
 * `const` declared directly in that block is ever read anywhere in the
 * rest of the program text reachable from it. This is a simple, whole
 * subtree read-check rather than true reaching-definitions analysis — it
 * favours never producing a false "unused" warning over being maximally
 * precise, since a false positive is far more annoying to a beginner than
 * an occasional missed warning.
 */
function checkBlockScope(block, onWarning) {
  const declared = []; // { name, line }

  for (const stmt of block.statements) {
    if (stmt.type === "LetNode" || stmt.type === "ConstNode") {
      declared.push({ name: stmt.name, line: stmt.line });
    }
    if (stmt.type === "TaskNode") {
      checkBlockScope(stmt.body, onWarning); // recurse into nested task scope
    }
    if (stmt.type === "IfNode") {
      checkNestedNonScopeBlock(stmt.thenBlock, onWarning);
      let elseNode = stmt.elseBlock;
      while (elseNode && elseNode.type === "IfNode") {
        checkNestedNonScopeBlock(elseNode.thenBlock, onWarning);
        elseNode = elseNode.elseBlock;
      }
      if (elseNode) checkNestedNonScopeBlock(elseNode, onWarning);
    }
    if (stmt.type === "WhileNode" || stmt.type === "ForRangeNode" || stmt.type === "ForInNode") {
      checkNestedNonScopeBlock(stmt.body, onWarning);
    }
  }

  if (declared.length === 0) return;

  const reads = new Set();
  collectReads(block, reads);

  for (const { name, line } of declared) {
    if (!reads.has(name)) {
      onWarning(`variable "${name}" is declared but never used (line ${line}).`);
    }
  }
}

/**
 * if/while/for bodies share their enclosing scope in SAIL (see
 * Environment.js), so a `let` inside one of these isn't really a new,
 * separately-scoped variable — but we still want to walk into them to
 * find any *task* declarations inside, which do introduce a new scope.
 */
function checkNestedNonScopeBlock(block, onWarning) {
  for (const stmt of block.statements) {
    if (stmt.type === "TaskNode") {
      checkBlockScope(stmt.body, onWarning);
    }
    if (stmt.type === "IfNode") {
      checkNestedNonScopeBlock(stmt.thenBlock, onWarning);
      let elseNode = stmt.elseBlock;
      while (elseNode && elseNode.type === "IfNode") {
        checkNestedNonScopeBlock(elseNode.thenBlock, onWarning);
        elseNode = elseNode.elseBlock;
      }
      if (elseNode) checkNestedNonScopeBlock(elseNode, onWarning);
    }
    if (stmt.type === "WhileNode" || stmt.type === "ForRangeNode" || stmt.type === "ForInNode") {
      checkNestedNonScopeBlock(stmt.body, onWarning);
    }
  }
}
