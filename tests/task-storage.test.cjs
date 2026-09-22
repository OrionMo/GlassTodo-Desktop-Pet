const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { chooseTaskSnapshot } = require('../electron/task-storage.cjs')

const tasks = (count, prefix) => Array.from({ length: count }, (_, index) => ({
  id: `${prefix}-${index}`,
  title: `${prefix} ${index}`,
  completed: false,
}))

test('keeps a larger legacy localStorage list instead of overwriting it with an older disk file', () => {
  const selected = chooseTaskSnapshot(tasks(29, 'local'), { tasks: tasks(11, 'disk'), updatedAt: '2026-09-15T10:00:00.000Z' })
  assert.equal(selected.source, 'local')
  assert.equal(selected.tasks.length, 29)
})

test('restores a larger disk list when localStorage is incomplete', () => {
  const selected = chooseTaskSnapshot(tasks(11, 'local'), { tasks: tasks(29, 'disk'), updatedAt: '2026-09-17T10:00:00.000Z' })
  assert.equal(selected.source, 'disk')
  assert.equal(selected.tasks.length, 29)
})

test('uses timestamps when both stores provide them', () => {
  const selected = chooseTaskSnapshot(
    { tasks: tasks(3, 'local'), updatedAt: '2026-09-17T11:00:00.000Z' },
    { tasks: tasks(4, 'disk'), updatedAt: '2026-09-17T10:00:00.000Z' },
  )
  assert.equal(selected.source, 'local')
  assert.equal(selected.tasks.length, 3)
})

test('keeps localStorage on an untimestamped tie', () => {
  const selected = chooseTaskSnapshot(tasks(2, 'local'), tasks(2, 'disk'))
  assert.equal(selected.source, 'local')
})

test('keeps the sandboxed preload free of local module imports', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8')
  assert.doesNotMatch(preload, /require\(['"]\.\//)
  assert.match(preload, /tasks:bootstrap-sync/)
})

test('clears stale drag IPC listeners before registering the active handlers', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  for (const channel of ['window:drag-start', 'window:drag-move', 'window:drag-end']) {
    const removal = main.indexOf(`ipcMain.removeAllListeners('${channel}')`)
    const registration = main.indexOf(`ipcMain.on('${channel}'`)
    assert.notEqual(removal, -1)
    assert.notEqual(registration, -1)
    assert.ok(removal < registration)
  }
})

test('wires task reminder requests and reminder-open events through the preload bridge', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(preload, /task-reminder:show/)
  assert.match(preload, /reminder:opened/)
  assert.match(main, /ipcMain\.handle\('task-reminder:show'/)
  assert.match(main, /webContents\.send\('reminder:opened'/)
})
