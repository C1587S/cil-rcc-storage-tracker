/**
 * Global bubble size categorization system
 * Maps file sizes to 10 fixed size categories for consistent visualization
 */

export interface BubbleSizeCategory {
  name: string
  minSize: number  // bytes
  maxSize: number  // bytes (Infinity for largest category)
  radius: number   // pixels
  description: string
}

/**
 * 10 fixed bubble size categories (global, not partition-relative)
 * Radii chosen to be visually distinct and fit well in partitions
 */
export const BUBBLE_SIZE_CATEGORIES: BubbleSizeCategory[] = [
  {
    name: 'Tiny',
    minSize: 0,
    maxSize: 100 * 1024,  // < 100 KB
    radius: 3,
    description: '< 100 KB'
  },
  {
    name: 'Very Small',
    minSize: 100 * 1024,
    maxSize: 1024 * 1024,  // 100 KB - 1 MB
    radius: 5,
    description: '100 KB - 1 MB'
  },
  {
    name: 'Small',
    minSize: 1024 * 1024,
    maxSize: 10 * 1024 * 1024,  // 1 MB - 10 MB
    radius: 7,
    description: '1 MB - 10 MB'
  },
  {
    name: 'Medium Small',
    minSize: 10 * 1024 * 1024,
    maxSize: 50 * 1024 * 1024,  // 10 MB - 50 MB
    radius: 9,
    description: '10 MB - 50 MB'
  },
  {
    name: 'Medium',
    minSize: 50 * 1024 * 1024,
    maxSize: 100 * 1024 * 1024,  // 50 MB - 100 MB
    radius: 11,
    description: '50 MB - 100 MB'
  },
  {
    name: 'Medium Large',
    minSize: 100 * 1024 * 1024,
    maxSize: 500 * 1024 * 1024,  // 100 MB - 500 MB
    radius: 14,
    description: '100 MB - 500 MB'
  },
  {
    name: 'Large',
    minSize: 500 * 1024 * 1024,
    maxSize: 1024 * 1024 * 1024,  // 500 MB - 1 GB
    radius: 17,
    description: '500 MB - 1 GB'
  },
  {
    name: 'Very Large',
    minSize: 1024 * 1024 * 1024,
    maxSize: 5 * 1024 * 1024 * 1024,  // 1 GB - 5 GB
    radius: 20,
    description: '1 GB - 5 GB'
  },
  {
    name: 'Huge',
    minSize: 5 * 1024 * 1024 * 1024,
    maxSize: 10 * 1024 * 1024 * 1024,  // 5 GB - 10 GB
    radius: 24,
    description: '5 GB - 10 GB'
  },
  {
    name: 'Massive',
    minSize: 10 * 1024 * 1024 * 1024,
    maxSize: Infinity,  // > 10 GB
    radius: 28,
    description: '> 10 GB'
  }
]

/**
 * Get bubble radius based on file size (global categorization)
 * @param fileSize - File size in bytes
 * @returns Radius in pixels from the appropriate size category
 */
export function getBubbleRadius(fileSize: number): number {
  for (const category of BUBBLE_SIZE_CATEGORIES) {
    if (fileSize >= category.minSize && fileSize < category.maxSize) {
      return category.radius
    }
  }
  // Fallback to smallest category
  return BUBBLE_SIZE_CATEGORIES[0].radius
}

/**
 * Get bubble size category for a file
 * @param fileSize - File size in bytes
 * @returns The matching size category
 */
export function getBubbleSizeCategory(fileSize: number): BubbleSizeCategory {
  for (const category of BUBBLE_SIZE_CATEGORIES) {
    if (fileSize >= category.minSize && fileSize < category.maxSize) {
      return category
    }
  }
  // Fallback to smallest category
  return BUBBLE_SIZE_CATEGORIES[0]
}

/**
 * Get all size categories for legend display
 */
export function getAllSizeCategories(): BubbleSizeCategory[] {
  return BUBBLE_SIZE_CATEGORIES
}
