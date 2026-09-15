# X AIR (XR18 / MR18) OSC reference for xr18-mcp

Compiled 2026-09-14 from: the xair-api-python source (`shared.py`, `headamp.py`, `config.py`, `bus.py`, `lr.py`, `rtn.py`, `dca.py`), Patrick-Gilles Maillot's *Unofficial X32/M32 OSC Remote Protocol* (the X AIR firmware shares the parameter semantics, enum orders and float mappings with the X32), and the notameadow/xair-osc README for meter layouts. The official *X AIR Remote Control Protocol* PDF on Behringer's CDN was unreachable (HTTP 500) at the time of writing.

Legend:

- **OK** = confirmed by an X AIR-specific source.
- **X32** = taken from the X32 document; same on X AIR in practice, but the enum order or presence should be verified once on the real unit with `query` / `send_raw_osc`.
- **?** = believed to exist, unverified.

## 1. Protocol basics

| Topic | Detail |
|---|---|
| Transport | UDP, mixer listens on port 10024. Replies go back to the sender's IP:port. |
| Parameter enquiry | Send the address with **no arguments**; the mixer replies with the same address and the current value(s). |
| Setting | Send the address with a typed argument. Floats are almost always normalized 0.0..1.0. Enums accept either an int index or the string name. |
| Change notifications | `/xremote` (no args) subscribes this sender to every parameter change for ~10 s; resend to keep alive. |
| Meters | `/meters ,s "/meters/N"` (optionally `,si` with a channel index). Also expires after ~10 s. Blob = int32 LE count, then `count` × int16 LE, each value = dBFS × 256. |
| Info | `/xinfo` → ip, name, model, firmware. `/status` → state, ip, name. |
| Float mappings | `linf [min,max]`: value = min + x·(max−min). `logf [min,max]`: value = min·(max/min)^x. `level`: the fader curve already implemented in `xair.ts` (−90..+10 dB). |

## 2. Coverage: what the MCP exposes today vs what the board has

| Block | Board has | MCP today | Gap |
|---|---|---|---|
| Fader / mute / LR assign | ch, bus, LR, fxsend, rtn, dca | ch, bus, LR, fxsend, rtn fader+mute; ch pan + LR assign | DCA fader/mute |
| Sends | 6 bus + 4 FX sends per channel, each with tap point | bus level, FX level, bus tap | send pan, grpon |
| Preamp | headamp gain, phantom, polarity, HPF, USB return switch/trim | all (`set_channel_preamp`, `set_headamp_gain`, `set_channel_preamp_trim`) | hpslope (unverified) |
| Gate | full | `set_channel_gate` / `get_channel_gate` | key source bus offset unverified |
| Compressor | full, ch + bus + LR | `set_channel_compressor`, `set_bus_compressor`, `set_main_compressor` + `get_*` | key source bus offset unverified |
| EQ | 4-band ch/rtn/aux (with band type), 6-band bus/LR + 31-band GEQ | 4-band type/f/g/q, on/off, read-back | bus/LR 6-band, GEQ |
| Config | name, color, input source, USB return source | name + color for channels and buses | insrc/rtnsrc |
| Groups | 4 DCA, 4 mute groups | none | everything |
| FX engines | 4 slots, type + up to 64 params | none | everything |
| Snapshots | 64 slots, load/save/name | none | everything (needed for undo) |
| Monitoring | solo per strip, solo bus config | none | solo on/off, clear solo |
| Metering | 10 meter streams | RTA (`/meters/4`), inputs (`/meters/2`) | outputs/bus meters, gate/comp gain reduction |
| Recorder | USB stereo record/play | none | tape transport |

## 3. Input channels `/ch/01` … `/ch/16`

Also applies (with the noted subsets) to `/rtn/aux` and `/rtn/1..4`.

### 3.1 `config`

| Address | Type | Range / enum | Status |
|---|---|---|---|
| `/ch/XX/config/name` | string | up to 12 chars | OK |
| `/ch/XX/config/color` | int enum 0..15 | `OFF, RD, GN, YE, BL, MG, CY, WH, OFFi, RDi, GNi, YEi, BLi, MGi, CYi, WHi` (i = inverted) | X32 |
| `/ch/XX/config/insrc` | int | physical input source index | OK (values ?) |
| `/ch/XX/config/rtnsrc` | int | USB return source index | OK (values ?) |

