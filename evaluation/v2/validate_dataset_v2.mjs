import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const evaluationDir = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(
  await readFile(path.join(evaluationDir, "routesense_eval_v2.json"), "utf8"),
);
const splits = JSON.parse(
  await readFile(path.join(evaluationDir, "splits_v2.json"), "utf8"),
);

const categories = [
  "clarification",
  "context_memory",
  "realtime_tools",
  "constrained_planning",
  "decision_confirmation",
  "recovery",
  "safety_security",
];
const developmentPattern = /^RS-V2-C[1-7]-D0[1-3]$/;
const holdoutPattern = /^RS-V2-C[1-7]-H0[1-6]$/;
const validTiers = new Set(["small", "general", "reasoning"]);
const validDifficulties = new Set(["easy", "medium", "hard"]);
const validStrategies = new Set([
  "answer",
  "clarify",
  "retrieve_memory",
  "search",
  "call_tool",
  "plan",
  "handoff",
]);

assert.equal(dataset.dataset_id, "routesense-capability-v2");
assert.equal(dataset.version, "2.0.0");
assert.deepEqual(dataset.variants, ["all_mini", "all_lite", "all_pro", "dynamic"]);
assert.equal(dataset.recommended_trials_per_variant, 3);
assert.equal(dataset.cases.length, 63, "V2 必须有 63 条任务");
assert.deepEqual(Object.keys(dataset.categories), categories);

const ids = new Set();
const categoryCounts = Object.fromEntries(categories.map((category) => [category, 0]));
for (const task of dataset.cases) {
  const prefix = `[${task.case_id ?? "未知任务"}]`;
  assert.ok(task.case_id, `${prefix} 缺少 case_id`);
  assert.ok(!ids.has(task.case_id), `${prefix} case_id 重复`);
  ids.add(task.case_id);
  assert.ok(categories.includes(task.category), `${prefix} 类别无效`);
  categoryCounts[task.category] += 1;
  assert.ok(validDifficulties.has(task.difficulty), `${prefix} 难度无效`);
  assert.ok(task.title?.trim(), `${prefix} 缺少标题`);
  assert.ok(task.user_query?.trim(), `${prefix} 缺少用户问题`);
  assert.ok(Array.isArray(task.hard_constraints) && task.hard_constraints.length >= 1, `${prefix} 缺少硬约束`);
  assert.ok(Array.isArray(task.critical_assertions) && task.critical_assertions.length >= 2, `${prefix} 至少需要两条关键断言`);
  assert.ok(Array.isArray(task.quality_assertions) && task.quality_assertions.length >= 1, `${prefix} 缺少质量断言`);
  assert.ok(Array.isArray(task.prohibited_behaviors) && task.prohibited_behaviors.length >= 1, `${prefix} 缺少禁止行为`);
  assert.ok(task.expected_route, `${prefix} 缺少路由期望`);
  assert.ok(validTiers.has(task.expected_route.minimum_model_tier), `${prefix} 模型档位无效`);
  assert.ok(task.expected_route.required_strategies?.length, `${prefix} 缺少策略期望`);
  for (const strategy of task.expected_route.required_strategies) {
    assert.ok(validStrategies.has(strategy), `${prefix} 策略无效：${strategy}`);
  }
  assert.ok(
    task.split === "development" ? developmentPattern.test(task.case_id) : holdoutPattern.test(task.case_id),
    `${prefix} split 与编号不一致`,
  );
}

for (const category of categories) {
  assert.equal(categoryCounts[category], 9, `${category} 必须刚好 9 条任务`);
}
assert.equal(splits.version, "2.0.0");
assert.equal(splits.development.length, 21, "开发集必须为 21 条");
assert.equal(splits.holdout.length, 42, "正式集必须为 42 条");
const splitIds = [...splits.development, ...splits.holdout];
assert.equal(new Set(splitIds).size, 63, "开发集与正式集不能重复");
assert.deepEqual(new Set(splitIds), ids, "拆分必须完整覆盖 63 条任务");
for (const task of dataset.cases) {
  const expectedSplit = splits.development.includes(task.case_id) ? "development" : "holdout";
  assert.equal(task.split, expectedSplit, `[${task.case_id}] split 声明与清单不一致`);
}

console.log(JSON.stringify({
  datasetId: dataset.dataset_id,
  version: dataset.version,
  caseCount: dataset.cases.length,
  categoryCounts,
  developmentCaseCount: splits.development.length,
  holdoutCaseCount: splits.holdout.length,
  formalInvocationPlan: splits.holdout.length * dataset.variants.length * dataset.recommended_trials_per_variant,
  status: "valid",
}, null, 2));
