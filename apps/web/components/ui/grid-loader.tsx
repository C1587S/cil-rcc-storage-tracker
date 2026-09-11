import { cn } from '@/lib/utils'

/**
 * Unified loading indicator: a grid of pulsing squares in the CIL palette,
 * with an optional short description below. Used across the app for any
 * loading state.
 */
export function GridLoader({ label, size = 12, className }: {
  label?: string
  size?: number
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <div className="loader-grid" style={{ ['--loader-grid-cell' as any]: `${size}px` }}>
        {Array.from({ length: 12 }).map((_, i) => <span key={i} />)}
      </div>
      {label && <div className="text-[11px] text-muted-foreground">{label}</div>}
    </div>
  )
}
