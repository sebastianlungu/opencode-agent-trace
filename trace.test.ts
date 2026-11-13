import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rmdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { capture, createCaptureQueue, defaultMaxBytes, maxBytesOption, snapshotFor, snapshotsFor, timeline } from './trace.ts'
import * as panel from './panel.ts'

test('snapshot list contains metadata only and selected context is loaded separately', async () => {
  const trace = await import('./trace.ts')
  const reports: string[] = []
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  await capture(root, event('private first'), async () => {}, { report: (message) => reports.push(message) })
  await new Promise((resolve) => setTimeout(resolve, 5))
  await capture(root, event('private second'), async () => {}, { report: (message) => reports.push(message) })
  const { snapshots } = await trace.snapshotsFor(root, 'ses_test')
  assert.doesNotMatch(JSON.stringify(snapshots), /private/)
  const loaded = await (trace as any).snapshotFor(root, 'ses_test', snapshots[1].id)
  assert.equal(loaded.snapshot.messages[0].text, 'private second')
  assert.equal(loaded.snapshot.deltaMessages[0].text, 'private second')
  assert.deepEqual(reports, [])
})

const event = (text: string) => ({ sessionID: 'ses_test', agent: 'test', model: { id: 'model' }, options: {}, system: [{ text: 'synthetic system' }], tools: { read: { description: 'synthetic tool', input: {} } }, messages: [{ id: 'msg_1', text }] })
const sessionDirectory = async (root: string) => join(root, (await readdir(root)).find((name) => name.startsWith('session-'))!)
const loadAll = async (root: string, id: string) => Promise.all((await snapshotsFor(root, id)).snapshots.map(async (entry) => (await snapshotFor(root, id, entry.id)).snapshot))

test('shutdown discards queued captures and waits for the active notification', async () => {
  const reports: string[] = []
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  let started!: () => void, release!: () => void
  const entered = new Promise<void>((resolve) => { started = resolve })
  const blocked = new Promise<void>((resolve) => { release = resolve })
  let notifications = 0, closed = false
  const queue = createCaptureQueue(root, async () => { notifications++; started(); await blocked }, { report: (message) => reports.push(message) })
  queue(event('active'))
  await entered
  queue(event('pending'))
  const closing = queue.close().then(() => { closed = true })
  queue(event('after shutdown'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(closed, false)
  release()
  await closing
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(notifications, 1)
  assert.deepEqual((await loadAll(root, 'ses_test')).map((item) => item.messages[0].text), ['active'])
  assert.deepEqual(reports, [])
})

test('concurrent shutdown before the scheduled drain discards everything', async () => {
  const reports: string[] = []
  const root = join(await mkdtemp(join(tmpdir(), 'trace-test-')), 'absent')
  const queue = createCaptureQueue(root, async () => assert.fail(), { report: (message) => reports.push(message) })
  queue(event('pending'))
  await Promise.all([queue.close(), queue.close()])
  queue(new Proxy({}, { get: () => { throw new Error('event accessed') } }))
  await new Promise<void>((resolve) => setImmediate(resolve))
  await assert.rejects(stat(root), { code: 'ENOENT' })
  assert.deepEqual(reports, [])
})

test('concurrent shutdown waits for a capture blocked on the disk lock', async () => {
  const reports: string[] = []
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  await mkdir(join(root, '.capture-lock'))
  const queue = createCaptureQueue(root, async () => {}, { report: (message) => reports.push(message) })
  queue(event('active'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  queue(event('pending'))
  let completed = 0
  const closings = [queue.close().then(() => completed++), queue.close().then(() => completed++)]
  await new Promise<void>((resolve) => setTimeout(resolve, 30))
  assert.equal(completed, 0)
  await rmdir(join(root, '.capture-lock'))
  await Promise.all(closings)
  assert.equal(completed, 2)
  assert.deepEqual((await loadAll(root, 'ses_test')).map((item) => item.messages[0].text), ['active'])
  assert.deepEqual(reports, [])
})

test('plugin unload closes captures before disposing hook and RPC registrations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trace-plugin-'))
  const { registerHooks } = await import('node:module')
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === '@opencode/plugin') return { url: stub('export const Plugin = { define: (value) => value }'), shortCircuit: true }
    if (specifier === './rpc') return { url: stub('export const ContextTraceRpc = {}'), shortCircuit: true }
    if (specifier === 'node:os' && context.parentURL?.endsWith('/server.ts')) return { url: stub(`export const homedir = () => ${JSON.stringify(root)}`), shortCircuit: true }
    if (specifier === './trace') return nextResolve('./trace.ts', context)
    return nextResolve(specifier, context)
  } })
  try {
    const plugin = (await import('./server.ts')).default
    let hook!: (event: any) => Promise<void>, release!: () => void, started!: () => void
    const entered = new Promise<void>((resolve) => { started = resolve })
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const disposed: string[] = []
    const cleanup = await plugin.setup({ options: {}, rpc: { register: async () => ({ events: { emit: async () => { started(); await blocked } }, dispose: async () => { disposed.push('rpc') } }) }, session: { hook: async (_: string, callback: typeof hook) => { hook = callback; return { dispose: async () => { disposed.push('hook') } } } } } as any)
    await hook(event('active'))
    await entered
    await hook(event('pending'))
    const closing = cleanup!()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.ok(!disposed.includes('rpc'))
    release()
    await closing
    assert.deepEqual(disposed.sort(), ['hook', 'rpc'])
    const directory = join(root, '.local/share/opencode/context-trace')
    assert.deepEqual((await loadAll(directory, 'ses_test')).map((item) => item.messages[0].text), ['active'])
    await hook(event('after unload'))
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal((await loadAll(directory, 'ses_test')).length, 1)
  } finally { hooks.deregister() }
})

