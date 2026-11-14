import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, onCleanup, Show, For } from "solid-js"
import { ContextTraceRpc } from "./rpc"
import { timeline } from "./trace"
import { eventDetail, eventMarkdown, eventRow, eventTone, filterItems, focusParts, headerFitsEscHint, paneBorders, selectionIndex, selectionMarker, toggleFilter } from "./panel"
import type { EventFilter } from "./panel"

const filterHints = [
  { bind: "s", filter: "skill", label: "skills" },
  { bind: "t", filter: "thinking", label: "thinking" },
  { bind: "o", filter: "tool", label: "tools" },
  { bind: "e", filter: "user", label: "user" },
  { bind: "a", filter: "text", label: "assistant text" },
] as const

function themeColors(theme: any) {
  const text = theme?.text ?? {}
  const current = theme?.current ?? {}
  const background = theme?.background ?? {}
  const pick = (...values: any[]) => values.find((value) => value !== undefined && value !== null)
  const base = pick(text.base, current.text, "#ffffff")
  const muted = pick(text.muted, current.textMuted, "#808080")
  return {
    base,
    muted,
    info: pick(text.info, current.info, "#4aa8ff"),
    warning: pick(text.warning, current.warning, "#e5c07b"),
    accent: pick(text.accent, current.accent, current.primary, "#c678dd"),
    secondary: pick(text.secondary, current.secondary, muted),
    headerBg: pick(background.element, background.panel, current.backgroundElement, current.backgroundPanel, "#232634"),
    selectedBg: pick(background.selected, current.backgroundMenu, current.backgroundElement, "#394353"),
    border: pick(current.border, muted),
    borderActive: pick(current.borderActive, current.accent, "#c678dd"),
    borderSubtle: pick(current.borderSubtle, current.border, muted),
  }
}

