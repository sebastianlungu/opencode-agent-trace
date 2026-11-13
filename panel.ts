export function selectionIndex(items: { id: string }[], id: string | undefined, move: number) {
  if (!items.length) return -1
  const current = Math.max(0, items.findIndex((item) => item.id === id))
  return Math.max(0, Math.min(items.length - 1, current + move))
}

export function panelContent(view: number, item: any, snapshot: any) {
  if (view === 1) return item?.detail ?? "No timeline event selected."
  if (!snapshot) return "Select a snapshot with Tab and j/k to inspect captured context."
  if (view === 2 && snapshot.deltaMessages === null) return "Delta unavailable: the preceding snapshot could not be read."
  return JSON.stringify(view === 2 ? snapshot.deltaMessages : view === 3 ? snapshot.messages : { system: snapshot.system, tools: snapshot.tools }, null, 2)
}
