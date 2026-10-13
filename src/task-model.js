export const IDEA_BUCKET = 'idea'
export const NOTE_BUCKET = 'note'
export const DEADLINE_BUCKET = 'deadline'
export const HABIT_BUCKET = 'habit'
export const HABIT_STATE_CANDIDATE = 'candidate'
export const HABIT_STATE_ACTIVE = 'active'
export const HABIT_STATE_FINISHED = 'finished'
export const HABIT_MINIMUM_UNIT_MINUTES = 'minutes'
export const HABIT_MINIMUM_UNIT_HOURS = 'hours'
export const HABIT_MINIMUM_UNIT_CUSTOM = 'custom'
export const REVIEW_BUCKET = 'review'
export const REVIEW_FILTER_ALL = 'all'
export const REVIEW_STATUS_PENDING = 'pending'
export const REVIEW_STATUS_VERIFY = 'verify'
export const REVIEW_STATUS_IMPROVED = 'improved'
export const REVIEW_CATEGORY_PREPARATION = 'preparation'
export const REVIEW_CATEGORY_TIME = 'time'
export const REVIEW_CATEGORY_ATTENTION = 'attention'
export const REVIEW_CATEGORY_COMMUNICATION = 'communication'
export const REVIEW_CATEGORY_INFORMATION = 'information'
export const REVIEW_CATEGORY_PROCESS = 'process'
export const REVIEW_CATEGORY_OTHER = 'other'
export const DAILY_TEMPLATE_BUCKET = 'daily-template'
export const IDEA_FILTER_ALL = 'all'
export const IDEA_TAG_GOAL = 'goal'
export const IDEA_TAG_INTEREST = 'interest'

const validIdeaTags = new Set([IDEA_TAG_GOAL, IDEA_TAG_INTEREST])
const reminderTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const deadlineDatePattern = /^\d{4}-\d{2}-\d{2}$/
const habitDurations = new Set([30, 45, 60])
const habitMinimumUnits = new Set([HABIT_MINIMUM_UNIT_MINUTES, HABIT_MINIMUM_UNIT_HOURS, HABIT_MINIMUM_UNIT_CUSTOM])
const reviewStatuses = new Set([REVIEW_STATUS_PENDING, REVIEW_STATUS_VERIFY, REVIEW_STATUS_IMPROVED])
const reviewCategories = new Set([REVIEW_CATEGORY_PREPARATION, REVIEW_CATEGORY_TIME, REVIEW_CATEGORY_ATTENTION, REVIEW_CATEGORY_COMMUNICATION, REVIEW_CATEGORY_INFORMATION, REVIEW_CATEGORY_PROCESS, REVIEW_CATEGORY_OTHER])

function normalizeIdeaTags(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((tag) => validIdeaTags.has(tag)))]
}

export function parseHabitMinimum(value) {
  const normalized = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(分钟|小时)?$/)
  const amount = match ? Number(match[1]) : Number.NaN
  if (!match || !Number.isFinite(amount) || amount <= 0) return { value: normalized, unit: HABIT_MINIMUM_UNIT_CUSTOM }
  return {
    value: String(amount),
    unit: match[2] === '小时' ? HABIT_MINIMUM_UNIT_HOURS : HABIT_MINIMUM_UNIT_MINUTES,
  }
}

export function formatHabitMinimum(value, unit = HABIT_MINIMUM_UNIT_MINUTES) {
  const normalizedUnit = habitMinimumUnits.has(unit) ? unit : HABIT_MINIMUM_UNIT_MINUTES
  const normalizedValue = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
  if (normalizedUnit === HABIT_MINIMUM_UNIT_CUSTOM) return normalizedValue
  const amount = Number(normalizedValue)
  if (!Number.isFinite(amount) || amount <= 0) return ''
  const label = normalizedUnit === HABIT_MINIMUM_UNIT_HOURS ? '小时' : '分钟'
  return `${amount} ${label}`
}

export function habitMinimumLabel(value) {
  const parsed = parseHabitMinimum(value)
  return formatHabitMinimum(parsed.value, parsed.unit)
}

