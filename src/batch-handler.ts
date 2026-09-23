import type { Command } from "./batch-schema.js";
import { applyCompressor, applyGate } from "./dynamics.js";
import type { NameRegistry } from "./name-registry.js";
import type { OscClient } from "./osc-client.js";
import {
	applyEqBand,
	applyGeq,
	applyOutputEqMode,
	applyOutputEqOn,
	eqBandAddress,
	type OutputTarget,
	outputLabel,
} from "./output-eq.js";
import { eqModeToIndex, sendTapToIndex } from "./strip.js";
import * as xair from "./xair.js";

export interface CommandResult {
	index: number;
	status: "ok" | "error";
	message: string;
}

function resolveChannel(registry: NameRegistry, ref: string | number): number {
	const ch = registry.resolve("channel", ref);
	xair.validateChannel(ch);
	return ch;
}

function resolveBus(registry: NameRegistry, ref: string | number): number {
	const b = registry.resolve("bus", ref);
	xair.validateBus(b);
	return b;
}

function dispatchOne(cmd: Command, client: OscClient, registry: NameRegistry): string {
	switch (cmd.action) {
		case "set_channel_fader": {
			const ch = resolveChannel(registry, cmd.channel);
			const fader = xair.dbToFader(cmd.level_db);
			client.send(xair.chFader(ch), { type: "float", value: fader });
			return `Ch ${ch} fader -> ${cmd.level_db} dB`;
		}
		case "set_channel_mute": {
			const ch = resolveChannel(registry, cmd.channel);
			client.send(xair.chMute(ch), { type: "integer", value: cmd.muted ? 0 : 1 });
			return `Ch ${ch} ${cmd.muted ? "muted" : "unmuted"}`;
		}
		case "set_channel_send_level": {
			const ch = resolveChannel(registry, cmd.channel);
			const bus = resolveBus(registry, cmd.bus);
			const fader = xair.dbToFader(cmd.level_db);
			client.send(xair.chSendLevel(ch, bus), { type: "float", value: fader });
			return `Ch ${ch} -> Bus ${bus} send -> ${cmd.level_db} dB`;
		}
		case "set_channel_eq": {
			const ch = resolveChannel(registry, cmd.channel);
			xair.validateEqBand(cmd.band);
			const parts = applyEqBand(client, (param) => xair.chEqBand(ch, cmd.band, param), cmd);
			if (parts.length === 0) throw new Error("set_channel_eq: no EQ parameters given");
			return `Ch ${ch} EQ band ${cmd.band}: ${parts.join(" ")}`;
		}
		case "set_bus_eq":
		case "set_main_eq": {
			const target: OutputTarget =
				cmd.action === "set_bus_eq"
					? { kind: "bus", bus: resolveBus(registry, cmd.bus) }
					: { kind: "main" };
			xair.validateBusEqBand(cmd.band);
			const parts = applyEqBand(
				client,
				(param) => eqBandAddress(target, cmd.band, param),
				cmd,
			);
			if (parts.length === 0) throw new Error(`${cmd.action}: no EQ parameters given`);
			return `${outputLabel(target)} EQ band ${cmd.band}: ${parts.join(" ")}`;
		}
		case "set_bus_eq_on":
		case "set_main_eq_on": {
			const target: OutputTarget =
				cmd.action === "set_bus_eq_on"
					? { kind: "bus", bus: resolveBus(registry, cmd.bus) }
					: { kind: "main" };
			return applyOutputEqOn(client, target, cmd.enabled);
		}
		case "set_bus_eq_mode":
		case "set_main_eq_mode": {
			const target: OutputTarget =
				cmd.action === "set_bus_eq_mode"
					? { kind: "bus", bus: resolveBus(registry, cmd.bus) }
					: { kind: "main" };
			applyOutputEqMode(client, target, eqModeToIndex(cmd.mode));
			return `${outputLabel(target)} EQ mode -> ${cmd.mode}`;
		}
		case "set_bus_geq":
		case "set_main_geq": {
			const target: OutputTarget =
				cmd.action === "set_bus_geq"
					? { kind: "bus", bus: resolveBus(registry, cmd.bus) }
					: { kind: "main" };
			const parts = applyGeq(client, target, cmd.bands, cmd.reset_others ?? false);
			return `${outputLabel(target)} GEQ: ${parts.join(", ")}`;
		}
		case "set_channel_eq_on": {
			const ch = resolveChannel(registry, cmd.channel);
			client.send(xair.chEqOn(ch), { type: "integer", value: cmd.enabled ? 1 : 0 });
			return `Ch ${ch} EQ ${cmd.enabled ? "on" : "off"}`;
		}
		case "set_bus_fader": {
			const bus = resolveBus(registry, cmd.bus);
			const fader = xair.dbToFader(cmd.level_db);
			client.send(xair.busFader(bus), { type: "float", value: fader });
			return `Bus ${bus} fader -> ${cmd.level_db} dB`;
		}
		case "set_bus_mute": {
			const bus = resolveBus(registry, cmd.bus);
			client.send(xair.busMute(bus), { type: "integer", value: cmd.muted ? 0 : 1 });
			return `Bus ${bus} ${cmd.muted ? "muted" : "unmuted"}`;
		}
		case "set_main_fader": {
			const fader = xair.dbToFader(cmd.level_db);
			client.send(xair.mainFader(), { type: "float", value: fader });
			return `Main fader -> ${cmd.level_db} dB`;
		}
		case "set_main_mute": {
			client.send(xair.mainMute(), { type: "integer", value: cmd.muted ? 0 : 1 });
			return `Main ${cmd.muted ? "muted" : "unmuted"}`;
		}
		case "set_fx_send_fader": {
			xair.validateFxSlot(cmd.fx_slot);
			const fader = xair.dbToFader(cmd.level_db);
			client.send(xair.fxSendFader(cmd.fx_slot), { type: "float", value: fader });
			return `FX send ${cmd.fx_slot} -> ${cmd.level_db} dB`;
		}
		case "set_fx_send_mute": {
			xair.validateFxSlot(cmd.fx_slot);
			client.send(xair.fxSendMute(cmd.fx_slot), {
				type: "integer",
				value: cmd.muted ? 0 : 1,
			});
			return `FX send ${cmd.fx_slot} ${cmd.muted ? "muted" : "unmuted"}`;
		}
		case "set_fx_return_fader": {
			xair.validateFxReturn(cmd.fx_return);
			const fader = xair.dbToFader(cmd.level_db);
			client.send(xair.fxReturnFader(cmd.fx_return), { type: "float", value: fader });
			return `FX return ${cmd.fx_return} -> ${cmd.level_db} dB`;
		}
		case "set_fx_return_mute": {
			xair.validateFxReturn(cmd.fx_return);
			client.send(xair.fxReturnMute(cmd.fx_return), {
				type: "integer",
				value: cmd.muted ? 0 : 1,
			});
			return `FX return ${cmd.fx_return} ${cmd.muted ? "muted" : "unmuted"}`;
		}
		case "set_fx_return_send_level": {
			xair.validateFxReturn(cmd.fx_return);
			const bus = resolveBus(registry, cmd.bus);
			const fader = xair.dbToFader(cmd.level_db);
			client.send(xair.fxReturnSendLevel(cmd.fx_return, bus), {
				type: "float",
				value: fader,
			});
			return `FX return ${cmd.fx_return} -> Bus ${bus} send -> ${cmd.level_db} dB`;
		}
		case "set_channel_preamp_trim": {
			const ch = resolveChannel(registry, cmd.channel);
			const trimFloat = xair.trimDbToFloat(cmd.trim_db);
			client.send(xair.chPreampTrim(ch), { type: "float", value: trimFloat });
			return `Ch ${ch} preamp trim -> ${cmd.trim_db} dB`;
		}
		case "set_channel_preamp": {
			const ch = resolveChannel(registry, cmd.channel);
			const parts: string[] = [];
			if (ch > xair.NUM_INPUT_CHANNELS) {
				if (cmd.phantom !== undefined) {
					throw new Error("Phantom power is only available on input channels 1-16");
				}
				if (
					cmd.polarity_inverted !== undefined ||
					cmd.low_cut_enabled !== undefined ||
					cmd.low_cut_hz !== undefined
				) {
					throw new Error("The aux return has no polarity or low-cut controls");
				}
			}
			if (cmd.phantom !== undefined) {
				client.send(xair.headampPhantom(ch), {
					type: "integer",
					value: cmd.phantom ? 1 : 0,
				});
				parts.push(`phantom ${cmd.phantom ? "on" : "off"}`);
			}
			if (cmd.polarity_inverted !== undefined) {
				client.send(xair.chPreamp(ch, "invert"), {
					type: "integer",
					value: cmd.polarity_inverted ? 1 : 0,
				});
				parts.push(`polarity ${cmd.polarity_inverted ? "inverted" : "normal"}`);
			}
			if (cmd.low_cut_hz !== undefined) {
				client.send(xair.chPreamp(ch, "hpf"), {
					type: "float",
					value: xair.hpfToFloat(cmd.low_cut_hz),
				});
				parts.push(`low cut ${cmd.low_cut_hz} Hz`);
			}
			if (cmd.low_cut_enabled !== undefined) {
				client.send(xair.chPreamp(ch, "hpon"), {
					type: "integer",
					value: cmd.low_cut_enabled ? 1 : 0,
				});
				parts.push(`low cut ${cmd.low_cut_enabled ? "on" : "off"}`);
			}
			if (cmd.usb_return !== undefined) {
				client.send(xair.chPreamp(ch, "rtnsw"), {
					type: "integer",
					value: cmd.usb_return ? 1 : 0,
				});
				parts.push(`input ${cmd.usb_return ? "USB return" : "analog"}`);
			}
			if (parts.length === 0)
				throw new Error("set_channel_preamp: no preamp parameters given");
			return `Ch ${ch} preamp: ${parts.join(", ")}`;
		}
		case "set_headamp_gain": {
			const ch = resolveChannel(registry, cmd.channel);
			client.send(xair.headampGain(ch), {
				type: "float",
				value: xair.headampGainDbToFloat(cmd.gain_db),
			});
			return `Ch ${ch} headamp gain -> ${cmd.gain_db} dB`;
		}
		case "set_channel_pan": {
			const ch = resolveChannel(registry, cmd.channel);
			client.send(xair.chPan(ch), { type: "float", value: xair.panToFloat(cmd.pan) });
			const where =
				cmd.pan === 0 ? "center" : cmd.pan < 0 ? `L${Math.abs(cmd.pan)}` : `R${cmd.pan}`;
			return `Ch ${ch} pan -> ${where}`;
		}
		case "set_channel_lr_assign": {
			const ch = resolveChannel(registry, cmd.channel);
			client.send(xair.chLrAssign(ch), { type: "integer", value: cmd.enabled ? 1 : 0 });
			return `Ch ${ch} ${cmd.enabled ? "assigned to" : "removed from"} main LR`;
		}
		case "set_channel_fx_send_level": {
			const ch = resolveChannel(registry, cmd.channel);
			xair.validateFxSlot(cmd.fx_slot);
			const fader = xair.dbToFader(cmd.level_db);
			client.send(xair.chFxSendLevel(ch, cmd.fx_slot), { type: "float", value: fader });
			return `Ch ${ch} -> FX ${cmd.fx_slot} send -> ${cmd.level_db} dB`;
		}
		case "set_channel_send_tap": {
			const ch = resolveChannel(registry, cmd.channel);
			const bus = resolveBus(registry, cmd.bus);
			client.send(xair.chSendTap(ch, bus), {
				type: "integer",
				value: sendTapToIndex(cmd.tap),
			});
			return `Ch ${ch} -> Bus ${bus} send tap -> ${cmd.tap}`;
		}
		case "set_channel_config": {
			const ch = resolveChannel(registry, cmd.channel);
			const parts: string[] = [];
			if (cmd.name !== undefined) {
				// Registry first: it rejects a name that already belongs to another channel
				registry.assignName("channel", ch, cmd.name);
				client.send(xair.chConfigName(ch), { type: "string", value: cmd.name });
				parts.push(`name "${cmd.name}"`);
			}
			if (cmd.color !== undefined) {
				const idx = xair.colorToIndex(cmd.color, cmd.color_inverted ?? false);
				client.send(xair.chConfigColor(ch), { type: "integer", value: idx });
				parts.push(`color ${xair.colorLabel(idx)}`);
			}
			if (parts.length === 0) throw new Error("set_channel_config: no name or color given");
			return `Ch ${ch} config: ${parts.join(", ")}`;
		}
		case "set_bus_config": {
			const bus = resolveBus(registry, cmd.bus);
			const parts: string[] = [];
			if (cmd.name !== undefined) {
				registry.assignName("bus", bus, cmd.name);
				client.send(xair.busConfigName(bus), { type: "string", value: cmd.name });
				parts.push(`name "${cmd.name}"`);
			}
			if (cmd.color !== undefined) {
				const idx = xair.colorToIndex(cmd.color, cmd.color_inverted ?? false);
				client.send(xair.busConfigColor(bus), { type: "integer", value: idx });
				parts.push(`color ${xair.colorLabel(idx)}`);
			}
			if (parts.length === 0) throw new Error("set_bus_config: no name or color given");
			return `Bus ${bus} config: ${parts.join(", ")}`;
		}
		case "set_channel_gate": {
			const ch = resolveChannel(registry, cmd.channel);
			xair.validateDynamicsChannel(ch);
			const parts = applyGate(client, (param) => xair.chGate(ch, param), registry, cmd);
			if (parts.length === 0) throw new Error("set_channel_gate: no gate parameters given");
			return `Ch ${ch} gate: ${parts.join(", ")}`;
		}
		case "set_channel_compressor": {
			const ch = resolveChannel(registry, cmd.channel);
			xair.validateDynamicsChannel(ch);
			const parts = applyCompressor(client, (param) => xair.chDyn(ch, param), registry, cmd);
			if (parts.length === 0) {
				throw new Error("set_channel_compressor: no compressor parameters given");
			}
			return `Ch ${ch} comp: ${parts.join(", ")}`;
		}
		case "set_bus_compressor": {
			const bus = resolveBus(registry, cmd.bus);
			const parts = applyCompressor(
				client,
				(param) => xair.busDyn(bus, param),
				registry,
				cmd,
			);
			if (parts.length === 0)
				throw new Error("set_bus_compressor: no compressor parameters given");
			return `Bus ${bus} comp: ${parts.join(", ")}`;
		}
		case "set_main_compressor": {
			const parts = applyCompressor(client, (param) => xair.lrDyn(param), registry, cmd);
			if (parts.length === 0)
				throw new Error("set_main_compressor: no compressor parameters given");
			return `Main comp: ${parts.join(", ")}`;
		}
		case "send_raw_osc": {
			if (cmd.args && cmd.args.length > 0) {
				const oscArgs = cmd.args.map((a) =>
					typeof a === "number"
						? Number.isInteger(a)
							? { type: "integer" as const, value: a }
							: { type: "float" as const, value: a }
						: { type: "string" as const, value: a },
				);
				client.send(cmd.address, ...oscArgs);
			} else {
				client.send(cmd.address);
			}
			return `Raw OSC: ${cmd.address} ${cmd.args ?? []}`;
		}
	}
}

export function executeBatch(
	commands: Command[],
	client: OscClient,
	registry: NameRegistry,
): CommandResult[] {
	return commands.map((cmd, index) => {
		try {
			const message = dispatchOne(cmd, client, registry);
			return { index, status: "ok" as const, message };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { index, status: "error" as const, message };
		}
	});
}
