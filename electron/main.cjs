const { app, BrowserWindow, ipcMain, Notification, screen } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

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
let dragTimeout = null
let resizeTimer = null
let reminderTimer = null
let reminderHideTimer = null
let reminderVisible = false
let taskSyncTimer = null
let lastTaskSignature = null
const qaMode = process.argv.includes('--qa')
const reminderTestMode = process.argv.includes('--test-reminder')
if (qaMode) app.setPath('userData', path.join(__dirname, '..', '.qa-user-data'))
const hasSingleInstanceLock = app.requestSingleInstanceLock()

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

function normalizePoint(point) {
  const x = Number(point?.x)
  const y = Number(point?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: Math.round(x), y: Math.round(y) }
}

function clearDragState() {
  dragState = null
  if (dragTimeout) clearTimeout(dragTimeout)
  dragTimeout = null
}

function refreshDragTimeout() {
  if (dragTimeout) clearTimeout(dragTimeout)
  dragTimeout = setTimeout(clearDragState, 1500)
}

function beginDragAt(cursorPoint) {
  const normalizedPoint = normalizePoint(cursorPoint)
  if (!normalizedPoint || !mainWindow || mainWindow.isDestroyed()) return
  dragState = { point: normalizedPoint, bounds: mainWindow.getBounds() }
  refreshDragTimeout()
}

function moveDragTo(cursorPoint) {
  const normalizedPoint = normalizePoint(cursorPoint)
  if (!dragState || !normalizedPoint || expanded || reminderVisible || !mainWindow || mainWindow.isDestroyed()) return
  refreshDragTimeout()
  const area = screen.getDisplayNearestPoint(normalizedPoint).workArea
  const nextX = Math.round(clamp(dragState.bounds.x + normalizedPoint.x - dragState.point.x, area.x, area.x + area.width - COLLAPSED.width))
  const nextY = Math.round(clamp(dragState.bounds.y + normalizedPoint.y - dragState.point.y, area.y, area.y + area.height - COLLAPSED.height))
  const current = mainWindow.getBounds()
  if (current.x === nextX && current.y === nextY) return
  mainWindow.setPosition(nextX, nextY, false)
}

function sendPanelState() {
  mainWindow?.webContents.send('panel:state', { expanded, direction })
}

function sendReminderState() {
  mainWindow?.webContents.send('reminder:state', { visible: reminderVisible, direction })
}

function hideInAppReminder() {
  if (reminderHideTimer) clearTimeout(reminderHideTimer)
  reminderHideTimer = null
  if (!reminderVisible || !mainWindow || mainWindow.isDestroyed()) return
  const current = mainWindow.getBounds()
  const area = screen.getDisplayNearestPoint({ x: current.x, y: current.y }).workArea
  const x = direction === 'left' ? current.x + current.width - COLLAPSED.width : current.x
  reminderVisible = false
  sendReminderState()
  mainWindow.setBounds({ x: clamp(x, area.x, area.x + area.width - COLLAPSED.width), y: current.y, ...COLLAPSED }, false)
  mainWindow.webContents.invalidate()
}

function showInAppReminder() {
  if (!mainWindow || mainWindow.isDestroyed() || expanded) return false
  if (reminderVisible) {
    if (reminderHideTimer) clearTimeout(reminderHideTimer)
    reminderHideTimer = setTimeout(hideInAppReminder, REMINDER_VISIBLE_MS)
    return true
  }
  const current = mainWindow.getBounds()
  const area = screen.getDisplayNearestPoint({ x: current.x, y: current.y }).workArea
  direction = current.x + current.width / 2 > area.x + area.width / 2 ? 'left' : 'right'
  const x = direction === 'left' ? current.x - (REMINDER.width - COLLAPSED.width) : current.x
  reminderVisible = true
  mainWindow.setBounds({ x: clamp(x, area.x, area.x + area.width - REMINDER.width), y: current.y, ...REMINDER }, false)
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
  if (resizeTimer) {
    clearTimeout(resizeTimer)
    resizeTimer = null
  }

  if (reminderVisible) hideInAppReminder()

  const nextExpanded = !expanded
  const target = targetBounds(nextExpanded)
  expanded = nextExpanded

  if (expanded) {
    mainWindow.setBounds(target, false)
    mainWindow.webContents.invalidate()
    sendPanelState()
  } else {
    sendPanelState()
    resizeTimer = setTimeout(() => {
      resizeTimer = null
      if (!mainWindow || mainWindow.isDestroyed() || expanded) return
      mainWindow.setBounds(target, false)
      mainWindow.webContents.invalidate()
    }, 190)
  }

  return { expanded, direction }
}

function collapsePanel() {
  if (!expanded) return { expanded, direction }
  return togglePanel()
}

function openPanelFromReminder() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (reminderVisible) hideInAppReminder()
  if (!expanded) togglePanel()
  mainWindow.show()
  mainWindow.moveTop()
  mainWindow.focus()
}

function createReminderPayload() {
  return {
    title: 'GlassTodo',
    body: '该查看一下今日待办了',
  }
}

