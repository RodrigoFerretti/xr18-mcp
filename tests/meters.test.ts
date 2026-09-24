import { createSocket, type Socket } from "node:dgram";
import { fromBuffer, toBuffer } from "osc-min";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	captureInputMeters,
	captureMeters,
	decodeMeterBlob,
	METER_STREAMS,
} from "../src/meters.js";
import { OscClient } from "../src/osc-client.js";

describe("decodeMeterBlob", () => {
	it("decodes a blob with known values", () => {
		const count = 18;
		const buf = Buffer.alloc(4 + count * 2);
		buf.writeInt32LE(count, 0);

		buf.writeInt16LE(256, 4); // ch 0: 256/256 = 1.0 dB
		buf.writeInt16LE(-512, 6); // ch 1: -512/256 = -2.0 dB
		buf.writeInt16LE(0, 8); // ch 2: 0/256 = 0.0 dB
		buf.writeInt16LE(-2560, 10); // ch 3: -2560/256 = -10.0 dB

		const levels = decodeMeterBlob(buf);
		expect(levels).toHaveLength(count);
		expect(levels[0]).toBe(1.0);
		expect(levels[1]).toBe(-2.0);
		expect(levels[2]).toBe(0.0);
		expect(levels[3]).toBe(-10.0);
	});

	it("throws on zero or negative count", () => {
		const buf = Buffer.alloc(4);
		buf.writeInt32LE(0, 0);
		expect(() => decodeMeterBlob(buf)).toThrow("Invalid meter blob");
		buf.writeInt32LE(-1, 0);
		expect(() => decodeMeterBlob(buf)).toThrow("Invalid meter blob");
	});
});

describe("captureMeters / captureInputMeters", () => {
	let mockServer: Socket;
	let serverPort: number;
	let client: OscClient;
	let subscriptions: string[];

	function buildMeterBlob(levels: number[]): Buffer {
		const buf = Buffer.alloc(4 + levels.length * 2);
		buf.writeInt32LE(levels.length, 0);
		for (let i = 0; i < levels.length; i++) {
			buf.writeInt16LE(Math.round(levels[i] * 256), 4 + i * 2);
		}
		return buf;
	}

	/** Reply to a /meters subscription with the given frames, spaced 40 ms apart. */
	function serveFrames(frames: number[][]) {
		mockServer.on("message", (msg, rinfo) => {
			const parsed = fromBuffer(msg);
			if (parsed.oscType !== "message" || parsed.address !== "/meters") return;
			const stream = String((parsed.args[0] as { value: string }).value);
			subscriptions.push(stream);
			frames.forEach((frame, i) => {
				setTimeout(() => {
					const oscBuf = toBuffer({
						address: stream,
						args: [{ type: "blob", value: buildMeterBlob(frame) }],
					});
					const bytes = new Uint8Array(
						oscBuf.buffer,
						oscBuf.byteOffset,
						oscBuf.byteLength,
					);
					mockServer.send(bytes, 0, bytes.length, rinfo.port, rinfo.address);
				}, i * 40);
			});
		});
	}

	beforeEach(async () => {
		subscriptions = [];
		mockServer = createSocket("udp4");
		await new Promise<void>((resolve) => {
			mockServer.bind(0, "127.0.0.1", () => {
				serverPort = mockServer.address().port;
				resolve();
			});
		});
		client = new OscClient("127.0.0.1", serverPort);
	});

	afterEach(() => {
		client.disconnect();
		mockServer.close();
	});

	it("subscribes on the client's own socket and tracks peaks and averages", async () => {
		serveFrames([
			[-10, -20, -30, -5],
			[-8, -25, -28, -10],
			[-15, -18, -35, -3],
		]);

		const result = await captureMeters(client, METER_STREAMS.strips, 400);
		expect(subscriptions).toEqual(["/meters/1"]);
		expect(result.streamId).toBe(1);
		expect(result.frameCount).toBe(3);
		expect(result.count).toBe(4);
		expect(result.peaks).toEqual([-8, -18, -28, -3]);
		expect(result.mins).toEqual([-15, -25, -35, -10]);
		expect(result.averages).toEqual([-11, -21, -31, -6]);

		// The client's socket is still usable afterwards: a query round-trips
		mockServer.on("message", (msg, rinfo) => {
			const parsed = fromBuffer(msg);
			if (parsed.oscType === "message" && parsed.address === "/xinfo") {
				const reply = toBuffer({
					address: "/xinfo",
					args: [{ type: "string", value: "ok" }],
				});
				const bytes = new Uint8Array(reply.buffer, reply.byteOffset, reply.byteLength);
				mockServer.send(bytes, 0, bytes.length, rinfo.port, rinfo.address);
			}
		});
		expect(await client.query("/xinfo")).toEqual(["ok"]);
	});

	it("captureInputMeters uses /meters/2 and returns peaks", async () => {
		serveFrames([
			[-10, -20],
			[-12, -18],
		]);
		const result = await captureInputMeters(client, 300);
		expect(subscriptions).toEqual(["/meters/2"]);
		expect(result.frameCount).toBe(2);
		expect(result.peaks).toEqual([-10, -18]);
	});

	it("returns empty peaks when no frames arrive", async () => {
		const result = await captureMeters(client, METER_STREAMS.gainReduction, 200);
		expect(result.frameCount).toBe(0);
		expect(result.count).toBe(0);
		expect(result.peaks).toEqual([]);
	});

	it("ignores frames from other streams", async () => {
		mockServer.on("message", (msg, rinfo) => {
			const parsed = fromBuffer(msg);
			if (parsed.oscType !== "message" || parsed.address !== "/meters") return;
			for (const stream of ["/meters/4", "/meters/1"]) {
				const oscBuf = toBuffer({
					address: stream,
					args: [{ type: "blob", value: buildMeterBlob([-1, -2]) }],
				});
				const bytes = new Uint8Array(oscBuf.buffer, oscBuf.byteOffset, oscBuf.byteLength);
				mockServer.send(bytes, 0, bytes.length, rinfo.port, rinfo.address);
			}
		});
		const result = await captureMeters(client, 1, 200);
		expect(result.frameCount).toBe(1);
	});
});
