# Frontend Status: Phase 2 Complete

**Last Updated:** 2025-12-19
**Status:** Phase 2 complete - Basic snapshot selector and folder explorer working end-to-end

## Implemented Features

### Phase 2 - Frontend Scaffold + Snapshot Selector (COMPLETE)

- Next.js 14 app scaffolded with App Router, TypeScript, Tailwind CSS
- Terminal-inspired dark theme applied (Fedora/zsh vibes)
- shadcn/ui base components (Button, Card, Select)
- TanStack Query configured for API caching and request deduplication
- Zustand global state management (selectedSnapshot, selectedPath)
- Snapshot selector component using `/api/snapshots`
  - Displays all available snapshots with entry counts
  - Updates global state on selection
- Minimal folder explorer using `/api/browse`
  - Lazy-loaded folder tree (folders only)
  - Expandable/collapsible nodes with chevron icons
  - Clicking folder updates selected path in global state
  - Shows "No subfolders" message when appropriate
- API client with typed interfaces matching backend contracts
- API proxy configured in `next.config.js` (forwards `/api/*` to `http://localhost:8000/api/*`)

## End-to-End Testing

Verified working:

- Frontend starts on `http://localhost:3000`
- Backend proxy works: `/api/snapshots` → `http://localhost:8000/api/snapshots`
- Snapshot selector loads snapshots from backend
- Folder tree loads children on expand
- State management working (selected snapshot, path)
- Dark theme renders correctly

## Tech Stack (As Implemented)

- **Next.js 14.2.35** (App Router)
- **React 18.3**
- **TypeScript 5.4**
- **Tailwind CSS 3.4** (custom dark theme)
- **TanStack Query 5.28** (data fetching)
- **Zustand 4.5** (state management)
- **Lucide React 0.358** (icons)
- **class-variance-authority 0.7** (component variants)

## Project Structure

```
apps/web/
├── app/
│   ├── layout.tsx           # Root layout with dark theme + TanStack Query provider
│   ├── page.tsx             # Home page with SnapshotSelector + FolderExplorer
│   └── globals.css          # Dark theme CSS variables + terminal texture
├── components/
│   ├── ui/
│   │   ├── button.tsx       # Base button component
│   │   ├── card.tsx         # Base card component
│   │   └── select.tsx       # Base select component
│   ├── snapshot-selector.tsx # Snapshot dropdown with entry counts
│   └── folder-explorer.tsx   # Lazy-loaded folder tree
├── lib/
│   ├── api.ts               # Typed API client (getSnapshots, getBrowse, etc.)
│   ├── types.ts             # TypeScript interfaces matching backend
│   ├── store.ts             # Zustand state (selectedSnapshot, selectedPath)
│   ├── providers.tsx        # TanStack Query provider wrapper
│   └── utils.ts             # Utility functions (cn for className merging)
├── package.json
├── tsconfig.json
├── tailwind.config.ts       # Tailwind config with dark theme
├── next.config.js           # Next.js config with API proxy
└── README.md
```

## API Integration

All API calls go through typed client in `lib/api.ts`:

- `getSnapshots()` → `GET /api/snapshots`
- `getBrowse(params)` → `GET /api/browse?snapshot_date=...&parent_path=...`

TanStack Query handles:
- Automatic caching (60s stale time)
- Request deduplication
- Loading states
- Error handling

## What's Next (Phase 3)

Implement contents view and pagination:

1. Create `ContentsView` component
2. Connect to `/api/contents` endpoint
3. Add pagination controls (offset/limit)
4. Add sorting controls (size, name, modified)
5. Add filtering (files/folders, owner, type, size range)
6. Add breadcrumb navigation
7. Show both folders and files in right panel

## Running the App

Start backend (from `apps/api/`):
```bash
./start.sh
```

Start frontend (from `apps/web/`):
```bash
npm run dev
```

Or:
```bash
./start.sh
```

Frontend available at: `http://localhost:3000`

## Known Limitations

- Only folder tree implemented (no contents view yet)
- No pagination controls yet
- No sorting/filtering yet
- No breadcrumbs yet
- Directory sizes show direct children only (backend limitation, documented)

## Next Session

Focus on Phase 3:
1. Build contents view with folders + files
2. Add pagination
3. Add sorting
4. Add filters
5. Add breadcrumbs

Backend is frozen except for bug fixes. All work will be frontend-only.
