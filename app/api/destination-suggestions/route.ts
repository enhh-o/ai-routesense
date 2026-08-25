export const runtime = "edge";

interface Suggestion {
  destination: string;
  region: string;
  summary: string;
  reasons: string[];
  tags: string[];
  travelTimeEstimate: string;
  recommendedTransport: string;
}

interface ArkChatResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
  error?: { message?: string };
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseSuggestions(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型未返回可解析的推荐结果");
  const parsed = JSON.parse(candidate.slice(start, end + 1)) as {
    suggestions?: unknown;
  };
  if (!Array.isArray(parsed.suggestions)) {
    throw new Error("模型推荐结果缺少目的地列表");
  }
  const suggestions = parsed.suggestions
    .slice(0, 4)
    .map((item): Suggestion | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const destination = cleanText(record.destination, 50);
      if (!destination) return null;
      return {
        destination,
        region: cleanText(record.region, 50),
        summary: cleanText(record.summary, 180),
        reasons: Array.isArray(record.reasons)
          ? record.reasons
              .map((value) => cleanText(value, 100))
              .filter(Boolean)
              .slice(0, 3)
          : [],
        tags: Array.isArray(record.tags)
          ? record.tags
              .map((value) => cleanText(value, 20))
              .filter(Boolean)
              .slice(0, 5)
          : [],
        travelTimeEstimate: cleanText(record.travelTimeEstimate, 60),
        recommendedTransport: cleanText(record.recommendedTransport, 40),
      };
    })
    .filter((item): item is Suggestion => Boolean(item));
  if (suggestions.length < 2) throw new Error("模型返回的有效目的地不足");
  return suggestions;
}

function buildSuggestionMessages(
  origin: string,
  scope: string,
  interests: string[],
  transportModes: string[],
  maxTravelTime: string,
  extra: string,
  invalidOutput = "",
) {
  return [
    {
      role: "system",
      content: [
        "你是旅游目的地初筛助手，只完成低风险、低成本的候选目的地推荐。",
        "严格遵守用户选择的出行范围。市内游只能推荐出发城市行政范围内地点；省内游只能推荐同省其他城市或景区；省外游推荐外省目的地。",
        "不要编造实时票价、开放状态、天气或精确班次。交通时间只给常识性区间，并明确是估算。",
        "只返回一个有效 JSON 对象，不要 Markdown、注释或额外文字。所有键和值都必须使用英文半角双引号，字符串中的双引号必须转义。",
        "结构必须为 {\"suggestions\":[{\"destination\":\"目的地\",\"region\":\"所属城市/省份\",\"summary\":\"一句话定位\",\"reasons\":[\"理由1\",\"理由2\"],\"tags\":[\"标签1\",\"标签2\"],\"travelTimeEstimate\":\"常识性时间区间（估算）\",\"recommendedTransport\":\"建议采用的可行出行方式\"}]}。",
        "候选目的地必须同时满足出行范围、用户勾选的交通方式和最长通行时长。若约束无法同时满足，应推荐更近的目的地，不能擅自使用未勾选的交通方式。",
        "给出 4 个差异明显的候选项，避免体验高度同质化。",
        invalidOutput
          ? "上一轮输出不是合法 JSON。请重新生成完整对象，不要解释错误。"
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    {
      role: "user",
      content: [
        `出发地：${origin}`,
        `范围：${scope}`,
        `旅行兴趣：${interests.length ? interests.join("、") : "未指定，做综合推荐"}`,
        `可接受交通方式：${transportModes.length ? transportModes.join("、") : "未指定，可综合判断"}`,
        `可接受单程通行时长：${maxTravelTime || "未限定"}`,
        `补充偏好：${extra || "无"}`,
        invalidOutput ? `格式错误的上一轮输出（仅供纠错）：${invalidOutput.slice(0, 2500)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

export async function POST(request: Request) {
  let payload: {
    origin?: unknown;
    scope?: unknown;
    interests?: unknown;
    transportModes?: unknown;
    maxTravelTime?: unknown;
    extra?: unknown;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return Response.json({ error: "请求内容不是有效的 JSON。" }, { status: 400 });
  }

  const origin = cleanText(payload.origin, 80);
  const scope = cleanText(payload.scope, 20);
  const interests = Array.isArray(payload.interests)
    ? payload.interests
        .map((value) => cleanText(value, 30))
        .filter(Boolean)
        .slice(0, 10)
    : [];
  const extra = cleanText(payload.extra, 500);
  if (!origin || !["市内游", "省内游", "省外游"].includes(scope)) {
    return Response.json(
      { error: "请先确认出发地和出行范围。" },
      { status: 400 },
    );
  }
  const allowedTransportByScope: Record<string, string[]> = {
    市内游: ["地铁", "公交", "打车", "自驾"],
    省内游: ["高铁", "普通火车", "自驾", "长途汽车"],
    省外游: ["飞机", "高铁", "普通火车", "自驾"],
  };
  const transportModes = Array.isArray(payload.transportModes)
    ? payload.transportModes
        .map((value) => cleanText(value, 20))
        .filter((value) => allowedTransportByScope[scope]?.includes(value))
        .slice(0, 4)
    : [];
  const allowedTravelTimeByScope: Record<string, string[]> = {
    市内游: ["30 分钟内", "1 小时内", "2 小时内"],
    省内游: ["2 小时内", "4 小时内", "6 小时内"],
    省外游: ["3 小时内", "6 小时内", "10 小时内"],
  };
  const requestedMaxTravelTime = cleanText(payload.maxTravelTime, 20);
  const maxTravelTime = allowedTravelTimeByScope[scope]?.includes(
    requestedMaxTravelTime,
  )
    ? requestedMaxTravelTime
    : "";

  const apiKey = process.env.ARK_API_KEY?.trim();
  const model =
    process.env.ARK_MODEL_SMALL?.trim() || process.env.ARK_MODEL?.trim();
  if (!apiKey || !model) {
    return Response.json(
      { error: "轻量模型尚未配置，暂时无法生成目的地建议。" },
      { status: 503 },
    );
  }

  const configuredBaseUrl =
    process.env.ARK_BASE_URL?.trim() ||
    "https://ark.cn-beijing.volces.com/api/v3/responses";
  const chatUrl = configuredBaseUrl.endsWith("/responses")
    ? `${configuredBaseUrl.slice(0, -"/responses".length)}/chat/completions`
    : configuredBaseUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    let invalidOutput = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await fetch(chatUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: buildSuggestionMessages(
            origin,
            scope,
            interests,
            transportModes,
            maxTravelTime,
            extra,
            invalidOutput,
          ),
          thinking: { type: "disabled" },
          max_tokens: 1100,
        }),
        signal: controller.signal,
      });
      const body = (await response.json()) as ArkChatResponse;
      if (!response.ok) {
        throw new Error(body.error?.message || `轻量模型返回 HTTP ${response.status}`);
      }
      const content = body.choices?.[0]?.message?.content?.trim() || "";
      try {
        const suggestions = parseSuggestions(content);
        return Response.json({ suggestions, modelTier: "small", attempts: attempt });
      } catch {
        invalidOutput = content;
      }
    }
    throw new Error("模型连续两次未返回合法的目的地列表");
  } catch (error) {
    return Response.json(
      {
        error: "目的地推荐暂时未返回有效结果，请点击重试。",
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
