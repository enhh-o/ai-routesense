import type { ModelTier } from "./routesense";

const ARK_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3/responses";
const REQUEST_TIMEOUT_MS = 45_000;
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

export interface ArkEnvironment {
  ARK_API_KEY?: string;
  ARK_BASE_URL?: string;
  ARK_MODEL?: string;
  ARK_MODEL_SMALL?: string;
  ARK_MODEL_GENERAL?: string;
  ARK_MODEL_REASONING?: string;
}

export interface ArkMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ArkCompletionResult {
  answer: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  httpStatus: number;
  latencyMs: number;
  providerMetadata: Record<string, unknown>;
}

export class ArkConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArkConfigurationError";
  }
}

export class ArkCompletionError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ArkCompletionError";
    this.status = status;
  }
}

function cleanValue(value: string | undefined) {
  return value?.trim() || null;
}

function getDedicatedArkModelForTier(
  tier: ModelTier,
  environment: ArkEnvironment = process.env,
) {
  const models: Record<ModelTier, string | null> = {
    small: cleanValue(environment.ARK_MODEL_SMALL) || cleanValue(environment.ARK_MODEL),
    general: cleanValue(environment.ARK_MODEL_GENERAL),
    reasoning: cleanValue(environment.ARK_MODEL_REASONING),
  };
  return models[tier];
}

export function getArkModelForTier(
  tier: ModelTier,
  environment: ArkEnvironment = process.env,
) {
  const dedicated = getDedicatedArkModelForTier(tier, environment);
  if (dedicated) return dedicated;
  if (tier === "reasoning") {
    return (
      getDedicatedArkModelForTier("general", environment) ||
      getDedicatedArkModelForTier("small", environment)
    );
  }
  if (tier === "general") return getDedicatedArkModelForTier("small", environment);
  return null;
}

export function getConfiguredArkTiers(environment: ArkEnvironment = process.env) {
  return (["small", "general", "reasoning"] as ModelTier[]).filter((tier) =>
    Boolean(getDedicatedArkModelForTier(tier, environment)),
  );
}

function toChatCompletionsUrl(baseUrl: string | undefined) {
  const configured = cleanValue(baseUrl) || ARK_DEFAULT_BASE_URL;
  if (configured.endsWith("/chat/completions")) return configured;
  return configured.endsWith("/responses")
    ? `${configured.slice(0, -"/responses".length)}/chat/completions`
    : configured;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(response: Response) {
  const retryAfter = Number(response.headers.get("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter * 1_000, 5_000)
    : 800;
}

export async function invokeArkCompletion({
  model,
  systemPrompt,
  messages,
  maxTokens,
  thinkingMode,
  reasoningEffort,
  timeoutMs,
  signal,
  environment = process.env,
}: {
  model: string | null;
  systemPrompt: string;
  messages: ArkMessage[];
  maxTokens: number;
  thinkingMode?: "disabled" | "enabled";
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  timeoutMs?: number;
  signal?: AbortSignal;
  environment?: ArkEnvironment;
}): Promise<ArkCompletionResult> {
  const apiKey = cleanValue(environment.ARK_API_KEY);
  if (!apiKey || !model) {
    throw new ArkConfigurationError("模型服务尚未完成密钥或模型映射配置。");
  }

  const timeoutController = new AbortController();
  const relayAbort = () => timeoutController.abort();
  signal?.addEventListener("abort", relayAbort, { once: true });
  const requestTimeoutMs = Number.isFinite(timeoutMs) && (timeoutMs ?? 0) > 0
    ? timeoutMs
    : REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => timeoutController.abort(), requestTimeoutMs);
  const requestBody: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    stream: false,
    max_tokens: maxTokens,
  };
  if (thinkingMode) requestBody.thinking = { type: thinkingMode };
  if (reasoningEffort) requestBody.reasoning_effort = reasoningEffort;
  const startedAt = Date.now();

  try {
    let response: Response | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      response = await fetch(toChatCompletionsUrl(environment.ARK_BASE_URL), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: timeoutController.signal,
      });
      if (response.ok) break;
      if (attempt === 1 && RETRYABLE_HTTP_STATUSES.has(response.status)) {
        await wait(retryDelay(response));
        continue;
      }
      throw new ArkCompletionError(`模型服务返回 HTTP ${response.status}。`, response.status);
    }

    if (!response?.ok) {
      throw new ArkCompletionError("模型服务没有返回可用响应。", 502);
    }
    const body = (await response.json()) as {
      id?: unknown;
      model?: unknown;
      created?: unknown;
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
    };
    const answer = body.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) {
      throw new ArkCompletionError("模型没有返回可展示的文本。", response.status);
    }
    const inputTokens = typeof body.usage?.prompt_tokens === "number" ? body.usage.prompt_tokens : null;
    const outputTokens = typeof body.usage?.completion_tokens === "number" ? body.usage.completion_tokens : null;
    const totalTokens = typeof body.usage?.total_tokens === "number" ? body.usage.total_tokens : null;
    return {
      answer: answer.trim(),
      inputTokens,
      outputTokens,
      totalTokens,
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      providerMetadata: {
        id: body.id ?? null,
        model: body.model ?? model,
        created: body.created ?? null,
      },
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", relayAbort);
  }
}
