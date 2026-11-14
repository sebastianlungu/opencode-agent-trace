export type EventFilter = "skill" | "thinking" | "tool" | "user" | "text" | undefined

export type PaneFocus = "list" | "detail"

export function focusParts(focus: PaneFocus): [string, string] {
  return focus === "list" ? ["EVENTS", "detail"] : ["events", "DETAIL"]
}

export function focusLabel(focus: PaneFocus): string {
  const [first, second] = focusParts(focus)
  return `[${first} | ${second}]`
}

export function selectionMarker(focus: PaneFocus): string {
  return focus === "list" ? "▶ " : "› "
}

export function listPaneBorder(narrow: boolean, focus: PaneFocus): ("bottom" | "right")[] {
  if (focus !== "list") return []
  return narrow ? ["bottom"] : ["right"]
}

export function detailPaneBorder(narrow: boolean, focus: PaneFocus): ("top" | "left")[] {
  if (focus !== "detail") return []
  return narrow ? ["top"] : ["left"]
}

// Whether the trailing key-hint fits on the single header row next to the
// focus bracket: "Trace "(6) + count + " "(1) + filter + " "(1) +
// "[EVENTS | detail]"(16) + " "(1) + "• "(2) + full filter hints(45) +
// "• ←→ ↑↓ esc"(11) = 83 + digits + filter length.
export function headerFitsEscHint(panelWidth: number, count: number, filterLabel: string): boolean {
  return panelWidth >= 83 + String(count).length + filterLabel.length
}

export function toggleFilter(current: EventFilter, key: Exclude<EventFilter, undefined>): EventFilter {
  return current === key ? undefined : key
}

export function filterItems<T extends { kind?: string }>(items: T[], filter: EventFilter): T[] {
  if (!filter) return items
  return items.filter((item) => item.kind === filter)
}

export function eventDetail(item: any): string {
  if (!item) return "No timeline event selected."
  if (typeof item.body === "string" && item.body) return item.body
  return item.detail ?? "No timeline event selected."
}

export function codeFence(content: string): string {
  const longest = (content.match(/`+/g) ?? []).reduce((width, run) => Math.max(width, run.length), 0)
  return "`".repeat(Math.max(3, longest + 1))
}

export function eventMarkdown(item: any): string {
  const body = typeof item?.body === "string" && item.body ? item.body : item?.detail ?? ""
  if (!item) return "No timeline event selected."
  if (item.kind === "text" || item.kind === "thinking" || item.kind === "user") return body || "No timeline event selected."
  const title = item.badge && item.title ? `**[${item.badge}] ${item.title}**\n\n` : ""
  if (item.kind === "skill") {
    const cleaned = stripSkillSection(body)
    return `${title}${cleaned || "No timeline event selected."}`
  }
  if (typeof body === "string" && (body.includes("```") || /(^|\n)###\s/.test(body))) {
    return `${title}${body || "No timeline event selected."}`
  }
  const fence = codeFence(body)
  return `${title}${fence}text\n${body}\n${fence}`
}

function stripOneSkillSection(text: string): string | undefined {
  const open = /^\s*<skill_content\b((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(text)
  if (!open) return undefined
  const openEnd = open[0].length
  const tag = /<skill_content\b(?:[^>"']|"[^"]*"|'[^']*')*>|<\/skill_content\s*>/g
  tag.lastIndex = openEnd
  let depth = 1
  let match: RegExpExecArray | null
  while ((match = tag.exec(text)) !== null) {
    if (match[0].startsWith("</")) {
      depth--
      if (depth === 0) {
        if (!/^\s*$/.test(text.slice(tag.lastIndex))) return undefined
        return text.slice(openEnd, match.index)
      }
    } else {
      depth++
    }
  }
  return undefined
}

function stripSkillSection(text: string): string {
  if (typeof text !== "string") return ""
  let current = text
  for (let depth = 0; depth < 5; depth++) {
    const stripped = stripOneSkillSection(current)
    if (stripped === undefined) break
    current = stripped
  }
  return current
}

export function eventIcon(kind: string | undefined): string {
  switch (kind) {
    case "user": return "👤"
    case "text": return "💬"
    case "thinking": return "🧠"
    case "skill": return "✨"
    case "tool": return "🔧"
    default: return "•"
  }
}

export function eventTone(kind: string | undefined): string {
  switch (kind) {
    case "user": return "info"
    case "text": return "text"
    case "thinking": return "warning"
    case "skill": return "accent"
    case "tool": return "secondary"
    default: return "muted"
  }
}

export function eventRow(item: any, width = 64): string {
  if (!item) return "• —"
  const icon = eventIcon(item.kind)
  const badge = typeof item.badge === "string" && item.badge ? item.badge : "EVENT"
  let preview = typeof item.title === "string" && item.title.trim() ? item.title.replace(/\s+/g, " ").trim() : "(no preview)"
  if (preview.toLowerCase() === badge.toLowerCase()) preview = "(no preview)"
  const chars = Array.from(`${icon} ${badge} — ${preview}`)
  return chars.length > width ? `${chars.slice(0, width - 1).join("")}…` : chars.join("")
}

export function selectionIndex(items: { id: string }[], id: string | undefined, move: number) {
  if (!items.length) return -1
  const current = Math.max(0, items.findIndex((item) => item.id === id))
  return Math.max(0, Math.min(items.length - 1, current + move))
}

export function ensureVisible(top: number, selected: number, viewport: number): number {
  const from = Number.isFinite(top) && top > 0 ? Math.floor(top) : 0
  const at = Number.isFinite(selected) ? Math.floor(selected) : 0
  const view = Number.isFinite(viewport) && viewport > 0 ? Math.floor(viewport) : 1
  if (at < from) return Math.max(0, at)
  if (at >= from + view) return Math.max(0, at - view + 1)
  return from
}
