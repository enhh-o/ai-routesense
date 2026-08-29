"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildExperimentCsv,
  DEFAULT_SETTINGS,
  EXPERIMENT_SUMMARIES,
  LABEL_TEXT,
  PRESETS,
  routeQuery,
  type ModelTier,
  type RouteDecision,
  type RouterSettings,
} from "../lib/routesense";

type Tab = "demo" | "runs" | "evaluation" | "rules";
type Feedback =
  | "resolved"
  | "unresolved"
  | "missing"
  | "generic"
  | "inaccurate"
  | "overkill";
type ApiMode = "checking" | "live" | "demo" | "error";
type ExecutionState = "idle" | "waiting" | "succeeded" | "failed" | "demo";
type AgentPreference = "auto" | ModelTier;

const FEEDBACK_TEXT: Record<Feedback, string> = {
  resolved: "已解决",
  unresolved: "未解决",
  missing: "遗漏约束",
  generic: "回答过泛",
  inaccurate: "信息不准",
  overkill: "无需这么复杂",
};

interface ApiChatResponse {
  runId?: string;
  mode?: "live" | "demo";
  provider?: string;
  answer?: string;
  modelName?: string;
  latencyMs?: number;
  usage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
  };
  error?: string;
  failureKind?: string;
  attempts?: number;
}

interface ChatStreamEvent extends ApiChatResponse {
  type: "start" | "heartbeat" | "delta" | "replace" | "done" | "error";
  text?: string;
  elapsedMs?: number;
}

interface ChatStreamResult {
  result?: ApiChatResponse;
  error?: ApiChatResponse;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface RunRecord {
  id: string;
  createdAt: string;
  completedAt?: string | null;
  status: "succeeded" | "failed" | "demo";
  mode: "live" | "demo";
  provider: string;
  query: string;
  historyJson?: string | null;
  promptVersion: string;
  systemPrompt?: string | null;
  routeTier: ModelTier;
  routeDecisionJson: string;
  modelName: string;
  requestPayloadJson?: string | null;
  rawResponseJson?: string | null;
  answer?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  latencyMs?: number | null;
  httpStatus?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  feedback?: Feedback | null;
  feedbackUpdatedAt?: string | null;
}

const defaultQuery = PRESETS[0].query;
const initialDecision = routeQuery(defaultQuery, DEFAULT_SETTINGS);

const welcomeMessage: Message = {
  id: "assistant-welcome",
  role: "assistant",
  content: "准备好开启我们新一段旅程吗？",
};

const initialMessages: Message[] = [welcomeMessage];

type ConversationDialog = { mode: "clear" };

type SupplementCoreField =
  | "startDate"
  | "duration"
  | "budget"
  | "budgetScope"
  | "travelers"
  | "travelPurposes"
  | "roomCount"
  | "bedType";

type TripSetupKind =
  | "unknown_destination"
  | "origin_only"
  | "destination_only"
  | "single_place";

interface TripSetupPrompt {
  query: string;
  kind: TripSetupKind;
  origin?: string;
  destination?: string;
  place?: string;
}

interface SupplementFormState {
  origin: string;
  destination: string;
  startDate: string;
  duration: string;
  budget: string;
  budgetScope: string;
  travelers: string;
  travelPurposes: string[];
  transportMode: string;
  roomCount: string;
  bedType: string;
  pace: string;
  extra: string;
}

type SupplementTextField = Exclude<
  keyof SupplementFormState,
  "travelPurposes"
>;

interface SupplementPrompt {
  query: string;
  missingFields: SupplementCoreField[];
}

interface ApiStatusResponse {
  mode?: "live" | "demo";
  configuredTiers?: ModelTier[];
  tierStatus?: Record<ModelTier, boolean>;
}

interface TravelOptionsResponse {
  scope?: string;
  distanceKm?: number;
  options?: string[];
  note?: string;
  error?: string;
}

interface TravelOptionsState {
  status: "idle" | "loading" | "ready" | "error";
  options: string[];
  note: string;
}

type DestinationScope = "市内游" | "省内游" | "省外游";
type DestinationDiscoveryStep = "location" | "scope" | "interests" | "results";

interface DestinationDiscoveryForm {
  origin: string;
  locatedPlace: string;
  scope: DestinationScope | "";
  interests: string[];
  transportModes: string[];
  maxTravelTime: string;
  extra: string;
}

interface DestinationSuggestion {
  destination: string;
  region: string;
  summary: string;
  reasons: string[];
  tags: string[];
  travelTimeEstimate: string;
  recommendedTransport: string;
}

interface LocationLookupResponse {
  city?: string;
  province?: string;
  district?: string;
  displayName?: string;
  attribution?: string;
  error?: string;
}

const EMPTY_SUPPLEMENT_FORM: SupplementFormState = {
  origin: "",
  destination: "",
  startDate: "",
  duration: "",
  budget: "",
  budgetScope: "",
  travelers: "",
  travelPurposes: [],
  transportMode: "",
  roomCount: "",
  bedType: "",
  pace: "",
  extra: "",
};

const EMPTY_DESTINATION_DISCOVERY_FORM: DestinationDiscoveryForm = {
  origin: "",
  locatedPlace: "",
  scope: "",
  interests: [],
  transportModes: [],
  maxTravelTime: "",
  extra: "",
};

const CORE_FIELD_LABELS: Record<SupplementCoreField, string> = {
  startDate: "出发日期",
  duration: "游玩天数",
  budget: "预算金额",
  budgetScope: "预算口径",
  travelers: "出行人数",
  travelPurposes: "旅行目的",
  roomCount: "住宿房间数",
  bedType: "房型偏好",
};

const TRAVEL_PURPOSE_OPTIONS = [
  { label: "自然风光", pattern: /风景|自然|山水|海边|草原|森林|看海/ },
  { label: "历史人文", pattern: /历史|人文|博物馆|古迹|古建筑|文化/ },
  { label: "美食体验", pattern: /美食|小吃|餐厅|吃遍|品尝/ },
  { label: "购物消费", pattern: /购物|逛街|买东西|商场|扫货/ },
  { label: "休闲度假", pattern: /休闲|放松|度假|慢节奏|疗愈/ },
  { label: "亲子陪伴", pattern: /亲子|带孩子|儿童|家庭陪伴/ },
  { label: "摄影打卡", pattern: /摄影|拍照|打卡|出片/ },
  { label: "夜间体验", pattern: /夜生活|夜景|酒吧|夜市/ },
] as const;

const DESTINATION_INTEREST_OPTIONS = [
  "登山徒步",
  "江河湖景",
  "海滨海岛",
  "草原森林",
  "古城人文",
  "美食体验",
  "亲子游乐",
  "温泉度假",
  "摄影打卡",
  "小众安静",
] as const;

const ITINERARY_TRANSPORT_OPTIONS = [
  "公共交通",
  "打车",
  "飞机",
  "高铁",
  "普通火车",
  "自驾",
  "长途汽车",
] as const;

const EMPTY_TRAVEL_OPTIONS: TravelOptionsState = {
  status: "idle",
  options: [],
  note: "填写出发地和目的地后，将按实际距离筛掉不合适的方式。",
};

function getDestinationTransportOptions(scope: DestinationScope | "") {
  if (scope === "市内游") return ["地铁", "公交", "打车", "自驾"];
  if (scope === "省内游") return ["高铁", "普通火车", "自驾", "长途汽车"];
  if (scope === "省外游") return ["飞机", "高铁", "普通火车", "自驾"];
  return [];
}

function getDestinationTravelTimeOptions(scope: DestinationScope | "") {
  if (scope === "市内游") return ["30 分钟内", "1 小时内", "2 小时内"];
  if (scope === "省内游") return ["2 小时内", "4 小时内", "6 小时内"];
  if (scope === "省外游") return ["3 小时内", "6 小时内", "10 小时内"];
  return [];
}

const RECOGNIZABLE_TRAVEL_PLACES = [
  "北京",
  "上海",
  "广州",
  "深圳",
  "西安",
  "榆林",
  "成都",
  "重庆",
  "杭州",
  "南京",
  "苏州",
  "厦门",
  "青岛",
  "大连",
  "三亚",
  "昆明",
  "大理",
  "丽江",
  "长沙",
  "武汉",
] as const;

const GROUP_ROOM_PREFERENCES = [
  "三人房",
  "家庭房 / 亲子房",
  "相邻房 / 连通房",
  "由系统按人数推荐房型组合",
] as const;

function getSelectedTravelerCount(value: string) {
  if (value === "8 人以上") return 8;
  return Number(value.match(/\d+/)?.[0]) || 0;
}

function isGroupRoomPreference(value: string) {
  return GROUP_ROOM_PREFERENCES.includes(
    value as (typeof GROUP_ROOM_PREFERENCES)[number],
  );
}

function detectSupplementDetails(text: string) {
  const details: Partial<SupplementFormState> = {};
  const directTrip = text.match(
    /(?:我想|我要|计划|准备)?\s*(?:从)?\s*([\u4e00-\u9fa5A-Za-z·]{2,8})(?:出发)?(?:到|去|前往|飞往)\s*([\u4e00-\u9fa5A-Za-z·]{2,8}?)(?=(?:旅游|旅行|游玩|玩|度假|$|[，。；,;！!？?]))/,
  );
  const origin = text.match(
    /(?:从|自)\s*([\u4e00-\u9fa5A-Za-z·]{2,12})\s*(?:出发|启程|前往|去|到)/,
  );
  const destination = text.match(
    /(?:想去|前往|去|到)\s*([\u4e00-\u9fa5A-Za-z·]{2,12})(?=(?:旅游|旅行|游玩|玩|度假|$|[，。；,;！!？?]))/,
  );
  const calendarDates = Array.from(
    text.matchAll(/20\d{2}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?/g),
  ).map((match) => {
    const parts = match[0].match(/\d+/g) ?? [];
    return parts.length === 3
      ? `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`
      : "";
  });
  const duration = text.match(/\d+\s*(?:天|日|晚)/);
  const budget = text.match(
    /(?:预算(?:金额)?(?:约|大约|为|是|控制在)?[:：]?\s*[¥￥]?\s*\d+(?:\.\d+)?\s*(?:元|块|千|万)?|[¥￥]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:元|块|千|万))/,
  );
  const travelers = text.match(
    /(?:\d+\s*(?:人|位)(?:成人|大人|老人|儿童|孩子)?|独自|一个人|情侣|一家\w*|亲子)/,
  );
  const roomCount = text.match(/(?:\d+|一|二|两|三|四|五)\s*间(?:房)?/);
  const durationUnknown = /(?:游玩|行程)?天数[:：]?\s*不确定/.test(text);
  const budgetUnknown = /(?:总)?预算(?:金额)?[:：]?\s*不确定/.test(text);
  const budgetScopeUnknown = /预算口径[:：]?\s*不确定/.test(text);
  const travelersUnknown = /(?:出行)?人数[:：]?\s*不确定/.test(text);
  const roomCountUnknown = /(?:住宿)?房间数?[:：]?\s*不确定/.test(text);
  const bedTypeUnknown = /(?:房型|床型)(?:偏好)?[:：]?\s*(?:不确定|无偏好)/.test(
    text,
  );
  const noAccommodation = /(?:不需要|无需|不住|不用)(?:酒店|住宿)|当天往返|住亲友家/.test(
    text,
  );
  const detectedPurposes = TRAVEL_PURPOSE_OPTIONS
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.label);
  if (detectedPurposes.length) details.travelPurposes = detectedPurposes;
  const detectedTransport = ITINERARY_TRANSPORT_OPTIONS.find((mode) =>
    mode === "普通火车"
      ? /(?:普通|普速|绿皮)?火车/.test(text)
      : text.includes(mode),
  );
  if (detectedTransport) details.transportMode = detectedTransport;
  if (directTrip?.[1] && directTrip?.[2]) {
    details.origin = directTrip[1].trim();
    details.destination = directTrip[2].trim();
  } else {
    if (origin?.[1]) details.origin = origin[1].trim();
    if (destination?.[1]) details.destination = destination[1].trim();
  }
  if (calendarDates[0]) details.startDate = calendarDates[0];
  if (duration) {
    const dayCount = Number(duration[0].match(/\d+/)?.[0]);
    if (dayCount) {
      details.duration = dayCount > 10 ? "10 天以上" : `${dayCount} 天`;
    }
  } else if (durationUnknown) {
    details.duration = "不确定";
  }
  if (budget) {
    const budgetValue = budget[0]
      .replace(/^预算(?:金额)?(?:约|大约|为|是|控制在)?[:：]?\s*/, "")
      .trim();
    details.budget = normalizeBudget(budgetValue);
  } else if (budgetUnknown) {
    details.budget = "不确定";
  }
  if (/(?:人均|每人|每位|单人)(?:预算|约|大约|花费|费用)?/.test(text)) {
    details.budgetScope = "单人预算";
  } else if (/(?:总预算|合计预算|全体出行人员合计预算|全部同行人合计|所有人(?:一共|合计)|一共(?:预算|花费)|合计(?:预算|花费))/.test(text)) {
    details.budgetScope = "合计预算";
  } else if (budgetScopeUnknown) {
    details.budgetScope = "不确定";
  }
  if (travelers) {
    const travelerCount = Number(travelers[0].match(/\d+/)?.[0]);
    if (travelerCount) {
      details.travelers =
        travelerCount > 8 ? "8 人以上" : `${travelerCount} 人`;
    } else if (/独自|一个人/.test(travelers[0])) details.travelers = "1 人";
    else if (/情侣/.test(travelers[0])) details.travelers = "2 人";
  } else if (travelersUnknown) {
    details.travelers = "不确定";
  }
  if (noAccommodation) {
    details.roomCount = "不需要住宿";
    details.bedType = "不需要住宿";
  } else {
    if (roomCount) {
      const chineseRoomCounts: Record<string, number> = {
        一: 1,
        二: 2,
        两: 2,
        三: 3,
        四: 4,
        五: 5,
      };
      const countText = roomCount[0].match(/\d+|一|二|两|三|四|五/)?.[0];
      const count = countText
        ? Number(countText) || chineseRoomCounts[countText]
        : 0;
      if (count) details.roomCount = count > 5 ? "5 间以上" : `${count} 间`;
    } else if (roomCountUnknown) {
      details.roomCount = "不确定";
    }

    const hasKingBed = /大床(?:房)?/.test(text);
    const hasTwinBeds = /双床(?:房)?|标准间|标间/.test(text);
    if (/按人数推荐(?:房型)?组合|系统推荐房型/.test(text)) {
      details.bedType = "由系统按人数推荐房型组合";
    } else if (/相邻房|连通房/.test(text)) {
      details.bedType = "相邻房 / 连通房";
    } else if (/家庭房|亲子房/.test(text)) {
      details.bedType = "家庭房 / 亲子房";
    } else if (/三人房|三床房/.test(text)) {
      details.bedType = "三人房";
    } else if (hasKingBed && hasTwinBeds) details.bedType = "大床房或双床房均可";
    else if (hasKingBed) details.bedType = "大床房";
    else if (hasTwinBeds) details.bedType = "双床房";
    else if (bedTypeUnknown) details.bedType = "无偏好";
  }
  return details;
}

function normalizeBudget(value: string) {
  const clean = value.trim();
  if (!clean) return "";
  if (/^\d+(?:\.\d+)?$/.test(clean)) return `${clean} 元`;
  return clean;
}

