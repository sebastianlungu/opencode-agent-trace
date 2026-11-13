import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, onCleanup, Show, For } from "solid-js"
import { ContextTraceRpc } from "./rpc"
import { panelContent, selectionIndex } from "./panel"

function ContextTracePanel(props: { panel: any }) {
  const context = usePlugin()
  const [trace, setTrace] = createSignal<any>({ items: [], snapshots: [], warnings: [] })
  const [eventID, setEventID] = createSignal<string>()
  const [snapshotID, setSnapshotID] = createSignal<string>()
  const [loadedSnapshot, setLoadedSnapshot] = createSignal<any>()
  const [snapshotWarnings, setSnapshotWarnings] = createSignal<string[]>([])
  const [list, setList] = createSignal<"events" | "snapshots">("events")
  const [view, setView] = createSignal(1)
  const [error, setError] = createSignal("")
  let detail: any
  let listBox: any
  let request = 0
  let snapshotRequest = 0
  let snapshotLoading = false
  let pendingSnapshot: { id: string, request: number } | undefined
  const loadSnapshot = async () => {
    if (snapshotLoading) return
    snapshotLoading = true
    while (pendingSnapshot) {
      const current = pendingSnapshot
      pendingSnapshot = undefined
      try {
        const result: any = await context.client.rpc(ContextTraceRpc).getSnapshot({ sessionID: props.panel.sessionID, snapshotID: current.id })
        if (current.request !== snapshotRequest) continue
        const loaded = result.data ?? result
        setLoadedSnapshot(loaded.snapshot)
        setSnapshotWarnings(loaded.warnings)
      } catch {
        if (current.request === snapshotRequest) setSnapshotWarnings(["Unable to load selected snapshot."])
      }
    }
    snapshotLoading = false
  }
  const applyTrace = (next: any) => {
    setEventID(next.items[selectionIndex(next.items, eventID(), 0)]?.id)
    setSnapshotID(next.snapshots[selectionIndex(next.snapshots, snapshotID(), 0)]?.id)
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
      applyTrace({ snapshots: [], warnings: [], items: messages.map((message: any, index: number) => ({ id: `message:${message.id ?? `position:${index}`}`, badge: message.type ?? message.role ?? "MESSAGE", title: message.id, detail: JSON.stringify(message, null, 2) })) })
      setError(`RPC unavailable: ${String(cause)}`)
    }
  }
  void refresh()
  const stop = context.client.rpc(ContextTraceRpc).events.on("snapshotCaptured", (event: any) => {
    if (event.data.sessionID === props.panel.sessionID) void refresh()
  })
  onCleanup(() => { request++; snapshotRequest++; pendingSnapshot = undefined; stop() })
  createEffect(() => {
    const id = snapshotID()
    const currentTrace = trace()
    const current = ++snapshotRequest
    pendingSnapshot = undefined
    setLoadedSnapshot(undefined)
    setSnapshotWarnings([])
    if (!id || !currentTrace.snapshots.some((entry: any) => entry.id === id)) return
    pendingSnapshot = { id, request: current }
    void loadSnapshot()
  })
  const entries = () => list() === "events" ? trace().items : trace().snapshots
  const selected = () => list() === "events" ? eventID() : snapshotID()
  const index = () => selectionIndex(entries(), selected(), 0)
  createEffect(() => { listBox?.scrollTo(Math.max(0, index())) })
  const move = (delta: number) => {
    const next = selectionIndex(entries(), selected(), delta)
    if (next < 0) return
    if (list() === "events") setEventID(entries()[next].id)
    else setSnapshotID(entries()[next].id)
    listBox?.scrollTo(next)
  }
  const switchList = () => {
    setList((value) => value === "events" ? "snapshots" : "events")
    listBox?.scrollTo(Math.max(0, index()))
  }
  const commands = [
    { bind: "j", run: () => move(1) },
    { bind: "down", run: () => move(1) },
    { bind: "k", run: () => move(-1) },
    { bind: "up", run: () => move(-1) },
    { bind: "tab", run: switchList },
    ...["1", "2", "3", "4"].map((key) => ({ bind: key, run: () => setView(Number(key)) })),
    ...["d", "pagedown"].map((bind) => ({ bind, run: () => detail?.scrollBy(10) })),
    ...["u", "pageup"].map((bind) => ({ bind, run: () => detail?.scrollBy(-10) })),
    { bind: "f", run: () => props.panel.toggleFullscreen() },
    { bind: "r", run: () => void refresh() },
    ...["q", "escape"].map((bind) => ({ bind, run: () => props.panel.close() })),
  ]
  context.keymap.layer(() => ({ commands }))
  const item = () => trace().items[selectionIndex(trace().items, eventID(), 0)]
  const content = () => panelContent(view(), item(), loadedSnapshot())
  return <box flexDirection="column" width="100%" height="100%">
    <text fg={context.theme.text.base}>Context Trace — Tab events/snapshots • j/k select • u/d detail • 1 event • 2 delta • 3 context • 4 system/tools • r refresh • f fullscreen • q close</text>
    <Show when={error()}><text>{error()}</text></Show>
    <For each={trace().warnings}>{(warning: string) => <text>{warning}</text>}</For>
    <For each={snapshotWarnings()}>{(warning: string) => <text>{warning}</text>}</For>
    <text>Browsing {list()} — event and snapshot selections are independent; no association is inferred.</text>
    <box flexDirection="row" flexGrow={1} minHeight={0}>
      <scrollbox ref={listBox} width="35%" height="100%"><For each={entries()}>{(entry: any, row) => <text height={1} fg={row() === index() ? context.theme.text.base : context.theme.text.muted}>{row() === index() ? "> " : "  "}{entry.child ? "  " : ""}{list() === "events" ? `[${entry.badge}] ${entry.title}` : `[SNAPSHOT] ${new Date(entry.timestamp).toISOString()} ${entry.id}`}</text>}</For></scrollbox>
      <scrollbox ref={detail} width="65%" height="100%"><text>{content()}</text></scrollbox>
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
