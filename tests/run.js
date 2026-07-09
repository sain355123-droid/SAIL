// compiler/tests/run.js
// SAIL Test Runner v1.0
//
// A small, dependency-free test runner (no Jest/Mocha) that:
//   1. Runs every "golden" example in compiler/examples/ and diffs its
//      output against the matching fixture in compiler/tests/fixtures/.
//   2. Runs a set of targeted checks against specific language features
//      and error messages (see checks.js).
//
// Usage:
//   node compiler/tests/run.js
//
// Exits with code 0 if everything passes, 1 if anything fails — suitable
// for CI or a pre-release sanity check ("Verify every previous example.").

import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath }                          from "url";
import { dirname, join }                            from "path";

import { runFile } from "../index.js";
import { runChecks } from "./checks.js";

const __dirname   = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, "..", "examples");
const fixturesDir = join(__dirname, "fixtures");

let passCount = 0;
let failCount = 0;

function bold(s)  { return `\x1b[1m${s}\x1b[0m`; }
function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function red(s)   { return `\x1b[31m${s}\x1b[0m`; }
function dim(s)   { return `\x1b[2m${s}\x1b[0m`; }

/** Run one example file, capturing everything it would print via `console.log`. */
function captureOutput(fn) {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => { lines.push(args.join(" ")); };
  try {
    fn();
  } finally {
    console.log = originalLog;
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

function runGoldenTests() {
  const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".out"));

  for (const fixtureFile of fixtureFiles) {
    const exampleName = fixtureFile.replace(/\.out$/, "");
    const examplePath = join(examplesDir, exampleName);
    const expected = readFileSync(join(fixturesDir, fixtureFile), "utf8");

    if (!existsSync(examplePath)) {
      console.log(red(`✗ ${exampleName}`) + dim(` — fixture exists but example file is missing`));
      failCount++;
      continue;
    }

    let actual;
    let error = null;
    try {
      actual = captureOutput(() => runFile(examplePath, { warnings: false }));
    } catch (err) {
      error = err;
    }

    if (error) {
      console.log(red(`✗ ${exampleName}`) + dim(` — threw an error: ${error.message.split("\n")[0]}`));
      failCount++;
      continue;
    }

    if (actual === expected) {
      console.log(green(`✓ ${exampleName}`));
      passCount++;
    } else {
      console.log(red(`✗ ${exampleName}`) + dim(` — output did not match fixture`));
      console.log(dim(`  expected: ${JSON.stringify(expected)}`));
      console.log(dim(`  actual:   ${JSON.stringify(actual)}`));
      failCount++;
    }
  }
}

function runTargetedChecks() {
  const results = runChecks({ runFile, captureOutput, examplesDir });
  for (const result of results) {
    if (result.pass) {
      console.log(green(`✓ ${result.name}`));
      passCount++;
    } else {
      console.log(red(`✗ ${result.name}`) + dim(` — ${result.message}`));
      failCount++;
    }
  }
}

console.log(bold("Running SAIL test suite...\n"));
console.log(bold("Golden examples:"));
runGoldenTests();

console.log("");
console.log(bold("Targeted checks:"));
runTargetedChecks();

console.log("");
console.log(bold(`${passCount} passed, ${failCount} failed.`));
process.exit(failCount > 0 ? 1 : 0);
