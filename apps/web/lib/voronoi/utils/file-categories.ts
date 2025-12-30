/**
 * File categorization and color mapping system
 * Based on ClickHouse classification query
 */

export type FileCategory =
  | 'tabular'
  | 'scientific'
  | 'image'
  | 'document'
  | 'code'
  | 'binary'
  | 'compressed'
  | 'config'
  | 'runtime'
  | 'other'

export interface CategoryInfo {
  name: string
  description: string
  color: string
  icon: string // We'll use icon names from lucide-react
  examples: string[] // Example file extensions for this category
}

/**
 * 10-color palette for file categories (dark mode)
 */
export const CATEGORY_COLORS: Record<FileCategory, string> = {
  tabular: '#2c4875',      // Deep blue
  scientific: '#5b4c82',   // Purple
  image: '#8a508f',        // Magenta
  document: '#cc0863',     // Pink
  code: '#ff6361',         // Coral red
  binary: '#ff8531',       // Orange
  compressed: '#ffa600',   // Gold
  config: '#8cb357',       // Green
  runtime: '#18bfae',      // Teal
  other: '#53cbef'         // Light blue
}

/**
 * Pastel color palette for file categories (light mode)
 * Vibrant pastel versions maintaining dark mode hues with better differentiation
 */
export const CATEGORY_COLORS_LIGHT: Record<FileCategory, string> = {
  tabular: '#6b8ab8',      // Medium pastel blue
  scientific: '#9a85b3',   // Medium pastel purple
  image: '#c97fb5',        // Medium pastel magenta
  document: '#e65a99',     // Medium pastel pink
  code: '#ff9896',         // Medium pastel coral
  compressed: '#ffbb66',   // Medium pastel gold
  binary: '#ffaa66',       // Medium pastel orange
  config: '#afd87f',       // Medium pastel green
  runtime: '#5dd9cc',      // Medium pastel teal
  other: '#7fcdeb'         // Medium pastel light blue
}

/**
 * Category metadata for legend display
 */
export const CATEGORY_INFO: Record<FileCategory, CategoryInfo> = {
  tabular: {
    name: 'Tabular',
    description: 'Structured data tables',
    color: CATEGORY_COLORS.tabular,
    icon: 'Database',
    examples: ['.csv', '.tsv', '.json', '.xml', '.feather', '.rds']
  },
  scientific: {
    name: 'Scientific',
    description: 'Numerical & scientific data',
    color: CATEGORY_COLORS.scientific,
    icon: 'FlaskConical',
    examples: ['.nc', '.nc4', '.zarr', '.h5', '.hdf', '.mat', '.fits']
  },
  image: {
    name: 'Images',
    description: 'Photos & graphics',
    color: CATEGORY_COLORS.image,
    icon: 'Image',
    examples: ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.svg', '.gif']
  },
  document: {
    name: 'Documents',
    description: 'Text documents & presentations',
    color: CATEGORY_COLORS.document,
    icon: 'FileText',
    examples: ['.pdf', '.docx', '.pptx', '.xlsx', '.md', '.tex', '.html']
  },
  code: {
    name: 'Code',
    description: 'Source code & scripts',
    color: CATEGORY_COLORS.code,
    icon: 'Code',
    examples: ['.py', '.R', '.js', '.ts', '.java', '.cpp', '.ipynb']
  },
  binary: {
    name: 'Binary',
    description: 'Executables & compiled files',
    color: CATEGORY_COLORS.binary,
    icon: 'Cpu',
    examples: ['.exe', '.dll', '.so', '.bin', '.class', '.jar', '.o']
  },
  compressed: {
    name: 'Compressed',
    description: 'Archives & packages',
    color: CATEGORY_COLORS.compressed,
    icon: 'Archive',
    examples: ['.zip', '.tar', '.gz', '.bz2', '.7z', '.whl', '.conda']
  },
  config: {
    name: 'Config',
    description: 'Configuration files',
    color: CATEGORY_COLORS.config,
    icon: 'Settings',
    examples: ['.yaml', '.yml', '.ini', '.cfg', '.toml', '.env', '.conf']
  },
  runtime: {
    name: 'Runtime',
    description: 'Logs & temporary files',
    color: CATEGORY_COLORS.runtime,
    icon: 'Activity',
    examples: ['.log', '.out', '.err', '.tmp', '.cache', '.swp', '.dmp']
  },
  other: {
    name: 'Other',
    description: 'Uncategorized files',
    color: CATEGORY_COLORS.other,
    icon: 'MoreHorizontal',
    examples: ['miscellaneous', 'unknown types']
  }
}

