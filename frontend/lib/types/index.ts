export * from './api'

export interface BreadcrumbItem {
  label: string
  path: string
  isLast: boolean
}

export interface NavigationState {
  currentPath: string
  snapshot: string | null
  breadcrumbs: BreadcrumbItem[]
}

export interface PreferencesState {
  theme: 'light' | 'dark' | 'system'
  defaultView: 'treemap' | 'tree' | 'list'
  itemsPerPage: number
}

export type SortField = 'name' | 'size' | 'modified_time' | 'file_type'
export type SortOrder = 'asc' | 'desc'

export interface SortConfig {
  field: SortField
  order: SortOrder
}
