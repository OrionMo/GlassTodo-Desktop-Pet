import assert from 'node:assert/strict'
import test from 'node:test'
import { IDEA_FILTER_ALL, IDEA_TAG_GOAL, IDEA_TAG_INTEREST, findDueTaskReminders, ideaMatchesFilter, markTaskReminderFired, migrateTasks, normalizeReminderTime, reminderOccurrenceKey, setTaskReminder, toggleTaskImportance } from '../src/task-model.js'

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
