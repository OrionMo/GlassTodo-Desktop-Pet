const { app, BrowserWindow, ipcMain, Notification, screen } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { chooseTaskSnapshot } = require('./task-storage.cjs')
const { calculateAnchoredPosition, clamp, constrainBoundsToWorkArea, normalizePoint } = require('./drag-geometry.cjs')

// Transparent Electron windows can render as opaque rectangles on some
// Windows GPU/driver combinations. Prefer the stable software compositor.
app.disableHardwareAcceleration()
app.setAppUserModelId('com.codex.glasstodo')

const COLLAPSED = { width: 84, height: 84 }
const EXPANDED = { width: 600, height: 720 }
const REMINDER = { width: 360, height: 84 }
const REMINDER_INTERVAL_MS = 30 * 60 * 1000
const REMINDER_VISIBLE_MS = 12 * 1000
let mainWindow
let expanded = false
let direction = 'left'
let dragState = null
let dragSessionSequence = 0
let dragDiagnosticTimer = null
let dragDiagnosticPath = null
let geometryTransitioning = false
let pendingReminder = null
let reminderTimer = null
let reminderHideTimer = null
let reminderVisible = false
let activeReminder = null
let taskSyncTimer = null
let lastTaskSignature = null
const qaMode = process.argv.includes('--qa')
const reminderTestMode = process.argv.includes('--test-reminder')
const dragDiagnosticsEnabled = process.argv.includes('--drag-diagnostics') || process.env.GLASSTODO_DRAG_DIAGNOSTICS === '1'
if (qaMode) app.setPath('userData', path.join(__dirname, '..', '.qa-user-data'))
const hasSingleInstanceLock = app.requestSingleInstanceLock()

function writeDragDiagnostic(event, details = {}) {
  if (!dragDiagnosticsEnabled) return
  try {
    if (!dragDiagnosticPath) {
      const directory = path.join(app.getPath('userData'), 'diagnostics')
      fs.mkdirSync(directory, { recursive: true })
      dragDiagnosticPath = path.join(directory, 'drag-diagnostics.ndjson')
    }
    const entry = JSON.stringify({ at: new Date().toISOString(), event, ...details })
    fs.appendFile(dragDiagnosticPath, `${entry}\n`, () => {})
  } catch {}
}

function describeWindowState() {
  return {
    expanded,
    reminderVisible,
    geometryTransitioning,
  }
}

function recordGeometryWrite(source, targetBounds) {
  if (!dragDiagnosticsEnabled || source === 'drag-move') return
  writeDragDiagnostic('geometry-write', {
    source,
    targetBounds,
    actualBounds: mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null,
    dragSessionId: dragState?.id || null,
    ...describeWindowState(),
  })
}

function setWindowBounds(targetBounds, source) {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  recordGeometryWrite(source, targetBounds)
  mainWindow.setBounds(targetBounds, false)
  return true
}

function sampleDragDiagnostics() {
  if (!dragState || !mainWindow || mainWindow.isDestroyed()) return
  const cursor = screen.getCursorScreenPoint()
  const actualBounds = mainWindow.getBounds()
  const ideal = calculateAnchoredPosition(dragState.bounds, dragState.point, cursor)
  const display = screen.getDisplayNearestPoint(cursor)
  const formerlyClamped = constrainBoundsToWorkArea({ ...COLLAPSED, ...ideal }, display.workArea)
  writeDragDiagnostic('sample', {
    dragSessionId: dragState.id,
    startedAt: dragState.startedAt,
    cursor,
    startCursor: dragState.point,
    startBounds: dragState.bounds,
    actualBounds,
    ideal,
    error: ideal ? { x: actualBounds.x - ideal.x, y: actualBounds.y - ideal.y } : null,
    formerClampCorrection: ideal && formerlyClamped ? { x: formerlyClamped.x - ideal.x, y: formerlyClamped.y - ideal.y } : null,
    lastMoveReceivedAt: dragState.lastMoveReceivedAt,
    lastMoveSentAt: dragState.lastMoveSentAt,
    estimatedTransportDelayMs: dragState.lastMoveSentAt ? Math.max(0, dragState.lastMoveReceivedAt - dragState.lastMoveSentAt) : null,
    display: { id: display.id, scaleFactor: display.scaleFactor, workArea: display.workArea },
    ...describeWindowState(),
  })
}

