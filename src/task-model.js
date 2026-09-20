export const IDEA_BUCKET = 'idea'
export const IDEA_FILTER_ALL = 'all'
export const IDEA_TAG_GOAL = 'goal'
export const IDEA_TAG_INTEREST = 'interest'

const validIdeaTags = new Set([IDEA_TAG_GOAL, IDEA_TAG_INTEREST])

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
