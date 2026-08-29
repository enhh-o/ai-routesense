# RouteSense Evaluation V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real, resumable four-strategy evaluation workflow for RouteSense V2, then present only traceable evidence in the evaluation and routing pages.

**Architecture:** Keep the 63 task definitions in versioned JSON files, separate evaluation runs from daily user runs in D1, and expose small resumable server-side batches rather than a single long-running job. A shared model invocation module will let chat and evaluation use the same model mapping and prompt framework; a blind judge record plus required human review provides answer-quality evidence.

**Tech Stack:** Next.js/Vinext, React 19, TypeScript, Cloudflare Workers/D1, Drizzle ORM, Node test runner, pnpm, Volcano Ark REST API through `fetch`.

**Spec:**
- `docs/superpowers/specs/2026-08-30-evidence-based-evaluation-design.md`
- `docs/superpowers/specs/2026-08-30-evaluation-v2-blueprint.md`

## Global Constraints

- V2 has exactly 7 ability categories, 21 development tasks, and 42 independent formal tasks.
- Formal comparison uses `all_small`, `all_general`, `all_reasoning`, and `dynamic`; every formal task has three trials, for 504 model invocations.
- Dynamic routing is allowed at most two incremental upgrades: Mini → Lite → Pro; every attempt retains the previous context and failure reason.
- Never include API keys in browser code, JSON exports, task records, or displayed logs.
- Evaluation tasks are synthetic and contain no real-user conversation data; daily `model_runs` and `evaluation_runs` remain separate.
- No hard-coded success, cost, latency, failure-case, or comparison figures may remain on the evaluation page.
- A formal task is never used to tune the same frozen rule/prompt/model version.
- Do not start a paid batch without an explicit user confirmation and a displayed maximum run count / cost guard.
- Use additive D1 changes only; do not drop or overwrite historical user-run data.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `evaluation/v2/routesense_eval_v2.json` | 63 versioned task cards, category metadata, split, route expectations, response assertions, and review flags. |
| `evaluation/v2/validate_dataset_v2.mjs` | Validates cardinality, split isolation, required task-card fields, assertion structure, and category coverage. |
| `evaluation/v2/task_catalog.md` | Human-readable task inventory used for product review before any model call. |
| `lib/evaluation-types.ts` | Shared TypeScript types for task cards, variants, attempts, scoring, summaries, and evidence. |
| `lib/evaluation-score.ts` | Pure deterministic checks, cost calculation, summary aggregation, and evidence grouping. |
| `lib/ark-client.ts` | Server-only Ark model lookup and non-streaming completion helper shared by chat and evaluation. |
| `lib/travel-prompt.ts` | Shared non-secret travel system-prompt builder used by both chat and evaluation. |
| `lib/evaluation-runner.ts` | Executes exactly one resumable evaluation trial, including incremental dynamic escalation and persistence inputs. |
| `db/schema.ts` | Adds evaluation tables; keeps `model_runs` compatibility-safe. |
| `db/evaluation-records.ts` | D1 persistence/query layer for trials, reviews, summaries, and rule evidence. |
| `drizzle/0001_evaluation_runs.sql` | Additive migration for evaluation tables only. |
| `app/api/evaluations/route.ts` | GET summary/list/detail and POST one bounded trial or a user-confirmed bounded batch. |
| `app/api/evaluations/review/route.ts` | Saves an explicit human review without exposing secrets. |
| `app/api/runs/route.ts` and `db/run-records.ts` | Read daily records through an explicit column projection, so a missing optional timestamp cannot blank the whole list. |
| `app/RouteSenseApp.tsx` | Replaces synthetic evaluation UI with fetched evidence, progress, issue details, correction records, and rule evidence. |
| `app/globals.css` | Styles evidence status, empty states, detail dialog, review state, and accessible error messages. |
| `tests/evaluation-v2.test.mjs` | Tests dataset validation, cost calculation, aggregation, escalation limits, and task/split invariants. |
| `tests/rendered-html.test.mjs` | Removes old synthetic-copy assertions and checks the real-evidence empty state and new page copy. |

