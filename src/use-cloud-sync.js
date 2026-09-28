import { useCallback, useEffect, useRef, useState } from 'react'
import { cloudClient, cloudConfigured } from './cloud-client.js'
import { captureLocalChanges, clearPending, mergeRemoteRows, normalizeSyncState, pendingRows, prepareInitialMerge } from './sync-model.js'

const SYNC_STATE_PREFIX = 'glass-todo.cloud-sync.v1.'
const BACKUP_PREFIX = 'glass-todo.pre-cloud-backup.'
const SYNC_INTERVAL_MS = 30 * 1000

function readState(userId) {
  try {
    return normalizeSyncState(JSON.parse(localStorage.getItem(`${SYNC_STATE_PREFIX}${userId}`)), userId)
  } catch {
    return normalizeSyncState(null, userId)
  }
}

function hasSavedState(userId) {
  return Boolean(localStorage.getItem(`${SYNC_STATE_PREFIX}${userId}`))
}

function writeState(state) {
  if (!state?.userId) return
  localStorage.setItem(`${SYNC_STATE_PREFIX}${state.userId}`, JSON.stringify(state))
}

function backupLocalTasks(tasks) {
  const timestamp = new Date().toISOString().replaceAll(':', '-')
  localStorage.setItem(`${BACKUP_PREFIX}${timestamp}`, JSON.stringify({ createdAt: new Date().toISOString(), tasks }))
  window.desktopAPI?.backupTasks?.(tasks).catch(() => {})
}

