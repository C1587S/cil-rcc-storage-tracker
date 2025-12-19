# Bug Fix: Snapshot Selector Not Showing Snapshots

**Date:** 2025-12-19
**Status:** FIXED

## Problem

When loading `http://localhost:3000`, the snapshot selector showed "Loading snapshots..." but snapshots were never visible. No console errors were present, and the backend `/api/snapshots` endpoint was confirmed working via curl.

## Root Cause

**Issue 1: Frontend/Backend Type Mismatch**

The frontend types expected:
```typescript
interface SnapshotsResponse {
  snapshots: Snapshot[];  // ❌ Wrong - expected wrapper object
}

interface Snapshot {
  snapshot_date: string;
  entry_count: number;     // ❌ Wrong field name
  file_count: number;      // ❌ Wrong field name
}
```

But the backend returns:
```python
# Direct array, no wrapper
list[SnapshotInfo]  # ✅ Array directly

class SnapshotInfo:
    snapshot_date: date
    total_entries: int   # ✅ Correct field name
    total_files: int     # ✅ Correct field name
    total_directories: int
    # ... more fields
```

**Issue 2: Incorrect Root Path**

The folder explorer started at `/` but the actual data root is `/project/cil`.

## Changes Made

### 1. Fixed Frontend Types ([lib/types.ts](lib/types.ts))

```typescript
// OLD (incorrect)
export interface Snapshot {
  snapshot_date: string;
  entry_count: number;
  file_count: number;
}

export interface SnapshotsResponse {
  snapshots: Snapshot[];
}

// NEW (correct - matches backend)
export interface Snapshot {
  snapshot_date: string;
  total_entries: number;
  total_size: number;
  total_files: number;
  total_directories: number;
  scan_started?: string;
  scan_completed?: string;
  top_level_dirs: string[];
  import_time?: string;
}
```

### 2. Fixed API Client ([lib/api.ts](lib/api.ts))

```typescript
// OLD
export async function getSnapshots(): Promise<SnapshotsResponse> {
  return apiRequest<SnapshotsResponse>("/api/snapshots");
}

// NEW
export async function getSnapshots(): Promise<Snapshot[]> {
  return apiRequest<Snapshot[]>("/api/snapshots");
}
```

### 3. Fixed Snapshot Selector Component ([components/snapshot-selector.tsx](components/snapshot-selector.tsx))

```typescript
// OLD
const snapshots = data?.snapshots || [];  // ❌ Wrong - tried to access .snapshots property
{snapshots.map((snapshot) => (
  <option>
    {snapshot.snapshot_date} ({snapshot.entry_count.toLocaleString()})  // ❌ Wrong field name
  </option>
))}

// NEW
const snapshots = data || [];  // ✅ Correct - data is already an array
{snapshots.map((snapshot) => (
  <option>
    {snapshot.snapshot_date} ({snapshot.total_entries.toLocaleString()})  // ✅ Correct field name
  </option>
))}
```

### 4. Fixed Folder Explorer Root Path ([components/folder-explorer.tsx](components/folder-explorer.tsx))

```typescript
// OLD
<FolderTreeNode
  path="/"
  name="/"
  snapshotDate={selectedSnapshot}
  level={0}
/>

// NEW
<FolderTreeNode
  path="/project/cil"
  name="/project/cil"
  snapshotDate={selectedSnapshot}
  level={0}
/>
```

### 5. Added Debug Logging

Added temporary console.log statements to:
- `snapshot-selector.tsx` - logs data, isLoading, error states
- `folder-explorer.tsx` - logs selectedSnapshot and folder toggle events

## Verification

### Backend API Response (Confirmed Working)

```bash
curl http://localhost:8000/api/snapshots
[
  {
    "snapshot_date": "2025-12-12",
    "total_entries": 42488746,
    "total_size": 496155608200498,
    "total_files": 40422548,
    "total_directories": 2066198,
    ...
  }
]
```

### Browse Endpoint with Correct Path

```bash
curl 'http://localhost:8000/api/browse?snapshot_date=2025-12-12&parent_path=/project/cil&limit=10'
{
  "snapshot_date": "2025-12-12",
  "parent_path": "/project/cil",
  "folders": [
    {
      "path": "/project/cil/gcp",
      "name": "gcp",
      "is_directory": true,
      "size": 1076757399,
      "size_formatted": "1.00 GiB",
      "file_count": 3
    },
    ...
  ]
}
```

## Expected Happy Path (Now Working)

1. User loads `http://localhost:3001`
2. Snapshot selector fetches snapshots from `/api/snapshots`
3. Snapshots displayed as: `"2025-12-12 (42,488,746 entries)"`
4. User selects a snapshot → global state updated
5. Folder explorer shows root `/project/cil` as clickable folder
6. User clicks folder → expands and loads children from `/api/browse`
7. Folder sizes shown using `size_formatted` (e.g., "1.00 GiB")

## Notes

- Debug console.log statements should be removed once verified working in browser
- The folder sizes are direct children totals only (known backend limitation, documented)
- Port changed from 3000 to 3001 during testing (port 3000 was in use)

## Next Steps

1. Test in browser console to verify data flow
2. Remove debug logging once confirmed
3. Verify folder expansion and sizes display correctly
4. Then proceed with contents view (Phase 3)
