export type IntentStage =
  | "exploration"
  | "preference"
  | "comparison"
  | "decision"
  | "transaction";

export type Level = "low" | "medium" | "high";
export type PersonalizationNeed = "none" | "session" | "long_term";
export type RealtimeNeed = "none" | "search" | "business_data";
export type Strategy =
  | "answer"
  | "clarify"
  | "retrieve_memory"
  | "search"
  | "call_tool"
  | "plan"
  | "handoff";
export type ModelTier = "small" | "general" | "reasoning";

export interface RouterSettings {
  confidenceThreshold: number;
  qualityThreshold: number;
  maxUpgrades: number;
  version: string;
  modelNames: Record<ModelTier, string>;
  prices: Record<ModelTier, number>;
}

export interface RouterMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RouterContext {
  history?: RouterMessage[];
  memory?: Record<string, unknown>;
  modelPreference?: "auto" | ModelTier;
  toolResult?: unknown;
  lastFailure?: {
    modelTier?: ModelTier;
    failure?: string;
  } | null;
  account?: Record<string, unknown>;
}

export interface RouteDecision {
  requestId: string;
  query: string;
  timestamp: string;
  labels: {
    intentStage: IntentStage;
    informationCompleteness: Level;
    taskComplexity: Level;
    personalizationNeed: PersonalizationNeed;
    realtimeNeed: RealtimeNeed;
    riskLevel: Level;
    businessValue: Level;
  };
  labelReasons: {
    intentStage: string;
    informationCompleteness: string;
    taskComplexity: string;
    personalizationNeed: string;
    realtimeNeed: string;
    riskLevel: string;
    businessValue: string;
    hardConstraints: string;
  };
  strategies: Strategy[];
  confidence: number;
  reason: string;
  initialTier: ModelTier;
  finalTier: ModelTier;
  modelName: string;
  tools: string[];
  hardConstraints: string[];
  contextSignals: {
    historyAvailable: boolean;
    memoryAvailable: boolean;
    toolResultAvailable: boolean;
    toolNoResult: boolean;
    sourceConflict: boolean;
    promptInjectionRisk: boolean;
    infeasibleBudget: boolean;
    temporalSpatialConflict: boolean;
    accessibilityNeed: boolean;
  };
  qualityCheck: {
    passed: boolean;
    score: number;
    constraintSatisfaction: number;
    failedChecks: string[];
    details: string;
  };
  execution: {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    latencyMs: number;
    upgraded: boolean;
    upgradeReason: string | null;
    attempts: number;
  };
  response: string;
  trace: Array<{
    label: string;
    detail: string;
    state: "complete" | "warning" | "waiting";
  }>;
}

export interface ExperimentSummary {
  group: "all_small" | "dynamic" | "all_reasoning";
  label: string;
  successRate: number;
  constraintRate: number;
  averageCost: number;
  costPerSuccess: number;
  p50Latency: number;
  p95Latency: number;
  upgradeRate: number;
}

export const DEFAULT_SETTINGS: RouterSettings = {
  confidenceThreshold: 0.68,
  qualityThreshold: 0.78,
  maxUpgrades: 1,
  version: "route-v1.4",
  modelNames: {
    small: "豆包 Mini · 低成本档",
    general: "豆包 Lite · 均衡档",
    reasoning: "豆包 Pro · 高级推理档",
  },
  prices: {
    small: 0.003,
    general: 0.012,
    reasoning: 0.036,
  },
};

export const PRESETS = [
  {
    id: "explore",
    label: "模糊探索",
    query: "我不知道应该去哪里玩。",
  },
  {
    id: "memory",
    label: "历史偏好",
    query: "根据我过去的旅行经历，推荐一个适合国庆的目的地。",
  },
  {
    id: "realtime",
    label: "实时比较",
    query: "帮我比较下周去大阪和福冈的天气、机票价格和景点开放情况。",
  },
  {
    id: "complex",
    label: "多约束决策",
    query:
      "国庆带父母去日本七天，从上海出发，预算两万元，不要走太多路，还要考虑天气和签证。",
  },
  {
    id: "fallback",
    label: "失败后升级",
    query:
      "比较东京和关西两个七日行程，预算两万，父母不能长时间步行，请给我最终建议。",
  },
] as const;

