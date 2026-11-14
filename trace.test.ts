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
