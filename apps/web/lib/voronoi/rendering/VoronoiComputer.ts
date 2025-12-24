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
 * Separates directories and files into hierarchical structure,
 * applies recursive voronoi computation up to depth 2.
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
    if (!n.children || n.children.length === 0) {
      return { ...n, uniqueId, depth }
    }

    const dirs = n.children.filter(c => c.isDirectory)
    const files = n.children.filter(c => !c.isDirectory)
    const children = dirs.map(d => this.prepareHierarchy(d, depth + 1))

    if (files.length > 0) {
      const filesSize = files.reduce((acc, f) => acc + f.size, 0)
      children.push({
        name: '__files__',
        path: `${n.path}/__files__`,
        size: filesSize,
        isDirectory: false,
        isSynthetic: true,
        originalFiles: files,
        file_count: files.length,
        depth: depth + 1,
        uniqueId: `files-${Math.random().toString(36).substr(2, 9)}`
      })
    }

    return { ...n, children, uniqueId, depth }
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
   * Computes or retrieves cached voronoi hierarchy
   *
   * @param data - The hierarchical data to compute voronoi for
   * @param effectivePath - Current path (used as cache key)
   * @param width - SVG container width
   * @param height - SVG container height
   * @returns Computed hierarchy with all nodes at different depths
   */
  compute(
    data: VoronoiNode,
    effectivePath: string,
    width: number,
    height: number
  ): ComputedVoronoiResult {
    const cacheKey = effectivePath
    const cached = this.cache.get(cacheKey)

    let hierarchyData: any
    let hierarchy: d3.HierarchyNode<any>

    if (cached?.hierarchyData) {
      // Use cached data
      hierarchyData = cached.hierarchyData
      hierarchy = d3.hierarchy(hierarchyData)
        .sum(d => (!d.children || d.children.length === 0) ? Math.max(d.size || 1, 1) : 0)
        .sort((a, b) => (b.value || 0) - (a.value || 0))

      this.restorePolygonsFromCache(hierarchy)
    } else {
      // Compute fresh
      hierarchyData = this.prepareHierarchy(data)
      hierarchy = d3.hierarchy(hierarchyData)
        .sum(d => (!d.children || d.children.length === 0) ? Math.max(d.size || 1, 1) : 0)
        .sort((a, b) => (b.value || 0) - (a.value || 0))

      const padding = 15
      const clip: [number, number][] = [
        [padding, padding],
        [width - padding, padding],
        [width - padding, height - padding],
        [padding, height - padding]
      ]

      const treemap = voronoiTreemap()
        .clip(clip)
        .maxIterationCount(50)
        .convergenceRatio(0.01)

      this.applyVoronoi(hierarchy, clip, 0, treemap)
      this.savePolygonsToCache(hierarchy)

      // Store in cache
      this.cache.set(cacheKey, {
        path: cacheKey,
        hierarchyData,
        timestamp: Date.now()
      })
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