function startDragDiagnostics() {
  if (!dragDiagnosticsEnabled || dragDiagnosticTimer) return
  sampleDragDiagnostics()
  dragDiagnosticTimer = setInterval(sampleDragDiagnostics, 100)
}

function stopDragDiagnostics() {
  if (dragDiagnosticTimer) clearInterval(dragDiagnosticTimer)
  dragDiagnosticTimer = null
}

function clearDragState(reason = 'cleared') {
  const endedDrag = dragState
  dragState = null
  stopDragDiagnostics()
  if (endedDrag) {
    writeDragDiagnostic('end', {
      dragSessionId: endedDrag.id,
      startedAt: endedDrag.startedAt,
      endedAt: Date.now(),
      reason,
      actualBounds: mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null,
      ...describeWindowState(),
    })
  }
  return endedDrag
}

function constrainWindowToWorkArea(source = 'drag-end-constrain') {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  const current = mainWindow.getBounds()
  const display = screen.getDisplayMatching(current)
  const target = constrainBoundsToWorkArea(current, display.workArea)
  if (!target || (target.x === current.x && target.y === current.y)) return false
  return setWindowBounds(target, source)
}

function flushPendingReminder() {
  if (!pendingReminder || dragState) return
  const reminderPayload = pendingReminder
  pendingReminder = null
  showInAppReminder(reminderPayload)
}

function finishDrag(reason = 'pointerup', constrain = true) {
  const endedDrag = clearDragState(reason)
  if (!endedDrag) return false
  if (constrain) constrainWindowToWorkArea(`drag-end:${reason}`)
  flushPendingReminder()
  return true
}

function validateDragRequest(request) {
  if (request?.pointerType !== 'mouse') return 'not-mouse'
  if (request?.isPrimary !== true) return 'not-primary'
  if (Number(request?.button) !== 0 || (Number(request?.buttons) & 1) !== 1) return 'not-left-button'
  if (!mainWindow || mainWindow.isDestroyed()) return 'window-unavailable'
  if (expanded) return 'panel-expanded'
  if (reminderVisible) return 'reminder-visible'
  if (geometryTransitioning) return 'geometry-transition'
  if (dragState) return 'already-dragging'
  const bounds = mainWindow.getBounds()
  // Frameless transparent windows can report a few extra DIPs for invisible
  // Windows borders and scale rounding. Reject panel/reminder sizes while
  // accepting that small platform variance around the collapsed geometry.
  if (Math.abs(bounds.width - COLLAPSED.width) > 8 || Math.abs(bounds.height - COLLAPSED.height) > 8) return 'unexpected-window-size'
  return null
}

function beginDragAt(cursorPoint, request) {
  const rejectionReason = validateDragRequest(request)
  const normalizedPoint = normalizePoint(cursorPoint)
  if (rejectionReason || !normalizedPoint) {
    const reason = rejectionReason || 'invalid-cursor'
    writeDragDiagnostic('start-rejected', { reason, request, cursorPoint, ...describeWindowState() })
    return { started: false, reason }
  }
  dragState = {
    id: ++dragSessionSequence,
    point: normalizedPoint,
    bounds: mainWindow.getBounds(),
    startedAt: Date.now(),
    lastMoveReceivedAt: null,
    lastMoveSentAt: null,
  }
  writeDragDiagnostic('start', {
    dragSessionId: dragState.id,
    startCursor: dragState.point,
    startBounds: dragState.bounds,
    ...describeWindowState(),
  })
  startDragDiagnostics()
  return { started: true, sessionId: dragState.id }
}

function moveDragTo(cursorPoint, movePayload) {
  const normalizedPoint = normalizePoint(cursorPoint)
  if (!dragState || !normalizedPoint || expanded || reminderVisible || geometryTransitioning || !mainWindow || mainWindow.isDestroyed()) return false
  dragState.lastMoveReceivedAt = Date.now()
  dragState.lastMoveSentAt = Number.isFinite(Number(movePayload?.sentAt)) ? Number(movePayload.sentAt) : null
  const next = calculateAnchoredPosition(dragState.bounds, dragState.point, normalizedPoint)
  if (!next) return false
  const current = mainWindow.getBounds()
  if (current.x === next.x && current.y === next.y) return true
  mainWindow.setPosition(next.x, next.y, false)
  return true
}

