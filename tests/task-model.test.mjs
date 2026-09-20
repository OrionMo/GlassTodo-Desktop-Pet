import assert from 'node:assert/strict'
import test from 'node:test'
import { IDEA_FILTER_ALL, IDEA_TAG_GOAL, IDEA_TAG_INTEREST, ideaMatchesFilter, migrateTasks } from '../src/task-model.js'

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
