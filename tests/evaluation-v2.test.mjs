import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("V2 评测集覆盖七类能力，并固定开发集与独立正式集", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["evaluation/v2/validate_dataset_v2.mjs"],
    { cwd: projectRoot },
  );
  const report = JSON.parse(stdout);

  assert.equal(report.version, "2.0.0");
  assert.equal(report.caseCount, 63);
  assert.deepEqual(report.categoryCounts, {
    clarification: 9,
    context_memory: 9,
    realtime_tools: 9,
    constrained_planning: 9,
    decision_confirmation: 9,
    recovery: 9,
    safety_security: 9,
  });
  assert.equal(report.developmentCaseCount, 21);
  assert.equal(report.holdoutCaseCount, 42);
  assert.equal(report.formalInvocationPlan, 504);
  assert.equal(report.status, "valid");
});
