"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TESTS = path.join(ROOT, "tests");
const HELPERS = new Set(["detail-fixture.cjs"]);
const suites = fs.readdirSync(TESTS)
  .filter(name => name.endsWith(".cjs") && !HELPERS.has(name))
  .sort()
  .map(name => path.join("tests", name));

function resolvePython() {
  const candidates = [
    process.env.SHOPKUD_TEST_PYTHON,
    process.env.VIRTUAL_ENV && path.join(process.env.VIRTUAL_ENV, "bin", "python"),
    path.join(ROOT, ".venv", "bin", "python"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const absolute = path.resolve(candidate);
    if (fs.existsSync(absolute)) return absolute;
  }
  const located = spawnSync("which", ["python3"], {encoding: "utf8"});
  if (located.status === 0 && located.stdout.trim()) return located.stdout.trim();
  throw new Error("Python 3.11+ was not found; set SHOPKUD_TEST_PYTHON to an absolute path");
}

function run(label, command, args, env) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {cwd: ROOT, env, stdio: "inherit"});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`FAILED: ${label} (exit ${result.status ?? "signal"})`);
    process.exit(result.status || 1);
  }
}

function main() {
  if (process.argv.includes("--list")) {
    console.log(JSON.stringify({python_checks: 4, javascript_suites: suites, helpers: [...HELPERS]}, null, 2));
    return;
  }

  const python = resolvePython();
  const probe = spawnSync(python, ["-c", "import mcp, uvicorn"], {cwd: ROOT});
  if (probe.status !== 0) throw new Error(`${python} is missing ShopKud runtime dependencies`);

  const {chromium} = require("playwright");
  const chromiumPath = path.resolve(
    process.env.SHOPKUD_TEST_CHROMIUM || process.env.SHOPEE_TEST_CHROMIUM || chromium.executablePath(),
  );
  if (!fs.existsSync(chromiumPath)) {
    throw new Error("Playwright Chromium is missing; run: npx playwright install chromium");
  }

  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shopkud-test-artifacts-"));
  const env = {
    ...process.env,
    PYTHONDONTWRITEBYTECODE: "1",
    SHOPKUD_TEST_PYTHON: python,
    SHOPKUD_TEST_CHROMIUM: chromiumPath,
    SHOPEE_TEST_CHROMIUM: chromiumPath,
    SHOPKUD_TEST_OUTPUT_DIR: outputRoot,
  };

  let passed = false;
  try {
    run("release consistency", python, ["scripts/check-release-consistency.py"], env);
    run("Python unit tests", python, ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"], env);
    run("rank playbook eval", python, ["evals/rank-playbook.py"], env);
    run("broker cancellation eval", python, ["evals/broker-cancellation.py"], env);
    for (const suite of suites) run(suite, process.execPath, [suite], env);
    passed = true;
    console.log(`\nPASS: 4 Python checks and ${suites.length} JavaScript suites`);
  } finally {
    if (passed) fs.rmSync(outputRoot, {recursive: true, force: true});
    else console.error(`Test artifacts kept at ${outputRoot}`);
  }
}

main();
