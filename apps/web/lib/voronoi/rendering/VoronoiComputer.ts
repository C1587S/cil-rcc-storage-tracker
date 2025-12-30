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
   * Groups files into synthetic "__files__" nodes.
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
    const dirs = (n.children || []).filter(c => c.isDirectory)
    const filesFromChildren = (n.children || []).filter(c => !c.isDirectory)
    const filesFromOriginal = n.originalFiles || [] 
    const allFiles = [...filesFromChildren, ...filesFromOriginal] 

    // Recursively process directory children
    const children = dirs.map(d => this.prepareHierarchy(d, depth + 1))

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
   * Computes or retrieves cached voronoi hierarchy.
   */
  compute(
    data: VoronoiNode,
    effectivePath: string,
    width: number,
    height: number
  ): ComputedVoronoiResult {
    const cacheKey = effectivePath
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

    if (cached && dimensionsMatch && cached.hierarchyData) {
      // --- CACHE HIT (EXACT MATCH) ---
      console.log(`[VoronoiComputer] Cache HIT. Dimensions exact: ${width}x${height}`)
      
      const hierarchyData = cached.hierarchyData
      hierarchy = d3.hierarchy(hierarchyData)
        .sum(d => (!d.children || d.children.length === 0) ? Math.max(d.size || 1, 1) : 0)
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
      }

      hierarchy = d3.hierarchy(hierarchyData)
        .sum(d => {
          const isLeaf = !d.children || d.children.length === 0
          return isLeaf ? Math.max(d.size || 1, 1) : 0
        })
        .sort((a, b) => (b.value || 0) - (a.value || 0))

      // Define the clipping polygon to match the FULL container size
      const padding = 0 
      const clip: [number, number][] = [
        [padding, padding],
        [width - padding, padding],
        [width - padding, height - padding],
        [padding, height - padding]
      ]

      const treemap = voronoiTreemap()
        .clip(clip)
        .maxIterationCount(40) // Good balance for performance/quality
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