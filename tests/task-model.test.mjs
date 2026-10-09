import assert from 'node:assert/strict'
import test from 'node:test'
import { DEADLINE_BUCKET, HABIT_BUCKET, HABIT_MINIMUM_UNIT_CUSTOM, HABIT_MINIMUM_UNIT_HOURS, HABIT_MINIMUM_UNIT_MINUTES, HABIT_STATE_ACTIVE, HABIT_STATE_CANDIDATE, HABIT_STATE_FINISHED, IDEA_BUCKET, IDEA_FILTER_ALL, IDEA_TAG_GOAL, IDEA_TAG_INTEREST, NOTE_BUCKET, REVIEW_BUCKET, REVIEW_CATEGORY_OTHER, REVIEW_CATEGORY_PROCESS, REVIEW_FILTER_ALL, REVIEW_STATUS_IMPROVED, REVIEW_STATUS_PENDING, REVIEW_STATUS_VERIFY, addNoteToIdeas, addNoteToToday, addReviewActionToHabits, addReviewActionToToday, carryOverUnfinishedTasks, carryoverLabel, compareDeadlineTasks, compareNotes, compareTaskImportance, deadlineStatus, findDueTaskReminders, finishHabitCycle, formatHabitMinimum, habitMinimumLabel, habitProgress, ideaMatchesFilter, incrementReviewOccurrence, markTaskReminderFired, migrateTasks, moveDeadlineToToday, moveHabitToToday, normalizeDeadlineDate, normalizeHabitDuration, normalizeHabitWeeklyTarget, normalizeReminderTime, normalizeReviewCategory, normalizeReviewStatus, noteDisplayTitle, noteMatchesQuery, parseHabitMinimum, recordHabitCheckIn, recordHabitRest, reminderOccurrenceKey, reviewMatchesFilter, setTaskReminder, startHabitCycle, toggleNotePinned, toggleTaskImportance, updateTaskDetails, upsertNote } from '../src/task-model.js'

test('migrates legacy unfinished records into untagged ideas without changing identity or status', () => {
  const source = [{ id: 'legacy-1', title: '旧未完成事项', completed: true, date: '2026-09-17', bucket: 'unfinished' }]
  const [migrated] = migrateTasks(source)
  assert.deepEqual(migrated, {
    id: 'legacy-1',
    title: '旧未完成事项',
    completed: true,
    date: '2026-09-17',
    bucket: 'idea',
    ideaTags: [],
  })
})

test('migration is idempotent and never duplicates records', () => {
  const once = migrateTasks([{ id: 'legacy-1', title: '想法', completed: false, bucket: 'unfinished' }])
  const twice = migrateTasks(once)
  assert.equal(twice.length, 1)
  assert.deepEqual(twice, once)
})

test('untagged migrated ideas appear in All but not in tagged filters', () => {
  const [idea] = migrateTasks([{ id: 'legacy-1', title: '想法', completed: false, bucket: 'unfinished' }])
  assert.equal(ideaMatchesFilter(idea, IDEA_FILTER_ALL), true)
  assert.equal(ideaMatchesFilter(idea, IDEA_TAG_GOAL), false)
  assert.equal(ideaMatchesFilter(idea, IDEA_TAG_INTEREST), false)
})

test('an idea can belong to both filters', () => {
  const idea = { id: 'idea-1', bucket: 'idea', ideaTags: [IDEA_TAG_GOAL, IDEA_TAG_INTEREST] }
  assert.equal(ideaMatchesFilter(idea, IDEA_TAG_GOAL), true)
  assert.equal(ideaMatchesFilter(idea, IDEA_TAG_INTEREST), true)
})

test('uses a note title or first content line and searches title plus body', () => {
  const titled = { id: 'note-1', bucket: NOTE_BUCKET, title: '课程灵感', noteContent: '正文里有关键字' }
  const untitled = { id: 'note-2', bucket: NOTE_BUCKET, title: '  ', noteContent: '\n第一行摘要\n第二行' }
  assert.equal(noteDisplayTitle(titled), '课程灵感')
  assert.equal(noteDisplayTitle(untitled), '第一行摘要')
  assert.equal(noteMatchesQuery(titled, '课程'), true)
  assert.equal(noteMatchesQuery(titled, '关键字'), true)
  assert.equal(noteMatchesQuery(titled, '不存在'), false)
})