function sendPanelState() {
  mainWindow?.webContents.send('panel:state', { expanded, direction })
}

function sendReminderState() {
  mainWindow?.webContents.send('reminder:state', { visible: reminderVisible, direction, reminder: activeReminder })
}

function hideInAppReminder() {
  if (reminderHideTimer) clearTimeout(reminderHideTimer)
  reminderHideTimer = null
  if (!reminderVisible || !mainWindow || mainWindow.isDestroyed()) return
  const current = mainWindow.getBounds()
  const area = screen.getDisplayNearestPoint({ x: current.x, y: current.y }).workArea
  const x = direction === 'left' ? current.x + current.width - COLLAPSED.width : current.x
  reminderVisible = false
  activeReminder = null
  sendReminderState()
  setWindowBounds({ x: clamp(x, area.x, area.x + area.width - COLLAPSED.width), y: current.y, ...COLLAPSED }, 'reminder-hide')
  mainWindow.webContents.invalidate()
}

function showInAppReminder(reminderPayload = createReminderPayload()) {
  if (!mainWindow || mainWindow.isDestroyed() || expanded) return false
  if (dragState) {
    pendingReminder = reminderPayload
    writeDragDiagnostic('reminder-deferred', { dragSessionId: dragState.id, reminder: reminderPayload })
    return true
  }
  activeReminder = reminderPayload
  if (reminderVisible) {
    if (reminderHideTimer) clearTimeout(reminderHideTimer)
    sendReminderState()
    reminderHideTimer = setTimeout(hideInAppReminder, REMINDER_VISIBLE_MS)
    return true
  }
  const current = mainWindow.getBounds()
  const area = screen.getDisplayNearestPoint({ x: current.x, y: current.y }).workArea
  direction = current.x + current.width / 2 > area.x + area.width / 2 ? 'left' : 'right'
  const x = direction === 'left' ? current.x - (REMINDER.width - COLLAPSED.width) : current.x
  reminderVisible = true
  setWindowBounds({ x: clamp(x, area.x, area.x + area.width - REMINDER.width), y: current.y, ...REMINDER }, 'reminder-show')
  mainWindow.webContents.invalidate()
  sendReminderState()
  reminderHideTimer = setTimeout(hideInAppReminder, REMINDER_VISIBLE_MS)
  return true
}

function targetBounds(nextExpanded) {
  const current = mainWindow.getBounds()
  const area = screen.getDisplayNearestPoint({ x: current.x, y: current.y }).workArea

  if (nextExpanded) {
    direction = current.x + current.width / 2 > area.x + area.width / 2 ? 'left' : 'right'
    const x = direction === 'left' ? current.x - (EXPANDED.width - COLLAPSED.width) : current.x
    return {
      x: clamp(x, area.x, area.x + area.width - EXPANDED.width),
      y: clamp(current.y, area.y, area.y + area.height - EXPANDED.height),
      ...EXPANDED,
    }
  }

  const x = direction === 'left' ? current.x + current.width - COLLAPSED.width : current.x
  return {
    x: clamp(x, area.x, area.x + area.width - COLLAPSED.width),
    y: clamp(current.y, area.y, area.y + area.height - COLLAPSED.height),
    ...COLLAPSED,
  }
}

function togglePanel() {
  if (!mainWindow || mainWindow.isDestroyed()) return { expanded, direction }
  if (dragState) finishDrag('panel-toggle', true)
  if (reminderVisible) hideInAppReminder()

  const nextExpanded = !expanded
  const target = targetBounds(nextExpanded)
  expanded = nextExpanded

  geometryTransitioning = true
  try {
    setWindowBounds(target, expanded ? 'panel-expand' : 'panel-collapse')
    mainWindow.webContents.invalidate()
    sendPanelState()
  } finally {
    geometryTransitioning = false
  }

  return { expanded, direction }
}

function collapsePanel() {
  if (!expanded) return { expanded, direction }
  return togglePanel()
}