/**
 * Extension to category mapping
 * Based on ClickHouse classification logic
 */
const EXTENSION_CATEGORY_MAP: Record<string, FileCategory> = {
  // Tabular
  'csv': 'tabular',
  'tsv': 'tabular',
  'json': 'tabular',
  'xml': 'tabular',
  'dbf': 'tabular',
  'rds': 'tabular',
  'dta': 'tabular',
  'feather': 'tabular',
  'dat': 'tabular',

  // Scientific
  'nc': 'scientific',
  'nc4': 'scientific',
  'ncml': 'scientific',
  'h5': 'scientific',
  'hdf': 'scientific',
  'grb': 'scientific',
  'grb2': 'scientific',
  'fits': 'scientific',
  'mat': 'scientific',

  // Images
  'png': 'image',
  'jpg': 'image',
  'jpeg': 'image',
  'gif': 'image',
  'tif': 'image',
  'tiff': 'image',
  'svg': 'image',
  'bmp': 'image',
  'cr2': 'image',

  // Documents
  'pdf': 'document',
  'doc': 'document',
  'docx': 'document',
  'ppt': 'document',
  'pptx': 'document',
  'xls': 'document',
  'xlsx': 'document',
  'odt': 'document',
  'rtf': 'document',
  'tex': 'document',
  'md': 'document',
  'html': 'document',
  'htm': 'document',

  // Code
  'py': 'code',
  'pyi': 'code',
  'pyx': 'code',
  'ipynb': 'code',
  'js': 'code',
  'ts': 'code',
  'java': 'code',
  'cpp': 'code',
  'c': 'code',
  'h': 'code',
  'hpp': 'code',
  'cs': 'code',
  'lua': 'code',
  'php': 'code',
  'rb': 'code',
  'r': 'code',
  'jl': 'code',
  'sh': 'code',
  'pl': 'code',
  'css': 'code',

  // Binary
  'exe': 'binary',
  'dll': 'binary',
  'so': 'binary',
  'bin': 'binary',
  'class': 'binary',
  'jar': 'binary',
  'o': 'binary',
  'a': 'binary',

  // Compressed
  'gz': 'compressed',
  'tgz': 'compressed',
  'bz2': 'compressed',
  'xz': 'compressed',
  'zip': 'compressed',
  'tar': 'compressed',
  '7z': 'compressed',
  'whl': 'compressed',
  'conda': 'compressed',

  // Config
  'ini': 'config',
  'cfg': 'config',
  'conf': 'config',
  'yaml': 'config',
  'yml': 'config',
  'env': 'config',
  'toml': 'config',

  // Runtime
  'log': 'runtime',
  'out': 'runtime',
  'err': 'runtime',
  'tmp': 'runtime',
  'cache': 'runtime',
  'dmp': 'runtime',
  'swp': 'runtime'
}

/**
 * Extract file extension from path or filename
 */
function getFileExtension(path: string): string {
  const match = path.match(/\.([A-Za-z0-9]{1,12})$/)
  return match ? match[1].toLowerCase() : ''
}

/**
 * Get category for a file based on its path/name
 */
export function getFileCategory(path: string): FileCategory {
  const ext = getFileExtension(path)
  return EXTENSION_CATEGORY_MAP[ext] || 'other'
}

/**
 * Get color for a file based on its category and theme
 */
export function getFileCategoryColor(path: string, theme: 'dark' | 'light' = 'dark'): string {
  const category = getFileCategory(path)
  return theme === 'dark' ? CATEGORY_COLORS[category] : CATEGORY_COLORS_LIGHT[category]
}

/**
 * Get all categories in display order
 */
export function getAllCategories(): FileCategory[] {
  return [
    'tabular',
    'scientific',
    'image',
    'document',
    'code',
    'binary',
    'compressed',
    'config',
    'runtime',
    'other'
  ]
}
