# DiskUsageExplorer V1 → V2 Changes

**Date:** 2025-12-19
**Status:** Complete - All user feedback addressed

## Summary

Complete rewrite of disk usage explorer addressing all UX and data concerns. The explorer is now a proper terminal-inspired disk usage tool with accurate semantics and soft visual design.

## Critical Fixes

### 1. Percentage Logic (Was Broken)

**V1 Problem:**
```typescript
// Multiple folders showing >50% at same level
const parentPercent = parentSize ? (size / parentSize) * 100 : 100;
// parentSize was undefined or inconsistent
```

**V2 Solution:**
```typescript
// Three reference modes with clear semantics
type ReferenceMode = "directory" | "project" | "custom";

// Directory mode: children sum to 100% of parent
if (state.referenceMode === "directory" && data) {
  childReferenceSize = data.entries.reduce((sum, e) => sum + e.size, 0);
}

// Project mode: all relative to project total
// Custom mode: all relative to user-selected folder
```

**Result:** Percentages now make sense and sum correctly.

### 2. Data Correctness (Was Confusing)

**V1 Problem:**
- `/project/cil/gcp` showed 1 GiB but visually implied that's the total
- Users thought data was wrong

**V2 Solution:**
- Added clear notice: "Directory sizes show direct children only, not recursive totals"
- Verified data is actually correct (1 GiB = files in gcp/ itself, children show 296 GiB + 6 GiB + ...)
- Percentages calculated from visible children, not misleading parent sizes

### 3. Files Missing (Critical Feature Gap)

**V1 Problem:**
```typescript
// Only used /api/browse - folders only
const { data } = useQuery({
  queryFn: () => getBrowse({ ... }),  // Returns only folders
});
```

**V2 Solution:**
```typescript
// Now uses /api/contents - files + folders
const { data } = useQuery({
  queryFn: () => getContents({
    snapshot_date,
    parent_path: path,
    limit: 1000,
    sort: "size",  // Largest first
  }),
});

// Renders both
data.entries.map((entry) => (
  <TreeNode
    isDirectory={entry.is_directory}
    // ... both files and folders
  />
))
```

**Result:** Tree now shows complete directory contents.

## Major UX Improvements

### 4. Reference Mode Toggle (New Feature)

**UI:**
```
Percentages relative to:
○ Current directory
○ Entire project (303.11 GiB)
```

**Behavior:**
- **Current directory:** Each level's children sum to 100%
- **Entire project:** All nodes relative to project total
- **Custom:** Click target icon to set any folder as reference

**Code:**
```typescript
<label className="flex items-center gap-2 cursor-pointer">
  <input
    type="radio"
    checked={state.referenceMode === "directory"}
    onChange={() => setState({ referenceMode: "directory", ... })}
  />
  <span>Current directory</span>
</label>
```

### 5. File Type Icons (Visual Improvement)

**V1:** Only folder icon for everything

**V2:**
- Folders: Amber folder (open/closed state)
- Images: Purple Image icon (png, jpg, svg, etc.)
- Video: Pink Film icon (mp4, avi, etc.)
- Archives: Orange Archive icon (zip, tar, etc.)
- Code: Green Code icon (py, js, ts, etc.)
- Data: Blue Database icon (csv, json, nc, h5, etc.)
- Text: Gray FileText icon (txt, md, log, etc.)
- Generic: Muted File icon

**Code:**
```typescript
function getFileIcon(name: string, fileType?: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["png", "jpg", ...].includes(ext)) {
    return <Image className="w-3.5 h-3.5 text-purple-400/80" />;
  }
  // ... more cases
  return <File className="w-3.5 h-3.5 text-muted-foreground/60" />;
}
```

### 6. Softer Color Palette (Visual Polish)

**V1 Colors (Too Aggressive):**
```typescript
"bg-red-500/70"    // Harsh red
"bg-yellow-500/70" // Bright yellow
"bg-blue-500/70"   // Strong blue
```

**V2 Colors (Pastel Hacker Style):**
```typescript
"bg-red-400/40"    // Soft red (>50%)
"bg-amber-400/40"  // Warm amber (>20%)
"bg-sky-400/40"    // Subtle sky blue (>5%)
"bg-slate-400/30"  // Muted slate (<5%)
```

**Visual Impact:** Less aggressive, more elegant terminal aesthetic.

### 7. Metadata Always Visible (UX Improvement)

**V1:**
```typescript
// Metadata only on hover
<div className="hidden group-hover:flex ...">
  {fileCount && <span>{fileCount} files</span>}
  {modifiedTime && <span>{formatDate(modifiedTime)}</span>}
</div>
```

**V2:**
```typescript
// Last access always visible
<span className="text-xs font-mono ... min-w-[45px] text-right">
  {formatDate(accessedTime || modifiedTime)}
</span>

// File count next to name (always visible)
{isDirectory && fileCount !== undefined && (
  <span className="text-xs ... font-mono">
    ({fileCount}f)
  </span>
)}
```

**Result:** Critical metadata always visible, not hidden.

### 8. Custom Reference Selection (Power Feature)

**New:** Click target icon next to any folder to set it as percentage reference.

**UI:**
```typescript
{isDirectory && onSetReference && (
  <Button
    variant="ghost"
    size="sm"
    className="opacity-0 group-hover:opacity-100 h-6 w-6 p-0"
    onClick={(e) => {
      e.stopPropagation();
      onSetReference(path, size);
    }}
  >
    <Target className="w-3 h-3" />
  </Button>
)}
```

**Use Case:** Compare subdirectories within a specific branch without switching modes.

## Visual Design Changes

