import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

async function fetchRoute(path, init) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("api-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the RouteSense product instead of the starter", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /RouteSense/);
  assert.match(html, /价值感知 AI 模型路由系统/);
  assert.match(html, /只为您，生成/);
  assert.match(html, /更佳/);
  assert.match(html, /旅行计划/);
  assert.match(html, /用更合理的成本，智能选用更优模型/);
  assert.match(html, /准备好开启我们新一段旅程吗？/);
  assert.doesNotMatch(html, /更贴合需求/);
  assert.doesNotMatch(html, /刚好够用/);
  assert.doesNotMatch(html, /固定档位可用于观察质量/);
  assert.doesNotMatch(html, /北极星指标/);
  assert.match(html, /多约束决策/);
  assert.match(html, /开发者视图/);
  assert.match(html, /本轮路由决策/);
  assert.match(html, /输入旅游需求/);
  // 初始页没有明确的行程任务时，不应抢占输入区展示规划助手。
  assert.doesNotMatch(html, /行程规划小助手/);
  assert.doesNotMatch(html, /主动补全/);
  assert.match(html, /旅游路由实验室/);
  assert.match(html, /正在检查接口/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(
    html,
    /TRAVEL ROUTING LAB|OFFLINE EVALUATION CENTER|ROUTING CONTROL/,
  );
});

