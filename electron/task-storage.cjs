function normalizeTaskSnapshot(value) {
  if (Array.isArray(value)) return { tasks: value, updatedAt: null }
  if (!value || !Array.isArray(value.tasks)) return null
  return {
    tasks: value.tasks,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
  }
}

function timestamp(value) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : null
}

function chooseTaskSnapshot(localValue, diskValue) {
  const local = normalizeTaskSnapshot(localValue)
  const disk = normalizeTaskSnapshot(diskValue)

  if (!local) return disk ? { ...disk, source: 'disk' } : null
  if (!disk) return { ...local, source: 'local' }

  if (JSON.stringify(local.tasks) === JSON.stringify(disk.tasks)) {
    return {
      tasks: local.tasks,
      updatedAt: local.updatedAt || disk.updatedAt,
      source: 'same',
    }
  }

  const localTime = timestamp(local.updatedAt)
  const diskTime = timestamp(disk.updatedAt)
  if (localTime !== null && diskTime !== null && localTime !== diskTime) {
    return localTime > diskTime ? { ...local, source: 'local' } : { ...disk, source: 'disk' }
  }

  if (local.tasks.length !== disk.tasks.length) {
    return local.tasks.length > disk.tasks.length
      ? { ...local, source: 'local' }
      : { ...disk, source: 'disk' }
  }

  // Older versions did not timestamp localStorage. Keeping the renderer copy
  // on a tie prevents a stale disk file from overwriting the last visible state.
  return { ...local, source: 'local' }
}

module.exports = { chooseTaskSnapshot, normalizeTaskSnapshot }