export function migrateTasks(tasks) {
  if (!Array.isArray(tasks)) return []

  return tasks.map((task) => {
    if (!task || typeof task !== 'object') return task
    let migrated = task

    if (task.bucket === HABIT_BUCKET) {
      const minimum = habitMinimumLabel(task.habitMinimum)
      if (minimum && minimum !== task.habitMinimum) migrated = { ...migrated, habitMinimum: minimum }
    }

    if (task.bucket === DAILY_TEMPLATE_BUCKET) {
      const dailyCreatedDate = normalizeDeadlineDate(task.dailyCreatedDate)
      const dailyStoppedAt = normalizeDeadlineDate(task.dailyStoppedAt)
      const dailySkippedDates = normalizeDailyDates(task.dailySkippedDates)
      const normalized = {
        ...migrated,
        dailyActive: task.dailyActive !== false,
        ...(dailyCreatedDate ? { dailyCreatedDate } : {}),
        ...(dailyStoppedAt ? { dailyStoppedAt } : {}),
        dailySkippedDates,
      }
      if (!dailyCreatedDate) delete normalized.dailyCreatedDate
      if (!dailyStoppedAt) delete normalized.dailyStoppedAt
      migrated = normalized
    }

    if (task.bucket !== 'unfinished' && task.bucket !== IDEA_BUCKET) return migrated

    const ideaTags = normalizeIdeaTags(task.ideaTags)
    if (task.bucket === IDEA_BUCKET && JSON.stringify(ideaTags) === JSON.stringify(task.ideaTags || [])) return migrated

    return { ...migrated, bucket: IDEA_BUCKET, ideaTags }
  })
}

export function ideaMatchesFilter(task, filter) {
  if (task?.bucket !== IDEA_BUCKET) return false
  if (filter === IDEA_FILTER_ALL) return true
  return normalizeIdeaTags(task.ideaTags).includes(filter)
}

export function noteDisplayTitle(note) {
  const title = typeof note?.title === 'string' ? note.title.trim() : ''
  if (title) return title
  const content = typeof note?.noteContent === 'string' ? note.noteContent.trim() : ''
  const firstLine = content.split(/\r?\n/).find((line) => line.trim())?.trim() || ''
  return firstLine.slice(0, 36) || '无标题笔记'
}

export function noteMatchesQuery(note, query) {
  if (note?.bucket !== NOTE_BUCKET) return false
  const normalized = typeof query === 'string' ? query.trim().toLocaleLowerCase() : ''
  if (!normalized) return true
  return `${note.title || ''}\n${note.noteContent || ''}`.toLocaleLowerCase().includes(normalized)
}

export function compareNotes(left, right) {
  if (Boolean(left?.notePinned) !== Boolean(right?.notePinned)) return left?.notePinned ? -1 : 1
  const leftUpdated = Date.parse(left?.noteUpdatedAt || left?.noteCreatedAt || '') || 0
  const rightUpdated = Date.parse(right?.noteUpdatedAt || right?.noteCreatedAt || '') || 0
  return rightUpdated - leftUpdated
}

export function upsertNote(tasks, note) {
  if (!Array.isArray(tasks) || !note?.id || note.bucket !== NOTE_BUCKET || !String(note.noteContent || '').trim()) return Array.isArray(tasks) ? tasks : []
  const index = tasks.findIndex((task) => task?.id === note.id)
  if (index < 0) return [note, ...tasks]
  return tasks.map((task, taskIndex) => taskIndex === index ? note : task)
}

export function toggleNotePinned(tasks, id, updatedAt = new Date().toISOString()) {
  if (!Array.isArray(tasks)) return []
  return tasks.map((task) => task?.id === id && task.bucket === NOTE_BUCKET ? { ...task, notePinned: !task.notePinned, noteUpdatedAt: updatedAt } : task)
}

export function addNoteToToday(tasks, noteId, todayDate, taskId) {
  if (!Array.isArray(tasks) || !normalizeDeadlineDate(todayDate) || !taskId) return Array.isArray(tasks) ? tasks : []
  const note = tasks.find((task) => task?.id === noteId && task.bucket === NOTE_BUCKET)
  if (!note || tasks.some((task) => task?.sourceNoteId === noteId && task.date === todayDate && !task.completed)) return tasks
  return [{ id: taskId, title: noteDisplayTitle(note), completed: false, date: todayDate, sourceNoteId: noteId }, ...tasks]
}

