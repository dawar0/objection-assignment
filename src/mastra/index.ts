import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import {
	MastraPlatformExporter,
	MastraStorageExporter,
	Observability,
	SensitiveDataFilter,
} from "@mastra/observability";
import { PostgresStore } from "@mastra/pg";
import { env } from "../env";
import { documentSummaryAgent } from "./agents/document-summary-agent";
import { entityExtractionAgent } from "./agents/entity-extraction-agent";
import { externalCorroborationAgent } from "./agents/external-corroboration-agent";
import { internalConsistencyAgent } from "./agents/internal-consistency-agent";
import { redTeamAgent } from "./agents/red-team-agent";
import { verificationWorkflow } from "./workflows/verification-workflow";

export const mastra = new Mastra({
	workflows: { verificationWorkflow },
	agents: {
		internalConsistencyAgent,
		externalCorroborationAgent,
		redTeamAgent,
		documentSummaryAgent,
		entityExtractionAgent,
	},
	storage: new PostgresStore({
		id: "mastra-storage",
		connectionString: env.DATABASE_URL,
		ssl: { rejectUnauthorized: false },
	}),
	logger: new PinoLogger({
		name: "Mastra",
		level: "info",
	}),
	observability: new Observability({
		configs: {
			default: {
				serviceName: "mastra",
				exporters: [
					new MastraStorageExporter(), // Persists observability events to Mastra Storage
					new MastraPlatformExporter({
						accessToken: env.MASTRA_PLATFORM_ACCESS_TOKEN,
						projectId: env.MASTRA_PROJECT_ID,
						maxBatchSize: 1,
						maxBatchWaitMs: 250,
					}),
				],
				spanOutputProcessors: [
					new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
				],
			},
		},
	}),
});
