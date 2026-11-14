# OpenCode Agent Trace

![OpenCode Agent Trace: a schematic of session events](assets/banner.svg)

An experimental OpenCode V2 plugin for inspecting agent-loop events in a terminal timeline. Event-only: it reads the live session through OpenCode RPC and renders a filterable event list with a full readable detail pane. It writes nothing to disk and captures nothing in the background.

> This version performs no capture and keeps no snapshots. Files saved by earlier versions under `~/.local/share/opencode/context-trace/` are left untouched; remove them manually if you no longer want them. See [privacy and limitations](docs/privacy-and-limitations.md).

## Install locally

Clone this repository, then add its absolute path to the `plugins` array in your OpenCode `opencode.json` or `opencode.jsonc`. Keep any existing entries.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-agent-trace"]
}
```

This is a local source installation, not an npm release. Do not load another copy of the `context-trace` plugin at the same time. Tested with OpenCode v2.2.7 and v2.3.0; other versions have not been tested.

## Explore a session

Open a session and run `/trace`, or choose **Context Trace: Open Timeline** from the command palette.

![Schematic: event list and detail are independent panes with a frozen filter header](assets/timeline.svg)

| Key | Action |
| --- | --- |
| `←` / `→` (or `h` / `l`) | Focus the event list / detail pane |
| `↑` / `↓` (or `j` / `k`) | Move the selection (list) or scroll (detail) |
| `s` / `t` / `o` / `e` / `a` | Filter events: skills / thinking / tools / user / assistant text; pressing the same key again shows all |
| `c` | Clear the event filter (show all) |
| `PageUp` / `PageDown` | Scroll the detail pane |
| `Esc` | Close the panel |

The header is a frozen top bar with the event count and a compact filter bar. Each row shows an emoji, a badge, and a short preview (for example `🔧 READ — src/index.ts`); the badge appears once and the preview never repeats it. A filter shows only matching events. The focused pane is marked `●` in an accent color while the other shows `○` muted; the selected row keeps its `>` marker with full-strength text only while the list is focused. All colors come from the host theme with plain fallbacks, and rows carry text markers as well as color so nothing depends on color alone. The detail pane renders prose as markdown and tool input/output as structured text with real line breaks (never `\n` escapes); when markdown support is unavailable it falls back to plain text. On narrow terminals (under 80 columns) the list stacks above the detail pane. The list refreshes automatically while the panel is open.

## Privacy and limits

- This version writes nothing: no captures, no snapshots, no background work, no network transmission. Trace data is whatever the connected OpenCode server already holds for the session, exposed through its RPC.
- Files from earlier versions remain under `~/.local/share/opencode/context-trace/` on the server host, including any sensitive content they hold. The plugin never reads, modifies, or deletes them. Protect backups and remove unwanted files manually.
- Secure access to the OpenCode server: session messages can contain prompts, source code, tool outputs, personal information, and secrets.

See [privacy and limitations](docs/privacy-and-limitations.md) for details. If RPC fails, the panel falls back to the locally cached session messages.

## Development

Run `npm test` with Node.js 24 or newer. Licensed under [MIT](LICENSE).
