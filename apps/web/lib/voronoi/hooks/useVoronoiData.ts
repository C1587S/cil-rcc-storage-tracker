import { useState, useEffect, useCallback, useRef } from 'react'
import { useVoronoiNode, type VoronoiNodeExtended } from './useVoronoiNode'
import { type VoronoiNode } from '@/lib/voronoi-data-adapter'

/**
 * Options for useVoronoiData hook
 */
interface UseVoronoiDataOptions {
  selectedSnapshot: string | null
  effectivePath: string
}

/**
 * In-memory cache for loaded nodes
 * Key: node_id -> VoronoiNodeExtended
 */
type NodeCache = Map<string, VoronoiNodeExtended>

/**
 * React hook for voronoi tree loading with ClickHouse backend.
 *
 * ARCHITECTURE:
 * - Matches on-the-fly behavior by pre-loading preview depth (0, 1, 2)
 * - Uses batch API endpoint to reduce HTTP requests
 * - Maintains in-memory cache of loaded nodes
 * - Supports infinite drill-down by lazy-loading on navigation
 *
 * BEHAVIOR:
 * 1. Fetches root node on mount
 * 2. Eagerly expands to preview depth 2 (root + children + grandchildren)
 * 3. Caches all loaded nodes
 * 4. Returns current visible tree based on effectivePath
 * 5. On navigation, fetches target node and expands to preview depth
 *
 * @param options - Configuration options
 * @returns Query result with data, loading states, and error
 */
