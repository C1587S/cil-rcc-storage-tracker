import { create } from 'zustand'
import type { BreadcrumbItem } from '@/lib/types'

interface NavigationState {
  currentPath: string
  snapshot: string | null
  breadcrumbs: BreadcrumbItem[]
  setCurrentPath: (path: string) => void
  setSnapshot: (snapshot: string | null) => void
  navigateUp: () => void
  navigateToRoot: () => void
  reset: () => void
}

function generateBreadcrumbs(path: string): BreadcrumbItem[] {
  if (!path || path === '/') {
    return [{ label: 'Root', path: '/', isLast: true }]
  }

  const parts = path.split('/').filter(Boolean)
  const breadcrumbs: BreadcrumbItem[] = [
    { label: 'Root', path: '/', isLast: false },
  ]

  let currentPath = ''
  parts.forEach((part, index) => {
    currentPath += `/${part}`
    breadcrumbs.push({
      label: part,
      path: currentPath,
      isLast: index === parts.length - 1,
    })
  })

  return breadcrumbs
}

function getParentPath(path: string): string {
  if (!path || path === '/') return '/'
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.length > 0 ? `/${parts.join('/')}` : '/'
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  currentPath: '/project',
  snapshot: null,
  breadcrumbs: generateBreadcrumbs('/project'),

  setCurrentPath: (path) => {
    const breadcrumbs = generateBreadcrumbs(path)
    set({ currentPath: path, breadcrumbs })
  },

  setSnapshot: (snapshot) => set({ snapshot }),

  navigateUp: () => {
    const { currentPath } = get()
    const parentPath = getParentPath(currentPath)
    get().setCurrentPath(parentPath)
  },

  navigateToRoot: () => {
    get().setCurrentPath('/project')
  },

  reset: () => {
    set({
      currentPath: '/project',
      snapshot: null,
      breadcrumbs: generateBreadcrumbs('/project'),
    })
  },
}))