function openPanelFromReminder(reminderPayload = activeReminder) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (dragState) finishDrag('reminder-open', true)
  if (reminderVisible) hideInAppReminder()
  if (!expanded) togglePanel()
  mainWindow.show()
  mainWindow.moveTop()
  mainWindow.focus()
  if (reminderPayload) mainWindow.webContents.send('reminder:opened', reminderPayload)
}

function createReminderPayload() {
  return {
    kind: 'overview',
    title: 'GlassTodo',
    body: '该查看一下今日待办了',
  }
}

function normalizeTaskReminderPayload(payload) {
  const taskId = typeof payload?.taskId === 'string' ? payload.taskId.trim() : ''
  const taskTitle = typeof payload?.taskTitle === 'string' ? payload.taskTitle.trim().slice(0, 120) : ''
  const time = typeof payload?.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(payload.time) ? payload.time : ''
  if (!taskId || !taskTitle || !time) return null
  return {
    kind: 'task',
    taskId,
    taskTitle,
    time,
    title: 'GlassTodo 任务提醒',
    body: `${time} · ${taskTitle}`,
  }
}

function showTodoReminder() {
  const payload = createReminderPayload()
  const inAppShown = showInAppReminder(payload)
  if (Notification.isSupported()) {
    const reminder = new Notification(payload)
    reminder.once('click', () => openPanelFromReminder(payload))
    reminder.show()
  }
  return inAppShown || Notification.isSupported()
}

function showTaskReminder(payload) {
  const reminderPayload = normalizeTaskReminderPayload(payload)
  if (!reminderPayload) return false
  const inAppShown = showInAppReminder(reminderPayload)
  if (Notification.isSupported()) {
    const reminder = new Notification({ title: reminderPayload.title, body: reminderPayload.body })
    reminder.once('click', () => openPanelFromReminder(reminderPayload))
    reminder.show()
  }
  return inAppShown || Notification.isSupported()
}

function scheduleTodoReminders() {
  if (qaMode || reminderTimer) return
  reminderTimer = setInterval(showTodoReminder, REMINDER_INTERVAL_MS)
}

function getTasksFilePath() {
  return path.join(app.getPath('userData'), 'tasks.json')
}

function readTaskSnapshotFrom(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (Array.isArray(stored)) return { tasks: stored, updatedAt: null }
    return Array.isArray(stored?.tasks) ? { tasks: stored.tasks, updatedAt: stored.updatedAt || null } : null
  } catch {
    return null
  }
}

function readPersistedTaskSnapshot() {
  const filePath = getTasksFilePath()
  return readTaskSnapshotFrom(filePath) || readTaskSnapshotFrom(`${filePath}.backup`)
}

function readPersistedTasks() {
  return readPersistedTaskSnapshot()?.tasks || null
}

function writePersistedTasks(tasks, updatedAt = new Date().toISOString()) {
  if (!Array.isArray(tasks)) return false
  const signature = JSON.stringify(tasks)
  if (signature === lastTaskSignature) return true
  const filePath = getTasksFilePath()
  const tempPath = `${filePath}.tmp`
  const backupPath = `${filePath}.backup`
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(tempPath, JSON.stringify({ version: 1, updatedAt, tasks }, null, 2), 'utf8')
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, backupPath)
  fs.copyFileSync(tempPath, filePath)
  fs.unlinkSync(tempPath)
  lastTaskSignature = signature
  return true
}

function backupPersistedTasks(tasks) {
  if (!Array.isArray(tasks)) return null
  const backupDirectory = path.join(app.getPath('userData'), 'backups')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupDirectory, `tasks-before-cloud-${timestamp}.json`)
  fs.mkdirSync(backupDirectory, { recursive: true })
  fs.writeFileSync(backupPath, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), tasks }, null, 2), 'utf8')
  return backupPath
}

async function syncTasksFromRenderer() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return false
  try {
    const serialized = await mainWindow.webContents.executeJavaScript("localStorage.getItem('glass-todo.tasks.v2')")
    if (!serialized) return false
    return writePersistedTasks(JSON.parse(serialized))
  } catch {
    return false
  }
}

function scheduleTaskSync() {
  if (taskSyncTimer) return
  syncTasksFromRenderer()
  taskSyncTimer = setInterval(syncTasksFromRenderer, 750)
}

