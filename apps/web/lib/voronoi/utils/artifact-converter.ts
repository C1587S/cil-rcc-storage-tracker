/**
 * Utility to convert backend voronoi artifacts to frontend VoronoiNode format.
 *
 * Backend artifacts use a flat node structure with ID-based references,
 * while the frontend expects a nested tree structure.
 */

import { type VoronoiNode } from '@/lib/voronoi-data-adapter'

/**
 * Backend artifact structure returned from /api/voronoi/artifact/{date}
 */
interface VoronoiArtifact {
  version: string
  snapshot: {
    date: string
    path: string
    size: number
    file_count: number
  }
  computed_at: string
  hierarchy: {
    root_node_id: string
    nodes: Record<
      string,
      {
        id: string
        name: string
        path: string
        size: number
        isDirectory: boolean
        depth: number
        children?: string[] | null
        file_count?: number | null
        isSynthetic?: boolean
        originalFiles?: Array<{
          name: string
          path: string
          size: number
          isDirectory: boolean
        }> | null
      }
    >
    metadata: {
      total_nodes: number
      max_depth: number
      top_level_count: number
    }
  }
}

/**
 * Convert backend artifact to frontend VoronoiNode tree structure.
 *
 * This function:
 * 1. Finds the node matching the requested path (or root)
 * 2. Recursively reconstructs the tree by resolving child ID references
 * 3. Handles synthetic __files__ nodes specially
 *
 * @param artifact - Backend artifact JSON
 * @param targetPath - Path to start from (defaults to artifact root)
 * @returns VoronoiNode tree ready for rendering
 */
export function convertArtifactToVoronoiNode(
  artifact: VoronoiArtifact,
  targetPath?: string
): VoronoiNode {
  const { hierarchy } = artifact
  const { root_node_id, nodes } = hierarchy

  // Find the node to start from
  const startNodeId = targetPath ? findNodeIdByPath(nodes, targetPath) : root_node_id
  if (!startNodeId) {
    throw new Error(`No node found for path: ${targetPath}`)
  }

  // Recursively build the tree
  return buildNodeTree(nodes, startNodeId)
}

/**
 * Find node ID by path.
 */
function findNodeIdByPath(
  nodes: VoronoiArtifact['hierarchy']['nodes'],
  targetPath: string
): string | null {
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node.path === targetPath) {
      return nodeId
    }
  }
  return null
}

/**
 * Recursively build VoronoiNode tree from flat node structure.
 */
function buildNodeTree(
  nodes: VoronoiArtifact['hierarchy']['nodes'],
  nodeId: string
): VoronoiNode {
  const backendNode = nodes[nodeId]
  if (!backendNode) {
    throw new Error(`Node not found: ${nodeId}`)
  }

  // Handle synthetic __files__ nodes
  if (backendNode.isSynthetic && backendNode.originalFiles) {
    // Convert originalFiles to VoronoiNode children
    const fileChildren: VoronoiNode[] = backendNode.originalFiles.map((file) => ({
      name: file.name,
      path: file.path,
      size: file.size,
      isDirectory: file.isDirectory,
      is_directory: file.isDirectory,
      depth: backendNode.depth + 1,
    }))

    return {
      name: backendNode.name,
      path: backendNode.path,
      size: backendNode.size,
      isDirectory: false, // Synthetic nodes are treated as leaf nodes
      is_directory: false,
      depth: backendNode.depth,
      file_count: backendNode.file_count || undefined,
      children: fileChildren,
    }
  }

  // Regular directory node
  const voronoiNode: VoronoiNode = {
    name: backendNode.name,
    path: backendNode.path,
    size: backendNode.size,
    isDirectory: backendNode.isDirectory,
    is_directory: backendNode.isDirectory,
    depth: backendNode.depth,
    file_count: backendNode.file_count || undefined,
  }

  // Recursively build children if they exist
  if (backendNode.children && backendNode.children.length > 0) {
    voronoiNode.children = backendNode.children.map((childId) => buildNodeTree(nodes, childId))
  }

  return voronoiNode
}
