CREATE TABLE `evaluation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`evaluation_id` text NOT NULL,
	`dataset_version` text NOT NULL,
	`case_id` text NOT NULL,
	`split` text NOT NULL,
	`category` text NOT NULL,
	`variant` text NOT NULL,
	`trial` integer NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`initial_tier` text,
	`final_tier` text,
	`model_name` text,
	`route_version` text NOT NULL,
	`prompt_version` text NOT NULL,
	`route_decision_json` text,
	`upgrade_trace_json` text,
	`sanitized_request_json` text,
	`answer` text,
	`provider_metadata_json` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`latency_ms` integer,
	`http_status` integer,
	`cost_cny` real,
	`deterministic_score_json` text,
	`judge_score_json` text,
	`human_review_json` text,
	`human_review_state` text DEFAULT 'pending' NOT NULL,
	`failure_tags_json` text,
	`correction_of_run_id` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evaluation_runs_identity_idx` ON `evaluation_runs` (`dataset_version`,`case_id`,`variant`,`trial`);--> statement-breakpoint
CREATE INDEX `evaluation_runs_status_idx` ON `evaluation_runs` (`status`);--> statement-breakpoint
CREATE INDEX `evaluation_runs_category_idx` ON `evaluation_runs` (`category`);--> statement-breakpoint
CREATE INDEX `evaluation_runs_variant_idx` ON `evaluation_runs` (`variant`);--> statement-breakpoint
CREATE INDEX `evaluation_runs_created_at_idx` ON `evaluation_runs` (`created_at`);