## Task 1: Publish the V2 task-card catalogue for product review

**Files:**
- Create: `evaluation/v2/task_catalog.md`
- Create: `evaluation/v2/routesense_eval_v2.json`
- Create: `evaluation/v2/splits.json`
- Test: `evaluation/v2/validate_dataset_v2.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `EvaluationTaskCard` records with `case_id`, `category`, `split`, `difficulty`, `user_query`, `context`, `expected_route`, `hard_constraints`, `critical_assertions`, `quality_assertions`, `prohibited_behaviors`, `failure_tags`, and `human_review_required`.
- Later tasks consume `routesense_eval_v2.json` and must not infer requirements from prose.

- [ ] **Step 1: Write a validator test that fails for invalid category totals and invalid splits**

Create `tests/evaluation-v2.test.mjs` with tests that invoke the validation script and assert these fixed values:

```js
assert.equal(report.version, "2.0.0");
assert.equal(report.caseCount, 63);
assert.deepEqual(report.categoryCounts, {
  clarification: 9,
  context_memory: 9,
  realtime_tools: 9,
  constrained_planning: 9,
  decision_confirmation: 9,
  recovery: 9,
  safety_security: 9,
});
assert.equal(report.developmentCaseCount, 21);
assert.equal(report.holdoutCaseCount, 42);
assert.equal(report.formalInvocationPlan, 504);
```

- [ ] **Step 2: Run the test and verify it fails because V2 does not exist yet**

Run: `pnpm.cmd exec node --test tests/evaluation-v2.test.mjs`  
Expected: FAIL because `evaluation/v2/validate_dataset_v2.mjs` and V2 data files do not exist.

- [ ] **Step 3: Create the task catalogue and the 63 task cards**

Use the following fixed task inventory. `D` denotes development; `H` denotes independent holdout. Each card must vary a meaningful factor rather than merely paraphrasing another card.

| Category | Development tasks | Independent formal tasks |
| --- | --- | --- |
| `clarification` | `C1-D01` vague destination discovery; `C1-D02` complete weekend request that must not be re-asked; `C1-D03` user changes one preference mid-conversation | `C1-H01` only a travel motive; `C1-H02` only origin/date; `C1-H03` complete one-day recommendation; `C1-H04` conflicting stated preferences; `C1-H05` missing budget but clear destination; `C1-H06` user declines one proposed clarification |
| `context_memory` | `C2-D01` compare two destinations from immediate history; `C2-D02` apply a stored food preference; `C2-D03` replace an outdated preference | `C2-H01` reuse an origin from history; `C2-H02` combine a saved accessibility preference with a new date; `C2-H03` reject an old preference; `C2-H04` distinguish another traveller's preference; `C2-H05` retain an earlier budget; `C2-H06` identify insufficient memory rather than fabricate it |
| `realtime_tools` | `C3-D01` next-week weather/opening check; `C3-D02` flight-and-hotel data request; `C3-D03` conflicting source times | `C3-H01` weather-dependent itinerary; `C3-H02` attraction opening-time lookup; `C3-H03` price requires a business source; `C3-H04` empty tool result; `C3-H05` two contradictory source records; `C3-H06` user explicitly says not to query price |
| `constrained_planning` | `C4-D01` domestic family trip with budget; `C4-D02` wheelchair-accessible three-day trip; `C4-D03` infeasible time-and-distance plan | `C4-H01` elderly traveller walking cap; `C4-H02` child-friendly rain alternative; `C4-H03` total rather than per-person budget; `C4-H04` cross-city travel time conflict; `C4-H05` dietary and hotel constraints; `C4-H06` international trip with time, budget, and policy dependency |
| `decision_confirmation` | `C5-D01` compare two destinations by stated preference; `C5-D02` recommend a transport mode from cost/time; `C5-D03` booking request requiring confirmation | `C5-H01` choose between scenic and food-led trips; `C5-H02` compare two hotels by accessibility; `C5-H03` choose air versus rail using time/budget; `C5-H04` group disagreement and explicit trade-off; `C5-H05` request to book without payment authorization; `C5-H06` user asks for an explanation of a prior recommendation |
| `recovery` | `C6-D01` first answer omitted a walking constraint; `C6-D02` business tool returns no result; `C6-D03` first plan fails a budget check | `C6-H01` Mini answer misses a date; `C6-H02` Lite answer misses a companion need; `C6-H03` first tool response is malformed; `C6-H04` source conflict after an initial recommendation; `C6-H05` upgrade still fails a hard constraint; `C6-H06` second upgrade is prohibited after Pro fails |
| `safety_security` | `C7-D01` acute high-altitude health concern; `C7-D02` passport loss overseas; `C7-D03` malicious instruction embedded in tool text | `C7-H01` medication/medical emergency boundary; `C7-H02` visa/policy uncertainty; `C7-H03` lost identity document; `C7-H04` payment/identity fraud warning; `C7-H05` injected tool text requesting secrets; `C7-H06` high-risk request that must hand off rather than plan |

For every task, write at least two `critical_assertions`, one `quality_assertion`, one `prohibited_behavior`, a concrete `expected_route`, and a specific `failure_tags` list. Mark every `safety_security` task and every `recovery` task involving a second escalation as `human_review_required: true`.

- [ ] **Step 4: Implement strict V2 validation**

`validate_dataset_v2.mjs` must reject a data set unless all of the following are true:

```js
const REQUIRED_CATEGORIES = [
  "clarification", "context_memory", "realtime_tools",
  "constrained_planning", "decision_confirmation", "recovery", "safety_security",
];
const REQUIRED_VARIANTS = ["all_small", "all_general", "all_reasoning", "dynamic"];
// Each category has exactly 3 development cards and 6 holdout cards.
// A case ID occurs exactly once and no hard-constraint list contains empty text.
// Every card has route expectations, success assertions, forbidden behavior, and review metadata.
```

The script must print JSON including `formalInvocationPlan: holdoutCount * 4 * 3`.

Add the package script exactly as follows:

```json
"eval:v2:validate": "node evaluation/v2/validate_dataset_v2.mjs"
```

- [ ] **Step 5: Run the validator and test**

Run: `pnpm.cmd exec node evaluation/v2/validate_dataset_v2.mjs`  
Expected: `caseCount: 63`, `developmentCaseCount: 21`, `holdoutCaseCount: 42`, `formalInvocationPlan: 504`, `status: "valid"`.

Run: `pnpm.cmd exec node --test tests/evaluation-v2.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit the reviewed task-card foundation**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add evaluation/v2 tests/evaluation-v2.test.mjs
& 'C:\Program Files\Git\cmd\git.exe' commit -m "add routesense evaluation v2 task cards"
```

**Reviewer gate:** Before any paid model call, show `evaluation/v2/task_catalog.md` to the product owner and obtain approval of the 63 task cards.

## Task 2: Add typed evaluation records and pure aggregation utilities

**Files:**
- Create: `lib/evaluation-types.ts`
- Create: `lib/evaluation-score.ts`
- Modify: `tests/evaluation-v2.test.mjs`

**Interfaces:**
- Produces `EvaluationVariant`, `EvaluationRun`, `EvaluationScore`, `EvaluationSummary`, `calculateModelCost`, `aggregateEvaluationRuns`, and `buildIssueEvidence`.
- Consumed by the runner, D1 record layer, API routes, and React UI.

- [ ] **Step 1: Write failing unit tests for token pricing, incomplete batches, and two-step escalation**

Add tests with these exact expectations for short-context prices:

```js
assert.equal(calculateModelCost("small", 2000, 1000), 0.0024);
assert.equal(calculateModelCost("general", 2000, 1000), 0.0048);
assert.equal(calculateModelCost("reasoning", 2000, 1000), 0.0224);
assert.equal(nextUpgradeTier("small"), "general");
assert.equal(nextUpgradeTier("general"), "reasoning");
assert.equal(nextUpgradeTier("reasoning"), null);
assert.equal(summary.isComplete, false);
assert.equal(summary.metrics.taskSuccessRate, null);
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm.cmd exec node --test tests/evaluation-v2.test.mjs`  
Expected: FAIL because the shared evaluation modules do not exist.

- [ ] **Step 3: Implement explicit types and deterministic calculations**

Implement an input-length price table. The output price is selected using the same input-length tier as the request:

```ts
export const MODEL_PRICE_PER_1K_TOKEN = {
  small: [
    { maxInputTokens: 32_000, input: 0.0002, output: 0.002 },
    { maxInputTokens: 128_000, input: 0.0004, output: 0.004 },
    { maxInputTokens: 256_000, input: 0.0008, output: 0.008 },
  ],
  general: [
    { maxInputTokens: 32_000, input: 0.0006, output: 0.0036 },
    { maxInputTokens: 128_000, input: 0.0009, output: 0.0054 },
    { maxInputTokens: 256_000, input: 0.0018, output: 0.0108 },
  ],
  reasoning: [
    { maxInputTokens: 32_000, input: 0.0032, output: 0.016 },
    { maxInputTokens: 128_000, input: 0.0048, output: 0.024 },
    { maxInputTokens: 256_000, input: 0.0096, output: 0.048 },
  ],
} as const;
```

`aggregateEvaluationRuns` must calculate a metric only when every expected `caseId + variant + trial` exists and has terminal status. Otherwise it returns `null` metric values, `isComplete: false`, missing run IDs, and completed count. `buildIssueEvidence` groups only persisted failure tags and review findings; it must not emit synthetic example cases.

- [ ] **Step 4: Run unit tests and type/build checks**

Run: `pnpm.cmd exec node --test tests/evaluation-v2.test.mjs`  
Expected: PASS.

Run: `pnpm.cmd run build`  
Expected: production build succeeds.

- [ ] **Step 5: Commit the pure evaluation domain layer**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add lib/evaluation-types.ts lib/evaluation-score.ts tests/evaluation-v2.test.mjs
& 'C:\Program Files\Git\cmd\git.exe' commit -m "add evaluation scoring domain"
```

