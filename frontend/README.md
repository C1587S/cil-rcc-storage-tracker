# Storage Analytics Frontend

Modern web application for visualizing and analyzing storage data from the Storage Analytics System. Built with Next.js 14, TypeScript, and professional data visualization libraries.

## Features

- Interactive treemap visualization for hierarchical storage data
- Disk usage tree with size bars
- Real-time file search with regex support
- Snapshot management and browsing
- Heavy files analysis and space consumer identification
- Folder navigation with tree structure and breadcrumbs
- Responsive design for desktop, tablet, and mobile
- Type-safe TypeScript implementation

## Tech Stack

### Core
- Next.js 14 (App Router)
- React 18
- TypeScript

### State Management & Data
- TanStack Query v5 (server state)
- Zustand (client state)
- Axios (HTTP client)

### UI & Styling
- shadcn/ui components
- Tailwind CSS
- Radix UI primitives
- Lucide React icons

### Visualizations
- Nivo (treemap, bar, line, pie charts)

## Prerequisites

- Node.js 18 or higher
- npm or yarn
- Backend API running (see [backend/README.md](../backend/README.md))

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env.local

# Start development server
npm run dev
```

Open http://localhost:3000 in your browser.

## Environment Configuration

Create a `.env.local` file:

```bash
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:8000

# Application Configuration
NEXT_PUBLIC_APP_NAME=Storage Analytics
NEXT_PUBLIC_DEFAULT_SNAPSHOT=latest
```

## Project Structure

```
frontend/
├── app/                    # Next.js App Router
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Home page
│   └── dashboard/         # Dashboard pages
├── components/            # React components
│   ├── ui/               # shadcn/ui components
│   ├── layout/           # Layout components
│   ├── visualizations/   # Chart and viz components
│   ├── panels/           # Dashboard panels
│   └── navigation/       # Navigation components
├── lib/                   # Library code
│   ├── api/              # API client
│   ├── hooks/            # Custom React hooks
│   ├── stores/           # Zustand stores
│   ├── utils/            # Utility functions
│   └── types/            # TypeScript types
└── README.md              # This file
```

## Available Scripts

```bash
# Development
npm run dev              # Start development server
npm run build            # Build for production
npm run start            # Start production server
npm run lint             # Run ESLint
npm run type-check       # Run TypeScript compiler check

# Testing
npm test                 # Run tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage
```

## Development Workflow

### 1. Start the Backend

Ensure the backend API is running:

```bash
cd ../backend
source venv/bin/activate
uvicorn app.main:app --reload
```

### 2. Start the Frontend

```bash
npm run dev
```

### 3. Access the Application

Navigate to http://localhost:3000

## Key Components

### State Management

#### Navigation Store
```typescript
import { useNavigationStore } from '@/lib/stores/navigationStore'

const { currentPath, setCurrentPath, scanRoot, setScanRoot } = useNavigationStore()
```

### Data Fetching Hooks

#### Snapshots
```typescript
import { useSnapshots, useSnapshot } from '@/lib/hooks/useSnapshots'

const { data: snapshots } = useSnapshots()
const { data: snapshot } = useSnapshot('2025-12-15')
```

#### Folder Data
```typescript
import { useFolderData } from '@/lib/hooks/useFolderData'

const { data, isLoading } = useFolderData('/project/cil', snapshot, 2)
```

#### Analytics
```typescript
import { useHeavyFiles } from '@/lib/hooks/useAnalytics'

const { data } = useHeavyFiles(snapshot, 50)
```

## API Client Usage

```typescript
import { snapshotsApi, searchApi, foldersApi } from '@/lib/api'

// Fetch snapshots
const snapshots = await snapshotsApi.list()

// Search files
const results = await searchApi.files({
  q: '*.py',
  snapshot: '2025-12-15',
})

// Get folder data
const folder = await foldersApi.getBreakdown('/project/cil', '2025-12-15', 1)
```

## Development

### Running Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Code Quality

```bash
# Lint
npm run lint

# Type check
npm run type-check

# Format (if configured)
npm run format
```

## Troubleshooting

### Backend Connection Issues

Check that the backend is running:

```bash
curl http://localhost:8000/health
```

Update API URL in `.env.local` if needed:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### Build Errors

Clear cache and rebuild:

```bash
rm -rf .next node_modules
npm install
npm run build
```

### Type Errors

Run type check to identify issues:

```bash
npm run type-check
```

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

---

For more information, see the main project [README](../README.md) and [backend documentation](../backend/README.md).
