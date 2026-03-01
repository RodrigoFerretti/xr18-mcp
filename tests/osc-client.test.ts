import { createSocket, type Socket } from "node:dgram";
import { fromBuffer, toBuffer } from "osc-min";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OscClient } from "../src/osc-client.js";

describe("OscClient", () => {
	let echoServer: Socket;
	let serverPort: number;

	beforeEach(async () => {
		echoServer = createSocket("udp4");
		await new Promise<void>((resolve) => {
			echoServer.bind(0, "127.0.0.1", () => {
				serverPort = echoServer.address().port;
				resolve();
			});
		});
	});

	afterEach(() => {
		echoServer.close();
	});

	it("sends OSC messages", async () => {
		const received = new Promise<{ address: string; args: unknown[] }>((resolve) => {
			echoServer.on("message", (msg) => {
				const parsed = fromBuffer(msg);
				if (parsed.oscType === "message") {
					resolve({
						address: parsed.address,
						args: parsed.args.map((a) => ("value" in a ? a.value : null)),
					});
				}
			});
		});

		const client = new OscClient("127.0.0.1", serverPort);
		client.send("/ch/01/mix/fader", { type: "float", value: 0.75 });

		const result = await received;
		expect(result.address).toBe("/ch/01/mix/fader");
		expect(result.args[0]).toBeCloseTo(0.75, 4);
		client.disconnect();
	});

	it("queries and receives responses", async () => {
		// Echo server: reply with the address and a float value
		echoServer.on("message", (msg, rinfo) => {
			const parsed = fromBuffer(msg);
			if (parsed.oscType === "message") {
				const reply = toBuffer({
					address: parsed.address,
					args: [{ type: "float", value: 0.5 }],
				});
				const bytes = new Uint8Array(reply.buffer, reply.byteOffset, reply.byteLength);
				echoServer.send(bytes, rinfo.port, rinfo.address);
			}
		});

		const client = new OscClient("127.0.0.1", serverPort);
		const result = await client.query("/ch/01/mix/fader");

		expect(result).not.toBeNull();
		expect(result?.[0]).toBeCloseTo(0.5, 4);
		client.disconnect();
	});

	it("returns null on query timeout", async () => {
		// No echo server response
		const client = new OscClient("127.0.0.1", serverPort);
		const result = await client.query("/ch/01/mix/fader", 100);
		expect(result).toBeNull();
		client.disconnect();
	});

	it("throws when disconnected", () => {
		const client = new OscClient("127.0.0.1", serverPort);
		client.disconnect();
		expect(() => client.send("/test")).toThrow("Not connected");
	});
});
