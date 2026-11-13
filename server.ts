import { Plugin } from "@opencode/plugin"
import { homedir } from "node:os"
import { join } from "node:path"
import { ContextTraceRpc } from "./rpc"
import { createCaptureQueue, maxBytesOption, snapshotFor, snapshotsFor, timeline } from "./trace"

const directory = join(homedir(), ".local/share/opencode/context-trace")

export default Plugin.define({
  id: "context-trace",
  async setup(ctx) {
    const maxBytes = maxBytesOption(ctx.options.maxBytes)
    const registration = await ctx.rpc.register(ContextTraceRpc, {
      getTrace: async (input) => {
        const { sessionID } = input as { sessionID: string }
        const [messages, loaded] = await Promise.all([ctx.session.context({ sessionID }), snapshotsFor(directory, sessionID)])
        return JSON.parse(JSON.stringify({ sessionID, ...loaded, items: timeline(messages as any[]) }))
      },
      getSnapshot: async (input) => {
        const { sessionID, snapshotID } = input as { sessionID: string, snapshotID: string }
        return snapshotFor(directory, sessionID, snapshotID)
      },
    })
    const enqueue = createCaptureQueue(directory, (sessionID) => registration.events.emit("snapshotCaptured", { sessionID }), { report: (message) => console.warn(message), maxBytes })
    let hook
    try { hook = await ctx.session.hook("context", async (event) => { enqueue(event) }) }
    catch (error) { await registration.dispose(); throw error }
    return async () => {
      const closing = enqueue.close()
      try { await hook.dispose() }
      finally {
        try { await closing }
        finally { await registration.dispose() }
      }
    }
  },
})
