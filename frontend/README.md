# Storage Analytics Frontend

A modern, responsive web application for visualizing and analyzing storage data from the Storage Analytics System. Built with Next.js 14, TypeScript, and professional-grade visualization libraries.

## Features

- **Interactive Treemap Visualization** - Hierarchical storage visualization using Nivo charts
- **Disk Usage Tree** - dutree-style visualization with size bars
- **Real-time Search** - Fast file search with regex support
- **Snapshot Management** - Browse and compare storage snapshots
- **Heavy Files Analysis** - Identify largest files and space consumers
- **Folder Navigation** - Intuitive folder tree and breadcrumb navigation
- **Responsive Design** - Works on desktop, tablet, and mobile devices
- **Dark Mode Support** - System-aware theme switching
- **Type-Safe** - Full TypeScript implementation
- **Performance Optimized** - Server-side rendering, code splitting, and caching

## Tech Stack

### Core
- **Next.js 14** - React framework with App Router
- **React 18** - UI library
- **TypeScript** - Type safety

### State Management & Data Fetching
- **TanStack Query v5** - Server state management
- **Zustand** - Client state management
- **Axios** - HTTP client

### UI Components & Styling
- **shadcn/ui** - Component library
- **Tailwind CSS** - Utility-first CSS
- **Radix UI** - Headless UI primitives
- **Lucide React** - Icon library

### Visualizations
- **Nivo** - Professional data visualizations
  - Treemap charts
  - Bar charts
  - Line charts
  - Pie charts

### Utilities
- **date-fns** - Date manipulation
- **clsx** & **tailwind-merge** - Class name utilities

### Development
- **ESLint** - Linting
- **Jest** - Unit testing
- **React Testing Library** - Component testing
- **MSW** - API mocking

## Prerequisites

- Node.js 18 or higher
- npm or yarn
- Backend API running (see backend/README.md)

## Installation

### Quick Start

```bash
# Run automated setup
./scripts/setup.sh

# Start development server
npm run dev
```

### Manual Setup

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Edit configuration
nano .env.local

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Configuration

Create a `.env.local` file:

```bash
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:8000

# Application Configuration
NEXT_PUBLIC_APP_NAME=Storage Analytics
NEXT_PUBLIC_DEFAULT_SNAPSHOT=latest

# Feature Flags
NEXT_PUBLIC_ENABLE_DARK_MODE=true
NEXT_PUBLIC_ENABLE_EXPORT=true
```

## Project Structure

```
frontend/
├── app/                          # Next.js App Router
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Home page (redirects to dashboard)
│   ├── globals.css              # Global styles
│   └── dashboard/
│       └── [snapshot]/
│           └── page.tsx         # Snapshot-specific dashboard
│
├── components/                   # React components
│   ├── ui/                      # shadcn/ui components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── select.tsx
│   │   └── input.tsx
│   ├── layout/                  # Layout components
│   │   ├── DashboardLayout.tsx
│   │   ├── Header.tsx
│   │   └── Sidebar.tsx
│   ├── visualizations/          # Visualization components
│   │   ├── TreemapView.tsx
│   │   ├── DiskUsageTree.tsx
│   │   └── charts/
│   ├── panels/                  # Dashboard panels
│   │   ├── HeavyFilesPanel.tsx
│   │   ├── SearchPanel.tsx
│   │   └── ActivityPanel.tsx
│   ├── navigation/              # Navigation components
│   │   ├── FolderTree.tsx
│   │   ├── SnapshotSelector.tsx
│   │   └── PathNavigator.tsx
│   └── providers.tsx            # Context providers
│
├── lib/                          # Library code
│   ├── api/                     # API client
│   │   ├── client.ts           # Axios instance
│   │   ├── snapshots.ts        # Snapshot API
│   │   ├── search.ts           # Search API
│   │   ├── folders.ts          # Folder API
│   │   ├── analytics.ts        # Analytics API
│   │   └── viz.ts              # Visualization API
│   ├── hooks/                   # Custom React hooks
│   │   ├── useSnapshots.ts
│   │   ├── useFolderData.ts
│   │   ├── useSearch.ts
│   │   ├── useAnalytics.ts
│   │   └── useDebounce.ts
│   ├── stores/                  # Zustand stores
│   │   ├── navigationStore.ts
│   │   └── preferencesStore.ts
│   ├── utils/                   # Utility functions
│   │   ├── formatters.ts       # Data formatting
│   │   └── colors.ts           # Color schemes
│   ├── types/                   # TypeScript types
│   │   ├── api.ts              # API types
│   │   └── index.ts            # Exported types
│   └── utils.ts                 # Shared utilities
│
├── __tests__/                    # Test files
│   ├── components/
│   ├── lib/
│   └── mocks/
│
├── public/                       # Static assets
│   └── assets/
│
├── scripts/                      # Utility scripts
│   └── setup.sh                 # Setup script
│
├── package.json                  # Dependencies
├── tsconfig.json                 # TypeScript config
├── tailwind.config.ts            # Tailwind config
├── next.config.js                # Next.js config
├── postcss.config.js             # PostCSS config
├── jest.config.js                # Jest config
├── Dockerfile                    # Docker configuration
├── docker-compose.yml            # Docker Compose setup
└── README.md                     # This file
```

