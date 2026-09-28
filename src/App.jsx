import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowClockwise, ArrowRight, CalendarBlank, CaretDown, CheckCircle, Cloud, CloudCheck, CloudSlash, Clock, Coffee, Flag, ListChecks, PencilSimple, Play, SignOut, Target, Trash, WarningCircle } from '@phosphor-icons/react'
import { DEADLINE_BUCKET, HABIT_BUCKET, HABIT_STATE_ACTIVE, HABIT_STATE_CANDIDATE, HABIT_STATE_FINISHED, IDEA_BUCKET, IDEA_FILTER_ALL, IDEA_TAG_GOAL, IDEA_TAG_INTEREST, REVIEW_BUCKET, REVIEW_CATEGORY_ATTENTION, REVIEW_CATEGORY_COMMUNICATION, REVIEW_CATEGORY_INFORMATION, REVIEW_CATEGORY_OTHER, REVIEW_CATEGORY_PREPARATION, REVIEW_CATEGORY_PROCESS, REVIEW_CATEGORY_TIME, REVIEW_FILTER_ALL, REVIEW_STATUS_IMPROVED, REVIEW_STATUS_PENDING, REVIEW_STATUS_VERIFY, addReviewActionToHabits, addReviewActionToToday, compareDeadlineTasks, deadlineStatus, findDueTaskReminders, finishHabitCycle, habitProgress, ideaMatchesFilter, incrementReviewOccurrence, markTaskReminderFired, migrateTasks, moveDeadlineToToday, moveHabitToToday, normalizeDeadlineDate, normalizeHabitDuration, normalizeHabitWeeklyTarget, normalizeReminderTime, normalizeReviewCategory, normalizeReviewStatus, recordHabitCheckIn, recordHabitRest, reminderOccurrenceKey, reviewMatchesFilter, setTaskReminder, startHabitCycle, toggleTaskImportance } from './task-model.js'
import { useCloudSync } from './use-cloud-sync.js'