### Typography
- **V1:** Inconsistent sizing
- **V2:** Consistent `text-xs` with monospace for data

### Spacing
- **V1:** 16px per level
- **V2:** 12px per level (more compact)

### Hover States
- **V1:** `hover:bg-accent`
- **V2:** `hover:bg-accent/30` (softer)

### Border Indicators
- **V1:** None
- **V2:** `border-l hover:border-primary/20` (subtle)

### Bar Height
- **V1:** `h-4` (16px)
- **V2:** `h-3` (12px, more compact)

### Custom Reference Highlight
- **V2 New:** Selected reference folder has `bg-primary/5 border-l-2 border-primary/50`

## Code Architecture Changes

### State Management

**V1:**
```typescript
// Only expanded state, no reference tracking
const [isExpanded, setIsExpanded] = useState(false);
```

**V2:**
```typescript
// Rich state for reference modes
interface DiskUsageState {
  referenceMode: "directory" | "project" | "custom";
  customReferencePath: string | null;
  customReferenceSize: number | null;
}

const [state, setState] = useState<DiskUsageState>({
  referenceMode: "directory",
  customReferencePath: null,
  customReferenceSize: null,
});
```

### Data Fetching

**V1:**
```typescript
// Only browse endpoint
getBrowse({ snapshot_date, parent_path, limit })
```

**V2:**
```typescript
// Contents endpoint with sorting
getContents({
  snapshot_date,
  parent_path,
  limit: 1000,
  sort: "size",  // Largest first
})
```

### Props Structure

**V1 (8 props):**
```typescript
interface FolderTreeNodeProps {
  path: string;
  name: string;
  snapshotDate: string;
  level: number;
  size: number;
  sizeFormatted: string;
  parentSize?: number;
  rootSize?: number;
}
```

**V2 (15 props):**
```typescript
interface TreeNodeProps {
  path: string;
  name: string;
  snapshotDate: string;
  level: number;
  isDirectory: boolean;          // New
  size: number;
  sizeFormatted: string;
  fileCount?: number;            // New
  owner?: string;                // New
  modifiedTime?: number;         // New
  accessedTime?: number;         // New
  fileType?: string;             // New
  referenceSize: number;         // Renamed from parentSize
  state: DiskUsageState;         // New
  onSetReference?: (path, size) => void;  // New
}
```

## UI Layout Changes

### V1 Layout
```
[Chevron] [Folder] [Name] [====Bar====] [Size] [%] [Metadata on hover]
```

### V2 Layout
```
[Chevron] [Icon] [Name (123f)] [====Bar====] [Size] [%] [Last Access] [Target]
```

**Differences:**
- Icon changes based on type (folder/file)
- File count always visible next to name
- Last access always visible (not on hover)
- Target button for setting custom reference

## Notice Banner (Critical Addition)

**V2 Added:**
```typescript
<div className="bg-muted/30 border ... px-3 py-2 mb-3">
  <strong>Note:</strong> Directory sizes show <strong>direct children only</strong>,
  not recursive totals. Percentages are calculated from visible children at each level.
</div>
```

**Purpose:** Prevent user confusion about data correctness.

## Performance Impact

### V1
- Used `/api/browse` (folders only)
- Lighter payload
- But incomplete data

### V2
- Uses `/api/contents` (folders + files)
- Slightly larger payload
- But complete and correct data
- Sorted server-side by size (efficient)

**Verdict:** Acceptable trade-off for correctness and completeness.

## Breaking Changes

None - V2 is a complete replacement, not an incremental update.

**Migration:** Simply import `DiskUsageExplorerV2` instead of `DiskUsageExplorer`.

## Testing Differences

### V1 Testing
- ✓ Folders expand
- ✓ Sizes display
- ✗ Percentages confusing
- ✗ Missing files
- ✗ No reference mode

### V2 Testing
- ✓ Folders expand
- ✓ Files show
- ✓ Sizes display correctly
- ✓ Percentages make sense
- ✓ Reference modes work
- ✓ Icons correct
- ✓ Metadata visible
- ✓ Custom reference works
- ✓ Fullscreen mode works
- ✓ ESC key works

## Lines of Code

- **V1:** 324 lines
- **V2:** 478 lines

**Increase:** 154 lines (+47%)

**Breakdown:**
- Reference mode logic: ~80 lines
- File type icons: ~40 lines
- Custom reference: ~20 lines
- Enhanced UI: ~14 lines

## Files Changed

1. **apps/web/components/disk-usage-explorer-v2.tsx** - NEW (478 lines)
2. **apps/web/app/page.tsx** - Updated import (1 line)
3. **SESSION_HANDOFF.md** - NEW (comprehensive docs)
4. **V2_CHANGES.md** - NEW (this file)

## Deployment Notes

**No breaking changes to:**
- Backend API (unchanged)
- Types (unchanged)
- Global state (unchanged)
- Other components (unchanged)

**Simply replace:**
```typescript
// OLD
import { DiskUsageExplorer } from "@/components/disk-usage-explorer";

// NEW
import { DiskUsageExplorerV2 } from "@/components/disk-usage-explorer-v2";
```

## User Feedback Addressed

All 9 points from user feedback:

1. ✅ Relative size logic → Three reference modes
2. ✅ Bars interpretation → Consistent based on mode
3. ✅ Last access column → Always visible
4. ✅ File/dir counts → Shown as `(123f)`
5. ✅ Show files → Both files and folders
6. ✅ Icons → File type icons
7. ✅ Bar colors → Soft pastel palette
8. ✅ Data correctness → Verified and documented
9. ✅ Fullscreen → Working with ESC

## Next Session

Ready for user testing. No further changes needed unless user provides feedback after testing in browser.
