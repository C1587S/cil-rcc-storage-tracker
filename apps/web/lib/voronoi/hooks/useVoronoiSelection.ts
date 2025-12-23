import { useState, useCallback } from 'react'
import * as d3 from 'd3'
import { type PartitionInfo } from '@/lib/voronoi/utils/types'
import { HOVER_HIGHLIGHT_COLOR } from '@/lib/voronoi/utils/constants'

export function useVoronoiSelection() {
  const [selectedPartition, setSelectedPartition] = useState<PartitionInfo | null>(null)
  const [hoveredPartition, setHoveredPartition] = useState<PartitionInfo | null>(null)
  const [selectedFileInPanel, setSelectedFileInPanel] = useState<string | null>(null)

  const handleInspect = useCallback((info: PartitionInfo) => {
    setSelectedPartition(info)
    setSelectedFileInPanel(null)
  }, [])

  const handleFileClickInPanel = useCallback((filePath: string) => {
    setSelectedFileInPanel(filePath)
    d3.selectAll('.file-bubble').classed('highlighted', false).attr('stroke-width', 0.5).attr('stroke', 'rgba(255,255,255,0.4)')
    d3.select(`.file-bubble[data-path="${filePath}"]`).classed('highlighted', true).attr('stroke-width', 2.5).attr('stroke', HOVER_HIGHLIGHT_COLOR).raise()
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedPartition(null)
    setHoveredPartition(null)
    setSelectedFileInPanel(null)
  }, [])

  return {
    selectedPartition,
    hoveredPartition,
    selectedFileInPanel,
    setSelectedPartition,
    setHoveredPartition,
    setSelectedFileInPanel,
    handleInspect,
    handleFileClickInPanel,
    clearSelection,
  }
}
