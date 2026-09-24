// Solo switches and the solo/monitor bus.
//
// /-stat/solosw/NN, NN = 01..54 on an MR18 (verified 2026-09-23, matches the
// Bitfocus Companion offsets): 1-16 channels, 17 aux, 18-21 FX returns,
// 22-39 USB returns, 40-45 buses, 46-49 FX sends, 50 main LR, 51-54 DCAs.
// /-stat/solo = 1 while anything is soloed; /-action/clearsolo ,i 1 clears all.

import type { NameRegistry } from "./name-registry.js";
import type { ReadPlan } from "./strip.js";
import * as xair from "./xair.js";

export const NUM_SOLO_SWITCHES = 54;

export const SOLO_ACTIVE = "/-stat/solo";
export const CLEAR_SOLO = "/-action/clearsolo";

/** Solo (monitor/phones) bus configuration. */
export const MONITOR = {
	level: "/config/solo/level", // fader curve, -90..+10 dB
	mute: "/config/solo/mute",
	dim: "/config/solo/dim",
	mono: "/config/solo/mono",
	dimAttenuation: "/config/solo/dimatt", // linear -40..0 dB
} as const;

export const MONITOR_DIM_DB = { min: -40, max: 0 } as const;

export type SoloTarget =
	| { kind: "channel"; n: number }
	| { kind: "aux" }
	| { kind: "fx_return"; n: number }
	| { kind: "usb"; n: number }
	| { kind: "bus"; n: number }
	| { kind: "fx_send"; n: number }
	| { kind: "main" }
	| { kind: "dca" };

const OFFSET = {
	channel: 0,
	aux: 16,
	fx_return: 17,
	usb: 21,
	bus: 39,
	fx_send: 45,
	main: 49,
	dca: 50,
} as const;

export const NUM_USB_RETURNS = 18;
export const NUM_DCAS = 4;

function check(n: number, max: number, what: string): void {
	if (!Number.isInteger(n) || n < 1 || n > max) {
		throw new Error(`${what} must be 1-${max}, got ${n}`);
	}
}

export function soloIndex(target: SoloTarget & { n?: number }): number {
	switch (target.kind) {
		case "channel":
			check(target.n, xair.NUM_INPUT_CHANNELS, "Channel");
			return OFFSET.channel + target.n;
		case "aux":
			return OFFSET.aux + 1;
		case "fx_return":
			check(target.n, xair.NUM_FX_RETURNS, "FX return");
			return OFFSET.fx_return + target.n;
		case "usb":
			check(target.n, NUM_USB_RETURNS, "USB return");
			return OFFSET.usb + target.n;
		case "bus":
			check(target.n, xair.NUM_BUSES, "Bus");
			return OFFSET.bus + target.n;
		case "fx_send":
			check(target.n, xair.NUM_FX_SLOTS, "FX send");
			return OFFSET.fx_send + target.n;
		case "main":
			return OFFSET.main + 1;
		case "dca": {
			const n = (target as { n?: number }).n ?? 0;
			check(n, NUM_DCAS, "DCA");
			return OFFSET.dca + n;
		}
	}
}

/** Human label for a solo switch index, using channel/bus names when known. */
export function soloLabel(index: number, registry?: NameRegistry): string {
	const named = (kind: "channel" | "bus", n: number, fallback: string) => {
		const name = registry?.listNames(kind)[n];
		return name ? `${fallback} "${name}"` : fallback;
	};
	if (index >= 1 && index <= 16) return named("channel", index, `Ch ${index}`);
	if (index === 17) return named("channel", xair.AUX_CHANNEL, "Aux");
	if (index >= 18 && index <= 21) return `FX return ${index - OFFSET.fx_return}`;
	if (index >= 22 && index <= 39) return `USB ${index - OFFSET.usb}`;
	if (index >= 40 && index <= 45)
		return named("bus", index - OFFSET.bus, `Bus ${index - OFFSET.bus}`);
	if (index >= 46 && index <= 49) return `FX send ${index - OFFSET.fx_send}`;
	if (index === 50) return "Main LR";
	if (index >= 51 && index <= 54) return `DCA ${index - OFFSET.dca}`;
	return `?(${index})`;
}

function pad(n: number): string {
	return n.toString().padStart(2, "0");
}

export function soloSwitch(index: number): string {
	check(index, NUM_SOLO_SWITCHES, "Solo switch");
	return `/-stat/solosw/${pad(index)}`;
}

export function soloReadPlan(): ReadPlan {
	const plan: ReadPlan = [{ key: "active", address: SOLO_ACTIVE }];
	for (let i = 1; i <= NUM_SOLO_SWITCHES; i++) {
		plan.push({ key: `sw/${i}`, address: soloSwitch(i) });
	}
	return plan;
}

export function formatSolos(values: Record<string, unknown>, registry?: NameRegistry): string {
	const soloed: string[] = [];
	let unknown = 0;
	for (let i = 1; i <= NUM_SOLO_SWITCHES; i++) {
		const v = values[`sw/${i}`];
		if (v === null || v === undefined) unknown++;
		else if (v === 1 || v === "ON") soloed.push(soloLabel(i, registry));
	}
	const active = values.active;
	const parts: string[] = [];
	if (soloed.length === 0) {
		parts.push(active === 1 ? "solo active but no switch found on" : "nothing soloed");
	} else {
		parts.push(`soloed: ${soloed.join(", ")}`);
	}
	if (unknown > 0) parts.push(`${unknown} switches no reply`);
	return parts.join("; ");
}
