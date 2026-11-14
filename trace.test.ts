import { test } from 'node:test'
import assert from 'node:assert/strict'
import { timeline } from './trace.ts'
import * as panel from './panel.ts'

const assistantWithParts = (parts: any[]) => ({ id: 'a1', type: 'assistant', parts })

test('timeline has no step rows; every item carries a filter kind', () => {
  const items = timeline([
    { id: 'u1', type: 'user', text: 'hello' },
    assistantWithParts([
      { type: 'text', text: 'prose here' },
      { type: 'reasoning', text: 'thinking here' },
      { type: 'tool', tool: 'read', state: { input: { path: 'a.ts' }, output: 'ok' } },
    ]),
  ])
  assert.ok(items.length > 0)
  assert.ok(items.every((item: any) => typeof item.id === 'string' && typeof item.badge === 'string' && typeof item.title === 'string' && typeof item.detail === 'string'))
  assert.ok(!items.some((item: any) => item.kind === 'step' || /^STEP/.test(item.badge)))
  assert.ok(items.every((item: any) => ['user', 'text', 'thinking', 'skill', 'tool', 'other'].includes(item.kind)))
})

test('timeline titles are previews, never a bare badge repeat', () => {
  const items = timeline([
    assistantWithParts([
      { type: 'reasoning', text: 'first thought\nsecond thought' },
      { type: 'tool', tool: 'question', state: { input: { question: 'Which file?' }, output: 'a.ts' } },
      { type: 'tool', tool: 'read', state: { input: { path: 'src/index.ts' }, output: 'content' } },
      { type: 'tool', tool: 'skill', state: { input: { id: 'my-skill' }, output: 'done' } },
    ]),
  ])
  const byBadge = Object.fromEntries(items.map((item: any) => [item.badge, item]))
  assert.match(byBadge.THINK.title, /first thought/)
  assert.doesNotMatch(byBadge.THINK.title, /^THINK$/i)
  assert.match(byBadge.ASK.title, /Which file\?/)
  assert.doesNotMatch(byBadge.ASK.title, /^question$/i)
  assert.match(byBadge.READ.title, /src\/index\.ts/)
  assert.equal(byBadge.SKILL.title, 'my-skill')
  assert.equal(byBadge.SKILL.kind, 'skill')
})

test('timeline keeps session order and covers empty or unknown content', () => {
  const items = timeline([
    { id: 'one', type: 'user', text: 'first' },
    { id: 'two', type: 'assistant', parts: [] },
  ])
  assert.deepEqual(items.map((item: any) => item.badge), ['USER', 'OTHER'])
  assert.equal(items[0].kind, 'user')
  assert.equal(items[1].kind, 'other')
})

test('timeline survives non-array assistant content without crashing', () => {
  const fromString: any[] = timeline([{ id: 's1', type: 'assistant', content: 'plain string reply' } as any])
  assert.equal(fromString.length, 1)
  assert.equal(fromString[0].kind, 'text')
  assert.match(fromString[0].title, /plain string reply/)
  const fromMissing: any[] = timeline([{ id: 's2', type: 'assistant' } as any])
  assert.equal(fromMissing.length, 1)
  assert.equal(fromMissing[0].kind, 'other')
  const fromObject: any[] = timeline([{ id: 's3', type: 'assistant', content: { text: 'oops' } } as any])
  assert.equal(fromObject.length, 1)
  assert.equal(fromObject[0].kind, 'other')
})

test('timeline tool bodies preserve content without escaped newline JSON mess', () => {
  const items = timeline([{ type: 'assistant', parts: [{ type: 'tool', tool: 'shell', state: { input: { command: 'ls\npwd' }, output: 'a\nb' } }] }])
  const tool = items.find((item: any) => item.badge === 'CLI')
  assert.match(tool.body, /ls\npwd/)
  assert.match(tool.body, /a\nb/)
  assert.doesNotMatch(tool.body, /\\n/)
})

test('tool details show part duration and failed state error', () => {
  const items = timeline([{ type: 'assistant', parts: [{ type: 'tool', tool: 'read', time: { start: 100, end: 250 }, state: { status: 'error', error: 'permission denied' } }] }])
  const detail = JSON.parse(items.find((item: any) => item.badge === 'READ').detail)
  assert.equal(detail.duration, 150)
  assert.equal(detail.error, 'permission denied')
})

