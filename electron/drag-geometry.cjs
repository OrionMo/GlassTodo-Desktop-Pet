function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function normalizePoint(point) {
  const x = Number(point?.x)
  const y = Number(point?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: Math.round(x), y: Math.round(y) }
}

function calculateAnchoredPosition(startBounds, startPoint, cursorPoint) {
  const origin = normalizePoint(startPoint)
  const cursor = normalizePoint(cursorPoint)
  if (!startBounds || !origin || !cursor) return null
  return {
    x: Math.round(startBounds.x + cursor.x - origin.x),
    y: Math.round(startBounds.y + cursor.y - origin.y),
  }
}

function constrainBoundsToWorkArea(bounds, workArea) {
  if (!bounds || !workArea) return null
  return {
    ...bounds,
    x: Math.round(clamp(bounds.x, workArea.x, workArea.x + workArea.width - bounds.width)),
    y: Math.round(clamp(bounds.y, workArea.y, workArea.y + workArea.height - bounds.height)),
  }
}

module.exports = {
  calculateAnchoredPosition,
  clamp,
  constrainBoundsToWorkArea,
  normalizePoint,
}