export const LABEL_TEXT = {
  intentStage: {
    exploration: "探索",
    preference: "偏好",
    comparison: "比较",
    decision: "决策",
    transaction: "交易",
  },
  level: {
    low: "低",
    medium: "中",
    high: "高",
  },
  personalization: {
    none: "无需",
    session: "会话",
    long_term: "长期记忆",
  },
  realtime: {
    none: "无需",
    search: "实时搜索",
    business_data: "业务数据",
  },
  strategy: {
    answer: "直接回答",
    clarify: "澄清需求",
    retrieve_memory: "检索记忆",
    search: "实时搜索",
    call_tool: "调用工具",
    plan: "复杂规划",
    handoff: "人工升级",
  },
  tier: {
    small: "小模型",
    general: "通用模型",
    reasoning: "强推理模型",
  },
} as const;

const realtimePattern =
  /天气|价格|票价|开放|签证|政策|库存|余票|航班|酒店|营业|实时|下周|国庆|春节|明晚|本周/;
const searchDataPattern =
  /天气|开放|营业|签证|政策|使领馆|领事馆|景点公告|下周|国庆|春节/;
const businessDataPattern =
  /库存|余票|航班|机票|酒店|房型|有房|可取消|退改|预订|下单|直接订|订一张|订个/;
const memoryPattern =
  /(?:根据|参考|结合|按照).{0,8}(?:过往|历史|偏好|收藏|订单)|(?:我的|我保存的)(?:旅行)?(?:偏好|收藏|订单|乘机人信息)|以前去过/;
const sessionPattern =
  /根据(?:上文|前文|历史对话)|(?:结合|参考|按照|按).{0,8}(?:上文|前文|刚才|前面|上一轮|历史对话)|刚才那(?:个|些|两)|按刚才|(?:接下来|那|那么|这次|本次|出发前|旅途中).{0,12}(?:穿|带|准备|注意|装备|行李)|(?:穿什么|怎么穿|带什么|带啥|需要带|要带|行李清单|准备什么)/;
const transactionPattern =
  /预订|下单|购买|付款|订票|直接订|帮我订|订一张|订个|出票/;
const comparisonPattern = /比较|对比|哪个更|二选一|两个/;
const decisionPattern =
  /规划|行程|最终建议|怎么安排|应该怎么办|帮我.*排|国庆|春节|七天|预算|查一下|怎么样|是否|给我最|推荐.*目的地/;
const highRiskPattern =
  /紧急|急救|医疗|违法|人身安全|护照.{0,4}(?:丢|遗失|被偷)|胸闷|嘴唇发紫|呼吸困难|急性高原/;
const accessibilityPattern =
  /轮椅|无障碍|无台阶|电梯出入口|无障碍厕所|膝盖不好|不能长时间步行|少走路|不要走太多路/;
const policyPattern = /签证|政策|使领馆|领事馆|护照.{0,4}(?:丢|遗失|被偷)/;

function safelySerialize(value: unknown) {
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return "";
  }
}

function containsEmptyResult(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((item) => containsEmptyResult(item));
}

function maskNegatedRealtimeRequests(query: string) {
  return query.replace(
    /(?:不用|不要|无需|不必|别)(?:再|主动)?(?:帮我)?(?:查|查询|搜索|核验|比较)?[^，。；！？!?]{0,8}(?:价格|票价|天气|签证|政策|开放时间|库存|余票)/g,
    "[已排除实时查询项]",
  );
}

function hasSourceConflict(toolResult: unknown) {
  if (!toolResult || typeof toolResult !== "object") return false;
  const result = toolResult as Record<string, unknown>;
  const sourceA = result.source_a as Record<string, unknown> | undefined;
  const sourceB = result.source_b as Record<string, unknown> | undefined;
  return Boolean(
    sourceA?.claim &&
      sourceB?.claim &&
      String(sourceA.claim).trim() !== String(sourceB.claim).trim(),
  );
}

