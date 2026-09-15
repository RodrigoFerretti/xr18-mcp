import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeBatch } from "../src/batch-handler.js";
import type { Command } from "../src/batch-schema.js";
import { NameRegistry } from "../src/name-registry.js";
import type { OscClient } from "../src/osc-client.js";
import * as xair from "../src/xair.js";

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

	it("handles set_channel_preamp with partial updates and ordering", () => {
		const commands: Command[] = [
			{
				action: "set_channel_preamp",
				channel: 2,
				phantom: true,
				polarity_inverted: true,
				low_cut_enabled: true,
				low_cut_hz: Math.sqrt(20 * 400),
				usb_return: false,
			},
		];

		const results = executeBatch(commands, client, registry);
		expect(results[0].status).toBe("ok");
		expect(results[0].message).toBe(
			"Ch 2 preamp: phantom on, polarity inverted, low cut 89.44271909999159 Hz, low cut on, input analog",
		);
		expect(client.send).toHaveBeenCalledWith("/headamp/02/phantom", {
			type: "integer",
			value: 1,
		});
		expect(client.send).toHaveBeenCalledWith("/ch/02/preamp/invert", {
			type: "integer",
			value: 1,
		});
		expect(client.send).toHaveBeenCalledWith("/ch/02/preamp/hpf", {
			type: "float",
			value: expect.closeTo(0.5, 4),
		});
		expect(client.send).toHaveBeenCalledWith("/ch/02/preamp/hpon", {
			type: "integer",
			value: 1,
		});
		expect(client.send).toHaveBeenCalledWith("/ch/02/preamp/rtnsw", {
			type: "integer",
			value: 0,
		});

		// hpf frequency is sent before hpon so the filter never switches on at a stale frequency
		const calls = (client.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
		expect(calls.indexOf("/ch/02/preamp/hpf")).toBeLessThan(
			calls.indexOf("/ch/02/preamp/hpon"),
		);
	});

	it("refuses phantom on the aux return but allows its other preamp fields", () => {
		const results = executeBatch(
			[
				{ action: "set_channel_preamp", channel: 17, phantom: true },
				{ action: "set_channel_preamp", channel: 17, usb_return: true },
				{ action: "set_channel_preamp", channel: 1 },
			],
			client,
			registry,
		);
		expect(results[0].status).toBe("error");
		expect(results[0].message).toContain("Phantom power");
		expect(results[1].status).toBe("ok");
		expect(client.send).toHaveBeenCalledWith("/rtn/aux/preamp/rtnsw", {
			type: "integer",
			value: 1,
		});
		expect(results[2].status).toBe("error");
		expect(results[2].message).toContain("no preamp parameters");
	});

	it("handles set_headamp_gain", () => {
		const results = executeBatch(
			[
				{ action: "set_headamp_gain", channel: 3, gain_db: 24 },
				{ action: "set_headamp_gain", channel: 17, gain_db: 0 },
			],
			client,
			registry,
		);
		expect(results[0].message).toBe("Ch 3 headamp gain -> 24 dB");
		expect(client.send).toHaveBeenCalledWith("/headamp/03/gain", {
			type: "float",
			value: expect.closeTo(0.5, 4),
		});
		expect(results[1].status).toBe("error");
		expect(results[1].message).toContain("Headamp channel must be 1-16");
	});

	it("sets an EQ band type on its own and errors on an empty EQ command", () => {
		const results = executeBatch(
			[
				{
					action: "set_channel_eq",
					channel: 1,
					band: 1,
					type: "low_cut",
					frequency_hz: 80,
				},
				{ action: "set_channel_eq", channel: 1, band: 4, type: "high_shelf" },
				{ action: "set_channel_eq", channel: 1, band: 2 },
			],
			client,
			registry,
		);
		expect(results[0].message).toBe("Ch 1 EQ band 1: low_cut 80Hz");
		expect(client.send).toHaveBeenCalledWith("/ch/01/eq/1/type", { type: "integer", value: 0 });
		expect(client.send).toHaveBeenCalledWith("/ch/01/eq/1/f", {
			type: "float",
			value: expect.closeTo(xair.eqFreqToFloat(80), 5),
		});
		expect(client.send).toHaveBeenCalledWith("/ch/01/eq/4/type", { type: "integer", value: 4 });
		expect(results[2].status).toBe("error");
		expect(results[2].message).toContain("no EQ parameters");
		expect(client.send).toHaveBeenCalledTimes(3);
	});

	it("handles pan, LR assign, FX send level and send tap", () => {
		const results = executeBatch(
			[
				{ action: "set_channel_pan", channel: 1, pan: -50 },
				{ action: "set_channel_pan", channel: 1, pan: 0 },
				{ action: "set_channel_lr_assign", channel: 2, enabled: false },
				{ action: "set_channel_fx_send_level", channel: 3, fx_slot: 2, level_db: -20 },
				{ action: "set_channel_send_tap", channel: 4, bus: 1, tap: "pre_fader" },
			],
			client,
			registry,
		);
		expect(results.map((r) => r.message)).toEqual([
			"Ch 1 pan -> L50",
			"Ch 1 pan -> center",
			"Ch 2 removed from main LR",
			"Ch 3 -> FX 2 send -> -20 dB",
			"Ch 4 -> Bus 1 send tap -> pre_fader",
		]);
		expect(client.send).toHaveBeenCalledWith("/ch/01/mix/pan", {
			type: "float",
			value: expect.closeTo(0.25, 4),
		});
		expect(client.send).toHaveBeenCalledWith("/ch/02/mix/lr", { type: "integer", value: 0 });
		expect(client.send).toHaveBeenCalledWith("/ch/03/mix/08/level", {
			type: "float",
			value: expect.closeTo(xair.dbToFader(-20), 5),
		});
		expect(client.send).toHaveBeenCalledWith("/ch/04/mix/01/tap", {
			type: "integer",
			value: 3,
		});
	});

	it("names and colors a channel, updating the registry first", () => {
		registry.assignName("channel", 9, "Vox");
		const results = executeBatch(
			[
				{
					action: "set_channel_config",
					channel: 1,
					name: "Kick",
					color: "red",
					color_inverted: true,
				},
				{ action: "set_channel_config", channel: 2, name: "Vox" },
				{ action: "set_channel_config", channel: "Kick", color: "blue" },
				{ action: "set_channel_config", channel: 3 },
			],
			client,
			registry,
		);
		expect(results[0].message).toBe('Ch 1 config: name "Kick", color red (inverted)');
		expect(client.send).toHaveBeenCalledWith("/ch/01/config/name", {
			type: "string",
			value: "Kick",
		});
		expect(client.send).toHaveBeenCalledWith("/ch/01/config/color", {
			type: "integer",
			value: 9,
		});
		// duplicate name is refused and nothing is sent for it
		expect(results[1].status).toBe("error");
		expect(results[1].message).toContain("already assigned");
		expect(client.send).not.toHaveBeenCalledWith("/ch/02/config/name", expect.anything());
		// the new name resolves immediately
		expect(results[2].message).toBe("Ch 1 config: color blue");
		expect(results[3].status).toBe("error");
	});

	it("names and colors a bus", () => {
		const results = executeBatch(
			[{ action: "set_bus_config", bus: 2, name: "Wedges", color: "green" }],
			client,
			registry,
		);
		expect(results[0].message).toBe('Bus 2 config: name "Wedges", color green');
		expect(client.send).toHaveBeenCalledWith("/bus/2/config/name", {
			type: "string",
			value: "Wedges",
		});
		expect(client.send).toHaveBeenCalledWith("/bus/2/config/color", {
			type: "integer",
			value: 2,
		});
		expect(registry.resolve("bus", "wedges")).toBe(2);
	});

	it("handles bus and main parametric EQ, on/off and mode", () => {
		registry.assignName("bus", 1, "Wedges");
		const results = executeBatch(
			[
				{
					action: "set_bus_eq",
					bus: "Wedges",
					band: 6,
					type: "high_cut",
					frequency_hz: 12000,
				},
				{ action: "set_main_eq", band: 1, type: "low_cut", frequency_hz: 35 },
				{ action: "set_bus_eq_on", bus: 1, enabled: true },
				{ action: "set_main_eq_on", enabled: false },
				{ action: "set_bus_eq_mode", bus: 2, mode: "geq" },
				{ action: "set_main_eq_mode", mode: "peq" },
				{ action: "set_main_eq", band: 7, gain_db: 1 },
				{ action: "set_bus_eq", bus: 1, band: 2 },
			],
			client,
			registry,
		);
		expect(results.slice(0, 6).map((r) => r.message)).toEqual([
			"Bus 1 EQ band 6: high_cut 12000Hz",
			"Main EQ band 1: low_cut 35Hz",
			"Bus 1 EQ on",
			"Main EQ off",
			"Bus 2 EQ mode -> geq",
			"Main EQ mode -> peq",
		]);
		expect(client.send).toHaveBeenCalledWith("/bus/1/eq/6/type", { type: "integer", value: 5 });
		expect(client.send).toHaveBeenCalledWith("/lr/eq/1/f", {
			type: "float",
			value: expect.closeTo(xair.eqFreqToFloat(35), 5),
		});
		expect(client.send).toHaveBeenCalledWith("/bus/1/eq/on", { type: "integer", value: 1 });
		expect(client.send).toHaveBeenCalledWith("/lr/eq/on", { type: "integer", value: 0 });
		expect(client.send).toHaveBeenCalledWith("/bus/2/eq/mode", { type: "integer", value: 1 });
		expect(client.send).toHaveBeenCalledWith("/lr/eq/mode", { type: "integer", value: 0 });
		expect(results[6].status).toBe("error");
		expect(results[6].message).toContain("Bus/main EQ band must be 1-6");
		expect(results[7].status).toBe("error");
		expect(results[7].message).toContain("no EQ parameters");
	});

	it("handles bus and main GEQ", () => {
		const results = executeBatch(
			[
				{
					action: "set_bus_geq",
					bus: 3,
					bands: [{ frequency_hz: 315, gain_db: -3 }],
				},
				{
					action: "set_main_geq",
					bands: [{ frequency_hz: 8000, gain_db: 2 }],
					reset_others: true,
				},
			],
			client,
			registry,
		);
		expect(results[0].message).toBe("Bus 3 GEQ: 315 Hz -3 dB");
		expect(results[1].message).toBe("Main GEQ: 30 other bands reset to 0 dB, 8 kHz +2 dB");
		expect(client.send).toHaveBeenCalledWith("/bus/3/geq/315", {
			type: "float",
			value: expect.closeTo(xair.geqGainToFloat(-3), 6),
		});
		expect(client.send).toHaveBeenCalledWith("/lr/geq/8k", {
			type: "float",
			value: expect.closeTo(xair.geqGainToFloat(2), 6),
		});
		expect(client.send).toHaveBeenCalledTimes(1 + 31);
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