## Task 3: Extract a server-only Ark invocation helper without changing chat behavior

**Files:**
- Create: `lib/ark-client.ts`
- Create: `lib/travel-prompt.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- `getArkModelForTier(tier, environment): string | null`
- `invokeArkCompletion({ model, systemPrompt, messages, maxTokens, thinkingMode, signal }): Promise<ArkCompletionResult>`
- `ArkCompletionResult` includes `answer`, `inputTokens`, `outputTokens`, `totalTokens`, `httpStatus`, `latencyMs`, and raw provider metadata.
- `buildTravelSystemPrompt({ decision, toolResult, preferenceTags, tripContextTags }): string` is imported by chat and the evaluation runner, so the strategy/framework text does not drift between variants.

- [ ] **Step 1: Add a failing fetch-mock test for non-streaming Ark execution**

Test that a mocked `chat/completions` JSON response becomes an `ArkCompletionResult`, and that a missing API key/model returns a typed configuration error without sending a network request.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm.cmd exec node --test tests/evaluation-v2.test.mjs`  
Expected: FAIL because `lib/ark-client.ts` does not export the helper.

- [ ] **Step 3: Implement the helper and refactor only shared lookup code out of chat**

Keep chat streaming behavior unchanged. Move the current non-secret `buildSystemPrompt` implementation into `lib/travel-prompt.ts`; `app/api/chat/route.ts` continues to emit NDJSON and imports the shared prompt/model helpers. The evaluation helper uses `stream: false`, the same Ark base URL normalization, `Authorization: Bearer`, 45-second abort behavior, `max_tokens`, and explicit retry only for 429/5xx.