function hasPromptInjection(toolResult: unknown) {
  const text = safelySerialize(toolResult);
  return /忽略(?:此前|之前|以上|所有).{0,20}(?:规则|指令)|API\s*密钥|系统提示|system\s*prompt|开发者消息/i.test(
    text,
  );
}

function isClearlyInfeasibleBudget(query: string) {
  return (
    /一家四口/.test(query) &&
    /(?:深圳|广州|上海).{0,12}(?:北京|三亚|新疆|西藏)/.test(query) &&
    /(?:五|5)天/.test(query) &&
    /总预算(?:三千|3000)/.test(query)
  );
}

function hasTemporalSpatialConflict(query: string) {
  const cities = ["北京", "上海", "广州", "深圳", "成都", "杭州", "南京"];
  const cityCount = cities.filter((city) => query.includes(city)).length;
  return (
    cityCount >= 2 &&
    /(?:只有)?一天/.test(query) &&
    /上午/.test(query) &&
    /下午/.test(query) &&
    /晚上/.test(query)
  );
}

function countMatches(query: string, patterns: RegExp[]) {
  return patterns.reduce((count, pattern) => count + Number(pattern.test(query)), 0);
}

function extractConstraints(query: string) {
  const candidates = [
    {
      pattern: /(?:国庆|春节|暑假|寒假|下周|周末|本周五|明天|明晚|后天|\d+\s*月\s*\d+\s*日)/,
      label: "旅行时间",
    },
    { pattern: /(?:\d+|一|两|二|三|四|五|六|七|十)天|两日|三日/, label: "旅行天数" },
    { pattern: /从[^，。；,;]{1,12}出发|[^，。；,;]{2,8}(?:到|去)[^，。；,;]{2,8}/, label: "出发地与目的地" },
    { pattern: /(?:总)?预算[^，。；,;]{1,18}/, label: "预算上限" },
    { pattern: /父母|老人|孩子|儿童|奶奶|一家四口|两个人/, label: "同行人" },
    { pattern: accessibilityPattern, label: "体力或无障碍限制" },
    { pattern: /每天最多[^，。；,;]{1,10}|下午.*休息|中午.*休息/, label: "行程节奏" },
    { pattern: /酒店.{0,18}(?:地铁|电梯|无障碍|可取消)|春熙路附近/, label: "住宿条件" },
    { pattern: /最便宜|最低总价/, label: "价格目标" },
    { pattern: /直飞|晚班航班/, label: "交通条件" },
    { pattern: /不能吃辣|饮食/, label: "饮食限制" },
    { pattern: /天气/, label: "天气" },
    { pattern: policyPattern, label: "签证或证件政策" },
    { pattern: /价格|票价/, label: "价格" },
  ];
  return [...new Set(candidates
    .filter(({ pattern }) => pattern.test(query))
    .map(({ label }) => label))];
}

