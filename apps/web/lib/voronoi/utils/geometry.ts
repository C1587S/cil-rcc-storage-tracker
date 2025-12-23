// Polygon geometry utilities for voronoi visualization

import * as d3 from 'd3'

export function isValidPolygon(polygon: [number, number][]): boolean {
  if (!polygon || polygon.length < 3) return false
  const area = Math.abs(d3.polygonArea(polygon))
  return area > 10
}

export function getPolygonBounds(polygon: [number, number][]): { x: number; y: number; width: number; height: number } {
  const xs = polygon.map(p => p[0])
  const ys = polygon.map(p => p[1])
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  }
}

export function constrainToPolygon(x: number, y: number, polygon: [number, number][], padding: number = 0): [number, number] {
  if (d3.polygonContains(polygon, [x, y])) return [x, y]

  let minDist = Infinity
  let nearest: [number, number] = [x, y]

  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i]
    const p2 = polygon[(i + 1) % polygon.length]
    const dx = p2[0] - p1[0]
    const dy = p2[1] - p1[1]
    const len2 = dx * dx + dy * dy
    if (len2 === 0) continue

    let t = ((x - p1[0]) * dx + (y - p1[1]) * dy) / len2
    t = Math.max(0, Math.min(1, t))

    const projX = p1[0] + t * dx
    const projY = p1[1] + t * dy
    const dist = Math.hypot(x - projX, y - projY)

    if (dist < minDist) {
      minDist = dist
      nearest = [projX, projY]
    }
  }

  const centroid = d3.polygonCentroid(polygon)
  const toCentroid = [centroid[0] - nearest[0], centroid[1] - nearest[1]]
  const len = Math.hypot(toCentroid[0], toCentroid[1])

  if (len > 0) {
    nearest[0] += (toCentroid[0] / len) * (padding + 2)
    nearest[1] += (toCentroid[1] / len) * (padding + 2)
  }

  return nearest
}