test('upserts valid notes and sorts pinned notes before newest regular notes', () => {
  const older = { id: 'older', bucket: NOTE_BUCKET, noteContent: '旧笔记', noteUpdatedAt: '2026-10-01T08:00:00.000Z' }
  const newer = { id: 'newer', bucket: NOTE_BUCKET, noteContent: '新笔记', noteUpdatedAt: '2026-10-02T08:00:00.000Z' }
  assert.equal(upsertNote([], { id: 'blank', bucket: NOTE_BUCKET, noteContent: '   ' }).length, 0)
  const created = upsertNote([older], newer)
  assert.deepEqual(created.map((note) => note.id), ['newer', 'older'])
  const updated = upsertNote(created, { ...older, noteContent: '更新后的旧笔记', noteUpdatedAt: '2026-10-03T08:00:00.000Z' })
  assert.equal(updated.find((note) => note.id === 'older').noteContent, '更新后的旧笔记')
  const pinned = toggleNotePinned(updated, 'newer', '2026-10-04T08:00:00.000Z')
  assert.deepEqual([...pinned].sort(compareNotes).map((note) => note.id), ['newer', 'older'])
})

test('creates one linked idea and one today task from a note without removing the note', () => {
  const note = { id: 'note-1', bucket: NOTE_BUCKET, title: '', noteContent: '整理课程里的零散灵感', noteCreatedAt: '2026-10-06T08:00:00.000Z' }
  const withIdea = addNoteToIdeas([note], note.id, 'idea-1')
  assert.equal(withIdea.length, 2)
  assert.deepEqual(withIdea[0], { id: 'idea-1', title: '整理课程里的零散灵感', completed: false, bucket: IDEA_BUCKET, ideaTags: [], sourceNoteId: note.id })
  assert.equal(addNoteToIdeas(withIdea, note.id, 'idea-2'), withIdea)
  const withToday = addNoteToToday(withIdea, note.id, '2026-10-06', 'today-1')
  assert.deepEqual(withToday[0], { id: 'today-1', title: '整理课程里的零散灵感', completed: false, date: '2026-10-06', sourceNoteId: note.id })
  assert.equal(addNoteToToday(withToday, note.id, '2026-10-06', 'today-2'), withToday)
  assert.equal(withToday.some((item) => item.id === note.id), true)
})

test('toggles importance without changing other tasks', () => {
  const source = [
    { id: 'today-1', title: '重要事项', completed: false, date: '2026-09-20' },
    { id: 'today-2', title: '普通事项', completed: false, date: '2026-09-20' },
  ]
  const marked = toggleTaskImportance(source, 'today-1')
  assert.equal(marked[0].important, true)
  assert.equal(marked[1], source[1])
  assert.equal(toggleTaskImportance(marked, 'today-1')[0].important, false)
})

test('sorts important tasks first while preserving order within each group', () => {
  const source = [
    { id: 'normal-1', important: false },
    { id: 'delayed-important', important: true, carryoverCount: 4 },
    { id: 'normal-2' },
    { id: 'current-important', important: true },
  ]
  assert.deepEqual([...source].sort(compareTaskImportance).map((task) => task.id), [
    'delayed-important',
    'current-important',
    'normal-1',
    'normal-2',
  ])
})

test('carries only unfinished ordinary tasks into today without duplicating them', () => {
  const source = [
    { id: 'ordinary', title: '昨日任务', completed: false, date: '2026-09-30' },
    { id: 'done', title: '已经完成', completed: true, date: '2026-09-30' },
    { id: 'tomorrow', title: '明日任务', completed: false, date: '2026-10-02' },
    { id: 'idea', title: '想法', completed: false, date: '2026-09-30', bucket: IDEA_BUCKET },
    { id: 'deadline', title: 'DDL', completed: false, date: '2026-09-30', bucket: DEADLINE_BUCKET },
    { id: 'habit', title: '习惯', completed: false, date: '2026-09-30', bucket: HABIT_BUCKET },
    { id: 'review', title: '复盘', completed: false, date: '2026-09-30', bucket: REVIEW_BUCKET },
  ]
  const carried = carryOverUnfinishedTasks(source, '2026-10-01')

  assert.equal(carried.length, source.length)
  assert.deepEqual(carried[0], { ...source[0], date: '2026-10-01', carriedFromDate: '2026-09-30', carryoverCount: 1, carriedOverAt: '2026-10-01' })
  assert.deepEqual(carried.slice(1), source.slice(1))
  assert.equal(carryoverLabel(carried[0]), '昨日未完成')
})

