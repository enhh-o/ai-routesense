import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  aggregateEvaluationRuns,
  buildIssueEvidence,
  calculateModelCost,
  nextUpgradeTier,
} from "../lib/evaluation-score.ts";

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

test("模型费用按输入长度档位和实际输出 Token 计算，动态路由只能逐级升级", () => {
  assert.equal(calculateModelCost("small", 2000, 1000), 0.0024);
  assert.equal(calculateModelCost("general", 2000, 1000), 0.0048);
  assert.equal(calculateModelCost("reasoning", 2000, 1000), 0.0224);
  assert.equal(nextUpgradeTier("small"), "general");
  assert.equal(nextUpgradeTier("general"), "reasoning");
  assert.equal(nextUpgradeTier("reasoning"), null);
});

test("缺少预期试次时不展示不完整的成功率", () => {
  const summary = aggregateEvaluationRuns({
    caseIds: ["RS-V2-C1-D01"],
    variants: ["dynamic"],
    trialsPerVariant: 2,
    runs: [
      {
        id: "run-1",
        caseId: "RS-V2-C1-D01",
        variant: "dynamic",
        trial: 1,
        status: "completed",
        score: { passed: true, qualityScore: 0.9, failureTags: [] },
        costCny: 0.0024,
        latencyMs: 900,
      },
    ],
  });

  assert.equal(summary.isComplete, false);
  assert.equal(summary.completedCount, 1);
  assert.deepEqual(summary.missingRunKeys, ["RS-V2-C1-D01:dynamic:2"]);
  assert.equal(summary.metrics.taskSuccessRate, null);
});

test("问题证据只汇总实际运行中的失败标签和人工复核结论", () => {
  const evidence = buildIssueEvidence([
    {
      id: "run-2",
      caseId: "RS-V2-C4-D02",
      variant: "dynamic",
      trial: 1,
      status: "completed",
      score: {
        passed: false,
        qualityScore: 0.55,
        failureTags: ["missing_hard_constraint"],
      },
      review: { finding: "遗漏无障碍厕所核验", reviewer: "human" },
      costCny: 0.02,
      latencyMs: 1200,
    },
  ]);

  assert.deepEqual(evidence, [
    {
      issue: "missing_hard_constraint",
      count: 1,
      runIds: ["run-2"],
      reviewFindings: ["遗漏无障碍厕所核验"],
    },
  ]);
});