function getMissingCoreFields(text: string): SupplementCoreField[] {
  const details = detectSupplementDetails(text);
  // 这些是影响“按天、按预算规划”的主要信息。人数和住宿属于可选细化项：
  // 用户不填也可以先得到景点与路线建议。
  return (["startDate", "duration", "budget", "travelPurposes"] as SupplementCoreField[])
    .filter((field) => !details[field]);
}

function explicitlyReferencesConversation(text: string) {
  return /根据(?:上文|前文|历史对话)|(?:结合|参考|按照|按).{0,8}(?:上文|前文|刚才|前面|上一轮|历史对话)|按刚才那|(?:接下来|那|那么|这次|本次|出发前|旅途中).{0,12}(?:穿|带|准备|注意|装备|行李)|(?:穿什么|怎么穿|带什么|带啥|需要带|要带|行李清单|准备什么)/.test(
    text,
  );
}

function buildPreferenceTags(messages: Message[]) {
  const userText = messages
    .filter((message) => message.role === "user")
    .slice(-8)
    .map((message) => message.content)
    .join("\n");
  if (!userText) return [];

  const tags = TRAVEL_PURPOSE_OPTIONS.filter((item) => item.pattern.test(userText))
    .map((item) => `偏好${item.label}`);
  if (/轻松|少走路|慢节奏|不赶/.test(userText)) tags.push("偏好轻松、少走路");
  if (/紧凑|多去景点|特种兵/.test(userText)) tags.push("偏好高密度游玩");
  if (/无障碍|轮椅/.test(userText)) tags.push("需要无障碍信息");
  return [...new Set(tags)].slice(0, 4);
}

function buildCurrentTripTags(messages: Message[]) {
  const tripMessageIndex = messages.findLastIndex(
    (message) =>
      message.role === "user" && isItineraryPlanningRequest(message.content),
  );
  const tripMessage = messages[tripMessageIndex];
  if (!tripMessage) return [];
  const details = detectSupplementDetails(tripMessage.content);
  const plannedPlaces = messages
    .slice(tripMessageIndex + 1)
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      Array.from(
        message.content.matchAll(
          /\[\[PLACE\|[^|\]\n]*\|([^|\]\n]+)\|[^|\]\n]*\|[^|\]\n]*\|[^|\]\n]*\|[^|\]\n]*\|([^|\]\n]*)\]\]/g,
        ),
        (match) => ({ name: match[1].trim(), city: match[2].trim() }),
      ),
    );
  const inferredDestination =
    details.destination || plannedPlaces.find((place) => place.city)?.city || "";
  const placeNames = [...new Set(plannedPlaces.map((place) => place.name))]
    .filter(Boolean)
    .slice(0, 8);
  const tags = [
    details.origin ? `出发地：${details.origin}` : "",
    inferredDestination ? `目的地：${inferredDestination}` : "",
    details.startDate ? `出发日期：${details.startDate}` : "",
    details.duration ? `游玩天数：${details.duration}` : "",
    details.budget ? `预算：${details.budget}` : "",
    details.travelPurposes?.length
      ? `旅行目的：${details.travelPurposes.join("、")}`
      : "",
    placeNames.length ? `已规划地点：${placeNames.join("、")}` : "",
  ].filter(Boolean);
  return [...new Set(tags)].slice(0, 8);
}

function isDestinationDiscoveryRequest(text: string) {
  return (
    /(?:不知道|不确定|没想好|还没想好|没有想好|随便|纠结).{0,12}(?:去哪|去哪里|目的地|地方)/.test(
      text,
    ) ||
    /(?:去哪|去哪里|目的地).{0,12}(?:不知道|不确定|没想好|推荐|筛选)/.test(
      text,
    )
  );
}

function looksLikeOriginDestinationRequest(text: string) {
  const compact = text
    .trim()
    .replace(/[，。！？、,.!?]/g, "")
    .replace(/^(?:我想|我要|计划|准备)/, "");
  return /^(?:从)?[\u4e00-\u9fa5A-Za-z·\s]{2,20}(?:出发)?(?:到|去|前往|飞往)[\u4e00-\u9fa5A-Za-z·\s]{2,20}$/.test(
    compact,
  );
}

function isItineraryPlanningRequest(text: string) {
  return (
    isDestinationDiscoveryRequest(text) ||
    looksLikeOriginDestinationRequest(text) ||
    /(?:行程|安排|规划|路线|怎么玩|旅游|旅行|游玩|去.+玩|到.+玩|推荐.+(?:景点|路线))/.test(
      text,
    )
  );
}

function getTripSetupPrompt(text: string): TripSetupPrompt | null {
  if (isDestinationDiscoveryRequest(text)) {
    return { query: text, kind: "unknown_destination" };
  }
  const details = detectSupplementDetails(text);
  if (details.origin && !details.destination) {
    return { query: text, kind: "origin_only", origin: details.origin };
  }
  if (details.destination && !details.origin) {
    return {
      query: text,
      kind: "destination_only",
      destination: details.destination,
    };
  }
  const compact = text.trim().replace(/[，。！？、,.!?]/g, "");
  const place = RECOGNIZABLE_TRAVEL_PLACES.find((item) => item === compact);
  return place ? { query: text, kind: "single_place", place } : null;
}

function buildSupplementedQuery(
  baseQuery: string,
  form: SupplementFormState,
  transportNote = "",
) {
  const detailLines = [
    form.origin.trim() ? `- 出发地：${form.origin.trim()}` : "",
    form.destination.trim() ? `- 目的地：${form.destination.trim()}` : "",
    form.startDate ? `- 出发日期：${form.startDate}` : "",
    form.duration.trim() ? `- 游玩天数：${form.duration.trim()}` : "",
    form.budget.trim() ? `- 预算金额：${normalizeBudget(form.budget)}` : "",
    form.budgetScope.trim()
      ? `- 预算口径：${form.budgetScope.trim()}`
      : "",
    form.travelers.trim() ? `- 出行人数：${form.travelers.trim()}` : "",
    form.travelPurposes.length
      ? `- 旅行目的：${form.travelPurposes.join("、")}`
      : "",
    form.transportMode.trim()
      ? `- 城际出行方式：${form.transportMode.trim()}`
      : "- 城际出行方式：未指定，请结合预算、路程和时间选择性价比合适且可执行的方式",
    transportNote ? `- 两地交通初筛：${transportNote}` : "",
    form.roomCount.trim()
      ? `- 住宿房间数：${form.roomCount.trim()}`
      : "",
    form.bedType.trim() ? `- 房型偏好：${form.bedType.trim()}` : "",
    form.pace.trim() ? `- 行程节奏：${form.pace.trim()}` : "",
    form.extra.trim() ? `- 其他条件：${form.extra.trim()}` : "",
  ].filter(Boolean);
  return [
    `我的旅行需求：${baseQuery.replace(/[。！？!?.]+$/, "")}。`,
    detailLines.length > 0 ? `补充信息：\n${detailLines.join("\n")}` : "",
    "请根据以上信息给出可执行的按天行程、交通建议和预算分配，并标出需要实时核验的信息。",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderLinkedText(text: string) {
  const normalizedText = normalizeMoneyForDisplay(text);
  return normalizedText.split(/(https?:\/\/\S+)/g).map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer">
        {/(?:uri|www)\.amap\.com/.test(part) ? "打开高德路线" : "打开链接"}
      </a>
    ) : (
      part
    ),
  );
}

function normalizeMoneyForDisplay(text: string) {
  return text.replace(
    /([¥￥]\s*)(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)(?=\s*元)/g,
    (match, currency: string | undefined, currencyValue: string | undefined, yuanValue: string | undefined) => {
      const value = Number(currencyValue ?? yuanValue);
      if (!Number.isFinite(value)) return match;
      const formatted = new Intl.NumberFormat("zh-CN", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(value);
      return currency ? `¥${formatted}` : formatted;
    },
  );
}

interface ItineraryPlace {
  time: string;
  name: string;
  category: string;
  duration: string;
  budget: string;
  description: string;
  city: string;
}

interface ItineraryDay {
  title: string;
  label: string;
  date: string;
  lines: string[];
  places: ItineraryPlace[];
}

interface ItineraryDaySummary {
  activity?: string;
  traffic?: string;
}

interface PlaceImageData {
  imageUrl?: string | null;
  sourceUrl?: string | null;
  provider?: string | null;
  title?: string | null;
}

const DAY_HEADING_PATTERN = /^(?:第\s*[一二三四五六七八九十\d]+\s*天|D\s*\d+|Day\s*\d+)/i;

function normalizeItineraryLine(line: string) {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^(?:[-+]|\d+[.、])\s*/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .trim();
}

function splitItineraryLines(content: string) {
  return content
    .replace(
      /\s+(?=(?:#{1,6}\s*)?(?:\d+[.、]\s*)?(?:\*\*)?(?:第\s*[一二三四五六七八九十\d]+\s*天|D\s*\d+|Day\s*\d+))/gi,
      "\n",
    )
    .split("\n");
}

function hasItineraryStructure(content: string) {
  return splitItineraryLines(content).some((line) =>
    DAY_HEADING_PATTERN.test(normalizeItineraryLine(line)),
  );
}

function parsePlaceLine(line: string): ItineraryPlace | null {
  const normalized = line.trim().replace(/^[-*]\s*/, "");
  const match = normalized.match(
    /\[\[PLACE\|([^|\]\n]*)\|([^|\]\n]+)\|([^|\]\n]*)\|([^|\]\n]*)\|([^|\]\n]*)\|([^|\]\n]*)\|([^|\]\n]*)\]\]/,
  );
  if (!match) return null;
  return {
    time: match[1].trim(),
    name: match[2].trim(),
    category: match[3].trim() || "行程",
    duration: match[4].trim(),
    budget: match[5].trim(),
    description: match[6].trim(),
    city: match[7].trim(),
  };
}

function parseItineraryContent(content: string) {
  const intro: string[] = [];
  const days: ItineraryDay[] = [];
  let currentDay: ItineraryDay | null = null;

  for (const rawLine of splitItineraryLines(content)) {
    const line = rawLine.trim();
    const plainLine = normalizeItineraryLine(line);
    if (DAY_HEADING_PATTERN.test(plainLine)) {
      const date = plainLine.match(/20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/)?.[0] ?? "";
      currentDay = {
        title: plainLine,
        label: `D${days.length + 1}`,
        date,
        lines: [],
        places: [],
      };
      days.push(currentDay);
      continue;
    }
    if (!currentDay) {
      if (line) intro.push(line);
      continue;
    }
    currentDay.lines.push(line);
    const place = parsePlaceLine(line);
    if (place) currentDay.places.push(place);
  }
  return { intro, days };
}