test('counts missed calendar days and remains idempotent on the same day', () => {
  const source = [{ id: 'ordinary', title: '持续任务', completed: false, date: '2026-09-28' }]
  const carried = carryOverUnfinishedTasks(source, '2026-10-01')
  const sameDay = carryOverUnfinishedTasks(carried, '2026-10-01')
  const nextDay = carryOverUnfinishedTasks(carried, '2026-10-02')

  assert.equal(carried[0].carryoverCount, 3)
  assert.equal(carryoverLabel(carried[0]), '延续 3 天')
  assert.equal(sameDay, carried)
  assert.equal(nextDay[0].carryoverCount, 4)
  assert.equal(nextDay[0].carriedFromDate, '2026-09-28')
})

test('normalizes reminder time and rejects invalid values', () => {
  assert.equal(normalizeReminderTime('16.00'), '16:00')
  assert.equal(normalizeReminderTime('09:05'), '09:05')
  assert.equal(normalizeReminderTime('24:00'), null)
  assert.equal(normalizeReminderTime('9:05'), null)
})

test('sets, changes, and clears a single task reminder', () => {
  const source = [{ id: 'today-1', title: '开会', date: '2026-09-22', reminderFiredFor: 'old' }]
  const scheduled = setTaskReminder(source, 'today-1', '16:00')
  assert.equal(scheduled[0].reminderTime, '16:00')
  assert.equal(scheduled[0].reminderFiredFor, undefined)
  assert.equal(reminderOccurrenceKey(scheduled[0]), '2026-09-22T16:00')
  assert.equal(setTaskReminder(scheduled, 'today-1', '')[0].reminderTime, undefined)
})

test('finds only due unfinished reminders for today within the grace window', () => {
  const now = new Date(2026, 8, 22, 16, 20, 0)
  const tasks = [
    { id: 'due', title: '该做了', date: '2026-09-22', reminderTime: '16:00', completed: false },
    { id: 'future', title: '还没到', date: '2026-09-22', reminderTime: '17:00', completed: false },
    { id: 'tomorrow', title: '明天', date: '2026-09-23', reminderTime: '16:00', completed: false },
    { id: 'completed', title: '已完成', date: '2026-09-22', reminderTime: '16:00', completed: true },
    { id: 'idea', title: '想法', date: '2026-09-22', reminderTime: '16:00', completed: false, bucket: 'idea' },
    { id: 'old', title: '太久以前', date: '2026-09-22', reminderTime: '14:00', completed: false },
  ]
  assert.deepEqual(findDueTaskReminders(tasks, now).map((task) => task.id), ['due'])
  const fired = markTaskReminderFired(tasks, 'due', '2026-09-22T16:00')
  assert.deepEqual(findDueTaskReminders(fired, now), [])
})

test('normalizes real deadline dates and rejects impossible dates', () => {
  assert.equal(normalizeDeadlineDate('2026-09-25'), '2026-09-25')
  assert.equal(normalizeDeadlineDate('2026-02-30'), null)
  assert.equal(normalizeDeadlineDate('2026-9-25'), null)
})

test('describes deadline urgency by calendar day', () => {
  const now = new Date(2026, 8, 23, 18, 0)
  assert.deepEqual(deadlineStatus({ deadlineDate: '2026-09-20' }, now), { key: 'overdue', label: '已超期 3 天', days: -3 })
  assert.deepEqual(deadlineStatus({ deadlineDate: '2026-09-23' }, now), { key: 'today', label: '今天截止', days: 0 })
  assert.deepEqual(deadlineStatus({ deadlineDate: '2026-09-25' }, now), { key: 'soon', label: '还剩 2 天', days: 2 })
  assert.deepEqual(deadlineStatus({ deadlineDate: '2026-10-05' }, now), { key: 'future', label: '还剩 12 天', days: 12 })
})

test('sorts deadlines chronologically and joins today without duplicating the task', () => {
  const source = [
    { id: 'later', bucket: DEADLINE_BUCKET, deadlineDate: '2026-10-05', completed: false },
    { id: 'sooner', bucket: DEADLINE_BUCKET, deadlineDate: '2026-09-25', deadlineTime: '16:00', completed: false },
  ]
  assert.deepEqual([...source].sort(compareDeadlineTasks).map((task) => task.id), ['sooner', 'later'])
  const joined = moveDeadlineToToday(source, 'sooner', '2026-09-23')
  assert.equal(joined.length, 2)
  assert.equal(joined[1].date, '2026-09-23')
  assert.equal(joined[1].bucket, DEADLINE_BUCKET)
})

test('edits an ordinary task title without changing completion or metadata', () => {
  const source = [{
    id: 'today-1',
    title: '旧标题',
    completed: true,
    date: '2026-10-08',
    important: true,
    reminderTime: '16:00',
    carriedFromDate: '2026-10-07',
    carryoverCount: 1,
  }]
  const [updated] = updateTaskDetails(source, 'today-1', { title: '  新标题  ' })
  assert.deepEqual(updated, { ...source[0], title: '新标题' })
})

