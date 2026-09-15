import { createSocket, type Socket } from "node:dgram";
import { toBuffer } from "osc-min";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureInputMeters, decodeInputMeterBlob } from "../src/meters.js";
import type { OscClient } from "../src/osc-client.js";

describe("decodeInputMeterBlob", () => {
	it("decodes a blob with known values", () => {
		const count = 18;
		const buf = Buffer.alloc(4 + count * 2);
		buf.writeInt32LE(count, 0);

		buf.writeInt16LE(256, 4); // ch 0: 256/256 = 1.0 dB
		buf.writeInt16LE(-512, 6); // ch 1: -512/256 = -2.0 dB
		buf.writeInt16LE(0, 8); // ch 2: 0/256 = 0.0 dB
		buf.writeInt16LE(-2560, 10); // ch 3: -2560/256 = -10.0 dB

		const levels = decodeInputMeterBlob(buf);
		expect(levels).toHaveLength(count);
		expect(levels[0]).toBe(1.0);
		expect(levels[1]).toBe(-2.0);
		expect(levels[2]).toBe(0.0);
		expect(levels[3]).toBe(-10.0);
	});

	it("handles variable count", () => {
		const count = 4;
		const buf = Buffer.alloc(4 + count * 2);
		buf.writeInt32LE(count, 0);
		for (let i = 0; i < count; i++) {
			buf.writeInt16LE(-i * 256, 4 + i * 2);
		}

		const levels = decodeInputMeterBlob(buf);
		expect(levels).toHaveLength(4);
		expect(levels[0]).toBe(0);
		expect(levels[1]).toBe(-1);
		expect(levels[2]).toBe(-2);
		expect(levels[3]).toBe(-3);
	});

	it("throws on zero count", () => {
		const buf = Buffer.alloc(4);
		buf.writeInt32LE(0, 0);
		expect(() => decodeInputMeterBlob(buf)).toThrow("Invalid meter blob");
	});

	it("throws on negative count", () => {
		const buf = Buffer.alloc(4);
		buf.writeInt32LE(-1, 0);
		expect(() => decodeInputMeterBlob(buf)).toThrow("Invalid meter blob");
	});
});

describe("captureInputMeters", () => {
	let mockServer: Socket;
	let serverPort: number;
	let client: OscClient;

	function buildMeterBlob(levels: number[]): Buffer {
		const buf = Buffer.alloc(4 + levels.length * 2);
		buf.writeInt32LE(levels.length, 0);
		for (let i = 0; i < levels.length; i++) {
			buf.writeInt16LE(Math.round(levels[i] * 256), 4 + i * 2);
		}
		return buf;
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
	});

	afterEach(() => {
		mockServer.close();
	});

	it("captures and tracks peaks across frames", async () => {
		const frames = [
			[-10, -20, -30, -5], // frame 1
			[-8, -25, -28, -10], // frame 2: ch0 louder, ch2 louder
			[-15, -18, -35, -3], // frame 3: ch1 louder, ch3 louder
		];
		let frameIdx = 0;

		mockServer.on("message", (_msg, rinfo) => {
			const sendFrame = () => {
				if (frameIdx >= frames.length) return;
				const blobData = buildMeterBlob(frames[frameIdx]);
				frameIdx++;
				const oscBuf = toBuffer({
					address: "/meters/2",
					args: [{ type: "blob", value: blobData }],
				});
				const bytes = new Uint8Array(oscBuf.buffer, oscBuf.byteOffset, oscBuf.byteLength);
				mockServer.send(bytes, 0, bytes.length, rinfo.port, rinfo.address);
			};

			sendFrame();
			setTimeout(sendFrame, 50);
			setTimeout(sendFrame, 100);
		});

		const result = await captureInputMeters(client, 500);
		expect(result.frameCount).toBeGreaterThanOrEqual(3);
		expect(result.peaks).toHaveLength(4);

		// Peak across all frames
		expect(result.peaks[0]).toBeCloseTo(-8, 1); // max(-10, -8, -15)
		expect(result.peaks[1]).toBeCloseTo(-18, 1); // max(-20, -25, -18)
		expect(result.peaks[2]).toBeCloseTo(-28, 1); // max(-30, -28, -35)
		expect(result.peaks[3]).toBeCloseTo(-3, 1); // max(-5, -10, -3)
	});

	it("returns empty peaks when no frames received", async () => {
		// Don't set up any mock server response
		const result = await captureInputMeters(client, 200);
		expect(result.frameCount).toBe(0);
		expect(result.peaks).toHaveLength(0);
	});

	it("returns frameCount", async () => {
		mockServer.on("message", (_msg, rinfo) => {
			const blobData = buildMeterBlob([-10, -20]);
			const oscBuf = toBuffer({
				address: "/meters/2",
				args: [{ type: "blob", value: blobData }],
			});
			const bytes = new Uint8Array(oscBuf.buffer, oscBuf.byteOffset, oscBuf.byteLength);

			mockServer.send(bytes, 0, bytes.length, rinfo.port, rinfo.address);
			setTimeout(() => {
				mockServer.send(bytes, 0, bytes.length, rinfo.port, rinfo.address);
			}, 50);
		});

		const result = await captureInputMeters(client, 300);
		expect(result.frameCount).toBeGreaterThanOrEqual(2);
	});
});
