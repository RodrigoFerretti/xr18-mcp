import { z } from "zod";

// --- Shared field schemas ---

const ChannelRef = z
	.union([z.number().int().min(1).max(17), z.string().min(1)])
	.describe(
		"Channel number (1-16) or symbolic name (e.g. 'Kick'). " +
			"Channel 17 is the aux return (VS/USB). " +
			"Names are case-insensitive and must be assigned first via the mixer or connect_mixer.",
	);

const BusRef = z
	.union([z.number().int().min(1).max(6), z.string().min(1)])
	.describe(
		"Bus number (1-6) or symbolic name (e.g. 'Drums'). " +
			"Names are case-insensitive and must be assigned first via the mixer or connect_mixer.",
	);

const LevelDb = z
	.number()
	.min(-90)
	.max(10)
	.describe(
		"Level in dB. Range: -90 (mute) to +10 (max). " +
			"Common values: -90=off, -30=low, -10=moderate, 0=unity, +10=max.",
	);

const EqBand = z
	.number()
	.int()
	.min(1)
	.max(4)
	.describe("EQ band number (1-4). Band 1=low, 2=low-mid, 3=high-mid, 4=high.");

const EqFrequency = z.number().min(20).max(20000).describe("EQ frequency in Hz (20-20000).");

const EqGain = z.number().min(-15).max(15).describe("EQ gain in dB (-15 to +15). 0=flat.");

const EqQ = z
	.number()
	.min(0.3)
	.max(10)
	.describe("EQ Q factor (0.3-10). Lower=wider, higher=narrower. 1.0 is a good default.");

const FxSlot = z.number().int().min(1).max(4).describe("FX slot number (1-4).");

const FxReturn = z.number().int().min(1).max(4).describe("FX return number (1-4).");

const Muted = z.boolean().describe("true=mute, false=unmute.");

const Enabled = z.boolean().describe("true=enable, false=disable.");

const TrimDb = z
	.number()
	.min(-18)
	.max(18)
	.describe(
		"USB-return trim in dB. Range: -18 to +18. 0=unity. " +
			"Only affects the signal when the channel's input is switched to its USB return (rtnsw); " +
			"it does NOT change analog mic/line gain — use gain_stage or /headamp/XX/gain for that.",
	);

// --- Command schemas ---

const SetChannelFader = z
	.object({
		action: z.literal("set_channel_fader"),
		channel: ChannelRef,
		level_db: LevelDb,
	})
	.describe("Set an input channel's fader level.");

const SetChannelMute = z
	.object({
		action: z.literal("set_channel_mute"),
		channel: ChannelRef,
		muted: Muted,
	})
	.describe("Mute or unmute an input channel.");

const SetChannelSendLevel = z
	.object({
		action: z.literal("set_channel_send_level"),
		channel: ChannelRef,
		bus: BusRef,
		level_db: LevelDb,
	})
	.describe("Set how much of a channel goes to a bus/monitor mix.");

const SetChannelEq = z
	.object({
		action: z.literal("set_channel_eq"),
		channel: ChannelRef,
		band: EqBand,
		frequency_hz: EqFrequency,
		gain_db: EqGain,
		q: EqQ,
	})
	.describe("Set EQ parameters for one band on a channel.");

const SetChannelEqOn = z
	.object({
		action: z.literal("set_channel_eq_on"),
		channel: ChannelRef,
		enabled: Enabled,
	})
	.describe("Enable or disable EQ processing on a channel.");

const SetBusFader = z
	.object({
		action: z.literal("set_bus_fader"),
		bus: BusRef,
		level_db: LevelDb,
	})
	.describe("Set a bus master fader level.");

const SetBusMute = z
	.object({
		action: z.literal("set_bus_mute"),
		bus: BusRef,
		muted: Muted,
	})
	.describe("Mute or unmute a bus.");

const SetMainFader = z
	.object({
		action: z.literal("set_main_fader"),
		level_db: LevelDb,
	})
	.describe("Set the main LR output fader level.");

const SetMainMute = z
	.object({
		action: z.literal("set_main_mute"),
		muted: Muted,
	})
	.describe("Mute or unmute the main LR output.");

const SetFxSendFader = z
	.object({
		action: z.literal("set_fx_send_fader"),
		fx_slot: FxSlot,
		level_db: LevelDb,
	})
	.describe("Set an FX send fader level.");

const SetFxSendMute = z
	.object({
		action: z.literal("set_fx_send_mute"),
		fx_slot: FxSlot,
		muted: Muted,
	})
	.describe("Mute or unmute an FX send.");

const SetFxReturnFader = z
	.object({
		action: z.literal("set_fx_return_fader"),
		fx_return: FxReturn,
		level_db: LevelDb,
	})
	.describe("Set an FX return fader level.");

const SetFxReturnMute = z
	.object({
		action: z.literal("set_fx_return_mute"),
		fx_return: FxReturn,
		muted: Muted,
	})
	.describe("Mute or unmute an FX return.");

const SetFxReturnSendLevel = z
	.object({
		action: z.literal("set_fx_return_send_level"),
		fx_return: FxReturn,
		bus: BusRef,
		level_db: LevelDb,
	})
	.describe("Set how much of an FX return goes to a bus/monitor mix.");

const SetChannelPreampTrim = z
	.object({
		action: z.literal("set_channel_preamp_trim"),
		channel: ChannelRef,
		trim_db: TrimDb,
	})
	.describe("Set a channel's USB-return trim (/preamp/rtntrim). Not the analog preamp gain.");

const SendRawOsc = z
	.object({
		action: z.literal("send_raw_osc"),
		address: z.string().describe("OSC address path, e.g. '/ch/01/mix/fader'."),
		args: z
			.array(z.union([z.number(), z.string()]))
			.optional()
			.describe("OSC arguments (numbers or strings). Omit for parameter queries."),
	})
	.describe("Send a raw OSC message. Escape hatch for any command not covered by other actions.");

// --- Discriminated union ---

export const Command = z
	.discriminatedUnion("action", [
		SetChannelFader,
		SetChannelMute,
		SetChannelSendLevel,
		SetChannelEq,
		SetChannelEqOn,
		SetBusFader,
		SetBusMute,
		SetMainFader,
		SetMainMute,
		SetFxSendFader,
		SetFxSendMute,
		SetFxReturnFader,
		SetFxReturnMute,
		SetFxReturnSendLevel,
		SetChannelPreampTrim,
		SendRawOsc,
	])
	.describe("A single mixer command. Use the 'action' field to choose the command type.");

export type Command = z.infer<typeof Command>;

export const BatchInput = z.object({
	commands: z
		.array(Command)
		.min(1)
		.describe(
			"Array of mixer commands to execute in sequence. All commands in a single batch are sent as fast as possible over UDP.",
		),
});

export type BatchInput = z.infer<typeof BatchInput>;
