import { saveEvaluationHumanReview } from "../../../../db/evaluation-records";
import { validateHumanReview } from "../../../../lib/evaluation-api-guard";

export const runtime = "edge";

export async function PATCH(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "请求内容不是有效的 JSON。" }, { status: 400 });
  }
  const runId = typeof payload.runId === "string" ? payload.runId.trim() : "";
  if (!runId) return Response.json({ error: "缺少评测记录编号。" }, { status: 400 });
  const validation = validateHumanReview(payload);
  if ("error" in validation) return Response.json({ error: validation.error }, { status: 400 });
  try {
    await saveEvaluationHumanReview({
      runId,
      reviewJson: JSON.stringify(validation.value),
      correctionOfRunId: validation.value.correctionOfRunId,
    });
    return Response.json({ ok: true, runId });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "人工复核暂时无法保存。" },
      { status: 503 },
    );
  }
}