export function addNoteToIdeas(tasks, noteId, ideaId) {
  if (!Array.isArray(tasks) || !ideaId) return Array.isArray(tasks) ? tasks : []
  const note = tasks.find((task) => task?.id === noteId && task.bucket === NOTE_BUCKET)
  if (!note || tasks.some((task) => task?.sourceNoteId === noteId && task.bucket === IDEA_BUCKET)) return tasks
  return [{ id: ideaId, title: noteDisplayTitle(note), completed: false, bucket: IDEA_BUCKET, ideaTags: [], sourceNoteId: noteId }, ...tasks]
}

export function normalizeReviewStatus(value) {
  return reviewStatuses.has(value) ? value : REVIEW_STATUS_PENDING
}

export function normalizeReviewCategory(value) {
  return reviewCategories.has(value) ? value : REVIEW_CATEGORY_OTHER
}

export function reviewMatchesFilter(task, filter) {
  if (task?.bucket !== REVIEW_BUCKET) return false
  return filter === REVIEW_FILTER_ALL || normalizeReviewStatus(task.reviewStatus) === filter
}

export function reviewFeedbacks(review) {
  if (!Array.isArray(review?.reviewFeedbacks)) return []
  const seen = new Set()
  return review.reviewFeedbacks
    .filter((feedback) => feedback && typeof feedback === 'object')
    .map((feedback) => ({
      id: typeof feedback.id === 'string' ? feedback.id.trim() : '',
      text: typeof feedback.text === 'string' ? feedback.text.trim() : '',
      createdDate: normalizeDeadlineDate(feedback.createdDate),
      createdAt: typeof feedback.createdAt === 'string' && Number.isFinite(Date.parse(feedback.createdAt)) ? feedback.createdAt : '',
    }))
    .filter((feedback) => feedback.id && feedback.text && feedback.createdDate && feedback.createdAt && !seen.has(feedback.id) && seen.add(feedback.id))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
}

export function addReviewFeedback(tasks, reviewId, textValue, feedbackId, createdDate, createdAt) {
  if (!Array.isArray(tasks)) return []
  const text = typeof textValue === 'string' ? textValue.trim() : ''
  const normalizedDate = normalizeDeadlineDate(createdDate)
  const normalizedCreatedAt = typeof createdAt === 'string' && Number.isFinite(Date.parse(createdAt)) ? createdAt : ''
  const review = tasks.find((task) => task?.id === reviewId && task.bucket === REVIEW_BUCKET)
  if (!review || !text || !feedbackId || !normalizedDate || !normalizedCreatedAt || reviewFeedbacks(review).some((feedback) => feedback.id === feedbackId)) return tasks
  const feedback = { id: feedbackId, text, createdDate: normalizedDate, createdAt: normalizedCreatedAt }
  return tasks.map((task) => task?.id === reviewId ? { ...task, reviewFeedbacks: reviewFeedbacks({ reviewFeedbacks: [feedback, ...(task.reviewFeedbacks || [])] }) } : task)
}

export function updateReviewFeedback(tasks, reviewId, feedbackId, textValue) {
  if (!Array.isArray(tasks)) return []
  const text = typeof textValue === 'string' ? textValue.trim() : ''
  const review = tasks.find((task) => task?.id === reviewId && task.bucket === REVIEW_BUCKET)
  const feedbacks = reviewFeedbacks(review)
  const feedback = feedbacks.find((item) => item.id === feedbackId)
  if (!review || !feedback || !text || feedback.text === text) return tasks
  return tasks.map((task) => task?.id === reviewId ? {
    ...task,
    reviewFeedbacks: feedbacks.map((item) => item.id === feedbackId ? { ...item, text } : item),
  } : task)
}

export function incrementReviewOccurrence(tasks, id, date) {
  if (!Array.isArray(tasks) || !normalizeDeadlineDate(date)) return Array.isArray(tasks) ? tasks : []
  return tasks.map((task) => {
    if (task?.id !== id || task.bucket !== REVIEW_BUCKET) return task
    return {
      ...task,
      reviewOccurrenceCount: Math.max(1, Number(task.reviewOccurrenceCount) || 1) + 1,
      reviewLastOccurredAt: date,
      reviewStatus: task.reviewStatus === REVIEW_STATUS_IMPROVED ? REVIEW_STATUS_PENDING : normalizeReviewStatus(task.reviewStatus),
    }
  })
}