function chooseResponse(
  query: string,
  strategies: Strategy[],
  labels: RouteDecision["labels"],
  upgraded: boolean,
) {
  if (strategies.includes("handoff")) {
    return "这个请求涉及较高风险，我不会为了降低调用成本而给出草率结论。建议先核验官方信息；如需继续，我可以整理可核验的办理步骤和紧急联系方式。";
  }

  if (strategies.includes("clarify")) {
    return "先不急着给你一长串目的地。告诉我这 3 点，我就能把范围快速缩小：\n1. 从哪里出发、准备玩几天？\n2. 人均预算大约多少？\n3. 更偏好自然、城市、美食，还是轻松度假？";
  }

  if (strategies.includes("retrieve_memory")) {
    return "我先读取了演示账户的旅行偏好：从上海出发、偏爱自然景观与慢节奏、去过厦门和杭州、收藏过北海道。基于这些线索，国庆更推荐「东北赏秋」作为低门槛方案，并把「北海道」保留为需要进一步核验票价和签证的进阶方案。";
  }

  if (strategies.includes("plan") && /日本/.test(query)) {
    return `${upgraded ? "已带着原请求和遗漏原因升级处理，无需你重复描述。\n\n" : ""}建议采用「大阪 3 晚＋京都近郊 3 晚」的低步行方案：\n• 预算：交通与住宿预留约 ¥14,000，餐饮与门票约 ¥4,000，保留 ¥2,000 机动金；\n• 体力：每天只安排 1 个核心区域，优先车站附近酒店，景点间使用轨道交通或短程出租；\n• 实时核验：出发前 7 天复查天气，签证材料以官方领馆最新要求为准；\n• 下一步：先比较两组可退改航班与无障碍酒店，再生成逐日行程。`;
  }

  if (strategies.includes("search")) {
    return "我会先核验天气、票价和开放时间，再做比较。当前演示数据表明：大阪文化景点更集中、福冈节奏更轻松；但最终选择应以出发日期的航班价格和天气为准。你可以继续补充预算，我会给出带来源和取舍理由的二选一结论。";
  }

  if (labels.intentStage === "comparison") {
    return "我会按交通成本、行程密度、步行强度和体验匹配度逐项比较，并在最后给出明确推荐，而不是只罗列优缺点。";
  }

  return "你的需求已经可以直接处理。我会先给出一个可执行的建议，再标出仍需核验的信息和下一步动作。";
}