Never log an authorization header, environment object, or API key in errors or evaluation records.

- [ ] **Step 4: Run chat regression tests and helper tests**

Run: `pnpm.cmd exec node --test tests/evaluation-v2.test.mjs`  
Expected: PASS.

Run: `pnpm.cmd test`  
Expected: existing routing, transport, rendered-page, and chat fallback tests pass.

- [ ] **Step 5: Commit the shared server-only client**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add lib/ark-client.ts app/api/chat/route.ts tests
& 'C:\Program Files\Git\cmd\git.exe' commit -m "share ark model invocation utilities"
```

## Task 4: Add additive D1 evaluation storage and daily-record compatibility

**Files:**
- Modify: `db/schema.ts`
- Create: `db/evaluation-records.ts`
- Create: `drizzle/0001_evaluation_runs.sql`
- Modify: `db/run-records.ts`
- Modify: `app/api/runs/route.ts`
- Modify: `tests/evaluation-v2.test.mjs`

**Interfaces:**
- `evaluationRuns` has a unique `(datasetVersion, caseId, variant, trial)` identity.
- `createEvaluationRun`, `findEvaluationRun`, `listEvaluationRuns`, `saveEvaluationReview`, and `listEvaluationEvidence` are the only D1 access functions used by evaluation APIs.
- `listRecentRunRecords` returns an explicit safe projection; it no longer relies on `.select()` selecting every historical column.

- [ ] **Step 1: Write failing tests for idempotency and the daily-record read projection**

Test that starting the same `datasetVersion/caseId/variant/trial` twice returns the existing record instead of another paid call. Test that `listRecentRunRecords` selects named required columns and does not require `feedback_updated_at` to display a run list.

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm.cmd exec node --test tests/evaluation-v2.test.mjs`  
Expected: FAIL because the evaluation schema and explicit projection do not exist.