function ContextTracePanel(props: { panel: any }) {
  const context = usePlugin()
  const colors = () => themeColors((context as any).theme)
  const [trace, setTrace] = createSignal<any>({ items: [], warnings: [] })
  const [eventID, setEventID] = createSignal<string>()
  const [filter, setFilter] = createSignal<EventFilter>(undefined)
  const [focus, setFocus] = createSignal<"list" | "detail">("list")
  const [syntax, setSyntax] = createSignal<any>()
  const [error, setError] = createSignal("")
  let detail: any
  let listBox: any
  let request = 0
  void (async () => {
    const owner = (context.renderer as any)?.nativeScene
    try {
      const themeModule = await import("@opencode/theme/tui") as any
      const theme = (context as any).theme
      if (typeof themeModule?.generateSyntax === "function" && theme) {
        setSyntax(themeModule.generateSyntax(theme, owner))
        return
      }
    } catch { /* Fall through to minimal SyntaxStyle below. */ }
    try {
      const opentui = await import("@opentui/core")
      setSyntax(opentui.SyntaxStyle.fromStyles({ default: { fg: colors().base } }, owner))
    } catch { /* Markdown falls back to plain text. */ }
  })()
  const applyTrace = (next: any) => {
    setEventID(next.items[selectionIndex(next.items, eventID(), 0)]?.id)
    setTrace(next)
  }
  const refresh = async () => {
    const current = ++request
    try {
      const result: any = await context.client.rpc(ContextTraceRpc).getTrace({ sessionID: props.panel.sessionID })
      if (current !== request) return
      applyTrace(result.data ?? result)
      setError("")
    } catch (cause) {
      if (current !== request) return
      const messages = context.data.session.message.list(props.panel.sessionID) ?? []
      applyTrace({ warnings: [], items: timeline(messages as any[]) })
      setError(`RPC unavailable: ${String(cause)}`)
    }
  }
  void refresh()
  const timer = setInterval(() => { void refresh() }, 2000)
  onCleanup(() => { request++; clearInterval(timer); try { const style = syntax(); if (style) void context.renderer.idle().then(() => style.destroy()) } catch { /* Renderer teardown is best-effort. */ } })
  const visibleEvents = () => filterItems(trace().items, filter())
  createEffect(() => {
    const visible = visibleEvents()
    if (!visible.length || visible.some((entry) => entry.id === eventID())) return
    setEventID(visible[0].id)
  })
  const index = () => selectionIndex(visibleEvents(), eventID(), 0)
  // Nearest-edge scrolling only: no-op while the selected row is already visible.
  createEffect(() => {
    const id = eventID()
    if (!id || !listBox) return
    try { listBox.scrollChildIntoView(`evt:${id}`) }
    catch { /* Older renderers ignore per-row scrolling; selection still updates. */ }
  })
  createEffect(() => {
    // New content starts at the top when the selection changes.
    if (eventID() && detail) { try { detail.scrollTo(0) } catch { /* Scroll reset is best-effort. */ } }
  })
  const move = (delta: number) => {
    if (focus() !== "list") { try { detail?.scrollBy(delta) } catch { /* Detail scroll is best-effort. */ } return }
    const visible = visibleEvents()
    const next = selectionIndex(visible, eventID(), delta)
    if (next >= 0) setEventID(visible[next].id)
  }
  const toneColor = (tone: string) => {
    const palette = colors()
    switch (tone) {
      case "info": return palette.info
      case "warning": return palette.warning
      case "accent": return palette.accent
      case "secondary": return palette.secondary
      case "muted": return palette.muted
      case "text": return palette.base
      default: return palette.base
    }
  }
  const commands = [
    { bind: "up", run: () => move(-1) },
    { bind: "k", run: () => move(-1) },
    { bind: "down", run: () => move(1) },
    { bind: "j", run: () => move(1) },
    { bind: "left", run: () => setFocus("list") },
    { bind: "h", run: () => setFocus("list") },
    { bind: "right", run: () => setFocus("detail") },
    { bind: "l", run: () => setFocus("detail") },
    { bind: "pageup", run: () => { try { detail?.scrollBy(-10) } catch { /* Detail scroll is best-effort. */ } } },
    { bind: "pagedown", run: () => { try { detail?.scrollBy(10) } catch { /* Detail scroll is best-effort. */ } } },
    ...filterHints.map(({ bind, filter: key }) => ({ bind, run: () => setFilter((current) => toggleFilter(current, key as Exclude<EventFilter, undefined>)) })),
    { bind: "c", run: () => setFilter(undefined) },
    { bind: "escape", run: () => props.panel.close() },
  ]
  context.keymap.layer(() => ({ commands }))
  const item = () => visibleEvents()[selectionIndex(visibleEvents(), eventID(), 0)]
  const panelWidth = () => { const width = (props.panel as any).width; return typeof width === "function" ? width() : width ?? 120 }
  const narrow = () => panelWidth() < 80
  const roomy = () => panelWidth() >= 80
  const cozy = () => panelWidth() >= 50
  const listFocused = () => focus() === "list"
  const headerFilter = () => filter() ?? "all"
  const paneNames = () => focusParts(focus())
  const shortLabel = (label: string) => (label === "assistant text" ? "text" : label === "thinking" ? "think" : label)
  const eventBody = () => eventDetail(item())
  const eventMd = () => eventMarkdown(item())
  const rowWidth = () => Math.max(24, Math.floor((narrow() ? panelWidth() : panelWidth() * 0.35) - 4))
  const listBorder = () => paneBorders(narrow(), focus()).list
  const detailBorder = () => paneBorders(narrow(), focus()).detail
  return <box flexDirection="column" width="100%" height="100%">
    <box flexDirection="column" width="100%" flexShrink={0} backgroundColor={colors().headerBg} border={["bottom"]} borderStyle="single" borderColor={colors().borderSubtle}>
      <box flexDirection="row" width="100%" height={1}>
        <text fg={colors().base}>Trace {visibleEvents().length} {headerFilter()} </text>
        <text fg={colors().muted}>[</text>
        <text fg={listFocused() ? colors().base : colors().muted}>{paneNames()[0]}</text>
        <text fg={colors().muted}> | </text>
        <text fg={listFocused() ? colors().muted : colors().base}>{paneNames()[1]}</text>
        <text fg={colors().muted}>] </text>
        <Show when={cozy()}>
          <text fg={colors().muted}>• </text>
          <For each={filterHints}>{({ bind, filter: key, label }) => <text fg={filter() === key ? colors().accent : colors().muted}>{filter() === key ? `<${bind}${roomy() ? ` ${shortLabel(label)}` : ""}> ` : `${bind}${roomy() ? ` ${shortLabel(label)}` : ""} `}</text>}</For>
          <text fg={filter() === undefined ? colors().accent : colors().muted}>{filter() === undefined ? `<c${roomy() ? " all" : ""}> ` : `c${roomy() ? " all" : ""} `}</text>
        </Show>
        <Show when={roomy() && headerFitsEscHint(panelWidth(), visibleEvents().length, headerFilter())}><text fg={colors().muted}>• ←→ ↑↓ esc</text></Show>
      </box>
    </box>
    <Show when={error()}><text>{error()}</text></Show>
    <For each={trace().warnings}>{(warning: string) => <text>{warning}</text>}</For>
    <Show when={!visibleEvents().length}><text fg={colors().muted}>{trace().items.length ? `No events match this filter — press c to show all.` : `No events yet.`}</text></Show>
    <box flexDirection={narrow() ? "column" : "row"} flexGrow={1} minHeight={0}>
      <box flexDirection="column" width={narrow() ? "100%" : "35%"} height={narrow() ? "40%" : "100%"} minHeight={0} border={listBorder()} borderStyle="single" borderColor={colors().borderActive}>
        <scrollbox ref={listBox} width="100%" flexGrow={1} minHeight={0}><For each={visibleEvents()}>{(entry: any) => {
          const selected = () => entry.id === eventID()
          return <box id={`evt:${entry.id}`} width="100%" height={1} backgroundColor={selected() ? colors().selectedBg : undefined} onMouseDown={() => { setEventID(entry.id); setFocus("list") }}>
            <text fg={selected() ? (listFocused() ? colors().base : colors().muted) : toneColor(eventTone(entry.kind))}>{selected() ? selectionMarker(focus()) : "  "}{eventRow(entry, rowWidth())}</text>
          </box>
        }}</For></scrollbox>
      </box>
      <box flexDirection="column" width={narrow() ? "100%" : "65%"} height={narrow() ? "60%" : "100%"} minHeight={0} border={detailBorder()} borderStyle="single" borderColor={colors().borderActive}>
        <scrollbox ref={detail} width="100%" flexGrow={1} minHeight={0} onMouseDown={() => setFocus("detail")}>
          <Show when={syntax()} fallback={<text>{eventBody()}</text>}>
            <markdown content={eventMd()} syntaxStyle={syntax()} />
          </Show>
        </scrollbox>
      </box>
    </box>
  </box>
}

export default Plugin.define({
  id: "context-trace.tui",
  setup(context) {
    context.keymap.layer(() => ({ mode: "global", commands: [{ id: "context-trace.open", title: "Context Trace: Open Timeline", palette: true, slash: { name: "trace", aliases: ["ctx-trace", "timeline"] }, run: () => { if (!context.ui.panel.open("context-trace.panel", { presentation: "fullscreen" })) context.ui.toast.show({ message: "Open a session first", variant: "warning" }) } }] }))
    return context.ui.slot({ append: "session.panel", render: (panel) => <Show when={panel.name === "context-trace.panel"}><ContextTracePanel panel={panel} /></Show> })
  },
})