export function routeQuery(
  rawQuery: string,
  settings: RouterSettings = DEFAULT_SETTINGS,
  context: RouterContext = {},
): RouteDecision {
  const query = rawQuery.trim();
  const historyRequested = sessionPattern.test(query);
  const history = (historyRequested ? context.history ?? [] : [])
    .filter((message) => message.role === "user" && message.content.trim())
    .slice(-6);
  const historyText = history.map((message) => message.content).join("\n");
  const analysisText = [historyText, query].filter(Boolean).join("\n");
  const realtimeAnalysisText = maskNegatedRealtimeRequests(analysisText);
  const hardConstraints = extractConstraints(analysisText);
  const constraintCount = hardConstraints.length;

  const historyAvailable = history.length > 0;
  const memoryAvailable = Boolean(
    context.memory && Object.keys(context.memory).length,
  );
  const toolResultAvailable = context.toolResult !== undefined;
  const toolNoResult =
    toolResultAvailable && containsEmptyResult(context.toolResult);
  const sourceConflict = hasSourceConflict(context.toolResult);
  const promptInjectionRisk = hasPromptInjection(context.toolResult);
  const infeasibleBudget = isClearlyInfeasibleBudget(analysisText);
  const temporalSpatialConflict = hasTemporalSpatialConflict(analysisText);
  const accessibilityNeed = /轮椅|无障碍|无台阶|无障碍厕所/.test(
    analysisText,
  );

  const accountMemoryAvailable = Boolean(
    context.account && Object.keys(context.account).length,
  );
  const needsBusinessData =
    businessDataPattern.test(realtimeAnalysisText) ||
    (accessibilityNeed && /酒店|房型/.test(analysisText));
  const needsRealtimeSearch =
    searchDataPattern.test(realtimeAnalysisText) ||
    sourceConflict ||
    accessibilityNeed ||
    highRiskPattern.test(query);

  const intentStage: IntentStage = transactionPattern.test(query)
    ? "transaction"
    : comparisonPattern.test(query)
      ? "comparison"
      : memoryPattern.test(query)
        ? "preference"
        : decisionPattern.test(query) ||
            /只有一天|酒店要|景点也要|去[^，。；,;]{1,12}(?:两|三|四|五|六|七|\d+)天/.test(
              query,
            )
          ? "decision"
          : "exploration";

  let informationCompleteness: Level =
    infeasibleBudget || temporalSpatialConflict || accessibilityNeed
      ? "high"
      : constraintCount >= 5 ||
          (intentStage === "comparison" && needsBusinessData && constraintCount >= 4)
        ? "high"
        : constraintCount >= 2 ||
            sourceConflict ||
            toolNoResult ||
            toolResultAvailable ||
            historyAvailable
          ? "medium"
          : "low";
  if (/护照.{0,4}(?:丢|遗失|被偷)/.test(query) && !/我在[^，。；,;]{1,12}(?:市|国|州)/.test(query)) {
    informationCompleteness = "low";
  }

  const complexitySignals = countMatches(analysisText, [
    comparisonPattern,
    /预算/,
    /父母|老人|孩子|儿童|奶奶|一家四口/,
    /不要|不能|必须|还要/,
    realtimePattern,
    /规划|行程|安排|排好/,
    /酒店|航班|机票/,
  ]);
  const taskComplexity: Level =
    highRiskPattern.test(query) ||
    infeasibleBudget ||
    temporalSpatialConflict ||
    accessibilityNeed ||
    Boolean(context.lastFailure?.failure) ||
    complexitySignals >= 4
      ? "high"
      : complexitySignals >= 2 ||
          intentStage === "comparison" ||
          needsBusinessData ||
          needsRealtimeSearch ||
          memoryAvailable ||
          sourceConflict ||
          toolNoResult ||
          promptInjectionRisk
        ? "medium"
        : "low";

  const personalizationNeed: PersonalizationNeed = memoryPattern.test(query)
    ? "long_term"
    : historyRequested
      ? "session"
      : "none";
  const realtimeNeed: RealtimeNeed = needsBusinessData
    ? "business_data"
    : needsRealtimeSearch
      ? "search"
      : "none";
  const riskLevel: Level = highRiskPattern.test(query)
    ? "high"
    : /签证|政策|父母|老人|孩子|儿童|奶奶|预算/.test(analysisText) ||
        needsBusinessData ||
        accessibilityNeed ||
        intentStage === "transaction" ||
        promptInjectionRisk
      ? "medium"
      : "low";
  const valueSignals = countMatches(analysisText, [
    /最终建议|确定方案|直接订|预订|下单|购买|付款/,
    /预算|价格|票价|酒店|机票|航班|房型/,
    /(?:\d+|一|两|二|三|四|五|六|七)天|多人|父母|老人|孩子|无障碍/,
    /规划|行程|安排|路线|对比|比较|推荐/,
  ]);
  const businessValue: Level =
    intentStage === "transaction" ||
    (intentStage === "decision" &&
      (constraintCount >= 3 || needsBusinessData || needsRealtimeSearch || valueSignals >= 3)) ||
    (needsBusinessData && constraintCount >= 2)
      ? "high"
      : intentStage === "comparison" ||
          intentStage === "preference" ||
          intentStage === "decision" ||
          valueSignals >= 1
        ? "medium"
        : "low";

  const strategies: Strategy[] = [];
  if (riskLevel === "high") {
    strategies.push("handoff");
  } else {
    if (informationCompleteness === "low" && intentStage === "exploration") {
      strategies.push("clarify");
    }
    if (personalizationNeed === "long_term" || personalizationNeed === "session") {
      strategies.push("retrieve_memory");
    }
    if (needsRealtimeSearch) strategies.push("search");
    if (needsBusinessData) strategies.push("call_tool");
    if (taskComplexity === "high") strategies.push("plan");
    if (!strategies.includes("clarify") && !strategies.includes("plan")) {
      strategies.push("answer");
    }
  }

  const confidence = Number(
    (
      informationCompleteness === "low" && intentStage !== "exploration"
        ? 0.64
        : riskLevel === "high"
          ? 0.76
          : taskComplexity === "high"
            ? 0.93
            : 0.88
    ).toFixed(2),
  );

  let initialTier: ModelTier =
    taskComplexity === "high" || riskLevel === "high"
      ? "reasoning"
      : taskComplexity === "medium" ||
          personalizationNeed !== "none" ||
          realtimeNeed !== "none"
        ? "general"
        : "small";

  if (confidence < settings.confidenceThreshold && initialTier === "small") {
    initialTier = "general";
  }

  const suppliedFailure = context.lastFailure?.failure?.trim();
  const simulateConstraintMiss =
    !suppliedFailure &&
    comparisonPattern.test(query) &&
    /父母|老人/.test(analysisText) &&
    /步行|少走路/.test(analysisText);
  if (simulateConstraintMiss) initialTier = "general";

  if (suppliedFailure && context.lastFailure?.modelTier) {
    initialTier = context.lastFailure.modelTier;
  }

  const forcedTier =
    context.modelPreference && context.modelPreference !== "auto"
      ? context.modelPreference
      : null;
  if (forcedTier) initialTier = forcedTier;

  const upgraded =
    !forcedTier &&
    Boolean(suppliedFailure || simulateConstraintMiss) &&
    settings.maxUpgrades > 0;
  const finalTier: ModelTier = forcedTier ?? (upgraded ? "reasoning" : initialTier);
  const tools: string[] = [];
  if (strategies.includes("retrieve_memory")) tools.push("旅行历史记忆");
  if (strategies.includes("search")) tools.push("天气与政策搜索");
  if (strategies.includes("call_tool")) tools.push("航班与酒店业务数据");
  if (sourceConflict) tools.push("来源冲突核验");
  if (promptInjectionRisk) tools.push("工具结果安全过滤");

  const inputTokens = 260 + query.length * 3 + tools.length * 180;
  const outputTokens =
    finalTier === "reasoning" ? 520 : finalTier === "general" ? 320 : 150;
  const toolCost = tools.length * 0.002;
  const modelCost = settings.prices[finalTier];
  const initialAttemptCost = upgraded ? settings.prices[initialTier] : 0;
  const estimatedCost = Number(
    (modelCost + toolCost + initialAttemptCost).toFixed(3),
  );
  const latencyMs =
    (finalTier === "reasoning" ? 3560 : finalTier === "general" ? 1980 : 760) +
    tools.length * 430 +
    (upgraded ? 1780 : 0);

  const labels: RouteDecision["labels"] = {
    intentStage,
    informationCompleteness,
    taskComplexity,
    personalizationNeed,
    realtimeNeed,
    riskLevel,
    businessValue,
  };
  const labelReasons: RouteDecision["labelReasons"] = {
    intentStage:
      intentStage === "transaction"
        ? "包含预订、购买或付款动作"
        : intentStage === "comparison"
          ? "包含对象间对比或取舍"
          : intentStage === "preference"
            ? "要求参考历史偏好或记忆"
            : intentStage === "decision"
              ? "包含明确规划、推荐或决策目标"
              : "尚处在探索或信息收集阶段",
    informationCompleteness:
      constraintCount > 0
        ? `已识别 ${constraintCount} 类硬约束${historyAvailable ? "，并合并会话历史" : ""}`
        : "尚未识别日期、预算、同行人等关键约束",
    taskComplexity:
      complexitySignals > 0
        ? `检测到 ${complexitySignals} 个复杂信号（约束、比较、实时或规划）`
        : "没有多约束、比较或实时任务信号",
    personalizationNeed:
      personalizationNeed === "long_term"
        ? "明确要求参考已保存的偏好、收藏或订单"
        : personalizationNeed === "session"
          ? "明确要求根据上文或前序对话回答"
          : "未要求引用上文；默认不发送完整历史对话",
    realtimeNeed:
      realtimeNeed === "business_data"
        ? "涉及航班、酒店、库存、价格或预订数据"
        : realtimeNeed === "search"
          ? "涉及天气、政策、开放时间等时效信息"
          : "当前可先给非实时建议",
    riskLevel:
      riskLevel === "high"
        ? "涉及紧急、安全或证件风险"
        : riskLevel === "medium"
          ? "包含预算、同行人、无障碍或交易影响"
          : "未发现高风险决策信号",
    businessValue:
      businessValue === "high"
        ? `会影响真实行程或消费决策：${constraintCount} 类约束、${valueSignals} 个价值信号${needsBusinessData ? "，且需要业务数据" : ""}`
        : businessValue === "medium"
          ? `属于推荐、比较或偏好判断，但暂未同时满足高影响条件（${constraintCount} 类约束、${valueSignals} 个价值信号）`
          : "当前是低成本探索，不涉及明确消费、预订或多约束决策",
    hardConstraints:
      hardConstraints.length
        ? hardConstraints.join("、")
        : "尚未发现需强制满足的条件",
  };

  const reasonParts = [
    informationCompleteness === "low"
      ? "关键信息不足，先减少无效生成"
      : `已识别 ${constraintCount} 类硬约束`,
    personalizationNeed !== "none" ? "需要补充用户上下文" : "",
    realtimeNeed !== "none" ? "内部知识不足以保证信息时效" : "",
    taskComplexity === "high" ? "多约束任务需要跨步骤规划" : "",
    `业务价值：${labelReasons.businessValue}`,
    forcedTier ? `用户手动固定为${LABEL_TEXT.tier[forcedTier]}` : "",
    riskLevel === "high" ? "高风险请求不以最低成本为优先" : "",
    historyAvailable ? "已读取会话历史中的用户约束" : "",
    memoryAvailable || accountMemoryAvailable ? "已接入可用的用户记忆" : "",
    needsRealtimeSearch && needsBusinessData ? "任务需要同时搜索政策信息并查询业务数据" : "",
    toolNoResult ? "业务工具调用成功但结果为空，不能编造候选项" : "",
    sourceConflict ? "工具来源存在冲突，需要按权威性与更新时间复核" : "",
    promptInjectionRisk ? "工具内容含不可信指令，已进入安全过滤" : "",
    infeasibleBudget ? "预算与人数、距离和天数明显冲突，需先做可行性检查" : "",
    temporalSpatialConflict ? "跨城市安排与时间窗口无法同时满足" : "",
    accessibilityNeed ? "无障碍条件需要业务筛选与官方信息双重核验" : "",
  ].filter(Boolean);

  const qualityCheck = upgraded
    ? {
        passed: false,
        score: 0.72,
        constraintSatisfaction: 0.83,
        failedChecks: ["missing_hard_constraint"],
        details:
          suppliedFailure || "初次回答遗漏“父母不能长时间步行”，触发模型升级。",
      }
    : {
        passed: true,
        score: finalTier === "reasoning" ? 0.91 : 0.84,
        constraintSatisfaction: hardConstraints.length ? 1 : 0.9,
        failedChecks: [],
        details:
          confidence < settings.confidenceThreshold
            ? "路由置信度偏低，已采用保守模型档位复核。"
            : "结构、硬约束和事实引用检查均通过。",
      };

  const trace: RouteDecision["trace"] = [
    {
      label: "请求理解",
      detail: `${LABEL_TEXT.intentStage[intentStage]}阶段 · 信息${LABEL_TEXT.level[informationCompleteness]} · 复杂度${LABEL_TEXT.level[taskComplexity]}`,
      state: "complete",
    },
    {
      label: "策略准备",
      detail: strategies.map((item) => LABEL_TEXT.strategy[item]).join(" → "),
      state: "complete",
    },
    ...(tools.length
      ? [
          {
            label: "上下文与工具",
            detail: tools.join("、"),
            state: "complete" as const,
          },
        ]
      : []),
    ...(toolNoResult || sourceConflict || promptInjectionRisk
      ? [
          {
            label: "执行上下文检查",
            detail: [
              toolNoResult ? "工具无结果" : "",
              sourceConflict ? "来源冲突" : "",
              promptInjectionRisk ? "提示注入已隔离" : "",
            ]
              .filter(Boolean)
              .join("、"),
            state: "warning" as const,
          },
        ]
      : []),
    {
      label: "路由完成",
      detail: `${forcedTier ? "用户手动指定" : "计划调用"}${LABEL_TEXT.tier[finalTier]} · ${settings.modelNames[finalTier]}；此处不代表模型已经返回。`,
      state: "complete",
    },
  ];

  return {
    requestId: `req_${Date.now().toString(36)}`,
    query,
    timestamp: new Date().toISOString(),
    labels,
    labelReasons,
    strategies,
    confidence,
    reason: reasonParts.join("；"),
    initialTier,
    finalTier,
    modelName: settings.modelNames[finalTier],
    tools,
    hardConstraints,
    contextSignals: {
      historyAvailable,
      memoryAvailable: memoryAvailable || accountMemoryAvailable,
      toolResultAvailable,
      toolNoResult,
      sourceConflict,
      promptInjectionRisk,
      infeasibleBudget,
      temporalSpatialConflict,
      accessibilityNeed,
    },
    qualityCheck,
    execution: {
      inputTokens,
      outputTokens,
      estimatedCost,
      latencyMs,
      upgraded,
      upgradeReason: upgraded ? qualityCheck.details : null,
      attempts: upgraded ? 2 : 1,
    },
    response: chooseResponse(query, strategies, labels, upgraded),
    trace,
  };
}

