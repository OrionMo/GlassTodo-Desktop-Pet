const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { calculateAnchoredPosition, constrainBoundsToWorkArea } = require('../electron/drag-geometry.cjs')

const projectRoot = path.join(__dirname, '..')

test('anchored movement always uses the original cursor and window positions', () => {
  const startBounds = { x: 500, y: 300, width: 84, height: 84 }
  const startCursor = { x: 530, y: 330 }

  assert.deepEqual(calculateAnchoredPosition(startBounds, startCursor, { x: 430, y: 330 }), { x: 400, y: 300 })
  assert.deepEqual(calculateAnchoredPosition(startBounds, startCursor, { x: 730, y: 480 }), { x: 700, y: 450 })
  assert.deepEqual(calculateAnchoredPosition(startBounds, startCursor, startCursor), { x: 500, y: 300 })
})

test('movement is not constrained until the completed bounds are explicitly clamped', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
  const dragged = { x: -60, y: 1010, width: 84, height: 84 }

  assert.deepEqual(constrainBoundsToWorkArea(dragged, workArea), { x: 0, y: 956, width: 84, height: 84 })
  assert.deepEqual(dragged, { x: -60, y: 1010, width: 84, height: 84 })
})

test('oversized windows are constrained to the work-area origin', () => {
  const workArea = { x: -1920, y: 0, width: 1280, height: 720 }
  const bounds = { x: -2500, y: -100, width: 1600, height: 900 }

  assert.deepEqual(constrainBoundsToWorkArea(bounds, workArea), { x: -1920, y: 0, width: 1600, height: 900 })
})

test('main-process drag no longer has inactivity or delayed-collapse timers', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'electron', 'main.cjs'), 'utf8')

  assert.doesNotMatch(source, /dragTimeout|refreshDragTimeout|resizeTimer/)
  assert.match(source, /mainWindow\.setPosition\(next\.x, next\.y, false\)/)
  assert.match(source, /constrainWindowToWorkArea\(`drag-end:\$\{reason\}`\)/)
})

test('renderer and main process agree before pointer capture begins', () => {
  const preload = fs.readFileSync(path.join(projectRoot, 'electron', 'preload.cjs'), 'utf8')
  const appSource = fs.readFileSync(path.join(projectRoot, 'src', 'App.jsx'), 'utf8')

  assert.match(preload, /startDrag: \(point\) => ipcRenderer\.sendSync\('window:drag-start', point\)/)
  assert.match(appSource, /event\.pointerType !== 'mouse'/)
  assert.match(appSource, /if \(!startResult\?\.started\) return/)
  assert.ok(appSource.indexOf('if (!startResult?.started) return') < appSource.indexOf('setPointerCapture(event.pointerId)'))
})

test('diagnostics are opt-in and reminders defer while a drag is active', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'electron', 'main.cjs'), 'utf8')

  assert.match(source, /process\.argv\.includes\('--drag-diagnostics'\)/)
  assert.match(source, /if \(dragState\) \{\s+pendingReminder = reminderPayload/)
  assert.match(source, /setInterval\(sampleDragDiagnostics, 100\)/)
})
