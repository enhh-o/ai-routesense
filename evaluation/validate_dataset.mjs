import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const evaluationDir = path.dirname(fileURLToPath(import.meta.url));
const datasetPath = path.join(evaluationDir, "routesense_eval_v1.json");
const reviewTemplatePath = path.join(
  evaluationDir,
  "human_review_template.csv",
);
const splitsPath = path.join(evaluationDir, "splits.json");

const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
const splits = JSON.parse(await readFile(splitsPath, "utf8"));
const reviewTemplate = await readFile(reviewTemplatePath, "utf8");

const validIntentStages = new Set([
  "exploration",
  "preference",
  "comparison",
  "decision",
  "transaction",
]);
const validLevels = new Set(["low", "medium", "high"]);
const validPersonalization = new Set(["none", "session", "long_term"]);
const validRealtime = new Set(["none", "search", "business_data"]);
const validStrategies = new Set([
  "answer",
  "clarify",
  "retrieve_memory",
  "search",
  "call_tool",
  "plan",
  "handoff",
]);
const validModelTiers = new Set(["small", "general", "reasoning"]);
const validDifficulties = new Set(["easy", "medium", "hard"]);

assert.equal(dataset.dataset_id, "routesense-capability-v1");
assert.equal(dataset.version, "1.0.0");
assert.equal(dataset.language, "zh-CN");
assert.ok(Array.isArray(dataset.cases), "cases 必须是数组");
assert.equal(dataset.cases.length, 20, "首版必须包含 20 条任务");
assert.equal(
  dataset.recommended_trials_per_variant,
  3,
  "建议每个实验组重复 3 次",
);

const ids = new Set();
const titles = new Set();
const queries = new Set();
const categories = new Map();
const difficultyCounts = new Map();
const tierCounts = new Map();