function extractItineraryDaySummary(lines: string[]): ItineraryDaySummary {
  const activity = lines.find((line) =>
    /^(?:每日|当日|本日).*(?:活动.*)?(?:合计|小计|汇总)|^日合计/.test(
      line.trim().replace(/^#{1,3}\s*/, ""),
    ),
  );
  const traffic = lines.find((line) =>
    /^\[\[TRAFFIC_TOTAL\|/.test(line.trim()),
  );
  const trafficFields = traffic
    ?.trim()
    .match(/^\[\[TRAFFIC_TOTAL\|[^|]*\|([^|]*)\|([^|]*)\|([^|]*)\]\]$/);
  return {
    activity: activity?.trim().replace(/^#{1,3}\s*/, ""),
    traffic: trafficFields
      ? `已核验交通：${trafficFields[1]}｜步行 ${trafficFields[2]}｜交通费 ${trafficFields[3]}`
      : undefined,
  };
}

function buildAmapPlaceUrl(place: ItineraryPlace) {
  const query = [place.city, place.name].filter(Boolean).join(" ");
  return `https://www.amap.com/search?query=${encodeURIComponent(query)}`;
}

function PlaceImage({ place }: { place: ItineraryPlace }) {
  const [image, setImage] = useState<PlaceImageData | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "empty">(
    "loading",
  );

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ name: place.name, city: place.city });
    fetch(`/api/place-image?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: PlaceImageData | null) => {
        if (!data?.imageUrl) {
          setStatus("empty");
          return;
        }
        setImage(data);
        setStatus("loaded");
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setStatus("empty");
      });
    return () => controller.abort();
  }, [place.city, place.name]);

  if (status === "loading") {
    return <div className="place-image-skeleton" aria-label="正在加载景点图片" />;
  }
  if (status === "empty" || !image?.imageUrl) {
    return (
      <div className="place-image-empty">
        <span aria-hidden="true">景</span>
        <small>暂无可核验图片</small>
      </div>
    );
  }
  return (
    <figure className="place-image">
      <img
        src={image.imageUrl}
        alt={`${place.name}景点图片`}
        loading="lazy"
        onError={() => setStatus("empty")}
      />
      {image.sourceUrl && (
        <figcaption>
          <a href={image.sourceUrl} target="_blank" rel="noreferrer">
            图片来源与授权信息
          </a>
        </figcaption>
      )}
    </figure>
  );
}

function getPlaceCategoryIcon(place: ItineraryPlace) {
  const text = `${place.category} ${place.name}`;
  if (/餐|美食|小吃|咖啡|茶/.test(text)) return "🍜";
  if (/山|徒步|登山|峡谷/.test(text)) return "⛰️";
  if (/海|沙滩|海岛|滨海/.test(text)) return "🏝️";
  if (/公园|湿地|森林|自然|花园/.test(text)) return "🌳";
  if (/博物馆|历史|人文|古迹|寺|宫|文化/.test(text)) return "🏛️";
  if (/购物|商场|街区|商业/.test(text)) return "🛍️";
  if (/酒店|住宿|民宿/.test(text)) return "🛏️";
  if (/交通|车站|机场|码头/.test(text)) return "🚉";
  if (/乐园|娱乐|演出|剧场/.test(text)) return "🎡";
  return "📍";
}

function PlaceCard({ place }: { place: ItineraryPlace }) {
  const showImage = !/(?:交通|车站|机场|酒店|住宿|餐饮|用餐)/.test(
    place.category,
  );
  return (
    <article
      className={`itinerary-place-card ${showImage ? "" : "no-image"}`}
    >
      {showImage && <PlaceImage place={place} />}
      <div className="place-card-body">
        <div className="place-card-heading">
          <span className="place-time">{place.time || "时间待定"}</span>
          <span
            className="place-category-icon"
            title={place.category}
            aria-label={`类型：${place.category}`}
          >
            {getPlaceCategoryIcon(place)}
          </span>
        </div>
        <h4>{place.name}</h4>
        <p>{place.description || "具体游览顺序可根据现场客流调整。"}</p>
        <div className="place-meta">
          {place.duration && <span>停留 {place.duration}</span>}
          {place.budget && <span>{normalizeMoneyForDisplay(place.budget)}</span>}
        </div>
        <a
          className="place-map-link"
          href={buildAmapPlaceUrl(place)}
          target="_blank"
          rel="noreferrer"
        >
          在高德查看
        </a>
      </div>
    </article>
  );
}

type MapCoordinate = [number, number];

interface DailyMapPreview {
  imageUrl: string;
  points: MapCoordinate[];
  segments: Array<{ points: MapCoordinate[]; actual: boolean }>;
  viewport: {
    center: MapCoordinate;
    zoom: number;
    width: number;
    height: number;
  };
}

const dailyMapPreviewCache = new Map<string, Promise<DailyMapPreview>>();

function buildDailyMapUrl(points: ItineraryPlace[]) {
  const places = points.map(({ name, city }) => ({ name, city }));
  return `/api/daily-map?${new URLSearchParams({
    places: JSON.stringify(places),
    version: "3",
  }).toString()}`;
}

function loadDailyMapPreview(url: string) {
  const cached = dailyMapPreviewCache.get(url);
  if (cached) return cached;
  const request = fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error("地图预览暂不可用");
      const rawOverlay = response.headers.get("X-RouteSense-Overlay");
      if (!rawOverlay) throw new Error("地图路线数据缺失");
      const overlay = JSON.parse(rawOverlay) as Omit<DailyMapPreview, "imageUrl">;
      if (
        !Array.isArray(overlay.points) ||
        !Array.isArray(overlay.segments) ||
        !overlay.viewport
      ) {
        throw new Error("地图路线数据无效");
      }
      const blob = await response.blob();
      return { ...overlay, imageUrl: URL.createObjectURL(blob) };
    })
    .catch((error) => {
      dailyMapPreviewCache.delete(url);
      throw error;
    });
  dailyMapPreviewCache.set(url, request);
  return request;
}

function projectMapCoordinate([longitude, latitude]: MapCoordinate) {
  const safeLatitude = Math.max(-85, Math.min(85, latitude));
  const sin = Math.sin((safeLatitude * Math.PI) / 180);
  return [
    (longitude + 180) / 360,
    0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  ] as MapCoordinate;
}

function RouteMapOverlay({ preview }: { preview: DailyMapPreview }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const surface = canvas?.parentElement;
    if (!canvas || !surface) return;

    const draw = () => {
      const width = surface.clientWidth;
      const height = surface.clientHeight;
      if (!width || !height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const center = projectMapCoordinate(preview.viewport.center);
      const worldSize = 256 * 2 ** preview.viewport.zoom;
      const toPixel = (coordinate: MapCoordinate) => {
        const projected = projectMapCoordinate(coordinate);
        const mapX =
          preview.viewport.width / 2 + (projected[0] - center[0]) * worldSize;
        const mapY =
          preview.viewport.height / 2 + (projected[1] - center[1]) * worldSize;
        return [
          (mapX / preview.viewport.width) * width,
          (mapY / preview.viewport.height) * height,
        ] as MapCoordinate;
      };

      for (const segment of preview.segments) {
        if (segment.points.length < 2) continue;
        const pixels = segment.points.map(toPixel);
        context.beginPath();
        context.moveTo(pixels[0][0], pixels[0][1]);
        for (const [x, y] of pixels.slice(1)) context.lineTo(x, y);
        context.setLineDash([]);
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = "rgba(255,255,255,0.92)";
        context.lineWidth = 7;
        context.stroke();
        context.beginPath();
        context.moveTo(pixels[0][0], pixels[0][1]);
        for (const [x, y] of pixels.slice(1)) context.lineTo(x, y);
        context.setLineDash(segment.actual ? [] : [7, 6]);
        context.strokeStyle = "#08775d";
        context.lineWidth = 3;
        context.stroke();
      }

      context.setLineDash([]);
      preview.points.forEach((point, index) => {
        const [x, y] = toPixel(point);
        context.beginPath();
        context.arc(x, y, 12, 0, Math.PI * 2);
        context.fillStyle = "#08775d";
        context.fill();
        context.strokeStyle = "white";
        context.lineWidth = 3;
        context.stroke();
        context.fillStyle = "white";
        context.font = "800 11px system-ui, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(index + 1), x, y + 0.5);
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [preview]);

  return (
    <canvas ref={canvasRef} className="route-map-overlay" aria-hidden="true" />
  );
}

function ActualRouteMap({
  points,
  title,
  overview,
}: {
  points: ItineraryPlace[];
  title: string;
  overview: boolean;
}) {
  const mapUrl = useMemo(() => buildDailyMapUrl(points), [points]);
  const [mapState, setMapState] = useState<"loading" | "loaded" | "unavailable">(
    "loading",
  );
  const [preview, setPreview] = useState<DailyMapPreview | null>(null);

  useEffect(() => {
    let active = true;
    setMapState("loading");
    setPreview(null);
    loadDailyMapPreview(mapUrl)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch(() => {
        if (active) setMapState("unavailable");
      });
    return () => {
      active = false;
    };
  }, [mapUrl]);

  return (
    <section className="itinerary-route-canvas" aria-label="当天真实地点路线预览">
      <div className="route-canvas-heading">
        <div>
          <span>行程路线脉络</span>
          <strong>{overview ? "全程地点总览" : title}</strong>
        </div>
        <small>
          {mapState === "loaded"
            ? "高德地点定位 · 当日路线已缓存"
            : mapState === "unavailable"
              ? "地图底图暂不可用"
              : "正在生成并保存当天地图…"}
        </small>
      </div>
      <div className={`route-map-surface ${mapState}`}>
        {preview && mapState !== "unavailable" && (
          <>
            <img
              src={preview.imageUrl}
              alt={`${title}的真实地点路线图`}
              onLoad={() => setMapState("loaded")}
              onError={() => setMapState("unavailable")}
            />
            <RouteMapOverlay preview={preview} />
          </>
        )}
        {mapState !== "loaded" && (
          <div className="route-canvas-track" aria-label="地点顺序预览">
            {points.map((place, index) => (
              <a
                key={`${place.name}-${index}`}
                href={buildAmapPlaceUrl(place)}
                target="_blank"
                rel="noreferrer"
              >
                <i>{index + 1}</i>
                <span>{place.name}</span>
              </a>
            ))}
          </div>
        )}
        {mapState === "unavailable" && (
          <small className="route-map-fallback">
            暂未获取到地图底图，已保留景点顺序预览；下方交通卡片仍可查看各段距离与用时。
          </small>
        )}
      </div>
      {mapState === "loaded" && (
        <div className="route-map-legend" aria-label="地点图例">
          {points.map((place, index) => (
            <a
              key={`${place.name}-${index}`}
              href={buildAmapPlaceUrl(place)}
              target="_blank"
              rel="noreferrer"
            >
              <b>{index + 1}</b>
              {place.name}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function ItineraryRouteCanvas({
  days,
  activeDay,
}: {
  days: ItineraryDay[];
  activeDay: number;
}) {
  const points = (
    activeDay < 0
      ? days
          .map((day) => day.places[0])
          .filter((place): place is ItineraryPlace => Boolean(place))
      : days[activeDay]?.places ?? []
  ).slice(0, 6);
  if (!points.length) return null;
  return (
    <ActualRouteMap
      points={points}
      title={activeDay < 0 ? "全程地点总览" : days[activeDay]?.title || "当日行程"}
      overview={activeDay < 0}
    />
  );
}

function renderItineraryLine(line: string, index: number) {
  const cleanLine = line.trim();
  const plainLine = cleanLine.replace(/^#{1,3}\s*/, "");
  if (!plainLine || /^-{3,}$/.test(plainLine)) return null;
  if (/^\[\[TRAFFIC_TOTAL\|/.test(plainLine)) return null;
  const place = parsePlaceLine(cleanLine);
  if (place) return <PlaceCard key={`${place.name}-${index}`} place={place} />;
  if (
    /^(?:每日|当日|本日).*(?:合计|小计|汇总)|^日合计/.test(plainLine)
  ) {
    return null;
  }
  if (/^(?:→|->|—>|➜)/.test(plainLine)) {
    const routeText = plainLine.replace(/^(?:→|->|—>|➜)\s*/, "");
    const [routeTitle, ...routeDetails] = routeText.split("｜");
    return (
      <div className="itinerary-route-step" key={`${plainLine}-${index}`}>
        <span aria-hidden="true">↓</span>
        <div>
          <strong>{routeTitle}</strong>
          {routeDetails.length > 0 && <p>{renderLinkedText(routeDetails.join("｜"))}</p>}
        </div>
      </div>
    );
  }
  if (/^(?:实时核验|数据来源|核验说明|待核验)/.test(plainLine)) {
    return (
      <p className="itinerary-verification" key={`${plainLine}-${index}`}>
        {renderLinkedText(plainLine)}
      </p>
    );
  }
  return (
    <p key={`${plainLine}-${index}`}>{renderLinkedText(plainLine)}</p>
  );
}

function renderItineraryTimeline(lines: string[]) {
  return lines.flatMap((line, index) => {
    if (
      /^\[\[TRAFFIC_TOTAL\|/.test(line.trim()) ||
      /^(?:每日|当日|本日).*(?:合计|小计|汇总)|^日合计/.test(
        line.trim().replace(/^#{1,3}\s*/, ""),
      )
    ) {
      return [];
    }
    const rendered = renderItineraryLine(line, index);
    const currentPlace = parsePlaceLine(line);
    const nextLine = lines.slice(index + 1).find((item) => item.trim());
    const nextPlace = nextLine ? parsePlaceLine(nextLine) : null;
    const implicitMove =
      currentPlace && nextPlace
        ? (
            <div
              className="itinerary-place-transition"
              key={`transition-${currentPlace.name}-${nextPlace.name}-${index}`}
            >
              <span aria-hidden="true">↓</span>
              <strong>{currentPlace.name} → {nextPlace.name}</strong>
              <small>下一站；建议步行或公共交通，以导航为准</small>
            </div>
          )
        : null;
    return [rendered, implicitMove].filter(Boolean);
  });
}

function ItineraryDayTabs({
  days,
  activeDay,
  onSelect,
  label,
}: {
  days: ItineraryDay[];
  activeDay: number;
  onSelect: (index: number) => void;
  label: string;
}) {
  return (
    <nav className="itinerary-day-tabs" aria-label={label}>
      <button
        type="button"
        className={activeDay === -1 ? "selected" : ""}
        onClick={() => onSelect(-1)}
      >
        总览
      </button>
      {days.map((day, index) => (
        <button
          key={`${label}-${day.title}-${index}`}
          type="button"
          className={activeDay === index ? "selected" : ""}
          onClick={() => onSelect(index)}
        >
          {day.label}
        </button>
      ))}
    </nav>
  );
}

function AssistantMessageContent({ content }: { content: string }) {
  const itinerary = useMemo(() => parseItineraryContent(content), [content]);
  const [activeDay, setActiveDay] = useState(0);
  const displayedActiveDay =
    activeDay >= itinerary.days.length ? -1 : activeDay;

  useEffect(() => {
    const dailyPoints = itinerary.days
      .map((day) => day.places.slice(0, 6))
      .filter((points) => points.length >= 2);
    const overviewPoints = itinerary.days
      .map((day) => day.places[0])
      .filter((place): place is ItineraryPlace => Boolean(place))
      .slice(0, 6);
    if (overviewPoints.length >= 2) dailyPoints.push(overviewPoints);
    let active = true;
    void (async () => {
      for (const points of dailyPoints) {
        if (!active) break;
        await loadDailyMapPreview(buildDailyMapUrl(points)).catch(
          () => undefined,
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [itinerary]);

  if (itinerary.days.length > 0) {
    const selectedDay =
      displayedActiveDay >= 0 ? itinerary.days[displayedActiveDay] : null;
    const selectedDaySummary = selectedDay
      ? extractItineraryDaySummary(selectedDay.lines)
      : null;
    return (
      <div className="assistant-answer-content itinerary-planner">
        {itinerary.intro.length > 0 && (
          <div className="itinerary-intro">
            {itinerary.intro.map((line, index) => (
              <p key={`${line}-${index}`}>{renderLinkedText(line)}</p>
            ))}
          </div>
        )}

        <ItineraryRouteCanvas
          days={itinerary.days}
          activeDay={displayedActiveDay}
        />

        <ItineraryDayTabs
          days={itinerary.days}
          activeDay={displayedActiveDay}
          onSelect={setActiveDay}
          label="选择查看某一天行程"
        />

        {selectedDay ? (
          <section className="itinerary-day-detail">
            <header>
              <span>{selectedDay.label}</span>
              <div>
                <h3>{selectedDay.title}</h3>
                <small>{selectedDay.date || "日期以最终出发安排为准"}</small>
              </div>
            </header>
            <div className="itinerary-timeline">
              {renderItineraryTimeline(selectedDay.lines)}
            </div>
            {(selectedDaySummary?.activity || selectedDaySummary?.traffic) && (
              <div className="itinerary-day-total itinerary-combined-total">
                <strong>当日活动与交通小计</strong>
                {selectedDaySummary.activity && (
                  <span>{selectedDaySummary.activity}</span>
                )}
                {selectedDaySummary.traffic && (
                  <span>{selectedDaySummary.traffic}</span>
                )}
              </div>
            )}
            <div className="itinerary-bottom-switcher">
              <strong>查看其他日程</strong>
              <ItineraryDayTabs
                days={itinerary.days}
                activeDay={displayedActiveDay}
                onSelect={setActiveDay}
                label="在每日规划底部选择其他日程"
              />
            </div>
          </section>
        ) : (
          <div className="itinerary-overview-list">
            {itinerary.days.map((day, index) => (
              <button
                type="button"
                key={`${day.title}-${index}`}
                onClick={() => setActiveDay(index)}
              >
                <i aria-hidden="true" />
                <div>
                  <strong>{day.title}</strong>
                  <span>
                    {day.places.length
                      ? day.places.map((place) => place.name).join(" → ")
                      : "点击查看当日详细安排"}
                  </span>
                </div>
                <small>{day.date || `第 ${index + 1} 天`}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="assistant-answer-content">
      {content.split("\n").map((line, index) => {
        const cleanLine = line.trim();
        const plainLine = cleanLine.replace(/^#{1,3}\s*/, "");
        if (DAY_HEADING_PATTERN.test(plainLine)) {
          return (
            <h3 className="itinerary-day-heading" key={`${plainLine}-${index}`}>
              {plainLine}
            </h3>
          );
        }
        return renderItineraryLine(line, index);
      })}
    </div>
  );
}

const scenarioRows = [
  {
    type: "模糊探索",
    tier: "小模型 78%",
    strategy: "澄清",
    success: "91%",
    issue: "过度澄清 3 例",
  },
  {
    type: "历史偏好",
    tier: "通用模型 72%",
    strategy: "记忆检索",
    success: "93%",
    issue: "记忆不足 2 例",
  },
  {
    type: "实时比较",
    tier: "通用模型 61%",
    strategy: "搜索 / 工具",
    success: "90%",
    issue: "数据冲突 4 例",
  },
  {
    type: "多约束决策",
    tier: "强推理 84%",
    strategy: "搜索 / 规划",
    success: "94%",
    issue: "遗漏约束 2 例",
  },
];

const failureCases = [
  {
    id: "旅行案例-037",
    label: "遗漏硬约束",
    detail: "通用模型遗漏“减少步行”，已升级强推理模型并挽回。",
    status: "已恢复",
  },
  {
    id: "旅行案例-052",
    label: "工具数据冲突",
    detail: "两处景点开放时间不一致，系统停止生成并要求来源复核。",
    status: "待复核",
  },
  {
    id: "旅行案例-089",
    label: "无效澄清",
    detail: "用户已给出预算，规则仍重复询问预算，已加入误路由集。",
    status: "已入集",
  },
];

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatCost(value: number) {
  return `¥${value.toFixed(3)}`;
}

function formatRuleVersion(value: string) {
  return `路由规则第 ${value.replace("route-v", "")} 版`;
}

function formatRunTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function prettyJson(value?: string | null) {
  if (!value) return "无";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function consumeChatStream(
  response: Response,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<ChatStreamResult> {
  if (!response.body) {
    return { error: { error: "模型未响应，本次未生成答案。" } };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: ApiChatResponse | undefined;
  let finalError: ApiChatResponse | undefined;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ChatStreamEvent;
    onEvent(event);
    if (event.type === "done") finalResult = event;
    if (event.type === "error") finalError = event;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) handleLine(buffer);

  return { result: finalResult, error: finalError };
}

export function RouteSenseApp() {
  const [tab, setTab] = useState<Tab>("demo");
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [conversationDialog, setConversationDialog] =
    useState<ConversationDialog | null>(null);
  const [query, setQuery] = useState("");
  const [supplementPrompt, setSupplementPrompt] =
    useState<SupplementPrompt | null>(null);
  const [supplementOpen, setSupplementOpen] = useState(false);
  const [supplementBaseQuery, setSupplementBaseQuery] = useState("");
  const [supplementBypassQuery, setSupplementBypassQuery] = useState("");
  const [supplementForm, setSupplementForm] = useState<SupplementFormState>(
    EMPTY_SUPPLEMENT_FORM,
  );
  const [travelOptions, setTravelOptions] = useState<TravelOptionsState>(
    EMPTY_TRAVEL_OPTIONS,
  );
  const [tripSetupPrompt, setTripSetupPrompt] =
    useState<TripSetupPrompt | null>(null);
  const [tripSetupInput, setTripSetupInput] = useState("");
  const [destinationOpen, setDestinationOpen] = useState(false);
  const [destinationStep, setDestinationStep] =
    useState<DestinationDiscoveryStep>("location");
  const [destinationForm, setDestinationForm] =
    useState<DestinationDiscoveryForm>(EMPTY_DESTINATION_DISCOVERY_FORM);
  const [destinationSuggestions, setDestinationSuggestions] = useState<
    DestinationSuggestion[]
  >([]);
  const [destinationLoading, setDestinationLoading] = useState(false);
  const [destinationError, setDestinationError] = useState("");
  const [locationState, setLocationState] = useState<
    "idle" | "locating" | "success" | "error"
  >("idle");
  const [apiStatus, setApiStatus] = useState<ApiStatusResponse | null>(null);
  const [decision, setDecision] = useState<RouteDecision>(initialDecision);
  const [agentPreference, setAgentPreference] = useState<AgentPreference>("auto");
  const [developerView, setDeveloperView] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [feedbackSaveState, setFeedbackSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [latestRunId, setLatestRunId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState("");
  const [settings, setSettings] = useState<RouterSettings>(DEFAULT_SETTINGS);
  const [apiMode, setApiMode] = useState<ApiMode>("checking");
  const [isReplying, setIsReplying] = useState(false);
  const [executionState, setExecutionState] =
    useState<ExecutionState>("idle");
  const [executionError, setExecutionError] = useState("");
  const [actualUsage, setActualUsage] = useState<{
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    latencyMs: number | null;
    attempts: number;
  } | null>(null);
  const [experimentState, setExperimentState] = useState<
    "ready" | "running" | "complete"
  >("complete");

  const costSaving = useMemo(() => {
    const dynamic = EXPERIMENT_SUMMARIES.find((item) => item.group === "dynamic")!;
    const strong = EXPERIMENT_SUMMARIES.find(
      (item) => item.group === "all_reasoning",
    )!;
    return Math.round(
      (1 - dynamic.costPerSuccess / strong.costPerSuccess) * 100,
    );
  }, []);

  const hasConversation = messages.some(
    (message) => message.id !== welcomeMessage.id,
  );
  const preferenceTags = useMemo(() => buildPreferenceTags(messages), [messages]);
  const currentTripTags = useMemo(() => buildCurrentTripTags(messages), [messages]);
  const latestUserQuery = [...messages]
    .reverse()
    .find((message) => message.role === "user")?.content ?? "";
  const planningAssistantQuery = isItineraryPlanningRequest(query)
    ? query
    : !query.trim() && isItineraryPlanningRequest(latestUserQuery)
      ? latestUserQuery
      : "";
  const shouldShowPlanningAssistant = Boolean(planningAssistantQuery);
  const canClearConversation =
    hasConversation ||
    query.trim().length > 0 ||
    supplementOpen ||
    supplementPrompt !== null ||
    destinationOpen ||
    tripSetupPrompt !== null;

  useEffect(() => {
    const origin = supplementForm.origin.trim();
    const destination = supplementForm.destination.trim();
    if (!supplementOpen || !origin || !destination) {
      setTravelOptions(EMPTY_TRAVEL_OPTIONS);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setTravelOptions({
      status: "loading",
      options: [],
      note: "正在根据两地距离筛选可行出行方式…",
    });
    const timeoutId = window.setTimeout(() => {
      const params = new URLSearchParams({ origin, destination });
      fetch(`/api/travel-options?${params.toString()}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          const result = (await response.json()) as TravelOptionsResponse;
          if (!response.ok || !result.options?.length) {
            throw new Error(result.error || "交通方式筛选失败");
          }
          return result;
        })
        .then((result) => {
          if (!active) return;
          const options = result.options ?? [];
          setTravelOptions({
            status: "ready",
            options,
            note: result.note || "已按两地距离筛选可行方式。",
          });
          setSupplementForm((current) =>
            current.transportMode && !options.includes(current.transportMode)
              ? { ...current, transportMode: "" }
              : current,
          );
        })
        .catch((error) => {
          if (!active || error instanceof DOMException) return;
          setTravelOptions({
            status: "error",
            options: [],
            note: "暂时无法判断距离；请留空让系统结合地点与预算选择。",
          });
        });
    }, 450);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [supplementOpen, supplementForm.origin, supplementForm.destination]);

  useEffect(() => {
    let active = true;
    fetch("/api/chat")
      .then(async (response) => {
        if (!response.ok) throw new Error("接口状态检查失败");
        return (await response.json()) as ApiStatusResponse;
      })
      .then((status) => {
        if (active) {
          setApiStatus(status);
          setApiMode(status.mode === "live" ? "live" : "demo");
        }
      })
      .catch(() => {
        if (active) setApiMode("error");
      });

    return () => {
      active = false;
    };
  }, []);

  async function loadRuns() {
    setRunsLoading(true);
    setRunsError("");
    try {
      const response = await fetch("/api/runs?limit=30", { cache: "no-store" });
      const result = (await response.json()) as {
        runs?: RunRecord[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error || "运行记录读取失败。");
      }
      const nextRuns = result.runs ?? [];
      setRuns(nextRuns);
      setSelectedRunId((current) =>
        current && nextRuns.some((run) => run.id === current)
          ? current
          : nextRuns[0]?.id ?? null,
      );
    } catch (error) {
      setRunsError(
        error instanceof Error ? error.message : "运行记录读取失败。",
      );
    } finally {
      setRunsLoading(false);
    }
  }

  useEffect(() => {
    if (tab !== "runs") return;
    const timeoutId = window.setTimeout(() => void loadRuns(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [tab]);

  function resetSupplement() {
    setSupplementPrompt(null);
    setSupplementOpen(false);
    setSupplementBaseQuery("");
    setSupplementBypassQuery("");
    setSupplementForm({ ...EMPTY_SUPPLEMENT_FORM });
    setTravelOptions(EMPTY_TRAVEL_OPTIONS);
  }

  function resetDestinationDiscovery() {
    setDestinationOpen(false);
    setDestinationStep("location");
    setDestinationForm({ ...EMPTY_DESTINATION_DISCOVERY_FORM });
    setDestinationSuggestions([]);
    setDestinationLoading(false);
    setDestinationError("");
    setLocationState("idle");
  }

  function startDestinationDiscovery(baseQuery: string, initialOrigin = "") {
    setTripSetupPrompt(null);
    setTripSetupInput("");
    setDestinationOpen(true);
    setDestinationStep("location");
    setDestinationForm({
      ...EMPTY_DESTINATION_DISCOVERY_FORM,
      origin: initialOrigin,
    });
    setDestinationSuggestions([]);
    setDestinationError("");
    setLocationState("idle");
    setSupplementBaseQuery(baseQuery.trim());
  }

  async function locateCurrentPosition() {
    if (!navigator.geolocation) {
      setLocationState("error");
      setDestinationError("当前浏览器不支持定位，请直接填写出发地。");
      return;
    }
    setLocationState("locating");
    setDestinationError("");
    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            timeout: 10_000,
            maximumAge: 10 * 60 * 1000,
          }),
      );
      const params = new URLSearchParams({
        lat: String(position.coords.latitude),
        lon: String(position.coords.longitude),
      });
      const response = await fetch(`/api/location?${params.toString()}`);
      const result = (await response.json()) as LocationLookupResponse;
      if (!response.ok) throw new Error(result.error || "位置解析失败");
      const place = result.city || result.district || result.province || "";
      if (!place) throw new Error("未能识别所在城市");
      setDestinationForm((current) => ({
        ...current,
        origin: place,
        locatedPlace: result.displayName || place,
      }));
      setLocationState("success");
    } catch (error) {
      setLocationState("error");
      const geolocationCode =
        error && typeof error === "object" && "code" in error
          ? Number(error.code)
          : 0;
      setDestinationError(
        geolocationCode > 0
          ? "未获得定位权限，请直接填写出发地。"
          : error instanceof Error
            ? `${error.message}，请直接填写出发地。`
            : "定位失败，请直接填写出发地。",
      );
    }
  }

  function toggleDestinationInterest(interest: string) {
    setDestinationForm((current) => ({
      ...current,
      interests: current.interests.includes(interest)
        ? current.interests.filter((item) => item !== interest)
        : [...current.interests, interest],
    }));
  }

  function toggleDestinationTransport(mode: string) {
    setDestinationForm((current) => ({
      ...current,
      transportModes: current.transportModes.includes(mode)
        ? current.transportModes.filter((item) => item !== mode)
        : [...current.transportModes, mode],
    }));
  }

  async function requestDestinationSuggestions() {
    if (!destinationForm.origin.trim() || !destinationForm.scope) return;
    setDestinationLoading(true);
    setDestinationError("");
    try {
      const response = await fetch("/api/destination-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: destinationForm.origin,
          scope: destinationForm.scope,
          interests: destinationForm.interests,
          transportModes: destinationForm.transportModes,
          maxTravelTime: destinationForm.maxTravelTime,
          extra: destinationForm.extra,
        }),
      });
      const result = (await response.json()) as {
        suggestions?: DestinationSuggestion[];
        error?: string;
      };
      if (!response.ok || !result.suggestions?.length) {
        throw new Error(result.error || "暂时没有生成目的地建议");
      }
      setDestinationSuggestions(result.suggestions);
      setDestinationStep("results");
    } catch (error) {
      setDestinationError(
        error instanceof Error ? error.message : "目的地推荐失败，请稍后重试。",
      );
    } finally {
      setDestinationLoading(false);
    }
  }

  function chooseDestination(suggestion: DestinationSuggestion) {
    const refinedQuery = [
      `我计划从${destinationForm.origin}前往${suggestion.destination}旅行。`,
      `出行范围：${destinationForm.scope}。`,
      destinationForm.interests.length
        ? `旅行兴趣：${destinationForm.interests.join("、")}。`
        : "",
      destinationForm.transportModes.length
        ? `可接受出行方式：${destinationForm.transportModes.join("、")}。`
        : "",
      destinationForm.maxTravelTime
        ? `单程最长通行时间：${destinationForm.maxTravelTime}。`
        : "",
      destinationForm.extra.trim()
        ? `其他偏好：${destinationForm.extra.trim()}。`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    resetDestinationDiscovery();
    setQuery(refinedQuery);
    startSupplement(refinedQuery);
  }

  function continueTripSetup() {
    if (!tripSetupPrompt) return;
    const input = tripSetupInput.trim();
    const { kind, query: pendingQuery, origin, destination } = tripSetupPrompt;
    let refinedQuery = pendingQuery;
    if (kind === "origin_only" && input) {
      refinedQuery = `我计划从${origin}前往${input}旅行。`;
    }
    if (kind === "destination_only" && input) {
      refinedQuery = `我计划从${input}前往${destination}旅行。`;
    }
    setTripSetupPrompt(null);
    setTripSetupInput("");
    startSupplement(refinedQuery);
  }

  function startSupplement(baseQuery = planningAssistantQuery || query) {
    const cleanQuery = baseQuery.trim();
    if (!cleanQuery) return;
    const detected = detectSupplementDetails(cleanQuery);

    setSupplementPrompt(null);
    setSupplementOpen(true);
    setSupplementBaseQuery(cleanQuery);
    setSupplementForm({
      ...EMPTY_SUPPLEMENT_FORM,
      origin: detected.origin ?? "",
      destination: detected.destination ?? "",
      startDate: detected.startDate ?? "",
      duration: detected.duration ?? "",
      budget: detected.budget ?? "",
      budgetScope: detected.budgetScope ?? "",
      travelers: detected.travelers ?? "",
      travelPurposes: detected.travelPurposes ?? [],
      transportMode: detected.transportMode ?? "",
      roomCount: detected.roomCount ?? "",
      bedType: detected.bedType ?? "",
    });
  }

  function updateSupplementField(
    field: SupplementTextField,
    value: string,
  ) {
    setSupplementForm((current) => ({ ...current, [field]: value }));
  }

  function updateTravelerCount(value: string) {
    setSupplementForm((current) => ({
      ...current,
      travelers: value,
      bedType:
        getSelectedTravelerCount(value) < 3 &&
        isGroupRoomPreference(current.bedType)
          ? ""
          : current.bedType,
    }));
  }

  function toggleSupplementPurpose(purpose: string) {
    setSupplementForm((current) => ({
      ...current,
      travelPurposes: current.travelPurposes.includes(purpose)
        ? current.travelPurposes.filter((item) => item !== purpose)
        : [...current.travelPurposes, purpose],
    }));
  }

  function applySupplementedQuery(sendImmediately = false) {
    if (!supplementBaseQuery.trim()) return;
    const refinedQuery = buildSupplementedQuery(
      supplementBaseQuery,
      supplementForm,
      travelOptions.status === "ready" ? travelOptions.note : "",
    );
    setSupplementPrompt(null);
    setSupplementOpen(false);
    setQuery(refinedQuery);
    if (sendImmediately) {
      setSupplementBypassQuery("");
      void submitQuery(refinedQuery, { skipCompletenessCheck: true });
    } else {
      setSupplementBypassQuery(refinedQuery);
    }
  }

  function continueWithoutSupplement() {
    const pendingQuery = supplementPrompt?.query;
    if (!pendingQuery) return;
    setSupplementPrompt(null);
    void submitQuery(pendingQuery, { skipCompletenessCheck: true });
  }

  function resetConversation() {
    setMessages([welcomeMessage]);
    setQuery("");
    resetSupplement();
    resetDestinationDiscovery();
    setTripSetupPrompt(null);
    setTripSetupInput("");
    setDecision(routeQuery(defaultQuery, settings));
    setFeedback(null);
    setFeedbackSaveState("idle");
    setLatestRunId(null);
    setExecutionState("idle");
    setExecutionError("");
    setActualUsage(null);
  }

  async function submitQuery(
    nextQuery = query,
    options: { skipCompletenessCheck?: boolean } = {},
  ) {
    const cleanQuery = nextQuery.trim();
    if (!cleanQuery || isReplying) return;
    const shouldUseConversation = explicitlyReferencesConversation(cleanQuery);
    // 不再把完整聊天记录发送给模型。承接上文时只使用下方结构化行程摘要。
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const profile =
      preferenceTags.length || (shouldUseConversation && currentTripTags.length)
        ? {
            preference_tags: preferenceTags,
            trip_context: shouldUseConversation ? currentTripTags : [],
          }
        : undefined;

    const shouldSkipCompletenessCheck =
      options.skipCompletenessCheck || cleanQuery === supplementBypassQuery;

    const tripSetup = getTripSetupPrompt(cleanQuery);
    if (!shouldSkipCompletenessCheck && tripSetup) {
      setTripSetupPrompt(tripSetup);
      setTripSetupInput("");
      setSupplementPrompt(null);
      setDestinationOpen(false);
      return;
    }

    if (!shouldSkipCompletenessCheck && isItineraryPlanningRequest(cleanQuery)) {
      const missingFields = getMissingCoreFields(cleanQuery);
      if (missingFields.length > 0) {
        setSupplementPrompt({ query: cleanQuery, missingFields });
        setSupplementOpen(false);
        return;
      }
    }

    setSupplementBypassQuery("");

    const nextDecision = routeQuery(cleanQuery, settings, {
      history,
      memory:
        shouldUseConversation && currentTripTags.length
          ? { trip_context: currentTripTags }
          : undefined,
      modelPreference: agentPreference,
    });
    const stamp = nextDecision.requestId.replace("req_", "");
    const replyId = `assistant-${stamp}`;

    setMessages((current) => [
      ...current,
      { id: `user-${stamp}`, role: "user", content: cleanQuery },
      {
        id: replyId,
        role: "assistant",
        content: "正在根据路由结果调用合适的模型…",
      },
    ]);
    setDecision(nextDecision);
    setQuery("");
    resetSupplement();
    setFeedback(null);
    setFeedbackSaveState("idle");
    setLatestRunId(null);
    setIsReplying(true);
    setExecutionState("waiting");
    setExecutionError("");
    setActualUsage(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: cleanQuery,
          history,
          profile,
          modelPreference: agentPreference,
        }),
      });
      const contentType = response.headers.get("content-type") || "";
      let streamedAnswer = "";
      let result: ApiChatResponse;

      if (contentType.includes("application/x-ndjson")) {
        const streamed = await consumeChatStream(response, (event) => {
          if (event.runId) setLatestRunId(event.runId);
          if (
            event.type === "heartbeat" &&
            !streamedAnswer &&
            (event.elapsedMs ?? 0) >= 8_000
          ) {
            setMessages((current) =>
              current.map((message) =>
                message.id === replyId
                  ? { ...message, content: "正在生成按天行程并核验交通路线…" }
                  : message,
              ),
            );
          }
          if (event.type === "replace" && event.text) {
            streamedAnswer = event.text;
            setMessages((current) =>
              current.map((message) =>
                message.id === replyId
                  ? { ...message, content: streamedAnswer }
                  : message,
              ),
            );
          }
          if (event.type === "delta" && event.text) {
            streamedAnswer += event.text;
            setMessages((current) =>
              current.map((message) =>
                message.id === replyId
                  ? { ...message, content: streamedAnswer }
                  : message,
              ),
            );
          }
        });
        if (streamed.error) {
          setActualUsage({
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            latencyMs: streamed.error.latencyMs ?? null,
            attempts: streamed.error.attempts ?? 1,
          });
          throw new Error(
            streamed.error.error || "模型未响应，本次未生成答案。",
          );
        }
        if (!streamed.result) {
          throw new Error("模型未响应，本次未生成答案。");
        }
        result = streamed.result;
      } else {
        result = (await response.json()) as ApiChatResponse;
      }
      setLatestRunId(result.runId ?? null);

      if (!response.ok) {
        setActualUsage({
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          latencyMs: result.latencyMs ?? null,
          attempts: result.attempts ?? 1,
        });
        throw new Error(result.error || "模型未响应，本次未生成答案。");
      }

      const answer = result.answer?.trim();
      if (!answer) {
        throw new Error("模型未响应，本次未生成答案。");
      }
      const nextExecutionState = result.mode === "live" ? "succeeded" : "demo";
      setExecutionState(nextExecutionState);
      setActualUsage({
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        totalTokens: result.usage?.totalTokens ?? null,
        latencyMs: result.latencyMs ?? null,
        attempts: result.attempts ?? (result.mode === "live" ? 1 : 0),
      });
      const executedDecision: RouteDecision = {
        ...nextDecision,
        response: answer,
        modelName: result.modelName || nextDecision.modelName,
        execution: {
          ...nextDecision.execution,
          inputTokens:
            result.usage?.inputTokens ?? nextDecision.execution.inputTokens,
          outputTokens:
            result.usage?.outputTokens ?? nextDecision.execution.outputTokens,
          latencyMs: result.latencyMs ?? nextDecision.execution.latencyMs,
        },
        trace:
          result.mode === "live"
            ? [
                ...nextDecision.trace,
                {
                  label: "真实模型返回",
                  detail: `已由${result.provider || "火山方舟"}完成生成，答案质量待评测`,
                  state: "complete",
                },
              ]
            : [
                ...nextDecision.trace,
                {
                  label: "本地演示",
                  detail: "当前未调用线上模型，展示的是演示结果",
                  state: "warning",
                },
              ],
      };

      setApiMode(result.mode === "live" ? "live" : "demo");
      setDecision(executedDecision);
      setMessages((current) =>
        current.map((message) =>
          message.id === replyId ? { ...message, content: answer } : message,
        ),
      );
    } catch (error) {
      const rawFailureText = error instanceof Error ? error.message : "";
      const failureText =
        !rawFailureText ||
        /failed to fetch|networkerror|load failed/i.test(rawFailureText)
          ? "模型未响应，本次未生成答案。"
          : rawFailureText;
      setApiMode("error");
      setExecutionState("failed");
      setExecutionError(failureText);
      setDecision({
        ...nextDecision,
        trace: [
          ...nextDecision.trace,
          {
            label: "模型执行失败",
            detail: failureText,
            state: "warning",
          },
        ],
      });
      setMessages((current) =>
        current.map((message) =>
          message.id === replyId
            ? { ...message, content: failureText }
            : message,
        ),
      );
    } finally {
      setIsReplying(false);
    }
  }

  async function submitFeedback(value: Feedback) {
    if (!latestRunId || feedbackSaveState === "saving") return;
    setFeedback(value);
    setFeedbackSaveState("saving");
    try {
      const response = await fetch("/api/runs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: latestRunId, feedback: value }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || "反馈保存失败。");
      }
      setFeedbackSaveState("saved");
      setRuns((current) =>
        current.map((run) =>
          run.id === latestRunId ? { ...run, feedback: value } : run,
        ),
      );
    } catch {
      setFeedbackSaveState("error");
    }
  }

  function runExperiment() {
    if (experimentState === "running") return;
    setExperimentState("running");
    window.setTimeout(() => setExperimentState("complete"), 850);
  }

  function exportExperiment() {
    downloadText(
      "routesense_experiment_v1.csv",
      buildExperimentCsv(),
      "text/csv",
    );
  }

  function exportRouteLog() {
    const {
      qualityCheck: _qualityCheck,
      execution: _estimatedExecution,
      response: _localResponse,
      ...routing
    } = decision;
    downloadText(
      `${decision.requestId}.json`,
      JSON.stringify(
        {
          routing: {
            ...routing,
            note: "路由结果只表示计划，不代表模型已响应。",
          },
          actualExecution: {
            status: executionState,
            error: executionError || null,
            usage: actualUsage,
            note:
              executionState === "succeeded"
                ? "模型已返回；答案质量仍需单独评测。"
                : executionState === "failed"
                  ? "模型未返回可展示答案，没有使用本地内容冒充模型回答。"
                  : "当前没有可确认的线上模型执行结果。",
          },
        },
        null,
        2,
      ),
      "application/json",
    );
  }

  function updateModelName(tier: ModelTier, value: string) {
    setSettings((current) => ({
      ...current,
      modelNames: { ...current.modelNames, [tier]: value },
    }));
  }

  const selectedRun =
    runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const successfulRunCount = runs.filter(
    (run) => run.status === "succeeded",
  ).length;
  const failedRunCount = runs.filter((run) => run.status === "failed").length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <div>
            <div className="brand-row">
              <span className="brand-name">RouteSense</span>
              <span className="version-chip">
                演示版 · {formatRuleVersion(settings.version)}
              </span>
            </div>
            <span className="brand-subtitle">价值感知 AI 模型路由系统</span>
          </div>
        </div>

        <nav className="primary-nav" aria-label="产品模块">
          <button
            className={tab === "demo" ? "active" : ""}
            onClick={() => setTab("demo")}
          >
            在线演示
          </button>
          <button
            className={tab === "evaluation" ? "active" : ""}
            onClick={() => setTab("evaluation")}
          >
            离线评估
          </button>
          <button
            className={tab === "runs" ? "active" : ""}
            onClick={() => setTab("runs")}
          >
            运行记录
          </button>
          <button
            className={tab === "rules" ? "active" : ""}
            onClick={() => setTab("rules")}
          >
            路由配置
          </button>
        </nav>

        <div className={`system-status ${apiMode}`}>
          <span className="status-dot" aria-hidden="true" />
          {apiMode === "live"
            ? "真实模型已连接"
            : apiMode === "demo"
              ? "演示模式"
              : apiMode === "error"
                ? "模型请求异常"
                : "正在检查接口"}
        </div>
      </header>

      {tab === "demo" && (
        <>
          <section className="product-intro">
            <div>
              <p className="eyebrow">旅游路由实验室 · 合成演示</p>
              <h1>
                只为您，生成
                <span>更佳</span>
                的旅行计划
              </h1>
              <p>
                用更合理的成本，智能选用更优模型，为您高质量完成每一次旅行规划。
              </p>
            </div>
          </section>

          <section className={`demo-grid ${developerView ? "" : "single"}`}>
            <div className="conversation-card panel">
              <div className="panel-heading">
                <div>
                  <p className="panel-kicker">用户视图</p>
                  <h2>旅游推荐助手</h2>
                </div>
                <div className="conversation-heading-actions">
                  <button
                    type="button"
                    className="clear-conversation-button"
                    disabled={!canClearConversation || isReplying}
                    onClick={() => setConversationDialog({ mode: "clear" })}
                  >
                    清空对话
                  </button>
                  <label className="switch-label">
                    <input
                      type="checkbox"
                      checked={developerView}
                      onChange={(event) => setDeveloperView(event.target.checked)}
                    />
                    <span className="switch" aria-hidden="true" />
                    开发者视图
                  </label>
                </div>
              </div>

              <section className="agent-selector" aria-label="模型选择">
                <div>
                  <span>模型选择</span>
                  <strong>
                    {agentPreference === "auto"
                      ? "自动路由：以合理成本匹配优质模型"
                      : `固定使用 ${LABEL_TEXT.tier[agentPreference]}`}
                  </strong>
                </div>
                <label>
                  <span className="sr-only">选择模型模式</span>
                  <select
                    value={agentPreference}
                    disabled={isReplying}
                    onChange={(event) =>
                      setAgentPreference(event.target.value as AgentPreference)
                    }
                  >
                    <option value="auto">自动选择</option>
                    <option value="small">Mini · 低成本</option>
                    <option value="general">Lite · 均衡</option>
                    <option value="reasoning">Pro · 高级推理</option>
                  </select>
                </label>
              </section>

              {preferenceTags.length > 0 && (
                <div className="preference-tags" aria-label="轻量旅行偏好标签">
                  <span>轻量偏好</span>
                  {preferenceTags.map((tag) => (
                    <em key={tag}>{tag}</em>
                  ))}
                  <small>只发送精简的偏好与行程摘要，不发送完整聊天记录。</small>
                </div>
              )}

              <div className="messages" aria-live="polite">
                {messages.slice(-5).map((message) => (
                  <div
                    key={message.id}
                    className={`message ${message.role} ${
                      message.role === "assistant" &&
                      hasItineraryStructure(message.content)
                        ? "itinerary-message"
                        : ""
                    }`}
                  >
                    {message.role === "assistant" && (
                      <span className="assistant-avatar" aria-hidden="true">
                        R
                      </span>
                    )}
                    <div>
                      {message.role === "assistant" ? (
                        <AssistantMessageContent content={message.content} />
                      ) : (
                        message.content.split("\n").map((line, index) => (
                          <p key={`${message.id}-${index}`}>{line || " "}</p>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {!supplementOpen && shouldShowPlanningAssistant && (
                <div className="prompt-helper-entry">
                  <div>
                    <span className="prompt-helper-icon" aria-hidden="true">
                      ✦
                    </span>
                    <p>
                      <strong>行程规划小助手</strong>
                      检测到行程规划需求；信息不足时可由你决定是否补全
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startSupplement(planningAssistantQuery)}
                    disabled={isReplying}
                  >
                    主动补全
                  </button>
                </div>
              )}

              {destinationOpen && (
                <section
                  className="destination-discovery-panel"
                  aria-label="旅游地点筛选助手"
                >
                  <div className="prompt-helper-heading">
                    <div>
                      <span>目的地筛选</span>
                      <strong>先缩小范围，再由轻量模型推荐目的地</strong>
                    </div>
                    <button
                      type="button"
                      className="prompt-helper-close"
                      onClick={resetDestinationDiscovery}
                      aria-label="关闭旅游地点筛选助手"
                    >
                      ×
                    </button>
                  </div>

                  <ol className="destination-progress" aria-label="筛选进度">
                    {[
                      ["location", "确认出发地"],
                      ["scope", "选择范围"],
                      ["interests", "选择偏好"],
                      ["results", "目的地建议"],
                    ].map(([step, label], index) => (
                      <li
                        key={step}
                        className={destinationStep === step ? "active" : ""}
                      >
                        <i>{index + 1}</i>
                        <span>{label}</span>
                      </li>
                    ))}
                  </ol>

                  {destinationStep === "location" && (
                    <div className="destination-step-card">
                      <div className="destination-step-heading">
                        <span>步骤 1</span>
                        <h3>从哪里出发？</h3>
                        <p>
                          定位只会在你点击后触发。识别结果可以确认，也可以手动修改。
                        </p>
                      </div>
                      <button
                        type="button"
                        className="location-button"
                        onClick={() => void locateCurrentPosition()}
                        disabled={locationState === "locating"}
                      >
                        {locationState === "locating"
                          ? "正在定位…"
                          : "定位我的当前位置"}
                      </button>
                      {destinationForm.locatedPlace && (
                        <div className="location-confirmation">
                          <span>定位结果</span>
                          <strong>{destinationForm.locatedPlace}</strong>
                          <small>是否以此地作为出发地？可在下方修改。</small>
                        </div>
                      )}
                      <label className="destination-origin-field">
                        <span>确认或修改出发地</span>
                        <input
                          value={destinationForm.origin}
                          onChange={(event) =>
                            setDestinationForm((current) => ({
                              ...current,
                              origin: event.target.value,
                            }))
                          }
                          placeholder="例如：西安市"
                        />
                      </label>
                      <p className="location-attribution">
                        位置文字由{" "}
                        <a
                          href="https://www.openstreetmap.org/copyright"
                          target="_blank"
                          rel="noreferrer"
                        >
                          OpenStreetMap
                        </a>{" "}
                        Nominatim 提供；也可以完全不定位，直接填写。
                      </p>
                      <div className="destination-step-actions">
                        <button
                          type="button"
                          className="primary-button"
                          disabled={!destinationForm.origin.trim()}
                          onClick={() => setDestinationStep("scope")}
                        >
                          确认出发地，继续
                        </button>
                      </div>
                    </div>
                  )}

                  {destinationStep === "scope" && (
                    <div className="destination-step-card">
                      <div className="destination-step-heading">
                        <span>步骤 2</span>
                        <h3>希望去多远？</h3>
                        <p>范围会影响交通成本、时间和候选目的地数量。</p>
                      </div>
                      <div className="destination-scope-grid">
                        {(["市内游", "省内游", "省外游"] as DestinationScope[]).map(
                          (scope) => (
                            <button
                              key={scope}
                              type="button"
                              className={
                                destinationForm.scope === scope ? "selected" : ""
                              }
                              onClick={() =>
                                setDestinationForm((current) => ({
                                  ...current,
                                  scope,
                                  transportModes: [],
                                  maxTravelTime: "",
                                }))
                              }
                            >
                              <strong>{scope}</strong>
                              <span>
                                {scope === "市内游"
                                  ? "当天或短途，交通最轻"
                                  : scope === "省内游"
                                    ? "周末友好，兼顾距离与体验"
                                    : "选择更多，适合更完整假期"}
                              </span>
                            </button>
                          ),
                        )}
                      </div>
                      <div className="destination-step-actions split">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setDestinationStep("location")}
                        >
                          上一步
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          disabled={!destinationForm.scope}
                          onClick={() => setDestinationStep("interests")}
                        >
                          继续选择偏好
                        </button>
                      </div>
                    </div>
                  )}

                  {destinationStep === "interests" && (
                    <div className="destination-step-card">
                      <div className="destination-step-heading">
                        <span>步骤 3</span>
                        <h3>这次最想体验什么？（可多选）</h3>
                        <p>没有明确偏好也可以直接获取综合推荐。</p>
                      </div>
                      <div className="destination-interest-grid">
                        {DESTINATION_INTEREST_OPTIONS.map((interest) => (
                          <button
                            key={interest}
                            type="button"
                            className={
                              destinationForm.interests.includes(interest)
                                ? "selected"
                                : ""
                            }
                            aria-pressed={destinationForm.interests.includes(
                              interest,
                            )}
                            onClick={() => toggleDestinationInterest(interest)}
                          >
                            {interest}
                          </button>
                        ))}
                      </div>
                      <div className="destination-filter-group">
                        <div>
                          <strong>可接受的出行方式（可多选）</strong>
                          <small>只展示当前出行范围内可实行的方式；不选则综合判断。</small>
                        </div>
                        <div className="destination-choice-grid">
                          {getDestinationTransportOptions(destinationForm.scope).map(
                            (mode) => (
                              <button
                                key={mode}
                                type="button"
                                className={
                                  destinationForm.transportModes.includes(mode)
                                    ? "selected"
                                    : ""
                                }
                                aria-pressed={destinationForm.transportModes.includes(
                                  mode,
                                )}
                                onClick={() => toggleDestinationTransport(mode)}
                              >
                                {mode}
                              </button>
                            ),
                          )}
                        </div>
                      </div>
                      <label className="destination-travel-time-field">
                        <span>可接受的单程通行时长</span>
                        <select
                          value={destinationForm.maxTravelTime}
                          onChange={(event) =>
                            setDestinationForm((current) => ({
                              ...current,
                              maxTravelTime: event.target.value,
                            }))
                          }
                        >
                          <option value="">不限定</option>
                          {getDestinationTravelTimeOptions(destinationForm.scope).map(
                            (time) => (
                              <option key={time} value={time}>
                                {time}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <label className="destination-extra-field">
                        <span>还有其他想法</span>
                        <textarea
                          value={destinationForm.extra}
                          onChange={(event) =>
                            setDestinationForm((current) => ({
                              ...current,
                              extra: event.target.value,
                            }))
                          }
                          placeholder="例如：不想太累、带孩子、周末两天、希望人少……"
                          rows={3}
                        />
                      </label>
                      <div className="destination-step-actions split">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setDestinationStep("scope")}
                        >
                          上一步
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          disabled={destinationLoading}
                          onClick={() => void requestDestinationSuggestions()}
                        >
                          {destinationLoading
                            ? "模型正全力筛选…"
                            : "推荐 4 个目的地"}
                        </button>
                      </div>
                    </div>
                  )}

                  {destinationStep === "results" && (
                    <div className="destination-step-card">
                      <div className="destination-step-heading">
                        <span>步骤 4</span>
                        <h3>适合你的目的地建议</h3>
                        <p>选择一个目的地后，再继续补充日期、预算和住宿。</p>
                      </div>
                      <div className="destination-result-grid">
                        {destinationSuggestions.map((suggestion) => (
                          <article key={`${suggestion.destination}-${suggestion.region}`}>
                            <div>
                              <span>{suggestion.region}</span>
                              <small>
                                {[suggestion.recommendedTransport, suggestion.travelTimeEstimate]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </small>
                            </div>
                            <h4>{suggestion.destination}</h4>
                            <p>{suggestion.summary}</p>
                            <ul>
                              {suggestion.reasons.slice(0, 2).map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                            <div className="destination-result-tags">
                              {suggestion.tags.slice(0, 4).map((tag) => (
                                <span key={tag}>{tag}</span>
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={() => chooseDestination(suggestion)}
                            >
                              选择这里并继续补全
                            </button>
                          </article>
                        ))}
                      </div>
                      <div className="destination-step-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setDestinationStep("interests")}
                        >
                          调整偏好重新推荐
                        </button>
                      </div>
                    </div>
                  )}

                  {destinationError && (
                    <p className="destination-error" role="alert">
                      {destinationError}
                    </p>
                  )}
                  <p className="destination-model-note">
                    系统会综合出行范围、交通偏好和可接受通行时长筛选候选目的地。
                  </p>
                </section>
              )}

              {supplementOpen && (
                <section
                  className="prompt-helper-panel"
                  aria-label="行程规划小助手"
                >
                  <div className="prompt-helper-heading">
                    <div>
                      <span>结构化补全</span>
                      <strong>填写后直接生成完整行程；此时下方聊天发送已暂停</strong>
                    </div>
                    <button
                      type="button"
                      className="prompt-helper-close"
                      onClick={resetSupplement}
                      aria-label="关闭行程规划小助手"
                    >
                      ×
                    </button>
                  </div>

                  <div className="prompt-helper-original">
                    <span>原始需求</span>
                    <p>{supplementBaseQuery}</p>
                  </div>

                  <div className="prompt-helper-form-grid">
                    <label>
                      <span>出发地</span>
                      <input
                        value={supplementForm.origin}
                        onChange={(event) =>
                          updateSupplementField("origin", event.target.value)
                        }
                        placeholder="例如：西安市"
                      />
                    </label>

                    <label>
                      <span>目的地</span>
                      <input
                        value={supplementForm.destination}
                        onChange={(event) =>
                          updateSupplementField("destination", event.target.value)
                        }
                        placeholder="例如：榆林市"
                      />
                    </label>

                    <label>
                      <span>游玩几天</span>
                      <select
                        value={supplementForm.duration}
                        onChange={(event) =>
                          updateSupplementField("duration", event.target.value)
                        }
                      >
                        <option value="">留空</option>
                        <option value="不确定">不确定</option>
                        {Array.from({ length: 10 }, (_, index) => index + 1).map(
                          (days) => (
                            <option key={days} value={`${days} 天`}>
                              {days} 天
                            </option>
                          ),
                        )}
                        <option value="10 天以上">10 天以上</option>
                      </select>
                    </label>

                    <label>
                      <span>出发日期</span>
                      <input
                        type="date"
                        value={supplementForm.startDate}
                        onChange={(event) =>
                          updateSupplementField("startDate", event.target.value)
                        }
                        aria-label="选择出发日期"
                      />
                    </label>

                    <label>
                      <span>预算金额</span>
                      <div className="field-input-with-action">
                        <input
                          value={supplementForm.budget}
                          onChange={(event) =>
                            updateSupplementField("budget", event.target.value)
                          }
                          placeholder="例如 6000 元"
                          inputMode="decimal"
                        />
                        <button
                          type="button"
                          className={
                            supplementForm.budget === "不确定" ? "selected" : ""
                          }
                          onClick={() =>
                            updateSupplementField(
                              "budget",
                              supplementForm.budget === "不确定" ? "" : "不确定",
                            )
                          }
                        >
                          不确定
                        </button>
                      </div>
                    </label>

                    <label>
                      <span>预算计算口径</span>
                      <select
                        value={supplementForm.budgetScope}
                        onChange={(event) =>
                          updateSupplementField(
                            "budgetScope",
                            event.target.value,
                          )
                        }
                      >
                        <option value="">留空</option>
                        <option value="合计预算">合计预算</option>
                        <option value="单人预算">单人预算</option>
                        <option value="不确定">尚未确定</option>
                      </select>
                    </label>

                    <label>
                      <span>出行人数</span>
                      <select
                        value={supplementForm.travelers}
                        onChange={(event) =>
                          updateTravelerCount(event.target.value)
                        }
                      >
                        <option value="">留空</option>
                        <option value="不确定">不确定</option>
                        {Array.from({ length: 8 }, (_, index) => index + 1).map(
                          (count) => (
                            <option key={count} value={`${count} 人`}>
                              {count} 人
                            </option>
                          ),
                        )}
                        <option value="8 人以上">8 人以上</option>
                      </select>
                    </label>

                    <label>
                      <span>出发地到目的地的出行方式</span>
                      <select
                        value={supplementForm.transportMode}
                        onChange={(event) =>
                          updateSupplementField(
                            "transportMode",
                            event.target.value,
                          )
                        }
                      >
                        <option value="">由系统按距离、预算和可行性选择</option>
                        {(travelOptions.status === "ready"
                          ? travelOptions.options
                          : [])
                          .map((mode) => (
                            <option key={mode} value={mode}>
                              {mode}
                            </option>
                          ))}
                      </select>
                      <small className="prompt-helper-field-hint">
                        {travelOptions.note}
                      </small>
                    </label>

                    <fieldset className="prompt-helper-purpose">
                      <legend>
                        <span>这次旅行主要想获得什么？（可多选）</span>
                        <small>目的不同，景点组合、节奏和预算分配也会不同</small>
                      </legend>
                      <div className="purpose-option-grid">
                        {TRAVEL_PURPOSE_OPTIONS.map((purpose) => {
                          const selected =
                            supplementForm.travelPurposes.includes(
                              purpose.label,
                            );
                          return (
                            <button
                              key={purpose.label}
                              type="button"
                              className={selected ? "selected" : ""}
                              aria-pressed={selected}
                              onClick={() =>
                                toggleSupplementPurpose(purpose.label)
                              }
                            >
                              {purpose.label}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>

                    <label>
                      <span>住宿房间数</span>
                      <select
                        value={supplementForm.roomCount}
                        onChange={(event) =>
                          updateSupplementField("roomCount", event.target.value)
                        }
                      >
                        <option value="">留空</option>
                        <option value="不确定">不确定</option>
                        <option value="不需要住宿">不需要住宿</option>
                        {Array.from({ length: 5 }, (_, index) => index + 1).map(
                          (count) => (
                            <option key={count} value={`${count} 间`}>
                              {count} 间
                            </option>
                          ),
                        )}
                        <option value="5 间以上">5 间以上</option>
                      </select>
                    </label>

                    <label>
                      <span>房型偏好</span>
                      <select
                        value={supplementForm.bedType}
                        onChange={(event) =>
                          updateSupplementField("bedType", event.target.value)
                        }
                      >
                        <option value="">留空</option>
                        <option value="无偏好">无特别偏好 / 尚未确定</option>
                        <option value="不需要住宿">不需要住宿</option>
                        <option value="大床房">大床房</option>
                        <option value="双床房">双床房</option>
                        <option value="大床房或双床房均可">
                          大床房或双床房均可
                        </option>
                        {getSelectedTravelerCount(supplementForm.travelers) >=
                          3 && (
                          <>
                            <option value="三人房">三人房</option>
                            <option value="家庭房 / 亲子房">
                              家庭房 / 亲子房
                            </option>
                            <option value="相邻房 / 连通房">
                              相邻房 / 连通房
                            </option>
                            <option value="由系统按人数推荐房型组合">
                              由系统按人数推荐房型组合
                            </option>
                          </>
                        )}
                      </select>
                      <small className="prompt-helper-field-hint">
                        {getSelectedTravelerCount(supplementForm.travelers) >= 3
                          ? "已根据出行人数补充多人住宿选项；可让系统结合房间数推荐组合。"
                          : "3 人及以上时将自动补充三人房、亲子房和连通房等选项。"}
                      </small>
                    </label>

                    <label>
                      <span>行程节奏</span>
                      <select
                        value={supplementForm.pace}
                        onChange={(event) =>
                          updateSupplementField("pace", event.target.value)
                        }
                      >
                        <option value="">留空</option>
                        <option value="不确定">不确定</option>
                        <option value="轻松，少走路">轻松，少走路</option>
                        <option value="均衡">均衡</option>
                        <option value="紧凑，多去景点">紧凑，多去景点</option>
                      </select>
                    </label>

                    <label className="prompt-helper-extra">
                      <span>其他条件</span>
                      <textarea
                        value={supplementForm.extra}
                        onChange={(event) =>
                          updateSupplementField("extra", event.target.value)
                        }
                        placeholder="可以补充兴趣偏好、酒店档次或位置、老人儿童、无障碍需求、不想去的地方等……"
                        rows={4}
                      />
                    </label>
                  </div>

                  <div className="prompt-helper-actions">
                    <button
                      type="button"
                      className="helper-restart-button"
                      onClick={() => applySupplementedQuery(false)}
                    >
                      只填回聊天框
                    </button>
                    <button
                      type="button"
                      className="helper-apply-button"
                      onClick={() => applySupplementedQuery(true)}
                    >
                      生成完整行程（发送给 AI）
                    </button>
                  </div>

                  <p className="prompt-helper-note">
                    完整度检测与表单整理都在浏览器内完成，不调用模型、不消耗 Token。
                  </p>
                </section>
              )}

              {!supplementOpen && (
              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitQuery();
                }}
              >
                <label htmlFor="travel-query" className="sr-only">
                  输入旅游需求
                </label>
                <textarea
                  id="travel-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="描述你的旅行需求，例如时间、预算、同行人和偏好…"
                  rows={2}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submitQuery();
                    }
                  }}
                />
                <button
                  type="submit"
                  aria-label="发送需求"
                  disabled={isReplying || !query.trim()}
                >
                  {isReplying ? "生成中" : "发送"}
                  <span aria-hidden="true">↗</span>
                </button>
              </form>
              )}
              {!supplementOpen && <p className="composer-note">
                {apiMode === "live"
                  ? "回答由火山方舟模型生成；密钥只保存在服务器，不会发送到浏览器。"
                  : "演示使用合成用户记忆与缓存工具数据，不包含真实个人信息。"}
              </p>}
            </div>

            {developerView && (
              <aside className="developer-panel panel">
                <div className="panel-heading compact">
                  <div>
                    <p className="panel-kicker">开发者视图</p>
                    <h2>本轮路由决策</h2>
                  </div>
                  <button className="text-button" onClick={exportRouteLog}>
                    导出日志
                  </button>
                </div>

                <div className="decision-summary">
                  <div className="tier-icon" aria-hidden="true">
                    {decision.finalTier === "reasoning"
                      ? "强"
                      : decision.finalTier === "general"
                        ? "通"
                        : "轻"}
                  </div>
                  <div>
                    <span>路由计划</span>
                    <strong>
                      {decision.strategies
                        .map((item) => LABEL_TEXT.strategy[item])
                        .join(" + ")}
                    </strong>
                    <small>
                      {LABEL_TEXT.tier[decision.finalTier]} · {decision.modelName}
                    </small>
                  </div>
                  <div className="confidence">
                    <span>置信度</span>
                    <strong>{Math.round(decision.confidence * 100)}</strong>
                    <small>/ 100</small>
                  </div>
                </div>

                <p className="route-reason">{decision.reason}</p>

                <div className="section-label">
                  <span>请求理解</span>
                  <i />
                </div>
                <div className="label-grid">
                  <RouteLabel
                    label="用户阶段"
                    value={LABEL_TEXT.intentStage[decision.labels.intentStage]}
                    detail={decision.labelReasons.intentStage}
                  />
                  <RouteLabel
                    label="信息完整度"
                    value={LABEL_TEXT.level[decision.labels.informationCompleteness]}
                    tone={decision.labels.informationCompleteness}
                    detail={decision.labelReasons.informationCompleteness}
                  />
                  <RouteLabel
                    label="任务复杂度"
                    value={LABEL_TEXT.level[decision.labels.taskComplexity]}
                    tone={decision.labels.taskComplexity}
                    detail={decision.labelReasons.taskComplexity}
                  />
                  <RouteLabel
                    label="个性化"
                    value={
                      LABEL_TEXT.personalization[
                        decision.labels.personalizationNeed
                      ]
                    }
                    detail={decision.labelReasons.personalizationNeed}
                  />
                  <RouteLabel
                    label="实时信息"
                    value={LABEL_TEXT.realtime[decision.labels.realtimeNeed]}
                    detail={decision.labelReasons.realtimeNeed}
                  />
                  <RouteLabel
                    label="请求风险"
                    value={LABEL_TEXT.level[decision.labels.riskLevel]}
                    tone={decision.labels.riskLevel}
                    detail={decision.labelReasons.riskLevel}
                  />
                  <RouteLabel
                    label="业务价值"
                    value={LABEL_TEXT.level[decision.labels.businessValue]}
                    tone={decision.labels.businessValue}
                    detail={decision.labelReasons.businessValue}
                  />
                  <RouteLabel
                    label="硬约束"
                    value={`${decision.hardConstraints.length} 类`}
                    detail={decision.labelReasons.hardConstraints}
                  />
                </div>

                <div className="section-label">
                  <span>执行轨迹</span>
                  <i />
                </div>
                <ol className="trace-list">
                  {decision.trace.map((step, index) => (
                    <li key={`${step.label}-${index}`} className={step.state}>
                      <span className="trace-index">
                        {step.state === "warning" ? "!" : index + 1}
                      </span>
                      <div>
                        <strong>{step.label}</strong>
                        <p>{step.detail}</p>
                      </div>
                    </li>
                  ))}
                  {executionState === "waiting" && (
                    <li className="waiting">
                      <span className="trace-index">…</span>
                      <div>
                        <strong>等待模型</strong>
                        <p>请求已经发出，正在等待火山方舟返回。</p>
                      </div>
                    </li>
                  )}
                </ol>

                <div
                  className={`quality-callout ${
                    executionState === "succeeded" ? "success" : "warning"
                  }`}
                >
                  <div>
                    <span>
                      {executionState === "waiting"
                        ? "等待模型响应"
                        : executionState === "succeeded"
                          ? "模型已返回"
                          : executionState === "failed"
                            ? "模型未响应"
                            : executionState === "demo"
                              ? "本地演示结果"
                              : "尚未执行模型"}
                    </span>
                    <strong>
                      {executionState === "succeeded"
                        ? "答案质量待评测"
                        : executionState === "failed"
                          ? "本次未生成答案"
                          : "不展示预估质量分"}
                    </strong>
                  </div>
                  <p>
                    {executionState === "failed"
                      ? executionError
                      : executionState === "succeeded"
                        ? "模型成功返回不等于回答正确；需要通过评估集或人工反馈另行判断。"
                        : executionState === "waiting"
                          ? "当前只完成了路由，尚未收到模型答案。"
                          : executionState === "demo"
                            ? "当前内容不属于线上模型真实输出。"
                            : "发送问题后才会产生真实执行数据。"}
                  </p>
                </div>

                <div className="usage-strip">
                  <Usage
                    label="输入"
                    value={
                      actualUsage?.inputTokens == null
                        ? "—"
                        : `${actualUsage.inputTokens}`
                    }
                    unit="词元"
                  />
                  <Usage
                    label="输出"
                    value={
                      actualUsage?.outputTokens == null
                        ? "—"
                        : `${actualUsage.outputTokens}`
                    }
                    unit="词元"
                  />
                  <Usage
                    label="总成本"
                    value="—"
                    unit="未核算"
                  />
                  <Usage
                    label="总延迟"
                    value={
                      actualUsage?.latencyMs == null
                        ? "—"
                        : (actualUsage.latencyMs / 1000).toFixed(2)
                    }
                    unit="秒"
                  />
                </div>
              </aside>
            )}
          </section>

          <section className="feedback-bar">
            <div>
              <span>这次回答解决问题了吗？</span>
              <small>反馈会进入失败案例集，而不是只停留在满意度统计。</small>
            </div>
            <div className="feedback-actions">
              {(
                [
                  ["resolved", "✓ 已解决"],
                  ["unresolved", "× 未解决"],
                  ["missing", "遗漏约束"],
                  ["generic", "回答过泛"],
                  ["inaccurate", "信息不准"],
                  ["overkill", "无需这么复杂"],
                ] as Array<[Feedback, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={feedback === value ? "selected" : ""}
                  onClick={() => void submitFeedback(value)}
                  disabled={!latestRunId || feedbackSaveState === "saving"}
                >
                  {label}
                </button>
              ))}
            </div>
            <small className={`feedback-save-state ${feedbackSaveState}`}>
              {!latestRunId
                ? "发送一条新请求后即可反馈"
                : feedbackSaveState === "saving"
                  ? "正在保存反馈…"
                  : feedbackSaveState === "saved"
                    ? "反馈已写入本次运行记录"
                    : feedbackSaveState === "error"
                      ? "反馈保存失败，请重试"
                      : `运行编号：${latestRunId}`}
            </small>
          </section>
        </>
      )}

      {tab === "runs" && (
        <section className="workspace-section">
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">在线可观测中心</p>
              <h1>每次模型调用，都能回看。</h1>
              <p>
                保存请求、路由、模型、提示词版本、原始响应、答案、Token、耗时、状态和用户反馈。
                API 密钥不会进入记录。
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="secondary-button"
                onClick={() => void loadRuns()}
                disabled={runsLoading}
              >
                {runsLoading ? "正在刷新…" : "刷新记录"}
              </button>
              {selectedRun && (
                <button
                  className="primary-button"
                  onClick={() =>
                    downloadText(
                      `${selectedRun.id}.json`,
                      JSON.stringify(selectedRun, null, 2),
                      "application/json",
                    )
                  }
                >
                  导出当前记录
                </button>
              )}
            </div>
          </div>

          <div className="record-privacy-note">
            <span>存储边界</span>
            <p>
              数据库存储用户问题和模型输出，便于评测、问题定位和产品迭代；密钥始终只存在服务器环境变量中。
            </p>
            <strong>最近展示 30 条</strong>
          </div>

          <div className="metric-grid record-metrics">
            <MetricCard
              label="当前读取记录"
              value={`${runs.length}`}
              note="按创建时间倒序"
              tone="blue"
            />
            <MetricCard
              label="真实调用成功"
              value={`${successfulRunCount}`}
              note="模型正常返回答案"
              tone="mint"
            />
            <MetricCard
              label="调用失败"
              value={`${failedRunCount}`}
              note="保留错误与回退答案"
              tone="orange"
            />
            <MetricCard
              label="已有用户反馈"
              value={`${runs.filter((run) => Boolean(run.feedback)).length}`}
              note="可进入失败案例集"
              tone="violet"
            />
          </div>

          {runsError && <div className="records-error">{runsError}</div>}

          {!runsLoading && !runsError && runs.length === 0 ? (
            <div className="panel records-empty">
              <strong>还没有运行记录</strong>
              <p>回到“在线演示”发送一条请求，这里就会出现第一条可追溯日志。</p>
              <button className="primary-button" onClick={() => setTab("demo")}>
                去发送请求
              </button>
            </div>
          ) : (
            <div className="records-layout">
              <div className="panel records-list">
                <div className="panel-heading compact">
                  <div>
                    <p className="panel-kicker">调用时间线</p>
                    <h2>最近运行</h2>
                  </div>
                  <span className="sample-chip">{runs.length} 条</span>
                </div>
                <div className="record-items">
                  {runs.map((run) => (
                    <button
                      key={run.id}
                      className={selectedRun?.id === run.id ? "selected" : ""}
                      onClick={() => setSelectedRunId(run.id)}
                    >
                      <div>
                        <span className={`record-status ${run.status}`}>
                          {run.status === "succeeded"
                            ? "成功"
                            : run.status === "failed"
                              ? "失败"
                              : "演示"}
                        </span>
                        <time>{formatRunTime(run.createdAt)}</time>
                      </div>
                      <strong>{run.query}</strong>
                      <small>
                        {run.modelName} · {run.totalTokens ?? 0} Token ·{" "}
                        {run.latencyMs ?? 0} ms
                      </small>
                    </button>
                  ))}
                </div>
              </div>

              {selectedRun && (
                <article className="panel record-detail">
                  <div className="panel-heading compact">
                    <div>
                      <p className="panel-kicker">单次调用详情</p>
                      <h2>{selectedRun.id}</h2>
                    </div>
                    <span className={`record-status ${selectedRun.status}`}>
                      {selectedRun.status === "succeeded"
                        ? "成功"
                        : selectedRun.status === "failed"
                          ? "失败"
                          : "演示"}
                    </span>
                  </div>

                  <div className="record-facts">
                    <RecordFact label="创建时间" value={formatRunTime(selectedRun.createdAt)} />
                    <RecordFact label="模型" value={selectedRun.modelName} />
                    <RecordFact label="路由档位" value={LABEL_TEXT.tier[selectedRun.routeTier]} />
                    <RecordFact label="提示词版本" value={selectedRun.promptVersion} />
                    <RecordFact
                      label="Token"
                      value={`${selectedRun.inputTokens ?? 0} 输入 / ${selectedRun.outputTokens ?? 0} 输出`}
                    />
                    <RecordFact label="耗时" value={`${selectedRun.latencyMs ?? 0} ms`} />
                    <RecordFact
                      label="HTTP"
                      value={selectedRun.httpStatus ? `${selectedRun.httpStatus}` : "未产生"}
                    />
                    <RecordFact
                      label="用户反馈"
                      value={
                        selectedRun.feedback
                          ? FEEDBACK_TEXT[selectedRun.feedback]
                          : "尚未反馈"
                      }
                    />
                  </div>

                  <RecordText label="用户问题" value={selectedRun.query} />
                  <RecordText
                    label="模型答案"
                    value={selectedRun.answer || "本次没有生成答案。"}
                  />
                  {selectedRun.errorMessage && (
                    <RecordText label="错误信息" value={selectedRun.errorMessage} tone="error" />
                  )}

                  <details className="record-json">
                    <summary>查看路由判断</summary>
                    <pre>{prettyJson(selectedRun.routeDecisionJson)}</pre>
                  </details>
                  <details className="record-json">
                    <summary>查看发送给模型的内容</summary>
                    <pre>{prettyJson(selectedRun.requestPayloadJson)}</pre>
                  </details>
                  <details className="record-json">
                    <summary>查看模型原始响应 JSON</summary>
                    <pre>{prettyJson(selectedRun.rawResponseJson)}</pre>
                  </details>
                </article>
              )}
            </div>
          )}
        </section>
      )}

      {tab === "evaluation" && (
        <section className="workspace-section">
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">离线评估中心</p>
              <h1>同一批任务，比较三种策略。</h1>
              <p>
                100 条合成旅游评估集使用相同工具数据和成功标准；结果不预设动态路由一定获胜。
              </p>
            </div>
            <div className="heading-actions">
              <button className="secondary-button" onClick={exportExperiment}>
                导出 300 条原始结果
              </button>
              <button
                className="primary-button"
                onClick={runExperiment}
                disabled={experimentState === "running"}
              >
                {experimentState === "running" ? "正在运行…" : "重新运行实验"}
              </button>
            </div>
          </div>

          <div className="data-provenance">
            <span>数据口径</span>
            <p>
              100 条合成任务 × 3 个策略组 · 规则版本 {settings.version} ·
              人工标准为主，模型辅助评分为辅
            </p>
            <strong>
              {experimentState === "running" ? "计算中" : "最近一次：已完成"}
            </strong>
          </div>

          <div className="metric-grid">
            <MetricCard
              label="动态路由成功率"
              value="92%"
              note="全强模型为 95%"
              tone="mint"
            />
            <MetricCard
              label="单次成功任务成本"
              value="¥0.029"
              note="全强模型为 ¥0.052"
              tone="blue"
            />
            <MetricCard
              label="相对全强成本节省"
              value={`${costSaving}%`}
              note="以成功任务为分母"
              tone="orange"
            />
            <MetricCard
              label="升级后任务挽回率"
              value="81%"
              note="升级率 11%"
              tone="violet"
            />
          </div>

          <div className="evaluation-grid">
            <div className="panel comparison-panel">
              <div className="panel-heading">
                <div>
                  <p className="panel-kicker">核心对照</p>
                  <h2>质量、成本与延迟</h2>
                </div>
                <span className="sample-chip">每组 100 条</span>
              </div>
              <div className="experiment-table">
                <div className="experiment-header">
                  <span>策略组</span>
                  <span>任务成功率</span>
                  <span>单次成功成本</span>
                  <span>95 分位延迟</span>
                </div>
                {EXPERIMENT_SUMMARIES.map((item) => (
                  <div
                    className={`experiment-row ${
                      item.group === "dynamic" ? "highlight" : ""
                    }`}
                    key={item.group}
                  >
                    <div>
                      <strong>{item.label}</strong>
                      <small>
                        {item.group === "dynamic"
                          ? "按请求选择策略与档位"
                          : item.group === "all_small"
                            ? "固定低成本，不升级"
                            : "固定强推理模型"}
                      </small>
                    </div>
                    <BarValue
                      value={item.successRate * 100}
                      max={100}
                      label={formatPercent(item.successRate)}
                      tone={item.group}
                    />
                    <BarValue
                      value={item.costPerSuccess}
                      max={0.06}
                      label={formatCost(item.costPerSuccess)}
                      tone={item.group}
                    />
                    <BarValue
                      value={item.p95Latency}
                      max={7}
                      label={`${item.p95Latency.toFixed(1)} 秒`}
                      tone={item.group}
                    />
                  </div>
                ))}
              </div>
              <div className="finding-callout">
                <span>实验结论</span>
                <p>
                  动态路由用 3 个百分点的成功率差，换取相对全强模型约{" "}
                  {costSaving}% 的单次成功任务成本下降；主要失败集中在实时数据冲突和无效澄清。
                </p>
              </div>
            </div>

            <div className="panel asset-panel">
              <div className="panel-heading compact">
                <div>
                  <p className="panel-kicker">资产复用</p>
                <h2>原 AgentScope 智能体评测</h2>
                </div>
                <span className="asset-status">已保留</span>
              </div>
              <p className="asset-copy">
                原有的证据核验、痛点覆盖、合并/拆分、新发现与严重程度比较，不再是产品终点，而是模型和提示词
                回归评测资产。
              </p>
              <div className="asset-list">
                <div>
                  <span>证据与结构</span>
                  <strong>规则自动验收</strong>
                </div>
                <div>
                  <span>严重程度 1–5</span>
                  <strong>单独保留，不等同请求风险</strong>
                </div>
                <div>
                  <span>人工复核</span>
                  <strong>合并 / 拆分 / 新发现</strong>
                </div>
              </div>
              <p className="asset-note">
                请求风险决定路由安全门槛；痛点严重程度评价分析结果。两个指标分开计算，避免概念混用。
              </p>
            </div>
          </div>

          <div className="panel scenario-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">分层诊断</p>
                <h2>不同任务类型的路由表现</h2>
              </div>
              <span className="sample-chip">动态路由组</span>
            </div>
            <div className="scenario-table">
              <div className="scenario-header">
                <span>任务类型</span>
                <span>主要模型分布</span>
                <span>主要策略</span>
                <span>成功率</span>
                <span>主要问题</span>
              </div>
              {scenarioRows.map((row) => (
                <div className="scenario-row" key={row.type}>
                  <strong>{row.type}</strong>
                  <span>{row.tier}</span>
                  <span>{row.strategy}</span>
                  <span className="success-value">{row.success}</span>
                  <span>{row.issue}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel failure-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">失败不是脏数据</p>
                <h2>误路由与升级案例</h2>
              </div>
              <span className="sample-chip">可追溯到单条日志</span>
            </div>
            <div className="failure-grid">
              {failureCases.map((item) => (
                <article key={item.id}>
                  <div>
                    <span>{item.id}</span>
                    <strong>{item.status}</strong>
                  </div>
                  <h3>{item.label}</h3>
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === "rules" && (
        <section className="workspace-section">
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">路由控制台</p>
              <h1>模型不写死，门槛可解释。</h1>
              <p>
                调整模型映射、置信度与质量门槛。规则只用于当前演示版，可由离线评估结果持续校准。
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="secondary-button"
                onClick={() => setSettings(DEFAULT_SETTINGS)}
              >
                恢复默认
              </button>
              <button
                className="primary-button"
                onClick={() =>
                  setSettings((current) => ({
                    ...current,
                    version: `route-v1.${Number(current.version.split(".").at(-1) ?? 3) + 1}`,
                  }))
                }
              >
                保存为新版本
              </button>
            </div>
          </div>

          <div className={`api-config-banner ${apiMode}`}>
            <span>模型接口</span>
            <p>
              密钥从服务器环境变量读取，浏览器只访问 RouteSense 自己的接口；
              界面和导出日志都不会包含完整密钥。
            </p>
            <strong>
              {apiMode === "live"
                ? `火山方舟已连接 · 已配置 ${apiStatus?.configuredTiers?.length ?? 0}/3 档`
                : apiMode === "checking"
                  ? "正在检查配置"
                  : "尚未配置，使用演示数据"}
            </strong>
          </div>

          <div className="settings-grid">
            <div className="panel rules-panel">
              <div className="panel-heading">
                <div>
                  <p className="panel-kicker">模型映射</p>
                  <h2>三个逻辑档位</h2>
                </div>
                <span className="sample-chip">供应商可替换</span>
              </div>
              <p className="config-note">
                这里修改的是中文显示名；真正调用的模型标识由服务器中的
                ARK_MODEL_SMALL、ARK_MODEL_GENERAL 和 ARK_MODEL_REASONING 决定。
              </p>
              {(["small", "general", "reasoning"] as ModelTier[]).map(
                (tier) => (
                  <label className="model-config-row" key={tier}>
                    <span className="model-tier-label">
                      <span className={`model-tier-badge ${tier}`}>
                        {LABEL_TEXT.tier[tier]}
                      </span>
                      <small
                        className={
                          apiStatus?.tierStatus?.[tier]
                            ? "configured"
                            : "not-configured"
                        }
                      >
                        {apiStatus?.tierStatus?.[tier]
                          ? "已接入真实模型"
                          : "尚未独立配置"}
                      </small>
                    </span>
                    <input
                      value={settings.modelNames[tier]}
                      onChange={(event) =>
                        updateModelName(tier, event.target.value)
                      }
                      aria-label={`${LABEL_TEXT.tier[tier]}名称`}
                    />
                    <span className="price-field">
                      ¥
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={settings.prices[tier]}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            prices: {
                              ...current.prices,
                              [tier]: Number(event.target.value),
                            },
                          }))
                        }
                        aria-label={`${LABEL_TEXT.tier[tier]}单次估算成本`}
                      />
                      / 次
                    </span>
                  </label>
                ),
              )}
            </div>

            <div className="panel threshold-panel">
              <div className="panel-heading">
                <div>
                  <p className="panel-kicker">质量门槛</p>
                  <h2>升级与保守策略</h2>
                </div>
                <span className="sample-chip">
                  {formatRuleVersion(settings.version)}
                </span>
              </div>
              <RangeSetting
                label="最低路由置信度"
                value={settings.confidenceThreshold}
                onChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    confidenceThreshold: value,
                  }))
                }
                note="低于门槛时，改用通用模型复核或采取保守策略。"
              />
              <RangeSetting
                label="最低质量评分"
                value={settings.qualityThreshold}
                onChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    qualityThreshold: value,
                  }))
                }
                note="结构、硬约束或质量未达标时触发补充能力。"
              />
              <div className="number-setting">
                <div>
                  <strong>最大自动升级次数</strong>
                  <p>避免无限重试；超过次数后转人工或安全提示。</p>
                </div>
                <div className="stepper">
                  <button
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        maxUpgrades: Math.max(0, current.maxUpgrades - 1),
                      }))
                    }
                    aria-label="减少升级次数"
                  >
                    −
                  </button>
                  <span>{settings.maxUpgrades}</span>
                  <button
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        maxUpgrades: Math.min(2, current.maxUpgrades + 1),
                      }))
                    }
                    aria-label="增加升级次数"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="panel rulebook">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">首版规则字典</p>
                <h2>条件 → 策略 → 模型档位</h2>
              </div>
              <span className="sample-chip">6 条启用</span>
            </div>
            <div className="rule-grid">
              <RuleCard
                index="01"
                title="探索阶段 + 信息不足"
                action="澄清 2–3 个高信息增益问题"
                tier="小模型档"
              />
              <RuleCard
                index="02"
                title="明确要求参考过往"
                action="先检索长期记忆，再生成答案"
                tier="通用模型档"
              />
              <RuleCard
                index="03"
                title="天气 / 价格 / 政策"
                action="必须搜索或调用业务工具"
                tier="通用模型档"
              />
              <RuleCard
                index="04"
                title="多个硬约束 + 跨步骤"
                action="复杂规划并检查约束"
                tier="强推理模型档"
              />
              <RuleCard
                index="05"
                title="质量检查未通过"
                action="携带上下文与失败原因升级"
                tier="强推理模型档"
              />
              <RuleCard
                index="06"
                title="高风险或连续失败"
                action="提高安全门槛或转人工"
                tier="转人工"
              />
            </div>
          </div>
        </section>
      )}

      {tripSetupPrompt && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setTripSetupPrompt(null);
              setTripSetupInput("");
            }
          }}
        >
          <section
            className="conversation-dialog supplement-offer-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trip-setup-title"
          >
            <span className="dialog-eyebrow">发送前确认</span>
            <h2 id="trip-setup-title">
              {tripSetupPrompt.kind === "origin_only"
                ? `已识别从${tripSetupPrompt.origin}出发`
                : tripSetupPrompt.kind === "destination_only"
                  ? `已识别目的地：${tripSetupPrompt.destination}`
                  : tripSetupPrompt.kind === "single_place"
                    ? `“${tripSetupPrompt.place}”是出发地还是目的地？`
                    : "还没有明确目的地，要先帮你筛选吗？"}
            </h2>
            {tripSetupPrompt.kind === "origin_only" && (
              <>
                <p>你已经有心仪目的地了吗？也可以让我根据范围和偏好帮你筛选。</p>
                <label className="trip-setup-input">
                  <span>心仪目的地（可选）</span>
                  <input
                    value={tripSetupInput}
                    onChange={(event) => setTripSetupInput(event.target.value)}
                    placeholder="例如：榆林"
                  />
                </label>
              </>
            )}
            {tripSetupPrompt.kind === "destination_only" && (
              <>
                <p>请补充从哪里出发；如果暂未确定，也可以先进入行程规划小助手再补充。</p>
                <label className="trip-setup-input">
                  <span>出发地（可选）</span>
                  <input
                    value={tripSetupInput}
                    onChange={(event) => setTripSetupInput(event.target.value)}
                    placeholder="例如：西安市"
                  />
                </label>
              </>
            )}
            {tripSetupPrompt.kind === "single_place" && (
              <p>先确认这个地点在旅行计划中的角色，后续问题才会问得更准确。</p>
            )}
            {tripSetupPrompt.kind === "unknown_destination" && (
              <>
                <p>
                  我可以先确认出发地和出行范围，再根据自然风景、人文、美食等偏好推荐几个目的地。
                </p>
                <div className="missing-detail-chips" aria-label="筛选步骤">
                  <span>确认当前位置</span>
                  <span>市内 / 省内 / 省外</span>
                  <span>旅行兴趣</span>
                  <span>4 个目的地建议</span>
                </div>
              </>
            )}
            <small className="supplement-offer-note">
              此时尚未调用模型。定位需由你主动授权；目的地初筛才会使用轻量模型。
            </small>
            <div className="dialog-actions supplement-offer-actions">
              {tripSetupPrompt.kind === "origin_only" && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() =>
                    startDestinationDiscovery(
                      tripSetupPrompt.query,
                      tripSetupPrompt.origin ?? "",
                    )
                  }
                >
                  帮我筛选目的地
                </button>
              )}
              {tripSetupPrompt.kind === "unknown_destination" && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => startDestinationDiscovery(tripSetupPrompt.query)}
                >
                  启动旅游地点筛选
                </button>
              )}
              {tripSetupPrompt.kind === "single_place" ? (
                <>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() =>
                      setTripSetupPrompt((current) =>
                        current
                          ? { ...current, kind: "origin_only", origin: current.place }
                          : current,
                      )
                    }
                  >
                    这是出发地
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      setTripSetupPrompt((current) =>
                        current
                          ? {
                              ...current,
                              kind: "destination_only",
                              destination: current.place,
                            }
                          : current,
                      )
                    }
                  >
                    这是目的地
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={continueTripSetup}
                >
                  {tripSetupInput.trim()
                    ? "带着已填地点继续补全"
                    : "进入行程规划小助手"}
                </button>
              )}
              <button
                type="button"
                className="dialog-cancel"
                onClick={() => {
                  setTripSetupPrompt(null);
                  setTripSetupInput("");
                }}
              >
                返回修改
              </button>
            </div>
          </section>
        </div>
      )}

      {supplementPrompt && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSupplementPrompt(null);
            }
          }}
        >
          <section
            className="conversation-dialog supplement-offer-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="supplement-offer-title"
          >
            <span className="dialog-eyebrow">发送前检查</span>
            <h2 id="supplement-offer-title">要启动行程规划小助手吗？</h2>
            <p>
              这条需求还缺少部分行程信息。补充后通常能得到更具体的路线和预算安排。
            </p>
            <div className="missing-detail-chips" aria-label="待补充信息">
              {supplementPrompt.missingFields.map((field) => (
                <span key={field}>{CORE_FIELD_LABELS[field]}</span>
              ))}
            </div>
            <small className="supplement-offer-note">
              此时尚未调用模型。所有字段都可以留空或选择“不确定”。
            </small>
            <div className="dialog-actions supplement-offer-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => startSupplement(supplementPrompt.query)}
              >
                启动行程规划小助手
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={continueWithoutSupplement}
              >
                直接发送原需求
              </button>
              <button
                type="button"
                className="dialog-cancel"
                onClick={() => setSupplementPrompt(null)}
              >
                返回修改
              </button>
            </div>
          </section>
        </div>
      )}

      {conversationDialog && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setConversationDialog(null);
            }
          }}
        >
          <section
            className="conversation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="conversation-dialog-title"
          >
            <span className="dialog-eyebrow">清空当前对话</span>
            <h2 id="conversation-dialog-title">确认清空聊天内容？</h2>
            <p>
              当前页面中的对话和未发送内容会被清除；已保存的模型运行记录不会删除。
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setConversationDialog(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button danger"
                onClick={() => {
                  resetConversation();
                  setConversationDialog(null);
                }}
              >
                确认清空
              </button>
            </div>
          </section>
        </div>
      )}

      <footer>
        <span>RouteSense · 面试作品演示版</span>
        <p>目标是降低单次成功任务成本，不把“节省词元”当作唯一价值。</p>
        <span>演示数据 · 非生产系统</span>
      </footer>
    </main>
  );
}