test('event filters toggle one type and the same key restores all', () => {
  assert.equal(typeof (panel as any).toggleFilter, 'function')
  assert.equal(typeof (panel as any).filterItems, 'function')
  const toggle = (panel as any).toggleFilter
  assert.equal(toggle(undefined, 'skill'), 'skill')
  assert.equal(toggle('skill', 'skill'), undefined)
  assert.equal(toggle('skill', 'tool'), 'tool')
})

test('filters show only matching events, no step or other rows', () => {
  const filterItems = (panel as any).filterItems
  const items = [
    { id: 'a', kind: 'skill' },
    { id: 'b', kind: 'tool' },
    { id: 'c', kind: 'thinking' },
    { id: 'd', kind: 'user' },
    { id: 'e', kind: 'text' },
    { id: 'f', kind: 'other' },
  ]
  assert.deepEqual(filterItems(items, undefined).map((i: any) => i.id), ['a', 'b', 'c', 'd', 'e', 'f'])
  assert.deepEqual(filterItems(items, 'skill').map((i: any) => i.id), ['a'])
  assert.deepEqual(filterItems(items, 'tool').map((i: any) => i.id), ['b'])
  assert.deepEqual(filterItems(items, 'thinking').map((i: any) => i.id), ['c'])
  assert.deepEqual(filterItems(items, 'user').map((i: any) => i.id), ['d'])
  assert.deepEqual(filterItems(items, 'text').map((i: any) => i.id), ['e'])
})

test('event rows carry emoji, badge, and preview without badge-word duplication', () => {
  const { eventRow, eventIcon, eventTone } = panel as any
  assert.equal(typeof eventRow, 'function')
  for (const kind of ['user', 'text', 'thinking', 'skill', 'tool', 'other']) {
    assert.match(String(eventIcon(kind)), /./)
    assert.match(String(eventTone(kind)), /^[a-z]+$/)
  }
  const ask = eventRow({ kind: 'tool', badge: 'ASK', title: 'Which file should I edit?' })
  assert.match(ask, /ASK/)
  assert.match(ask, /Which file should I edit\?/)
  assert.doesNotMatch(ask, /ASK.*\bask\b/i)
  const think = eventRow({ kind: 'thinking', badge: 'THINK', title: 'considering the plan' })
  assert.match(think, /THINK/)
  assert.match(think, /considering the plan/)
  assert.doesNotMatch(think, /\[THINK\] THINK/)
})

test('ensureVisible only moves the top when selection leaves the viewport', () => {
  const { ensureVisible } = panel as any
  assert.equal(typeof ensureVisible, 'function')
  assert.equal(ensureVisible(0, 3, 10), 0)
  assert.equal(ensureVisible(0, 0, 10), 0)
  assert.equal(ensureVisible(0, 10, 10), 1)
  assert.equal(ensureVisible(5, 2, 10), 2)
  assert.equal(ensureVisible(5, 14, 10), 5)
  assert.equal(ensureVisible(5, 15, 10), 6)
  assert.equal(ensureVisible(0, 0, 1), 0)
  assert.equal(ensureVisible(3, 0, 0), 0)
})

