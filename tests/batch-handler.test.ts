import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeBatch } from "../src/batch-handler.js";
import type { Command } from "../src/batch-schema.js";
import { NameRegistry } from "../src/name-registry.js";
import type { OscClient } from "../src/osc-client.js";

function mockClient(): OscClient {
	return {
		ip: "192.168.0.9",
		port: 10024,
		connected: true,
		send: vi.fn(),
		query: vi.fn(),
		disconnect: vi.fn(),
	} as unknown as OscClient;
}

describe("executeBatch", () => {
	let client: OscClient;
	let registry: NameRegistry;

	beforeEach(() => {
		client = mockClient();
		registry = new NameRegistry();
	});

	it("executes multiple commands and returns results", () => {
		const commands: Command[] = [
			{ action: "set_channel_fader", channel: 1, level_db: 0 },
			{ action: "set_channel_fader", channel: 2, level_db: -10 },
		];

		const results = executeBatch(commands, client, registry);
		expect(results).toHaveLength(2);
		expect(results[0]).toEqual({
			index: 0,
			status: "ok",
			message: "Ch 1 fader -> 0 dB",
		});
		expect(results[1]).toEqual({
			index: 1,
			status: "ok",
			message: "Ch 2 fader -> -10 dB",
		});
		expect(client.send).toHaveBeenCalledTimes(2);
	});

	it("resolves channel names", () => {
		registry.assignName("channel", 5, "Kick");
		const commands: Command[] = [
			{ action: "set_channel_fader", channel: "Kick", level_db: -5 },
		];

		const results = executeBatch(commands, client, registry);
		expect(results[0].status).toBe("ok");
		expect(results[0].message).toContain("Ch 5");
	});

	it("continues on error", () => {
		const commands: Command[] = [
			{ action: "set_channel_fader", channel: "Unknown", level_db: 0 },
			{ action: "set_main_fader", level_db: 0 },
		];

		const results = executeBatch(commands, client, registry);
		expect(results[0].status).toBe("error");
		expect(results[0].message).toContain("Unknown");
		expect(results[1].status).toBe("ok");
	});

	it("handles mute commands with correct polarity", () => {
		const commands: Command[] = [
			{ action: "set_channel_mute", channel: 1, muted: true },
			{ action: "set_channel_mute", channel: 2, muted: false },
		];

		executeBatch(commands, client, registry);
		// XR18: mix/on=0 means muted, mix/on=1 means unmuted
		expect(client.send).toHaveBeenCalledWith("/ch/01/mix/on", { type: "integer", value: 0 });
		expect(client.send).toHaveBeenCalledWith("/ch/02/mix/on", { type: "integer", value: 1 });
	});

	it("handles bus commands", () => {
		const commands: Command[] = [
			{ action: "set_bus_fader", bus: 3, level_db: -5 },
			{ action: "set_bus_mute", bus: 1, muted: true },
		];

		const results = executeBatch(commands, client, registry);
		expect(results).toHaveLength(2);
		expect(results.every((r) => r.status === "ok")).toBe(true);
	});

	it("handles channel send to bus", () => {
		registry.assignName("channel", 1, "Kick");
		registry.assignName("bus", 2, "Drums");
		const commands: Command[] = [
			{
				action: "set_channel_send_level",
				channel: "Kick",
				bus: "Drums",
				level_db: -10,
			},
		];

		const results = executeBatch(commands, client, registry);
		expect(results[0].status).toBe("ok");
		expect(results[0].message).toContain("Ch 1 -> Bus 2");
	});

	it("handles EQ commands with normalized float values", () => {
		const commands: Command[] = [
			{
				action: "set_channel_eq",
				channel: 1,
				band: 2,
				frequency_hz: 1000,
				gain_db: 3,
				q: 1.5,
			},
		];

		executeBatch(commands, client, registry);
		// EQ sends 3 messages: freq, gain, Q
		expect(client.send).toHaveBeenCalledTimes(3);
		// Frequency: log10(1000/20) / log10(20000/20) ≈ 0.5663
		expect(client.send).toHaveBeenCalledWith("/ch/01/eq/2/f", {
			type: "float",
			value: expect.closeTo(0.5663, 3),
		});
		// Gain: (3 + 15) / 30 = 0.6
		expect(client.send).toHaveBeenCalledWith("/ch/01/eq/2/g", {
			type: "float",
			value: expect.closeTo(0.6, 5),
		});
		// Q: log10(10/1.5) / log10(10/0.3) ≈ 0.5410
		expect(client.send).toHaveBeenCalledWith("/ch/01/eq/2/q", {
			type: "float",
			value: expect.closeTo(0.5410, 3),
		});
	});

	it("handles FX return commands", () => {
		const commands: Command[] = [
			{ action: "set_fx_return_fader", fx_return: 1, level_db: 0 },
			{ action: "set_fx_return_mute", fx_return: 2, muted: false },
			{
				action: "set_fx_return_send_level",
				fx_return: 1,
				bus: 3,
				level_db: -15,
			},
		];

		const results = executeBatch(commands, client, registry);
		expect(results.every((r) => r.status === "ok")).toBe(true);
	});

	it("handles channel 17 (aux return) via standard channel commands", () => {
		const commands: Command[] = [
			{ action: "set_channel_fader", channel: 17, level_db: 0 },
			{ action: "set_channel_mute", channel: 17, muted: false },
			{ action: "set_channel_send_level", channel: 17, bus: 2, level_db: -20 },
		];

		const results = executeBatch(commands, client, registry);
		expect(results.every((r) => r.status === "ok")).toBe(true);
		expect(client.send).toHaveBeenCalledWith("/rtn/aux/mix/fader", expect.anything());
		expect(client.send).toHaveBeenCalledWith("/rtn/aux/mix/on", expect.anything());
		expect(client.send).toHaveBeenCalledWith("/rtn/aux/mix/02/level", expect.anything());
	});

	it("handles raw OSC with args", () => {
		const commands: Command[] = [
			{
				action: "send_raw_osc",
				address: "/ch/01/mix/fader",
				args: [0.75],
			},
		];

		executeBatch(commands, client, registry);
		expect(client.send).toHaveBeenCalledWith("/ch/01/mix/fader", {
			type: "float",
			value: 0.75,
		});
	});

	it("handles raw OSC without args", () => {
		const commands: Command[] = [{ action: "send_raw_osc", address: "/xinfo" }];

		executeBatch(commands, client, registry);
		expect(client.send).toHaveBeenCalledWith("/xinfo");
	});
});
