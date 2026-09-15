# xr18-mcp

MCP server for controlling a Behringer XR18/MR18 digital mixer over OSC/UDP.

Built with [Model Context Protocol](https://modelcontextprotocol.io) so that AI assistants (Claude, etc.) can mix sound, adjust EQ, capture spectrum data, and more — all through natural language.

## Features

- **Batch commands** — set multiple faders, mutes, EQ, and sends in a single call
- **Parallel queries** — read multiple mixer parameters simultaneously
- **Channel/bus names** — reference channels by name (e.g. "Kick") instead of number
- **RTA capture** — point the mixer's Real-Time Analyzer at a channel, capture spectrum frames, and get averaged frequency/dB data across 100 bands
- **Full channel strip** — phantom, polarity, low cut, headamp gain, EQ band types (shelf/cut), pan, LR assign, FX sends, send tap points, names and colors; read a whole strip back as JSON
- **Gate and compressor** — full gate/expander on input channels and compressor on channels, buses and main LR, in engineer units (dB, ms, Hz); partial updates and whole-block read-back
- **Snapshots** — list, save, load and rename the mixer's 64 snapshots; save one before automated changes so they can be undone
- **Gain staging** — measure input peaks and preview or apply headamp gain changes toward a target level
- **FX control** — set FX send/return levels and mutes
- **Raw OSC** — escape hatch for any OSC command not covered by the tools

## Tools

| Tool | Description |
|------|-------------|
| `connect_mixer` | Connect to mixer at IP:port (default 10024) |
| `batch` | Execute multiple commands in one call (faders, mutes, EQ, sends, FX) |
| `query` | Read multiple parameters in one call (levels, trim, EQ, gate/compressor blocks, whole channel strip) |
| `capture_rta` | Capture RTA spectrum data from a channel (100 bands, 20 Hz – 18.6 kHz) |
| `eq_match` | Fit 4 parametric EQ bands so a recorded spectrum matches a reference |
| `gain_stage` | Measure input peaks and suggest or apply headamp gain changes |
| `snapshot` | List, save, load or rename mixer snapshots (64 slots) |
| `list_names` | Show all channel and bus name assignments |
| `get_mixer_info` | Query mixer info via `/xinfo` |

## Setup

```bash
bun install
bun run build
```

### Claude Desktop / Claude Code

Add to your MCP config:

```json
{
  "mcpServers": {
    "xr18": {
      "command": "node",
      "args": ["/path/to/xr18-mcp/dist/index.js"]
    }
  }
}
```

Or run in dev mode:

```bash
bun run dev
```

## Development

```bash
bun run test          # run tests
bun run test:watch    # watch mode
bun run lint          # check with biome
bun run lint:fix      # auto-fix lint issues
bun run format        # format with biome
```

## How it works

The server communicates with the XR18/MR18 over UDP using the [OSC protocol](https://opensoundcontrol.stanford.edu/). On connection, it syncs channel and bus names from the mixer so you can reference them by name.

The RTA tool subscribes to `/meters/4` to receive real-time spectrum data, averages frames over a configurable duration (2–30 seconds), and returns 100 frequency bands with dB values — useful for analyzing signal content and building EQ matching workflows.

## License

MIT
