# DuTree-Style Disk Usage Explorer - Implementation

**Date:** 2025-12-19
**Status:** Implemented and ready for testing

## Overview

Replaced the basic folder explorer with a terminal-inspired, dutree-style disk usage visualization that emphasizes spatial understanding of filesystem usage.

## Features Implemented

### 1. Fullscreen Mode

**Trigger:**
- Click "Fullscreen" button in header
- Exit via "Exit" button or ESC key

**Behavior:**
- Fixed overlay (`position: fixed; inset: 0; z-index: 50`)
- Full background with proper padding
- State preserved when toggling (expanded nodes, selected path)
- Keyboard shortcut (ESC) to exit

**Code:**
```typescript
const [isFullscreen, setIsFullscreen] = useState(false);

useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && isFullscreen) {
      setIsFullscreen(false);
    }
  };
  if (isFullscreen) {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }
}, [isFullscreen]);
```

### 2. Horizontal Size Bars (DuTree-Style)

**Design:**
- Horizontal progress bar showing % of parent directory
- Color-coded by size:
  - **Red (>50%)**: Dominant directories
  - **Yellow (>20%)**: Large directories
  - **Blue (>5%)**: Medium directories
  - **Muted (<5%)**: Small directories

**Implementation:**
```typescript
const parentPercent = parentSize ? (size / parentSize) * 100 : 100;

const getBarColor = (percent: number) => {
  if (percent > 50) return "bg-red-500/70";
  if (percent > 20) return "bg-yellow-500/70";
  if (percent > 5) return "bg-blue-500/70";
  return "bg-muted/70";
};

<div className="flex-1 h-4 bg-muted/30 rounded-sm overflow-hidden min-w-[100px]">
  <div
    className={cn("h-full transition-all", getBarColor(parentPercent))}
    style={{ width: `${Math.max(parentPercent, 2)}%` }}
  />
</div>
```

### 3. Size Percentages

**Relative to Parent:**
- Always shown: `XX.X%` next to each bar
- Indicates how much of parent directory this folder occupies

**Relative to Root (Optional):**
- Shown on xl screens only
- Very subtle (`text-muted-foreground/40`)
- Shows absolute percentage of total project size
- Useful for finding "what's really heavy"

**Implementation:**
```typescript
const parentPercent = parentSize ? (size / parentSize) * 100 : 100;
const rootPercent = rootSize ? (size / rootSize) * 100 : 0;

// Parent percentage (always visible)
<span className="text-xs font-mono text-muted-foreground/70 min-w-[45px] text-right">
  {parentPercent.toFixed(1)}%
</span>

// Root percentage (XL screens only)
{rootSize && rootPercent > 0 && (
  <span className="hidden xl:block text-xs font-mono text-muted-foreground/40 ml-2">
    {rootPercent.toFixed(2)}%
  </span>
)}
```

### 4. Metadata Display

**On Hover (group-hover):**
- File count: `X files`
- Last modified: Human-readable relative time (`2d ago`, `3mo ago`, `1y ago`)
- Owner: Truncated to 80px max

**Date Formatting:**
```typescript
function formatDate(timestamp?: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}
```

**Metadata Row:**
```typescript
<div className="hidden group-hover:flex items-center gap-3 text-xs text-muted-foreground/60">
  {fileCount !== undefined && fileCount > 0 && (
    <span className="font-mono">{fileCount} files</span>
  )}
  {modifiedTime && (
    <span className="font-mono">{formatDate(modifiedTime)}</span>
  )}
  {owner && <span className="truncate max-w-[80px]">{owner}</span>}
</div>
```

### 5. Terminal-Inspired Visual Design

**Typography:**
- Monospace for sizes, percentages, metadata
- Compact sizing (`text-xs`)
- Muted foreground colors for less important info

**Colors:**
- High contrast bars with 70% opacity
- Muted background bars (30% opacity)
- Subtle hover states (`hover:bg-accent/50`)
- Border indicators on hover (`hover:border-primary/30`)