const seedTitles = ['整理会议资料', '回复客户邮件', '完成产品方案初稿']
const TASK_REMINDER_CHECK_MS = 15 * 1000
const REVIEW_CATEGORIES = [
  [REVIEW_CATEGORY_PREPARATION, '准备不足'],
  [REVIEW_CATEGORY_TIME, '时间安排'],
  [REVIEW_CATEGORY_ATTENTION, '注意力问题'],
  [REVIEW_CATEGORY_COMMUNICATION, '沟通偏差'],
  [REVIEW_CATEGORY_INFORMATION, '信息不足'],
  [REVIEW_CATEGORY_PROCESS, '流程缺失'],
  [REVIEW_CATEGORY_OTHER, '其他'],
]
const REVIEW_STATUSES = [
  [REVIEW_STATUS_PENDING, '待复盘'],
  [REVIEW_STATUS_VERIFY, '待验证'],
  [REVIEW_STATUS_IMPROVED, '已改善'],
]
const reviewCategoryLabel = (value) => REVIEW_CATEGORIES.find(([key]) => key === normalizeReviewCategory(value))?.[1] || '其他'
const reviewStatusLabel = (value) => REVIEW_STATUSES.find(([key]) => key === normalizeReviewStatus(value))?.[1] || '待复盘'

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
  const [deadlineDate, setDeadlineDate] = useState(() => dateLabel(1))
  const [deadlineTime, setDeadlineTime] = useState('')
  const [habitName, setHabitName] = useState('')
  const [habitMinimum, setHabitMinimum] = useState('')
  const [habitDuration, setHabitDuration] = useState('45')
  const [habitWeeklyTarget, setHabitWeeklyTarget] = useState('4')
  const [editingHabitId, setEditingHabitId] = useState(null)
  const [reviewDraft, setReviewDraft] = useState('')
  const [reviewFilter, setReviewFilter] = useState(REVIEW_FILTER_ALL)
  const [editingReviewId, setEditingReviewId] = useState(null)
  const [reviewEditor, setReviewEditor] = useState({ title: '', scene: '', category: REVIEW_CATEGORY_OTHER, cause: '', action: '', status: REVIEW_STATUS_PENDING })
  const [confirmAction, setConfirmAction] = useState(null)
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
  const [syncPanelOpen, setSyncPanelOpen] = useState(false)
  const [authMode, setAuthMode] = useState('signin')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const cloud = useCloudSync(tasks, setTasks)
  const dragOrigin = useRef(null)
  const suppressClick = useRef(false)
  const highlightTimer = useRef(null)
  const isIdeas = selectedDay === 'ideas'
  const isDeadlines = selectedDay === 'deadlines'
  const isHabits = selectedDay === 'habits'
  const isReviews = selectedDay === 'reviews'
  const reminderVisible = Boolean(reminderState.visible)
  const selectedDate = selectedDay === 'today' ? dateLabel(0) : selectedDay === 'tomorrow' ? dateLabel(1) : null
  const habitTasks = useMemo(() => tasks.filter((task) => task?.bucket === HABIT_BUCKET), [tasks])
  const activeHabit = useMemo(() => habitTasks.find((task) => task.habitState === HABIT_STATE_ACTIVE) || null, [habitTasks])
  const candidateHabits = useMemo(() => habitTasks.filter((task) => task.habitState !== HABIT_STATE_ACTIVE && task.habitState !== HABIT_STATE_FINISHED), [habitTasks])
  const finishedHabits = useMemo(() => habitTasks.filter((task) => task.habitState === HABIT_STATE_FINISHED), [habitTasks])
  const activeHabitProgress = activeHabit ? habitProgress(activeHabit, dateLabel(0)) : null
  const reviewItems = useMemo(() => tasks.filter((task) => reviewMatchesFilter(task, reviewFilter)).sort((left, right) => (right.reviewLastOccurredAt || right.reviewDate || '').localeCompare(left.reviewLastOccurredAt || left.reviewDate || '')), [tasks, reviewFilter])
  const reviewCount = useMemo(() => tasks.filter((task) => task?.bucket === REVIEW_BUCKET).length, [tasks])

  const active = useMemo(() => tasks.filter((task) => {
    if (task.completed) return false
    if (isHabits || isReviews) return false
    if (isIdeas) return ideaMatchesFilter(task, ideaFilter)
    if (isDeadlines) return task.bucket === DEADLINE_BUCKET
    return task.bucket !== IDEA_BUCKET && task.bucket !== 'unfinished' && task.date === selectedDate
  }).sort(isDeadlines ? compareDeadlineTasks : () => 0), [tasks, isIdeas, isDeadlines, isHabits, isReviews, ideaFilter, selectedDate])

  const completed = useMemo(() => tasks.filter((task) => {
    if (!task.completed) return false
    if (isHabits || isReviews) return false
    if (isIdeas) return ideaMatchesFilter(task, ideaFilter)
    if (isDeadlines) return task.bucket === DEADLINE_BUCKET
    return task.bucket !== IDEA_BUCKET && task.bucket !== 'unfinished' && task.date === selectedDate
  }).sort(isDeadlines ? compareDeadlineTasks : () => 0), [tasks, isIdeas, isDeadlines, isHabits, isReviews, ideaFilter, selectedDate])

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
    setEditingHabitId(null)
    setEditingReviewId(null)
    setConfirmAction(null)
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
    const normalizedDeadlineDate = normalizeDeadlineDate(deadlineDate)
    if (!title || (isDeadlines && !normalizedDeadlineDate) || (!isIdeas && !isDeadlines && !selectedDate)) return
    const normalizedDeadlineTime = normalizeReminderTime(deadlineTime)
    const nextTask = isIdeas
      ? { id: crypto.randomUUID(), title, completed: false, bucket: IDEA_BUCKET, ideaTags: [] }
      : isDeadlines
        ? { id: crypto.randomUUID(), title, completed: false, bucket: DEADLINE_BUCKET, deadlineDate: normalizedDeadlineDate, ...(normalizedDeadlineTime ? { deadlineTime: normalizedDeadlineTime } : {}) }
        : { id: crypto.randomUUID(), title, completed: false, date: selectedDate }
    setTasks((current) => [nextTask, ...current])
    setDraft('')
    if (isDeadlines) setDeadlineTime('')
  }

  function resetHabitForm() {
    setHabitName('')
    setHabitMinimum('')
    setHabitDuration('45')
    setHabitWeeklyTarget('4')
    setEditingHabitId(null)
  }

  function saveHabit(event) {
    event.preventDefault()
    const title = habitName.trim()
    const minimum = habitMinimum.trim()
    if (!title || !minimum) return
    const settings = {
      title,
      habitMinimum: minimum,
      habitDurationDays: normalizeHabitDuration(habitDuration),
      habitWeeklyTarget: normalizeHabitWeeklyTarget(habitWeeklyTarget),
    }
    setTasks((current) => editingHabitId
      ? current.map((task) => task.id === editingHabitId && task.bucket === HABIT_BUCKET ? { ...task, ...settings } : task)
      : [{ id: crypto.randomUUID(), completed: false, bucket: HABIT_BUCKET, habitState: HABIT_STATE_CANDIDATE, habitCheckIns: [], habitRestDays: [], ...settings }, ...current])
    resetHabitForm()
  }

  function editHabit(task) {
    setConfirmAction(null)
    setHabitName(task.title)
    setHabitMinimum(task.habitMinimum || '')
    setHabitDuration(String(normalizeHabitDuration(task.habitDurationDays)))
    setHabitWeeklyTarget(String(normalizeHabitWeeklyTarget(task.habitWeeklyTarget)))
    setEditingHabitId(task.id)
  }

  function deleteHabit(id) {
    const habit = tasks.find((task) => task.id === id && task.bucket === HABIT_BUCKET)
    if (!habit) return
    setTasks((current) => current.filter((task) => task.id !== id))
    if (editingHabitId === id) resetHabitForm()
    setConfirmAction(null)
  }

  function beginHabit(id) {
    setTasks((current) => startHabitCycle(current, id, dateLabel(0)))
  }

  function checkInHabit(id) {
    setTasks((current) => recordHabitCheckIn(current, id, dateLabel(0)))
  }

  function restHabit(id) {
    setTasks((current) => recordHabitRest(current, id, dateLabel(0)))
  }

  function addHabitToToday(id) {
    setTasks((current) => moveHabitToToday(current, id, dateLabel(0)))
  }

  function endHabit(id) {
    setTasks((current) => finishHabitCycle(current, id, dateLabel(0)))
    setConfirmAction(null)
  }

  function repeatHabit(task) {
    if (activeHabit) return
    const nextHabit = {
      ...task,
      id: crypto.randomUUID(),
      completed: false,
      habitState: HABIT_STATE_ACTIVE,
      habitStartedAt: dateLabel(0),
      habitCheckIns: [],
      habitRestDays: [],
    }
    delete nextHabit.habitEndedAt
    delete nextHabit.date
    setTasks((current) => [nextHabit, ...current])
  }

  function addReview(event) {
    event.preventDefault()
    const title = reviewDraft.trim()
    if (!title) return
    setTasks((current) => [{
      id: crypto.randomUUID(),
      title,
      completed: false,
      bucket: REVIEW_BUCKET,
      reviewDate: dateLabel(0),
      reviewLastOccurredAt: dateLabel(0),
      reviewOccurrenceCount: 1,
      reviewStatus: REVIEW_STATUS_PENDING,
      reviewCategory: REVIEW_CATEGORY_OTHER,
    }, ...current])
    setReviewDraft('')
  }

  function editReview(task) {
    setConfirmAction(null)
    setEditingReviewId(task.id)
    setReviewEditor({
      title: task.title || '',
      scene: task.reviewScene || '',
      category: normalizeReviewCategory(task.reviewCategory),
      cause: task.reviewCause || '',
      action: task.reviewAction || '',
      status: normalizeReviewStatus(task.reviewStatus),
    })
  }

  function cancelReviewEdit() {
    setConfirmAction(null)
    setEditingReviewId(null)
    setReviewEditor({ title: '', scene: '', category: REVIEW_CATEGORY_OTHER, cause: '', action: '', status: REVIEW_STATUS_PENDING })
  }

  function saveReview(event) {
    event.preventDefault()
    const title = reviewEditor.title.trim()
    const action = reviewEditor.action.trim()
    if (!title || (reviewEditor.status !== REVIEW_STATUS_PENDING && !action)) return
    setTasks((current) => current.map((task) => task.id === editingReviewId && task.bucket === REVIEW_BUCKET ? {
      ...task,
      title,
      reviewScene: reviewEditor.scene.trim(),
      reviewCategory: normalizeReviewCategory(reviewEditor.category),
      reviewCause: reviewEditor.cause.trim(),
      reviewAction: action,
      reviewStatus: normalizeReviewStatus(reviewEditor.status),
    } : task))
    cancelReviewEdit()
  }

  function deleteReview(id) {
    const review = tasks.find((task) => task.id === id && task.bucket === REVIEW_BUCKET)
    if (!review) return
    setTasks((current) => current.filter((task) => task.id !== id))
    if (editingReviewId === id) cancelReviewEdit()
    setConfirmAction(null)
  }

  function repeatReview(id) {
    setTasks((current) => incrementReviewOccurrence(current, id, dateLabel(0)))
  }

  function reviewActionToToday(id) {
    setTasks((current) => addReviewActionToToday(current, id, dateLabel(0), crypto.randomUUID()))
  }

  function reviewActionToHabit(id) {
    setTasks((current) => addReviewActionToHabits(current, id, crypto.randomUUID()))
  }

  function completeTask(id) {
    if (sinkingId) return
    setSinkingId(id)
    window.setTimeout(() => {
      setTasks((current) => current.map((task) => {
        if (task.id === id && task.bucket === HABIT_BUCKET) return recordHabitCheckIn(current, id, dateLabel(0)).find((item) => item.id === id)
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
      if (task.bucket === HABIT_BUCKET) return task
      const { date, important, reminderTime, reminderFiredFor, deadlineDate: _deadlineDate, deadlineTime: _deadlineTime, ...rest } = task
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

  function addDeadlineToToday(id) {
    setTasks((current) => moveDeadlineToToday(current, id, dateLabel(0)))
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

  async function submitAuth(event) {
    event.preventDefault()
    const email = authEmail.trim()
    if (!email || authPassword.length < 6) return
    const result = authMode === 'signup'
      ? await cloud.signUp(email, authPassword)
      : await cloud.signIn(email, authPassword)
    if (!result?.error) setAuthPassword('')
  }

  function cloudIcon() {
    if (!cloud.configured || cloud.status === 'offline' || cloud.status === 'error') return <CloudSlash size={14} />
    if (cloud.session && cloud.status === 'synced') return <CloudCheck size={14} weight="fill" />
    return <Cloud size={14} />
  }

  const ideaEmptyLabels = {
    [IDEA_FILTER_ALL]: '还没有记录想法',
    [IDEA_TAG_GOAL]: '还没有符合当下目标的想法',
    [IDEA_TAG_INTEREST]: '还没有感兴趣的想法',
  }
  const emptyLabel = isIdeas ? ideaEmptyLabels[ideaFilter] : isDeadlines ? '还没有记录 DDL' : `${selectedDay === 'today' ? '今天' : '明天'}还没有待办`
  const today = dateLabel(0)
  const activeHabitDoneToday = activeHabit?.habitCheckIns?.includes(today) || false
  const activeHabitRestedToday = activeHabit?.habitRestDays?.includes(today) || false

  return (
    <main className={isDesktop ? `desktop-shell direction-${panelDirection}` : 'stage'}>
      {isDesktop && (
        <button type="button" className={`pet-launcher ${panelOpen ? 'is-active' : ''} ${reminderVisible ? 'has-reminder' : ''}`} aria-label={panelOpen ? '收起待办' : '展开待办'} title={panelOpen ? '收起待办' : '展开待办'} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => finishDrag(false)} onPointerCancel={() => finishDrag(true)} onLostPointerCapture={() => finishDrag(true)} onClick={reminderVisible ? openReminder : handleLauncherClick}>
          <ListChecks size={32} weight="duotone" />
        </button>
      )}
      {isDesktop && reminderVisible && <button type="button" className="reminder-toast" onClick={openReminder}><span className="reminder-dot" aria-hidden="true" /><span className="reminder-copy"><strong>{reminderState.reminder?.kind === 'task' ? reminderState.reminder.taskTitle : '看看今日待办'}</strong><small>{reminderState.reminder?.kind === 'task' ? `${reminderState.reminder.time} · 点击打开` : '点击立即打开'}</small></span></button>}
      <div className={`panel-wrap ${panelOpen ? 'is-visible' : ''}`}>
        <section className={`todo-window ${isIdeas ? 'is-ideas' : ''} ${isDeadlines ? 'is-deadlines' : ''} ${isHabits ? 'is-habits' : ''} ${isReviews ? 'is-reviews' : ''}`} aria-label="毛玻璃待办清单">
          {isDesktop && <button type="button" className="window-close-button" aria-label="关闭 GlassTodo" title="关闭 GlassTodo" onClick={() => window.desktopAPI.quit()}>×</button>}
          <header className="todo-header">
            <div className="title-line"><h1>{isIdeas ? '想法' : isDeadlines ? 'DDL' : isHabits ? '习惯' : isReviews ? '复盘' : '待办'}</h1><span className="active-count">{isHabits ? (activeHabit ? 1 : 0) : isReviews ? reviewCount : active.length}</span></div>
            <div className="header-meta">
              {isIdeas ? <span className="mode-label">随手记录</span> : isDeadlines ? <span className="mode-label">按截止日期排序</span> : isHabits ? <span className="mode-label">一次专注一个</span> : isReviews ? <span className="mode-label">问题变成行动</span> : <time dateTime={selectedDate}>{selectedDate}</time>}
              <span className="version-label">v7.8.0 · Sync</span>
              <button type="button" className={`cloud-status-button is-${cloud.status}`} aria-expanded={syncPanelOpen} onClick={() => setSyncPanelOpen((value) => !value)}>{cloudIcon()}<span>{cloud.session ? '已连接' : '云同步'}</span></button>
            </div>
          </header>

          {syncPanelOpen && (
            <section className="cloud-panel" aria-label="云同步设置">
              <div className="cloud-panel-heading">
                <span className={`cloud-mark is-${cloud.status}`}>{cloudIcon()}</span>
                <span><strong>{cloud.session ? '同账号自动同步' : '连接云同步'}</strong><small>{cloud.message}</small></span>
              </div>
              {!cloud.configured ? (
                <p className="cloud-config-hint">当前安装包还没有连接云端项目。配置后，本机数据会先备份，再与云端逐条合并。</p>
              ) : cloud.session ? (
                <div className="cloud-account-row">
                  <span><small>当前账号</small><strong>{cloud.session.user.email}</strong></span>
                  <button type="button" disabled={cloud.status === 'syncing'} onClick={() => cloud.syncNow()}><ArrowClockwise size={14} />立即同步</button>
                  <button type="button" className="cloud-signout" aria-label="退出云同步账号" title="退出账号" onClick={cloud.signOut}><SignOut size={14} /></button>
                </div>
              ) : (
                <form className="cloud-auth-form" onSubmit={submitAuth}>
                  <input type="email" autoComplete="email" aria-label="邮箱" placeholder="邮箱" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} />
                  <input type="password" minLength="6" autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} aria-label="密码" placeholder="密码（至少 6 位）" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />
                  <button type="submit" disabled={!authEmail.trim() || authPassword.length < 6 || cloud.status === 'syncing'}>{authMode === 'signup' ? '创建账号' : '登录'}</button>
                  <button type="button" className="cloud-mode-switch" onClick={() => setAuthMode((mode) => mode === 'signup' ? 'signin' : 'signup')}>{authMode === 'signup' ? '已有账号，去登录' : '第一次使用，创建账号'}</button>
                </form>
              )}
            </section>
          )}

          <nav className="day-switcher" aria-label="待办列表">
            <button type="button" className={selectedDay === 'today' ? 'is-selected' : ''} aria-pressed={selectedDay === 'today'} onClick={() => selectList('today')}>今天</button>
            <button type="button" className={selectedDay === 'tomorrow' ? 'is-selected' : ''} aria-pressed={selectedDay === 'tomorrow'} onClick={() => selectList('tomorrow')}>明天</button>
            <button type="button" className={isIdeas ? 'is-selected' : ''} aria-pressed={isIdeas} onClick={() => selectList('ideas')}>想法</button>
            <button type="button" className={isDeadlines ? 'is-selected' : ''} aria-pressed={isDeadlines} onClick={() => selectList('deadlines')}>DDL</button>
            <button type="button" className={isHabits ? 'is-selected' : ''} aria-pressed={isHabits} onClick={() => selectList('habits')}>习惯</button>
            <button type="button" className={isReviews ? 'is-selected' : ''} aria-pressed={isReviews} onClick={() => selectList('reviews')}>复盘</button>
          </nav>

          {isIdeas && (
            <nav className="idea-filter" aria-label="想法分类">
              <button type="button" className={ideaFilter === IDEA_FILTER_ALL ? 'is-selected' : ''} aria-pressed={ideaFilter === IDEA_FILTER_ALL} onClick={() => setIdeaFilter(IDEA_FILTER_ALL)}>全部</button>
              <button type="button" className={ideaFilter === IDEA_TAG_GOAL ? 'is-selected' : ''} aria-pressed={ideaFilter === IDEA_TAG_GOAL} onClick={() => setIdeaFilter(IDEA_TAG_GOAL)}>符合当下目标</button>
              <button type="button" className={ideaFilter === IDEA_TAG_INTEREST ? 'is-selected' : ''} aria-pressed={ideaFilter === IDEA_TAG_INTEREST} onClick={() => setIdeaFilter(IDEA_TAG_INTEREST)}>感兴趣</button>
            </nav>
          )}

          {isHabits && (
            <div className="habit-dashboard">
              {activeHabit ? (
                <section className="habit-focus-card" aria-label={`当前专注习惯：${activeHabit.title}`}>
                  <div className="habit-focus-top">
                    <span className="habit-focus-icon"><Target size={22} weight="duotone" /></span>
                    <span className="habit-focus-copy"><small>当前专注</small><strong>{activeHabit.title}</strong><span>{activeHabit.habitMinimum}</span></span>
                    <button className="habit-icon-button" type="button" aria-label={`编辑习惯：${activeHabit.title}`} title="编辑" onClick={() => editHabit(activeHabit)}><PencilSimple size={16} /></button>
                  </div>
                  <div className="habit-cycle-row"><span>第 {activeHabitProgress.cycleDay} / {activeHabitProgress.durationDays} 天</span><span>至 {activeHabitProgress.endDate}</span></div>
                  <div className="habit-progress-track" aria-label={`周期进度 ${activeHabitProgress.progressPercent}%`}><span style={{ width: `${activeHabitProgress.progressPercent}%` }} /></div>
                  <div className="habit-week-card">
                    <span><small>本周节奏</small><strong>{activeHabitProgress.weeklyCount} / {activeHabitProgress.weeklyTarget} 次</strong></span>
                    <span className="habit-week-steps" aria-hidden="true">{Array.from({ length: activeHabitProgress.weeklyTarget }, (_, index) => <i className={index < activeHabitProgress.weeklyCount ? 'is-filled' : ''} key={index} />)}</span>
                    <small>累计 {activeHabitProgress.totalCount} 次</small>
                  </div>
                  <div className="habit-primary-actions">
                    <button className="habit-checkin-button" type="button" disabled={activeHabitDoneToday} onClick={() => checkInHabit(activeHabit.id)}><CheckCircle size={18} weight={activeHabitDoneToday ? 'fill' : 'bold'} />{activeHabitDoneToday ? '今天已完成' : '完成一次'}</button>
                    <button type="button" disabled={activeHabit.date === today || activeHabitDoneToday} onClick={() => addHabitToToday(activeHabit.id)}>{activeHabit.date === today ? '已在今天' : '加入今天'}</button>
                    <button type="button" className={activeHabitRestedToday ? 'is-rested' : ''} disabled={activeHabitDoneToday || activeHabitRestedToday} onClick={() => restHabit(activeHabit.id)}><Coffee size={16} />{activeHabitRestedToday ? '今天休息' : '今日休息'}</button>
                  </div>
                  {confirmAction?.type === 'end-habit' && confirmAction.id === activeHabit.id ? <div className="inline-confirm habit-end-confirm"><span>确定结束当前周期？记录会保留。</span><button type="button" onClick={() => setConfirmAction(null)}>取消</button><button className="is-danger" type="button" onClick={() => endHabit(activeHabit.id)}>结束</button></div> : <button className="habit-end-button" type="button" onClick={() => setConfirmAction({ type: 'end-habit', id: activeHabit.id })}>结束本周期</button>}
                </section>
              ) : (
                <section className="habit-empty-focus"><Target size={25} weight="duotone" /><span><strong>还没有正在培养的习惯</strong><small>从候选习惯中选择一个，开始阶段性专注。</small></span></section>
              )}

              <form className="habit-form" onSubmit={saveHabit}>
                <div className="habit-form-heading"><strong>{editingHabitId ? '编辑习惯' : '添加候选习惯'}</strong>{editingHabitId && <button type="button" onClick={resetHabitForm}>取消</button>}</div>
                <input aria-label="习惯名称" value={habitName} onChange={(event) => setHabitName(event.target.value)} placeholder="例如：阅读" />
                <input aria-label="习惯最低完成标准" value={habitMinimum} onChange={(event) => setHabitMinimum(event.target.value)} placeholder="最低标准，例如阅读 20 分钟" />
                <div className="habit-form-options">
                  <label><span>培养周期</span><select aria-label="选择习惯培养周期" value={habitDuration} onChange={(event) => setHabitDuration(event.target.value)}><option value="30">30 天</option><option value="45">45 天</option><option value="60">60 天</option></select></label>
                  <label><span>每周目标</span><select aria-label="选择每周目标次数" value={habitWeeklyTarget} onChange={(event) => setHabitWeeklyTarget(event.target.value)}>{Array.from({ length: 7 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1} 次</option>)}</select></label>
                  <button type="submit" disabled={!habitName.trim() || !habitMinimum.trim()}>{editingHabitId ? '保存' : '添加'}</button>
                </div>
              </form>

              <section className="habit-pool">
                <div className="habit-section-title"><strong>候选习惯</strong><span>{candidateHabits.length}</span></div>
                {candidateHabits.length === 0 ? <p className="habit-list-empty">先记下一个想培养的习惯</p> : candidateHabits.map((habit) => (
                  <div className="habit-pool-row" key={habit.id}>
                    <span><strong>{habit.title}</strong><small>{habit.habitDurationDays} 天 · 每周 {habit.habitWeeklyTarget} 次 · {habit.habitMinimum}</small></span>
                    {confirmAction?.type === 'delete-habit' && confirmAction.id === habit.id ? <span className="inline-confirm is-compact"><span>确定删除？</span><button type="button" onClick={() => setConfirmAction(null)}>取消</button><button className="is-danger" type="button" onClick={() => deleteHabit(habit.id)}>删除</button></span> : <span className="habit-pool-actions">
                      <button className="habit-start-button" type="button" disabled={Boolean(activeHabit)} title={activeHabit ? '请先结束当前周期' : '开始培养'} onClick={() => beginHabit(habit.id)}><Play size={14} weight="fill" />开始</button>
                      <button className="habit-icon-button" type="button" aria-label={`编辑习惯：${habit.title}`} onClick={() => editHabit(habit)}><PencilSimple size={15} /></button>
                      <button className="habit-icon-button is-danger" type="button" aria-label={`删除习惯：${habit.title}`} onClick={() => setConfirmAction({ type: 'delete-habit', id: habit.id })}><Trash size={15} /></button>
                    </span>}
                  </div>
                ))}
              </section>

              {finishedHabits.length > 0 && <section className="habit-finished">
                <div className="habit-section-title"><strong>已结束</strong><span>{finishedHabits.length}</span></div>
                {finishedHabits.map((habit) => <div className="habit-finished-row" key={habit.id}><span><strong>{habit.title}</strong><small>累计 {habit.habitCheckIns?.length || 0} 次 · {habit.habitEndedAt}</small></span><button type="button" disabled={Boolean(activeHabit)} onClick={() => repeatHabit(habit)}>再来一轮</button></div>)}
              </section>}
            </div>
          )}

          {isReviews && (
            <div className="review-dashboard">
              <form className="review-quick-add" onSubmit={addReview}>
                <WarningCircle size={19} weight="duotone" aria-hidden="true" />
                <input aria-label="快速记录问题" value={reviewDraft} onChange={(event) => setReviewDraft(event.target.value)} placeholder="今天遇到了什么问题？" />
                <button type="submit" disabled={!reviewDraft.trim()}>记录</button>
              </form>

              <nav className="review-filter" aria-label="复盘状态筛选">
                <button type="button" className={reviewFilter === REVIEW_FILTER_ALL ? 'is-selected' : ''} onClick={() => setReviewFilter(REVIEW_FILTER_ALL)}>全部</button>
                {REVIEW_STATUSES.map(([value, label]) => <button type="button" className={reviewFilter === value ? 'is-selected' : ''} key={value} onClick={() => setReviewFilter(value)}>{label}</button>)}
              </nav>

              <div className="review-list" aria-live="polite">
                {reviewItems.length === 0 && <p className="review-empty">这个分类里还没有复盘记录</p>}
                {reviewItems.map((review) => {
                  const linkedToday = tasks.some((task) => task.sourceReviewId === review.id && task.date === today && !task.completed)
                  const linkedHabit = tasks.some((task) => task.sourceReviewId === review.id && task.bucket === HABIT_BUCKET)
                  const isEditing = editingReviewId === review.id
                  return <article className={`review-card is-${normalizeReviewStatus(review.reviewStatus)}`} key={review.id}>
                    <div className="review-card-header">
                      <span className="review-card-icon"><WarningCircle size={18} weight="duotone" /></span>
                      <span className="review-card-title"><strong>{review.title}</strong><small>{reviewCategoryLabel(review.reviewCategory)} · {review.reviewLastOccurredAt || review.reviewDate}</small></span>
                      <span className={`review-status is-${normalizeReviewStatus(review.reviewStatus)}`}>{reviewStatusLabel(review.reviewStatus)}</span>
                    </div>
                    <div className="review-meta-row"><span>发生 {Math.max(1, Number(review.reviewOccurrenceCount) || 1)} 次</span>{review.reviewScene && <span>{review.reviewScene}</span>}</div>

                    {isEditing ? (
                      <form className="review-editor" onSubmit={saveReview}>
                        <input aria-label="编辑问题标题" value={reviewEditor.title} onChange={(event) => setReviewEditor((current) => ({ ...current, title: event.target.value }))} placeholder="发生了什么？" />
                        <textarea aria-label="问题发生场景" value={reviewEditor.scene} onChange={(event) => setReviewEditor((current) => ({ ...current, scene: event.target.value }))} placeholder="当时的具体场景（可选）" rows="2" />
                        <div className="review-editor-selects">
                          <label><span>主要原因</span><select aria-label="选择问题原因分类" value={reviewEditor.category} onChange={(event) => setReviewEditor((current) => ({ ...current, category: event.target.value }))}>{REVIEW_CATEGORIES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                          <label><span>当前状态</span><select aria-label="选择复盘状态" value={reviewEditor.status} onChange={(event) => setReviewEditor((current) => ({ ...current, status: event.target.value }))}>{REVIEW_STATUSES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                        </div>
                        <textarea aria-label="问题根本原因" value={reviewEditor.cause} onChange={(event) => setReviewEditor((current) => ({ ...current, cause: event.target.value }))} placeholder="为什么会发生？" rows="2" />
                        <textarea aria-label="下次改进行动" value={reviewEditor.action} onChange={(event) => setReviewEditor((current) => ({ ...current, action: event.target.value }))} placeholder="下次怎么做？写成一条可执行行动" rows="2" />
                        {reviewEditor.status !== REVIEW_STATUS_PENDING && !reviewEditor.action.trim() && <small className="review-editor-hint">进入待验证或已改善前，需要填写下次行动。</small>}
                        {confirmAction?.type === 'delete-review' && confirmAction.id === review.id ? <div className="inline-confirm review-delete-confirm"><span>确定删除这条复盘吗？</span><button type="button" onClick={() => setConfirmAction(null)}>取消</button><button className="is-danger" type="button" onClick={() => deleteReview(review.id)}>删除</button></div> : <div className="review-editor-actions"><button type="button" className="is-danger" onClick={() => setConfirmAction({ type: 'delete-review', id: review.id })}>删除</button><span /><button type="button" onClick={cancelReviewEdit}>取消</button><button className="is-primary" type="submit" disabled={!reviewEditor.title.trim() || (reviewEditor.status !== REVIEW_STATUS_PENDING && !reviewEditor.action.trim())}>保存</button></div>}
                      </form>
                    ) : (
                      <>
                        {(review.reviewCause || review.reviewAction) && <div className="review-insight">
                          {review.reviewCause && <span><small>原因</small><p>{review.reviewCause}</p></span>}
                          {review.reviewAction && <span><small>下次行动</small><p>{review.reviewAction}</p></span>}
                        </div>}
                        <div className="review-card-actions">
                          <button type="button" onClick={() => repeatReview(review.id)}>再次发生 +1</button>
                          <button type="button" onClick={() => editReview(review)}><PencilSimple size={14} />复盘</button>
                          {review.reviewAction && <>
                            <button type="button" disabled={linkedToday} onClick={() => reviewActionToToday(review.id)}>{linkedToday ? '已加入今天' : '加入今天'}</button>
                            <button type="button" disabled={linkedHabit} onClick={() => reviewActionToHabit(review.id)}>{linkedHabit ? '已转习惯' : '培养为习惯'}<ArrowRight size={13} /></button>
                          </>}
                        </div>
                      </>
                    )}
                  </article>
                })}
              </div>
            </div>
          )}

          {!isHabits && !isReviews && <>
          <form className={isDeadlines ? 'deadline-add' : 'quick-add'} onSubmit={addTask}>
            <input className="task-draft-input" aria-label={isIdeas ? '输入新的想法' : isDeadlines ? '输入新的 DDL' : `输入${selectedDay === 'today' ? '今天' : '明天'}的新任务`} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={isIdeas ? '记下突然想到的事，回车添加' : isDeadlines ? '输入有截止日期的事项' : `输入${selectedDay === 'today' ? '今天' : '明天'}的任务，回车添加`} autoFocus={!isDesktop} />
            {isDeadlines && <span className="deadline-add-controls">
              <label><CalendarBlank size={15} aria-hidden="true" /><input type="date" aria-label="选择截止日期" value={deadlineDate} onChange={(event) => setDeadlineDate(event.target.value)} required /></label>
              <label><Clock size={15} aria-hidden="true" /><input type="time" aria-label="选择截止时间（可选）" value={deadlineTime} onInput={(event) => setDeadlineTime(event.currentTarget.value)} /></label>
              <button type="submit" disabled={!draft.trim() || !normalizeDeadlineDate(deadlineDate)}>添加</button>
            </span>}
          </form>

          <div className="task-list" aria-live="polite">
            {active.length === 0 && <p className="empty">{emptyLabel}</p>}
            {active.map((task) => (
              <div className={`task-row ${selectedDay === 'today' && task.important ? 'is-important' : ''} ${highlightedTaskId === task.id ? 'is-reminder-highlighted' : ''} ${sinkingId === task.id ? 'is-sinking' : ''}`} data-task-id={task.id} key={task.id}>
                <button className="check-button" type="button" aria-label={`完成任务：${task.title}`} onClick={() => completeTask(task.id)} />
                <span className="task-copy">
                  <span className="task-title">{task.title}</span>
                  {isDeadlines && (() => { const status = deadlineStatus(task); return <span className="deadline-meta"><span className="deadline-date"><CalendarBlank size={13} weight="fill" />{task.deadlineDate}{task.deadlineTime ? ` · ${task.deadlineTime}` : ''}</span><span className={`deadline-status is-${status.key}`}>{status.label}</span></span> })()}
                  {selectedDay === 'today' && task.bucket === HABIT_BUCKET && <span className="task-habit-label"><Target size={13} weight="fill" />习惯 · {task.habitMinimum}</span>}
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
                ) : isDeadlines ? (
                  <span className="deadline-actions">
                    <button type="button" disabled={task.date === dateLabel(0)} onClick={() => addDeadlineToToday(task.id)}>{task.date === dateLabel(0) ? '已在今天' : '加入今天'}</button>
                  </span>
                ) : (
                  <span className="task-row-actions">
                    {selectedDay === 'today' && (
                      <>
                        <button className={`reminder-button ${task.reminderTime ? 'is-active' : ''}`} type="button" aria-label={task.reminderTime ? `修改提醒时间：${task.title}，当前${task.reminderTime}` : `设置提醒时间：${task.title}`} aria-expanded={editingReminderId === task.id} title={task.reminderTime ? `提醒时间 ${task.reminderTime}` : '设置提醒时间'} onClick={() => toggleReminderEditor(task)}>
                          <Clock size={17} weight={task.reminderTime ? 'fill' : 'regular'} />
                        </button>
                        {task.bucket !== HABIT_BUCKET && <button className={`important-button ${task.important ? 'is-active' : ''}`} type="button" aria-label={task.important ? `取消重要标记：${task.title}` : `标记为重要：${task.title}`} aria-pressed={Boolean(task.important)} title={task.important ? '取消重要标记' : '标记为重要'} onClick={() => toggleImportant(task.id)}>
                          <Flag size={17} weight={task.important ? 'fill' : 'regular'} />
                        </button>}
                      </>
                    )}
                    {task.bucket !== HABIT_BUCKET && <button className="move-task-button" type="button" onClick={() => moveToIdeas(task.id)}>转为想法</button>}
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
          </>}
        </section>
      </div>
    </main>
  )
}