function RouteLabel({
  label,
  value,
  tone = "neutral",
  detail,
}: {
  label: string;
  value: string;
  tone?: string;
  detail?: string;
}) {
  return (
    <div className={`route-label ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small title={detail}>{detail}</small>}
    </div>
  );
}

function Usage({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{unit}</small>
    </div>
  );
}

function RecordFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RecordText({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "error";
}) {
  return (
    <div className={`record-text ${tone}`}>
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function BarValue({
  value,
  max,
  label,
  tone,
}: {
  value: number;
  max: number;
  label: string;
  tone: string;
}) {
  const width = Math.max(5, Math.min(100, (value / max) * 100));
  return (
    <div className="bar-value">
      <strong>{label}</strong>
      <span>
        <i className={tone} style={{ width: `${width}%` }} />
      </span>
    </div>
  );
}

function RangeSetting({
  label,
  value,
  onChange,
  note,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  note: string;
}) {
  return (
    <label className="range-setting">
      <div>
        <strong>{label}</strong>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min="0.5"
        max="0.95"
        step="0.01"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <p>{note}</p>
    </label>
  );
}

function RuleCard({
  index,
  title,
  action,
  tier,
}: {
  index: string;
  title: string;
  action: string;
  tier: string;
}) {
  return (
    <article>
      <div>
        <span>{index}</span>
        <i aria-hidden="true" />
      </div>
      <h3>{title}</h3>
      <p>{action}</p>
      <strong>{tier}</strong>
    </article>
  );
}