export function addReviewActionToToday(tasks, reviewId, todayDate, actionId) {
  if (!Array.isArray(tasks) || !normalizeDeadlineDate(todayDate) || !actionId) return Array.isArray(tasks) ? tasks : []
  const review = tasks.find((task) => task?.id === reviewId && task.bucket === REVIEW_BUCKET)
  const title = typeof review?.reviewAction === 'string' ? review.reviewAction.trim() : ''
  if (!title || tasks.some((task) => task?.sourceReviewId === reviewId && task.date === todayDate && !task.completed)) return tasks
  return [{ id: actionId, title, completed: false, date: todayDate, sourceReviewId: reviewId }, ...tasks]
}

export function addReviewActionToHabits(tasks, reviewId, habitId) {
  if (!Array.isArray(tasks) || !habitId) return Array.isArray(tasks) ? tasks : []
  const review = tasks.find((task) => task?.id === reviewId && task.bucket === REVIEW_BUCKET)
  const action = typeof review?.reviewAction === 'string' ? review.reviewAction.trim() : ''
  if (!review || !action || tasks.some((task) => task?.bucket === HABIT_BUCKET && task.sourceReviewId === reviewId)) return tasks
  return [{
    id: habitId,
    title: `改进：${review.title}`,
    completed: false,
    bucket: HABIT_BUCKET,
    habitState: HABIT_STATE_CANDIDATE,
    habitDurationDays: 45,
    habitWeeklyTarget: 5,
    habitMinimum: action,
    habitCheckIns: [],
    habitRestDays: [],
    sourceReviewId: reviewId,
  }, ...tasks]
}

export function toggleTaskImportance(tasks, id) {
  if (!Array.isArray(tasks)) return []
  return tasks.map((task) => task?.id === id ? { ...task, important: !task.important } : task)
}

function calendarDayDistance(fromDate, toDate) {
  const [fromYear, fromMonth, fromDay] = fromDate.split('-').map(Number)
  const [toYear, toMonth, toDay] = toDate.split('-').map(Number)
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86400000)
}

export function carryOverUnfinishedTasks(tasks, todayDate) {
  if (!Array.isArray(tasks) || !normalizeDeadlineDate(todayDate)) return Array.isArray(tasks) ? tasks : []

  let changed = false
  const next = tasks.map((task) => {
    const taskDate = normalizeDeadlineDate(task?.date)
    if (!task || task.completed || task.bucket || task.dailyTemplateId || !taskDate || taskDate >= todayDate) return task

    const elapsedDays = calendarDayDistance(taskDate, todayDate)
    if (elapsedDays < 1) return task
    changed = true
    return {
      ...task,
      date: todayDate,
      carriedFromDate: normalizeDeadlineDate(task.carriedFromDate) || taskDate,
      carryoverCount: Math.max(0, Number(task.carryoverCount) || 0) + elapsedDays,
      carriedOverAt: todayDate,
    }
  })

  return changed ? next : tasks
}

function normalizeDailyDates(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(normalizeDeadlineDate).filter(Boolean))].sort()
}

export function dailyTaskInstanceId(templateId, date) {
  const normalizedDate = normalizeDeadlineDate(date)
  return templateId && normalizedDate ? `${templateId}@${normalizedDate}` : null
}

function dailyTaskInstance(template, date) {
  const id = dailyTaskInstanceId(template?.id, date)
  if (!id) return null
  const reminderTime = normalizeReminderTime(template.reminderTime)
  return {
    id,
    title: String(template.title || '').trim(),
    completed: false,
    date,
    dailyTemplateId: template.id,
    ...(reminderTime ? { reminderTime } : {}),
  }
}

