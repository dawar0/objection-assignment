import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	db: {
		select: vi.fn(),
		insert: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		transaction: vi.fn(),
	},
}));

vi.mock("../db", () => ({ db: mocks.db }));

import { createUploadSlots } from "./intake";

function selectRows(rows: unknown[]) {
	return {
		from: () => ({
			where: () => ({
				limit: async () => rows,
			}),
		}),
	};
}

describe("createUploadSlots", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects late uploads once a package has been summarized and sealed", async () => {
		mocks.db.select
			.mockReturnValueOnce(
				selectRows([{ id: "link-1", packageId: "package-1" }]),
			)
			.mockReturnValueOnce(
				selectRows([
					{ summarizationSealedAt: new Date("2026-05-15T00:00:00.000Z") },
				]),
			);

		await expect(
			createUploadSlots({
				token: "source-token",
				files: [
					{ filename: "late.txt", contentType: "text/plain", sizeBytes: 12 },
				],
			}),
		).rejects.toThrow("already been summarized and sealed");

		expect(mocks.db.insert).not.toHaveBeenCalled();
	});
});