function showTodoReminder() {
  const inAppShown = showInAppReminder()
  if (Notification.isSupported()) {
    const reminder = new Notification(createReminderPayload())
    reminder.once('click', openPanelFromReminder)
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

function readPersistedTasks() {
  try {
    const filePath = getTasksFilePath()
    if (!fs.existsSync(filePath)) return null
    const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return Array.isArray(stored) ? stored : Array.isArray(stored?.tasks) ? stored.tasks : null
  } catch {
    return null
  }
}

function writePersistedTasks(tasks) {
  if (!Array.isArray(tasks)) return false
  const signature = JSON.stringify(tasks)
  if (signature === lastTaskSignature) return true
  const filePath = getTasksFilePath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), tasks }, null, 2), 'utf8')
  lastTaskSignature = signature
  return true
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
  beginDragAt({ x: 100.25, y: 100.5 })
  moveDragTo({ x: 117.75, y: 112.25 })
  await new Promise((resolve) => setTimeout(resolve, 100))
  const draggedBounds = mainWindow.getBounds()
  moveDragTo({ x: 117.75, y: 112.25 })
  await new Promise((resolve) => setTimeout(resolve, 100))
  const stationaryBounds = mainWindow.getBounds()
  clearDragState()
  moveDragTo({ x: 600, y: 600 })
  await new Promise((resolve) => setTimeout(resolve, 100))
  const afterReleaseBounds = mainWindow.getBounds()
  await mainWindow.webContents.executeJavaScript("document.querySelector('.pet-launcher')?.click()")
  await new Promise((resolve) => setTimeout(resolve, 360))
  const expandedBounds = mainWindow.getBounds()
  const expandedImage = await mainWindow.webContents.capturePage()
  fs.writeFileSync(path.join(outputRoot, 'desktop-qa-expanded.png'), expandedImage.toPNG())
  const unfinishedFlow = await mainWindow.webContents.executeJavaScript(`(async () => {
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
    ;[...document.querySelectorAll('.day-switcher button')].find((button) => button.textContent.trim() === '未完成')?.click()
    await wait(100)
    const unfinishedTitle = document.querySelector('.task-row .task-title')?.textContent.trim() || null
    document.querySelector('.task-row .move-task-button')?.click()
    await wait(100)
    ;[...document.querySelectorAll('.day-switcher button')].find((button) => button.textContent.trim() === '今天')?.click()
    await wait(100)
    const returnedTitles = [...document.querySelectorAll('.task-row .task-title')].map((node) => node.textContent.trim())
    return { labels, title, movedToUnfinished: unfinishedTitle === title, returnedToToday: returnedTitles.includes(title) }
  })()`)
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
  fs.writeFileSync(path.join(outputRoot, 'desktop-qa.json'), JSON.stringify({ collapsedBounds, launcherState, reminderBounds, reminderState, draggedBounds, stationaryBounds, afterReleaseBounds, expandedBounds, unfinishedFlow, collapsedAgainBounds, expandedAgainBounds, collapsedByOutsideClickBounds, expandedByReminderBounds, closeButtonState, persistence: { filePath: getTasksFilePath(), taskCount: persistedTasks?.length ?? 0, jsonBacked: Array.isArray(persistedTasks) }, direction, resizeStrategy: 'single-step', outsideClickCollapse: true, reminder: { supported: Notification.isSupported(), intervalMs: REMINDER_INTERVAL_MS, visibleMs: REMINDER_VISIBLE_MS, payload: createReminderPayload(), clickOpensPanel: expandedByReminderBounds.width >= EXPANDED.width } }, null, 2))
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
  mainWindow.on('blur', collapsePanel)
  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'client', 'index.html'))
  mainWindow.webContents.once('did-finish-load', async () => {
    await installWindowControls()
    scheduleTaskSync()
    const initialBounds = mainWindow.getBounds()
    mainWindow.setBounds({ ...initialBounds, width: initialBounds.width + 1 }, false)
    mainWindow.showInactive()
    setTimeout(() => {
      mainWindow.setBounds(initialBounds, false)
      mainWindow.webContents.invalidate()
      sendPanelState()
      sendReminderState()
      if (qaMode) runQA()
      else if (reminderTestMode) setTimeout(showTodoReminder, 600)
    }, 40)
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
      openPanelFromReminder()
      return { expanded, direction }
    })
    ipcMain.on('window:drag-start', () => beginDragAt(screen.getCursorScreenPoint()))
    ipcMain.on('window:drag-move', (_event, point) => {
      if ((Number(point?.buttons) & 1) !== 1) {
        clearDragState()
        return
      }
      moveDragTo(screen.getCursorScreenPoint())
    })
    ipcMain.on('window:drag-end', clearDragState)
    ipcMain.on('tasks:load-sync', (event) => {
      event.returnValue = readPersistedTasks()
    })
    ipcMain.on('app:quit', async () => {
      await syncTasksFromRenderer()
      app.quit()
    })
    createWindow()
    scheduleTodoReminders()
  })

  app.on('before-quit', () => {
    if (reminderTimer) clearInterval(reminderTimer)
    reminderTimer = null
    if (reminderHideTimer) clearTimeout(reminderHideTimer)
    reminderHideTimer = null
    if (taskSyncTimer) clearInterval(taskSyncTimer)
    taskSyncTimer = null
  })
  app.on('window-all-closed', () => app.quit())
}
