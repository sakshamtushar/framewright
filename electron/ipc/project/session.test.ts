import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: () => os.tmpdir(),
	},
}));

const {
	getRecordingSessionManifestPath,
	resolveRecordingSession,
	resolveRecordingSessionManifest,
} = await import("./session");

describe("resolveRecordingSessionManifest", () => {
	let tempDir: string;
	let videoPath: string;
	let webcamPath: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "framewright-session-"));
		videoPath = path.join(tempDir, "recording.mp4");
		webcamPath = path.join(tempDir, "recording-webcam.mp4");
		await fs.writeFile(videoPath, "video-bytes");
		await fs.writeFile(webcamPath, "webcam-bytes");
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("reads the current .framewright-session.json manifest when present", async () => {
		const manifestPath = getRecordingSessionManifestPath(videoPath);
		await fs.writeFile(
			manifestPath,
			JSON.stringify({
				version: 2,
				videoFileName: path.basename(videoPath),
				webcamFileName: path.basename(webcamPath),
				timeOffsetMs: 250,
			}),
			"utf-8",
		);

		const result = await resolveRecordingSessionManifest(videoPath);

		expect(result).toMatchObject({
			videoPath,
			webcamPath,
			timeOffsetMs: 250,
		});
	});

	it("falls back to the legacy .recordly-session.json manifest when the new one is missing", async () => {
		const legacyManifestPath = path.join(tempDir, "recording.recordly-session.json");
		await fs.writeFile(
			legacyManifestPath,
			JSON.stringify({
				version: 2,
				videoFileName: path.basename(videoPath),
				webcamFileName: path.basename(webcamPath),
				timeOffsetMs: 480,
			}),
			"utf-8",
		);

		const result = await resolveRecordingSessionManifest(videoPath);

		expect(result).toMatchObject({
			videoPath,
			webcamPath,
			timeOffsetMs: 480,
		});
	});

	it("prefers the current manifest over a legacy one when both exist", async () => {
		const manifestPath = getRecordingSessionManifestPath(videoPath);
		const legacyManifestPath = path.join(tempDir, "recording.recordly-session.json");
		await fs.writeFile(
			manifestPath,
			JSON.stringify({
				version: 2,
				videoFileName: path.basename(videoPath),
				webcamFileName: path.basename(webcamPath),
				timeOffsetMs: 100,
			}),
			"utf-8",
		);
		await fs.writeFile(
			legacyManifestPath,
			JSON.stringify({
				version: 2,
				videoFileName: path.basename(videoPath),
				webcamFileName: path.basename(webcamPath),
				timeOffsetMs: 999,
			}),
			"utf-8",
		);

		const result = await resolveRecordingSessionManifest(videoPath);

		expect(result?.timeOffsetMs).toBe(100);
	});

	it("returns null when neither the current nor legacy manifest exists", async () => {
		const result = await resolveRecordingSessionManifest(videoPath);
		expect(result).toBeNull();
	});

	it("resolveRecordingSession recovers timeOffsetMs from a legacy manifest instead of silently defaulting to 0", async () => {
		const legacyManifestPath = path.join(tempDir, "recording.recordly-session.json");
		await fs.writeFile(
			legacyManifestPath,
			JSON.stringify({
				version: 2,
				videoFileName: path.basename(videoPath),
				webcamFileName: path.basename(webcamPath),
				timeOffsetMs: 733,
			}),
			"utf-8",
		);

		const result = await resolveRecordingSession(videoPath);

		expect(result).toMatchObject({
			videoPath,
			webcamPath,
			timeOffsetMs: 733,
		});
	});
});