for (const evalCase of dataset.cases) {
  const prefix = `[${evalCase.case_id || "未知任务"}]`;

  assert.match(
    evalCase.case_id,
    /^RS-CAP-\d{3}$/,
    `${prefix} case_id 格式错误`,
  );
  assert.ok(!ids.has(evalCase.case_id), `${prefix} case_id 重复`);
  ids.add(evalCase.case_id);

  assert.ok(evalCase.title?.trim(), `${prefix} 缺少标题`);
  assert.ok(!titles.has(evalCase.title), `${prefix} 标题重复`);
  titles.add(evalCase.title);

  assert.ok(evalCase.user_query?.trim(), `${prefix} 缺少用户问题`);
  assert.ok(!queries.has(evalCase.user_query), `${prefix} 用户问题重复`);
  queries.add(evalCase.user_query);

  assert.ok(
    validDifficulties.has(evalCase.difficulty),
    `${prefix} difficulty 无效`,
  );
  difficultyCounts.set(
    evalCase.difficulty,
    (difficultyCounts.get(evalCase.difficulty) ?? 0) + 1,
  );
  categories.set(
    evalCase.category,
    (categories.get(evalCase.category) ?? 0) + 1,
  );

  const route = evalCase.expected_route;
  assert.ok(route, `${prefix} 缺少 expected_route`);
  assert.ok(
    validIntentStages.has(route.intent_stage),
    `${prefix} intent_stage 无效`,
  );
  assert.ok(
    validLevels.has(route.information_completeness),
    `${prefix} information_completeness 无效`,
  );
  assert.ok(
    validLevels.has(route.task_complexity),
    `${prefix} task_complexity 无效`,
  );
  assert.ok(
    validPersonalization.has(route.personalization_need),
    `${prefix} personalization_need 无效`,
  );
  assert.ok(
    validRealtime.has(route.realtime_need),
    `${prefix} realtime_need 无效`,
  );
  assert.ok(validLevels.has(route.risk_level), `${prefix} risk_level 无效`);
  assert.ok(
    validModelTiers.has(route.minimum_model_tier),
    `${prefix} minimum_model_tier 无效`,
  );
  assert.ok(
    Array.isArray(route.acceptable_model_tiers) &&
      route.acceptable_model_tiers.length > 0,
    `${prefix} 缺少 acceptable_model_tiers`,
  );
  assert.ok(
    route.acceptable_model_tiers.includes(route.minimum_model_tier),
    `${prefix} 最低档位不在允许档位中`,
  );
  for (const tier of route.acceptable_model_tiers) {
    assert.ok(validModelTiers.has(tier), `${prefix} 允许档位 ${tier} 无效`);
  }
  tierCounts.set(
    route.minimum_model_tier,
    (tierCounts.get(route.minimum_model_tier) ?? 0) + 1,
  );

  assert.ok(
    Array.isArray(route.required_strategies) &&
      route.required_strategies.length > 0,
    `${prefix} 至少需要一个 required_strategy`,
  );
  for (const strategy of [
    ...route.required_strategies,
    ...(route.forbidden_strategies ?? []),
  ]) {
    assert.ok(
      validStrategies.has(strategy),
      `${prefix} strategy ${strategy} 无效`,
    );
  }
  const overlap = route.required_strategies.filter((strategy) =>
    (route.forbidden_strategies ?? []).includes(strategy),
  );
  assert.equal(overlap.length, 0, `${prefix} 同一策略不能同时必需和禁止`);

  assert.ok(
    Array.isArray(evalCase.hard_constraints),
    `${prefix} hard_constraints 必须是数组`,
  );
  const constraintIds = new Set();
  for (const constraint of evalCase.hard_constraints) {
    assert.ok(constraint.id?.trim(), `${prefix} 硬约束缺少 id`);
    assert.ok(!constraintIds.has(constraint.id), `${prefix} 硬约束 id 重复`);
    constraintIds.add(constraint.id);
    assert.ok(constraint.text?.trim(), `${prefix} 硬约束缺少说明`);
    assert.equal(
      typeof constraint.critical,
      "boolean",
      `${prefix} 硬约束 critical 必须是布尔值`,
    );
  }

  assert.ok(
    Array.isArray(evalCase.critical_assertions) &&
      evalCase.critical_assertions.length > 0,
    `${prefix} 至少需要一条关键断言`,
  );
  assert.ok(
    Array.isArray(evalCase.quality_assertions) &&
      evalCase.quality_assertions.length > 0,
    `${prefix} 至少需要一条质量断言`,
  );
  assert.ok(
    Array.isArray(evalCase.prohibited_behaviors) &&
      evalCase.prohibited_behaviors.length > 0,
    `${prefix} 至少需要一条禁止行为`,
  );

  assert.ok(
    reviewTemplate.includes(evalCase.case_id),
    `${prefix} 未出现在人工评分模板中`,
  );
}

assert.ok(
  (difficultyCounts.get("hard") ?? 0) >= 8,
  "能力评估集应包含足够的高难度任务",
);
assert.ok(
  (tierCounts.get("small") ?? 0) >= 2,
  "需要至少两条可由轻量模型处理的任务",
);
assert.ok(
  (tierCounts.get("reasoning") ?? 0) >= 8,
  "需要至少八条强推理任务",
);
assert.ok(categories.has("safety_handoff"), "需要覆盖安全转人工场景");
assert.ok(categories.has("tool_security"), "需要覆盖工具提示注入场景");

assert.equal(splits.development.length, 5, "开发验证集必须固定为 5 条");
assert.equal(splits.holdout.length, 15, "正式实验集必须固定为 15 条");
const splitIds = [...splits.development, ...splits.holdout];
assert.equal(new Set(splitIds).size, 20, "开发集与正式实验集不能重复");
assert.deepEqual(
  new Set(splitIds),
  ids,
  "拆分必须完整覆盖 20 条任务且不能包含未知任务",
);

const summary = {
  datasetId: dataset.dataset_id,
  version: dataset.version,
  caseCount: dataset.cases.length,
  recommendedTrialsPerVariant: dataset.recommended_trials_per_variant,
  developmentCaseCount: splits.development.length,
  holdoutCaseCount: splits.holdout.length,
  totalCallsForHoldoutExperiment:
    splits.holdout.length *
    dataset.variants.length *
    dataset.recommended_trials_per_variant,
  difficultyDistribution: Object.fromEntries(difficultyCounts),
  minimumTierDistribution: Object.fromEntries(tierCounts),
  categoryCount: categories.size,
  status: "valid",
};

console.log(JSON.stringify(summary, null, 2));
