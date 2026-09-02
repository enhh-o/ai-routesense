import {
  ArkCompletionError,
  getArkModelForTier,
  invokeArkCompletion,
  type ArkCompletionResult,
} from "./ark-client.ts";
import {
  calculateModelCost,
  nextUpgradeTier,
} from "./evaluation-score.ts";
import type {
  EvaluationModelTier,
  EvaluationScore,
  EvaluationVariant,
} from "./evaluation-types.ts";
import { routeQuery } from "./routesense.ts";
import { buildTravelSystemPrompt } from "./travel-prompt.ts";

export interface EvaluationTaskCard {
  case_id: string;
  category: string;
  split: string;
  user_query: string;
  expected_route: {
    required_strategies: string[];
    minimum_model_tier: EvaluationModelTier;
  };
  hard_constraints: string[];
  critical_assertions: string[];
  quality_assertions: string[];
  prohibited_behaviors: string[];
  context?: { tool_fixture?: unknown };
}

export interface EvaluationAttempt {
  tier: EvaluationModelTier;
  model: string;
  answer: string;
  score: EvaluationScore;
  failureContext?: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  costCny: number;
}

export interface EvaluationTrialResult {
  id: string;
  datasetVersion: string;
  caseId: string;
  variant: EvaluationVariant;
  trial: number;
  status: "completed" | "failed" | "blocked_budget";
  attempts: EvaluationAttempt[];
  finalTier: EvaluationModelTier | null;
  score: EvaluationScore | null;
  costCny: number;
  latencyMs: number;
  reviewRequired: boolean;
}

type TrialDependencies = {
  loadExisting?: () => Promise<EvaluationTrialResult | null>;
  invoke?: (input: {
    model: string | null;
    systemPrompt: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    maxTokens: number;
    thinkingMode?: "disabled" | "enabled";
  }) => Promise<ArkCompletionResult>;
  modelForTier?: (tier: EvaluationModelTier) => string | null;
  check?: (input: {
    task: EvaluationTaskCard;
    tier: EvaluationModelTier;
    answer: string;
    strategies: string[];
  }) => EvaluationScore;
};

const FIXED_TIER: Record<Exclude<EvaluationVariant, "dynamic">, EvaluationModelTier> = {
  all_mini: "small",
  all_lite: "general",
  all_pro: "reasoning",
};

const TIER_RANK: Record<EvaluationModelTier, number> = {
  small: 1,
  general: 2,
  reasoning: 3,
};

function checkAnswer({ task, tier, strategies }: Parameters<NonNullable<TrialDependencies["check"]>>[0]): EvaluationScore {
  const missingStrategies = task.expected_route.required_strategies.filter(
    (strategy) => !strategies.includes(strategy),
  );
  const tierTooLow = TIER_RANK[tier] < TIER_RANK[task.expected_route.minimum_model_tier];
  const failureTags = [
    ...missingStrategies.map((strategy) => `missing_strategy:${strategy}`),
    ...(tierTooLow ? ["insufficient_model_tier"] : []),
  ];
  return {
    passed: failureTags.length === 0,
    qualityScore: failureTags.length === 0 ? 0.8 : 0.3,
    failureTags,
  };
}

function failureContext(score: EvaluationScore) {
  return score.failureTags.length
    ? `hard constraint check failed: ${score.failureTags.join(", ")}`
    : "hard constraint check failed";
}