test('queued capture returns while the disk lock is held and preserves the hook-time snapshot', async () => {
  const reports: string[] = []
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  await mkdir(join(root, '.capture-lock'))
  let notified!: () => void, wasNotified = false
  const completed = new Promise<void>((resolve) => { notified = resolve })
  const queue = createCaptureQueue(root, async () => { wasNotified = true; notified() }, { report: (message) => reports.push(message) })
  const sample = event('original')
  queue(sample)
  sample.messages[0].text = 'changed'
  await new Promise<void>((resolve) => setTimeout(resolve, 30))
  assert.equal(wasNotified, false)
  await rmdir(join(root, '.capture-lock'))
  await completed
  assert.equal((await loadAll(root, 'ses_test'))[0].messages[0].text, 'original')
  assert.deepEqual(reports, [])
})

test('disabled queue never inspects events or touches disk', async () => {
  const reports: string[] = []
  const root = join(await mkdtemp(join(tmpdir(), 'trace-test-')), 'absent')
  const queue = createCaptureQueue(root, async () => assert.fail(), { maxBytes: 0, report: (message) => reports.push(message) })
  queue(new Proxy({}, { get: () => { throw new Error('event accessed') } }))
  await new Promise<void>((resolve) => setImmediate(resolve))
  await assert.rejects(stat(root), { code: 'ENOENT' })
  assert.deepEqual(reports, [])
})

test('queue bounds pending captures, reports skips, and drains after lock release', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  await mkdir(join(root, '.capture-lock'))
  const reports: string[] = []
  let count = 0, done!: () => void, last!: () => void
  const completed = new Promise<void>((resolve) => { done = resolve })
  const next = new Promise<void>((resolve) => { last = resolve })
  const queue = createCaptureQueue(root, async () => { count++; if (count === 16) done(); if (count === 17) last() }, { report: (message) => reports.push(message) })
  for (let i = 0; i < 20; i++) queue(event(`item ${i}`))
  assert.equal(reports.length, 4)
  assert.ok(reports.every((message) => /queue full.*skipped/i.test(message)))
  await rmdir(join(root, '.capture-lock'))
  await completed
  assert.equal((await snapshotsFor(root, 'ses_test')).snapshots.length, 16)
  queue(event('next'))
  await next
  assert.equal((await snapshotsFor(root, 'ses_test')).snapshots.length, 17)
})