test("ships the routing, evaluation, fallback and export surfaces", async () => {
  const [
    source,
    router,
    layout,
    apiRoute,
    placeImageRoute,
    locationRoute,
    destinationRoute,
    envExample,
  ] = await Promise.all([
    readFile(new URL("../app/RouteSenseApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/routesense.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/place-image/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/location/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/destination-suggestions/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  for (const label of [
    "intentStage",
    "informationCompleteness",
    "taskComplexity",
    "personalizationNeed",
    "realtimeNeed",
    "riskLevel",
    "businessValue",
  ]) {
    assert.match(router, new RegExp(label));
  }
  assert.match(router, /labelReasons/);
  assert.match(router, /valueSignals/);

  assert.match(router, /missing_hard_constraint/);
  assert.match(router, /retrieve_memory/);
  assert.match(router, /for \(let index = 0; index < 100;/);
  assert.match(router, /全小模型/);
  assert.match(router, /动态路由/);
  assert.match(router, /全强模型/);
  assert.match(source, /导出 300 条原始结果/);
  assert.match(source, /严重程度 1–5/);
  assert.match(source, /不等同请求风险/);
  assert.match(source, /真实模型已连接/);
  assert.match(source, /演示模式/);
  assert.match(source, /模型选择/);
  assert.match(source, /自动路由：以合理成本匹配优质模型/);
  assert.match(source, /固定使用/);
  assert.match(source, /轻量偏好/);
  assert.match(source, /只发送精简的偏好与行程摘要，不发送完整聊天记录/);
  assert.match(source, /已规划地点/);
  assert.doesNotMatch(source, /availableHistory/);
  assert.match(source, /explicitlyReferencesConversation/);
  assert.match(source, /modelPreference/);
  assert.match(source, /清空对话/);
  assert.match(source, /检测到行程规划需求；信息不足时可由你决定是否补全/);
  assert.match(source, /looksLikeOriginDestinationRequest/);
  assert.match(source, /getTripSetupPrompt/);
  assert.match(source, /已识别从/);
  assert.match(source, /从哪里出发/);
  assert.match(source, /帮我筛选目的地/);
  assert.match(source, /定位我的当前位置/);
  assert.match(source, /推荐 4 个目的地/);
  assert.match(source, /模型正全力筛选/);
  assert.doesNotMatch(source, /轻量模型正在筛选/);
  assert.match(source, /城际出行方式/);
  assert.match(source, /可接受的单程通行时长/);
  assert.match(source, /getDestinationTransportOptions/);
  assert.match(source, /要启动行程规划小助手吗/);
  assert.match(source, /启动行程规划小助手/);
  assert.match(source, /直接发送原需求/);
  assert.match(source, /生成完整行程（发送给 AI）/);
  assert.match(source, /只填回聊天框/);
  assert.match(source, /其他条件/);
  assert.match(source, /type="date"/);
  assert.match(source, /选择出发日期/);
  assert.doesNotMatch(source, /选择返程日期/);
  assert.doesNotMatch(source, /endDate/);
  assert.match(source, /预算口径/);
  const budgetScopeField = source.slice(
    source.indexOf("<span>预算计算口径</span>"),
    source.indexOf("<span>出行人数</span>"),
  );
  assert.match(budgetScopeField, /option value="合计预算">合计预算/);
  assert.doesNotMatch(budgetScopeField, /全体出行人员合计预算/);
  assert.match(source, /单人预算/);
  assert.match(source, /住宿房间数/);
  assert.match(source, /房型偏好/);
  assert.match(source, /这次旅行主要想获得什么/);
  assert.match(source, /travelPurposes/);
  for (const purpose of [
    "自然风光",
    "历史人文",
    "美食体验",
    "购物消费",
    "休闲度假",
    "亲子陪伴",
    "摄影打卡",
    "夜间体验",
  ]) {
    assert.match(source, new RegExp(purpose));
  }
  assert.match(source, /大床房/);
  assert.match(source, /双床房/);
  assert.match(source, /大床房或双床房均可/);
  assert.match(source, /三人房/);
  assert.match(source, /家庭房 \/ 亲子房/);
  assert.match(source, /相邻房 \/ 连通房/);
  assert.match(source, /由系统按人数推荐房型组合/);
  assert.doesNotMatch(source, /大床房和双床房都需要/);
  assert.match(source, /行程路线脉络/);
  assert.match(source, /图片来源与授权信息/);
  assert.match(source, /getPlaceCategoryIcon/);
  assert.match(source, /place-category-icon/);
  assert.match(source, /在高德查看/);
  assert.match(source, /itinerary-day-tabs/);
  assert.match(source, /const \[activeDay, setActiveDay\] = useState\(0\)/);
  assert.match(source, /normalizeItineraryLine/);
  assert.match(source, /查看其他日程/);
  assert.match(source, /itinerary-overview-list/);
  assert.match(source, /itinerary-day-heading/);
  assert.match(source, /itinerary-route-step/);
  assert.match(source, /itinerary-place-transition/);
  assert.match(source, /renderItineraryTimeline/);
  assert.match(source, /routeTitle/);
  assert.match(source, /所有字段都可以留空或选择“不确定”/);
  assert.match(source, /完整度检测与表单整理都在浏览器内完成，不调用模型、不消耗 Token/);
  assert.match(source, /detectSupplementDetails/);
  assert.match(source, /getMissingCoreFields/);
  assert.match(source, /planningAssistantQuery/);
  assert.match(source, /shouldShowPlanningAssistant/);
  assert.match(source, /模型未响应，本次未生成答案/);
  assert.match(source, /答案质量待评测/);
  assert.match(source, /模型成功返回不等于回答正确/);
  assert.doesNotMatch(source, /已返回本地演示结果/);
  assert.doesNotMatch(source, /接口异常，已回退/);
  assert.doesNotMatch(source, /onClick=\{\(\) => submitQuery\(preset\.query\)\}/);
  const supplementFlow = source.slice(
    source.indexOf("function startSupplement"),
    source.indexOf("function updateSupplementField"),
  );
  assert.doesNotMatch(supplementFlow, /fetch\(/);
  const submitGate = source.slice(
    source.indexOf("async function submitQuery"),
    source.indexOf("const nextDecision", source.indexOf("async function submitQuery")),
  );
  assert.match(submitGate, /setSupplementPrompt/);
  assert.match(submitGate, /skipCompletenessCheck/);
  assert.doesNotMatch(submitGate, /fetch\(/);
  assert.match(source, /skipCompletenessCheck: true/);
  assert.doesNotMatch(source, /unit="tokens"/);
  assert.doesNotMatch(
    source,
    /TRAVEL ROUTING LAB|OFFLINE EVALUATION CENTER|ROUTING CONTROL/,
  );
  assert.match(apiRoute, /process\.env\.ARK_API_KEY/);
  assert.match(apiRoute, /type: "replace"/);
  assert.match(apiRoute, /Authorization: `Bearer \$\{apiKey\}`/);
  assert.match(apiRoute, /ARK_MODEL_SMALL/);
  assert.match(apiRoute, /ARK_MODEL_GENERAL/);
  assert.match(apiRoute, /ARK_MODEL_REASONING/);
  assert.match(apiRoute, /getDedicatedModelForTier/);
  assert.match(apiRoute, /tierStatus/);
  assert.match(apiRoute, /STREAM_IDLE_TIMEOUT_MS = 45_000/);
  assert.match(apiRoute, /max_tokens: MAX_OUTPUT_TOKENS/);
  assert.match(apiRoute, /MAX_OUTPUT_TOKENS = 1800/);
  assert.match(apiRoute, /process\.env\.AMAP_MAPS_API_KEY/);
  assert.match(apiRoute, /api\.open-meteo\.com\/v1\/forecast/);
  assert.match(apiRoute, /Open-Meteo（免密钥）/);
  assert.match(apiRoute, /未配置实时票务数据源/);
  assert.match(apiRoute, /未配置景点运营数据源/);
  assert.match(apiRoute, /这是对比任务：先直接给出结论和一张 Markdown 对比表/);
  assert.match(apiRoute, /restapi\.amap\.com\/v5\/direction\/transit\/integrated/);
  assert.match(apiRoute, /uri\.amap\.com\/navigation/);
  assert.doesNotMatch(apiRoute, /导航入口（出发时可选）/);
  assert.match(apiRoute, /模型规划估算（未接入地图服务）/);
  assert.match(apiRoute, /建议交通方式/);
  assert.match(apiRoute, /formatCurrency/);
  assert.match(apiRoute, /normalizeDurationText/);
  assert.doesNotMatch(apiRoute, /预计约 ¥2–30/);
  assert.doesNotMatch(apiRoute, /线路、耗时与费用请在地图中确认/);
  assert.match(apiRoute, /\[\[ROUTE\|/);
  assert.match(apiRoute, /\[\[PLACE\|/);
  assert.match(apiRoute, /ensureRouteMarkersBetweenPlaces/);
  assert.match(apiRoute, /服务端同样拒绝转发完整会话/);
  assert.match(apiRoute, /TRAFFIC_TOTAL/);
  assert.match(apiRoute, /runAmapRequest/);
  assert.match(apiRoute, /QPS_HAS_EXCEEDED_THE_LIMIT/);
  assert.match(apiRoute, /callnative: "0"/);
  assert.match(apiRoute, /departure_stop/);
  assert.match(apiRoute, /arrival_stop/);
  assert.match(apiRoute, /stream: true/);
  assert.match(apiRoute, /application\/x-ndjson/);
  assert.match(source, /consumeChatStream/);
  assert.match(source, /failed to fetch\|networkerror\|load failed/i);
  assert.match(apiRoute, /modelRequest\.thinking = \{ type: "disabled" \}/);
  assert.match(apiRoute, /answer: null/);
  assert.doesNotMatch(apiRoute, /fallbackAnswer/);
  assert.doesNotMatch(envExample, /ARK_API_KEY=\S+/);
  assert.doesNotMatch(envExample, /AMAP_MAPS_API_KEY=\S+/);
  assert.match(placeImageRoute, /zh\.wikipedia\.org\/w\/api\.php/);
  assert.match(placeImageRoute, /prop: "pageimages"/);
  assert.match(placeImageRoute, /pilicense: "free"/);
  assert.match(placeImageRoute, /commons\.wikimedia\.org\/wiki\/File/);
  assert.match(placeImageRoute, /restapi\.amap\.com\/v3\/place\/text/);
  assert.match(placeImageRoute, /高德地点图片/);
  assert.match(locationRoute, /nominatim\.openstreetmap\.org\/reverse/);
  assert.match(locationRoute, /OpenStreetMap contributors/);
  assert.match(destinationRoute, /ARK_MODEL_SMALL/);
  assert.match(destinationRoute, /thinking: \{ type: "disabled" \}/);
  assert.match(destinationRoute, /给出 4 个差异明显的候选项/);
  assert.match(destinationRoute, /for \(let attempt = 1; attempt <= 2/);
  assert.match(destinationRoute, /目的地推荐暂时未返回有效结果/);
  assert.match(layout, /og\.png/);
  await access(new URL("../public/og.png", import.meta.url));
  const previewFiles = await readdir(
    new URL("../app/_sites-preview", import.meta.url),
  );
  assert.deepEqual(previewFiles, []);
});

test("uses the safe server API and falls back to demo mode without a key", async () => {
  const statusResponse = await fetchRoute("/api/chat");
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.mode, "demo");
  assert.equal(status.provider, "火山方舟");
  assert.equal(status.mapMode, "estimate");
  assert.deepEqual(status.configuredTiers, []);
  assert.deepEqual(status.tierStatus, {
    small: false,
    general: false,
    reasoning: false,
  });

  const chatResponse = await fetchRoute("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "我不知道应该去哪里玩。",
      history: [],
    }),
  });
  assert.equal(chatResponse.status, 200);
  const chat = await chatResponse.json();
  assert.equal(chat.mode, "demo");
  assert.match(chat.answer, /告诉我这 3 点/);
  assert.ok(chat.usage.inputTokens > 0);
  assert.ok(chat.usage.outputTokens > 0);
});

test("returns a sourced scenic image without inventing a fallback photo", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url));
    assert.equal(requestUrl.hostname, "zh.wikipedia.org");
    return Response.json({
      query: {
        pages: {
          "123": {
            pageid: 123,
            title: "故宫博物院",
            pageimage: "Forbidden City Beijing.jpg",
            thumbnail: {
              source:
                "https://upload.wikimedia.org/wikipedia/commons/thumb/test/960px-test.jpg",
              width: 960,
              height: 640,
            },
          },
        },
      },
    });
  };

  try {
    const response = await fetchRoute(
      "/api/place-image?name=%E6%95%85%E5%AE%AB%E5%8D%9A%E7%89%A9%E9%99%A2&city=%E5%8C%97%E4%BA%AC",
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.imageUrl, /\/api\/place-image\?.*format=image/);
    assert.match(body.sourceUrl, /commons\.wikimedia\.org\/wiki\/File:/);
    assert.equal(body.provider, "维基百科 / 维基共享资源");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolves an explicitly requested browser location through Nominatim", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url));
    assert.equal(requestUrl.hostname, "nominatim.openstreetmap.org");
    assert.equal(requestUrl.pathname, "/reverse");
    return Response.json({
      display_name: "雁塔区，西安市，陕西省，中国",
      address: { city: "西安市", state: "陕西省", district: "雁塔区" },
    });
  };

  try {
    const response = await fetchRoute("/api/location?lat=34.22&lon=108.95");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.city, "西安市");
    assert.equal(body.province, "陕西省");
    assert.match(body.attribution, /OpenStreetMap/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses the small model for destination discovery", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    ARK_API_KEY: process.env.ARK_API_KEY,
    ARK_MODEL: process.env.ARK_MODEL,
    ARK_MODEL_SMALL: process.env.ARK_MODEL_SMALL,
    ARK_BASE_URL: process.env.ARK_BASE_URL,
  };
  let capturedBody;
  let destinationCallCount = 0;
  process.env.ARK_API_KEY = "test-key";
  process.env.ARK_MODEL_SMALL = "small-test-model";
  process.env.ARK_BASE_URL = "https://ark.example/api/v3/responses";
  globalThis.fetch = async (url, init) => {
    const requestUrl = new URL(String(url));
    assert.equal(requestUrl.hostname, "ark.example");
    capturedBody = JSON.parse(String(init.body));
    destinationCallCount += 1;
    if (destinationCallCount === 1) {
      return Response.json({
        choices: [{ message: { content: '{"suggestions" [{"destination":"华山"}]}' } }],
      });
    }
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              suggestions: [
                {
                  destination: "华山",
                  region: "陕西省渭南市",
                  summary: "适合登山徒步。",
                  reasons: ["交通距离适中", "山景突出"],
                  tags: ["登山", "自然"],
                  travelTimeEstimate: "约 2 小时（估算）",
                  recommendedTransport: "高铁",
                },
                {
                  destination: "太白山",
                  region: "陕西省宝鸡市",
                  summary: "适合森林和高山体验。",
                  reasons: ["自然景观丰富", "适合周末"],
                  tags: ["森林", "徒步"],
                  travelTimeEstimate: "约 3 小时（估算）",
                  recommendedTransport: "自驾",
                },
              ],
            }),
          },
        },
      ],
    });
  };

  try {
    const response = await fetchRoute("/api/destination-suggestions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        origin: "西安市",
        scope: "省内游",
        interests: ["登山徒步"],
        transportModes: ["高铁", "自驾", "飞机"],
        maxTravelTime: "4 小时内",
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.modelTier, "small");
    assert.equal(body.attempts, 2);
    assert.equal(body.suggestions.length, 2);
    assert.equal(destinationCallCount, 2);
    assert.equal(capturedBody.model, "small-test-model");
    assert.match(capturedBody.messages[1].content, /高铁、自驾/);
    assert.doesNotMatch(capturedBody.messages[1].content, /飞机/);
    assert.match(capturedBody.messages[1].content, /4 小时内/);
    assert.deepEqual(capturedBody.thinking, { type: "disabled" });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("streams live model output so the browser connection stays active", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("stream-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    ARK_API_KEY: process.env.ARK_API_KEY,
    ARK_MODEL: process.env.ARK_MODEL,
    ARK_BASE_URL: process.env.ARK_BASE_URL,
  };
  let capturedUrl = "";
  let capturedBody;

  process.env.ARK_API_KEY = "test-key";
  process.env.ARK_MODEL = "test-model";
  process.env.ARK_BASE_URL = "https://ark.example/api/v3/responses";

  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String(init?.body || "{}"));
    const chunks = [
      'data: {"choices":[{"delta":{"content":"深圳"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":"五日行程"},"finish_reason":"stop"}],"usage":{"prompt_tokens":20,"completion_tokens":8,"total_tokens":28}}\n\n',
      "data: [DONE]\n\n",
    ];
    return new Response(chunks.join(""), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };

  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "帮我安排深圳五日游", history: [] }),
      }),
      {
        ARK_API_KEY: "test-key",
        ARK_MODEL: "test-model",
        ARK_BASE_URL: "https://ark.example/api/v3/responses",
        ASSETS: {
          fetch: async () => new Response("Not found", { status: 404 }),
        },
      },
      {
        waitUntil() {},
        passThroughOnException() {},
      },
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /x-ndjson/);
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(events[0].type, "start");
    assert.deepEqual(
      events.filter((event) => event.type === "replace").map((event) => event.text),
      ["深圳五日行程"],
    );
    assert.equal(events.at(-1).type, "done");
    assert.equal(events.at(-1).answer, "深圳五日行程");
    assert.equal(events.at(-1).usage.totalTokens, 28);
    assert.match(capturedUrl, /\/chat\/completions$/);
    assert.equal(capturedBody.stream, true);
    assert.deepEqual(capturedBody.thinking, { type: "disabled" });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("replaces route markers with verified Amap transit facts", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("amap-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    ARK_API_KEY: process.env.ARK_API_KEY,
    ARK_MODEL: process.env.ARK_MODEL,
    ARK_BASE_URL: process.env.ARK_BASE_URL,
    AMAP_MAPS_API_KEY: process.env.AMAP_MAPS_API_KEY,
  };

  process.env.ARK_API_KEY = "test-key";
  process.env.ARK_MODEL = "test-model";
  process.env.ARK_BASE_URL = "https://ark.example/api/v3/responses";
  process.env.AMAP_MAPS_API_KEY = "amap-test-key";

  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.hostname === "ark.example") {
      const answer = [
        "第1天 2026-09-01｜深圳滨海游",
        "[[PLACE|09:00|深圳湾公园|自然公园|2小时|0元|滨海散步|深圳]]",
        "[[PLACE|11:00|欢乐海岸|休闲街区|2小时|约¥100|用餐与休闲|深圳]]",
        "每日活动小计：游玩 4 小时｜门票餐饮约 ¥200",
      ].join("\n");
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 40, total_tokens: 70 } })}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }
    if (requestUrl.pathname === "/v3/geocode/geo") {
      const isShenzhenBay = requestUrl.searchParams
        .get("address")
        ?.includes("深圳湾");
      return Response.json({
        status: "1",
        geocodes: [
          {
            location: isShenzhenBay ? "113.951,22.526" : "113.986,22.533",
            citycode: "0755",
          },
        ],
      });
    }
    if (requestUrl.pathname === "/v5/direction/transit/integrated") {
      return Response.json({
        status: "1",
        route: {
          transits: [
            {
              distance: "11800",
              cost: { duration: "5400", transit_fee: "3.000000" },
              segments: [
                {
                  walking: { distance: "1100" },
                  bus: {
                    buslines: [{ name: "地铁9号线(前湾方向)" }],
                  },
                },
              ],
            },
          ],
        },
      });
    }
    throw new Error(`Unexpected URL: ${requestUrl}`);
  };

  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "请规划2026年9月1日深圳市内一日游",
          history: [],
        }),
      }),
      {
        ARK_API_KEY: "test-key",
        ARK_MODEL: "test-model",
        ARK_BASE_URL: "https://ark.example/api/v3/responses",
        AMAP_MAPS_API_KEY: "amap-test-key",
        ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      },
      { waitUntil() {}, passThroughOnException() {} },
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const done = events.at(-1);
    assert.equal(done.type, "done");
    assert.match(done.answer, /地铁9号线/);
    assert.match(done.answer, /约 1 小时 30 分钟/);
    assert.match(done.answer, /步行 1\.1 公里/);
    assert.match(done.answer, /约 ¥3/);
    assert.doesNotMatch(done.answer, /3\.000000/);
    assert.match(done.answer, /\[\[TRAFFIC_TOTAL\|2026-09-01/);
    assert.match(done.answer, /uri\.amap\.com\/navigation/);
    assert.doesNotMatch(done.answer, /\[\[ROUTE\|/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("does not treat an intercity trip as a local Amap transit route", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("intercity-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    ARK_API_KEY: process.env.ARK_API_KEY,
    ARK_MODEL: process.env.ARK_MODEL,
    ARK_BASE_URL: process.env.ARK_BASE_URL,
    AMAP_MAPS_API_KEY: process.env.AMAP_MAPS_API_KEY,
  };
  process.env.ARK_API_KEY = "test-key";
  process.env.ARK_MODEL = "test-model";
  process.env.ARK_BASE_URL = "https://ark.example/api/v3/responses";
  process.env.AMAP_MAPS_API_KEY = "amap-test-key";

  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url));
    assert.equal(requestUrl.hostname, "ark.example");
    const answer = [
      "第1天 2026-09-01｜西安前往深圳",
      "[[ROUTE|西安|深圳|西安市|深圳市|2026-09-01|08:00|公共交通|1502分钟|¥244.000000|2.1公里]]",
    ].join("\n");
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  };

  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "规划西安到深圳的行程" }),
      }),
      {
        ARK_API_KEY: "test-key",
        ARK_MODEL: "test-model",
        ARK_BASE_URL: "https://ark.example/api/v3/responses",
        AMAP_MAPS_API_KEY: "amap-test-key",
        ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      },
      { waitUntil() {}, passThroughOnException() {} },
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const done = events.at(-1);
    assert.match(done.answer, /建议 高铁/);
    assert.match(done.answer, /耗时按所选班次/);
    assert.match(done.answer, /费用按所选班次/);
    assert.doesNotMatch(done.answer, /1502|244\.000000|高德路线已核验/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
