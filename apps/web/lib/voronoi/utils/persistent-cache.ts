import { type VoronoiCacheEntry } from './types'

/**
 * IndexedDB persistence for computed voronoi layouts.
 *
 * Layout geometry is expensive to compute but immutable for a given
 * (snapshot, path). Persisting it means a revisit -- even after a browser
 * restart -- renders instantly. Entries from older snapshots are pruned
 * on load since the dashboard keeps only the latest snapshot.
 */

const DB_NAME = 'voronoi-cache'
const STORE = 'layouts'
const KEY_SEP = '::'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Deep-copies hierarchy data, reducing cached polygons to plain point arrays.
 * The treemap library attaches extra properties (sites, weights) to polygon
 * arrays that may not survive structured cloning.
 */
function sanitizeHierarchy(node: any): any {
  const out: any = {}
  for (const key of Object.keys(node)) {
    if (key === 'cachedPolygon') {
      const poly = node.cachedPolygon
      out.cachedPolygon = Array.isArray(poly)
        ? poly.map((p: any) => [p[0], p[1]])
        : undefined
    } else if (key === 'children') {
      out.children = (node.children || []).map((c: any) => sanitizeHierarchy(c))
    } else {
      out[key] = node[key]
    }
  }
  return out
}

/** Persist one cache entry (fire-and-forget; failures are non-fatal). */
export async function persistLayout(
  snapshot: string,
  entry: VoronoiCacheEntry
): Promise<void> {
  try {
    const db = await openDb()
    const record = {
      path: entry.path,
      hierarchyData: sanitizeHierarchy(entry.hierarchyData),
      timestamp: entry.timestamp,
      width: entry.width,
      height: entry.height,
    }
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(record, `${snapshot}${KEY_SEP}${entry.path}`)
    db.close()
  } catch {
    // Persistence is best-effort; the in-memory cache still works
  }
}

/**
 * Load all persisted layouts for a snapshot into a Map keyed by path.
 * Prunes entries belonging to other (older) snapshots.
 */
export async function loadPersistedLayouts(
  snapshot: string
): Promise<Map<string, VoronoiCacheEntry>> {
  const result = new Map<string, VoronoiCacheEntry>()
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    await new Promise<void>((resolve, reject) => {
      const cursorReq = store.openCursor()
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (!cursor) return resolve()
        const key = String(cursor.key)
        if (key.startsWith(`${snapshot}${KEY_SEP}`)) {
          const entry = cursor.value as VoronoiCacheEntry
          result.set(entry.path, entry)
        } else {
          cursor.delete() // stale snapshot
        }
        cursor.continue()
      }
      cursorReq.onerror = () => reject(cursorReq.error)
    })
    db.close()
  } catch {
    // No persistence available (private mode, quota, etc.)
  }
  return result
}
