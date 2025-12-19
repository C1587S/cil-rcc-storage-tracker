# CIL-rcc-tracker Web Frontend

Modern Next.js-based frontend for exploring filesystem snapshots stored in ClickHouse.

## Tech Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS** (terminal-inspired dark theme)
- **TanStack Query** (data fetching and caching)
- **Zustand** (global state management)
- **shadcn/ui** (UI components)
- **Lucide React** (icons)
- **D3** (treemap visualizations)

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Start the development server:

```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

The API proxy is configured in `next.config.js` to forward `/api/*` requests to `http://localhost:8000/api/*`.

## Environment Variables

Create a `.env.local` file if you need to customize the API URL:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Project Structure

```
apps/web/
├── app/                      # Next.js App Router pages
│   ├── layout.tsx           # Root layout with providers
│   ├── page.tsx             # Home page
│   └── globals.css          # Global styles (dark theme)
├── components/              # React components
│   ├── ui/                  # shadcn/ui base components
│   ├── snapshot-selector.tsx
│   ├── disk-usage-explorer-v2.tsx  # ✅ STABLE main explorer
│   ├── file-type-treemap.tsx       # Treemap visualization
│   └── search-console.tsx          # 🚧 TODO: Search/Query panel
├── lib/                     # Utilities and config
│   ├── api.ts              # Typed API client
│   ├── types.ts            # TypeScript types
│   ├── store.ts            # Zustand state management
│   ├── providers.tsx       # TanStack Query provider
│   └── utils.ts            # Helper functions
└── package.json
```

## Current Status (2025-12-19)

### ✅ Stable Features

**Disk Usage Explorer** (`disk-usage-explorer-v2.tsx`) - Production ready:
- Recursive directory size visualization (backed by `filesystem.directory_recursive_sizes`)
- Interactive tree navigation with lazy-loaded children
- Quota indicators (Storage: 500TB, Files: 77M)
- Color-coded size bars and quota usage (10-step gradient: green → yellow → orange → red)
- Reference folder system with percentage propagation
- File type icons and metadata (last access, file counts)
- Fullscreen mode with ESC key support
- Soft pastel color palette (terminal-inspired, professional)

**Snapshot Selector** (`snapshot-selector.tsx`) - Production ready:
- Minimal dropdown showing only snapshot dates
- Global state management via Zustand
- Real-time snapshot metadata integration

### 🚧 In Progress

**Search/Query Console** - Next feature:
- Collapsible panel below disk usage explorer
- Visual filter builder for non-SQL users
- Guided SQL mode for intermediate users
- Raw SQL mode with guardrails for advanced users

## Architecture: Disk Usage Explorer

### Data Flow

**Recursive Sizes (V3 - Current):**
```typescript
// Backend returns both direct and recursive sizes
interface DirectoryEntry {
  size: number;           // Direct children only
  recursive_size: number; // Full subtree total ✅
}

// Frontend uses recursive_size for accurate visualization
const displaySize = entry.recursive_size || entry.size;
```

**Backend Integration:**
- `/api/browse` - Folders only (fast, uses `directory_recursive_sizes` MV)
- `/api/contents` - Files + folders (paginated, sortable, filterable)
- `/api/snapshots` - Snapshot metadata (total files, total size)

**Known Truths (Verified):**
- Project total: 451 TiB ✅
- `/project/cil/gcp`: 102.27 TiB ✅
- `/project/cil/gcp/climate`: 44.26 TiB ✅
- `/project/cil/gcp/climate/source_data/NASA`: 10.76 TiB ✅

### Reference Folder System

**How Percentages Work:**
The explorer uses a "reference folder" concept to control how size bars and percentages are calculated:

1. **Default behavior**: When you expand a folder, its children's size bars show what percentage each child is of that parent folder
2. **Reference highlighting**: The current reference folder has a green background
3. **Percentage propagation**: All visible items show their percentage relative to the reference

**Example:**
```
/project/cil (reference, 451 TiB)
├── gcp (102 TiB) → 22.7% of project
│   ├── climate (44 TiB) → 43% of gcp
│   └── integration (6 GiB) → <1% of gcp
```

When `gcp` is expanded, its children (climate, integration) show percentages relative to `gcp` (102 TiB), not the project total.

**State Structure:**
```typescript
interface DiskUsageState {
  referencePath: string;      // Path of reference folder
  referenceSize: number;      // Size of reference folder (for % calc)
  sortMode: SortMode;         // "size" | "name" | "modified"
  selectedPath: string | null; // Currently selected item (cyan underline)
}
```

**Visual Indicators:**
- Reference row: Green background (`bg-green-500/10`)
- Selected row: Cyan underline (`border-b-2 border-cyan-500/60`)
- Reference panel: Green border (`border-2 border-green-500/40`)
- Item panel: Cyan border (`border-2 border-cyan-500/40`)

### Size Color Coding

**Quota Indicators (10-step gradient):**
```typescript
function getQuotaColor(percent: number): string {
  if (percent >= 95) return "bg-red-600/70";        // 95-100%
  if (percent >= 85) return "bg-red-500/65";        // 85-95%
  if (percent >= 75) return "bg-orange-500/65";     // 75-85%
  if (percent >= 65) return "bg-orange-400/60";     // 65-75%
  if (percent >= 50) return "bg-yellow-400/60";     // 50-65%
  if (percent >= 35) return "bg-yellow-300/55";     // 35-50%
  if (percent >= 25) return "bg-lime-400/55";       // 25-35%
  if (percent >= 15) return "bg-green-400/60";      // 15-25%
  if (percent >= 5) return "bg-green-500/65";       // 5-15%
  return "bg-green-600/70";                         // 0-5%
}
```

Applied to:
- Storage quota progress bar and percentage text
- File count quota progress bar and percentage text

### File Type Icons

```typescript
// Purple: Images (png, jpg, svg, etc.)
// Pink: Video (mp4, avi, mkv, etc.)
// Orange: Archives (zip, tar, gz, etc.)
// Green: Code (py, js, ts, cpp, etc.)
// Blue: Data (csv, json, nc, h5, parquet, etc.)
// Gray: Text (txt, md, log, etc.)
```

### Component Layout

```
DiskUsageExplorerV2
├── Header
│   ├── Title + snapshot date
│   └── Fullscreen toggle
├── Info Panels (right-aligned, above tree)
│   ├── Reference Panel (green border, 280px)
│   │   ├── Path, size, quota %
│   │   └── [Treemap placeholder]
│   └── Item Panel (cyan border, 280px, conditional)
│       └── Path, name, icon
├── Quota Indicators (2 bars)
│   ├── Storage: 451.2 / 500 TB (90.2%)
│   └── Files: 40.4M / 77M (52.5%)
├── Sorting Controls
│   ├── Sort by: Size | Name | Modified
│   └── Legend (size colors)
└── Tree (recursive TreeNode)
    ├── Chevron (folders only)
    ├── Icon (folder/file type)
    ├── Name + file count
    ├── Size bar (color-coded by %)
    ├── Size (formatted)
    ├── Percentage (relative to reference)
    └── Last access (always visible)
```

## Data Integrity

### What's Verified ✅
- Recursive sizes match known totals (451 TiB project, 102 TiB gcp, etc.)
- Percentages correctly propagate when folders expand
- File counts accurate from snapshot metadata
- Quota calculations match backend data

### What's Documented 📝
- Size semantics: `recursive_size` = full subtree, `size` = direct children
- Reference folder logic controls percentage calculations
- Color coding is consistent across bars, text, and indicators
- Backend uses `directory_recursive_sizes` materialized view for performance

## Known Constraints

1. **Backend Limitations:**
   - `/api/browse` uses materialized view (fast but limited columns)
   - `/api/contents` uses raw table (flexible but slower for large dirs)
   - Contents endpoint has 1000 item limit (pagination needed for large dirs)

2. **Frontend Design Decisions:**
   - Percentages are relative to reference folder (not absolute)
   - Tree expansion is lazy (children loaded on demand)
   - Fullscreen uses CSS overlay (not browser fullscreen API)

## Next Feature: Search/Query Console

**Requirements:**
- Panel below disk usage explorer
- Collapsible (collapsed by default)
- Smooth expand/collapse animation
- Three modes:
  1. **Visual Filter Builder** (non-SQL users, primary mode)
  2. **Guided SQL** (intermediate users, SQL + limited edits)
  3. **Raw SQL** (advanced users, full guardrails)

**Visual Style:**
- Terminal-inspired, consistent with explorer
- DBeaver/psql-style result tables
- Monospace fonts for SQL and paths
- No emojis, professional aesthetic

**Backend Integration:**
- `/api/search` - Name search with modes (exact, contains, prefix, suffix)
- `/api/query` - SQL execution with strict guardrails (already implemented)

**Reference Queries:**
See `clickhouse/docs/filesystem_queries.md` for example queries that map to filter presets.

## Development

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## Deployment

The frontend is designed to deploy to Vercel with zero configuration.

Environment variables:
- `NEXT_PUBLIC_API_URL` - Backend API URL (defaults to `http://localhost:8000`)

## Documentation

- `README.md` (this file) - Architecture and current state
- `SESSION_HANDOFF.md` - Implementation history and UX rules
- `V2_CHANGES.md` - Detailed changelog of v2 improvements
- `RECURSIVE_SIZES_V3.md` - Technical details of recursive size implementation
- `CLAUDE.md` (project root) - Master specification
