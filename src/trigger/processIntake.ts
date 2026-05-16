import { logger, task } from "@trigger.dev/sdk/v3";

export const processIntakeTask = task({
	id: "process-intake",
	maxDuration: 3600,
	retry: {
		maxAttempts: 2,
		minTimeoutInMs: 5_000,
		maxTimeoutInMs: 30_000,
		factor: 2,
		randomize: true,
	},
	run: async (payload: { packageId: string; runId: string }) => {
		const { processIntakePackage, markRunFailed } = await import(
			"../lib/intake"
		);
		try {
			await processIntakePackage(payload.packageId, payload.runId);
		} catch (error) {
			logger.error("processIntakePackage failed", {
				packageId: payload.packageId,
				runId: payload.runId,
				error: error instanceof Error ? error.message : String(error),
			});
			await markRunFailed(payload.runId, error);
			throw error;
		}
	},
});