export function createDailyTaskSeries(tasks, title, date, templateId, reminderValue = '') {
  if (!Array.isArray(tasks)) return []
  const normalizedTitle = typeof title === 'string' ? title.trim() : ''
  const normalizedDate = normalizeDeadlineDate(date)
  const reminderTime = normalizeReminderTime(reminderValue)
  if (!normalizedTitle || !normalizedDate || !templateId || tasks.some((task) => task?.id === templateId)) return tasks
  const template = {
    id: templateId,
    title: normalizedTitle,
    completed: false,
    bucket: DAILY_TEMPLATE_BUCKET,
    dailyActive: true,
    dailyCreatedDate: normalizedDate,
    dailySkippedDates: [],
    ...(reminderTime ? { reminderTime } : {}),
  }
  const instance = dailyTaskInstance(template, normalizedDate)
  return instance ? [instance, template, ...tasks] : tasks
}

export function materializeDailyTasks(tasks, date) {
  const normalizedDate = normalizeDeadlineDate(date)
  if (!Array.isArray(tasks) || !normalizedDate) return Array.isArray(tasks) ? tasks : []
  const ids = new Set(tasks.map((task) => task?.id).filter(Boolean))
  const created = []

  for (const template of tasks) {
    if (template?.bucket !== DAILY_TEMPLATE_BUCKET || template.dailyActive === false) continue
    const createdDate = normalizeDeadlineDate(template.dailyCreatedDate)
    if (createdDate && createdDate > normalizedDate) continue
    if (normalizeDailyDates(template.dailySkippedDates).includes(normalizedDate)) continue
    const instance = dailyTaskInstance(template, normalizedDate)
    if (!instance || ids.has(instance.id)) continue
    ids.add(instance.id)
    created.push(instance)
  }

  return created.length > 0 ? [...created, ...tasks] : tasks
}

export function skipDailyTaskForDate(tasks, instanceId) {
  if (!Array.isArray(tasks)) return []
  const instance = tasks.find((task) => task?.id === instanceId && task.dailyTemplateId)
  const date = normalizeDeadlineDate(instance?.date)
  if (!instance || !date) return tasks
  return tasks
    .filter((task) => task?.id !== instanceId)
    .map((task) => task?.id === instance.dailyTemplateId && task.bucket === DAILY_TEMPLATE_BUCKET
      ? { ...task, dailySkippedDates: normalizeDailyDates([...(task.dailySkippedDates || []), date]) }
      : task)
}

export function stopDailyTaskSeries(tasks, instanceId, stoppedAt) {
  if (!Array.isArray(tasks) || !normalizeDeadlineDate(stoppedAt)) return Array.isArray(tasks) ? tasks : []
  const instance = tasks.find((task) => task?.id === instanceId && task.dailyTemplateId)
  if (!instance) return tasks
  return tasks.map((task) => task?.id === instance.dailyTemplateId && task.bucket === DAILY_TEMPLATE_BUCKET
    ? { ...task, dailyActive: false, dailyStoppedAt: stoppedAt }
    : task)
}

export function carryoverLabel(task) {
  const days = Math.max(1, Math.floor(Number(task?.carryoverCount) || 1))
  return days === 1 ? '昨日未完成' : `延续 ${days} 天`
}

export function compareTaskImportance(left, right) {
  const leftImportant = Boolean(left?.important)
  const rightImportant = Boolean(right?.important)
  if (leftImportant === rightImportant) return 0
  return leftImportant ? -1 : 1
}

export function normalizeDeadlineDate(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!deadlineDatePattern.test(normalized)) return null
  const [year, month, day] = normalized.split('-').map(Number)
  const candidate = new Date(year, month - 1, day)
  return candidate.getFullYear() === year && candidate.getMonth() === month - 1 && candidate.getDate() === day ? normalized : null
}

