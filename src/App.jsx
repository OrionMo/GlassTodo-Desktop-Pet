import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, Clock, Flag, ListChecks } from '@phosphor-icons/react'
import { IDEA_BUCKET, IDEA_FILTER_ALL, IDEA_TAG_GOAL, IDEA_TAG_INTEREST, findDueTaskReminders, ideaMatchesFilter, markTaskReminderFired, migrateTasks, reminderOccurrenceKey, setTaskReminder, toggleTaskImportance } from './task-model.js'

const seedTitles = ['整理会议资料', '回复客户邮件', '完成产品方案初稿']
const TASK_REMINDER_CHECK_MS = 15 * 1000

function dateLabel(offsetDays) {
  const now = new Date()
  now.setDate(now.getDate() + offsetDays)
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function loadTasks() {
  try {
    const saved = localStorage.getItem('glass-todo.tasks.v2')
    if (saved) return migrateTasks(JSON.parse(saved))
    const legacy = localStorage.getItem('glass-todo.tasks.v1')
    if (legacy) return migrateTasks(JSON.parse(legacy).map((task) => ({ ...task, date: dateLabel(0) })))
    return seedTitles.map((title, index) => ({ id: `seed-${index + 1}`, title, completed: false, date: dateLabel(0) }))
  } catch {
    return []
  }
}

export function App() {
  const hasDesktopBridge = Boolean(window.desktopAPI)
  const desktopPreview = new URLSearchParams(window.location.search).has('desktopPreview')
  const isDesktop = hasDesktopBridge || desktopPreview
  const [tasks, setTasks] = useState(loadTasks)
  const [draft, setDraft] = useState('')
  const [selectedDay, setSelectedDay] = useState('today')
  const [ideaFilter, setIdeaFilter] = useState(IDEA_FILTER_ALL)
  const [showCompleted, setShowCompleted] = useState(false)
  const [sinkingId, setSinkingId] = useState(null)
  const [panelOpen, setPanelOpen] = useState(!hasDesktopBridge)
  const [panelDirection, setPanelDirection] = useState('left')
  const [reminderState, setReminderState] = useState({ visible: false, reminder: null })
  const [editingReminderId, setEditingReminderId] = useState(null)
  const [reminderDraft, setReminderDraft] = useState('')
  const [highlightedTaskId, setHighlightedTaskId] = useState(null)
  const dragOrigin = useRef(null)
  const suppressClick = useRef(false)
  const highlightTimer = useRef(null)
  const isIdeas = selectedDay === 'ideas'
  const reminderVisible = Boolean(reminderState.visible)
  const selectedDate = selectedDay === 'today' ? dateLabel(0) : selectedDay === 'tomorrow' ? dateLabel(1) : null

  const active = useMemo(() => tasks.filter((task) => {
    if (task.completed) return false
    return isIdeas ? ideaMatchesFilter(task, ideaFilter) : task.bucket !== IDEA_BUCKET && task.bucket !== 'unfinished' && task.date === selectedDate
  }), [tasks, isIdeas, ideaFilter, selectedDate])

  const completed = useMemo(() => tasks.filter((task) => {
    if (!task.completed) return false
    return isIdeas ? ideaMatchesFilter(task, ideaFilter) : task.bucket !== IDEA_BUCKET && task.bucket !== 'unfinished' && task.date === selectedDate
  }), [tasks, isIdeas, ideaFilter, selectedDate])

  useEffect(() => {
    localStorage.setItem('glass-todo.tasks.v2', JSON.stringify(tasks))
    localStorage.setItem('glass-todo.tasks.v2.updatedAt', new Date().toISOString())
  }, [tasks])

  useEffect(() => {
    if (!hasDesktopBridge) return undefined
    const checkDueReminders = () => {
      const dueTasks = findDueTaskReminders(tasks, new Date())
      if (dueTasks.length === 0) return
      setTasks((current) => dueTasks.reduce((next, task) => markTaskReminderFired(next, task.id, reminderOccurrenceKey(task)), current))
      for (const task of dueTasks) {
        window.desktopAPI.showTaskReminder({ taskId: task.id, taskTitle: task.title, time: task.reminderTime })
      }
    }
    checkDueReminders()
    const timer = window.setInterval(checkDueReminders, TASK_REMINDER_CHECK_MS)
    return () => window.clearInterval(timer)
  }, [hasDesktopBridge, tasks])

  useEffect(() => {
    if (!hasDesktopBridge) return undefined
    document.body.classList.add('electron')
    document.documentElement.classList.add('electron-root')
    const unsubscribePanel = window.desktopAPI.onPanelState((state) => {
      setPanelOpen(state.expanded)
      setPanelDirection(state.direction)
    })
    const unsubscribeReminder = window.desktopAPI.onReminderState((state) => {
      setReminderState(state)
      setPanelDirection(state.direction)
    })
    const unsubscribeReminderOpened = window.desktopAPI.onReminderOpened(focusReminderTask)
    const cancelDrag = () => finishDrag(true)
    window.addEventListener('blur', cancelDrag)
    return () => {
      document.body.classList.remove('electron')
      document.documentElement.classList.remove('electron-root')
      window.removeEventListener('blur', cancelDrag)
      unsubscribePanel()
      unsubscribeReminder()
      unsubscribeReminderOpened()
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
    }
  }, [hasDesktopBridge])

  async function togglePanel() {
    if (!hasDesktopBridge) return
    const state = await window.desktopAPI.togglePanel()
    setPanelOpen(state.expanded)
    setPanelDirection(state.direction)
  }

  function startDrag(event) {
    if (!hasDesktopBridge) return
    suppressClick.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    dragOrigin.current = { x: event.screenX, y: event.screenY, moved: false }
    window.desktopAPI.startDrag({ x: event.screenX, y: event.screenY })
  }

  function moveDrag(event) {
    if (!hasDesktopBridge || !dragOrigin.current) return
    if ((event.buttons & 1) !== 1) {
      finishDrag(true)
      return
    }
    if (Math.hypot(event.screenX - dragOrigin.current.x, event.screenY - dragOrigin.current.y) > 4) dragOrigin.current.moved = true
    window.desktopAPI.moveDrag({ x: event.screenX, y: event.screenY, buttons: event.buttons })
  }

  function finishDrag(forceSuppress = false) {
    if (!hasDesktopBridge || !dragOrigin.current) return
    const moved = dragOrigin.current.moved
    dragOrigin.current = null
    window.desktopAPI.endDrag()
    suppressClick.current = forceSuppress || moved
  }

  function handleLauncherClick() {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    togglePanel()
  }

  async function openReminder() {
    focusReminderTask(reminderState.reminder)
    setReminderState((current) => ({ ...current, visible: false }))
    const state = await window.desktopAPI.openReminder()
    setPanelOpen(state.expanded)
    setPanelDirection(state.direction)
  }

  function selectList(day) {
    setSelectedDay(day)
    setShowCompleted(false)
    setEditingReminderId(null)
    setReminderDraft('')
  }

  function focusReminderTask(reminder) {
    setSelectedDay('today')
    setShowCompleted(false)
    setEditingReminderId(null)
    if (reminder?.kind !== 'task' || !reminder.taskId) return
    setHighlightedTaskId(reminder.taskId)
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
    highlightTimer.current = window.setTimeout(() => setHighlightedTaskId(null), 4200)
    window.setTimeout(() => {
      document.querySelector(`[data-task-id="${CSS.escape(reminder.taskId)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 80)
  }

  function addTask(event) {
    event.preventDefault()
    const title = draft.trim()
    if (!title || (!isIdeas && !selectedDate)) return
    const nextTask = isIdeas
      ? { id: crypto.randomUUID(), title, completed: false, bucket: IDEA_BUCKET, ideaTags: [] }
      : { id: crypto.randomUUID(), title, completed: false, date: selectedDate }
    setTasks((current) => [...current, nextTask])
    setDraft('')
  }

  function completeTask(id) {
    if (sinkingId) return
    setSinkingId(id)
    window.setTimeout(() => {
      setTasks((current) => current.map((task) => {
        if (task.id !== id) return task
        const { reminderTime, reminderFiredFor, ...rest } = task
        return { ...rest, completed: true }
      }))
      setSinkingId(null)
    }, 460)
  }

  function restoreTask(id) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, completed: false } : task))
  }

  function moveToIdeas(id) {
    setTasks((current) => current.map((task) => {
      if (task.id !== id) return task
      const { date, important, reminderTime, reminderFiredFor, ...rest } = task
      return { ...rest, bucket: IDEA_BUCKET, ideaTags: [] }
    }))
  }

  function moveIdeaToDate(id, offsetDays) {
    setTasks((current) => current.map((task) => {
      if (task.id !== id) return task
      const { bucket, ideaTags, reminderTime, reminderFiredFor, ...rest } = task
      return { ...rest, date: dateLabel(offsetDays) }
    }))
  }

  function toggleIdeaTag(id, tag) {
    setTasks((current) => current.map((task) => {
      if (task.id !== id) return task
      const tags = Array.isArray(task.ideaTags) ? task.ideaTags : []
      return { ...task, ideaTags: tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag] }
    }))
  }

  function toggleImportant(id) {
    if (selectedDay !== 'today') return
    setTasks((current) => toggleTaskImportance(current, id))
  }

  function updateTaskReminder(id, value) {
    if (selectedDay !== 'today') return
    setTasks((current) => setTaskReminder(current, id, value))
    setEditingReminderId(null)
    setReminderDraft('')
  }

  function toggleReminderEditor(task) {
    if (editingReminderId === task.id) {
      setEditingReminderId(null)
      setReminderDraft('')
      return
    }
    setEditingReminderId(task.id)
    setReminderDraft(task.reminderTime || '')
  }

  const ideaEmptyLabels = {
    [IDEA_FILTER_ALL]: '还没有记录想法',
    [IDEA_TAG_GOAL]: '还没有符合当下目标的想法',
    [IDEA_TAG_INTEREST]: '还没有感兴趣的想法',
  }
  const emptyLabel = isIdeas ? ideaEmptyLabels[ideaFilter] : `${selectedDay === 'today' ? '今天' : '明天'}还没有待办`

  return (
    <main className={isDesktop ? `desktop-shell direction-${panelDirection}` : 'stage'}>
      {isDesktop && (
        <button type="button" className={`pet-launcher ${panelOpen ? 'is-active' : ''} ${reminderVisible ? 'has-reminder' : ''}`} aria-label={panelOpen ? '收起待办' : '展开待办'} title={panelOpen ? '收起待办' : '展开待办'} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => finishDrag(false)} onPointerCancel={() => finishDrag(true)} onLostPointerCapture={() => finishDrag(true)} onClick={reminderVisible ? openReminder : handleLauncherClick}>
          <ListChecks size={32} weight="duotone" />
        </button>
      )}
      {isDesktop && reminderVisible && <button type="button" className="reminder-toast" onClick={openReminder}><span className="reminder-dot" aria-hidden="true" /><span className="reminder-copy"><strong>{reminderState.reminder?.kind === 'task' ? reminderState.reminder.taskTitle : '看看今日待办'}</strong><small>{reminderState.reminder?.kind === 'task' ? `${reminderState.reminder.time} · 点击打开` : '点击立即打开'}</small></span></button>}
      <div className={`panel-wrap ${panelOpen ? 'is-visible' : ''}`}>
        <section className={`todo-window ${isIdeas ? 'is-ideas' : ''}`} aria-label="毛玻璃待办清单">
          {isDesktop && <button type="button" className="window-close-button" aria-label="关闭 GlassTodo" title="关闭 GlassTodo" onClick={() => window.desktopAPI.quit()}>×</button>}
          <header className="todo-header">
            <div className="title-line"><h1>{isIdeas ? '想法' : '待办'}</h1><span className="active-count">{active.length}</span></div>
            <div className="header-meta">
              {isIdeas ? <span className="mode-label">随手记录</span> : <time dateTime={selectedDate}>{selectedDate}</time>}
              <span className="version-label">v7.4 · Reminder</span>
            </div>
          </header>

          <nav className="day-switcher" aria-label="待办列表">
            <button type="button" className={selectedDay === 'today' ? 'is-selected' : ''} aria-pressed={selectedDay === 'today'} onClick={() => selectList('today')}>今天</button>
            <button type="button" className={selectedDay === 'tomorrow' ? 'is-selected' : ''} aria-pressed={selectedDay === 'tomorrow'} onClick={() => selectList('tomorrow')}>明天</button>
            <button type="button" className={isIdeas ? 'is-selected' : ''} aria-pressed={isIdeas} onClick={() => selectList('ideas')}>想法</button>
          </nav>

          {isIdeas && (
            <nav className="idea-filter" aria-label="想法分类">
              <button type="button" className={ideaFilter === IDEA_FILTER_ALL ? 'is-selected' : ''} aria-pressed={ideaFilter === IDEA_FILTER_ALL} onClick={() => setIdeaFilter(IDEA_FILTER_ALL)}>全部</button>
              <button type="button" className={ideaFilter === IDEA_TAG_GOAL ? 'is-selected' : ''} aria-pressed={ideaFilter === IDEA_TAG_GOAL} onClick={() => setIdeaFilter(IDEA_TAG_GOAL)}>符合当下目标</button>
              <button type="button" className={ideaFilter === IDEA_TAG_INTEREST ? 'is-selected' : ''} aria-pressed={ideaFilter === IDEA_TAG_INTEREST} onClick={() => setIdeaFilter(IDEA_TAG_INTEREST)}>感兴趣</button>
            </nav>
          )}

          <form className="quick-add" onSubmit={addTask}>
            <input aria-label={isIdeas ? '输入新的想法' : `输入${selectedDay === 'today' ? '今天' : '明天'}的新任务`} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={isIdeas ? '记下突然想到的事，回车添加' : `输入${selectedDay === 'today' ? '今天' : '明天'}的任务，回车添加`} autoFocus={!isDesktop} />
          </form>

          <div className="task-list" aria-live="polite">
            {active.length === 0 && <p className="empty">{emptyLabel}</p>}
            {active.map((task) => (
              <div className={`task-row ${selectedDay === 'today' && task.important ? 'is-important' : ''} ${highlightedTaskId === task.id ? 'is-reminder-highlighted' : ''} ${sinkingId === task.id ? 'is-sinking' : ''}`} data-task-id={task.id} key={task.id}>
                <button className="check-button" type="button" aria-label={`完成任务：${task.title}`} onClick={() => completeTask(task.id)} />
                <span className="task-copy">
                  <span className="task-title">{task.title}</span>
                  {selectedDay === 'today' && task.reminderTime && <span className="task-reminder-label"><Clock size={13} weight="fill" />今天 {task.reminderTime}</span>}
                  {selectedDay === 'today' && editingReminderId === task.id && (
                    <span className="task-reminder-editor">
                      <input type="time" aria-label={`设置提醒时间：${task.title}`} value={reminderDraft} onInput={(event) => setReminderDraft(event.currentTarget.value)} autoFocus />
                      <button className="save-button" type="button" disabled={!reminderDraft} aria-label={`保存提醒：${task.title}`} onClick={() => updateTaskReminder(task.id, reminderDraft)}>保存</button>
                      {task.reminderTime && <button type="button" onClick={() => updateTaskReminder(task.id, '')}>清除</button>}
                    </span>
                  )}
                  {isIdeas && (
                    <span className="idea-tags" aria-label="想法标签">
                      <button type="button" className={task.ideaTags?.includes(IDEA_TAG_GOAL) ? 'is-selected' : ''} aria-pressed={task.ideaTags?.includes(IDEA_TAG_GOAL) || false} onClick={() => toggleIdeaTag(task.id, IDEA_TAG_GOAL)}>目标</button>
                      <button type="button" className={task.ideaTags?.includes(IDEA_TAG_INTEREST) ? 'is-selected' : ''} aria-pressed={task.ideaTags?.includes(IDEA_TAG_INTEREST) || false} onClick={() => toggleIdeaTag(task.id, IDEA_TAG_INTEREST)}>感兴趣</button>
                    </span>
                  )}
                </span>
                {isIdeas ? (
                  <span className="idea-schedule-actions">
                    <button type="button" onClick={() => moveIdeaToDate(task.id, 0)} title="加入今天">今天</button>
                    <button type="button" onClick={() => moveIdeaToDate(task.id, 1)} title="加入明天">明天</button>
                  </span>
                ) : (
                  <span className="task-row-actions">
                    {selectedDay === 'today' && (
                      <>
                        <button className={`reminder-button ${task.reminderTime ? 'is-active' : ''}`} type="button" aria-label={task.reminderTime ? `修改提醒时间：${task.title}，当前${task.reminderTime}` : `设置提醒时间：${task.title}`} aria-expanded={editingReminderId === task.id} title={task.reminderTime ? `提醒时间 ${task.reminderTime}` : '设置提醒时间'} onClick={() => toggleReminderEditor(task)}>
                          <Clock size={17} weight={task.reminderTime ? 'fill' : 'regular'} />
                        </button>
                        <button className={`important-button ${task.important ? 'is-active' : ''}`} type="button" aria-label={task.important ? `取消重要标记：${task.title}` : `标记为重要：${task.title}`} aria-pressed={Boolean(task.important)} title={task.important ? '取消重要标记' : '标记为重要'} onClick={() => toggleImportant(task.id)}>
                          <Flag size={17} weight={task.important ? 'fill' : 'regular'} />
                        </button>
                      </>
                    )}
                    <button className="move-task-button" type="button" onClick={() => moveToIdeas(task.id)}>转为想法</button>
                  </span>
                )}
              </div>
            ))}
          </div>

          <section className={`completed-shelf ${showCompleted ? 'is-open' : ''}`}>
            <button type="button" className="completed-toggle" aria-expanded={showCompleted} onClick={() => setShowCompleted((open) => !open)}>
              <span className="disclosure" aria-hidden="true"><CaretDown size={16} weight="bold" /></span><span>已完成</span><span className="completed-count">{completed.length}</span>
            </button>
            {showCompleted && <div className="completed-list">{completed.length === 0 ? <p className="completed-empty">还没有已完成任务</p> : completed.map((task) => (
              <button type="button" className={`completed-row ${selectedDay === 'today' && task.important ? 'is-important' : ''}`} key={task.id} onClick={() => restoreTask(task.id)} title="点击恢复任务"><span className="done-mark" aria-hidden="true">✓</span><s>{task.title}</s>{selectedDay === 'today' && task.important && <Flag className="completed-important-mark" size={15} weight="fill" aria-label="重要事项" />}</button>
            ))}</div>}
          </section>
        </section>
      </div>
    </main>
  )
}
