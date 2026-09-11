import * as d3 from 'd3'
// @ts-ignore - d3-voronoi-treemap types may not be available
import { voronoiTreemap } from 'd3-voronoi-treemap'
import { type VoronoiNode } from '@/lib/voronoi-data-adapter'
import { type VoronoiCacheEntry } from '@/lib/voronoi/utils/types'
import { isValidPolygon } from '@/lib/voronoi/utils/geometry'

/**
 * Result of voronoi treemap computation
 */
export interface ComputedVoronoiResult {
  hierarchy: d3.HierarchyNode<any>
  allNodes: d3.HierarchyNode<any>[]
  topLevelNodes: d3.HierarchyNode<any>[]
  previewNodes: d3.HierarchyNode<any>[]
}

// Cell-count caps per hierarchy level. Directories beyond the cap are merged
// into one synthetic "+N more" cell: the treemap solver cost grows with cell
// count, and cells past these caps are sub-pixel slivers anyway.
const MAX_CELLS_TOP = 80      // depth 0: direct children of the current root
const MAX_CELLS_PREVIEW = 30  // depth 1: preview cells inside each partition

/**
 * Computes voronoi treemap layout with caching support.
 * Separates directories and files into hierarchical structure.
 */
export class VoronoiComputer {
  private cache: Map<string, VoronoiCacheEntry>

  constructor(cache: Map<string, VoronoiCacheEntry>) {
    this.cache = cache
  }

  /**
   * Prepares hierarchy by separating directories and files.
   * Groups files into synthetic "__files__" nodes and caps children per level.
   */
  private prepareHierarchy(n: VoronoiNode, depth: number = 0): any {
    const uniqueId = `node-${Math.random().toString(36).substr(2, 9)}`

    // CRITICAL: Stop recursing at depth 2 (preview boundary)
    if (depth >= 2) {
      return { ...n, uniqueId, depth, hierarchyDepth: depth }
    }

    // Handle leaf nodes (no children)
    if ((!n.children || n.children.length === 0) && (!n.originalFiles || n.originalFiles.length === 0)) {
      return { ...n, uniqueId, depth, hierarchyDepth: depth }
    }

    // Separate directories and files
    let dirs = (n.children || []).filter(c => c.isDirectory)
    const filesFromChildren = (n.children || []).filter(c => !c.isDirectory)
    const filesFromOriginal = n.originalFiles || []
    const allFiles = [...filesFromChildren, ...filesFromOriginal]

    // Cap directory count per level: keep the largest, merge the rest into
    // one aggregate cell so total size stays truthful.
    const cap = depth === 0 ? MAX_CELLS_TOP : MAX_CELLS_PREVIEW
    let aggregated: any = null
    if (dirs.length > cap) {
      const sorted = [...dirs].sort((a, b) => (b.size || 0) - (a.size || 0))
      const rest = sorted.slice(cap)
      dirs = sorted.slice(0, cap)
      const restSize = rest.reduce((acc, d) => acc + (d.size || 0), 0)
      const restFiles = rest.reduce((acc, d) => acc + ((d as any).file_count || 0), 0)
      aggregated = {
        name: `+${rest.length} more`,
        path: `${n.path}/__aggregated__`,
        size: Math.max(restSize, 1),
        file_count: restFiles,
        isDirectory: false,
        isSynthetic: true,
        depth: depth + 1,
        hierarchyDepth: depth + 1,
        uniqueId: `agg-${Math.random().toString(36).substr(2, 9)}`
      }
    }

    // Recursively process directory children
    const children = dirs.map(d => this.prepareHierarchy(d, depth + 1))
    if (aggregated) {
      children.push(aggregated)
    }

    // Create synthetic __files__ node if there are any files
    if (allFiles.length > 0) {
      const filesSize = allFiles.reduce((acc, f) => acc + f.size, 0)
      
      children.push({
        name: '__files__',
        path: `${n.path}/__files__`,
        size: filesSize,
        isDirectory: false,
        isSynthetic: true,
        originalFiles: allFiles,
        file_count: allFiles.length,
        depth: depth + 1,
        hierarchyDepth: depth + 1,
        uniqueId: `files-${Math.random().toString(36).substr(2, 9)}`
      })
    }

    const { originalFiles: _originalFiles, ...nodeWithoutFiles } = n
    return { ...nodeWithoutFiles, children, uniqueId, depth, hierarchyDepth: depth }
  }

