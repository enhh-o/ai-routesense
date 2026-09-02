import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  aggregateEvaluationRuns,
  aggregateEvaluationRunsByVariant,
  buildIssueEvidence,
  calculateModelCost,
  nextUpgradeTier,
} from "../lib/evaluation-score.ts";
import {
  ArkConfigurationError,
  getArkModelForTier,
  invokeArkCompletion,
} from "../lib/ark-client.ts";
import { runEvaluationTrial } from "../lib/evaluation-runner.ts";
import {
  buildBlindJudgePrompt,
  parseBlindJudgeAnswer,
} from "../lib/evaluation-judge.ts";
import {
  validateEvaluationBatchRequest,
  validateHumanReview,
} from "../lib/evaluation-api-guard.ts";

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

test("四种策略分别聚合，未完成的策略不影响其他策略的证据状态", () => {
  const summaries = aggregateEvaluationRunsByVariant({
    caseIds: ["RS-V2-C1-D01"],
    variants: ["all_mini", "dynamic"],
    trialsPerVariant: 1,
    runs: [
      {
        id: "mini-complete",
        caseId: "RS-V2-C1-D01",
        variant: "all_mini",
        trial: 1,
        status: "completed",
        score: { passed: true, qualityScore: 0.9, failureTags: [] },
        costCny: 0.0024,
        latencyMs: 900,
      },
    ],
  });

  assert.equal(summaries.all_mini.isComplete, true);
  assert.equal(summaries.all_mini.metrics.taskSuccessRate, 1);
  assert.equal(summaries.dynamic.isComplete, false);
  assert.equal(summaries.dynamic.metrics.taskSuccessRate, null);
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

test("Ark 非流式调用解析响应，并采用与聊天相同的模型映射", async () => {
  assert.equal(
    getArkModelForTier("small", { ARK_MODEL_SMALL: "mini-model" }),
    "mini-model",
  );
  assert.equal(
    getArkModelForTier("general", { ARK_MODEL_SMALL: "mini-model" }),
    "mini-model",
  );
  assert.equal(
    getArkModelForTier("reasoning", { ARK_MODEL_GENERAL: "lite-model" }),
    "lite-model",
  );

  const originalFetch = globalThis.fetch;
  let receivedRequest;
  globalThis.fetch = async (input, init) => {
    receivedRequest = { input: String(input), init };
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "可执行的两日行程" } }],
        usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
        id: "chatcmpl-eval-1",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const result = await invokeArkCompletion({
      model: "mini-model",
      systemPrompt: "只用中文回答。",
      messages: [{ role: "user", content: "周末去哪玩？" }],
      maxTokens: 300,
      thinkingMode: "disabled",
      environment: { ARK_API_KEY: "test-key", ARK_BASE_URL: "https://example.test/api/v3/responses" },
    });
    assert.equal(result.answer, "可执行的两日行程");
    assert.equal(result.inputTokens, 120);
    assert.equal(result.outputTokens, 80);
    assert.equal(result.totalTokens, 200);
    assert.equal(result.httpStatus, 200);
    assert.match(receivedRequest.input, /chat\/completions$/);
    assert.match(String(receivedRequest.init?.body), /"stream":false/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Ark 缺少密钥或模型时抛出配置错误且不发送网络请求", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    throw new Error("不应发送网络请求");
  };

  try {
    await assert.rejects(
      invokeArkCompletion({
        model: null,
        systemPrompt: "测试",
        messages: [{ role: "user", content: "测试" }],
        maxTokens: 100,
        environment: {},
      }),
      ArkConfigurationError,
    );
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("动态路由按失败原因逐级升级两次，固定策略只执行指定模型一次", async () => {
  const calls = [];
  const task = {
    case_id: "RS-V2-TEST-01",
    category: "constrained_planning",
    split: "development",
    user_query: "给我一个简单的周末自然景观推荐。",
    expected_route: { required_strategies: ["answer"], minimum_model_tier: "small" },
    hard_constraints: ["预算上限"],
    critical_assertions: ["给出可执行建议"],
    quality_assertions: ["说明取舍"],
    prohibited_behaviors: ["编造实时价格"],
  };
  const invoke = async ({ model, messages }) => {
    calls.push({ model, messages });
    return {
      answer: `来自 ${model} 的建议`,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      httpStatus: 200,
      latencyMs: 20,
      providerMetadata: { model },
    };
  };
  const check = ({ tier }) => ({
    passed: tier === "reasoning",
    qualityScore: tier === "reasoning" ? 0.9 : 0.4,
    failureTags: tier === "reasoning" ? [] : ["missing_hard_constraint"],
  });
  const shared = {
    datasetVersion: "2.0.0",
    caseId: task.case_id,
    trial: 1,
    budgetRemainingCny: 1,
    task,
    dependencies: {
      invoke,
      check,
      modelForTier: (tier) => `model-${tier}`,
    },
  };

  const allMini = await runEvaluationTrial({ ...shared, variant: "all_mini" });
  assert.equal(allMini.attempts.length, 1);
  assert.equal(allMini.attempts[0].tier, "small");

  const allLite = await runEvaluationTrial({ ...shared, variant: "all_lite" });
  assert.equal(allLite.attempts.length, 1);
  assert.equal(allLite.attempts[0].tier, "general");

  const allPro = await runEvaluationTrial({ ...shared, variant: "all_pro" });
  assert.equal(allPro.attempts.length, 1);
  assert.equal(allPro.attempts[0].tier, "reasoning");

  const dynamic = await runEvaluationTrial({ ...shared, variant: "dynamic" });
  assert.deepEqual(dynamic.attempts.map(({ tier }) => tier), ["small", "general", "reasoning"]);
  assert.match(dynamic.attempts[1].failureContext ?? "", /hard constraint/i);
  assert.match(calls.at(-1).messages.at(-1).content, /上一版未满足硬约束/);
});

test("剩余预算不足时不调用模型并返回可恢复的预算拦截状态", async () => {
  let callCount = 0;
  const result = await runEvaluationTrial({
    datasetVersion: "2.0.0",
    caseId: "RS-V2-TEST-BUDGET",
    variant: "dynamic",
    trial: 1,
    budgetRemainingCny: 0,
    task: {
      case_id: "RS-V2-TEST-BUDGET",
      category: "clarification",
      split: "development",
      user_query: "周末去哪玩？",
      expected_route: { required_strategies: ["clarify"], minimum_model_tier: "small" },
      hard_constraints: [],
      critical_assertions: ["提出澄清问题"],
      quality_assertions: ["问题简洁"],
      prohibited_behaviors: ["编造目的地"],
    },
    dependencies: {
      invoke: async () => {
        callCount += 1;
        throw new Error("不应调用");
      },
      modelForTier: () => "model-small",
    },
  });
  assert.equal(result.status, "blocked_budget");
  assert.equal(callCount, 0);
});

test("同一评测身份已有记录时直接复用，不重复调用模型", async () => {
  let callCount = 0;
  const existing = {
    id: "saved-run",
    datasetVersion: "2.0.0",
    caseId: "RS-V2-TEST-EXISTING",
    variant: "all_mini",
    trial: 1,
    status: "completed",
    attempts: [],
    finalTier: "small",
    score: { passed: true, qualityScore: 0.8, failureTags: [] },
    costCny: 0.01,
    latencyMs: 10,
    reviewRequired: false,
  };
  const result = await runEvaluationTrial({
    datasetVersion: "2.0.0",
    caseId: "RS-V2-TEST-EXISTING",
    variant: "all_mini",
    trial: 1,
    budgetRemainingCny: 1,
    task: {
      case_id: "RS-V2-TEST-EXISTING",
      category: "clarification",
      split: "development",
      user_query: "周末去哪玩？",
      expected_route: { required_strategies: ["clarify"], minimum_model_tier: "small" },
      hard_constraints: [],
      critical_assertions: ["提出澄清问题"],
      quality_assertions: ["问题简洁"],
      prohibited_behaviors: ["编造目的地"],
    },
    dependencies: {
      loadExisting: async () => existing,
      invoke: async () => {
        callCount += 1;
        throw new Error("不应调用");
      },
      modelForTier: () => "model-small",
    },
  });
  assert.equal(result.id, "saved-run");
  assert.equal(callCount, 0);
});

test("盲评只接收任务与答案，无法解析的评判结果必须转人工复核", () => {
  const prompt = buildBlindJudgePrompt({
    task: {
      case_id: "RS-V2-C4-D01",
      category: "constrained_planning",
      split: "development",
      user_query: "带父母出行，预算有限。",
      expected_route: { required_strategies: ["plan"], minimum_model_tier: "reasoning" },
      hard_constraints: ["预算有限", "父母同行"],
      critical_assertions: ["给出可执行行程"],
      quality_assertions: ["解释取舍"],
      prohibited_behaviors: ["保证实时价格"],
    },
    answer: "建议放慢节奏并控制住宿预算。",
    deterministicScore: { passed: true, qualityScore: 0.8, failureTags: [] },
    toolTrace: { searched: false },
  });
  assert.doesNotMatch(prompt, /dynamic|Mini|Lite|Pro|¥|成本|model-/i);

  assert.deepEqual(
    parseBlindJudgeAnswer('{"taskCompletion":4,"constraintSatisfaction":5,"factualGrounding":4,"executability":4,"interactionQuality":4,"criticalFailure":false,"finding":"可执行"}'),
    {
      taskCompletion: 4,
      constraintSatisfaction: 5,
      factualGrounding: 4,
      executability: 4,
      interactionQuality: 4,
      criticalFailure: false,
      finding: "可执行",
      qualityScore: 0.84,
      passed: true,
      reviewRequired: false,
    },
  );
  assert.equal(parseBlindJudgeAnswer("不是 JSON"), null);
});

test("受控评测入口必须确认、限制六条以内，并设置正向预算上限", () => {
  assert.equal(
    validateEvaluationBatchRequest({
      datasetVersion: "2.0.0",
      caseIds: ["RS-V2-C1-D01"],
      variants: ["dynamic"],
      trials: [1],
      maxRuns: 1,
      maxBudgetCny: 1,
    }).error,
    "开始付费评测前需要明确确认。",
  );
  assert.equal(
    validateEvaluationBatchRequest({
      confirmed: true,
      datasetVersion: "2.0.0",
      caseIds: ["RS-V2-C1-D01"],
      variants: ["dynamic"],
      trials: [1],
      maxRuns: 7,
      maxBudgetCny: 1,
    }).error,
    "单次最多运行 6 条评测。",
  );
  assert.deepEqual(
    validateEvaluationBatchRequest({
      confirmed: true,
      datasetVersion: "2.0.0",
      caseIds: ["RS-V2-C1-D01"],
      variants: ["dynamic"],
      trials: [1],
      maxRuns: 1,
      maxBudgetCny: 1,
    }),
    { value: { datasetVersion: "2.0.0", caseIds: ["RS-V2-C1-D01"], variants: ["dynamic"], trials: [1], maxRuns: 1, maxBudgetCny: 1 } },
  );
});

test("人工复核只接受完整的五维评分与有限长度的备注", () => {
  assert.equal(
    validateHumanReview({ reviewer: "产品", rubric: { taskCompletion: 5 }, notes: "遗漏字段" }).error,
    "人工复核需要提供五项 1–5 分评分。",
  );
  assert.deepEqual(
    validateHumanReview({
      reviewer: "产品",
      rubric: { taskCompletion: 5, constraintSatisfaction: 4, factualGrounding: 4, executability: 3, interactionQuality: 5 },
      notes: "遗漏了轮椅出入口信息。",
    }),
    {
      value: {
        reviewer: "产品",
        rubric: { taskCompletion: 5, constraintSatisfaction: 4, factualGrounding: 4, executability: 3, interactionQuality: 5 },
        notes: "遗漏了轮椅出入口信息。",
        correctionOfRunId: null,
      },
    },
  );
});

test("评测迁移只新增独立记录表，日常运行列表不依赖缺失的反馈时间列", async () => {
  const migrationName = (await readdir(path.join(projectRoot, "drizzle"))).find(
    (name) => /^0001_.*\.sql$/.test(name),
  );
  assert.ok(migrationName, "应生成评测记录的首个增量迁移文件");
  const [migration, runRecordsSource] = await Promise.all([
    readFile(path.join(projectRoot, "drizzle", migrationName), "utf8"),
    readFile(path.join(projectRoot, "db", "run-records.ts"), "utf8"),
  ]);

  assert.match(migration, /CREATE TABLE `evaluation_runs`/i);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM model_runs|UPDATE model_runs/i);
  assert.doesNotMatch(migration, /ARK_(?:API_KEY|MODEL_[A-Z_]+)\s*=/);

  const recentRecordsFunction = runRecordsSource.match(
    /export async function listRecentRunRecords[\s\S]*?(?=\nexport async function updateRunFeedback)/,
  )?.[0] ?? "";
  assert.match(recentRecordsFunction, /\.select\(\{/);
  assert.doesNotMatch(recentRecordsFunction, /feedbackUpdatedAt/);
});
