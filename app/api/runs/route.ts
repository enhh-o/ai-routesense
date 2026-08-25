import {
  FEEDBACK_VALUES,
  listRecentRunRecords,
  updateRunFeedback,
  type RunFeedback,
} from "../../../db/run-records";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") || 20);

  try {
    const runs = await listRecentRunRecords(
      Number.isFinite(requestedLimit) ? requestedLimit : 20,
    );
    return Response.json({ runs });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "运行记录暂时无法读取。",
      },
      { status: 503 },
    );
  }
}

export async function PATCH(request: Request) {
  let payload: { runId?: unknown; feedback?: unknown };
  try {
    payload = (await request.json()) as {
      runId?: unknown;
      feedback?: unknown;
    };
  } catch {
    return Response.json({ error: "请求内容不是有效的 JSON。" }, { status: 400 });
  }

  const runId = typeof payload.runId === "string" ? payload.runId.trim() : "";
  const feedback =
    typeof payload.feedback === "string" ? payload.feedback.trim() : "";
  if (!runId) {
    return Response.json({ error: "缺少运行记录编号。" }, { status: 400 });
  }
  if (!FEEDBACK_VALUES.includes(feedback as RunFeedback)) {
    return Response.json({ error: "反馈类型无效。" }, { status: 400 });
  }

  try {
    await updateRunFeedback(runId, feedback as RunFeedback);
    return Response.json({ ok: true, runId, feedback });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "反馈暂时无法保存。",
      },
      { status: 503 },
    );
  }
}