  /**
   * Applies voronoi treemap computation recursively.
   */
  private applyVoronoi(
    h: d3.HierarchyNode<any>,
    poly: any,
    depth: number,
    treemap: any
  ): void {
    try {
      treemap.clip(poly)(h)
      if (depth < 2 && h.children) {
        h.children.forEach(child => {
          if (child.data.isDirectory && !child.data.isSynthetic && (child as any).polygon) {
            this.applyVoronoi(child, (child as any).polygon, depth + 1, treemap)
          }
        })
      }
    } catch (err) {
      console.warn('Voronoi computation error:', err)
    }
  }

  /**
   * Saves computed polygons to cache.
   */
  private savePolygonsToCache(h: d3.HierarchyNode<any>): void {
    if ((h as any).polygon) {
      h.data.cachedPolygon = (h as any).polygon
    }
    h.children?.forEach(child => this.savePolygonsToCache(child))
  }

  /**
   * Restores polygons from cached data.
   */
  private restorePolygonsFromCache(h: d3.HierarchyNode<any>): void {
    if (h.data.cachedPolygon) {
      (h as any).polygon = h.data.cachedPolygon
    }
    h.children?.forEach(child => this.restorePolygonsFromCache(child))
  }

  /**
   * Linearly rescales all cached polygons to new dimensions.
   * Area proportions are preserved, so a resize (or fullscreen toggle)
   * reuses the cached layout instead of re-running the solver.
   */
  private scaleCachedPolygons(node: any, sx: number, sy: number): void {
    if (node.cachedPolygon) {
      node.cachedPolygon = node.cachedPolygon.map((p: [number, number]) => [p[0] * sx, p[1] * sy])
    }
    node.children?.forEach((c: any) => this.scaleCachedPolygons(c, sx, sy))
  }

  /**
   * Removes stale cached polygons before a fresh solve. Without this, a
   * partially failed solve can leave polygons from an older layout mixed
   * with new ones, producing gaps and misplaced cells.
   */
  private clearCachedPolygons(node: any): void {
    delete node.cachedPolygon
    node.children?.forEach((c: any) => this.clearCachedPolygons(c))
  }