export function useVoronoiData({ selectedSnapshot, effectivePath }: UseVoronoiDataOptions) {
  // In-memory node cache (persistent across renders)
  const nodeCacheRef = useRef<NodeCache>(new Map())

  // Current visible root based on effectivePath
  const [visibleRoot, setVisibleRoot] = useState<VoronoiNode | null>(null)
  const [isLoadingPath, setIsLoadingPath] = useState(false)

  // Fetch root node
  const {
    node: rootNode,
    isLoading: isLoadingRoot,
    isFetching: isFetchingRoot,
    error: rootError,
  } = useVoronoiNode(selectedSnapshot, 'root', Boolean(selectedSnapshot))

  /**
   * Add node to cache
   */
  const cacheNode = useCallback((node: VoronoiNodeExtended) => {
    if (node.id) {
      nodeCacheRef.current.set(node.id, node)
    }
  }, [])

  /**
   * Get node from cache
   */
  const getCachedNode = useCallback((nodeId: string): VoronoiNodeExtended | undefined => {
    return nodeCacheRef.current.get(nodeId)
  }, [])

  /**
   * Batch fetch multiple nodes from API
   */
  const fetchNodesBatch = useCallback(
    async (nodeIds: string[]): Promise<Map<string, VoronoiNodeExtended>> => {
      if (nodeIds.length === 0) {
        return new Map()
      }

      const response = await fetch(
        `/api/voronoi/node/${selectedSnapshot}/batch?node_ids=${nodeIds.join(',')}`
      )

      if (!response.ok) {
        throw new Error(`Batch fetch failed: ${response.statusText}`)
      }

      const data = await response.json()
      const results = new Map<string, VoronoiNodeExtended>()

      for (const [nodeId, nodeData] of Object.entries(data)) {
        const node: VoronoiNodeExtended = {
          id: (nodeData as any).node_id,
          name: (nodeData as any).name,
          path: (nodeData as any).path,
          size: (nodeData as any).size,
          depth: (nodeData as any).depth,
          isDirectory: Boolean((nodeData as any).is_directory),
          is_directory: Boolean((nodeData as any).is_directory),
          isSynthetic: Boolean((nodeData as any).is_synthetic),
          file_count: (nodeData as any).file_count ?? 0,
          childrenIds: (nodeData as any).children_ids || [],
          children: undefined,
          originalFiles: (nodeData as any).original_files?.map((f: any) => ({
            name: f.name,
            path: f.path,
            size: f.size,
            depth: (nodeData as any).depth + 1,
            isDirectory: false,
            is_directory: false,
            file_count: 0,
            children: [],
          })),
        }

        results.set(nodeId, node)
        cacheNode(node)
      }

      return results
    },
    [selectedSnapshot, cacheNode]
  )

  /**
   * Helper: Fetch nodes depth by depth (fallback method)
   */
  const expandDepthByDepth = useCallback(
    async (node: VoronoiNodeExtended, targetDepth: number): Promise<void> => {
      for (let currentDepth = 1; currentDepth <= targetDepth; currentDepth++) {
        const nodesToFetch: string[] = []

        if (currentDepth === 1) {
          for (const id of node.childrenIds || []) {
            if (!getCachedNode(id)) {
              nodesToFetch.push(id)
            }
          }
        } else {
          const previousDepthNodes = Array.from(nodeCacheRef.current.values())
            .filter(n => n.path.startsWith(node.path) && n.isDirectory)

          for (const parentNode of previousDepthNodes) {
            if (parentNode.childrenIds && parentNode.childrenIds.length > 0) {
              for (const id of parentNode.childrenIds) {
                if (!getCachedNode(id)) {
                  nodesToFetch.push(id)
                }
              }
            }
          }
        }

        if (nodesToFetch.length > 0) {
          await fetchNodesBatch(nodesToFetch)
        }
      }
    },
    [getCachedNode, fetchNodesBatch]
  )

  /**
   * Expand node tree to preview depth using optimized subtree fetching.
   * This matches the on-the-fly behavior where preview depth is eagerly loaded.
   *
   * @param node - Root node to expand from
   * @param targetDepth - How many levels deep to expand (default 2)
   * @returns Fully expanded tree
   */
  const expandToPreviewDepth = useCallback(
    async (node: VoronoiNodeExtended, targetDepth: number = 2): Promise<VoronoiNode> => {
      // No children IDs - return as leaf
      if (!node.childrenIds || node.childrenIds.length === 0) {
        return { ...node, children: [] } as VoronoiNode
      }

      console.log('[expandToPreviewDepth] Starting expansion:', {
        rootPath: node.path,
        targetDepth,
        initialChildren: node.childrenIds.length
      })

      // CACHE CHECK: See if we already have all nodes up to targetDepth
      const checkCacheComplete = (n: VoronoiNodeExtended, currentDepth: number): boolean => {
        if (currentDepth >= targetDepth) return true
        if (!n.childrenIds || n.childrenIds.length === 0) return true

        // Check if all children are cached
        for (const childId of n.childrenIds) {
          const child = getCachedNode(childId)
          if (!child) return false
          // Recursively check grandchildren if we haven't reached target depth
          if (currentDepth + 1 < targetDepth && child.isDirectory) {
            if (!checkCacheComplete(child, currentDepth + 1)) return false
          }
        }
        return true
      }

      const cacheComplete = checkCacheComplete(node, 0)

      if (cacheComplete) {
        console.log('[expandToPreviewDepth] ✅ CACHE HIT - all nodes already loaded, skipping fetch')
      } else {
        console.log('[expandToPreviewDepth] ⚠️ CACHE MISS - fetching missing nodes')
      }

      // OPTIMIZED: Fetch entire subtree in ONE request (only if cache incomplete)
      if (!cacheComplete) {
        try {
          const subtreeUrl = `/api/voronoi/node/${selectedSnapshot}/subtree?path=${encodeURIComponent(node.path)}&max_depth=${targetDepth}`
          console.log('[expandToPreviewDepth] Fetching subtree:', {
            url: subtreeUrl,
            nodePath: node.path,
            targetDepth
          })

          const response = await fetch(subtreeUrl)

          console.log('[expandToPreviewDepth] Subtree response:', {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok
          })

          if (response.ok) {
            const data = await response.json()

            // Cache all fetched nodes
            for (const nodeData of Object.values(data)) {
              const cachedNode: VoronoiNodeExtended = {
                id: (nodeData as any).node_id,
                name: (nodeData as any).name,
                path: (nodeData as any).path,
                size: (nodeData as any).size,
                depth: (nodeData as any).depth,
                isDirectory: Boolean((nodeData as any).is_directory),
                is_directory: Boolean((nodeData as any).is_directory),
                isSynthetic: Boolean((nodeData as any).is_synthetic),
                file_count: (nodeData as any).file_count ?? 0,
                childrenIds: (nodeData as any).children_ids || [],
                children: undefined,
                originalFiles: (nodeData as any).original_files?.map((f: any) => ({
                  name: f.name,
                  path: f.path,
                  size: f.size,
                  depth: (nodeData as any).depth + 1,
                  isDirectory: false,
                  is_directory: false,
                  file_count: 0,
                  children: [],
                })),
              }
              cacheNode(cachedNode)
            }

            console.log('[expandToPreviewDepth] Subtree fetch complete:', {
              nodesFetched: Object.keys(data).length,
              totalCached: nodeCacheRef.current.size
            })
          } else {
            const errorText = await response.text()
            console.error('[expandToPreviewDepth] Subtree fetch failed:', {
              status: response.status,
              statusText: response.statusText,
              error: errorText
            })
            console.warn('[expandToPreviewDepth] Falling back to depth-by-depth')
            await expandDepthByDepth(node, targetDepth)
          }
        } catch (error) {
          console.error('[expandToPreviewDepth] Subtree fetch exception:', error)
          console.warn('[expandToPreviewDepth] Falling back to depth-by-depth')
          await expandDepthByDepth(node, targetDepth)
        }
      }

      // Now recursively build the tree structure from cached nodes
      const buildTree = (currentNode: VoronoiNodeExtended, currentDepth: number): VoronoiNode => {
        console.log(`[buildTree] Building node at depth ${currentDepth}:`, {
          path: currentNode.path,
          childrenIdsCount: currentNode.childrenIds?.length || 0,
          isDirectory: currentNode.isDirectory
        })

        if (!currentNode.childrenIds || currentNode.childrenIds.length === 0) {
          return { ...currentNode, children: [] } as VoronoiNode
        }

        const children: VoronoiNode[] = currentNode.childrenIds
          .map(id => getCachedNode(id))
          .filter((child): child is VoronoiNodeExtended => child !== undefined)
          .map(child => {
            // Recursively expand directories up to ONE level BEFORE targetDepth
            // This allows depth-1 nodes to have their children (depth-2) populated for preview
            if (currentDepth + 1 < targetDepth && child.isDirectory) {
              console.log(`[buildTree] Recursing into ${child.path} (depth ${currentDepth + 1} < ${targetDepth})`)
              return buildTree(child, currentDepth + 1)
            }

            // At the preview depth boundary (currentDepth + 1 === targetDepth)
            // We're at depth-1, and child will be depth-2 (the preview layer)
            // Include child's children for preview rendering
            if (currentDepth + 1 === targetDepth && child.isDirectory && child.childrenIds && child.childrenIds.length > 0) {
              console.log(`[buildTree] Preview boundary for ${child.path}: adding ${child.childrenIds.length} preview children`)
              const previewChildren: VoronoiNode[] = child.childrenIds
                .map(childId => getCachedNode(childId))
                .filter((c): c is VoronoiNodeExtended => c !== undefined)
                .map(c => ({ ...c, children: [] } as VoronoiNode))

              console.log(`[buildTree] Preview children paths:`, previewChildren.slice(0, 3).map(c => c.path))
              return { ...child, children: previewChildren } as VoronoiNode
            }

            // Regular leaf node (no children)
            console.log(`[buildTree] Leaf node: ${child.path}`)
            return { ...child, children: [] } as VoronoiNode
          })

        console.log(`[buildTree] Built ${children.length} children for ${currentNode.path}`)
        return { ...currentNode, children } as VoronoiNode
      }

      const result = buildTree(node, 0)

      console.log('[expandToPreviewDepth] Final result:', {
        rootPath: result.path,
        rootChildCount: result.children?.length || 0,
        firstChildPath: result.children?.[0]?.path,
        firstChildHasChildren: result.children?.[0]?.children !== undefined,
        firstChildChildCount: result.children?.[0]?.children?.length || 0,
        firstGrandchildPath: result.children?.[0]?.children?.[0]?.path
      })

      return result
    },
    [getCachedNode, expandDepthByDepth, selectedSnapshot, cacheNode]
  )

  /**
   * Navigate to a specific path by fetching the node directly from the backend.
   *
   * FIXED: Instead of tree traversal (which fails with incremental loading),
   * we directly fetch the target node by path. This ensures correct navigation.
   */
  const navigateToPath = useCallback(
    async (targetPath: string, root: VoronoiNode): Promise<VoronoiNodeExtended> => {
      // If already at target, return root as unexpanded node
      if (root.path === targetPath) {
        // Return as VoronoiNodeExtended (without expanded children)
        return {
          ...root,
          children: undefined
        } as VoronoiNodeExtended
      }

      // Check cache first - return unexpanded version
      const cachedNodes = Array.from(nodeCacheRef.current.values())
      const cachedNode = cachedNodes.find(n => n.path === targetPath)
      if (cachedNode) {
        // Always return unexpanded so expandToPreviewDepth handles expansion
        return cachedNode
      }

      // Fetch directly by path from backend
      try {
        const response = await fetch(
          `/api/voronoi/node/${selectedSnapshot}/by-path?path=${encodeURIComponent(targetPath)}`
        )

        if (!response.ok) {
          console.error(`[useVoronoiData] Failed to fetch node at path ${targetPath}`)
          return root
        }

        const data = await response.json()
        const node: VoronoiNodeExtended = {
          id: data.node_id,
          name: data.name,
          path: data.path,
          size: data.size,
          depth: data.depth,
          isDirectory: Boolean(data.is_directory),
          is_directory: Boolean(data.is_directory),
          isSynthetic: Boolean(data.is_synthetic),
          file_count: data.file_count ?? 0,
          childrenIds: data.children_ids || [],
          children: undefined, // Not expanded yet
          originalFiles: data.original_files?.map((f: any) => ({
            name: f.name,
            path: f.path,
            size: f.size,
            depth: data.depth + 1,
            isDirectory: false,
            is_directory: false,
            file_count: 0,
            children: [],
          })),
        }

        cacheNode(node)
        return node as VoronoiNode
      } catch (error) {
        console.error('[useVoronoiData] Error fetching node by path:', error)
        return root
      }
    },
    [selectedSnapshot, cacheNode]
  )

  // Cache root node when loaded
  useEffect(() => {
    if (rootNode) {
      cacheNode(rootNode)
    }
  }, [rootNode, cacheNode])

  // Navigate to effectivePath and expand to preview depth
  useEffect(() => {
    if (!rootNode || !selectedSnapshot) {
      setVisibleRoot(null)
      return
    }

    const loadPath = async () => {
      try {
        setIsLoadingPath(true)

        let targetNode: VoronoiNodeExtended

        // If at root path, use root node
        if (effectivePath === rootNode.path || effectivePath === '/project/cil') {
          targetNode = rootNode
        } else {
          // Navigate to deeper path
          targetNode = await navigateToPath(effectivePath, rootNode)
        }

        // Expand to preview depth (matching on-the-fly behavior)
        const expandedTree = await expandToPreviewDepth(targetNode, 2)

        // Debug: Log full tree structure
        const debugTree = (node: VoronoiNode, depth: number = 0): any => {
          return {
            path: node.path,
            depth,
            hasChildren: node.children !== undefined,
            childCount: node.children?.length || 0,
            children: node.children?.slice(0, 3).map(c => debugTree(c, depth + 1))
          }
        }

        console.log('[useVoronoiData] Loaded tree for path:', effectivePath, debugTree(expandedTree))
        setVisibleRoot(expandedTree)
      } catch (error) {
        console.error('[useVoronoiData] Failed to load path:', error)
        // Fallback to root
        try {
          const expandedRoot = await expandToPreviewDepth(rootNode, 2)
          setVisibleRoot(expandedRoot)
        } catch (fallbackError) {
          console.error('[useVoronoiData] Fallback failed:', fallbackError)
          setVisibleRoot(null)
        }
      } finally {
        setIsLoadingPath(false)
      }
    }

    loadPath()
  }, [rootNode, effectivePath, selectedSnapshot, expandToPreviewDepth, navigateToPath])

  // Clear cache when snapshot changes
  useEffect(() => {
    nodeCacheRef.current.clear()
    setVisibleRoot(null)
  }, [selectedSnapshot])

  return {
    data: visibleRoot,
    isLoading: isLoadingRoot || isLoadingPath,
    isFetching: isFetchingRoot,
    error: rootError,
  }
}
