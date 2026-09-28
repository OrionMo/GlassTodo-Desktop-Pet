export const SYNC_STATE_VERSION = 1

function taskHash(task) {
  return JSON.stringify(task)
}

function validTimestamp(value, fallback) {
  return Number.isFinite(Date.parse(value || '')) ? value : fallback
}

export function createSyncState(userId) {
  return { version: SYNC_STATE_VERSION, userId, records: {}, pending: {} }
}

export function normalizeSyncState(value, userId) {
  if (!value || value.version !== SYNC_STATE_VERSION || value.userId !== userId) return createSyncState(userId)
  return {
    version: SYNC_STATE_VERSION,
    userId,
    records: value.records && typeof value.records === 'object' ? value.records : {},
    pending: value.pending && typeof value.pending === 'object' ? value.pending : {},
  }
}

export function captureLocalChanges(tasks, currentState, now = new Date().toISOString()) {
  const state = normalizeSyncState(currentState, currentState?.userId)
  const records = { ...state.records }
  const pending = { ...state.pending }
  const currentIds = new Set()

  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task?.id) continue
    const id = String(task.id)
    const hash = taskHash(task)
    const previous = records[id]
    currentIds.add(id)

    if (!previous || previous.hash !== hash || previous.deletedAt) {
      records[id] = { hash, updatedAt: now, deletedAt: null }
      pending[id] = { operation: 'upsert', task, updatedAt: now }
    }
  }

  for (const [id, previous] of Object.entries(records)) {
    if (currentIds.has(id) || previous.deletedAt) continue
    records[id] = { hash: null, updatedAt: now, deletedAt: now }
    pending[id] = { operation: 'delete', updatedAt: now }
  }

  return { ...state, records, pending }
}

export function prepareInitialMerge(localTasks, remoteRows, userId, now = new Date().toISOString()) {
  const rows = Array.isArray(remoteRows) ? remoteRows : []
  const remoteById = new Map(rows.map((row) => [String(row.id), row]))
  const local = Array.isArray(localTasks) ? localTasks : []
  const meaningfulLocal = local.length > 0 && local.every((task) => String(task?.id || '').startsWith('seed-')) ? [] : local
  const merged = []
  const included = new Set()
  const state = createSyncState(userId)

  for (const row of rows) {
    const id = String(row.id)
    const updatedAt = validTimestamp(row.updated_at, now)
    state.records[id] = row.deleted_at
      ? { hash: null, updatedAt, deletedAt: row.deleted_at }
      : { hash: taskHash(row.task_data), updatedAt, deletedAt: null }
  }

  for (const task of meaningfulLocal) {
    if (!task?.id) continue
    const id = String(task.id)
    const remote = remoteById.get(id)
    included.add(id)
    if (remote) {
      if (!remote.deleted_at && remote.task_data) merged.push(remote.task_data)
      continue
    }
    merged.push(task)
    state.records[id] = { hash: taskHash(task), updatedAt: now, deletedAt: null }
    state.pending[id] = { operation: 'upsert', task, updatedAt: now }
  }

  for (const row of rows) {
    const id = String(row.id)
    if (included.has(id) || row.deleted_at || !row.task_data) continue
    merged.push(row.task_data)
  }

  return { tasks: merged, state }
}

export function mergeRemoteRows(localTasks, currentState, remoteRows, now = new Date().toISOString()) {
  const tasksById = new Map((Array.isArray(localTasks) ? localTasks : []).filter((task) => task?.id).map((task) => [String(task.id), task]))
  const order = (Array.isArray(localTasks) ? localTasks : []).map((task) => String(task?.id || '')).filter(Boolean)
  const state = normalizeSyncState(currentState, currentState?.userId)
  const records = { ...state.records }
  const pending = { ...state.pending }

  for (const row of Array.isArray(remoteRows) ? remoteRows : []) {
    const id = String(row.id)
    const remoteUpdatedAt = validTimestamp(row.updated_at, now)
    const localPending = pending[id]
    if (localPending && Date.parse(localPending.updatedAt) > Date.parse(remoteUpdatedAt)) continue
    const localRecord = records[id]
    if (!localPending && localRecord && Date.parse(localRecord.updatedAt) > Date.parse(remoteUpdatedAt)) continue

    delete pending[id]
    if (row.deleted_at) {
      tasksById.delete(id)
      records[id] = { hash: null, updatedAt: remoteUpdatedAt, deletedAt: row.deleted_at }
      continue
    }
    if (!row.task_data) continue
    tasksById.set(id, row.task_data)
    if (!order.includes(id)) order.push(id)
    records[id] = { hash: taskHash(row.task_data), updatedAt: remoteUpdatedAt, deletedAt: null }
  }

  return {
    tasks: order.filter((id) => tasksById.has(id)).map((id) => tasksById.get(id)),
    state: { ...state, records, pending },
  }
}

export function pendingRows(state, userId) {
  return Object.entries(state?.pending || {}).map(([id, change]) => ({
    user_id: userId,
    id,
    task_data: change.operation === 'delete' ? null : change.task,
    updated_at: change.updatedAt,
    deleted_at: change.operation === 'delete' ? change.updatedAt : null,
  }))
}

export function clearPending(state, uploadedChanges) {
  const pending = { ...(state?.pending || {}) }
  for (const change of uploadedChanges) {
    const id = typeof change === 'string' ? change : change.id
    const uploadedAt = typeof change === 'string' ? null : change.updatedAt
    if (!uploadedAt || pending[id]?.updatedAt === uploadedAt) delete pending[id]
  }
  return { ...state, pending }
}