test('edits deadline fields while preserving completion state and clears optional time', () => {
  const source = [{ id: 'ddl-1', title: '旧 DDL', completed: true, bucket: DEADLINE_BUCKET, deadlineDate: '2026-10-10', deadlineTime: '09:00', extra: 'keep' }]
  const changed = updateTaskDetails(source, 'ddl-1', { title: '新 DDL', deadlineDate: '2026-10-12', deadlineTime: '18:30' })
  assert.deepEqual(changed[0], { ...source[0], title: '新 DDL', deadlineDate: '2026-10-12', deadlineTime: '18:30' })
  const cleared = updateTaskDetails(changed, 'ddl-1', { title: '新 DDL', deadlineDate: '2026-10-12', deadlineTime: '' })
  assert.equal(cleared[0].deadlineTime, undefined)
  assert.equal(cleared[0].completed, true)
  assert.equal(cleared[0].extra, 'keep')
})

test('edits an idea title without changing its tags and rejects invalid drafts', () => {
  const source = [{ id: 'idea-1', title: '旧想法', completed: false, bucket: IDEA_BUCKET, ideaTags: [IDEA_TAG_GOAL, IDEA_TAG_INTEREST] }]
  const updated = updateTaskDetails(source, 'idea-1', { title: '新想法' })
  assert.deepEqual(updated[0].ideaTags, source[0].ideaTags)
  assert.equal(updateTaskDetails(updated, 'idea-1', { title: '   ' }), updated)
  assert.equal(updateTaskDetails([{ ...source[0], bucket: DEADLINE_BUCKET, deadlineDate: '2026-10-10' }], 'idea-1', { title: '无效日期', deadlineDate: '2026-02-30' })[0].title, '旧想法')
})

test('normalizes habit cycle settings to the supported range', () => {
  assert.equal(normalizeHabitDuration(30), 30)
  assert.equal(normalizeHabitDuration('60'), 60)
  assert.equal(normalizeHabitDuration(90), 45)
  assert.equal(normalizeHabitWeeklyTarget(0), 1)
  assert.equal(normalizeHabitWeeklyTarget(9), 7)
  assert.equal(normalizeHabitWeeklyTarget('4'), 4)
})

test('formats habit minimum values with an explicit time unit', () => {
  assert.deepEqual(parseHabitMinimum('25'), { value: '25', unit: HABIT_MINIMUM_UNIT_MINUTES })
  assert.deepEqual(parseHabitMinimum('1.5 小时'), { value: '1.5', unit: HABIT_MINIMUM_UNIT_HOURS })
  assert.deepEqual(parseHabitMinimum('完成一章'), { value: '完成一章', unit: HABIT_MINIMUM_UNIT_CUSTOM })
  assert.equal(formatHabitMinimum('25', HABIT_MINIMUM_UNIT_MINUTES), '25 分钟')
  assert.equal(formatHabitMinimum('1.5', HABIT_MINIMUM_UNIT_HOURS), '1.5 小时')
  assert.equal(habitMinimumLabel('25'), '25 分钟')
  assert.equal(habitMinimumLabel('完成一章'), '完成一章')
})

test('migrates a legacy numeric habit minimum to minutes without changing custom text', () => {
  const migrated = migrateTasks([
    { id: 'reading', bucket: HABIT_BUCKET, habitMinimum: '25' },
    { id: 'writing', bucket: HABIT_BUCKET, habitMinimum: '完成一章' },
  ])
  assert.equal(migrated[0].habitMinimum, '25 分钟')
  assert.equal(migrated[1].habitMinimum, '完成一章')
  assert.deepEqual(migrateTasks(migrated), migrated)
})

test('allows only one focused habit and keeps the same record when joining today', () => {
  const source = [
    { id: 'reading', title: '阅读', bucket: HABIT_BUCKET, habitState: HABIT_STATE_CANDIDATE, habitDurationDays: 45, habitWeeklyTarget: 4 },
    { id: 'fitness', title: '健身', bucket: HABIT_BUCKET, habitState: HABIT_STATE_CANDIDATE, habitDurationDays: 30, habitWeeklyTarget: 3 },
  ]
  const started = startHabitCycle(source, 'reading', '2026-09-23')
  assert.equal(started[0].habitState, HABIT_STATE_ACTIVE)
  assert.equal(startHabitCycle(started, 'fitness', '2026-09-23'), started)
  const scheduled = moveHabitToToday(started, 'reading', '2026-09-23')
  assert.equal(scheduled.length, 2)
  assert.equal(scheduled[0].date, '2026-09-23')
})

