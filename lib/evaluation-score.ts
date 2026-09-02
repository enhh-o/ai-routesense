import type {
  EvaluationMetrics,
  EvaluationModelTier,
  EvaluationRun,
  EvaluationSummary,
  EvaluationVariant,
  IssueEvidence,
} from "./evaluation-types";

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

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

function emptyMetrics(): EvaluationMetrics {
  return {
    taskSuccessRate: null,
    averageCostCny: null,
    costPerSuccessfulTaskCny: null,
    p50LatencyMs: null,
    p95LatencyMs: null,
    upgradeRate: null,
  };
}

function runKey(caseId: string, variant: EvaluationVariant, trial: number) {
  return `${caseId}:${variant}:${trial}`;
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * ratio) - 1];
}

export function calculateModelCost(
  tier: EvaluationModelTier,
  inputTokens: number,
  outputTokens: number,
) {
  const price = MODEL_PRICE_PER_1K_TOKEN[tier].find(
    (item) => inputTokens <= item.maxInputTokens,
  );
  if (!price) {
    throw new RangeError("单次输入超过当前价格表的 256K Token 上限");
  }
  return Number(
    ((inputTokens / 1_000) * price.input + (outputTokens / 1_000) * price.output).toFixed(8),
  );
}

export function nextUpgradeTier(tier: EvaluationModelTier): EvaluationModelTier | null {
  if (tier === "small") return "general";
  if (tier === "general") return "reasoning";
  return null;
}

export function aggregateEvaluationRuns({
  caseIds,
  variants,
  trialsPerVariant,
  runs,
}: {
  caseIds: string[];
  variants: EvaluationVariant[];
  trialsPerVariant: number;
  runs: EvaluationRun[];
}): EvaluationSummary {
  const expectedKeys = caseIds.flatMap((caseId) =>
    variants.flatMap((variant) =>
      Array.from({ length: trialsPerVariant }, (_, index) => runKey(caseId, variant, index + 1)),
    ),
  );
  const runsByKey = new Map(
    runs.map((run) => [runKey(run.caseId, run.variant, run.trial), run]),
  );
  const missingRunKeys = expectedKeys.filter((key) => {
    const run = runsByKey.get(key);
    return !run || !terminalStatuses.has(run.status);
  });
  const completedRuns = expectedKeys
    .map((key) => runsByKey.get(key))
    .filter((run): run is EvaluationRun => Boolean(run));

  if (missingRunKeys.length > 0) {
    return {
      isComplete: false,
      completedCount: completedRuns.filter((run) => terminalStatuses.has(run.status)).length,
      expectedCount: expectedKeys.length,
      missingRunKeys,
      metrics: emptyMetrics(),
    };
  }

  const successfulRuns = completedRuns.filter(
    (run) => run.status === "completed" && run.score?.passed,
  );
  const costs = completedRuns.map((run) => run.costCny ?? 0);
  const latencies = completedRuns
    .map((run) => run.latencyMs)
    .filter((latency): latency is number => typeof latency === "number");
  const totalCost = costs.reduce((sum, cost) => sum + cost, 0);
  const metrics: EvaluationMetrics = {
    taskSuccessRate: completedRuns.length
      ? successfulRuns.length / completedRuns.length
      : 0,
    averageCostCny: completedRuns.length ? totalCost / completedRuns.length : 0,
    costPerSuccessfulTaskCny: successfulRuns.length
      ? totalCost / successfulRuns.length
      : null,
    p50LatencyMs: latencies.length ? percentile(latencies, 0.5) : null,
    p95LatencyMs: latencies.length ? percentile(latencies, 0.95) : null,
    upgradeRate: completedRuns.length
      ? completedRuns.filter((run) => (run.upgradeCount ?? 0) > 0).length /
        completedRuns.length
      : 0,
  };

  return {
    isComplete: true,
    completedCount: completedRuns.length,
    expectedCount: expectedKeys.length,
    missingRunKeys: [],
    metrics,
  };
}

export function aggregateEvaluationRunsByVariant({
  caseIds,
  variants,
  trialsPerVariant,
  runs,
}: {
  caseIds: string[];
  variants: EvaluationVariant[];
  trialsPerVariant: number;
  runs: EvaluationRun[];
}): Record<EvaluationVariant, EvaluationSummary> {
  return Object.fromEntries(
    variants.map((variant) => [
      variant,
      aggregateEvaluationRuns({
        caseIds,
        variants: [variant],
        trialsPerVariant,
        runs,
      }),
    ]),
  ) as Record<EvaluationVariant, EvaluationSummary>;
}

export function buildIssueEvidence(runs: EvaluationRun[]): IssueEvidence[] {
  const issues = new Map<string, IssueEvidence>();
  for (const run of runs) {
    for (const issue of run.score?.failureTags ?? []) {
      const entry = issues.get(issue) ?? {
        issue,
        count: 0,
        runIds: [],
        reviewFindings: [],
      };
      entry.count += 1;
      entry.runIds.push(run.id);
      if (run.review?.finding && !entry.reviewFindings.includes(run.review.finding)) {
        entry.reviewFindings.push(run.review.finding);
      }
      issues.set(issue, entry);
    }
  }
  return [...issues.values()].sort((left, right) =>
    left.issue.localeCompare(right.issue),
  );
}
