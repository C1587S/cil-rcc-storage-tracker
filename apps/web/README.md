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
│   └── folder-explorer.tsx
├── lib/                     # Utilities and config
│   ├── api.ts              # Typed API client
│   ├── types.ts            # TypeScript types
│   ├── store.ts            # Zustand state management
│   ├── providers.tsx       # TanStack Query provider
│   └── utils.ts            # Helper functions
└── package.json
```

## Features

### Phase 1 (Completed)
- Snapshot selector with entry counts
- Folder tree explorer (lazy-loaded)
- Terminal-inspired dark theme
- Global state management (selected snapshot + path)
- TanStack Query caching

### Phase 2 (TODO)
- Contents view (folders + files) with pagination
- Sorting and filtering
- Breadcrumb navigation

### Phase 3 (TODO)
- Search interface (exact, contains, prefix, suffix modes)
- Scope filtering

### Phase 4 (TODO)
- Query panel (filter builder + SQL mode)

### Phase 5 (TODO)
- Usage visualization (dutree-style bars)
- File type breakdown
- Keyboard shortcuts

## API Integration

The frontend consumes the FastAPI backend at `http://localhost:8000`.

All API calls are typed using interfaces from `lib/types.ts` and wrapped in `lib/api.ts`.

## Development

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## Deployment

The frontend is designed to deploy to Vercel with zero configuration.

Environment variables:
- `NEXT_PUBLIC_API_URL` - Backend API URL (defaults to `http://localhost:8000`)