test('records one habit action per date and treats rest as a neutral alternative', () => {
  const source = [{ id: 'reading', title: '阅读', bucket: HABIT_BUCKET, habitState: HABIT_STATE_ACTIVE, habitStartedAt: '2026-09-01', habitDurationDays: 45, habitWeeklyTarget: 4, date: '2026-09-23' }]
  const checked = recordHabitCheckIn(recordHabitCheckIn(source, 'reading', '2026-09-23'), 'reading', '2026-09-23')
  assert.deepEqual(checked[0].habitCheckIns, ['2026-09-23'])
  assert.equal(checked[0].date, undefined)
  const rested = recordHabitRest(checked, 'reading', '2026-09-23')
  assert.deepEqual(rested[0].habitCheckIns, [])
  assert.deepEqual(rested[0].habitRestDays, ['2026-09-23'])
})

test('calculates weekly and cycle habit progress and can finish the cycle', () => {
  const source = [{ id: 'reading', title: '阅读', bucket: HABIT_BUCKET, habitState: HABIT_STATE_ACTIVE, habitStartedAt: '2026-09-01', habitDurationDays: 45, habitWeeklyTarget: 4, habitCheckIns: ['2026-09-21', '2026-09-23', '2026-09-23'] }]
  assert.deepEqual(habitProgress(source[0], '2026-09-23'), {
    cycleDay: 23,
    durationDays: 45,
    weeklyTarget: 4,
    weeklyCount: 2,
    totalCount: 2,
    progressPercent: 51,
    endDate: '2026-10-15',
    isComplete: false,
  })
  const finished = finishHabitCycle(source, 'reading', '2026-09-23')
  assert.equal(finished[0].habitState, HABIT_STATE_FINISHED)
  assert.equal(finished[0].habitEndedAt, '2026-09-23')
})

test('normalizes review categories and filters the three review stages', () => {
  const pending = { id: 'review-1', bucket: REVIEW_BUCKET, reviewStatus: REVIEW_STATUS_PENDING }
  assert.equal(normalizeReviewStatus('unknown'), REVIEW_STATUS_PENDING)
  assert.equal(normalizeReviewCategory(REVIEW_CATEGORY_PROCESS), REVIEW_CATEGORY_PROCESS)
  assert.equal(normalizeReviewCategory('unknown'), REVIEW_CATEGORY_OTHER)
  assert.equal(reviewMatchesFilter(pending, REVIEW_FILTER_ALL), true)
  assert.equal(reviewMatchesFilter(pending, REVIEW_STATUS_PENDING), true)
  assert.equal(reviewMatchesFilter(pending, REVIEW_STATUS_VERIFY), false)
})

test('counts repeated problems and reopens an improved review', () => {
  const source = [{ id: 'review-1', bucket: REVIEW_BUCKET, reviewStatus: REVIEW_STATUS_IMPROVED, reviewOccurrenceCount: 2 }]
  const repeated = incrementReviewOccurrence(source, 'review-1', '2026-09-24')
  assert.equal(repeated[0].reviewOccurrenceCount, 3)
  assert.equal(repeated[0].reviewStatus, REVIEW_STATUS_PENDING)
  assert.equal(repeated[0].reviewLastOccurredAt, '2026-09-24')
})

test('turns one review action into one today task without duplicating it', () => {
  const source = [{ id: 'review-1', title: '会前遗漏检查', bucket: REVIEW_BUCKET, reviewAction: '会前30分钟按清单检查' }]
  const added = addReviewActionToToday(source, 'review-1', '2026-09-24', 'task-1')
  assert.equal(added.length, 2)
    assert.deepEqual(added[0], { id: 'task-1', title: '会前30分钟按清单检查', completed: false, date: '2026-09-24', sourceReviewId: 'review-1' })
  assert.equal(addReviewActionToToday(added, 'review-1', '2026-09-24', 'task-2'), added)
})

test('turns one review action into one editable habit candidate', () => {
  const source = [{ id: 'review-1', title: '忘记整理笔记', bucket: REVIEW_BUCKET, reviewAction: '每天结束前整理10分钟' }]
  const added = addReviewActionToHabits(source, 'review-1', 'habit-1')
  assert.equal(added.length, 2)
    assert.equal(added[0].bucket, HABIT_BUCKET)
    assert.equal(added[0].habitState, HABIT_STATE_CANDIDATE)
    assert.equal(added[0].habitMinimum, '每天结束前整理10分钟')
  assert.equal(addReviewActionToHabits(added, 'review-1', 'habit-2'), added)
})
