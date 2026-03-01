import { createSocket, type Socket } from "node:dgram";
import { toBuffer } from "osc-min";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OscClient } from "../src/osc-client.js";
import {
	captureRta,
	decodeRtaBlob,
	RTA_BAND_COUNT,
	RTA_FREQUENCIES,
	rtaSourceIndex,
} from "../src/rta.js";

describe("decodeRtaBlob", () => {
	it("decodes a valid blob with known values", () => {
		const buf = Buffer.alloc(4 + RTA_BAND_COUNT * 2);
		buf.writeInt32LE(RTA_BAND_COUNT, 0);

		buf.writeInt16LE(256, 4); // band 0: 256/256 = 1.0 dB
		buf.writeInt16LE(-512, 6); // band 1: -512/256 = -2.0 dB
		buf.writeInt16LE(0, 8); // band 2: 0/256 = 0.0 dB
		buf.writeInt16LE(128, 10); // band 3: 128/256 = 0.5 dB

		const bands = decodeRtaBlob(buf);
		expect(bands).toHaveLength(RTA_BAND_COUNT);
		expect(bands[0]).toBe(1.0);
		expect(bands[1]).toBe(-2.0);
		expect(bands[2]).toBe(0.0);
		expect(bands[3]).toBe(0.5);
	});

	it("throws on wrong band count", () => {
		const buf = Buffer.alloc(4 + 50 * 2);
		buf.writeInt32LE(50, 0);
		expect(() => decodeRtaBlob(buf)).toThrow("Expected 100 bands, got 50");
	});
});

describe("rtaSourceIndex", () => {
	it("maps channel 1 to index 0", () => {
		expect(rtaSourceIndex(1)).toBe(0);
	});

	it("maps channel 16 to index 15", () => {
		expect(rtaSourceIndex(16)).toBe(15);
	});

	it("maps channel 17 (aux) to index 16", () => {
		expect(rtaSourceIndex(17)).toBe(16);
	});

	it("throws for invalid channel 0", () => {
		expect(() => rtaSourceIndex(0)).toThrow("Invalid RTA channel");
	});

	it("throws for invalid channel 18", () => {
		expect(() => rtaSourceIndex(18)).toThrow("Invalid RTA channel");
	});
});

describe("RTA_FREQUENCIES", () => {
	it("has exactly 100 bands", () => {
		expect(RTA_FREQUENCIES).toHaveLength(100);
	});

	it("starts at 20 Hz", () => {
		expect(RTA_FREQUENCIES[0]).toBe(20);
	});

	it("ends near 18660 Hz", () => {
		expect(RTA_FREQUENCIES[99]).toBeCloseTo(18660, 0);
	});

	it("is monotonically increasing", () => {
		for (let i = 1; i < RTA_FREQUENCIES.length; i++) {
			expect(RTA_FREQUENCIES[i]).toBeGreaterThan(RTA_FREQUENCIES[i - 1]);
		}
	});
});

describe("captureRta", () => {
	let mockServer: Socket;
	let serverPort: number;
	let client: OscClient;

	function buildRtaBlob(): Buffer {
		const blobData = Buffer.alloc(4 + RTA_BAND_COUNT * 2);
		blobData.writeInt32LE(RTA_BAND_COUNT, 0);
		for (let i = 0; i < RTA_BAND_COUNT; i++) {
			// band i = -(i * 0.5) dB → raw Int16LE = -(i * 128)
			blobData.writeInt16LE(-i * 128, 4 + i * 2);
		}
		return blobData;
	}

	beforeEach(async () => {
		mockServer = createSocket("udp4");
		await new Promise<void>((resolve) => {
			mockServer.bind(0, "127.0.0.1", () => {
				serverPort = mockServer.address().port;
				resolve();
			});
		});

		client = {
			ip: "127.0.0.1",
			port: serverPort,
			connected: true,
			send: vi.fn(),
			query: vi.fn(),
			disconnect: vi.fn(),
		} as unknown as OscClient;

		// When mock server receives a subscription, stream back RTA blobs
		mockServer.on("message", (_msg, rinfo) => {
			const blobData = buildRtaBlob();
			const oscBuf = toBuffer({
				address: "/meters/4",
				args: [{ type: "blob", value: blobData }],
			});
			const bytes = new Uint8Array(oscBuf.buffer, oscBuf.byteOffset, oscBuf.byteLength);

			const sendFrame = () => {
				mockServer.send(bytes, 0, bytes.length, rinfo.port, rinfo.address);
			};

			// Send 3 frames with small delays
			sendFrame();
			setTimeout(sendFrame, 50);
			setTimeout(sendFrame, 100);
		});
	});

	afterEach(() => {
		mockServer.close();
	});

	it("sets RTA source before capturing", async () => {
		await captureRta(client, 5, 500);
		expect(client.send).toHaveBeenCalledWith("/-stat/rta/source", {
			type: "integer",
			value: 4, // channel 5 → index 4
		});
	});

	it("captures and averages frames", async () => {
		const result = await captureRta(client, 1, 500);
		expect(result.frameCount).toBeGreaterThanOrEqual(1);
		expect(result.bands).toHaveLength(RTA_BAND_COUNT);

		// All frames have identical data, so average = single frame values
		// Band 0: 0 dB, Band 1: -0.5 dB, Band 2: -1.0 dB
		expect(result.bands[0]).toBeCloseTo(0, 1);
		expect(result.bands[1]).toBeCloseTo(-0.5, 1);
		expect(result.bands[2]).toBeCloseTo(-1.0, 1);
	});

	it("returns frame count", async () => {
		const result = await captureRta(client, 1, 500);
		// Mock server sends 3 frames per subscription
		expect(result.frameCount).toBeGreaterThanOrEqual(3);
	});
});
