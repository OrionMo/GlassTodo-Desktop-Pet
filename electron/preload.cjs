const { contextBridge, ipcRenderer } = require('electron')

try {
  const persistedTasks = ipcRenderer.sendSync('tasks:load-sync')
  if (Array.isArray(persistedTasks)) {
    window.localStorage.setItem('glass-todo.tasks.v2', JSON.stringify(persistedTasks))
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