test('oversized queued snapshot is skipped without stopping later captures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  const reports: string[] = []
  let done!: () => void
  const completed = new Promise<void>((resolve) => { done = resolve })
  const queue = createCaptureQueue(root, async () => done(), { report: (message) => reports.push(message) })
  queue(event('x'.repeat(16 * 1024 * 1024)))
  queue(event('small'))
  await completed
  assert.match(reports.join(' '), /memory limit.*skipped/i)
  assert.equal((await loadAll(root, 'ses_test'))[0].messages[0].text, 'small')
})

test('OpenCode session IDs are safely stored even with path separators', async () => {
  const reports: string[] = []
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  for (const sessionID of ['ses', 'ses_abc-def', 'ses/../../escape', 'ses_é', 'ses_\ud800']) {
    await capture(root, { ...event('safe'), sessionID }, async () => {}, { report: (message) => reports.push(message) })
    assert.equal((await snapshotsFor(root, sessionID)).snapshots.length, 1)
  }
  await assert.rejects(snapshotsFor(root, '../escape'), /Invalid session ID/)
  assert.deepEqual(reports, [])
})

test('session IDs differing only by case use distinct case-insensitive paths and data', async () => {
  const reports: string[] = []
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  for (const sessionID of ['ses_AbC', 'ses_aBc']) await capture(root, { ...event(sessionID), sessionID }, async () => {}, { report: (message) => reports.push(message) })
  const directories = await readdir(root)
  assert.equal(new Set(directories.map((name) => name.toLowerCase())).size, 2)
  for (const id of ['ses_AbC', 'ses_aBc']) assert.equal((await loadAll(root, id))[0].messages[0].text, id)
  assert.deepEqual(reports, [])
})

test('listing does not read damaged snapshots and only selected neighbors are inspected', async () => {
  const reports: string[] = []
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  await capture(root, event('healthy'), async () => {}, { report: (message) => reports.push(message) })
  const directory = await sessionDirectory(root)
  await writeFile(join(directory, '9999999999997-bad.json'), '{broken')
  await writeFile(join(directory, '9999999999998-face.json'), JSON.stringify({ sessionID: 'ses_test', timestamp: 9999999999998, messages: [] }))
  await writeFile(join(directory, '9999999999999-face.json'), JSON.stringify({ sessionID: 'ses_test', timestamp: 9999999999999, messages: [] }))
  const { snapshots, warnings } = await snapshotsFor(root, 'ses_test')
  assert.equal(snapshots.length, 4)
  assert.deepEqual(warnings, [])
  assert.deepEqual((await snapshotFor(root, 'ses_test', snapshots[3].id)).warnings, [])
  assert.match((await snapshotFor(root, 'ses_test', snapshots[1].id)).warnings[0], /Unable to read/)
  await assert.rejects(snapshotFor(root, 'ses_test', '../outside'), /not found/)
  assert.deepEqual(reports, [])
})

test('a full disk budget preserves snapshots and warns without notifying', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  const reports: string[] = []
  let notifications = 0
  await capture(root, event('first'), async () => { notifications++ }, { report: (message: string) => reports.push(message), maxBytes: 1000 })
  await capture(root, event('x'.repeat(1000)), async () => { notifications++ }, { report: (message: string) => reports.push(message), maxBytes: 1000 })
  assert.equal((await snapshotsFor(root, 'ses_test')).snapshots.length, 1)
  assert.equal(notifications, 1)
  assert.match(reports.join(' '), /limit/i)
})

