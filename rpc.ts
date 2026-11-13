import { Rpc } from "@opencode/plugin/rpc"

export const ContextTraceRpc = Rpc.define({
  id: "context-trace",
  methods: { getTrace: {
    input: { type: "object", properties: { sessionID: { type: "string" } }, required: ["sessionID"], additionalProperties: false },
    output: { type: "object", properties: { sessionID: { type: "string" }, snapshots: { type: "array", items: {} }, items: { type: "array", items: {} }, warnings: { type: "array", items: { type: "string" } } }, required: ["sessionID", "snapshots", "items", "warnings"] },
  }, getSnapshot: {
    input: { type: "object", properties: { sessionID: { type: "string" }, snapshotID: { type: "string" } }, required: ["sessionID", "snapshotID"], additionalProperties: false },
    output: { type: "object", properties: { snapshot: {}, warnings: { type: "array", items: { type: "string" } } }, required: ["snapshot", "warnings"] },
  } },
  events: { snapshotCaptured: { schema: { type: "object", properties: { sessionID: { type: "string" } }, required: ["sessionID"], additionalProperties: false } } },
})
