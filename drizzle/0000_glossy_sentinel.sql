CREATE TABLE `model_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`status` text NOT NULL,
	`mode` text NOT NULL,
	`provider` text NOT NULL,
	`query` text NOT NULL,
	`history_json` text,
	`prompt_version` text NOT NULL,
	`system_prompt` text,
	`route_tier` text NOT NULL,
	`route_decision_json` text NOT NULL,
	`model_name` text NOT NULL,
	`request_payload_json` text,
	`raw_response_json` text,
	`answer` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`latency_ms` integer,
	`http_status` integer,
	`error_code` text,
	`error_message` text,
	`feedback` text,
	`feedback_updated_at` text
);
--> statement-breakpoint
CREATE INDEX `model_runs_created_at_idx` ON `model_runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `model_runs_status_idx` ON `model_runs` (`status`);--> statement-breakpoint
CREATE INDEX `model_runs_model_name_idx` ON `model_runs` (`model_name`);