  /**
   * Computes or retrieves cached voronoi hierarchy.
   */
  compute(
    data: VoronoiNode,
    effectivePath: string,
    width: number,
    height: number,
    weightMode: 'size' | 'files' = 'size'
  ): ComputedVoronoiResult {
    // Layouts differ per weighting mode, so cache them separately
    const cacheKey = `${effectivePath}::${weightMode}`
    // Cell weight: bytes, or file count (to spot many-small-files directories)
    const leafValue = (d: any) => weightMode === 'files'
      ? Math.max(d.file_count || (d.originalFiles?.length ?? 0) || 1, 1)
      : Math.max(d.size || 1, 1)
    const cached = this.cache.get(cacheKey)

    // Exact dimension matching: force recomputation if dimensions differ by > 1px
    const dimensionsMatch = cached &&
                            Math.abs(cached.width - width) < 1 &&
                            Math.abs(cached.height - height) < 1

    // Verify path match to prevent stale data rendering
    if (data.path !== effectivePath) {
      return { hierarchy: null as any, allNodes: [], topLevelNodes: [], previewNodes: [] }
    }

    let hierarchy: d3.HierarchyNode<any>

    // A cached layout can be rescaled linearly ONLY when the aspect ratio is
    // essentially unchanged; stretching across different aspect ratios
    // distorts the tiling. Otherwise fall through to a fresh solve.
    const hasPolygons = cached && cached.hierarchyData &&
                        (cached.hierarchyData.cachedPolygon ||
                         cached.hierarchyData.children?.some((c: any) => c.cachedPolygon))
    const aspectClose = cached && cached.width && cached.height &&
                        Math.abs((cached.width / cached.height) - (width / height)) / (width / height) < 0.02
    const canReuse = hasPolygons && (dimensionsMatch || aspectClose)

    if (canReuse) {
      if (!dimensionsMatch) {
        const sx = width / cached!.width!
        const sy = height / cached!.height!
        console.log(`[VoronoiComputer] Cache HIT (rescaled ${cached!.width}x${cached!.height} -> ${width}x${height})`)
        this.scaleCachedPolygons(cached!.hierarchyData, sx, sy)
        cached!.width = width
        cached!.height = height
      } else {
        console.log(`[VoronoiComputer] Cache HIT. Dimensions exact: ${width}x${height}`)
      }

      const hierarchyData = cached!.hierarchyData
      hierarchy = d3.hierarchy(hierarchyData)
        .sum(d => (!d.children || d.children.length === 0) ? leafValue(d) : 0)
        .sort((a, b) => (b.value || 0) - (a.value || 0))

      this.restorePolygonsFromCache(hierarchy)

    } else {
      // --- FRESH COMPUTE (RESIZE OR NEW DATA) ---
      // This ensures the voronoi fills the entire container perfectly.
      console.log(`[VoronoiComputer] FRESH COMPUTE. Reason: ${cached ? 'Resize detected' : 'No cache'}. Dims: ${width}x${height}`)
      const perfStart = performance.now()

      // Reuse data structure if available (topology doesn't change on resize, only geometry)
      let hierarchyData = cached?.hierarchyData
      if (!hierarchyData) {
         hierarchyData = this.prepareHierarchy(data)
      } else {
         // Stale polygons from the previous layout must not survive a re-solve
         this.clearCachedPolygons(hierarchyData)
      }

      hierarchy = d3.hierarchy(hierarchyData)
        .sum(d => (!d.children || d.children.length === 0) ? leafValue(d) : 0)
        .sort((a, b) => (b.value || 0) - (a.value || 0))

      // Define the clipping polygon to match the FULL container size
      const padding = 0 
      const clip: [number, number][] = [
        [padding, padding],
        [width - padding, padding],
        [width - padding, height - padding],
        [padding, height - padding]
      ]

      // Fewer solver iterations for large scenes: with hundreds of cells the
      // layout converges visually long before the iteration cap is reached.
      const cellCount = hierarchy.descendants().length
      const iterations = cellCount > 500 ? 25 : 40

      const treemap = voronoiTreemap()
        .clip(clip)
        .maxIterationCount(iterations)
        .convergenceRatio(0.15)

      this.applyVoronoi(hierarchy, clip, 0, treemap)

      // Save new polygons to cache
      this.savePolygonsToCache(hierarchy)
      
      // Update cache with new dimensions
      this.cache.set(cacheKey, {
        path: cacheKey,
        hierarchyData,
        timestamp: Date.now(),
        width, // Save current width
        height // Save current height
      })

      const totalEnd = performance.now()
      console.log(`[VoronoiComputer] Computation took ${(totalEnd - perfStart).toFixed(2)}ms`)
    }

    const allNodes = hierarchy.descendants().filter(d =>
      d.depth > 0 && isValidPolygon((d as any).polygon)
    )

    const topLevelNodes = allNodes.filter(d => d.depth === 1)
    const previewNodes = allNodes.filter(d => d.depth === 2)

    return {
      hierarchy,
      allNodes,
      topLevelNodes,
      previewNodes
    }
  }
}