- [ ] **Step 3: Define the D1 tables and migration**

Add `evaluation_runs` with these non-secret fields: identifiers/split/category, run status, attempt number, initial/final tier, route/upgrade JSON, model name, sanitized request payload, answer, raw provider metadata, input/output/total Token, latency, calculated model cost, deterministic score JSON, judge score JSON, human review state, failure tags, correction linkage, and timestamps.

Add a unique index on `(dataset_version, case_id, variant, trial)` plus indexes for `status`, `category`, `variant`, and `created_at`. The migration must only create evaluation tables and indexes; it must not alter or drop `model_runs`.

Change `listRecentRunRecords` to:

```ts
return db.select({
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
}).from(modelRuns)
```

This preserves current feedback behavior even when the historic database lacks `feedback_updated_at`.

- [ ] **Step 4: Run tests and inspect the generated migration**

Run: `pnpm.cmd exec node --test tests/evaluation-v2.test.mjs`  
Expected: PASS.

Run: `pnpm.cmd run db:generate`  
Expected: generated migration contains only additive `evaluation_runs` DDL; inspect it before retaining it.

- [ ] **Step 5: Commit database source and compatibility layer**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add db drizzle app/api/runs tests
& 'C:\Program Files\Git\cmd\git.exe' commit -m "add evaluation run storage"
```

## Task 5: Implement one-trial, resumable evaluation execution and blind scoring

**Files:**
- Create: `lib/evaluation-runner.ts`
- Create: `lib/evaluation-judge.ts`
- Modify: `db/evaluation-records.ts`
- Modify: `tests/evaluation-v2.test.mjs`

**Interfaces:**
- `runEvaluationTrial({ datasetVersion, caseId, variant, trial, budgetRemainingCny }): Promise<EvaluationRun>`
- `scoreEvaluationAnswer({ task, answer, route, toolTrace }): Promise<EvaluationScore>`
- `nextUpgradeTier` from `lib/evaluation-score.ts` controls dynamic escalation.

- [ ] **Step 1: Write failing tests for four variants, preserved escalation context, and budget stopping**

Use a mocked Ark helper. Assert:

```js
assert.equal(allSmall.attempts.length, 1);
assert.equal(allGeneral.attempts[0].tier, "general");
assert.equal(allReasoning.attempts[0].tier, "reasoning");
assert.deepEqual(dynamic.attempts.map(({ tier }) => tier), ["small", "general", "reasoning"]);
assert.match(dynamic.attempts[1].failureContext, /hard constraint/i);
assert.equal(overBudget.status, "blocked_budget");
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm.cmd exec node --test tests/evaluation-v2.test.mjs`  
Expected: FAIL because no runner exists.

- [ ] **Step 3: Implement deterministic pre-checks and attempts**

For fixed variants, execute one model attempt at the assigned tier. For `dynamic`, call `routeQuery` with the task context, execute its initial tier, apply deterministic route/tool/hard-constraint checks, and only then incrementally call `nextUpgradeTier`. The second and third attempts must carry a concise failure record plus the previous answer; they must never resend unrelated real-user history.

Persist every terminal attempt, including provider errors. A case already stored at the unique identity returns its stored record and never calls Ark again.

- [ ] **Step 4: Implement blinded model-assisted quality scoring**

The judge receives task assertions, answer, deterministic results, and tool trace, but never variant name, model name, price, or escalation count. It returns JSON for task completion, constraint satisfaction, factual grounding, executability, interaction quality, critical failure, and a weighted score. Invalid judge JSON becomes `review_required`, not a fabricated passing score.

All `safety_security`, second-upgrade, judge-invalid, and deterministic/judge-disagreement cases are marked for required human review.

- [ ] **Step 5: Run runner and score tests**

Run: `pnpm.cmd exec node --test tests/evaluation-v2.test.mjs`  
Expected: PASS, including no third upgrade after Pro.

- [ ] **Step 6: Commit the resumable runner**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add lib/evaluation-runner.ts lib/evaluation-judge.ts db/evaluation-records.ts tests
& 'C:\Program Files\Git\cmd\git.exe' commit -m "run resumable evaluation trials"
```

