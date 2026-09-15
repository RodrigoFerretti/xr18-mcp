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
			value: expect.closeTo(0.541, 3),
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

	it("handles set_channel_preamp_trim", () => {
		const commands: Command[] = [{ action: "set_channel_preamp_trim", channel: 3, trim_db: 6 }];

		const results = executeBatch(commands, client, registry);
		expect(results[0].status).toBe("ok");
		expect(results[0].message).toContain("Ch 3");
		expect(results[0].message).toContain("6 dB");
		// trim 6 dB: (6 - (-18)) / 36 = 24/36 = 0.6667
		expect(client.send).toHaveBeenCalledWith("/ch/03/preamp/rtntrim", {
			type: "float",
			value: expect.closeTo(0.6667, 3),
		});
	});

	it("handles set_channel_preamp_trim with name resolution", () => {
		registry.assignName("channel", 5, "Kick");
		const commands: Command[] = [
			{ action: "set_channel_preamp_trim", channel: "Kick", trim_db: -6 },
		];

		const results = executeBatch(commands, client, registry);
		expect(results[0].status).toBe("ok");
		expect(results[0].message).toContain("Ch 5");
		expect(client.send).toHaveBeenCalledWith("/ch/05/preamp/rtntrim", {
			type: "float",
			value: expect.closeTo(0.3333, 3),
		});
	});

	it("handles set_channel_gate", () => {
		registry.assignName("channel", 4, "Tom");
		const commands: Command[] = [
			{
				action: "set_channel_gate",
				channel: "Tom",
				enabled: true,
				mode: "gate",
				threshold_db: -40,
				release_ms: 200,
			},
		];

		const results = executeBatch(commands, client, registry);
		expect(results[0].status).toBe("ok");
		expect(results[0].message).toBe("Ch 4 gate: mode gate, thr -40 dB, release 200 ms, on");
		expect(client.send).toHaveBeenCalledWith("/ch/04/gate/mode", { type: "integer", value: 3 });
		expect(client.send).toHaveBeenCalledWith("/ch/04/gate/thr", {
			type: "float",
			value: expect.closeTo(0.5, 4),
		});
		expect(client.send).toHaveBeenCalledWith("/ch/04/gate/on", { type: "integer", value: 1 });
		expect(client.send).toHaveBeenCalledTimes(4);
	});

	it("rejects gate and compressor on the aux return", () => {
		const commands: Command[] = [
			{ action: "set_channel_gate", channel: 17, enabled: true },
			{ action: "set_channel_compressor", channel: 17, enabled: true },
		];

		const results = executeBatch(commands, client, registry);
		expect(results[0].status).toBe("error");
		expect(results[0].message).toContain("aux return");
		expect(results[1].status).toBe("error");
		expect(client.send).not.toHaveBeenCalled();
	});

	it("handles set_channel_compressor and snaps the ratio", () => {
		const commands: Command[] = [
			{ action: "set_channel_compressor", channel: 1, threshold_db: -20, ratio: 3.5 },
		];

		const results = executeBatch(commands, client, registry);
		expect(results[0].status).toBe("ok");
		expect(results[0].message).toBe(
			"Ch 1 comp: thr -20 dB, ratio 4:1 (requested 3.5, snapped to nearest available)",
		);
		expect(client.send).toHaveBeenCalledWith("/ch/01/dyn/ratio", { type: "integer", value: 6 });
	});

	it("handles bus and main compressors", () => {
		registry.assignName("bus", 3, "Drums");
		const commands: Command[] = [
			{ action: "set_bus_compressor", bus: "Drums", threshold_db: -30 },
			{ action: "set_main_compressor", enabled: false },
		];

		const results = executeBatch(commands, client, registry);
		expect(results[0].message).toBe("Bus 3 comp: thr -30 dB");
		expect(results[1].message).toBe("Main comp: off");
		expect(client.send).toHaveBeenCalledWith("/bus/3/dyn/thr", {
			type: "float",
			value: expect.closeTo(0.5, 4),
		});
		expect(client.send).toHaveBeenCalledWith("/lr/dyn/on", { type: "integer", value: 0 });
	});

	it("errors when a dynamics command carries no parameters", () => {
		const commands: Command[] = [
			{ action: "set_channel_gate", channel: 1 },
			{ action: "set_main_compressor" },
		];

		const results = executeBatch(commands, client, registry);
		expect(results[0].status).toBe("error");
		expect(results[0].message).toContain("no gate parameters");
		expect(results[1].status).toBe("error");
		expect(results[1].message).toContain("no compressor parameters");
		expect(client.send).not.toHaveBeenCalled();
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
