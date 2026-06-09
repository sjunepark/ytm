import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createKisnetYtmToolset } from "../dist/toolset.js";

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

const pkg = JSON.parse(await readFile("package.json", "utf8"));
check(pkg.name === "@sjunepark/ytm", "package.json must use the configured npm package name");
check(pkg.packageManager?.startsWith("bun@"), "package.json must declare Bun as the development package manager");
check(pkg.engines?.node, "package.json must declare the supported Node engine for npm users");
check(pkg.publishConfig?.access === "public", "scoped npm package must publish with public access");
check(pkg.scripts?.cli === "bun run src/cli.js", "package.json must expose a Bun source-run cli script");
check(pkg.bin && pkg.bin["ytm"] === "dist/cli.js", "package.json must expose bin.ytm -> dist/cli.js");
check(pkg.exports?.["./toolset"]?.import === "./dist/toolset.js", "package.json must export ./toolset import surface");
check(pkg.exports?.["./toolset"]?.types === "./dist/toolset.d.ts", "package.json must export ./toolset types");
check(pkg.exports?.["./package.json"] === "./package.json", "package.json must export ./package.json metadata");
check(existsSync("dist/cli.js"), "dist/cli.js must exist; run bun run build");
check(existsSync("dist/toolset.js"), "dist/toolset.js must exist; run bun run build");
check(existsSync("dist/toolset.d.ts"), "dist/toolset.d.ts must exist; run bun run build");
const cliSource = await readFile("dist/cli.js", "utf8");
check(cliSource.startsWith("#!/usr/bin/env node"), "dist/cli.js must use the Node shebang for npm bin execution");
const nodeCommand = process.env.NODE || "node";

const toolset = createKisnetYtmToolset();
for (const method of ["help", "listOperations", "getCommandHelp", "validateInput", "execute", "serializeError"]) {
  check(typeof toolset[method] === "function", `toolset.${method} must be a function`);
}
const operations = toolset.listOperations();
check(operations.some((operation) => operation.name === "matrix"), "matrix operation must be discoverable");
check(operations.some((operation) => operation.name === "kinds"), "kinds operation must be discoverable");
for (const operation of operations) {
  check(operation.inputJsonSchema && operation.resultJsonSchema, `${operation.name} must expose input and result JSON schemas`);
  check(Array.isArray(operation.requiredInputKeys), `${operation.name} must expose requiredInputKeys`);
  check(toolset.getCommandHelp(operation.name), `${operation.name} must expose command help`);
}

const missing = toolset.validateInput("matrix", { kind: "국채" });
check(!missing.valid && missing.error.code === "missing_parameter" && missing.error.recoveryAction, "missing baseDate must produce structured recovery metadata");
const unknown = toolset.validateInput("matrix", { baseDate: "2026-06-08", kind: "국채", extra: true });
check(!unknown.valid && unknown.error.code === "unknown_parameter" && unknown.error.parameter === "extra", "unknown parameters must be rejected with parameter metadata");
const invalid = toolset.validateInput("matrix", { baseDate: "2026-99-99", kind: "국채" });
check(!invalid.valid && invalid.error.code === "invalid_parameter" && invalid.error.parameter === "baseDate", "invalid dates must be rejected with recovery metadata");
const valid = toolset.validateInput("matrix", { baseDate: "2026.06.08", kind: "10" });
check(valid.valid && valid.normalizedInput.baseDate === "2026-06-08", "valid input must normalize baseDate");

const help = spawnSync(nodeCommand, ["dist/cli.js", "--help"], { encoding: "utf8" });
check(help.status === 0 && help.stdout.includes("matrix"), "CLI --help must succeed and list commands");
const bad = spawnSync(nodeCommand, ["dist/cli.js", "matrix", "--kind", "국채"], { encoding: "utf8" });
check(bad.status !== 0, "invalid CLI command must exit non-zero");
check(bad.stderr.includes("matrix") && bad.stderr.includes("10 = 국채"), "invalid CLI command must print command help to stderr");
try {
  const payload = JSON.parse(bad.stdout);
  check(payload.ok === false && payload.error?.code === "missing_parameter" && payload.error?.recoveryAction, "invalid CLI command must print one JSON failure object");
} catch {
  failures.push("invalid CLI command stdout must be JSON");
}
const list = spawnSync(nodeCommand, ["dist/cli.js", "kinds", "--format", "json"], { encoding: "utf8" });
check(list.status === 0, "safe kinds command must exit zero");
try {
  const payload = JSON.parse(list.stdout);
  check(payload.ok === true && payload.result?.kinds?.some((kind) => kind.name === "국채"), "kinds JSON result must include 국채");
} catch {
  failures.push("kinds stdout must be JSON");
}

if (process.env.KISNET_SMOKE_NETWORK === "1") {
  const smoke = spawnSync(nodeCommand, ["dist/cli.js", "matrix", "--base-date", "2026-06-08", "--kind", "국채", "--format", "json"], { encoding: "utf8", timeout: 20000 });
  check(smoke.status === 0, `network smoke must exit zero: ${smoke.stderr || smoke.stdout}`);
  if (smoke.status === 0) {
    const payload = JSON.parse(smoke.stdout);
    check(payload.result.rows.length > 0, "network smoke must return at least one matrix row");
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log("tool surface validation passed");
