import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BreadcrumbItem } from '@/lib/types'

interface NavigationState {
  currentPath: string
  scanRoot: string  // The root path where scanning started
  snapshot: string | null
  breadcrumbs: BreadcrumbItem[]
  setCurrentPath: (path: string) => void
  setScanRoot: (path: string) => void
  setSnapshot: (snapshot: string | null) => void
  navigateUp: () => void
  navigateToRoot: () => void
  reset: () => void
}

function generateBreadcrumbs(path: string, scanRoot: string): BreadcrumbItem[] {
  // If path is before or equal to scanRoot, show scanRoot as the only breadcrumb
  if (!path || path === scanRoot) {
    const rootName = scanRoot.split('/').filter(Boolean).pop() || 'Root'
    return [{ label: rootName, path: scanRoot, isLast: true }]
  }

  // Only show path parts that are after scanRoot
  const scanRootParts = scanRoot.split('/').filter(Boolean)
  const pathParts = path.split('/').filter(Boolean)

  // Find where path diverges from scanRoot
  const relativeParts = pathParts.slice(scanRootParts.length)

  if (relativeParts.length === 0) {
    const rootName = scanRoot.split('/').filter(Boolean).pop() || 'Root'
    return [{ label: rootName, path: scanRoot, isLast: true }]
  }

  const rootName = scanRoot.split('/').filter(Boolean).pop() || 'Root'
  const breadcrumbs: BreadcrumbItem[] = [
    { label: rootName, path: scanRoot, isLast: false },
  ]

  let currentPath = scanRoot
  relativeParts.forEach((part, index) => {
    currentPath += `/${part}`
    breadcrumbs.push({
      label: part,
      path: currentPath,
      isLast: index === relativeParts.length - 1,
    })
  })

  return breadcrumbs
}

function getParentPath(path: string, scanRoot: string): string {
  if (!path || path === scanRoot) return scanRoot
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  const parentPath = parts.length > 0 ? `/${parts.join('/')}` : '/'

  // Don't navigate above scanRoot
  const scanRootParts = scanRoot.split('/').filter(Boolean)
  const parentParts = parentPath.split('/').filter(Boolean)
  if (parentParts.length < scanRootParts.length) {
    return scanRoot
  }

  return parentPath
}

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set, get) => ({
      currentPath: '/Users/sebastiancadavidsanchez/Documents/Github/scs/bulletproof-react',
      scanRoot: '/Users/sebastiancadavidsanchez/Documents/Github/scs/bulletproof-react',
      snapshot: null,
      breadcrumbs: generateBreadcrumbs(
        '/Users/sebastiancadavidsanchez/Documents/Github/scs/bulletproof-react',
        '/Users/sebastiancadavidsanchez/Documents/Github/scs/bulletproof-react'
      ),

      setCurrentPath: (path) => {
        const { scanRoot } = get()
        const breadcrumbs = generateBreadcrumbs(path, scanRoot)
        set({ currentPath: path, breadcrumbs })
      },

      setScanRoot: (path) => {
        set({
          scanRoot: path,
          currentPath: path,
          breadcrumbs: generateBreadcrumbs(path, path)
        })
      },

      setSnapshot: (snapshot) => set({ snapshot }),

      navigateUp: () => {
        const { currentPath, scanRoot } = get()
        const parentPath = getParentPath(currentPath, scanRoot)
        get().setCurrentPath(parentPath)
      },

      navigateToRoot: () => {
        const { scanRoot } = get()
        get().setCurrentPath(scanRoot)
      },

      reset: () => {
        const { scanRoot } = get()
        set({
          currentPath: scanRoot,
          snapshot: null,
          breadcrumbs: generateBreadcrumbs(scanRoot, scanRoot),
        })
      },
    }),
    {
      name: 'navigation-storage',
      partialize: (state) => ({ scanRoot: state.scanRoot }),
    }
  )
)
