import { getBrowse, getContents } from "./api";

export interface VoronoiNode {
  name: string;
  size: number;
  path: string;
  children?: VoronoiNode[];
  isDirectory: boolean;
  is_directory?: boolean; // Alias for backward compatibility
  file_count?: number;
  depth?: number;
}

/**
 * Build a hierarchical tree for Voronoi visualization from flat browse/contents API.
 *
 * CRITICAL: No hard depth limit - user can drill down infinitely.
 *
 * Performance guardrails:
 * - previewDepth: Initial preview depth (default 2 for performance)
 * - maxNodes: Hard cap on total nodes per level (default 500, max safe value)
 *
 * Data semantics:
 * - Uses recursive_size from /api/browse for accurate directory sizes
 * - Falls back to size if recursive_size unavailable
 * - Fetches BOTH folders and files at every level
 */
export async function buildVoronoiTree(
  snapshotDate: string,
  path: string,
  previewDepth: number = 2,
  maxNodes: number = 500
): Promise<VoronoiNode> {
  // Fetch root directory folders (ONLY folders from /api/browse)
  const browseResult = await getBrowse({
    snapshot_date: snapshotDate,
    parent_path: path,
    limit: 1000,
  });

  // Sort by recursive_size (descending) and take top N
  const sortedFolders = browseResult.folders
    .map(folder => ({
      ...folder,
      effectiveSize: folder.recursive_size || folder.size || 0,
    }))
    .sort((a, b) => b.effectiveSize - a.effectiveSize)
    .slice(0, maxNodes);

  // Build children recursively up to preview depth
  const children: VoronoiNode[] = await Promise.all(
    sortedFolders.map(async (folder) => {
      const node: VoronoiNode = {
        name: folder.name,
        size: folder.effectiveSize,
        path: folder.path,
        isDirectory: true,
        is_directory: true, // Compatibility with legacy
        file_count: folder.file_count,
        depth: 1,
      };

      // Recursively fetch children if within preview depth
      if (previewDepth > 1) {
        try {
          const childNodes = await fetchChildren(
            snapshotDate,
            folder.path,
            2, // Current depth for children
            previewDepth,
            Math.floor(maxNodes / sortedFolders.length) // Distribute node budget
          );
          if (childNodes.length > 0) {
            node.children = childNodes;
          }
        } catch (error) {
          // Continue without children on error
        }
      }

      return node;
    })
  );

  // CRITICAL FIX: Also fetch files at root level
  let rootFiles: VoronoiNode[] = [];
  try {
    const contentsResult = await getContents({
      snapshot_date: snapshotDate,
      parent_path: path,
      limit: 100,
      sort: "size_desc",
    });

    rootFiles = contentsResult.entries
      .filter(entry => !entry.is_directory) // ONLY files, no directories
      .slice(0, 50) // Top 50 files
      .map(file => ({
        name: file.name,
        size: file.size,
        path: file.path,
        isDirectory: false,
        is_directory: false,
        depth: 1,
      }));
  } catch (error) {
    // Continue without root files on error
  }

  // Calculate root size (sum of all children)
  const totalSize = [...children, ...rootFiles].reduce((sum, child) => sum + child.size, 0);

  // Build root node
  const rootName = path === "/" ? "root" : path.split("/").filter(Boolean).pop() || "root";
  const rootNode: VoronoiNode = {
    name: rootName,
    size: totalSize,
    path: path,
    isDirectory: true,
    is_directory: true,
    children: [...children, ...rootFiles].filter(child => child.size > 0), // CRITICAL: Include files
    file_count: browseResult.total_count,
    depth: 0,
  };

  return rootNode;
}

/**
 * Recursively fetch children for a directory (for initial preview build).
 *
 * CRITICAL: This is ONLY used for initial preview rendering.
 * When user clicks to drill down, we fetch fresh data on-demand (no depth limit).
 *
 * Includes both subdirectories and files at every level.
 */
async function fetchChildren(
  snapshotDate: string,
  parentPath: string,
  currentDepth: number,
  previewDepth: number,
  nodeBudget: number
): Promise<VoronoiNode[]> {
  const children: VoronoiNode[] = [];

  // Fetch subdirectories (ONLY folders, guaranteed by /api/browse)
  const browseResult = await getBrowse({
    snapshot_date: snapshotDate,
    parent_path: parentPath,
    limit: 1000,
  });

  // Sort by size and limit
  const topFolders = browseResult.folders
    .map(folder => ({
      ...folder,
      effectiveSize: folder.recursive_size || folder.size || 0,
    }))
    .sort((a, b) => b.effectiveSize - a.effectiveSize)
    .slice(0, Math.max(10, Math.floor(nodeBudget / 2))); // At least 10, up to half the budget

  // Add subdirectories
  for (const folder of topFolders) {
    const node: VoronoiNode = {
      name: folder.name,
      size: folder.effectiveSize,
      path: folder.path,
      isDirectory: true,
      is_directory: true,
      file_count: folder.file_count,
      depth: currentDepth,
    };

    // Recurse if we haven't hit preview depth
    if (currentDepth < previewDepth) {
      try {
        const grandchildren = await fetchChildren(
          snapshotDate,
          folder.path,
          currentDepth + 1,
          previewDepth,
          Math.floor(nodeBudget / topFolders.length)
        );
        if (grandchildren.length > 0) {
          node.children = grandchildren;
        }
      } catch (error) {
        // Continue without grandchildren on error
      }
    }
    // CRITICAL: Do NOT add files as children here at preview depth
    // Files will be fetched separately below for the current directory

    children.push(node);
  }

  // CRITICAL FIX: Fetch files at THIS directory level (not nested inside folders)
  // This ensures files appear as siblings to folders, not as children of folders
  try {
    const contentsResult = await getContents({
      snapshot_date: snapshotDate,
      parent_path: parentPath,
      limit: Math.max(50, Math.floor(nodeBudget / 2)), // At least 50 files
      sort: "size_desc",
    });

    const files = contentsResult.entries
      .filter(entry => !entry.is_directory) // CRITICAL: ONLY files, exclude directories
      .slice(0, 50) // Top 50 largest files
      .map(file => ({
        name: file.name,
        size: file.size,
        path: file.path,
        isDirectory: false,
        is_directory: false,
        depth: currentDepth,
      }));

    children.push(...files);
  } catch (error) {
    // Continue without files on error
  }

  return children.filter(child => child.size > 0);
}