## Available Scripts

```bash
# Development
npm run dev              # Start development server (port 3000)
npm run build            # Build for production
npm run start            # Start production server
npm run lint             # Run ESLint
npm run type-check       # Run TypeScript compiler check

# Testing
npm test                 # Run tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
```

## Development Workflow

### 1. Start the Backend

Ensure the backend API is running (see [backend/README.md](../backend/README.md)):

```bash
cd ../backend
./scripts/setup_dev.sh
source venv/bin/activate
uvicorn app.main:app --reload
```

### 2. Start the Frontend

```bash
npm run dev
```

### 3. Access the Application

Open [http://localhost:3000](http://localhost:3000)

## Key Components

### Dashboard Layout

The main dashboard layout consists of:
- **Header** - Snapshot selector and menu toggle
- **Sidebar** - Folder tree and path navigation
- **Main Content** - Visualizations and data panels

### State Management

#### Navigation Store (Zustand)
```typescript
import { useNavigationStore } from '@/lib/stores/navigationStore'

const { currentPath, setCurrentPath, breadcrumbs } = useNavigationStore()
```

#### Preferences Store (Zustand)
```typescript
import { usePreferencesStore } from '@/lib/stores/preferencesStore'

const { theme, setTheme, sidebarCollapsed } = usePreferencesStore()
```

### Data Fetching Hooks

#### Snapshots
```typescript
import { useSnapshots, useSnapshot } from '@/lib/hooks/useSnapshots'

const { data: snapshots } = useSnapshots()
const { data: snapshot } = useSnapshot('2024-01-15')
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

### API Client Usage

```typescript
import { snapshotsApi, searchApi, foldersApi } from '@/lib/api'

// Fetch snapshots
const snapshots = await snapshotsApi.list()

// Search files
const results = await searchApi.files({
  q: '*.py',
  snapshot: '2024-01-15',
  regex: false,
})

// Get folder data
const folder = await foldersApi.getBreakdown('/project/cil', '2024-01-15', 1)
```

## Visualization Components

### Treemap View

```typescript
import { TreemapView } from '@/components/visualizations/TreemapView'

<TreemapView path="/project" snapshot="2024-01-15" />
```

### Disk Usage Tree

```typescript
import { DiskUsageTree } from '@/components/visualizations/DiskUsageTree'

<DiskUsageTree path="/project" snapshot="2024-01-15" />
```

## Testing

### Run Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Test Structure

```
__tests__/
├── components/
│   ├── TreemapView.test.tsx
│   └── HeavyFilesPanel.test.tsx
├── lib/
│   ├── formatters.test.ts
│   └── hooks/
│       └── useFolderData.test.ts
└── mocks/
    ├── handlers.ts           # MSW handlers
    └── data.ts               # Mock data
```

### Example Test

```typescript
import { render, screen } from '@testing-library/react'
import { TreemapView } from '@/components/visualizations/TreemapView'

test('renders treemap with data', () => {
  render(<TreemapView path="/test" snapshot="2024-01-15" />)
  expect(screen.getByText('Loading...')).toBeInTheDocument()
})
```

## Docker Deployment

### Build and Run

```bash
# Build image
docker build -t storage-analytics-frontend .

# Run container
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_API_URL=http://backend:8000 \
  storage-analytics-frontend
```

### Docker Compose

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f frontend

# Stop services
docker-compose down
```

## Performance Optimization

### Implemented Optimizations

1. **Server-Side Rendering** - Initial page load optimized
2. **Code Splitting** - Dynamic imports for large components
3. **Image Optimization** - Next.js automatic image optimization
4. **API Caching** - TanStack Query with configurable stale times
5. **Local State Persistence** - Zustand with localStorage
6. **Debounced Search** - Custom useDebounce hook

### Performance Targets

- **Initial Load** - < 2 seconds
- **Time to Interactive** - < 3 seconds
- **Lighthouse Score** - > 90
- **Bundle Size** - < 500KB (gzipped)

## Troubleshooting

### Backend Connection Issues

```bash
# Check backend is running
curl http://localhost:8000/health

# Update API URL in .env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### Build Errors

```bash
# Clear cache
rm -rf .next node_modules
npm install
npm run build
```

### Type Errors

```bash
# Run type check
npm run type-check

# Update types
npm install --save-dev @types/node @types/react @types/react-dom
```

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Contributing

### Code Style

- Follow ESLint configuration
- Use TypeScript strict mode
- Write tests for new components
- Follow component naming conventions

### Component Guidelines

1. Use functional components with hooks
2. Implement proper error boundaries
3. Add loading and empty states
4. Make components reusable
5. Document props with JSDoc comments

## License

See [LICENSE](../LICENSE) file for details.

## Related Documentation

- [Backend README](../backend/README.md)
- [Scanner README](../scanner/README.md)
- [Project Plan](../CLAUDE.md)
- [Phase 1 Complete](../PHASE1_COMPLETE.md)
- [Phase 2 Complete](../PHASE2_COMPLETE.md)

## Support

For issues and questions:
- Check documentation in `/docs`
- Review GitHub issues
- Contact the development team

---

**Last Updated**: December 2024
**Version**: 1.0.0
**Status**: Phase 3 Implementation Complete