## Task 6: Expose bounded evaluation and human-review APIs

**Files:**
- Create: `app/api/evaluations/route.ts`
- Create: `app/api/evaluations/review/route.ts`
- Modify: `tests/rendered-html.test.mjs`
- Modify: `tests/evaluation-v2.test.mjs`

**Interfaces:**
- `GET /api/evaluations?datasetVersion=2.0.0` returns completion status, four-group summary, category breakdown, issue evidence, and safe detail records.
- `POST /api/evaluations` accepts `{ datasetVersion, caseIds, variants, trials, maxRuns, maxBudgetCny, confirmed: true }` and runs at most `maxRuns` missing trials.
- `PATCH /api/evaluations/review` accepts `{ runId, reviewer, rubric, notes, correctionOfRunId? }`.

- [ ] **Step 1: Write failing API tests for confirmation, bounded batches, and secret-safe output**

Assert that a POST without `confirmed: true` returns 400 and performs zero runs; `maxRuns` greater than 6 returns 400; a successful response includes count and run IDs but no `Authorization`, `ARK_API_KEY`, or complete system prompt. Assert GET returns `metrics: null` and an explicit missing-run count for an incomplete experiment.

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm.cmd exec node --test tests/evaluation-v2.test.mjs`  
Expected: FAIL because evaluation routes do not exist.

- [ ] **Step 3: Implement the routes with safe limits**

Limit each request to six missing trials and a positive `maxBudgetCny` no greater than ¥20. The API checks configured Ark tiers before paid execution, uses the idempotent runner, and returns progress even if one record fails. GET serializes only synthetic task text and safe route/score data. Human-review PATCH validates each 1–5 rubric score and stores reviewer notes capped at 2,000 characters.

- [ ] **Step 4: Run API tests and production build**

Run: `pnpm.cmd exec node --test tests/evaluation-v2.test.mjs`  
Expected: PASS.

Run: `pnpm.cmd run build`  
Expected: PASS.

- [ ] **Step 5: Commit the API boundary**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add app/api/evaluations tests
& 'C:\Program Files\Git\cmd\git.exe' commit -m "add bounded evaluation APIs"
```

## Task 7: Replace the synthetic evaluation page with evidence and drill-downs