### 3.2 `preamp`

| Address | Type | Range / enum | Status |
|---|---|---|---|
| `/headamp/XX/gain` | linf | −12..+60 dB | OK |
| `/headamp/XX/phantom` | int 0/1 | | OK |
| `/ch/XX/preamp/invert` | int 0/1 | polarity | OK |
| `/ch/XX/preamp/hpon` | int 0/1 | low-cut on | OK |
| `/ch/XX/preamp/hpf` | logf | 20..400 Hz | OK |
| `/ch/XX/preamp/hpslope` | enum | `12, 18, 24` dB/oct | ? (exists on X32; not listed by xair-api) |
| `/ch/XX/preamp/rtnsw` | int 0/1 | use USB return instead of analog input | OK |
| `/ch/XX/preamp/rtntrim` | linf | −18..+18 dB, USB return only | OK |

Note: there is no `/ch/XX/preamp/trim` on X AIR; that is X32 naming.

### 3.3 `gate`

| Address | Type | Range / enum | Status |
|---|---|---|---|
| `/ch/XX/gate/on` | int 0/1 | | OK |
| `/ch/XX/gate/mode` | enum 0..4 | `EXP2, EXP3, EXP4, GATE, DUCK` | OK |
| `/ch/XX/gate/thr` | linf | −80..0 dB (0.5 dB steps) | OK |
| `/ch/XX/gate/range` | linf | 3..60 dB | OK |
| `/ch/XX/gate/attack` | linf | 0..120 ms | OK |
| `/ch/XX/gate/hold` | logf | 0.02..2000 ms | OK |
| `/ch/XX/gate/release` | logf | 5..4000 ms | OK |
| `/ch/XX/gate/keysrc` | int | 0 = self; then `Ch01..16`, then buses (exact order ?) | OK (order ?) |
| `/ch/XX/gate/filter/on` | int 0/1 | sidechain filter | OK |
| `/ch/XX/gate/filter/type` | enum 0..8 | `LC6, LC12, HC6, HC12, 1.0, 2.0, 3.0, 5.0, 10.0` (last five are band-pass Q) | X32 |
| `/ch/XX/gate/filter/f` | logf | 20..20000 Hz | OK |

### 3.4 `dyn` (compressor / expander)

| Address | Type | Range / enum | Status |
|---|---|---|---|
| `/ch/XX/dyn/on` | int 0/1 | | OK |
| `/ch/XX/dyn/mode` | enum | `COMP, EXP` | OK |
| `/ch/XX/dyn/det` | enum | `PEAK, RMS` | OK |
| `/ch/XX/dyn/env` | enum | `LIN, LOG` | OK |
| `/ch/XX/dyn/thr` | linf | −60..0 dB | OK |
| `/ch/XX/dyn/ratio` | enum 0..11 | `1.1, 1.3, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 7.0, 10, 20, 100` | OK |
| `/ch/XX/dyn/knee` | linf | 0..5 | OK |
| `/ch/XX/dyn/mgain` | linf | 0..24 dB makeup | OK |
| `/ch/XX/dyn/attack` | linf | 0..120 ms | OK |
| `/ch/XX/dyn/hold` | logf | 0.02..2000 ms | OK |
| `/ch/XX/dyn/release` | logf | 5..4000 ms | OK |
| `/ch/XX/dyn/pos` | enum | `PRE, POST` (relative to EQ) | ? (X32 has it; xair-api does not list it) |
| `/ch/XX/dyn/mix` | linf | 0..100 % parallel mix | OK |
| `/ch/XX/dyn/auto` | int 0/1 | auto time constants | OK |
| `/ch/XX/dyn/keysrc` | int | as gate | OK (order ?) |
| `/ch/XX/dyn/filter/on` / `type` / `f` | | as gate | OK / X32 / OK |

### 3.5 `insert`

| Address | Type | Range / enum | Status |
|---|---|---|---|
| `/ch/XX/insert/on` | int 0/1 | | OK |
| `/ch/XX/insert/sel` | int enum | `OFF, FX1..FX4` (order ?) | OK (values ?) |

