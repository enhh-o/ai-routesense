import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./index";
import {
  evaluationRuns,
  type EvaluationRunRecord,
  type NewEvaluationRunRecord,
} from "./schema";

export type EvaluationRunSummary = Pick<
  EvaluationRunRecord,
  | "id"
  | "evaluationId"
  | "datasetVersion"
  | "caseId"
  | "split"
  | "category"
  | "variant"
  | "trial"
  | "status"
  | "attemptCount"
  | "initialTier"
  | "finalTier"
  | "modelName"
  | "routeVersion"
  | "promptVersion"
  | "routeDecisionJson"
  | "upgradeTraceJson"
  | "answer"
  | "providerMetadataJson"
  | "inputTokens"
  | "outputTokens"
  | "totalTokens"
  | "latencyMs"
  | "httpStatus"
  | "costCny"
  | "deterministicScoreJson"
  | "judgeScoreJson"
  | "humanReviewJson"
  | "humanReviewState"
  | "failureTagsJson"
  | "correctionOfRunId"
  | "createdAt"
  | "startedAt"
  | "completedAt"
>;

export async function createEvaluationRunRecord(record: NewEvaluationRunRecord) {
  const db = await getDb();
  await db.insert(evaluationRuns).values(record);
}

export async function findEvaluationRunRecord({
  datasetVersion,
  caseId,
  variant,
  trial,
}: Pick<
  NewEvaluationRunRecord,
  "datasetVersion" | "caseId" | "variant" | "trial"
>) {
  const db = await getDb();
  const [record] = await db
    .select()
    .from(evaluationRuns)
    .where(
      and(
        eq(evaluationRuns.datasetVersion, datasetVersion),
        eq(evaluationRuns.caseId, caseId),
        eq(evaluationRuns.variant, variant),
        eq(evaluationRuns.trial, trial),
      ),
    )
    .limit(1);

  return record ?? null;
}

export async function listEvaluationRunSummaries({
  datasetVersion,
  limit = 100,
}: {
  datasetVersion: string;
  limit?: number;
}): Promise<EvaluationRunSummary[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
  const db = await getDb();
  return db
    .select({
      id: evaluationRuns.id,
      evaluationId: evaluationRuns.evaluationId,
      datasetVersion: evaluationRuns.datasetVersion,
      caseId: evaluationRuns.caseId,
      split: evaluationRuns.split,
      category: evaluationRuns.category,
      variant: evaluationRuns.variant,
      trial: evaluationRuns.trial,
      status: evaluationRuns.status,
      attemptCount: evaluationRuns.attemptCount,
      initialTier: evaluationRuns.initialTier,
      finalTier: evaluationRuns.finalTier,
      modelName: evaluationRuns.modelName,
      routeVersion: evaluationRuns.routeVersion,
      promptVersion: evaluationRuns.promptVersion,
      routeDecisionJson: evaluationRuns.routeDecisionJson,
      upgradeTraceJson: evaluationRuns.upgradeTraceJson,
      answer: evaluationRuns.answer,
      providerMetadataJson: evaluationRuns.providerMetadataJson,
      inputTokens: evaluationRuns.inputTokens,
      outputTokens: evaluationRuns.outputTokens,
      totalTokens: evaluationRuns.totalTokens,
      latencyMs: evaluationRuns.latencyMs,
      httpStatus: evaluationRuns.httpStatus,
      costCny: evaluationRuns.costCny,
      deterministicScoreJson: evaluationRuns.deterministicScoreJson,
      judgeScoreJson: evaluationRuns.judgeScoreJson,
      humanReviewJson: evaluationRuns.humanReviewJson,
      humanReviewState: evaluationRuns.humanReviewState,
      failureTagsJson: evaluationRuns.failureTagsJson,
      correctionOfRunId: evaluationRuns.correctionOfRunId,
      createdAt: evaluationRuns.createdAt,
      startedAt: evaluationRuns.startedAt,
      completedAt: evaluationRuns.completedAt,
    })
    .from(evaluationRuns)
    .where(eq(evaluationRuns.datasetVersion, datasetVersion))
    .orderBy(desc(evaluationRuns.createdAt))
    .limit(safeLimit);
}
