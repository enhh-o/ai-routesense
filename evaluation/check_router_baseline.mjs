import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DEFAULT_SETTINGS, routeQuery } from "../lib/routesense.ts";

const evaluationDir = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(
  await readFile(
    path.join(evaluationDir, "routesense_eval_v1.json"),
    "utf8",
  ),
);
const splits = JSON.parse(
  await readFile(path.join(evaluationDir, "splits.json"), "utf8"),
);

const labelPairs = [
  ["intentStage", "intent_stage"],
  ["informationCompleteness", "information_completeness"],
  ["taskComplexity", "task_complexity"],
  ["personalizationNeed", "personalization_need"],
  ["realtimeNeed", "realtime_need"],
  ["riskLevel", "risk_level"],
];

const developmentCaseIds = new Set(splits.development);
const holdoutCaseIds = new Set(splits.holdout);
const requestedSplit = process.argv.find((arg) => arg.startsWith("--split="))
  ?.split("=")[1];
const split = requestedSplit === "holdout" ? "holdout" : "development";
const selectedCases = dataset.cases.filter((evalCase) =>
  split === "development"
    ? developmentCaseIds.has(evalCase.case_id)
    : holdoutCaseIds.has(evalCase.case_id),
);

const results = selectedCases.map((evalCase) => {
  const fixture = evalCase.context ?? {};
  const initialAttempt = fixture.initial_attempt_fixture;
  const actual = routeQuery(evalCase.user_query, DEFAULT_SETTINGS, {
    history: fixture.conversation_history,
    memory: fixture.memory_fixture,
    toolResult: fixture.tool_fixture,
    account: fixture.account_fixture,
    lastFailure: initialAttempt
      ? {
          modelTier: initialAttempt.model_tier,
          failure: initialAttempt.failure,
        }
      : null,
  });
  const expected = evalCase.expected_route;
  const checks = [];

  for (const [actualKey, expectedKey] of labelPairs) {
    checks.push({
      field: expectedKey,
      expected: expected[expectedKey],
      actual: actual.labels[actualKey],
      passed: expected[expectedKey] === actual.labels[actualKey],
    });
  }

  for (const strategy of expected.required_strategies) {
    checks.push({
      field: `required_strategy:${strategy}`,
      expected: true,
      actual: actual.strategies.includes(strategy),
      passed: actual.strategies.includes(strategy),
    });
  }

  for (const strategy of expected.forbidden_strategies ?? []) {
    checks.push({
      field: `forbidden_strategy:${strategy}`,
      expected: false,
      actual: actual.strategies.includes(strategy),
      passed: !actual.strategies.includes(strategy),
    });
  }

  checks.push({
    field: "final_tier",
    expected: expected.acceptable_model_tiers,
    actual: actual.finalTier,
    passed: expected.acceptable_model_tiers.includes(actual.finalTier),
  });

  return {
    caseId: evalCase.case_id,
    title: evalCase.title,
    passed: checks.every((check) => check.passed),
    passedCheckCount: checks.filter((check) => check.passed).length,
    totalCheckCount: checks.length,
    mismatches: checks.filter((check) => !check.passed),
  };
});

const strictPassCount = results.filter((result) => result.passed).length;
const passedChecks = results.reduce(
  (sum, result) => sum + result.passedCheckCount,
  0,
);
const totalChecks = results.reduce(
  (sum, result) => sum + result.totalCheckCount,
  0,
);

console.log(
  JSON.stringify(
    {
      datasetId: dataset.dataset_id,
      split,
      routerVersion: DEFAULT_SETTINGS.version,
      caseCount: results.length,
      strictRoutePassCount: strictPassCount,
      strictRouteAccuracy: strictPassCount / results.length,
      fieldLevelAccuracy: passedChecks / totalChecks,
      mismatchedCases: results
        .filter((result) => !result.passed)
        .map(({ caseId, title, mismatches }) => ({
          caseId,
          title,
          mismatches,
        })),
    },
    null,
    2,
  ),
);
