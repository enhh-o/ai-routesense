import type { EvaluationVariant } from "./evaluation-types.ts";

const ALLOWED_VARIANTS = new Set<EvaluationVariant>([
  "all_mini",
  "all_lite",
  "all_pro",
  "dynamic",
]);

type BatchRequest = {
  datasetVersion: string;
  caseIds: string[];
  variants: EvaluationVariant[];
  trials: number[];
  maxRuns: number;
  maxBudgetCny: number;
};

export function validateEvaluationBatchRequest(value: unknown):
  | { value: BatchRequest }
  | { error: string } {
  if (!value || typeof value !== "object") return { error: "请求内容不是有效的 JSON 对象。" };
  const input = value as Record<string, unknown>;
  if (input.confirmed !== true) return { error: "开始付费评测前需要明确确认。" };
  const datasetVersion = typeof input.datasetVersion === "string" ? input.datasetVersion.trim() : "";
  const caseIds = Array.isArray(input.caseIds)
    ? input.caseIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const variants = Array.isArray(input.variants)
    ? input.variants.filter((item): item is EvaluationVariant => typeof item === "string" && ALLOWED_VARIANTS.has(item as EvaluationVariant))
    : [];
  const trials = Array.isArray(input.trials)
    ? input.trials.filter((item): item is number => Number.isInteger(item) && item > 0)
    : [];
  const maxRuns = typeof input.maxRuns === "number" ? input.maxRuns : Number.NaN;
  const maxBudgetCny = typeof input.maxBudgetCny === "number" ? input.maxBudgetCny : Number.NaN;

  if (!datasetVersion || !caseIds.length || !variants.length || !trials.length) {
    return { error: "请提供数据集版本、任务、策略与试次。" };
  }
  if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 6) {
    return { error: "单次最多运行 6 条评测。" };
  }
  if (!Number.isFinite(maxBudgetCny) || maxBudgetCny <= 0 || maxBudgetCny > 20) {
    return { error: "单次预算必须大于 0 且不超过 ¥20。" };
  }
  return {
    value: { datasetVersion, caseIds, variants, trials, maxRuns, maxBudgetCny },
  };
}

const REVIEW_DIMENSIONS = [
  "taskCompletion",
  "constraintSatisfaction",
  "factualGrounding",
  "executability",
  "interactionQuality",
] as const;

export function validateHumanReview(value: unknown):
  | { value: { reviewer: string; rubric: Record<(typeof REVIEW_DIMENSIONS)[number], number>; notes: string; correctionOfRunId: string | null } }
  | { error: string } {
  if (!value || typeof value !== "object") return { error: "请求内容不是有效的 JSON 对象。" };
  const input = value as Record<string, unknown>;
  const reviewer = typeof input.reviewer === "string" ? input.reviewer.trim() : "";
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  const rubric = input.rubric && typeof input.rubric === "object"
    ? input.rubric as Record<string, unknown>
    : null;
  if (!reviewer || !rubric || REVIEW_DIMENSIONS.some((key) => !Number.isInteger(rubric[key]) || Number(rubric[key]) < 1 || Number(rubric[key]) > 5)) {
    return { error: "人工复核需要提供五项 1–5 分评分。" };
  }
  if (notes.length > 2_000) return { error: "人工复核备注不能超过 2,000 字。" };
  const correctionOfRunId = typeof input.correctionOfRunId === "string" && input.correctionOfRunId.trim()
    ? input.correctionOfRunId.trim()
    : null;
  return {
    value: {
      reviewer,
      rubric: Object.fromEntries(REVIEW_DIMENSIONS.map((key) => [key, Number(rubric[key])])) as Record<(typeof REVIEW_DIMENSIONS)[number], number>,
      notes,
      correctionOfRunId,
    },
  };
}