export function updateTaskDetails(tasks, id, draft) {
  if (!Array.isArray(tasks)) return []
  const task = tasks.find((item) => item?.id === id)
  const title = typeof draft?.title === 'string' ? draft.title.trim() : ''
  if (!task || !title) return tasks

  if (task.dailyTemplateId) {
    const rawReminderTime = typeof draft?.reminderTime === 'string' ? draft.reminderTime.trim() : ''
    const reminderTime = normalizeReminderTime(rawReminderTime)
    if (rawReminderTime && !reminderTime) return tasks
    return tasks.map((item) => {
      if (item?.id !== id && item?.id !== task.dailyTemplateId) return item
      const { reminderTime: _time, reminderFiredFor: _fired, ...rest } = item
      return reminderTime ? { ...rest, title, reminderTime } : { ...rest, title }
    })
  }

  let deadlineDate = null
  let deadlineTime = null
  if (task.bucket === DEADLINE_BUCKET) {
    deadlineDate = normalizeDeadlineDate(draft.deadlineDate)
    const rawDeadlineTime = typeof draft.deadlineTime === 'string' ? draft.deadlineTime.trim() : ''
    deadlineTime = normalizeReminderTime(rawDeadlineTime)
    if (!deadlineDate || (rawDeadlineTime && !deadlineTime)) return tasks
  }

  return tasks.map((item) => {
    if (item?.id !== id) return item
    if (item.bucket !== DEADLINE_BUCKET) return { ...item, title }
    const next = { ...item, title, deadlineDate }
    if (deadlineTime) next.deadlineTime = deadlineTime
    else delete next.deadlineTime
    return next
  })
}

export function deadlineStatus(task, now = new Date()) {
  const deadlineDate = normalizeDeadlineDate(task?.deadlineDate)
  if (!deadlineDate || !(now instanceof Date) || Number.isNaN(now.getTime())) return { key: 'unknown', label: '未设置日期', days: null }
  const [year, month, day] = deadlineDate.split('-').map(Number)
  const deadlineDay = Date.UTC(year, month - 1, day)
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((deadlineDay - today) / 86400000)
  if (days < 0) return { key: 'overdue', label: `已超期 ${Math.abs(days)} 天`, days }
  if (days === 0) return { key: 'today', label: '今天截止', days }
  if (days <= 3) return { key: 'soon', label: `还剩 ${days} 天`, days }
  return { key: 'future', label: `还剩 ${days} 天`, days }
}

export function compareDeadlineTasks(left, right) {
  const leftDate = normalizeDeadlineDate(left?.deadlineDate) || '9999-12-31'
  const rightDate = normalizeDeadlineDate(right?.deadlineDate) || '9999-12-31'
  const leftTime = normalizeReminderTime(left?.deadlineTime) || '23:59'
  const rightTime = normalizeReminderTime(right?.deadlineTime) || '23:59'
  return `${leftDate}T${leftTime}`.localeCompare(`${rightDate}T${rightTime}`)
}

export function moveDeadlineToToday(tasks, id, todayDate) {
  if (!Array.isArray(tasks) || !normalizeDeadlineDate(todayDate)) return Array.isArray(tasks) ? tasks : []
  return tasks.map((task) => task?.id === id && task.bucket === DEADLINE_BUCKET ? { ...task, date: todayDate } : task)
}

export function normalizeHabitDuration(value) {
  const duration = Number(value)
  return habitDurations.has(duration) ? duration : 45
}

export function normalizeHabitWeeklyTarget(value) {
  const target = Math.round(Number(value))
  return Number.isFinite(target) ? Math.min(7, Math.max(1, target)) : 4
}

function normalizeHabitDates(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(normalizeDeadlineDate).filter(Boolean))].sort()
}