test('event markdown preserves content with safe fences', () => {
  assert.equal(typeof (panel as any).eventMarkdown, 'function')
  const markdown = (panel as any).eventMarkdown
  const prose = markdown({ kind: 'text', body: 'hello *world*' })
  assert.match(prose, /hello \*world\*/)
  const tool = markdown({ kind: 'tool', badge: 'CLI', title: 'shell', body: 'input:\ncommand: ls\n\noutput:\n```\na\n```\n\nstatus: ok  •  chars: 1  •  ~tokens: 1' })
  assert.match(tool, /ls/)
  assert.doesNotMatch(tool, /\\n/)
  const fenceCount = (tool.match(/`{3,}/g) ?? []).length
  assert.ok(fenceCount >= 2 && fenceCount % 2 === 0)
})

test('event detail falls back cleanly with no selection', () => {
  assert.equal((panel as any).eventDetail(undefined), 'No timeline event selected.')
  assert.equal((panel as any).eventDetail({ detail: 'd', body: 'b' }), 'b')
})

test('selection handles empty lists and retains its identity as entries change', () => {
  assert.equal(typeof (panel as any).selectionIndex, 'function')
  const select = (panel as any).selectionIndex
  assert.equal(select([], undefined, 1), -1)
  assert.equal(select([{ id: 'new' }, { id: 'kept' }], 'kept', 0), 1)
  assert.equal(select([{ id: 'new' }, { id: 'kept' }], 'kept', 1), 1)
  assert.equal(select([{ id: 'new' }], 'removed', 0), 0)
  const longList = Array.from({ length: 200 }, (_, i) => ({ id: String(i) }))
  assert.equal(select(longList, '150', 1), 151)
  assert.equal(select(longList, '199', 1), 199)
})

test('getTrace serves timeline items with no capture hook or snapshot reads', async () => {
  const { registerHooks } = await import('node:module')
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@opencode/plugin') return { url: stub('export const Plugin = { define: (value) => value }'), shortCircuit: true }
      if (specifier === './rpc') return { url: stub('export const ContextTraceRpc = {}'), shortCircuit: true }
      if (specifier === './trace') return nextResolve('./trace.ts', context)
      return nextResolve(specifier, context)
    },
  })
  try {
    const plugin = (await import('./server.ts')).default
    const seen: string[] = []
    let disposed = 0
    const cleanup = await plugin.setup({
      options: {},
      rpc: { register: async (id: any, methods: any) => { seen.push(Object.keys(methods).sort().join(',')); assert.equal(typeof methods.getTrace, 'function'); return { dispose: async () => { disposed++ } } } },
      session: { hook: async () => { throw new Error('no hook expected') }, context: async () => [{ id: 'u1', type: 'user', text: 'hello' }] },
    } as any)
    assert.deepEqual(seen, ['getTrace'])
    await cleanup!()
    assert.equal(disposed, 1)
  } finally { hooks.deregister() }
})

test("tool text blocks are readable and reasoning previews omit markdown", () => {
  const items = timeline([{ role: "assistant", parts: [
    { type: "tool", tool: "read", state: { output: [{ type: "text", text: "line one\nline two" }] } },
    { type: "reasoning", text: "**Inspecting** the file" },
  ] }])
  assert.match(items[0].body, /line one\nline two/)
  assert.doesNotMatch(items[0].body, /"type": "text"/)
  assert.equal(items[1].title, "Inspecting the file")
})

test("skill transport wrapper is stripped without losing contained markdown", () => {
  const items = timeline([{ id: "a1", type: "assistant", parts: [
    { type: "tool", tool: "skill", state: { input: { id: "screenshot" }, output: "<skill_content name=\"screenshot\">\n# Screenshot\n\nSome **bold** text\n</skill_content>" } },
  ] }])
  const skill = items.find((item) => item.kind === "skill")
  assert.ok(skill)
  assert.doesNotMatch(skill.body, /<skill_content/)
  assert.match(skill.body, /# Screenshot/)
  assert.match(skill.body, /Some \*\*bold\*\* text/)
})

test("skill detail renders as markdown without an outer fence", () => {
  const items = timeline([{ id: "a1", type: "assistant", parts: [
    { type: "tool", tool: "skill", state: { input: { id: "screenshot" }, output: "<skill_content name=\"screenshot\"># Screenshot\n\ntext</skill_content>" } },
  ] }])
  const md = panel.eventMarkdown(items[0])
  assert.match(md, /# Screenshot/)
  assert.doesNotMatch(md, /<skill_content/)
  assert.match(md, /### Output\n\n# Screenshot/)
  assert.doesNotMatch(md, /### Output\n\n```/)
})

test("tool output stays literal inside fenced sections with readable headers", () => {
  const items = timeline([{ type: "assistant", parts: [
    { type: "tool", tool: "shell", state: { input: { command: "ls" }, output: "# not a heading\nplain" } },
  ] }])
  const tool = items[0]
  assert.match(tool.body, /### Input/)
  assert.match(tool.body, /### Output/)
  assert.match(tool.body, /```/)
  const md = panel.eventMarkdown(tool)
  assert.match(md, /# not a heading/)
  assert.match(md, /```/)
})

test("skill wrapper stripping preserves siblings, quoted attrs, and malformed tags", () => {
  const sibling = '<skill_content name="a">AAA</skill_content> middle <skill_content name="b">BBB</skill_content>'
  const sibItems = timeline([{ id: "sib", type: "assistant", parts: [
    { type: "tool", tool: "skill", state: { input: { id: "s" }, output: sibling } },
  ] }])
  const sib = sibItems.find((item: any) => item.kind === "skill")
  assert.ok(sib.body.includes(sibling), "sibling wrappers must be preserved verbatim")
  assert.ok(sib.body.includes('<skill_content name="a">AAA</skill_content>'))
  assert.ok(sib.body.includes('<skill_content name="b">BBB</skill_content>'))

  const quoted = timeline([{ id: "q", type: "assistant", parts: [
    { type: "tool", tool: "skill", state: { input: { id: "s" }, output: '<skill_content name="a>b">hello</skill_content>' } },
  ] }])
  assert.match(quoted[0].body, /hello/)
  assert.doesNotMatch(quoted[0].body, /b">hello/)

  const malformed = '<skill_content name="x">oops no close'
  const bad = timeline([{ id: "bad", type: "assistant", parts: [
    { type: "tool", tool: "skill", state: { input: { id: "s" }, output: malformed } },
  ] }])
  assert.ok(bad[0].body.includes(malformed), "malformed wrapper must be preserved")

  const nested = '<skill_content name="o"><skill_content name="i">deep</skill_content></skill_content>'
  const nest = timeline([{ id: "n", type: "assistant", parts: [
    { type: "tool", tool: "skill", state: { input: { id: "s" }, output: nested } },
  ] }])
  assert.match(nest[0].body, /deep/)
  assert.doesNotMatch(nest[0].body, /<skill_content/)
})

test("content-block text with extra keys and escaped JSON decode only when safe", () => {
  const withMeta = timeline([{ type: "assistant", parts: [
    { type: "tool", tool: "read", state: { output: [{ type: "text", text: "hello blocks", extra: 1 }] } },
  ] }])
  assert.match(withMeta[0].body, /hello blocks/)
  assert.doesNotMatch(withMeta[0].body, /"type": "text"/)

  const escaped = timeline([{ type: "assistant", parts: [
    { type: "tool", tool: "read", state: { output: JSON.stringify("# Escaped\nline") } },
  ] }])
  assert.match(escaped[0].body, /# Escaped\nline/)

  const realJson = timeline([{ type: "assistant", parts: [
    { type: "tool", tool: "read", state: { output: JSON.stringify({ foo: 1 }) } },
  ] }])
  assert.match(realJson[0].body, /"foo"/)
})

test('focus cues distinguish the active pane from the selection without relying on color', () => {
  const { focusLabel, focusParts, selectionMarker, listPaneBorder, detailPaneBorder } = panel as any
  assert.equal(typeof focusLabel, 'function')
  assert.equal(focusLabel('list'), '[EVENTS | detail]')
  assert.equal(focusLabel('detail'), '[events | DETAIL]')
  assert.deepEqual(focusParts('list'), ['EVENTS', 'detail'])
  assert.deepEqual(focusParts('detail'), ['events', 'DETAIL'])
  assert.equal(selectionMarker('list'), '▶ ')
  assert.equal(selectionMarker('detail'), '› ')
  assert.notEqual(selectionMarker('list'), selectionMarker('detail'))
  for (const narrow of [false, true]) {
    for (const focus of ['list', 'detail']) {
      const listSides = listPaneBorder(narrow, focus)
      const detailSides = detailPaneBorder(narrow, focus)
      assert.equal(listSides.length + detailSides.length, 1, `exactly one divider in narrow=${narrow} focus=${focus}`)
    }
  }
  assert.deepEqual(listPaneBorder(false, 'list'), ['right'])
  assert.deepEqual(detailPaneBorder(false, 'detail'), ['left'])
  assert.deepEqual(listPaneBorder(true, 'list'), ['bottom'])
  assert.deepEqual(detailPaneBorder(true, 'detail'), ['top'])
})

test('header keeps a single row by hiding the trailing key hint when it would overflow', () => {
  const { headerFitsEscHint } = panel as any
  assert.equal(typeof headerFitsEscHint, 'function')
  assert.equal(headerFitsEscHint(120, 42, 'all'), true)
  assert.equal(headerFitsEscHint(80, 42, 'all'), false)
  assert.equal(headerFitsEscHint(80, 200, 'thinking'), false)
  assert.equal(headerFitsEscHint(95, 200, 'thinking'), true)
  assert.equal(headerFitsEscHint(50, 5, 'all'), false)
})
