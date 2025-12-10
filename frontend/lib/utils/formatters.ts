import { format, formatDistanceToNow, parseISO } from 'date-fns'

/**
 * Format bytes to human-readable format
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 B'

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

/**
 * Format number with thousand separators
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num)
}

/**
 * Format percentage
 */
export function formatPercentage(value: number, total: number, decimals: number = 1): string {
  if (total === 0) return '0%'
  const percentage = (value / total) * 100
  return `${percentage.toFixed(decimals)}%`
}

/**
 * Format date to readable format
 */
export function formatDate(date: string | Date, formatStr: string = 'PPP'): string {
  const dateObj = typeof date === 'string' ? parseISO(date) : date
  return format(dateObj, formatStr)
}

/**
 * Format date to relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: string | Date): string {
  const dateObj = typeof date === 'string' ? parseISO(date) : date
  return formatDistanceToNow(dateObj, { addSuffix: true })
}

/**
 * Format file path to display name
 */
export function formatFileName(path: string): string {
  return path.split('/').pop() || path
}

/**
 * Format file path to parent directory
 */
export function formatParentPath(path: string): string {
  const parts = path.split('/')
  parts.pop()
  return parts.join('/') || '/'
}

/**
 * Get file extension from path
 */
export function getFileExtension(path: string): string {
  const fileName = formatFileName(path)
  const parts = fileName.split('.')
  return parts.length > 1 ? parts.pop() || '' : ''
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + '...'
}

/**
 * Truncate path from middle
 */
export function truncatePath(path: string, maxLength: number): string {
  if (path.length <= maxLength) return path

  const parts = path.split('/')
  if (parts.length <= 3) return truncateText(path, maxLength)

  const first = parts[0]
  const last = parts[parts.length - 1]
  const remaining = maxLength - first.length - last.length - 6

  if (remaining <= 0) return truncateText(path, maxLength)

  return `${first}/.../${last}`
}
