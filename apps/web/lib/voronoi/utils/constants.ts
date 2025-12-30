// Voronoi visualization constants and theme colors

export const TERMINAL_COLORS = {
  background: '#0a0e14',
  backgroundLight: '#161b22',
  folder: '#00ff88',
  file: '#808080',
  text: '#c0c0c0',
  textBright: '#ffffff',
  textDim: '#606060',
  border: '#30363d',
  borderBright: '#58a6ff',
  executable: '#ff6b6b',
  archive: '#ffd700',
  filesContainer: '#4a9eff',
}

// Highlight color options (masculine/bold colors)
export const HIGHLIGHT_COLOR_OPTIONS = {
  ELECTRIC_CYAN: '#00D9FF',      // Electric cyan - techy, sharp
  DEEP_CRIMSON: '#DC143C',       // Deep crimson red - bold, strong
  VIBRANT_PURPLE: '#9945ff',     // Vibrant purple - default
} as const

export const HOVER_HIGHLIGHT_COLOR = '#9945ff'  // Default: Vibrant purple (will be overridden dynamically)

export const FILE_TYPE_COLORS: Record<string, string> = {
  'sh': TERMINAL_COLORS.executable,
  'exe': TERMINAL_COLORS.executable,
  'zip': TERMINAL_COLORS.archive,
  'tar': TERMINAL_COLORS.archive,
  'gz': TERMINAL_COLORS.archive,
  'rar': TERMINAL_COLORS.archive,
  'default': TERMINAL_COLORS.file
}

export const STORAGE_QUOTA_TB = 500
export const FILE_COUNT_QUOTA = 77_000_000

export const SIZE_SEVERITY = {
  NEGLIGIBLE: 10 * 1024 * 1024,
  SMALL: 1024 * 1024 * 1024,
  MEDIUM: 10 * 1024 * 1024 * 1024,
  LARGE: 50 * 1024 * 1024 * 1024,
}

export const FILE_COUNT_SEVERITY = {
  NEGLIGIBLE: 100,
  SMALL: 1000,
  MEDIUM: 10000,
  LARGE: 100000,
}
