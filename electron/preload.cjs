const { contextBridge, ipcRenderer } = require('electron')

const TASKS_KEY = 'glass-todo.tasks.v2'
const TASKS_UPDATED_KEY = 'glass-todo.tasks.v2.updatedAt'

try {
  const serializedLocalTasks = window.localStorage.getItem(TASKS_KEY)
  const localSnapshot = serializedLocalTasks
    ? { tasks: JSON.parse(serializedLocalTasks), updatedAt: window.localStorage.getItem(TASKS_UPDATED_KEY) }
    : null
  const selected = ipcRenderer.sendSync('tasks:bootstrap-sync', localSnapshot)

  if (selected) {
    const updatedAt = selected.updatedAt || new Date().toISOString()
    window.localStorage.setItem(TASKS_KEY, JSON.stringify(selected.tasks))
    window.localStorage.setItem(TASKS_UPDATED_KEY, updatedAt)
    ipcRenderer.sendSync('tasks:save-sync', { tasks: selected.tasks, updatedAt })
  }
} catch {}

contextBridge.exposeInMainWorld('desktopAPI', {
  togglePanel: () => ipcRenderer.invoke('panel:toggle'),
  openReminder: () => ipcRenderer.invoke('reminder:open'),
  startDrag: (point) => ipcRenderer.send('window:drag-start', point),
  moveDrag: (point) => ipcRenderer.send('window:drag-move', point),
  endDrag: () => ipcRenderer.send('window:drag-end'),
  quit: () => ipcRenderer.send('app:quit'),
  onPanelState: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('panel:state', handler)
    return () => ipcRenderer.removeListener('panel:state', handler)
  },
  onReminderState: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('reminder:state', handler)
    return () => ipcRenderer.removeListener('reminder:state', handler)
  },
})
