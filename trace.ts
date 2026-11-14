const badges: Record<string, string> = { skill: "SKILL", read: "READ", grep: "GREP", glob: "GREP", shell: "CLI", execute: "MCP/CODE", webfetch: "WEB", websearch: "WEB", subagent: "AGENT", question: "ASK" }
const string = (value: any) => typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2)
const raw = (value: any) => typeof value === "string" ? value : value === undefined || value === null ? "" : JSON.stringify(value, null, 2)
const isTextBlock = (block: any): block is { text: string } =>
  !!block && typeof block === "object" && (block as any).type === "text" && typeof (block as any).text === "string"
const stripOneSkillWrapper = (text: string): string | undefined => {
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
const stripSkillWrapper = (text: string): string => {
  let current = text
  for (let depth = 0; depth < 5; depth++) {
    const stripped = stripOneSkillWrapper(current)
    if (stripped === undefined) break
    current = stripped
  }
  return current
}
const readable = (value: any): string => {
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed.length >= 2 && trimmed.startsWith('"')) {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        if (typeof parsed === "string") return stripSkillWrapper(parsed)
      } catch { /* Preserve original payload when decoding is unsafe. */ }
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isTextBlock)) {
          return stripSkillWrapper(parsed.map((block) => block.text).join("\n"))
        }
      } catch { /* Preserve unrecognized JSON verbatim. */ }
    }
    return stripSkillWrapper(value)
  }
  if (Array.isArray(value)) {
    return stripSkillWrapper(value.map((block) => isTextBlock(block) ? block.text : raw(block)).join("\n"))
  }
  return raw(value)
}
const firstLine = (value: any, fallback: string): string => {
  const text = raw(value).replace(/\s+/g, " ").trim()
  return text || fallback
}
const preview = (value: string, width = 120): string => {
  const chars = Array.from(value.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/^#{1,6}\s+/, "").replace(/\s+/g, " ").trim())
  return chars.length > width ? `${chars.slice(0, width - 1).join("")}…` : chars.join("")
}
const prettyInput = (value: any, indent = ""): string => {
  if (typeof value === "string") return value
  if (typeof value !== "object" || value === null) return JSON.stringify(value ?? "")
  if (Array.isArray(value)) return value.map((entry) => `${indent}- ${prettyInput(entry, `${indent}  `).replace(/^\s+/, "")}`).join("\n") || `${indent}[]`
  const keys = Object.keys(value)
  if (!keys.length) return `${indent}{}`
  return keys.map((key) => {
    const rendered = prettyInput(value[key], `${indent}  `)
    return rendered.includes("\n") ? `${indent}${key}:\n${rendered}` : `${indent}${key}: ${rendered.replace(/^  /, "")}`
  }).join("\n")
}
const fenceFor = (...contents: string[]): string => {
  let longest = 0
  for (const content of contents) {
    for (const run of content.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  }
  return "`".repeat(Math.max(3, longest + 1))
}
const toolBody = (info: { input: any, output: string, error: any, status: any, duration: number | undefined, chars: number, estimatedTokens: number }, kind?: string) => {
  const isSkill = kind === "skill"
  const sections: string[] = []
  if (info.input !== undefined) {
    const rendered = prettyInput(info.input, "")
    const fence = fenceFor(rendered)
    sections.push(`### Input\n\n${fence}text\n${rendered}\n${fence}`)
  }
  const outputText = info.output || "(empty)"
  if (isSkill) {
    sections.push(`### Output\n\n${outputText}`)
  } else {
    const fence = fenceFor(outputText)
    sections.push(`### Output\n\n${fence}text\n${outputText}\n${fence}`)
  }
  if (info.error) {
    const errorText = raw(info.error)
    const fence = fenceFor(errorText)
    sections.push(`### Error\n\n${fence}text\n${errorText}\n${fence}`)
  }
  const meta = [`status: ${info.status ?? "unknown"}`, `chars: ${info.chars}`, `~tokens: ${info.estimatedTokens}`]
  if (info.duration !== undefined) meta.push(`duration: ${info.duration}ms`)
  sections.push(`_${meta.join("  •  ")}_`)
  return sections.join("\n\n")
}
const inputSummary = (tool: string, input: any): string | undefined => {
  if (typeof input === "string") return preview(input)
  if (!input || typeof input !== "object") return undefined
  for (const key of ["path", "file", "command", "url", "question", "prompt", "query", "pattern", "id", "description"]) {
    if (typeof input[key] === "string" && input[key].trim()) return preview(input[key])
  }
  return undefined
}
export function timeline(messages: any[]) {
  const items: any[] = []
  for (const [messageIndex, message] of messages.entries()) {
    const id = message.id ?? `position:${messageIndex}`
    const type = message.type ?? message.role
    if (type === "assistant") {
      let emitted = false
      const rawParts = message.content ?? message.parts
      const parts = Array.isArray(rawParts) ? rawParts : typeof rawParts === "string" ? [{ type: "text" as const, text: rawParts }] : []
      for (const [partIndex, part] of parts.entries()) {
        const name = part.name ?? part.tool
        if (part.type === "text") {
          const text = raw(part.text ?? "")
          items.push({ id: `message:${id}:part:${part.id ?? partIndex}`, badge: "TEXT", title: preview(firstLine(text, "(empty text)")), detail: string(text), body: text || "(empty text)", kind: "text", prose: true })
          emitted = true
        } else if (part.type === "reasoning") {
          const text = raw(part.text ?? "")
          items.push({ id: `message:${id}:part:${part.id ?? partIndex}`, badge: "THINK", title: preview(firstLine(text, "Reasoning text hidden by provider.")), detail: text || "Reasoning text hidden by provider.", body: text || "Reasoning text hidden by provider.", kind: "thinking", prose: true })
          emitted = true
        } else if (part.type === "tool") {
          const badge = badges[name] ?? "TOOL"
          const kind = badge === "SKILL" ? "skill" : "tool"
          const output = readable(part.state?.content ?? part.state?.output ?? part.text ?? "")
          const start = part.time?.start ?? part.time?.ran ?? part.time?.created
          const end = part.time?.end ?? part.time?.completed
          const duration = typeof start === "number" && typeof end === "number" ? end - start : undefined
          const title = kind === "skill"
            ? String(part.state?.input?.id ?? name ?? "skill")
            : preview(inputSummary(name, part.state?.input) ?? firstLine(output, name ?? "tool"))
          const detail = string({ input: part.state?.input, output, error: part.state?.error, status: part.state?.status, duration, chars: output.length, estimatedTokens: Math.ceil(output.length / 4) })
          const error = part.state?.error, status = part.state?.status
          const body = toolBody({ input: part.state?.input, output, error, status, duration, chars: output.length, estimatedTokens: Math.ceil(output.length / 4) }, kind)
          items.push({ id: `message:${id}:part:${part.id ?? partIndex}`, badge, title, detail, body, kind })
          emitted = true
        }
      }
      if (!emitted) items.push({ id: `message:${id}`, badge: "OTHER", title: "(empty response)", detail: string(message), body: raw(message.content ?? message.parts ?? ""), kind: "other" })
    } else {
      const badge = type === "user" ? "USER" : type === "skill" ? "SKILL" : type === "compaction" ? "COMPACT" : "OTHER"
      const text = raw(message.text ?? (typeof message.parts === "string" ? message.parts : undefined) ?? (typeof message.content === "string" ? message.content : undefined) ?? "")
      const kind = badge === "USER" ? "user" : badge === "SKILL" ? "skill" : "other"
      items.push({ id: `message:${id}`, badge, title: preview(firstLine(text, badge === "OTHER" ? "(unknown event)" : "(empty message)")), detail: string(message.text ?? message.parts ?? message.content ?? message), body: text, kind, prose: kind === "user" || kind === "skill" })
    }
  }
  return items
}
