// Color utility functions for voronoi visualization

import { getFileExtension } from '@/lib/utils/formatters'
import { SIZE_SEVERITY, FILE_COUNT_SEVERITY, FILE_TYPE_COLORS } from './constants'

export function getSizeSeverity(size: number): { label: string; color: string } {
  if (size < SIZE_SEVERITY.NEGLIGIBLE) return { label: 'Negligible', color: 'text-gray-500' }
  if (size < SIZE_SEVERITY.SMALL) return { label: 'Small', color: 'text-blue-400' }
  if (size < SIZE_SEVERITY.MEDIUM) return { label: 'Medium', color: 'text-yellow-400' }
  if (size < SIZE_SEVERITY.LARGE) return { label: 'Large', color: 'text-orange-500' }
  return { label: 'Very Large', color: 'text-red-500' }
}

export function getFileCountSeverity(count: number): { label: string; color: string } {
  if (count < FILE_COUNT_SEVERITY.NEGLIGIBLE) return { label: 'Negligible', color: 'text-gray-500' }
  if (count < FILE_COUNT_SEVERITY.SMALL) return { label: 'Small', color: 'text-blue-400' }
  if (count < FILE_COUNT_SEVERITY.MEDIUM) return { label: 'Medium', color: 'text-yellow-400' }
  if (count < FILE_COUNT_SEVERITY.LARGE) return { label: 'Large', color: 'text-orange-500' }
  return { label: 'Very Large', color: 'text-red-500' }
}

export function getQuotaColor(percent: number): string {
  if (percent >= 95) return "bg-red-600/70"
  if (percent >= 85) return "bg-red-500/65"
  if (percent >= 75) return "bg-orange-500/65"
  if (percent >= 50) return "bg-yellow-400/60"
  return "bg-green-600/70"
}

export function getQuotaTextColor(percent: number): string {
  if (percent >= 95) return "text-red-600"
  if (percent >= 75) return "text-orange-500"
  if (percent >= 50) return "text-yellow-400"
  return "text-green-600"
}

export function getFileColor(name: string): string {
  const ext = getFileExtension(name).toLowerCase()
  return FILE_TYPE_COLORS[ext] || FILE_TYPE_COLORS['default']
}
