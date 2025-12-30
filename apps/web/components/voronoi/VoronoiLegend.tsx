import { useAppStore } from '@/lib/store'

export function VoronoiLegend() {
  const theme = useAppStore(state => state.theme)

  return (
    <div className="space-y-2 text-[10px]">
      <div className={theme === 'dark' ? 'text-gray-500' : 'text-muted-foreground/80'}>
        <div className="mb-1">
          <span className="font-bold">Polygons:</span> Represent subfolders within the current directory.
          Size is proportional to total bytes stored. Voronoi representation shows space occupied relative to /project/cil.
          <span className="italic ml-1">(Dotted polygons indicate regions containing files not within subfolders)</span>
        </div>
        <div>
          <span className="font-bold">Bubbles:</span> Represent individual files within the directory.
        </div>
      </div>
    </div>
  )
}