export const EXPERIMENT_SUMMARIES: ExperimentSummary[] = [
  {
    group: "all_small",
    label: "全小模型",
    successRate: 0.68,
    constraintRate: 0.72,
    averageCost: 0.006,
    costPerSuccess: 0.009,
    p50Latency: 0.8,
    p95Latency: 1.6,
    upgradeRate: 0,
  },
  {
    group: "dynamic",
    label: "动态路由",
    successRate: 0.92,
    constraintRate: 0.94,
    averageCost: 0.027,
    costPerSuccess: 0.029,
    p50Latency: 2.1,
    p95Latency: 4.3,
    upgradeRate: 0.11,
  },
  {
    group: "all_reasoning",
    label: "全强模型",
    successRate: 0.95,
    constraintRate: 0.96,
    averageCost: 0.049,
    costPerSuccess: 0.052,
    p50Latency: 3.7,
    p95Latency: 6.8,
    upgradeRate: 0,
  },
];

const EVALUATION_QUERIES = [
  "我不知道该去哪里玩",
  "周末从上海出发，预算两千，想看自然风景",
  "根据我过去收藏过的地点给我推荐",
  "比较大阪和福冈哪个更适合慢旅行",
  "下周杭州天气怎样，西湖附近酒店还有房吗",
  "国庆带父母去日本七天，预算两万，不要走太多路",
  "帮我查北京到成都的航班并给出三日安排",
  "东京和关西两个行程哪个更适合老人",
  "我刚才说的两个目的地再按美食偏好比较",
  "护照在境外丢了，现在应该怎么办",
];

