// Circle packing algorithm for file bubbles in voronoi visualization

import * as d3 from 'd3'
import { type VoronoiNode } from '@/lib/voronoi-data-adapter'

export function packCirclesInPolygon(polygon: [number, number][], files: Array<{ node: VoronoiNode; value: number }>, maxCircles: number = 25): Array<{ x: number; y: number; r: number; node: VoronoiNode }> {
  if (files.length === 0) return []
  if (!polygon || polygon.length < 3) return []

  const centroid = d3.polygonCentroid(polygon)
  const area = Math.abs(d3.polygonArea(polygon))

  // Validate centroid and area
  if (!isFinite(centroid[0]) || !isFinite(centroid[1]) || area === 0 || !isFinite(area)) {
    console.warn('[packCirclesInPolygon] Invalid polygon:', { polygon, centroid, area })
    return []
  }
  const topFiles = files.sort((a, b) => b.value - a.value).slice(0, maxCircles)
  const totalSize = topFiles.reduce((sum, f) => sum + f.value, 0)

  // If totalSize is 0 or invalid, cannot compute circles
  if (totalSize === 0 || !isFinite(totalSize)) {
    console.warn('[packCirclesInPolygon] Invalid totalSize:', { totalSize, filesCount: files.length })
    return []
  }

  const circles: any[] = []
  for (const file of topFiles) {
    const sizeRatio = file.value / totalSize
    let r = Math.max(4, Math.min(Math.sqrt(sizeRatio * area / Math.PI) * 0.6, 25))

    // Validate radius
    if (!isFinite(r) || r <= 0) {
      console.warn('[packCirclesInPolygon] Invalid radius for file:', { file, sizeRatio, area, r })
      continue // Skip this file
    }
    let placed = false
    let attempts = 0

    while (!placed && attempts < 50) {
      const angle = Math.random() * Math.PI * 2
      const dist = Math.random() * Math.sqrt(area) * 0.4
      const x = centroid[0] + dist * Math.cos(angle)
      const y = centroid[1] + dist * Math.sin(angle)

      if (d3.polygonContains(polygon, [x, y])) {
        const collision = circles.some(c => Math.sqrt((x - c.x) ** 2 + (y - c.y) ** 2) < (r + c.r + 2))
        if (!collision) {
          circles.push({ x, y, r, node: file.node })
          placed = true
        }
      }
      attempts++
    }
  }
  return circles
}
