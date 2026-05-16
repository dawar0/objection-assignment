import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/jobs/$jobId/stream")({
	server: {
		handlers: {
			GET: async ({ params }: { params: { jobId: string } }) => {
				const { getRun } = await import("../lib/intake");
				const encoder = new TextEncoder();
				let closed = false;
				const stream = new ReadableStream({
					async start(controller) {
						while (!closed) {
							const run = await getRun(params.jobId);
							controller.enqueue(
								encoder.encode(`data: ${JSON.stringify(run)}\n\n`),
							);
							if (
								!run ||
								run.status === "complete" ||
								run.status === "failed"
							) {
								break;
							}
							await new Promise((resolve) => setTimeout(resolve, 2500));
						}
						if (!closed) controller.close();
					},
					cancel() {
						closed = true;
					},
				});

				return new Response(stream, {
					headers: {
						"content-type": "text/event-stream",
						"cache-control": "no-cache",
						connection: "keep-alive",
					},
				});
			},
		},
	},
});
