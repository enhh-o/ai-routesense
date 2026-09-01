import { desc, eq } from "drizzle-orm";
import { getDb } from "./index";
import { modelRuns, type NewModelRun } from "./schema";

export const FEEDBACK_VALUES = [
  "resolved",
  "unresolved",
  "missing",
  "generic",
  "inaccurate",
  "overkill",
] as const;

export type RunFeedback = (typeof FEEDBACK_VALUES)[number];

export async function createRunRecord(record: NewModelRun) {
  const db = await getDb();
  await db.insert(modelRuns).values(record);
}

export async function safeCreateRunRecord(record: NewModelRun) {
  try {
    await createRunRecord(record);
    return true;
  } catch (error) {
    console.error(
      "RouteSense failed to persist a model run.",
      error instanceof Error ? error.message : "Unknown database error",
    );
    return false;
  }
}

export async function listRecentRunRecords(limit = 20) {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const db = await getDb();
  return db
    .select({
      id: modelRuns.id,
      createdAt: modelRuns.createdAt,
      completedAt: modelRuns.completedAt,
      status: modelRuns.status,
      mode: modelRuns.mode,
      provider: modelRuns.provider,
      query: modelRuns.query,
      promptVersion: modelRuns.promptVersion,
      routeTier: modelRuns.routeTier,
      routeDecisionJson: modelRuns.routeDecisionJson,
      modelName: modelRuns.modelName,
      requestPayloadJson: modelRuns.requestPayloadJson,
      rawResponseJson: modelRuns.rawResponseJson,
      answer: modelRuns.answer,
      inputTokens: modelRuns.inputTokens,
      outputTokens: modelRuns.outputTokens,
      totalTokens: modelRuns.totalTokens,
      latencyMs: modelRuns.latencyMs,
      httpStatus: modelRuns.httpStatus,
      errorCode: modelRuns.errorCode,
      errorMessage: modelRuns.errorMessage,
      feedback: modelRuns.feedback,
    })
    .from(modelRuns)
    .orderBy(desc(modelRuns.createdAt))
    .limit(safeLimit);
}

export async function updateRunFeedback(
  runId: string,
  feedback: RunFeedback,
) {
  const db = await getDb();
  const result = await db
    .update(modelRuns)
    .set({
      feedback,
      feedbackUpdatedAt: new Date().toISOString(),
    })
    .where(eq(modelRuns.id, runId));

  return result;
}
