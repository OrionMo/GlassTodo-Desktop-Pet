import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, ListChecks } from '@phosphor-icons/react'

const seedTitles = ['整理会议资料', '回复客户邮件', '完成产品方案初稿']

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
    if (saved) return JSON.parse(saved)
    const legacy = localStorage.getItem('glass-todo.tasks.v1')
    if (legacy) return JSON.parse(legacy).map((task) => ({ ...task, date: dateLabel(0) }))
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
  const [showCompleted, setShowCompleted] = useState(false)
  const [sinkingId, setSinkingId] = useState(null)
  const [panelOpen, setPanelOpen] = useState(!hasDesktopBridge)
  const [panelDirection, setPanelDirection] = useState('left')
  const [reminderVisible, setReminderVisible] = useState(false)
  const dragOrigin = useRef(null)
  const suppressClick = useRef(false)
  const isUnfinished = selectedDay === 'unfinished'
  const selectedDate = selectedDay === 'today' ? dateLabel(0) : selectedDay === 'tomorrow' ? dateLabel(1) : null

  const active = useMemo(() => tasks.filter((task) => {
    if (task.completed) return false
    return isUnfinished ? task.bucket === 'unfinished' : task.bucket !== 'unfinished' && task.date === selectedDate
  }), [tasks, isUnfinished, selectedDate])

  const completed = useMemo(() => tasks.filter((task) => {
    if (!task.completed) return false
    return isUnfinished ? task.bucket === 'unfinished' : task.bucket !== 'unfinished' && task.date === selectedDate
  }), [tasks, isUnfinished, selectedDate])

  useEffect(() => localStorage.setItem('glass-todo.tasks.v2', JSON.stringify(tasks)), [tasks])

  useEffect(() => {
    if (!hasDesktopBridge) return undefined
    document.body.classList.add('electron')
    document.documentElement.classList.add('electron-root')
    const unsubscribePanel = window.desktopAPI.onPanelState((state) => {
      setPanelOpen(state.expanded)
      setPanelDirection(state.direction)
    })
    const unsubscribeReminder = window.desktopAPI.onReminderState((state) => {
      setReminderVisible(state.visible)
      setPanelDirection(state.direction)
    })
    const cancelDrag = () => finishDrag(true)
    window.addEventListener('blur', cancelDrag)
    return () => {
      document.body.classList.remove('electron')
      document.documentElement.classList.remove('electron-root')
      window.removeEventListener('blur', cancelDrag)
      unsubscribePanel()
      unsubscribeReminder()
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
    setSelectedDay('today')
    setShowCompleted(false)
    setReminderVisible(false)
    const state = await window.desktopAPI.openReminder()
    setPanelOpen(state.expanded)
    setPanelDirection(state.direction)
  }

  function selectList(day) {
    setSelectedDay(day)
    setShowCompleted(false)
  }

  function addTask(event) {
    event.preventDefault()
    const title = draft.trim()
    if (!title || !selectedDate) return
    setTasks((current) => [...current, { id: crypto.randomUUID(), title, completed: false, date: selectedDate }])
    setDraft('')
  }

  function completeTask(id) {
    if (sinkingId) return
    setSinkingId(id)
    window.setTimeout(() => {
      setTasks((current) => current.map((task) => task.id === id ? { ...task, completed: true } : task))
      setSinkingId(null)
    }, 460)
  }

  function restoreTask(id) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, completed: false } : task))
  }

  function moveToUnfinished(id) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, bucket: 'unfinished' } : task))
  }

  function moveToToday(id) {
    setTasks((current) => current.map((task) => {
      if (task.id !== id) return task
      const { bucket, ...rest } = task
      return { ...rest, date: dateLabel(0) }
    }))
  }

  const emptyLabel = isUnfinished ? '还没有手动加入的未完成待办' : `${selectedDay === 'today' ? '今天' : '明天'}还没有待办`

  return (
    <main className={isDesktop ? `desktop-shell direction-${panelDirection}` : 'stage'}>
      {isDesktop && (
        <button type="button" className={`pet-launcher ${panelOpen ? 'is-active' : ''} ${reminderVisible ? 'has-reminder' : ''}`} aria-label={panelOpen ? '收起待办' : '展开待办'} title={panelOpen ? '收起待办' : '展开待办'} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => finishDrag(false)} onPointerCancel={() => finishDrag(true)} onLostPointerCapture={() => finishDrag(true)} onClick={reminderVisible ? openReminder : handleLauncherClick}>
          <ListChecks size={32} weight="duotone" />
        </button>
      )}
      {isDesktop && reminderVisible && <button type="button" className="reminder-toast" onClick={openReminder}><span className="reminder-dot" aria-hidden="true" /><span><strong>看看今日待办</strong><small>点击立即打开</small></span></button>}
      <div className={`panel-wrap ${panelOpen ? 'is-visible' : ''}`}>
        <section className="todo-window" aria-label="毛玻璃待办清单">
          {isDesktop && <button type="button" className="window-close-button" aria-label="关闭 GlassTodo" title="关闭 GlassTodo" onClick={() => window.desktopAPI.quit()}>×</button>}
          <header className="todo-header">
            <div className="title-line"><h1>待办</h1><span className="active-count">{active.length}</span></div>
            <div className="header-meta">
              {isUnfinished ? <span className="mode-label">手动归集</span> : <time dateTime={selectedDate}>{selectedDate}</time>}
              <span className="version-label">v7.1 · Reminder</span>
            </div>
          </header>

          <nav className="day-switcher" aria-label="待办列表">
            <button type="button" className={selectedDay === 'today' ? 'is-selected' : ''} aria-pressed={selectedDay === 'today'} onClick={() => selectList('today')}>今天</button>
            <button type="button" className={selectedDay === 'tomorrow' ? 'is-selected' : ''} aria-pressed={selectedDay === 'tomorrow'} onClick={() => selectList('tomorrow')}>明天</button>
            <button type="button" className={isUnfinished ? 'is-selected' : ''} aria-pressed={isUnfinished} onClick={() => selectList('unfinished')}>未完成</button>
          </nav>

          {isUnfinished ? <div className="unfinished-hint">从今天或明天的任务中手动移入</div> : (
            <form className="quick-add" onSubmit={addTask}>
              <input aria-label={`输入${selectedDay === 'today' ? '今天' : '明天'}的新任务`} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`输入${selectedDay === 'today' ? '今天' : '明天'}的任务，回车添加`} autoFocus={!isDesktop} />
            </form>
          )}

          <div className="task-list" aria-live="polite">
            {active.length === 0 && <p className="empty">{emptyLabel}</p>}
            {active.map((task) => (
              <div className={`task-row ${sinkingId === task.id ? 'is-sinking' : ''}`} key={task.id}>
                <button className="check-button" type="button" aria-label={`完成任务：${task.title}`} onClick={() => completeTask(task.id)} />
                <span className="task-title">{task.title}</span>
                <button className="move-task-button" type="button" onClick={() => isUnfinished ? moveToToday(task.id) : moveToUnfinished(task.id)}>{isUnfinished ? '移回今天' : '移入未完成'}</button>
              </div>
            ))}
          </div>

          <section className={`completed-shelf ${showCompleted ? 'is-open' : ''}`}>
            <button type="button" className="completed-toggle" aria-expanded={showCompleted} onClick={() => setShowCompleted((open) => !open)}>
              <span className="disclosure" aria-hidden="true"><CaretDown size={16} weight="bold" /></span><span>已完成</span><span className="completed-count">{completed.length}</span>
            </button>
            {showCompleted && <div className="completed-list">{completed.length === 0 ? <p className="completed-empty">还没有已完成任务</p> : completed.map((task) => (
              <button type="button" className="completed-row" key={task.id} onClick={() => restoreTask(task.id)} title="点击恢复任务"><span className="done-mark" aria-hidden="true">✓</span><s>{task.title}</s></button>
            ))}</div>}
          </section>
        </section>
      </div>
    </main>
  )
}