export async function runEvaluationTrial({
  datasetVersion,
  caseId,
  variant,
  trial,
  budgetRemainingCny,
  task,
  dependencies = {},
}: {
  datasetVersion: string;
  caseId: string;
  variant: EvaluationVariant;
  trial: number;
  budgetRemainingCny: number;
  task: EvaluationTaskCard;
  dependencies?: TrialDependencies;
}): Promise<EvaluationTrialResult> {
  const id = `${datasetVersion}:${caseId}:${variant}:${trial}`;
  const existing = await dependencies.loadExisting?.();
  if (existing) return existing;
  if (budgetRemainingCny <= 0) {
    return {
      id,
      datasetVersion,
      caseId,
      variant,
      trial,
      status: "blocked_budget",
      attempts: [],
      finalTier: null,
      score: null,
      costCny: 0,
      latencyMs: 0,
      reviewRequired: false,
    };
  }

  const route = routeQuery(task.user_query, undefined, {
    toolResult: task.context?.tool_fixture,
  });
  const invoke = dependencies.invoke ?? invokeArkCompletion;
  const modelForTier = dependencies.modelForTier ?? getArkModelForTier;
  const check = dependencies.check ?? checkAnswer;
  const attempts: EvaluationAttempt[] = [];
  let tier: EvaluationModelTier = variant === "dynamic"
    ? route.initialTier
    : FIXED_TIER[variant];
  let previousAnswer: string | null = null;
  let previousFailure: string | null = null;

  while (true) {
    const model = modelForTier(tier);
    if (!model) {
      return {
        id,
        datasetVersion,
        caseId,
        variant,
        trial,
        status: "failed",
        attempts,
        finalTier: attempts.at(-1)?.tier ?? null,
        score: attempts.at(-1)?.score ?? null,
        costCny: attempts.reduce((sum, attempt) => sum + attempt.costCny, 0),
        latencyMs: attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
        reviewRequired: true,
      };
    }

    const messages = previousAnswer && previousFailure
      ? [
          { role: "assistant" as const, content: previousAnswer },
          {
            role: "user" as const,
            content: `上一版未满足硬约束：${previousFailure}。请保留原始需求并针对该问题重新给出答案。\n\n原始需求：${task.user_query}`,
          },
        ]
      : [{ role: "user" as const, content: task.user_query }];

    try {
      const completion = await invoke({
        model,
        systemPrompt: buildTravelSystemPrompt({
          decision: route,
          toolResult: task.context?.tool_fixture,
        }),
        messages,
        maxTokens: 1_200,
        // 修复原因：开发集校准显示强推理档在显式传入 `thinking: enabled`
        // 时无法返回结果，而正式对话已验证为省略该字段。
        // 修改目的：让评测与用户实际使用的调用方式一致，避免把接口兼容性
        // 问题误判成模型能力或路由质量问题。
        thinkingMode: tier === "reasoning" ? undefined : "disabled",
      });
      const score = check({
        task,
        tier,
        answer: completion.answer,
        strategies: route.strategies,
      });
      const costCny = calculateModelCost(
        tier,
        completion.inputTokens ?? 0,
        completion.outputTokens ?? 0,
      );
      attempts.push({
        tier,
        model,
        answer: completion.answer,
        score,
        failureContext: previousFailure ?? undefined,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        totalTokens: completion.totalTokens,
        latencyMs: completion.latencyMs,
        costCny,
      });

      const nextTier = variant === "dynamic" && !score.passed
        ? nextUpgradeTier(tier)
        : null;
      if (nextTier) {
        previousAnswer = completion.answer;
        previousFailure = failureContext(score);
        tier = nextTier;
        continue;
      }

      return {
        id,
        datasetVersion,
        caseId,
        variant,
        trial,
        status: "completed",
        attempts,
        finalTier: tier,
        score,
        costCny: attempts.reduce((sum, attempt) => sum + attempt.costCny, 0),
        latencyMs: attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
        reviewRequired: task.category === "safety_security" || attempts.length >= 3 || !score.passed,
      };
    } catch (error) {
      // 只记录定位调用问题所需的结构化信息；不写入用户原文、请求体、密钥或供应商原始报错。
      console.error("RouteSense evaluation model call failed", {
        caseId,
        variant,
        tier,
        errorType: error instanceof Error ? error.name : "UnknownError",
        httpStatus: error instanceof ArkCompletionError ? error.status : null,
      });
      return {
        id,
        datasetVersion,
        caseId,
        variant,
        trial,
        status: "failed",
        attempts,
        finalTier: attempts.at(-1)?.tier ?? null,
        score: attempts.at(-1)?.score ?? null,
        costCny: attempts.reduce((sum, attempt) => sum + attempt.costCny, 0),
        latencyMs: attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
        reviewRequired: true,
      };
    }
  }
}
