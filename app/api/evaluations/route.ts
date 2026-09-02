import taskDataset from "../../../evaluation/v2/routesense_eval_v2.json";
import {
  createEvaluationRunRecord,
  findEvaluationRunRecord,
  listEvaluationRunSummaries,
} from "../../../db/evaluation-records";
import { getConfiguredArkTiers } from "../../../lib/ark-client";
import { validateEvaluationBatchRequest } from "../../../lib/evaluation-api-guard";
import {
  runEvaluationTrial,
  type EvaluationTaskCard,
  type EvaluationTrialResult,
} from "../../../lib/evaluation-runner";
import {
  aggregateEvaluationRuns,
  aggregateEvaluationRunsByVariant,
} from "../../../lib/evaluation-score";
import type { EvaluationRun, EvaluationVariant } from "../../../lib/evaluation-types";

export const runtime = "edge";

const tasks = taskDataset.cases as EvaluationTaskCard[];
const variants: EvaluationVariant[] = ["all_mini", "all_lite", "all_pro", "dynamic"];

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function fromStoredRecord(record: Awaited<ReturnType<typeof findEvaluationRunRecord>>): EvaluationTrialResult | null {
  if (!record) return null;
  const attempts = parseJson(record.upgradeTraceJson, [] as EvaluationTrialResult["attempts"]);
  const score = parseJson(record.deterministicScoreJson, null as EvaluationTrialResult["score"]);
  return {
    id: record.id,
    datasetVersion: record.datasetVersion,
    caseId: record.caseId,
    variant: record.variant as EvaluationVariant,
    trial: record.trial,
    status: record.status as EvaluationTrialResult["status"],
    attempts,
    finalTier: (record.finalTier as EvaluationTrialResult["finalTier"]) ?? null,
    score,
    costCny: record.costCny ?? 0,
    latencyMs: record.latencyMs ?? 0,
    reviewRequired: record.humanReviewState === "required",
  };
}

function toSummaryRun(record: Awaited<ReturnType<typeof listEvaluationRunSummaries>>[number]): EvaluationRun {
  return {
    id: record.id,
    caseId: record.caseId,
    variant: record.variant as EvaluationVariant,
    trial: record.trial,
    status: record.status as EvaluationRun["status"],
    modelTier: (record.finalTier as EvaluationRun["modelTier"]) ?? undefined,
    score: parseJson(record.deterministicScoreJson, undefined),
    costCny: record.costCny ?? undefined,
    latencyMs: record.latencyMs ?? undefined,
    upgradeCount: parseJson(record.upgradeTraceJson, [] as unknown[]).length - 1,
  };
}

function safeRunResponse(result: EvaluationTrialResult) {
  return {
    id: result.id,
    caseId: result.caseId,
    variant: result.variant,
    trial: result.trial,
    status: result.status,
    finalTier: result.finalTier,
    score: result.score,
    costCny: result.costCny,
    latencyMs: result.latencyMs,
    reviewRequired: result.reviewRequired,
  };
}

