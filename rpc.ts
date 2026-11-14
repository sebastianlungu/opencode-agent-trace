import { Rpc } from "@opencode/plugin/rpc"

export const ContextTraceRpc = Rpc.define({
  id: "context-trace",
  methods: { getTrace: {
    input: { type: "object", properties: { sessionID: { type: "string" } }, required: ["sessionID"], additionalProperties: false },
    output: { type: "object", properties: { sessionID: { type: "string" }, items: { type: "array", items: {} }, warnings: { type: "array", items: { type: "string" } } }, required: ["sessionID", "items", "warnings"] },
  } },
  events: {},
})
