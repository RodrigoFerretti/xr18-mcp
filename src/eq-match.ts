export interface EqBandConfig {
	frequency: number;
	gain: number;
	q: number;
}

export interface EqMatchOptions {
	numBands?: number;
	maxGainDb?: number;
	minQ?: number;
	maxQ?: number;
	sampleRate?: number;
	lowCutHz?: number;
	highCutHz?: number;
}

export interface EqMatchResult {
	bands: EqBandConfig[];
	errorBefore: number;
	errorAfter: number;
}

const DEFAULT_NUM_BANDS = 4;
const DEFAULT_MAX_GAIN_DB = 15;
const DEFAULT_MIN_Q = 0.3;
const DEFAULT_MAX_Q = 10;
const DEFAULT_SAMPLE_RATE = 48000;

/**
 * Compute the magnitude response (in dB) of a parametric EQ bell filter
 * at an array of frequencies. Uses the Audio EQ Cookbook biquad formula.
 */
export function peqMagnitudeDbArray(
	frequencies: number[],
	fc: number,
	gainDb: number,
	q: number,
	fs: number,
): number[] {
	if (gainDb === 0) return new Array(frequencies.length).fill(0);

	const A = 10 ** (gainDb / 40); // amplitude = 10^(dB/40)
	const w0 = (2 * Math.PI * fc) / fs;
	const cosw0 = Math.cos(w0);
	const sinw0 = Math.sin(w0);
	const alpha = sinw0 / (2 * q);

	// Peaking EQ biquad coefficients (Audio EQ Cookbook)
	const b0 = 1 + alpha * A;
	const b1 = -2 * cosw0;
	const b2 = 1 - alpha * A;
	const a0 = 1 + alpha / A;
	const a1 = -2 * cosw0;
	const a2 = 1 - alpha / A;

	// Normalize by a0
	const nb0 = b0 / a0;
	const nb1 = b1 / a0;
	const nb2 = b2 / a0;
	const na1 = a1 / a0;
	const na2 = a2 / a0;

	const result = new Array<number>(frequencies.length);
	for (let i = 0; i < frequencies.length; i++) {
		const w = (2 * Math.PI * frequencies[i]) / fs;
		const cosw = Math.cos(w);
		const cos2w = Math.cos(2 * w);
		const sinw = Math.sin(w);
		const sin2w = Math.sin(2 * w);

		// H(e^jw) = (b0 + b1*e^-jw + b2*e^-2jw) / (1 + a1*e^-jw + a2*e^-2jw)
		const numReal = nb0 + nb1 * cosw + nb2 * cos2w;
		const numImag = -(nb1 * sinw + nb2 * sin2w);
		const denReal = 1 + na1 * cosw + na2 * cos2w;
		const denImag = -(na1 * sinw + na2 * sin2w);

		const numMagSq = numReal * numReal + numImag * numImag;
		const denMagSq = denReal * denReal + denImag * denImag;

		result[i] = 10 * Math.log10(numMagSq / denMagSq);
	}
	return result;
}

/**
 * Compute the combined magnitude response of multiple PEQ bands (sum in dB).
 */
export function combinedEqResponse(
	frequencies: number[],
	bands: EqBandConfig[],
	fs: number,
): number[] {
	const combined = new Array<number>(frequencies.length).fill(0);
	for (const band of bands) {
		const response = peqMagnitudeDbArray(frequencies, band.frequency, band.gain, band.q, fs);
		for (let i = 0; i < frequencies.length; i++) {
			combined[i] += response[i];
		}
	}
	return combined;
}

function sumOfSquares(arr: number[]): number {
	let sum = 0;
	for (const v of arr) sum += v * v;
	return sum;
}

// Log-spaced Q values for search grid
function logSpacedQ(minQ: number, maxQ: number, count: number): number[] {
	const logMin = Math.log(minQ);
	const logMax = Math.log(maxQ);
	const qs = new Array<number>(count);
	for (let i = 0; i < count; i++) {
		qs[i] = Math.exp(logMin + (i / (count - 1)) * (logMax - logMin));
	}
	return qs;
}

/**
 * Greedy iterative EQ matching: fit 4 parametric EQ bands to minimize the
 * difference between a reference and recorded spectrum.
 */
