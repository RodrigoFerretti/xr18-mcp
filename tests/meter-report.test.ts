import { describe, expect, it } from "vitest";
import { formatMeterReport, METER_STREAM_IDS, meterSlots } from "../src/meter-report.js";
import type { MeterCapture } from "../src/meters.js";
import { NameRegistry } from "../src/name-registry.js";

function capture(streamId: number, values: number[], mins?: number[]): MeterCapture {
	return {
		streamId,
		frameCount: 10,
		count: values.length,
		peaks: values,
		mins: mins ?? values,
		averages: values.map((v) => v - 1),
	};
}

describe("meterSlots", () => {
	it("matches the stream sizes verified on the MR18 and names known channels", () => {
		const registry = new NameRegistry();
		registry.assignName("channel", 1, "Kick");
		registry.assignName("bus", 2, "IEM");
		const inputs = meterSlots("inputs", registry);
		const strips = meterSlots("strips", registry);
		const gr = meterSlots("gain_reduction", registry);
		expect(inputs).toHaveLength(36);
		expect(strips).toHaveLength(40);
		expect(gr).toHaveLength(39);
		expect(inputs[0].label).toBe('In 1 "Kick"');
		expect(inputs[16].label).toBe("Aux in L");
		expect(inputs[18].label).toBe("USB in 1");
		expect(strips[0].label).toBe('Ch 1 "Kick"');
		expect(strips[18].label).toBe("FX return 1 L");
		expect(strips[27].label).toBe('Bus 2 "IEM"');
		expect(strips[32].label).toBe("FX send 1");
		expect(strips[36].label).toBe("Main L");
		expect(strips[39].label).toBe("Monitor R");
		expect(gr[14].label).toBe("Ch 15 gate");
		expect(gr[31].label).toBe("Ch 16 comp");
		expect(gr[33].label).toBe('Bus 2 "IEM" comp');
		expect(gr[38].label).toBe("Main comp");
	});
});

describe("formatMeterReport", () => {
	const registry = new NameRegistry();

	it("lists slots with signal and summarises silent ones", () => {
		const values = new Array(36).fill(-128);
		values[0] = -18.4;
		values[1] = -30;
		values[16] = -60;
		const text = formatMeterReport(
			"inputs",
			capture(METER_STREAM_IDS.inputs, values),
			registry,
			{
				durationSeconds: 3,
			},
		);
		expect(text).toContain("inputs meters: 10 frames over 3s (/meters/2)");
		expect(text).toContain("In 1                      |    -18.4  |   -19.4");
		expect(text).toContain("Aux in L                  |    -60.0  |   -61.0");
		expect(text).toContain("No signal: In 3, In 4");
		expect(text).toContain("USB in 18");
	});

	it("filters to the requested channels", () => {
		const values = new Array(40).fill(-20);
		const text = formatMeterReport(
			"strips",
			capture(METER_STREAM_IDS.strips, values),
			registry,
			{
				channels: [2],
				durationSeconds: 1,
			},
		);
		expect(text).toContain("Ch 2 ");
		expect(text).not.toContain("Ch 1 ");
		expect(text).not.toContain("Main L");
	});

	it("shows only slots with gain reduction, using the deepest value", () => {
		const peaks = new Array(39).fill(0);
		const mins = new Array(39).fill(0);
		mins[14] = -38.9;
		mins[33] = -12;
		const text = formatMeterReport(
			"gain_reduction",
			capture(METER_STREAM_IDS.gain_reduction, peaks, mins),
			registry,
			{ durationSeconds: 2 },
		);
		expect(text).toContain("Ch 15 gate                |  -38.9  |");
		expect(text).toContain("Bus 2 comp                |  -12.0  |");
		expect(text).toContain("37 other slots at 0 dB");
	});

	it("warns when the value count does not match the known layout", () => {
		const text = formatMeterReport("strips", capture(1, new Array(10).fill(-128)), registry, {
			durationSeconds: 1,
		});
		expect(text).toContain("Warning: expected 40 values");
	});

	it("reports no data when no frame arrived", () => {
		const empty: MeterCapture = {
			streamId: 1,
			frameCount: 0,
			count: 0,
			peaks: [],
			mins: [],
			averages: [],
		};
		expect(formatMeterReport("strips", empty, registry, { durationSeconds: 1 })).toContain(
			"No meter data received",
		);
	});
});