### 3.6 `eq`

| Address | Type | Range / enum | Status |
|---|---|---|---|
| `/ch/XX/eq/on` | int 0/1 | | OK |
| `/ch/XX/eq/N/type` (N = 1..4) | enum 0..5 | `LCut, LShv, PEQ, VEQ, HShv, HCut` | OK |
| `/ch/XX/eq/N/f` | logf | 20..20000 Hz | OK (implemented) |
| `/ch/XX/eq/N/g` | linf | −15..+15 dB | OK (implemented) |
| `/ch/XX/eq/N/q` | logf, inverted | float 0 → Q 10, float 1 → Q 0.3 | OK (implemented) |

### 3.7 `mix`

| Address | Type | Range / enum | Status |
|---|---|---|---|
| `/ch/XX/mix/on` | int 0/1 | 0 = muted | OK (implemented) |
| `/ch/XX/mix/fader` | level | −90..+10 dB | OK (implemented) |
| `/ch/XX/mix/lr` | int 0/1 | assign to main LR | OK |
| `/ch/XX/mix/pan` | linf | −100..+100 (0.5 = center) | OK |
| `/ch/XX/mix/01..06/level` | level | send to bus 1..6 | OK (implemented) |
| `/ch/XX/mix/07..10/level` | level | send to FX 1..4 | OK |
| `/ch/XX/mix/NN/pan` (odd NN) | linf | pan within a linked stereo bus pair | X32 |
| `/ch/XX/mix/NN/tap` | enum | `IN, PREEQ, POSTEQ, PRE, POST, GRP` | X32 (X32 calls it `type`; X AIR uses `tap` per xair docs — verify) |
| `/ch/XX/mix/NN/grpon` | int 0/1 | send follows group (subgroup mode) | ? |

### 3.8 `grp` and `automix`

| Address | Type | Range / enum | Status |
|---|---|---|---|
| `/ch/XX/grp/dca` | int bitmask | bit 0..3 = DCA 1..4 | OK |
| `/ch/XX/grp/mute` | int bitmask | bit 0..3 = mute group 1..4 | OK |
| `/ch/XX/automix/group` | enum 0..2 | `OFF, X, Y` | OK |
| `/ch/XX/automix/weight` | linf | −12..+12 dB | OK |

## 4. Buses `/bus/1` … `/bus/6` (not zero-padded)

Blocks: `config` (name, color), `dyn` (same as channel), `insert`, `eq` with **6 bands** (`/bus/N/eq/1..6/type|f|g|q`, plus `/bus/N/eq/on` and `/bus/N/eq/mode` = `PEQ, GEQ, TEQ`), `geq` (31 bands, addresses `/bus/N/geq/20`, `/25`, `/31`, … `/16k`, `/20k`, each linf −15..+15 dB), `mix` (`on`, `fader`, `lr` ?), `grp` (`dca`, `mute`). Status: OK for block presence, X32 for GEQ band naming.

## 5. Main `/lr`

Same as a bus: `config`, `dyn`, `insert`, 6-band `eq` + `mode`, `geq`, `mix/on`, `mix/fader`. Status OK.

## 6. FX sends `/fxsend/1..4`, FX returns `/rtn/1..4`, aux `/rtn/aux`

- `/fxsend/N/config/name|color`, `/fxsend/N/mix/on|fader`, `/fxsend/N/grp/dca|mute`. OK.
- `/rtn/N/config`, `/rtn/N/preamp` (subset), `/rtn/N/eq/1..4`, `/rtn/N/mix/on|fader|lr|pan`, `/rtn/N/mix/01..06/level` (bus sends), `/rtn/N/grp`. OK.
- `/rtn/aux/…` identical to `/rtn/N` plus `preamp/rtnsw`, `preamp/rtntrim`. OK.

## 7. FX engines `/fx/1..4`