test('disk budget defaults and invalid settings are explicit', () => {
  assert.equal(maxBytesOption(undefined), 1024 ** 3)
  assert.equal(defaultMaxBytes, 1024 ** 3)
  assert.equal(maxBytesOption(0), 0)
  for (const value of [-1, 1.5, '100', null, Infinity]) assert.throws(() => maxBytesOption(value), /maxBytes/)
})

test('concurrent processes cannot collectively exceed the disk budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  const source = `import { capture } from ${JSON.stringify(new URL('./trace.ts', import.meta.url).href)};
    const event = { sessionID: 'ses_test', system: [], tools: {}, messages: [{ text: 'x'.repeat(100) }], options: {} };
    await Promise.all(Array.from({ length: 8 }, () => capture(process.argv[1], event, async () => {}, { maxBytes: 1000, report: (message) => { if (!message.includes('disk size limit reached')) { console.error(message); process.exitCode = 1 } } })));`
  const { spawn } = await import('node:child_process')
  await Promise.all(Array.from({ length: 4 }, () => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, root], { stdio: 'pipe' })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`worker failed: ${code}: ${stderr}`)))
  })))
  const directory = await sessionDirectory(root)
  const files = await readdir(directory)
  assert.ok(files.length > 0 && files.length < 32)
  const sizes = await Promise.all(files.map(async (file) => (await stat(join(directory, file))).size))
  assert.ok(sizes.reduce((sum, size) => sum + size, 0) <= 1000)
})

test('tool details show part duration and failed state error', () => {
  const items = timeline([{ type: 'assistant', parts: [{ type: 'tool', tool: 'read', time: { start: 100, end: 250 }, state: { status: 'error', error: 'permission denied' } }] }])
  const detail = JSON.parse(items.find((item: any) => item.badge === 'READ').detail)
  assert.equal(detail.duration, 150)
  assert.equal(detail.error, 'permission denied')
})

test('damaged snapshots are reported without hiding healthy captures or inventing deltas', async () => {
  const reports: string[] = []
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  await capture(root, event('first'), async () => {}, { report: (message) => reports.push(message) })
  const directory = await sessionDirectory(root)
  await writeFile(join(directory, '9999999999998-bad.json'), '{broken')
  await writeFile(join(directory, '9999999999999-face.json'), JSON.stringify({ sessionID: 'ses_test', timestamp: 9999999999999, messages: [{ text: 'last' }] }))
  const { snapshots } = await snapshotsFor(root, 'ses_test')
  assert.equal(snapshots.length, 3)
  const { snapshot, warnings } = await snapshotFor(root, 'ses_test', snapshots[2].id)
  assert.match(warnings.join(' '), /9999999999998-bad.json/)
  assert.equal(snapshot.deltaMessages, null)
  assert.deepEqual(reports, [])
})

test('capture errors do not escape and diagnostics contain no private data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  const invalid = join(root, 'not-a-directory')
  await writeFile(invalid, 'x')
  const reports: string[] = []
  await assert.doesNotReject(capture(invalid, event('PRIVATE INPUT'), async () => {}, { report: (message) => reports.push(message) }))
  assert.equal(reports.length, 1)
  assert.doesNotMatch(reports[0], /PRIVATE|not-a-directory/)
})

test('ambiguous or missing evidence never links snapshots to timeline entries', () => {
  const items = timeline([{ type: 'assistant', parentID: 'msg_1', parts: [] }, { type: 'assistant', parentID: 'other', parts: [] }])
  assert.ok(items.filter((item: any) => item.badge.startsWith('STEP')).every((item: any) => item.snapshotIndex === undefined))
})

test('timeline stays in session order without prepending snapshots', () => {
  const items = timeline([{ id: 'one', type: 'user', text: 'first' }, { id: 'two', type: 'assistant', parts: [] }])
  assert.deepEqual(items.map((item: any) => item.badge), ['USER', 'STEP #1'])
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

test('context views use the independently selected snapshot, not the timeline event', () => {
  assert.equal(typeof (panel as any).panelContent, 'function')
  const content = (panel as any).panelContent
  const item = { detail: 'event detail' }
  const snapshot = { messages: ['captured'], deltaMessages: null, system: ['system'], tools: [] }
  assert.equal(content(1, item, snapshot), 'event detail')
  assert.match(content(3, item, snapshot), /captured/)
  assert.match(content(2, item, snapshot), /unavailable/i)
  assert.match(content(3, item, undefined), /select.*snapshot/i)
})

test('independent concurrent captures preserve every complete snapshot', async () => {
  const reports: string[] = []
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  await Promise.all(Array.from({ length: 40 }, (_, i) => capture(root, event(`synthetic ${i}`), async () => {}, { report: (message) => reports.push(message) })))
  const snapshots = await loadAll(root, 'ses_test')
  assert.equal(snapshots.length, 40)
  assert.equal(new Set(snapshots.map((s: any) => s.messages[0].text)).size, 40)
  assert.equal(snapshots[0].system[0].text, 'synthetic system')
  assert.equal(snapshots[0].tools[0].description, 'synthetic tool')
  const directory = await sessionDirectory(root)
  assert.equal((await stat(directory)).mode & 0o777, 0o700)
  const files = await readdir(directory)
  assert.equal(files.length, 40)
  for (const file of files) {
    assert.equal((await stat(join(directory, file))).mode & 0o777, 0o600)
    JSON.parse(await readFile(join(directory, file), 'utf8'))
  }
  assert.deepEqual(reports, [])
})

test('notification failure is reported safely and does not prevent later captures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  const reports: string[] = []
  await capture(root, event('PRIVATE INPUT'), async () => { throw new Error('PRIVATE ERROR') }, { report: (message) => reports.push(message) })
  await capture(root, event('next'), async () => {}, { report: (message) => reports.push(message) })
  assert.equal((await snapshotsFor(root, 'ses_test')).snapshots.length, 2)
  assert.equal(reports.length, 1)
  assert.doesNotMatch(reports[0], /PRIVATE/)
})

test('separate processes can capture the same session concurrently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  const source = `import { capture } from ${JSON.stringify(new URL('./trace.ts', import.meta.url).href)};
    const event = { sessionID: 'ses_test', system: [], tools: {}, messages: [{ text: process.argv[2] }], options: {} };
    await Promise.all(Array.from({ length: 10 }, (_, i) => capture(process.argv[1], { ...event, messages: [{ text: process.argv[2] + '-' + i }] }, async () => {}, { report: () => { process.exitCode = 1 } })));`
  const { spawn } = await import('node:child_process')
  await Promise.all(Array.from({ length: 4 }, (_, index) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, root, String(index)], { stdio: 'pipe' })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`worker failed: ${stderr}`)))
  })))
  const snapshots = await loadAll(root, 'ses_test')
  assert.equal(snapshots.length, 40)
  assert.equal(new Set(snapshots.map((snapshot: any) => snapshot.messages[0].text)).size, 40)
})

test('synthetic sensitive context is stored intact outside the repository', async () => {
  const reports: string[] = []
  const root = await mkdtemp(join(tmpdir(), 'trace-test-'))
  const sample = event('synthetic-private-message')
  sample.system[0] = { text: 'synthetic-private-system', metadata: { experimental: { instructions: [{ key: 'test', text: 'synthetic-private-instruction' }] } } } as any
  sample.options = { custom: 'synthetic-private-option' }
  sample.tools.read = { description: 'synthetic-private-tool', input: { type: 'string' } }
  await capture(root, sample, async () => {}, { report: (message) => reports.push(message) })
  const [snapshot] = await loadAll(root, 'ses_test')
  assert.deepEqual(snapshot.messages, sample.messages)
  assert.deepEqual(snapshot.system, sample.system)
  assert.deepEqual(snapshot.options, sample.options)
  assert.deepEqual(snapshot.tools, [{ name: 'read', description: 'synthetic-private-tool', schema: { type: 'string' } }])
  assert.deepEqual(reports, [])
})