**Spacing:**
- Reduced indentation (12px per level instead of 16px)
- Compact vertical spacing (`py-1.5`)
- Clean, minimal gaps

**Layout:**
```typescript
<div className={cn(
  "flex items-center gap-2 px-2 py-1.5 hover:bg-accent/50 cursor-pointer group",
  "border-l-2 border-transparent hover:border-primary/30 transition-colors"
)}>
```

### 6. Legend and Header

**Legend:**
- Color-coded boxes showing threshold meanings
- Explanation: "Bars show % of parent · Hover for metadata"

**Header:**
- Explorer title + description
- Current snapshot date
- Fullscreen toggle button

## Component Structure

```
DiskUsageExplorer (container)
├── Header (title, snapshot, fullscreen button)
├── Legend (color thresholds, instructions)
└── DuTreeNode (recursive tree)
    ├── Chevron + Folder icon
    ├── Name (truncated)
    ├── Size bar (horizontal, color-coded)
    ├── Size + percentage
    ├── Metadata (on hover)
    ├── Root percentage (XL screens)
    └── Children (recursive)
```

## Files Changed

1. **[components/disk-usage-explorer.tsx](components/disk-usage-explorer.tsx)** - New component (324 lines)
   - DuTreeNode: Recursive tree node with bars and metadata
   - DiskUsageExplorer: Container with fullscreen mode
   - formatDate: Human-readable relative dates

2. **[app/page.tsx](app/page.tsx)** - Updated to use DiskUsageExplorer
   - Replaced FolderExplorer with DiskUsageExplorer
   - Removed grid layout (single column, full width)

3. **[lib/types.ts](lib/types.ts)** - Fixed type definitions
   - `modified_time` and `accessed_time` changed from `string` to `number`
   - Matches actual API response (Unix timestamps)

4. **[components/snapshot-selector.tsx](components/snapshot-selector.tsx)** - Removed debug logging
   - Cleaned up console.log statements
   - Production-ready code

## Visual Characteristics (Terminal/ncdu/dutree Vibes)

**What Makes It Terminal-Inspired:**
- Monospace fonts for data
- Horizontal bars (not radial/pie charts)
- Compact, information-dense layout
- Muted colors, not flashy
- Keyboard shortcuts (ESC)
- Fast, responsive interactions
- No unnecessary animations (only smooth transitions)

**What Makes It Elegant:**
- Clean typography hierarchy
- Subtle hover states
- Progressive disclosure (metadata on hover)
- Color-coded by importance (red = attention needed)
- Proper spacing and alignment

**What Makes It Spatial:**
- Bars immediately show "what's heavy"
- Percentage makes relative weight obvious
- Color coding draws eye to large directories
- Tree structure shows containment
- Root percentage shows absolute importance

## Known Limitations

1. **Directory sizes are direct children only** (backend limitation)
   - Bars show immediate children, not recursive totals
   - For recursive totals, use `/api/query` endpoint
   - Documented in backend README

2. **Root size calculation**
   - Calculated by summing immediate children of `/project/cil`
   - May not match actual filesystem total
   - Good enough for relative comparisons

## Testing Checklist

- [ ] Load page with snapshot selected
- [ ] Verify size bars display correctly
- [ ] Verify color coding (red/yellow/blue/muted)
- [ ] Hover over folders to see metadata
- [ ] Click to expand folders
- [ ] Verify percentages are accurate
- [ ] Click "Fullscreen" button
- [ ] Verify fullscreen overlay works
- [ ] Press ESC to exit fullscreen
- [ ] Verify state preserved (expanded nodes)
- [ ] Test on different screen sizes (legend, root %)
- [ ] Verify monospace fonts for numbers

## Next Steps (Not Implemented)

These are for future iterations:
- Contents view (files + folders mixed)
- Breadcrumb navigation
- Search panel
- Query/SQL mode
- Treemap visualization
- Export functionality
