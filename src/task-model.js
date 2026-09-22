export const IDEA_BUCKET = 'idea'
export const IDEA_FILTER_ALL = 'all'
export const IDEA_TAG_GOAL = 'goal'
export const IDEA_TAG_INTEREST = 'interest'

const validIdeaTags = new Set([IDEA_TAG_GOAL, IDEA_TAG_INTEREST])
const reminderTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function normalizeIdeaTags(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((tag) => validIdeaTags.has(tag)))]
}

export function migrateTasks(tasks) {
  if (!Array.isArray(tasks)) return []

  return tasks.map((task) => {
    if (!task || typeof task !== 'object') return task
    if (task.bucket !== 'unfinished' && task.bucket !== IDEA_BUCKET) return task

    const ideaTags = normalizeIdeaTags(task.ideaTags)
    if (task.bucket === IDEA_BUCKET && JSON.stringify(ideaTags) === JSON.stringify(task.ideaTags || [])) return task

    return { ...task, bucket: IDEA_BUCKET, ideaTags }
  })
}

export function ideaMatchesFilter(task, filter) {
  if (task?.bucket !== IDEA_BUCKET) return false
  if (filter === IDEA_FILTER_ALL) return true
  return normalizeIdeaTags(task.ideaTags).includes(filter)
}

export function toggleTaskImportance(tasks, id) {
  if (!Array.isArray(tasks)) return []
  return tasks.map((task) => task?.id === id ? { ...task, important: !task.important } : task)
}

export function normalizeReminderTime(value) {
  const normalized = typeof value === 'string' ? value.trim().replace('.', ':') : ''
  return reminderTimePattern.test(normalized) ? normalized : null
}

export function reminderOccurrenceKey(task) {
  const time = normalizeReminderTime(task?.reminderTime)
  return task?.date && time ? `${task.date}T${time}` : null
}

export function setTaskReminder(tasks, id, value) {
  if (!Array.isArray(tasks)) return []
  const reminderTime = normalizeReminderTime(value)
  return tasks.map((task) => {
    if (task?.id !== id) return task
    const { reminderTime: _time, reminderFiredFor: _fired, ...rest } = task
    return reminderTime ? { ...rest, reminderTime } : rest
  })
}

export function markTaskReminderFired(tasks, id, occurrenceKey) {
  if (!Array.isArray(tasks)) return []
  return tasks.map((task) => task?.id === id ? { ...task, reminderFiredFor: occurrenceKey } : task)
}

export function findDueTaskReminders(tasks, now = new Date(), graceMinutes = 60) {
  if (!Array.isArray(tasks) || !(now instanceof Date) || Number.isNaN(now.getTime())) return []
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const today = `${year}-${month}-${day}`
  const graceMs = Math.max(0, Number(graceMinutes) || 0) * 60 * 1000

  return tasks.filter((task) => {
    if (!task || task.completed || task.bucket === IDEA_BUCKET || task.bucket === 'unfinished' || task.date !== today) return false
    const occurrenceKey = reminderOccurrenceKey(task)
    if (!occurrenceKey || task.reminderFiredFor === occurrenceKey) return false
    const dueAt = new Date(`${occurrenceKey}:00`)
    const elapsed = now.getTime() - dueAt.getTime()
    return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= graceMs
  })
}