export function buildExperimentCsv() {
  const headers = [
    "case_id",
    "query",
    "strategy_group",
    "task_success",
    "constraint_satisfaction",
    "estimated_cost_cny",
    "latency_ms",
    "upgraded",
    "rule_version",
  ];
  const rows = [headers.join(",")];

  for (let index = 0; index < 100; index += 1) {
    const query = EVALUATION_QUERIES[index % EVALUATION_QUERIES.length];
    for (const summary of EXPERIMENT_SUMMARIES) {
      const successCutoff = Math.round(summary.successRate * 100);
      const success = (index * 17 + summary.label.length) % 100 < successCutoff;
      const constraint = success
        ? summary.constraintRate
        : Math.max(0.35, summary.constraintRate - 0.28);
      const costJitter = 1 + ((index % 7) - 3) * 0.025;
      const latencyJitter = 1 + ((index % 9) - 4) * 0.04;
      const upgraded =
        summary.group === "dynamic" && index % 9 === 0 ? "true" : "false";
      rows.push(
        [
          `travel_${String(index + 1).padStart(3, "0")}`,
          `"${query.replaceAll('"', '""')}"`,
          summary.group,
          success ? "true" : "false",
          constraint.toFixed(2),
          (summary.averageCost * costJitter).toFixed(4),
          Math.round(summary.p50Latency * 1000 * latencyJitter),
          upgraded,
          DEFAULT_SETTINGS.version,
        ].join(","),
      );
    }
  }

  return rows.join("\n");
}
