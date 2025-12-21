import { getBrowse, getContents } from "./api";

export interface VoronoiNode {
  name: string;
  size: number;
  path: string;
  children?: VoronoiNode[];
  isDirectory: boolean;
  is_directory?: boolean; // For compatibility with legacy component
  file_count?: number;
  depth?: number;
}

/**
 * Build a hierarchical tree for Voronoi visualization from flat browse/contents API.
 *
 * Performance guardrails:
 * - maxDepth: Limit tree depth (default 2, recommended 1-3)
 * - maxNodes: Hard cap on total nodes (default 500, max safe value)
 *
 * Data semantics:
 * - Uses recursive_size from /api/browse for accurate directory sizes
 * - Falls back to size if recursive_size unavailable
 * - Fetches files from /api/contents at leaf level
 */
export async function buildVoronoiTree(
  snapshotDate: string,
  path: string,
  maxDepth: number = 2,
  maxNodes: number = 500
): Promise<VoronoiNode> {
  console.log(`[buildVoronoiTree] Starting build for path="${path}", maxDepth=${maxDepth}, maxNodes=${maxNodes}`);

  // Fetch root directory folders
  const browseResult = await getBrowse({
    snapshot_date: snapshotDate,
    parent_path: path,
    limit: 1000,
  });

  console.log(`[buildVoronoiTree] Fetched ${browseResult.folders.length} folders from browse API`);

  // Sort by recursive_size (descending) and take top N
  const sortedFolders = browseResult.folders
    .map(folder => ({
      ...folder,
      effectiveSize: folder.recursive_size || folder.size || 0,
    }))
    .sort((a, b) => b.effectiveSize - a.effectiveSize)
    .slice(0, maxNodes);

  console.log(`[buildVoronoiTree] Top ${sortedFolders.length} folders by size (after limiting to ${maxNodes})`);

  // Build children recursively if maxDepth > 1
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

      // Recursively fetch children if within depth limit
      if (maxDepth > 1) {
        try {
          const childNodes = await fetchChildren(
            snapshotDate,
            folder.path,
            2, // Current depth for children
            maxDepth,
            Math.floor(maxNodes / sortedFolders.length) // Distribute node budget
          );
          if (childNodes.length > 0) {
            node.children = childNodes;
          }
        } catch (error) {
          console.warn(`[buildVoronoiTree] Failed to fetch children for ${folder.path}:`, error);
          // Continue without children
        }
      }

      return node;
    })
  );

  // Calculate root size (sum of all children)
  const totalSize = children.reduce((sum, child) => sum + child.size, 0);

  // Build root node
  const rootName = path === "/" ? "root" : path.split("/").filter(Boolean).pop() || "root";
  const rootNode: VoronoiNode = {
    name: rootName,
    size: totalSize,
    path: path,
    isDirectory: true,
    is_directory: true,
    children: children.filter(child => child.size > 0), // Filter out zero-size nodes
    file_count: browseResult.total_folders + browseResult.total_files,
    depth: 0,
  };

  console.log(`[buildVoronoiTree] Built root node with ${rootNode.children?.length || 0} children, total size: ${totalSize}`);

  return rootNode;
}

/**
 * Recursively fetch children for a directory.
 * Includes both subdirectories and files at the leaf level.
 */
async function fetchChildren(
  snapshotDate: string,
  parentPath: string,
  currentDepth: number,
  maxDepth: number,
  nodeBudget: number
): Promise<VoronoiNode[]> {
  console.log(`[fetchChildren] path="${parentPath}", depth=${currentDepth}, budget=${nodeBudget}`);

  const children: VoronoiNode[] = [];

  // Fetch subdirectories
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

  console.log(`[fetchChildren] Found ${topFolders.length} subdirectories at depth ${currentDepth}`);

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

    // Recurse if we haven't hit max depth
    if (currentDepth < maxDepth) {
      try {
        const grandchildren = await fetchChildren(
          snapshotDate,
          folder.path,
          currentDepth + 1,
          maxDepth,
          Math.floor(nodeBudget / topFolders.length)
        );
        if (grandchildren.length > 0) {
          node.children = grandchildren;
        }
      } catch (error) {
        console.warn(`[fetchChildren] Failed to fetch grandchildren for ${folder.path}:`, error);
      }
    }

    children.push(node);
  }

  // If at max depth, also fetch files
  if (currentDepth === maxDepth) {
    try {
      const contentsResult = await getContents({
        snapshot_date: snapshotDate,
        parent_path: parentPath,
        limit: Math.max(20, Math.floor(nodeBudget / 2)), // At least 20 files, up to half the budget
        sort: "size_desc",
      });

      const files = contentsResult.entries
        .filter(entry => !entry.is_directory)
        .slice(0, Math.floor(nodeBudget / 2))
        .map(file => ({
          name: file.name,
          size: file.size,
          path: file.path,
          isDirectory: false,
          is_directory: false,
          depth: currentDepth,
        }));

      console.log(`[fetchChildren] Added ${files.length} files at depth ${currentDepth}`);
      children.push(...files);
    } catch (error) {
      console.warn(`[fetchChildren] Failed to fetch files for ${parentPath}:`, error);
    }
  }

  return children.filter(child => child.size > 0);
}
