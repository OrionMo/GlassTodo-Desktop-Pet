import assert from 'node:assert/strict'
import test from 'node:test'
import { captureLocalChanges, clearPending, createSyncState, mergeRemoteRows, pendingRows, prepareInitialMerge } from '../src/sync-model.js'

const NOW = '2026-09-28T10:00:00.000Z'

test('first sync backs a union without replacing local-only tasks', () => {
  const local = [{ id: 'local-1', title: '本机任务' }, { id: 'shared', title: '本机旧标题' }]
  const remote = [{ id: 'shared', task_data: { id: 'shared', title: '云端标题' }, updated_at: NOW, deleted_at: null }, { id: 'remote-1', task_data: { id: 'remote-1', title: '手机任务' }, updated_at: NOW, deleted_at: null }]
  const result = prepareInitialMerge(local, remote, 'user-1', NOW)
  assert.deepEqual(result.tasks.map((task) => task.title), ['本机任务', '云端标题', '手机任务'])
  assert.deepEqual(Object.keys(result.state.pending), ['local-1'])
})

test('fresh demo seeds are never uploaded during first sync', () => {
  const result = prepareInitialMerge([{ id: 'seed-1', title: '示例' }], [], 'user-1', NOW)
  assert.deepEqual(result.tasks, [])
  assert.deepEqual(result.state.pending, {})
})

test('a local deletion becomes a tombstone instead of erasing the full list', () => {
  const initial = createSyncState('user-1')
  initial.records.a = { hash: JSON.stringify({ id: 'a', title: 'A' }), updatedAt: NOW, deletedAt: null }
  initial.records.b = { hash: JSON.stringify({ id: 'b', title: 'B' }), updatedAt: NOW, deletedAt: null }
  const changed = captureLocalChanges([{ id: 'b', title: 'B' }], initial, '2026-09-28T10:01:00.000Z')
  assert.equal(changed.pending.a.operation, 'delete')
  assert.equal(changed.pending.b, undefined)
  assert.equal(pendingRows(changed, 'user-1')[0].task_data, null)
})

test('newer pending local edits are not overwritten by an older remote row', () => {
  let state = captureLocalChanges([{ id: 'a', title: '本机新标题' }], createSyncState('user-1'), '2026-09-28T10:02:00.000Z')
  const result = mergeRemoteRows([{ id: 'a', title: '本机新标题' }], state, [{ id: 'a', task_data: { id: 'a', title: '云端旧标题' }, updated_at: NOW, deleted_at: null }])
  assert.equal(result.tasks[0].title, '本机新标题')
  assert.equal(result.state.pending.a.operation, 'upsert')
})

test('remote tombstones remove only the matching task', () => {
  let state = createSyncState('user-1')
  state.records.a = { hash: JSON.stringify({ id: 'a', title: 'A' }), updatedAt: NOW, deletedAt: null }
  state.records.b = { hash: JSON.stringify({ id: 'b', title: 'B' }), updatedAt: NOW, deletedAt: null }
  const result = mergeRemoteRows([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], state, [{ id: 'a', task_data: null, updated_at: '2026-09-28T10:03:00.000Z', deleted_at: '2026-09-28T10:03:00.000Z' }])
  assert.deepEqual(result.tasks, [{ id: 'b', title: 'B' }])
})

test('clearing uploaded mutations preserves later pending changes', () => {
  const state = createSyncState('user-1')
  state.pending = { a: { operation: 'upsert' }, b: { operation: 'delete' } }
  assert.deepEqual(Object.keys(clearPending(state, ['a']).pending), ['b'])
})
