export type EvaluationVariant =
  | "all_mini"
  | "all_lite"
  | "all_pro"
  | "dynamic";

export type EvaluationModelTier = "small" | "general" | "reasoning";
export type EvaluationRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface EvaluationScore {
  passed: boolean;
  qualityScore: number;
  failureTags: string[];
}

export interface EvaluationReview {
  finding: string;
  reviewer: "human" | "judge";
}

export interface EvaluationRun {
  id: string;
  caseId: string;
  variant: EvaluationVariant;
  trial: number;
  status: EvaluationRunStatus;
  modelTier?: EvaluationModelTier;
  score?: EvaluationScore;
  review?: EvaluationReview;
  costCny?: number;
  latencyMs?: number;
  upgradeCount?: number;
}

export interface EvaluationMetrics {
  taskSuccessRate: number | null;
  averageCostCny: number | null;
  costPerSuccessfulTaskCny: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  upgradeRate: number | null;
}

export interface EvaluationSummary {
  isComplete: boolean;
  completedCount: number;
  expectedCount: number;
  missingRunKeys: string[];
  metrics: EvaluationMetrics;
}

export interface IssueEvidence {
  issue: string;
  count: number;
  runIds: string[];
  reviewFindings: string[];
}
