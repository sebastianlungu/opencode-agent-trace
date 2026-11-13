import { createHash, randomUUID } from "node:crypto"
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rmdir, unlink } from "node:fs/promises"
import { join } from "node:path"

const sessionPath = (root: string, id: string) => {
  if (typeof id !== "string" || !id.startsWith("ses")) throw new Error("Invalid session ID")
  return join(root, `session-${createHash("sha256").update(Buffer.from(id, "utf16le")).digest("hex")}`)
}

export async function snapshotsFor(root: string, id: string): Promise<{ snapshots: any[], warnings: string[] }> {
  const directory = sessionPath(root, id)
  let files: string[]
  try { files = await readdir(directory) }
  catch (error: any) { if (error.code === "ENOENT") return { snapshots: [], warnings: [] }; throw error }
  const snapshots = files.filter((name) => /^\d+-[0-9a-f-]+\.json$/.test(name)).sort().flatMap((name) => {
    const timestamp = Number(name.split("-")[0])
    return Number.isFinite(new Date(timestamp).getTime()) ? [{ id: name, timestamp }] : []
  })
  return { snapshots, warnings: [] }
}

export async function snapshotFor(root: string, id: string, name: string) {
  const { snapshots } = await snapshotsFor(root, id)
  const index = snapshots.findIndex((snapshot) => snapshot.id === name)
  if (index < 0) throw new Error("Snapshot not found")
  const directory = sessionPath(root, id)
  const read = async (file: string) => {
    const snapshot = JSON.parse(await readFile(join(directory, file), "utf8"))
    if (!snapshot || snapshot.sessionID !== id || !Array.isArray(snapshot.messages) || !Number.isFinite(snapshot.timestamp) || !Number.isFinite(new Date(snapshot.timestamp).getTime())) throw new Error("Invalid snapshot")
    return snapshot
  }
  const warnings: string[] = []
  let snapshot: any
  try { snapshot = await read(name) }
  catch { return { snapshot: null, warnings: [`Unable to read snapshot ${name}.`] } }
  let previous: any[] | null = []
  if (index > 0) {
    try { previous = (await read(snapshots[index - 1].id)).messages }
    catch { previous = null; warnings.push(`Unable to read preceding snapshot ${snapshots[index - 1].id}; delta unavailable.`) }
  }
  let common = 0
  while (previous && common < previous.length && common < snapshot.messages.length && JSON.stringify(previous[common]) === JSON.stringify(snapshot.messages[common])) common++
  return { snapshot: { ...snapshot, id: name, deltaMessages: previous ? snapshot.messages.slice(common) : null }, warnings }
}

export const defaultMaxBytes = 1024 * 1024 * 1024

export function maxBytesOption(value: unknown): number {
  if (value === undefined) return defaultMaxBytes
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Context Trace: maxBytes must be a non-negative safe integer")
  return value
}

async function diskBytes(directory: string, root = false): Promise<number> {
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (root && entry.name === ".capture-lock") continue
    const path = join(directory, entry.name)
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error("Unexpected symbolic link")
    if (info.isDirectory()) total += await diskBytes(path)
    else if (info.isFile()) total += info.size
    else throw new Error("Unexpected filesystem entry")
  }
  return total
}