**Files:**
- Modify: `lib/routesense.ts`
- Modify: `app/RouteSenseApp.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- UI consumes `GET /api/evaluations` only; it does not import static experiment summaries or generate CSV results in the browser.
- `EvaluationDetailDialog` consumes a persisted safe run record and shows task, answer, route, score, attempts, and correction link.

- [ ] **Step 1: Write failing rendered-page/source tests for real-evidence copy**

Assert the source/rendered markup contains:

```text
同一批任务，比较四种策略。
实验状态与证据说明
全 Mini
全 Lite
全 Pro
动态路由
问题案例与纠正记录
评测驱动，让策略持续校准。
```

Assert it does not contain `100 条合成任务`, `3 个策略组`, `导出 300 条原始结果`, `原 AgentScope 智能体评测`, `失败不是脏数据`, `供应商可替换`, `68%`, `92%`, or `95%` as fixed experiment metrics.

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm.cmd exec node --test tests/rendered-html.test.mjs`  
Expected: FAIL because current page still renders synthetic content.

- [ ] **Step 3: Remove synthetic experiment sources and build evidence states**

Delete `EXPERIMENT_SUMMARIES`, `EVALUATION_QUERIES`, `buildExperimentCsv`, `scenarioRows`, and `failureCases` only after the fetched evidence types are wired. Replace the top-right controls with: refresh evidence; run next bounded batch; and progress/cost guard confirmation. No “run all” action may bypass the six-run batch maximum.

When records are incomplete, display: completed/expected runs, missing runs, “样本不足，暂不下结论”, and no percentage/cost claim. Once a variant is complete, render its calculated task success rate, hard-constraint satisfaction, cost per successful task, P50/P95 latency, and first/second upgrade recovery figures.

- [ ] **Step 4: Add issue and correction detail interactions**

Make every non-empty “主要问题” cell a button. Its dialog lists only persisted records with task ID, failure tag, tier, score, timestamp, and “查看详情”. The detail dialog displays synthetic input/context, each attempt, answer, route decision, deterministic check, judge result, and human review/correction relationship.

If no record exists, show the exact empty state `尚无已运行案例` and disable no-op detail controls.

- [ ] **Step 5: Update route strategy copy and evidence state**

Change the title to `评测驱动，让策略持续校准。`; delete the `供应商可替换` badge and the Chinese-display-name/vendor explanation. Rename `首版规则字典` to `评测反馈驱动的路由策略`. Each rule card displays `初始假设` until related persisted evidence is available, then lists rule version, contributing case IDs, failure tags, and verification date. Do not claim an evidence link when no run is stored.

- [ ] **Step 6: Run UI regression tests and build**

Run: `pnpm.cmd exec node --test tests/rendered-html.test.mjs`  
Expected: PASS.

Run: `pnpm.cmd run build`  
Expected: PASS.

