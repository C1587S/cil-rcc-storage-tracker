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
   *
   * IMPORTANT: The 'depth' parameter is the RELATIVE depth in the d3 hierarchy,
   * NOT the global ClickHouse depth. We preserve the original paths from data.
   *
   * CRITICAL: Stops recursing at depth 2 (preview boundary). Preview nodes are treated
   * as "logical leaves" even though they represent entire subtrees beneath them.
   */
  private prepareHierarchy(n: VoronoiNode, depth: number = 0): any {
    const uniqueId = `node-${Math.random().toString(36).substr(2, 9)}`

    // CRITICAL: Stop recursing at depth 2 (preview boundary)
    // Preview nodes should be treated as leaves by d3.hierarchy.sum()
    // so their recursive size values are used directly
    if (depth >= 2) {
      return { ...n, uniqueId, depth, hierarchyDepth: depth }
    }

    // Handle leaf nodes (no children)
    if ((!n.children || n.children.length === 0) && (!n.originalFiles || n.originalFiles.length === 0)) {
      // Preserve original path, set relative depth
      return { ...n, uniqueId, depth, hierarchyDepth: depth }
    }

    // Separate directories and files from children (on-the-fly mode)
    const dirs = (n.children || []).filter(c => c.isDirectory)
    const filesFromChildren = (n.children || []).filter(c => !c.isDirectory)

    // Get files from originalFiles property (precomputed mode)
    const filesFromOriginal = n.originalFiles || []

    // Combine both sources of files
    const allFiles = [...filesFromChildren, ...filesFromOriginal]

    // DEBUG: Log detailed info for root level (depth 0)
    if (depth === 0) {
      console.log('🔍 [prepareHierarchy] ROOT LEVEL ANALYSIS:', {
        path: n.path,
        totalChildren: n.children?.length || 0,
        dirCount: dirs.length,
        filesFromChildrenCount: filesFromChildren.length,
        filesFromOriginalCount: filesFromOriginal.length,
        allFilesCount: allFiles.length,
        childrenSample: n.children?.slice(0, 3).map(c => ({
          name: c.name,
          isDirectory: c.isDirectory,
          size: c.size,
          sizeTB: (c.size / (1024**4)).toFixed(2) + ' TB'
        }))
      })
    }

    // Recursively process directory children
    const children = dirs.map(d => this.prepareHierarchy(d, depth + 1))

    // Create synthetic __files__ node if there are any files
    if (allFiles.length > 0) {
      const filesSize = allFiles.reduce((acc, f) => acc + f.size, 0)
      console.log('[prepareHierarchy] Creating __files__ node:', {
        path: n.path,
        filesFromChildren: filesFromChildren.length,
        filesFromOriginal: filesFromOriginal.length,
        totalFiles: allFiles.length,
        fileNames: allFiles.map(f => f.name)
      })
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

    // Preserve original path from n, set relative hierarchy depth
    // CRITICAL: Remove originalFiles and adjust size to avoid double-counting
    // Files are now in the synthetic __files__ child node
    const { originalFiles: _originalFiles, ...nodeWithoutFiles } = n

    // CRITICAL FIX: If we created a synthetic __files__ node, we need to adjust the parent's size
    // The parent's size from API includes all files, but now those files are in a child node
    // So we need to subtract the file sizes to avoid double-counting in d3.hierarchy.sum()
    // However, d3.hierarchy.sum() only counts LEAF nodes, so parent sizes are ignored anyway!
    // We keep the original size for display purposes, but it won't affect the treemap layout

    // DEBUG: Log what we're returning for root level
    if (depth === 0) {
      console.log('🔍 [prepareHierarchy] ROOT LEVEL RESULT:', {
        path: n.path,
        totalChildren: children.length,
        hasSyntheticFiles: children.some(c => c.isSynthetic),
        childrenSample: children.slice(0, 3).map(c => ({
          name: c.name,
          isSynthetic: c.isSynthetic,
          size: c.size,
          sizeTB: (c.size / (1024**4)).toFixed(2) + ' TB',
          hasChildren: !!c.children && c.children.length > 0
        }))
      })
    }

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
    // CRITICAL: Include width and height in cache key so layout recomputes on resize
    const cacheKey = `${effectivePath}:${width}x${height}`
    const cached = this.cache.get(cacheKey)

    console.log('[VoronoiComputer] compute() called:', {
      effectivePath,
      dataPath: data.path,
      dataChildCount: data.children?.length || 0,
      cacheHit: !!cached,
      cacheKey,
      dimensions: `${width}x${height}`
    })

    // CRITICAL: Validate that data matches effectivePath
    // During navigation, React may render with stale data before new data arrives
    // If paths don't match, we MUST recompute to avoid rendering wrong partitions
    const dataMatchesPath = data.path === effectivePath
    if (!dataMatchesPath) {
      console.warn('[VoronoiComputer] DATA MISMATCH! dataPath:', data.path, 'effectivePath:', effectivePath)
      console.warn('[VoronoiComputer] Skipping computation - waiting for correct data')
      // Return empty result to prevent rendering wrong partitions
      return {
        hierarchy: null as any,
        allNodes: [],
        topLevelNodes: [],
        previewNodes: []
      }
    }

    let hierarchyData: any
    let hierarchy: d3.HierarchyNode<any>

    if (cached?.hierarchyData) {
      // Use cached data
      console.log('[VoronoiComputer] Using CACHED hierarchy')
      hierarchyData = cached.hierarchyData
      hierarchy = d3.hierarchy(hierarchyData)
        .sum(d => (!d.children || d.children.length === 0) ? Math.max(d.size || 1, 1) : 0)
        .sort((a, b) => (b.value || 0) - (a.value || 0))

      this.restorePolygonsFromCache(hierarchy)
    } else {
      console.log('[VoronoiComputer] Computing FRESH hierarchy')
      // Compute fresh
      hierarchyData = this.prepareHierarchy(data)

      console.log('[VoronoiComputer] hierarchyData structure:', {
        path: hierarchyData.path,
        childCount: hierarchyData.children?.length || 0,
        childPaths: hierarchyData.children?.slice(0, 5).map((c: any) => ({
          path: c.path,
          name: c.name,
          size: c.size,
          isSynthetic: c.isSynthetic,
          childCount: c.children?.length || 0
        }))
      })

      hierarchy = d3.hierarchy(hierarchyData)
        .sum(d => {
          const isLeaf = !d.children || d.children.length === 0
          const sizeToCount = isLeaf ? Math.max(d.size || 1, 1) : 0
          // Log size calculations for debugging
          if (d.depth <= 2 && sizeToCount > 0) {
            console.log('[VoronoiComputer] .sum() counting leaf:', {
              path: d.path,
              name: d.name,
              size: d.size,
              sizeTB: (d.size / (1024**4)).toFixed(2) + ' TB',
              isSynthetic: d.isSynthetic,
              depth: d.depth
            })
          }
          return sizeToCount
        })
        .sort((a, b) => (b.value || 0) - (a.value || 0))

      // Log final computed values for top-level nodes
      console.log('🔍 [VoronoiComputer] FINAL HIERARCHY VALUES (depth-1 partitions):')
      hierarchy.children?.slice(0, 10).forEach((child: any) => {
        const valueTB = (child.value / (1024**4)).toFixed(2)
        const sizeTB = (child.data.size / (1024**4)).toFixed(2)
        const match = valueTB === sizeTB ? '✅' : '❌'
        console.log(`  ${match} ${child.data.name}: value=${valueTB} TB, size=${sizeTB} TB${valueTB !== sizeTB ? ' ⚠️ MISMATCH!' : ''}`)
      })

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

    // CRITICAL FIX: Use relative depth from hierarchy root, not global ClickHouse depth
    // When viewing /project/cil/gcp, that node is depth=0 in d3 hierarchy
    // Its children are depth=1 (top level partitions)
    // Their children are depth=2 (preview partitions)
    const topLevelNodes = allNodes.filter(d => d.depth === 1)
    const previewNodes = allNodes.filter(d => d.depth === 2)

    console.log('[VoronoiComputer] Computed nodes:', {
      effectivePath,
      totalNodes: allNodes.length,
      topLevelCount: topLevelNodes.length,
      previewCount: previewNodes.length,
      topLevelPaths: topLevelNodes.slice(0, 3).map(d => d.data.path),
      previewPaths: previewNodes.slice(0, 3).map(d => d.data.path),
    })

    return {
      hierarchy,
      allNodes,
      topLevelNodes,
      previewNodes
    }
  }
}
