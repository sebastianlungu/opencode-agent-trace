# Privacy, retention, and limitations

**Session content can contain sensitive information. There is no redaction.** The event list shows the session's messages as returned by the OpenCode server: prompts, source code, tool outputs, personal information, or secrets. The plugin itself makes no network calls, but viewing fetches session data via its OpenCode RPC interface, so it travels over whatever transport the connected server uses (local or remote); secure access to the OpenCode server accordingly.

## No capture in this version

This version performs no background capture, keeps no snapshots, and writes nothing to disk. There is no size limit to configure, no lock directory, no pending queue, and nothing to disable: `maxBytes` and related options no longer exist.

Files saved by earlier versions remain under `~/.local/share/opencode/context-trace/` on the server host, one JSON file per capture, and are **not** read, modified, or deleted by this version. Directory names are SHA-256 hashes of the session ID's UTF-16 code units. Each capture repeated the full context available to the hook, so old files can contain prompts, source code, tool outputs, personal information, and secrets, and can be large. Disabling the plugin or deleting OpenCode sessions does **not** delete them. Protect backups and manually remove unwanted trace files when appropriate.

## Status and limitations

The event list follows the session's returned order. A single-type filter (`s` skills, `t` thinking, `o` tools, `e` user, `a` assistant text; the same key or `c` shows all) shows only matching events. Each row shows an emoji, a badge, and a short preview; the preview never repeats the badge word. The event detail pane renders prose as markdown and tool input/output as structured text with real line breaks (falling back to plain text when markdown support is unavailable).

The list refreshes automatically while the panel is open (short polling plus a fallback to locally cached session messages if RPC fails; that fallback has no server-side context beyond the local cache). Row scrolling only moves when the selection crosses the visible edge of the list. Long tool outputs can be large; the detail pane scrolls independently. This is a viewer over session data the server already holds, **not an audit log**, and it does not guarantee completeness across restarts or auxiliary requests such as compaction, title generation, and transient generation.

Isolated QA confirmed live plugin loading, RPC, and the interactive `/trace` panel with OpenCode v2.2.7 and v2.3.0. Other OpenCode versions have not been tested. The automated tests cover the timeline mapping, strict filters, row labels, viewport helpers, selection behavior, and the RPC surface. Run the tests with `npm test` using Node.js 24 or newer.