export function computeEqMatch(
	referenceDb: number[],
	recordedDb: number[],
	frequencies: number[],
	options?: EqMatchOptions,
): EqMatchResult {
	const numBands = options?.numBands ?? DEFAULT_NUM_BANDS;
	const maxGain = options?.maxGainDb ?? DEFAULT_MAX_GAIN_DB;
	const minQ = options?.minQ ?? DEFAULT_MIN_Q;
	const maxQ = options?.maxQ ?? DEFAULT_MAX_Q;
	const fs = options?.sampleRate ?? DEFAULT_SAMPLE_RATE;
	const n = frequencies.length;

	const lowCut = options?.lowCutHz;
	const highCut = options?.highCutHz;

	// Determine which bins are in the useful frequency range
	const inRange = new Array<boolean>(n);
	let rangeCount = 0;
	for (let i = 0; i < n; i++) {
		inRange[i] =
			(lowCut === undefined || frequencies[i] >= lowCut) &&
			(highCut === undefined || frequencies[i] <= highCut);
		if (inRange[i]) rangeCount++;
	}

	// Normalize: remove average level difference so EQ only corrects the shape
	let refSum = 0;
	let recSum = 0;
	for (let i = 0; i < n; i++) {
		if (inRange[i]) {
			refSum += referenceDb[i];
			recSum += recordedDb[i];
		}
	}
	const levelOffset = rangeCount > 0 ? refSum / rangeCount - recSum / rangeCount : 0;

	// Difference curve: positive means recorded needs boost
	const residual = new Array<number>(n);
	for (let i = 0; i < n; i++) {
		if (!inRange[i]) {
			residual[i] = 0;
		} else {
			residual[i] = referenceDb[i] - (recordedDb[i] + levelOffset);
		}
	}

	const errorBefore = sumOfSquares(residual);
	const qValues = logSpacedQ(minQ, maxQ, 20);
	const bands: EqBandConfig[] = [];

	for (let band = 0; band < numBands; band++) {
		// Find frequency index with largest |residual|
		let peakIdx = 0;
		let peakAbs = 0;
		for (let i = 0; i < n; i++) {
			const abs = Math.abs(residual[i]);
			if (abs > peakAbs) {
				peakAbs = abs;
				peakIdx = i;
			}
		}

		if (peakAbs < 0.1) break; // residual is negligible

		// Search neighborhood around peak frequency
		const searchStart = Math.max(0, peakIdx - 5);
		const searchEnd = Math.min(n - 1, peakIdx + 5);

		let bestFc = frequencies[peakIdx];
		let bestGain = 0;
		let bestQ = 1;
		let bestError = sumOfSquares(residual);

		for (let fi = searchStart; fi <= searchEnd; fi++) {
			const fc = frequencies[fi];
			for (const q of qValues) {
				// Compute unit-gain PEQ shape at 1 dB
				const shape = peqMagnitudeDbArray(frequencies, fc, 1, q, fs);

				// Optimal gain via least-squares projection:
				// gain = Σ(residual × shape) / Σ(shape²)
				let dotRS = 0;
				let dotSS = 0;
				for (let i = 0; i < n; i++) {
					dotRS += residual[i] * shape[i];
					dotSS += shape[i] * shape[i];
				}

				if (dotSS < 1e-12) continue;
				let gain = dotRS / dotSS;

				// Clamp gain
				gain = Math.max(-maxGain, Math.min(maxGain, gain));

				// Compute candidate residual error
				let error = 0;
				for (let i = 0; i < n; i++) {
					const r = residual[i] - gain * shape[i];
					error += r * r;
				}

				if (error < bestError) {
					bestError = error;
					bestFc = fc;
					bestGain = gain;
					bestQ = q;
				}
			}
		}

		if (Math.abs(bestGain) < 0.1) break; // no meaningful improvement

		// Subtract this band's response from the residual
		const bandResponse = peqMagnitudeDbArray(frequencies, bestFc, bestGain, bestQ, fs);
		for (let i = 0; i < n; i++) {
			residual[i] -= bandResponse[i];
		}

		bands.push({
			frequency: Math.round(bestFc * 10) / 10,
			gain: Math.round(bestGain * 100) / 100,
			q: Math.round(bestQ * 100) / 100,
		});
	}

	// Sort by frequency
	bands.sort((a, b) => a.frequency - b.frequency);

	const errorAfter = sumOfSquares(residual);
	return { bands, errorBefore, errorAfter };
}
