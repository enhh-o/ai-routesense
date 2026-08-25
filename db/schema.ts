import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const modelRuns = sqliteTable(
  "model_runs",
  {
    id: text("id").primaryKey(),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
    status: text("status").notNull(),
    mode: text("mode").notNull(),
    provider: text("provider").notNull(),
    query: text("query").notNull(),
    historyJson: text("history_json"),
    promptVersion: text("prompt_version").notNull(),
    systemPrompt: text("system_prompt"),
    routeTier: text("route_tier").notNull(),
    routeDecisionJson: text("route_decision_json").notNull(),
    modelName: text("model_name").notNull(),
    requestPayloadJson: text("request_payload_json"),
    rawResponseJson: text("raw_response_json"),
    answer: text("answer"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    latencyMs: integer("latency_ms"),
    httpStatus: integer("http_status"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    feedback: text("feedback"),
    feedbackUpdatedAt: text("feedback_updated_at"),
  },
  (table) => [
    index("model_runs_created_at_idx").on(table.createdAt),
    index("model_runs_status_idx").on(table.status),
    index("model_runs_model_name_idx").on(table.modelName),
  ],
);

export type ModelRun = typeof modelRuns.$inferSelect;
export type NewModelRun = typeof modelRuns.$inferInsert;