| Address | Type | Range / enum | Status |
|---|---|---|---|
| `/fx/N/type` | enum | X32 list (X AIR is a subset): `HALL, AMBI, RPLT, ROOM, CHAM, PLAT, VREV, VRM, GATE, RVRS, DLY, 3TAP, 4TAP, CRS, FLNG, PHAS, DIMC, FILT, ROTA, PAN, SUB, D/RV, CR/R, FL/R, D/CR, D/FL, MODD, GEQ2, GEQ, TEQ2, TEQ, DES2, DES, P1A, P1A2, PQ5, PQ5S, WAVD, LIM, CMB, CMB2, FAC, FAC1M, FAC2, LEC, LEC2, ULC, ULC2, ENH2, ENH, EXC2, EXC, IMG, EDI, SON, AMP2, AMP, DRV2, DRV, PIT2, PIT` | X32 |
| `/fx/N/par/01..64` | float 0..1 | meaning depends on type; the X32 doc has per-type tables | X32 |
| `/fx/N/insert` | enum | which channel/bus the slot is inserted on | ? |

## 8. DCA `/dca/1..4`, mute groups, config

| Address | Type | Range / enum | Status |
|---|---|---|---|
| `/dca/N/on` | int 0/1 | | OK |
| `/dca/N/fader` | level | | OK |
| `/dca/N/config/name` / `color` | | | OK |
| `/config/mute/1..4` | int 0/1 | mute group active | OK |
| `/config/chlink/1-2` … `/15-16` | int 0/1 | stereo-link channel pairs | OK |
| `/config/buslink/1-2`, `/3-4`, `/5-6` | int 0/1 | | OK |
| `/config/linkcfg/eq` / `dyn` / `fdrmute` | int 0/1 | what a link shares | OK |
| `/config/amixenable` / `amixlock` | int 0/1 | automix | OK |
| `/config/solo/level` | level | | OK |
| `/config/solo/source` | int | | OK |
| `/config/solo/sourcetrim` | linf | −18..+18 dB | OK |
| `/config/solo/chmode` / `busmode` | int 0/1 | PFL/AFL | OK |
| `/config/solo/dim` / `dimatt` / `mono` / `mute` / `dimfpl` | | dimatt −40..0 dB | OK |

## 9. Snapshots, status, actions

| Address | Type | Detail | Status |
|---|---|---|---|
| `/-snap/load ,i N` | int | recall slot N (1..64) | ? (widely used, unverified here) |
| `/-snap/save ,i N` | int | store current state to slot N | ? |
| `/-snap/index` | int | currently loaded slot | ? |
| `/-snap/NN/name` | string | slot name | ? |
| `/-snap/NN/scope` | int | recall scope bitmask | ? |
| `/-stat/rta/source` | int | 0..15 = ch, 16 = aux, then FX rtn / bus / LR (order ?) | OK for ch/aux (implemented) |
| `/-stat/solosw/NN` | int 0/1 | solo state per strip | X32 |
| `/-stat/tape/state` | enum | `0 Stop, 1 Pause, 2 Play, 3 Pause Rec, 4 Record, 5 FF, 6 REW` | X32 |
| `/-stat/tape/file` / `etime` / `rtime` | | current file, elapsed, remaining | X32 |
| `/-action/clearsolo ,i 1` | | clear all solos | X32 |
| `/-action/setrtasrc` | int | alternative to `/-stat/rta/source` | X32 |
| `/-action/playtape` / `stoptape` / `recordtape` | | USB recorder transport | ? |

## 10. Meter streams

| Stream | Values | Layout | Status |
|---|---|---|---|
| `/meters/1` | 40 | 16 ch pre, aux L/R, fx1-4 rtn L/R, bus 1-6, fxsend 1-4, main post L/R, mon L/R | OK |
| `/meters/2` | 36 | 16 preamp inputs, aux in L/R, 18 USB inputs | OK (implemented) |
| `/meters/3` | ? | gate and comp gain reduction per channel | ? |
| `/meters/4` | 100 | RTA bands, source set by `/-stat/rta/source` | OK (implemented) |
| `/meters/5..9` | | outputs / USB sends / misc | ? |

## 11. Verification recipe

Once connected, each `?` row can be settled in seconds with the existing tools:

```
query  → send_raw_osc { address: "/ch/01/gate/keysrc" }        # enquiry, see reply
set    → send_raw_osc { address: "/ch/01/dyn/ratio", args: [3] }  # then check X AIR Edit
```

Replace `?`/`X32` with `OK` here as rows are confirmed.
