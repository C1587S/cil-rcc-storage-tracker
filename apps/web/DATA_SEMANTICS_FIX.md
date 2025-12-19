# Data Semantics Fix — V2.1 (Browse-Based Tree)

**Date:** 2025-12-19
**Status:** Fixed - Tree now uses correct data source

## Problem

V2 implementation incorrectly used `/api/contents` as the data source for the directory tree. This caused directory sizes to appear as 4 KiB (filesystem metadata) instead of showing aggregated sizes of children.

## Root Cause

**The two endpoints serve different purposes:**

### `/api/browse` (Folders Only - Aggregated)
- Returns child **folders only**
- Directory `size` field = **sum of immediate child files** (aggregated)
- Example: `/project/cil/gcp` shows `size: 1076757399` (1.00 GiB)
- This is the **correct** data for dutree-style visualization
- Response structure: `{ folders: [...] }`

### `/api/contents` (Files + Folders - Raw)
- Returns **both files and folders**
- Directory `size` field = **filesystem metadata size** (always 4096 bytes)
- Example: `/project/cil/gcp` shows `size: 4096` (4.00 KiB)
- This is correct for detailed file listings but **wrong** for size bars
- Response structure: `{ entries: [...] }`

## The Fix

### Changed Data Source
```typescript
// BEFORE (V2.0 - INCORRECT)
const { data } = useQuery({
  queryKey: ["contents", snapshotDate, path],
  queryFn: () =>
    getContents({
      snapshot_date: snapshotDate,
      parent_path: path,
      limit: 1000,
      sort: "size",
    }),
  enabled: isExpanded && isDirectory,
});

// AFTER (V2.1 - CORRECT)
const { data } = useQuery({
  queryKey: ["browse", snapshotDate, path],
  queryFn: () =>
    getBrowse({
      snapshot_date: snapshotDate,
      parent_path: path,
      limit: 1000,
    }),
  enabled: isExpanded && isDirectory,
});
```

### Changed Response Field References
```typescript
// BEFORE
const hasChildren = data && data.entries.length > 0;
childReferenceSize = data.entries.reduce((sum, e) => sum + e.size, 0);
data.entries.map((entry) => ...)

// AFTER
const hasChildren = data && data.folders.length > 0;
childReferenceSize = data.folders.reduce((sum: number, e) => sum + e.size, 0);
data.folders.map((folder) => ...)
```

### Updated Root Data Fetching
```typescript
// BEFORE
const { data: rootData } = useQuery({
  queryKey: ["contents", selectedSnapshot, "/project/cil"],
  queryFn: () => getContents({...}),
});
const projectSize = rootData?.entries.reduce((sum, e) => sum + e.size, 0) ?? 0;

// AFTER
const { data: rootData } = useQuery({
  queryKey: ["browse", selectedSnapshot, "/project/cil"],
  queryFn: () => getBrowse({...}),
});
const projectSize = rootData?.folders.reduce((sum: number, e) => sum + e.size, 0) ?? 0;
```

### Updated UI Notice
```typescript
// BEFORE
<strong>Note:</strong> Directory sizes show <strong>direct children only</strong>,
not recursive totals. Percentages are calculated from visible children at each level.

// AFTER
<strong>Note:</strong> This view shows <strong>directories only</strong> with
aggregated sizes from direct children. Directory sizes represent the sum of
immediate child files, not recursive subtree totals. Percentages are calculated
from visible directories at each level.
```

### Removed File-Related Code
Since `/api/browse` returns folders only, we removed:
- File type icon function `getFileIcon()`
- Unused icon imports (File, FileText, Image, Film, Archive, Code, Database)
- File vs folder conditional rendering
- `getContents` import (no longer used)

## Verification

### Before Fix
```bash
curl 'http://localhost:8000/api/contents?snapshot_date=2025-12-12&parent_path=/project/cil'
# Returns:
{
  "entries": [
    {"name": "gcp", "size": 4096, "size_formatted": "4.00 KiB"},  # WRONG
    ...
  ]
}
```

### After Fix
```bash
curl 'http://localhost:8000/api/browse?snapshot_date=2025-12-12&parent_path=/project/cil'
# Returns:
{
  "folders": [
    {"name": "gcp", "size": 1076757399, "size_formatted": "1.00 GiB"},  # CORRECT
    ...
  ]
}
```

## Impact

**Visual Impact:**
- ✅ Directory sizes now show meaningful aggregated values (GiB scale)
- ✅ Size bars accurately reflect directory weight
- ✅ Percentages make sense (children sum to 100% in directory mode)
- ✅ No more confusing "4 KiB" for large directories

**Functional Impact:**
- ✅ Tree structure shows folders only (cleaner navigation)
- ✅ Lazy loading still works (fetch on expand)
- ✅ Reference modes work correctly with aggregated sizes
- ✅ Custom reference selection works as expected

**What We Gave Up (Temporarily):**
- ❌ File listings in tree view
- ❌ File type icons
- ❌ Mixed file/folder navigation

## Future: Hybrid View (Phase 3)

To show **both** navigation and file details, we'll implement a hybrid approach:

1. **Left Panel: Tree Navigation (folders only)**
   - Uses `/api/browse` for structure
   - Shows aggregated sizes
   - Clean folder hierarchy

2. **Right Panel: Contents View (files + folders)**
   - Uses `/api/contents` for selected directory
   - Shows individual files with metadata
   - Detailed file information (owner, type, timestamps)

This separation gives us:
- Correct semantics for each view
- Best of both endpoints
- No confusion between aggregated vs. raw sizes

## Files Changed

1. **[components/disk-usage-explorer-v2.tsx](components/disk-usage-explorer-v2.tsx)**
   - Changed query from `getContents()` to `getBrowse()`
   - Updated response handling: `data.entries` → `data.folders`
   - Removed file type icon logic
   - Updated UI notice text
   - Removed unused imports

## Testing Checklist

- [x] Build succeeds (`npm run build`)
- [ ] Directory sizes show correct aggregated values (GiB, not KiB)
- [ ] Size bars reflect actual directory weight
- [ ] Percentages sum to ~100% in directory mode
- [ ] Tree expansion shows child folders
- [ ] Reference modes work correctly
- [ ] Custom reference selection works
- [ ] Project total calculated correctly

## Related Documentation

- [V2_CHANGES.md](V2_CHANGES.md) - Original V2 implementation
- [SESSION_HANDOFF.md](SESSION_HANDOFF.md) - Session continuation docs
- [DUTREE_UX.md](DUTREE_UX.md) - Original dutree implementation
- [../../clickhouse/README.md](../../clickhouse/README.md) - Backend data semantics

## Key Takeaway

**Mental Model:**
- `/api/browse` → **Navigation** (folders, aggregated sizes)
- `/api/contents` → **Details** (files + folders, raw metadata)

Don't mix them for the same purpose. Use each for what it's designed for.