function toUtcDay(value) {
  const normalized = normalizeDeadlineDate(value)
  if (!normalized) return null
  const [year, month, day] = normalized.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function toDateLabel(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

export function startHabitCycle(tasks, id, startDate) {
  if (!Array.isArray(tasks) || !normalizeDeadlineDate(startDate)) return Array.isArray(tasks) ? tasks : []
  if (tasks.some((task) => task?.bucket === HABIT_BUCKET && task.habitState === HABIT_STATE_ACTIVE && task.id !== id)) return tasks
  return tasks.map((task) => {
    if (task?.id !== id || task.bucket !== HABIT_BUCKET) return task
    const { date: _date, reminderTime: _reminderTime, reminderFiredFor: _reminderFiredFor, habitEndedAt: _endedAt, ...rest } = task
    return {
      ...rest,
      completed: false,
      habitState: HABIT_STATE_ACTIVE,
      habitStartedAt: startDate,
      habitDurationDays: normalizeHabitDuration(task.habitDurationDays),
      habitWeeklyTarget: normalizeHabitWeeklyTarget(task.habitWeeklyTarget),
      habitCheckIns: normalizeHabitDates(task.habitCheckIns),
      habitRestDays: normalizeHabitDates(task.habitRestDays),
    }
  })
}

export function finishHabitCycle(tasks, id, endDate) {
  if (!Array.isArray(tasks) || !normalizeDeadlineDate(endDate)) return Array.isArray(tasks) ? tasks : []
  return tasks.map((task) => {
    if (task?.id !== id || task.bucket !== HABIT_BUCKET || task.habitState !== HABIT_STATE_ACTIVE) return task
    const { date: _date, reminderTime: _reminderTime, reminderFiredFor: _reminderFiredFor, ...rest } = task
    return { ...rest, completed: false, habitState: HABIT_STATE_FINISHED, habitEndedAt: endDate }
  })
}

export function moveHabitToToday(tasks, id, todayDate) {
  if (!Array.isArray(tasks) || !normalizeDeadlineDate(todayDate)) return Array.isArray(tasks) ? tasks : []
  return tasks.map((task) => task?.id === id && task.bucket === HABIT_BUCKET && task.habitState === HABIT_STATE_ACTIVE ? { ...task, completed: false, date: todayDate } : task)
}

export function recordHabitCheckIn(tasks, id, date) {
  if (!Array.isArray(tasks) || !normalizeDeadlineDate(date)) return Array.isArray(tasks) ? tasks : []
  return tasks.map((task) => {
    if (task?.id !== id || task.bucket !== HABIT_BUCKET || task.habitState !== HABIT_STATE_ACTIVE) return task
    const { date: scheduledDate, reminderTime: _reminderTime, reminderFiredFor: _reminderFiredFor, ...rest } = task
    const next = {
      ...rest,
      completed: false,
      habitCheckIns: normalizeHabitDates([...(task.habitCheckIns || []), date]),
      habitRestDays: normalizeHabitDates(task.habitRestDays).filter((item) => item !== date),
    }
    return scheduledDate && scheduledDate !== date ? { ...next, date: scheduledDate } : next
  })
}

export function recordHabitRest(tasks, id, date) {
  if (!Array.isArray(tasks) || !normalizeDeadlineDate(date)) return Array.isArray(tasks) ? tasks : []
  return tasks.map((task) => {
    if (task?.id !== id || task.bucket !== HABIT_BUCKET || task.habitState !== HABIT_STATE_ACTIVE) return task
    const { date: scheduledDate, reminderTime: _reminderTime, reminderFiredFor: _reminderFiredFor, ...rest } = task
    const next = {
      ...rest,
      completed: false,
      habitCheckIns: normalizeHabitDates(task.habitCheckIns).filter((item) => item !== date),
      habitRestDays: normalizeHabitDates([...(task.habitRestDays || []), date]),
    }
    return scheduledDate && scheduledDate !== date ? { ...next, date: scheduledDate } : next
  })
}

export function habitProgress(task, todayDate) {
  const start = toUtcDay(task?.habitStartedAt)
  const today = toUtcDay(todayDate)
  const durationDays = normalizeHabitDuration(task?.habitDurationDays)
  const weeklyTarget = normalizeHabitWeeklyTarget(task?.habitWeeklyTarget)
  const checkIns = normalizeHabitDates(task?.habitCheckIns)
  if (!start || !today) return { cycleDay: 0, durationDays, weeklyTarget, weeklyCount: 0, totalCount: checkIns.length, progressPercent: 0, endDate: null, isComplete: false }

  const rawCycleDay = Math.floor((today - start) / 86400000) + 1
  const cycleDay = Math.min(durationDays, Math.max(0, rawCycleDay))
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + durationDays - 1)
  const weekStart = new Date(today)
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7))
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
  const weeklyCount = checkIns.filter((date) => {
    const day = toUtcDay(date)
    return day && day >= weekStart && day <= weekEnd
  }).length
  return {
    cycleDay,
    durationDays,
    weeklyTarget,
    weeklyCount,
    totalCount: checkIns.length,
    progressPercent: Math.round((cycleDay / durationDays) * 100),
    endDate: toDateLabel(end),
    isComplete: rawCycleDay > durationDays,
  }
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
  const target = tasks.find((task) => task?.id === id)
  return tasks.map((task) => {
    if (task?.id !== id && (!target?.dailyTemplateId || task?.id !== target.dailyTemplateId)) return task
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