async function lock(root: string): Promise<string> {
  const path = join(root, ".capture-lock")
  const deadline = Date.now() + 2000
  for (;;) {
    try { await mkdir(path, { mode: 0o700 }); return path }
    catch (error: any) {
      if (error.code !== "EEXIST" || Date.now() >= deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

type CaptureOptions = { report: (message: string) => void, maxBytes?: number }
const report = (options: CaptureOptions, message: string) => { try { options.report(message) } catch { /* Diagnostics cannot interrupt a model call. */ } }
const serialize = (event: any, timestamp: number) => JSON.stringify({ timestamp, sessionID: event.sessionID, agent: event.agent, model: event.model, options: event.options, system: event.system, tools: Object.entries(event.tools ?? {}).map(([name, tool]: [string, any]) => ({ name, description: tool.description ?? "", schema: tool.input })), messages: event.messages })

async function save(root: string, sessionID: string, timestamp: number, data: string, emit: () => Promise<void>, options: CaptureOptions) {
  try {
    const directory = sessionPath(root, sessionID)
    const maxBytes = maxBytesOption(options.maxBytes)
    await mkdir(root, { recursive: true, mode: 0o700 })
    await chmod(root, 0o700)
    const held = await lock(root)
    try {
      if (await diskBytes(root, true) + Buffer.byteLength(data) > maxBytes) {
        report(options, "Context Trace: disk size limit reached; capture skipped and existing snapshots retained.")
        return
      }
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await chmod(directory, 0o700)
      const name = `${timestamp}-${randomUUID()}`
      const temporary = join(directory, `${name}.tmp`)
      const file = await open(temporary, "wx", 0o600)
      try {
        try { await file.writeFile(data) } finally { await file.close() }
        await rename(temporary, join(directory, `${name}.json`))
      } catch (error) {
        await unlink(temporary).catch(() => report(options, "Context Trace: temporary capture cleanup failed; sensitive data may remain."))
        throw error
      }
    } finally { await rmdir(held) }
    await emit()
  } catch {
    report(options, "Context Trace: capture or notification failed; snapshot may be missing.")
  }
}

export async function capture(root: string, event: any, emit: () => Promise<void>, options: CaptureOptions) {
  if (options.maxBytes === 0) return
  try {
    const timestamp = Date.now()
    await save(root, event.sessionID, timestamp, serialize(event, timestamp), emit, options)
  } catch { report(options, "Context Trace: capture or notification failed; snapshot may be missing.") }
}

export function createCaptureQueue(root: string, emit: (sessionID: string) => Promise<void>, options: CaptureOptions) {
  const maxItems = 16, maxPendingBytes = 16 * 1024 * 1024
  const queue: { sessionID: string, timestamp: number, data: string, bytes: number }[] = []
  let pendingBytes = 0, active = false, closed = false
  let running: Promise<void> | undefined
  const drain = async () => {
    while (queue.length) {
      const item = queue[0]
      active = true
      try { await save(root, item.sessionID, item.timestamp, item.data, () => emit(item.sessionID), options) }
      finally { queue.shift(); pendingBytes -= item.bytes; active = false }
    }
    running = undefined
  }
  const enqueue = (event: any) => {
    if (closed || options.maxBytes === 0) return
    if (queue.length >= maxItems) { report(options, "Context Trace: capture queue full; capture skipped."); return }
    try {
      const timestamp = Date.now(), sessionID = event.sessionID
      const data = serialize(event, timestamp), bytes = Buffer.byteLength(data)
      if (bytes > maxPendingBytes - pendingBytes) { report(options, "Context Trace: capture queue memory limit reached; capture skipped."); return }
      queue.push({ sessionID, timestamp, data, bytes })
      pendingBytes += bytes
      if (!running) running = new Promise<void>((resolve) => { setImmediate(() => { void drain().then(resolve) }) })
    } catch { report(options, "Context Trace: capture or notification failed; snapshot may be missing.") }
  }
  enqueue.close = async () => {
    closed = true
    queue.splice(active ? 1 : 0)
    pendingBytes = active ? queue[0].bytes : 0
    await running
  }
  return enqueue
}

const badges: Record<string, string> = { skill: "SKILL", read: "READ", grep: "GREP", glob: "GREP", shell: "CLI", execute: "MCP/CODE", webfetch: "WEB", websearch: "WEB", subagent: "AGENT", question: "ASK" }
const string = (value: any) => typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2)
export function timeline(messages: any[]) {
  const items: any[] = []
  let step = 0
  for (const [messageIndex, message] of messages.entries()) {
    const id = message.id ?? `position:${messageIndex}`
    const type = message.type ?? message.role
    if (type === "assistant") {
      step++
      items.push({ id: `message:${id}`, badge: `STEP #${step}`, title: string(message.model ?? "Assistant"), detail: string({ model: message.model, tokens: message.tokens, cost: message.cost, time: message.time }) })
      for (const [partIndex, part] of (message.content ?? message.parts ?? []).entries()) {
        const name = part.name ?? part.tool
        const badge = part.type === "tool" ? badges[name] ?? "TOOL" : part.type === "reasoning" ? "THINK" : part.type === "text" ? "TEXT" : undefined
        if (!badge) continue
        const output = string(part.state?.content ?? part.state?.output ?? part.text ?? "")
        const start = part.time?.start ?? part.time?.ran ?? part.time?.created
        const end = part.time?.end ?? part.time?.completed
        const detail = part.type === "tool" ? string({ input: part.state?.input, output, error: part.state?.error, status: part.state?.status, duration: typeof start === "number" && typeof end === "number" ? end - start : undefined, chars: output.length, estimatedTokens: Math.ceil(output.length / 4) }) : output || "Reasoning text hidden by provider."
        items.push({ id: `message:${id}:part:${part.id ?? partIndex}`, badge, title: name === "skill" ? `Skill "${part.state?.input?.id ?? ""}"` : name ?? badge, detail, child: true })
      }
    } else {
      const badge = type === "user" ? "USER" : type === "skill" ? "SKILL" : type === "compaction" ? "COMPACT" : undefined
      if (badge) items.push({ id: `message:${id}`, badge, title: badge, detail: string(message.text ?? message.parts ?? message.content ?? message) })
    }
  }
  return items
}
