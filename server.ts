import { Plugin } from "@opencode/plugin"
import { ContextTraceRpc } from "./rpc"
import { timeline } from "./trace"

export default Plugin.define({
  id: "context-trace",
  async setup(ctx) {
    const registration = await ctx.rpc.register(ContextTraceRpc, {
      getTrace: async (input) => {
        const { sessionID } = input as { sessionID: string }
        const messages = await ctx.session.context({ sessionID })
        return JSON.parse(JSON.stringify({ sessionID, warnings: [], items: timeline(messages as any[]) }))
      },
    })
    return async () => {
      try { await (registration as any)?.dispose?.() }
      catch { /* Unload proceeds even if RPC teardown fails. */ }
    }
  },
})
