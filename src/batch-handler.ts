import type { Command } from "./batch-schema.js";
import type { NameRegistry } from "./name-registry.js";
import type { OscClient } from "./osc-client.js";
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
			client.send(xair.chEqBand(ch, cmd.band, "f"), {
				type: "float",
				value: xair.eqFreqToFloat(cmd.frequency_hz),
			});
			client.send(xair.chEqBand(ch, cmd.band, "g"), {
				type: "float",
				value: xair.eqGainToFloat(cmd.gain_db),
			});
			client.send(xair.chEqBand(ch, cmd.band, "q"), {
				type: "float",
				value: xair.eqQToFloat(cmd.q),
			});
			return `Ch ${ch} EQ band ${cmd.band}: ${cmd.frequency_hz}Hz ${cmd.gain_db}dB Q=${cmd.q}`;
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
		case "send_raw_osc": {
			if (cmd.args && cmd.args.length > 0) {
				const oscArgs = cmd.args.map((a) =>
					typeof a === "number"
						? { type: "float" as const, value: a }
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
