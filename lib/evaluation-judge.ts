import type { EvaluationScore } from "./evaluation-types.ts";
import type { EvaluationTaskCard } from "./evaluation-runner.ts";

export interface BlindJudgeResult {
  taskCompletion: number;
  constraintSatisfaction: number;
  factualGrounding: number;
  executability: number;
  interactionQuality: number;
  criticalFailure: boolean;
  finding: string;
  qualityScore: number;
  passed: boolean;
  reviewRequired: boolean;
}

export function buildBlindJudgePrompt({
  task,
  answer,
  deterministicScore,
  toolTrace,
}: {
  task: EvaluationTaskCard;
  answer: string;
  deterministicScore: EvaluationScore;
  toolTrace: unknown;
}) {
  return [
    "你是独立质量评审。只根据任务要求、回答和校验信息评分。",
    "不得推断生成该回答的系统、模型、价格或执行过程。",
    `用户需求：${task.user_query}`,
    `硬约束：${task.hard_constraints.join("；") || "无"}`,
    `关键检查：${task.critical_assertions.join("；")}`,
    `禁止行为：${task.prohibited_behaviors.join("；")}`,
    `确定性校验：${JSON.stringify(deterministicScore)}`,
    `工具轨迹：${JSON.stringify(toolTrace)}`,
    `待评回答：${answer}`,
    "只返回 JSON：taskCompletion、constraintSatisfaction、factualGrounding、executability、interactionQuality（均为 1–5 整数）、criticalFailure（布尔值）、finding（简短中文结论）。",
  ].join("\n");
}

export function parseBlindJudgeAnswer(answer: string): BlindJudgeResult | null {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(answer) as Record<string, unknown>;
  } catch {
    return null;
  }
  const dimensions = [
    "taskCompletion",
    "constraintSatisfaction",
    "factualGrounding",
    "executability",
    "interactionQuality",
  ] as const;
  if (
    dimensions.some(
      (key) => !Number.isInteger(value[key]) || Number(value[key]) < 1 || Number(value[key]) > 5,
    ) ||
    typeof value.criticalFailure !== "boolean" ||
    typeof value.finding !== "string" ||
    !value.finding.trim() ||
    value.finding.length > 500
  ) {
    return null;
  }
  const qualityScore = Number(
    (dimensions.reduce((sum, key) => sum + Number(value[key]), 0) / (dimensions.length * 5)).toFixed(2),
  );
  const passed = !value.criticalFailure && qualityScore >= 0.7;
  return {
    taskCompletion: Number(value.taskCompletion),
    constraintSatisfaction: Number(value.constraintSatisfaction),
    factualGrounding: Number(value.factualGrounding),
    executability: Number(value.executability),
    interactionQuality: Number(value.interactionQuality),
    criticalFailure: value.criticalFailure,
    finding: value.finding.trim(),
    qualityScore,
    passed,
    reviewRequired: !passed,
  };
}