async function installWindowControls() {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  return mainWindow.webContents.executeJavaScript(`(() => {
    const todoWindow = document.querySelector('.todo-window')
    if (!todoWindow) return false
    if (todoWindow.querySelector('.window-close-button')) return true
    const closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.className = 'window-close-button'
    closeButton.setAttribute('aria-label', '关闭 GlassTodo')
    closeButton.title = '关闭 GlassTodo'
    closeButton.textContent = '×'
    closeButton.addEventListener('click', () => window.desktopAPI.quit())
    todoWindow.appendChild(closeButton)
    return true
  })()`)
}

async function runQA() {
  const outputRoot = path.join(__dirname, '..')
  await new Promise((resolve) => setTimeout(resolve, 180))
  const collapsedBounds = mainWindow.getBounds()
  const collapsedContentBounds = mainWindow.getContentBounds()
  const displayState = screen.getDisplayMatching(collapsedBounds)
  const launcherState = await mainWindow.webContents.executeJavaScript(`(() => {
    const launcher = document.querySelector('.pet-launcher')
    const rect = launcher?.getBoundingClientRect()
    const style = launcher ? getComputedStyle(launcher) : null
    const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null
    return {
      rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      display: style?.display,
      visibility: style?.visibility,
      opacity: style?.opacity,
      borderRadius: style?.borderRadius,
      hitClass: hit?.className || null,
    }
  })()`)
  const collapsedImage = await mainWindow.webContents.capturePage()
  fs.writeFileSync(path.join(outputRoot, 'desktop-qa-collapsed.png'), collapsedImage.toPNG())
  showInAppReminder()
  await new Promise((resolve) => setTimeout(resolve, 220))
  const reminderBounds = mainWindow.getBounds()
  const reminderState = await mainWindow.webContents.executeJavaScript(`(() => {
    const toast = document.querySelector('.reminder-toast')
    const launcher = document.querySelector('.pet-launcher')
    return { visible: Boolean(toast), text: toast?.innerText || null, launcherPulsing: launcher?.classList.contains('has-reminder') || false }
  })()`)
  const reminderImage = await mainWindow.webContents.capturePage()
  fs.writeFileSync(path.join(outputRoot, 'desktop-qa-reminder.png'), reminderImage.toPNG())
  hideInAppReminder()
  await new Promise((resolve) => setTimeout(resolve, 100))
  beginDragAt({ x: 100.25, y: 100.5 }, { pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 })
  moveDragTo({ x: 117.75, y: 112.25 }, { buttons: 1, sentAt: Date.now() })
  await new Promise((resolve) => setTimeout(resolve, 100))
  const draggedBounds = mainWindow.getBounds()
  await new Promise((resolve) => setTimeout(resolve, 2100))
  moveDragTo({ x: 127.75, y: 122.25 }, { buttons: 1, sentAt: Date.now() })
  await new Promise((resolve) => setTimeout(resolve, 100))
  const resumedAfterHoldBounds = mainWindow.getBounds()
  moveDragTo({ x: 127.75, y: 122.25 }, { buttons: 1, sentAt: Date.now() })
  await new Promise((resolve) => setTimeout(resolve, 100))
  const stationaryBounds = mainWindow.getBounds()
  finishDrag('qa-release', true)
  const releasedBounds = mainWindow.getBounds()
  moveDragTo({ x: 600, y: 600 }, { buttons: 1, sentAt: Date.now() })
  await new Promise((resolve) => setTimeout(resolve, 100))
  const afterReleaseBounds = mainWindow.getBounds()
  await mainWindow.webContents.executeJavaScript("document.querySelector('.pet-launcher')?.click()")
  await new Promise((resolve) => setTimeout(resolve, 360))
  const expandedBounds = mainWindow.getBounds()
  const expandedImage = await mainWindow.webContents.capturePage()
  fs.writeFileSync(path.join(outputRoot, 'desktop-qa-expanded.png'), expandedImage.toPNG())
  const ideaFlow = await mainWindow.webContents.executeJavaScript(`(async () => {
    const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
    const labels = [...document.querySelectorAll('.day-switcher button')].map((button) => button.textContent.trim())
    let firstRow = document.querySelector('.task-row')
    if (!firstRow) {
      const input = document.querySelector('.quick-add input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'QA 提醒回归任务')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(30)
      document.querySelector('.quick-add')?.requestSubmit()
      await wait(100)
      firstRow = document.querySelector('.task-row')
    }
    const title = firstRow?.querySelector('.task-title')?.textContent.trim() || null
    firstRow?.querySelector('.move-task-button')?.click()
    await wait(100)
    ;[...document.querySelectorAll('.day-switcher button')].find((button) => button.textContent.trim() === '想法')?.click()
    await wait(100)
    const ideaTitle = document.querySelector('.task-row .task-title')?.textContent.trim() || null
    const filters = [...document.querySelectorAll('.idea-filter button')].map((button) => button.textContent.trim())
    document.querySelector('.task-row .idea-tags button')?.click()
    await wait(100)
    ;[...document.querySelectorAll('.idea-filter button')].find((button) => button.textContent.trim() === '符合当下目标')?.click()
    await wait(100)
    const goalFilteredTitle = document.querySelector('.task-row .task-title')?.textContent.trim() || null
    document.querySelector('.task-row .idea-schedule-actions button[title="加入今天"]')?.click()
    await wait(100)
    ;[...document.querySelectorAll('.day-switcher button')].find((button) => button.textContent.trim() === '今天')?.click()
    await wait(100)
    const returnedTitles = [...document.querySelectorAll('.task-row .task-title')].map((node) => node.textContent.trim())
    ;[...document.querySelectorAll('.day-switcher button')].find((button) => button.textContent.trim() === '想法')?.click()
    await wait(100)
    return { labels, filters, title, movedToIdeas: ideaTitle === title, goalFilterWorks: goalFilteredTitle === title, returnedToToday: returnedTitles.includes(title) }
  })()`)
  const ideasImage = await mainWindow.webContents.capturePage()
  fs.writeFileSync(path.join(outputRoot, 'desktop-qa-ideas.png'), ideasImage.toPNG())
  await mainWindow.webContents.executeJavaScript("document.querySelector('.pet-launcher')?.click()")
  await new Promise((resolve) => setTimeout(resolve, 360))
  const collapsedAgainBounds = mainWindow.getBounds()
  await mainWindow.webContents.executeJavaScript("document.querySelector('.pet-launcher')?.click()")
  await new Promise((resolve) => setTimeout(resolve, 360))
  const expandedAgainBounds = mainWindow.getBounds()
  mainWindow.emit('blur')
  await new Promise((resolve) => setTimeout(resolve, 360))
  const collapsedByOutsideClickBounds = mainWindow.getBounds()
  openPanelFromReminder()
  await new Promise((resolve) => setTimeout(resolve, 360))
  const expandedByReminderBounds = mainWindow.getBounds()
  const closeButtonState = await mainWindow.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('.window-close-button')
    const rect = button?.getBoundingClientRect()
    return { exists: Boolean(button), label: button?.getAttribute('aria-label') || null, rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null }
  })()`)
  await syncTasksFromRenderer()
  const persistedTasks = readPersistedTasks()
  fs.writeFileSync(path.join(outputRoot, 'desktop-qa.json'), JSON.stringify({ collapsedBounds, collapsedContentBounds, display: { id: displayState.id, scaleFactor: displayState.scaleFactor, workArea: displayState.workArea }, launcherState, reminderBounds, reminderState, draggedBounds, resumedAfterHoldBounds, stationaryBounds, releasedBounds, afterReleaseBounds, dragChecks: { resumedAfterTwoSeconds: resumedAfterHoldBounds.x !== draggedBounds.x || resumedAfterHoldBounds.y !== draggedBounds.y, stationaryAfterRepeatedPoint: stationaryBounds.x === resumedAfterHoldBounds.x && stationaryBounds.y === resumedAfterHoldBounds.y, releasedWindowIgnoresMovement: afterReleaseBounds.x === releasedBounds.x && afterReleaseBounds.y === releasedBounds.y }, expandedBounds, ideaFlow, collapsedAgainBounds, expandedAgainBounds, collapsedByOutsideClickBounds, expandedByReminderBounds, closeButtonState, persistence: { filePath: getTasksFilePath(), taskCount: persistedTasks?.length ?? 0, jsonBacked: Array.isArray(persistedTasks) }, direction, resizeStrategy: 'single-step', outsideClickCollapse: true, reminder: { supported: Notification.isSupported(), intervalMs: REMINDER_INTERVAL_MS, visibleMs: REMINDER_VISIBLE_MS, payload: createReminderPayload(), clickOpensPanel: expandedByReminderBounds.width >= EXPANDED.width } }, null, 2))
  if (closeButtonState.exists) {
    await mainWindow.webContents.executeJavaScript("document.querySelector('.window-close-button')?.click()")
    return
  }
  app.quit()
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea
  mainWindow = new BrowserWindow({
    width: COLLAPSED.width,
    height: COLLAPSED.height,
    x: area.x + area.width - COLLAPSED.width - 28,
    y: area.y + 120,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.setAlwaysOnTop(true, 'floating')
  mainWindow.on('blur', () => {
    finishDrag('window-blur', true)
    collapsePanel()
  })
  mainWindow.on('closed', () => {
    clearDragState('window-closed')
    pendingReminder = null
    mainWindow = null
  })
  mainWindow.webContents.on('render-process-gone', () => clearDragState('render-process-gone'))
  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'client', 'index.html'))
  mainWindow.webContents.once('did-finish-load', async () => {
    await installWindowControls()
    scheduleTaskSync()
    const initialBounds = mainWindow.getBounds()
    geometryTransitioning = true
    try {
      setWindowBounds({ ...initialBounds, width: initialBounds.width + 1 }, 'startup-render-prime')
      setWindowBounds(initialBounds, 'startup-render-restore')
      mainWindow.webContents.invalidate()
      sendPanelState()
      sendReminderState()
    } finally {
      geometryTransitioning = false
    }
    mainWindow.showInactive()
    if (qaMode) setTimeout(runQA, 40)
    else if (reminderTestMode) setTimeout(showTodoReminder, 600)
  })
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.showInactive()
    mainWindow.moveTop()
  })

  app.whenReady().then(() => {
    ipcMain.handle('panel:toggle', togglePanel)
    ipcMain.handle('reminder:open', () => {
      const reminderPayload = activeReminder
      openPanelFromReminder(reminderPayload)
      return { expanded, direction }
    })
    ipcMain.handle('task-reminder:show', (_event, payload) => showTaskReminder(payload))
    ipcMain.removeAllListeners('window:drag-start')
    ipcMain.removeAllListeners('window:drag-move')
    ipcMain.removeAllListeners('window:drag-end')
    ipcMain.on('window:drag-start', (event, request) => {
      event.returnValue = beginDragAt(screen.getCursorScreenPoint(), request)
    })
    ipcMain.on('window:drag-move', (_event, point) => {
      if ((Number(point?.buttons) & 1) !== 1) {
        finishDrag('buttons-released', true)
        return
      }
      moveDragTo(screen.getCursorScreenPoint(), point)
    })
    ipcMain.on('window:drag-end', (_event, reason) => finishDrag(typeof reason === 'string' ? reason : 'pointerup', true))
    ipcMain.on('tasks:load-sync', (event) => {
      event.returnValue = readPersistedTaskSnapshot()
    })
    ipcMain.on('tasks:bootstrap-sync', (event, localSnapshot) => {
      event.returnValue = chooseTaskSnapshot(localSnapshot, readPersistedTaskSnapshot())
    })
    ipcMain.on('tasks:save-sync', (event, snapshot) => {
      event.returnValue = writePersistedTasks(snapshot?.tasks, snapshot?.updatedAt)
    })
    ipcMain.handle('tasks:backup', (_event, tasks) => backupPersistedTasks(tasks))
    ipcMain.on('app:quit', async () => {
      await syncTasksFromRenderer()
      app.quit()
    })
    createWindow()
    scheduleTodoReminders()
  })

  app.on('before-quit', () => {
    clearDragState('app-before-quit')
    pendingReminder = null
    if (reminderTimer) clearInterval(reminderTimer)
    reminderTimer = null
    if (reminderHideTimer) clearTimeout(reminderHideTimer)
    reminderHideTimer = null
    if (taskSyncTimer) clearInterval(taskSyncTimer)
    taskSyncTimer = null
  })
  app.on('window-all-closed', () => app.quit())
}