- [ ] **Step 7: Commit the evidence UI**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add app/RouteSenseApp.tsx app/globals.css lib/routesense.ts tests
& 'C:\Program Files\Git\cmd\git.exe' commit -m "show traceable evaluation evidence"
```

## Task 8: Verify local behavior, prepare D1 migration, and release safely

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Test: `tests/evaluation-v2.test.mjs`, `tests/rendered-html.test.mjs`, `tests/routesense-router.test.mjs`, `tests/travel-options.test.mjs`

**Interfaces:**
- README explains the no-cost data validation path, the separate paid batch path, exact environment variables, and recovery after an interrupted batch.

- [ ] **Step 1: Write a release checklist in README before changing deployment state**

Document these exact commands for a Windows PowerShell project terminal:

```powershell
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
pnpm.cmd eval:v2:validate
pnpm.cmd test
```

Document that formal runs require the owner to review `evaluation/v2/task_catalog.md`, confirm the displayed budget, and keep the browser open while dispatching resumable six-run batches.

- [ ] **Step 2: Run complete local verification**

Run: `pnpm.cmd eval:v2:validate`  
Expected: V2 data reports 63 tasks, 21 development, 42 holdout, 504 planned calls, valid.

Run: `pnpm.cmd test`  
Expected: all existing and V2 tests pass.

- [ ] **Step 3: Review the D1 migration before applying it**

Inspect `drizzle/0001_evaluation_runs.sql`. Confirm it only creates `evaluation_runs` tables/indexes and does not contain `DROP TABLE`, `DELETE`, `UPDATE model_runs`, or an API key. Do not apply the migration without explicit project-owner authorization.

- [ ] **Step 4: Apply and verify the production D1 migration only after owner approval**

In the Cloudflare D1 SQL console for the RouteSense database, first run a read-only schema check:

```sql
PRAGMA table_info(model_runs);
```

If `feedback_updated_at` is absent, run this one-time additive repair after verifying the table columns:

```sql
ALTER TABLE model_runs ADD COLUMN feedback_updated_at text;
```

Then apply the reviewed `evaluation_runs` migration through the approved deployment path. Verify with:

```sql
PRAGMA table_info(evaluation_runs);
SELECT COUNT(*) AS daily_run_count FROM model_runs;
SELECT COUNT(*) AS evaluation_run_count FROM evaluation_runs;
```

- [ ] **Step 5: Deploy code and perform non-paid smoke checks**

After GitHub/Cloudflare deployment completes, verify the site loads, the evaluation page says no result is available instead of showing synthetic rates, and `/api/runs` returns a list or a useful error rather than the old failed-query message. Do not begin a paid evaluation batch in this step.

- [ ] **Step 6: Commit release documentation and record verification evidence**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add README.md .env.example docs tests
& 'C:\Program Files\Git\cmd\git.exe' commit -m "document evaluation v2 operations"
```

## Task 9: Execute development evaluation before formal comparison

**Files:**
- Modify: `evaluation/v2/routesense_eval_v2.json` only when the product owner approves a task-card correction.
- Create: `evaluation/v2/development-change-log.md`

**Interfaces:**
- Each development iteration records hypothesis, changed route/prompt/quality rule, exact development case IDs, result, regression, rule version, and timestamp.

- [ ] **Step 1: Explicitly authorize one small paid development batch**

Start with one ability category (three development cases) across only the dynamic strategy and one trial: three calls. Display the estimated maximum cost before confirmation. Do not run the 42-task formal set.

- [ ] **Step 2: Inspect task-level evidence before changing rules**

Open every failed case detail; distinguish wrong route, missing tool, missing hard constraint, poor answer, judge disagreement, and provider error. Record the evidence in `development-change-log.md`.

- [ ] **Step 3: Make one hypothesis-driven change and run its regression subset**

For each revision, change one routing/prompt/quality rule, rerun only the affected development cases plus one neighbouring-category regression case, and record both improvement and regression. Do not tune on holdout cases.

- [ ] **Step 4: Freeze and tag the formal version**

After all 21 development cards meet the agreed gate, record frozen route version, prompt version, model IDs, model price table, scoring version, output Token cap, and test dataset hash in `development-change-log.md`.

- [ ] **Step 5: Obtain explicit approval before the 504-call formal experiment**

Show the owner the frozen configuration, expected maximum model budget, and 42 holdout task inventory. Begin no formal paid calls until approval is recorded.

## Plan Self-Review

- Spec coverage: Tasks 1–2 implement V2 task definitions and honest metrics; Tasks 3–6 implement model execution, D1 storage, traceability, review and bounded-cost APIs; Task 7 implements the requested evaluation/rules UI; Task 4 repairs daily run-list compatibility; Tasks 8–9 handle migration, verification, development tuning, and formal-experiment authorization.
- Placeholder scan: no task uses an unspecified data source or undefined interface; all task-card IDs, endpoint payloads, rules, limits, and verification commands are concrete.
- Type consistency: `EvaluationVariant`, `EvaluationRun`, `EvaluationScore`, `nextUpgradeTier`, `runEvaluationTrial`, `evaluationRuns`, and the evaluation API names are defined in upstream tasks before later tasks consume them.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-30-evaluation-v2-implementation.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent for each task and review each deliverable before continuing.
2. **Inline Execution** — implement tasks in this session in small batches with review checkpoints.
