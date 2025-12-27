// Circle packing algorithm for file bubbles in voronoi visualization

import * as d3 from 'd3'
import { type VoronoiNode } from '@/lib/voronoi-data-adapter'
import { getBubbleRadius } from './bubble-sizes'

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

  // Sort by size descending - try to place all files, not just maxCircles
  const sortedFiles = files.sort((a, b) => b.value - a.value)

  const circles: any[] = []

  // Try to place all files (up to maxCircles successfully placed)
  for (const file of sortedFiles) {
    // Use global size categorization instead of partition-relative sizing
    const r = getBubbleRadius(file.value)

    // Validate radius
    if (!isFinite(r) || r <= 0) {
      console.warn('[packCirclesInPolygon] Invalid radius for file:', { file, r })
      continue // Skip this file
    }

    let placed = false
    let attempts = 0

    while (!placed && attempts < 100) {  // Increased attempts for better packing
      const angle = Math.random() * Math.PI * 2
      const dist = Math.random() * Math.sqrt(area) * 0.45  // Slightly larger search area
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

    // If we've placed maxCircles successfully, we can stop
    // (but continue trying if we have space and more files)
    if (circles.length >= maxCircles && !placed) {
      break
    }
  }

  console.log(`[packCirclesInPolygon] Placed ${circles.length} of ${sortedFiles.length} bubbles`)
  return circles
}
