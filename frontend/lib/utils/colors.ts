/**
 * Color schemes for visualizations
 */

export const FILE_TYPE_COLORS: Record<string, string> = {
  // Documents
  pdf: '#E74C3C',
  doc: '#3498DB',
  docx: '#3498DB',
  txt: '#95A5A6',
  md: '#34495E',

  // Spreadsheets
  xls: '#27AE60',
  xlsx: '#27AE60',
  csv: '#2ECC71',

  // Images
  jpg: '#9B59B6',
  jpeg: '#9B59B6',
  png: '#8E44AD',
  gif: '#AF7AC5',
  svg: '#A569BD',

  // Videos
  mp4: '#E67E22',
  avi: '#D68910',
  mov: '#E59866',
  mkv: '#DC7633',

  // Audio
  mp3: '#1ABC9C',
  wav: '#16A085',
  flac: '#17A589',

  // Code
  py: '#3776AB',
  js: '#F7DF1E',
  ts: '#3178C6',
  java: '#007396',
  cpp: '#00599C',
  c: '#A8B9CC',
  rs: '#CE412B',
  go: '#00ADD8',
  rb: '#CC342D',
  php: '#777BB4',

  // Archives
  zip: '#7F8C8D',
  tar: '#5D6D7E',
  'tar.gz': '#5D6D7E',
  gz: '#566573',
  rar: '#566573',

  // Data
  json: '#FFB13B',
  xml: '#FF6B35',
  yaml: '#CB4C35',
  yml: '#CB4C35',
  sql: '#E38C29',

  // Other
  log: '#99A3A4',
  bin: '#34495E',
  exe: '#2C3E50',
  directory: '#3498DB',
  unknown: '#BDC3C7',
}

/**
 * Get color for file type
 */
export function getFileTypeColor(fileType: string): string {
  const type = fileType.toLowerCase()
  return FILE_TYPE_COLORS[type] || FILE_TYPE_COLORS.unknown
}

/**
 * Generate color palette for treemap/charts
 */
export const NIVO_COLOR_SCHEMES = {
  default: 'nivo',
  category10: 'category10',
  accent: 'accent',
  dark2: 'dark2',
  paired: 'paired',
  pastel1: 'pastel1',
  pastel2: 'pastel2',
  set1: 'set1',
  set2: 'set2',
  set3: 'set3',
} as const

/**
 * Size-based color gradient (red = larger files)
 */
export function getSizeColor(percentage: number): string {
  if (percentage >= 75) return '#E74C3C' // Red
  if (percentage >= 50) return '#F39C12' // Orange
  if (percentage >= 25) return '#F1C40F' // Yellow
  if (percentage >= 10) return '#3498DB' // Blue
  return '#95A5A6' // Gray
}

/**
 * Age-based color gradient (red = older files)
 */
export function getAgeColor(daysOld: number): string {
  if (daysOld >= 365) return '#E74C3C' // Red - 1+ year
  if (daysOld >= 180) return '#F39C12' // Orange - 6+ months
  if (daysOld >= 90) return '#F1C40F' // Yellow - 3+ months
  if (daysOld >= 30) return '#3498DB' // Blue - 1+ month
  return '#2ECC71' // Green - Recent
}