function sameTasks(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function useCloudSync(tasks, setTasks) {
  const tasksRef = useRef(tasks)
  const stateRef = useRef(null)
  const syncingRef = useRef(false)
  const initializedRef = useRef(false)
  const [session, setSession] = useState(null)
  const [status, setStatus] = useState(cloudConfigured ? 'idle' : 'unconfigured')
  const [message, setMessage] = useState(cloudConfigured ? '尚未登录' : '云同步尚未配置')

  useEffect(() => { tasksRef.current = tasks }, [tasks])

  const fetchRemoteRows = useCallback(async (userId) => {
    const { data, error } = await cloudClient.from('todo_items').select('id, task_data, updated_at, deleted_at').eq('user_id', userId)
    if (error) throw error
    return data || []
  }, [])

  const flushPending = useCallback(async (userId) => {
    const state = stateRef.current
    const rows = pendingRows(state, userId)
    if (rows.length === 0) return
    const { error } = await cloudClient.from('todo_items').upsert(rows, { onConflict: 'user_id,id' })
    if (error) throw error
    stateRef.current = clearPending(stateRef.current, rows.map((row) => ({ id: row.id, updatedAt: row.updated_at })))
    writeState(stateRef.current)
  }, [])

  const syncNow = useCallback(async ({ quiet = false } = {}) => {
    const user = session?.user
    if (!cloudClient || !user || syncingRef.current || !initializedRef.current) return false
    syncingRef.current = true
    if (!quiet) {
      setStatus('syncing')
      setMessage('正在同步…')
    }
    try {
      stateRef.current = captureLocalChanges(tasksRef.current, stateRef.current)
      writeState(stateRef.current)
      await flushPending(user.id)
      const remoteRows = await fetchRemoteRows(user.id)
      const merged = mergeRemoteRows(tasksRef.current, stateRef.current, remoteRows)
      stateRef.current = merged.state
      writeState(stateRef.current)
      if (!sameTasks(tasksRef.current, merged.tasks)) {
        tasksRef.current = merged.tasks
        setTasks(merged.tasks)
      }
      setStatus('synced')
      setMessage(`已同步 · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
      return true
    } catch (error) {
      setStatus(navigator.onLine ? 'error' : 'offline')
      setMessage(navigator.onLine ? `同步失败：${error.message}` : '离线使用中，联网后自动同步')
      return false
    } finally {
      syncingRef.current = false
    }
  }, [fetchRemoteRows, flushPending, session, setTasks])

  const initializeAccount = useCallback(async (user) => {
    initializedRef.current = false
    setStatus('syncing')
    setMessage('正在安全合并本机与云端数据…')
    try {
      const remoteRows = await fetchRemoteRows(user.id)
      if (!hasSavedState(user.id)) {
        backupLocalTasks(tasksRef.current)
        const previousTasks = tasksRef.current
        const prepared = prepareInitialMerge(previousTasks, remoteRows, user.id)
        stateRef.current = prepared.state
        writeState(stateRef.current)
        tasksRef.current = prepared.tasks
        if (!sameTasks(previousTasks, prepared.tasks)) setTasks(prepared.tasks)
      } else {
        const previousTasks = tasksRef.current
        stateRef.current = readState(user.id)
        const captured = captureLocalChanges(previousTasks, stateRef.current)
        const merged = mergeRemoteRows(previousTasks, captured, remoteRows)
        stateRef.current = merged.state
        writeState(stateRef.current)
        tasksRef.current = merged.tasks
        if (!sameTasks(previousTasks, merged.tasks)) setTasks(merged.tasks)
      }
      initializedRef.current = true
      await flushPending(user.id)
      setStatus('synced')
      setMessage('本机数据已备份并完成同步')
    } catch (error) {
      initializedRef.current = true
      setStatus('error')
      setMessage(`同步失败：${error.message}`)
    }
  }, [fetchRemoteRows, flushPending, setTasks])

  useEffect(() => {
    if (!cloudClient) return undefined
    let active = true
    cloudClient.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session || null)
    })
    const { data: listener } = cloudClient.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession || null))
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.user) {
      initializedRef.current = false
      stateRef.current = null
      if (cloudConfigured) {
        setStatus('idle')
        setMessage('尚未登录')
      }
      return
    }
    initializeAccount(session.user)
  }, [initializeAccount, session?.user?.id])

  useEffect(() => {
    if (!session?.user || !initializedRef.current || !stateRef.current) return
    const next = captureLocalChanges(tasks, stateRef.current)
    stateRef.current = next
    writeState(next)
    const timer = window.setTimeout(() => syncNow({ quiet: true }), 700)
    return () => window.clearTimeout(timer)
  }, [session?.user?.id, syncNow, tasks])

  useEffect(() => {
    if (!session?.user) return undefined
    const timer = window.setInterval(() => syncNow({ quiet: true }), SYNC_INTERVAL_MS)
    const resume = () => syncNow({ quiet: true })
    window.addEventListener('online', resume)
    window.addEventListener('focus', resume)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', resume)
      window.removeEventListener('focus', resume)
    }
  }, [session?.user?.id, syncNow])

  const signIn = useCallback(async (email, password) => {
    if (!cloudClient) return { error: new Error('云同步尚未配置') }
    setStatus('syncing')
    setMessage('正在登录…')
    const result = await cloudClient.auth.signInWithPassword({ email, password })
    if (result.error) {
      setStatus('error')
      setMessage(result.error.message)
    }
    return result
  }, [])

  const signUp = useCallback(async (email, password) => {
    if (!cloudClient) return { error: new Error('云同步尚未配置') }
    setStatus('syncing')
    setMessage('正在创建账号…')
    const result = await cloudClient.auth.signUp({ email, password })
    if (result.error) {
      setStatus('error')
      setMessage(result.error.message)
    } else if (!result.data.session) {
      setStatus('idle')
      setMessage('请查收验证邮件后再登录')
    }
    return result
  }, [])

  const signOut = useCallback(async () => {
    if (!cloudClient) return
    await syncNow()
    await cloudClient.auth.signOut()
    setMessage('已退出，当前设备仍保留本地数据')
  }, [syncNow])

  return { configured: cloudConfigured, session, status, message, signIn, signUp, signOut, syncNow }
}