export async function GET(request: Request) {
  const datasetVersion = new URL(request.url).searchParams.get("datasetVersion")?.trim() || taskDataset.version;
  try {
    const records = await listEvaluationRunSummaries({ datasetVersion });
    const expectedCaseIds = tasks
      .filter((task) => task.split === "holdout")
      .map((task) => task.case_id);
    const summary = aggregateEvaluationRuns({
      caseIds: expectedCaseIds,
      variants,
      trialsPerVariant: 3,
      runs: records.map(toSummaryRun),
    });
    const summaries = aggregateEvaluationRunsByVariant({
      caseIds: expectedCaseIds,
      variants,
      trialsPerVariant: 3,
      runs: records.map(toSummaryRun),
    });
    return Response.json({
      datasetVersion,
      summary,
      summaries,
      runs: records.map((record) => ({
        id: record.id,
        caseId: record.caseId,
        split: record.split,
        category: record.category,
        variant: record.variant,
        trial: record.trial,
        status: record.status,
        finalTier: record.finalTier,
        score: parseJson(record.deterministicScoreJson, null),
        failureTags: parseJson(record.failureTagsJson, [] as string[]),
        humanReview: parseJson(record.humanReviewJson, null),
        costCny: record.costCny,
        latencyMs: record.latencyMs,
        createdAt: record.createdAt,
        completedAt: record.completedAt,
      })),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "评测记录暂时无法读取。" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "请求内容不是有效的 JSON。" }, { status: 400 });
  }
  const validation = validateEvaluationBatchRequest(payload);
  if ("error" in validation) return Response.json({ error: validation.error }, { status: 400 });
  const { datasetVersion, caseIds, variants, trials, maxRuns, maxBudgetCny } = validation.value;
  const selectedTasks = caseIds.map((caseId) => tasks.find((task) => task.case_id === caseId)).filter(Boolean) as EvaluationTaskCard[];
  if (selectedTasks.length !== caseIds.length) {
    return Response.json({ error: "包含不存在的评测任务。" }, { status: 400 });
  }
  if (getConfiguredArkTiers().length < 3) {
    return Response.json({ error: "三档模型尚未完成配置，未发起任何评测。" }, { status: 503 });
  }

  const planned = selectedTasks.flatMap((task) =>
    variants.flatMap((variant) => trials.map((trial) => ({ task, variant, trial }))),
  ).slice(0, maxRuns);
  const completed: ReturnType<typeof safeRunResponse>[] = [];
  let remainingBudget = maxBudgetCny;
  for (const item of planned) {
    try {
      const existing = fromStoredRecord(await findEvaluationRunRecord({
        datasetVersion,
        caseId: item.task.case_id,
        variant: item.variant,
        trial: item.trial,
      }));
      if (existing) {
        completed.push(safeRunResponse(existing));
        continue;
      }
      const result = await runEvaluationTrial({
        datasetVersion,
        caseId: item.task.case_id,
        variant: item.variant,
        trial: item.trial,
        budgetRemainingCny: remainingBudget,
        task: item.task,
        dependencies: {},
      });
      await createEvaluationRunRecord({
        id: result.id,
        evaluationId: `evaluation-${datasetVersion}`,
        datasetVersion,
        caseId: result.caseId,
        split: item.task.split,
        category: item.task.category,
        variant: result.variant,
        trial: result.trial,
        status: result.status,
        attemptCount: result.attempts.length,
        initialTier: result.attempts[0]?.tier,
        finalTier: result.finalTier,
        modelName: result.attempts.at(-1)?.model,
        routeVersion: "route-v1.4",
        promptVersion: "travel-executor-v8-compact-memory-structured-days",
        upgradeTraceJson: JSON.stringify(result.attempts),
        sanitizedRequestJson: JSON.stringify({ caseId: result.caseId, query: item.task.user_query }),
        answer: result.attempts.at(-1)?.answer,
        inputTokens: result.attempts.reduce((sum, attempt) => sum + (attempt.inputTokens ?? 0), 0),
        outputTokens: result.attempts.reduce((sum, attempt) => sum + (attempt.outputTokens ?? 0), 0),
        totalTokens: result.attempts.reduce((sum, attempt) => sum + (attempt.totalTokens ?? 0), 0),
        latencyMs: result.latencyMs,
        costCny: result.costCny,
        deterministicScoreJson: JSON.stringify(result.score),
        humanReviewState: result.reviewRequired ? "required" : "not_required",
        failureTagsJson: JSON.stringify(result.score?.failureTags ?? []),
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      completed.push(safeRunResponse(result));
      remainingBudget -= result.costCny;
      if (remainingBudget <= 0) break;
    } catch (error) {
      completed.push({
        id: `${datasetVersion}:${item.task.case_id}:${item.variant}:${item.trial}`,
        caseId: item.task.case_id,
        variant: item.variant,
        trial: item.trial,
        status: "failed",
        finalTier: null,
        score: null,
        costCny: 0,
        latencyMs: 0,
        reviewRequired: true,
      });
    }
  }
  return Response.json({ datasetVersion, requested: planned.length, completed });
}
