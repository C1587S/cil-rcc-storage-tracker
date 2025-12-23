'use client'

// DEBUG: Confirm file loaded
console.log('[VORONOI] file loaded - v7 COMPLETE REWRITE', new Date().toISOString())

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/lib/store'
import { buildVoronoiTree, type VoronoiNode } from '@/lib/voronoi-data-adapter'
import * as d3 from 'd3'
// @ts-ignore - d3-voronoi-treemap types may not be available
import { voronoiTreemap } from 'd3-voronoi-treemap'
import { formatBytes } from '@/lib/utils/formatters'
import { getSizeFillColor } from '@/lib/utils/icon-helpers'
import { Button } from '@/components/ui/button'
import { Maximize2, Minimize2, Focus, Target, Folder, FileText, ChevronLeft, HardDrive, Files, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getSnapshots } from '@/lib/api'
import {
  TERMINAL_COLORS,
  HOVER_HIGHLIGHT_COLOR,
  STORAGE_QUOTA_TB,
  FILE_COUNT_QUOTA,
} from '@/lib/voronoi/utils/constants'
import {
  getSizeSeverity,
  getFileCountSeverity,
  getQuotaColor,
  getQuotaTextColor,
  getFileColor,
} from '@/lib/voronoi/utils/colors'
import {
  isValidPolygon,
  getPolygonBounds,
  constrainToPolygon,
} from '@/lib/voronoi/utils/geometry'
import { packCirclesInPolygon } from '@/lib/voronoi/utils/circle-packing'
import { type PartitionInfo, type VoronoiCacheEntry } from '@/lib/voronoi/utils/types'

// --- COMPONENT ---

export function HierarchicalVoronoiView() {
  const { selectedSnapshot, referencePath } = useAppStore()
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const simulationRef = useRef<d3.Simulation<any, undefined> | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  // Single source of truth for navigation
  const [viewingPath, setViewingPath] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  
  // UI states
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [selectedPartition, setSelectedPartition] = useState<PartitionInfo | null>(null)
  const [hoveredPartition, setHoveredPartition] = useState<PartitionInfo | null>(null)
  const [selectedFileInPanel, setSelectedFileInPanel] = useState<string | null>(null)
  
  // Navigation lock
  const [navigationLock, setNavigationLock] = useState(false)
  const navigationLockRef = useRef(false)
  
  const zoomRef = useRef<any>(null)
  const voronoiCacheRef = useRef<Map<string, VoronoiCacheEntry>>(new Map())

  const { data: snapshots } = useQuery({ queryKey: ['snapshots'], queryFn: getSnapshots })
  
  const basePath = referencePath || '/project/cil'
  const effectivePath = viewingPath || basePath
  
  // CRITICAL: Store in ref for click handlers
  const effectivePathRef = useRef(effectivePath)
  effectivePathRef.current = effectivePath

  console.log('[STATE] effectivePath:', effectivePath, '| viewingPath:', viewingPath, '| history:', history.length, '| locked:', navigationLock)

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['voronoi-tree-hierarchical', selectedSnapshot, effectivePath],
    queryFn: () => {
      console.log('[QUERY] Fetching data for:', effectivePath)
      return buildVoronoiTree(selectedSnapshot!, effectivePath, 2, 1000)
    },
    enabled: !!selectedSnapshot && !!effectivePath,
    staleTime: 1000 * 60 * 5,
  })

  // Unlock when data arrives
  useEffect(() => {
    if (data && !isLoading && !isFetching) {
      console.log('[DATA] Ready, unlocking')
      setNavigationLock(false)
      navigationLockRef.current = false
    }
  }, [data, isLoading, isFetching])

  const viewRootSize = data?.size || 0
  const projectSize = viewRootSize
  const storageTB = projectSize / (1024 ** 4)
  const storageQuotaPercent = (storageTB / STORAGE_QUOTA_TB) * 100
  const parentSize = viewRootSize

  const getPartitionQuotaPercent = useCallback((size: number) => projectSize > 0 ? (size / projectSize) * 100 : 0, [projectSize])
  const getFileQuotaPercent = useCallback((fileCount: number) => (fileCount / FILE_COUNT_QUOTA) * 100, [])
  const getParentQuotaPercent = useCallback((size: number) => parentSize > 0 ? (size / parentSize) * 100 : 0, [parentSize])

  // DRILL DOWN - reads from ref for current path
  const performDrillDown = useCallback((targetPath: string) => {
    const currentPath = effectivePathRef.current
    
    console.log('[DRILL] Target:', targetPath, '| Current (ref):', currentPath, '| Locked:', navigationLockRef.current)
    
    if (navigationLockRef.current) {
      console.log('[DRILL] BLOCKED - locked')
      return
    }
    
    if (!targetPath || targetPath === currentPath) {
      console.log('[DRILL] BLOCKED - invalid or same')
      return
    }
    
    console.log('[DRILL] ✓ NAVIGATING to:', targetPath)
    navigationLockRef.current = true
    setNavigationLock(true)
    
    setHistory(prev => [...prev, currentPath])
    setViewingPath(targetPath)
    setSelectedPartition(null)
    setHoveredPartition(null)
    setSelectedFileInPanel(null)
  }, [])

  const navigateBack = useCallback(() => {
    if (navigationLockRef.current || history.length === 0) return
    
    navigationLockRef.current = true
    setNavigationLock(true)
    
    const newHistory = [...history]
    const previousPath = newHistory.pop()!
    
    console.log('[BACK] To:', previousPath)
    
    setHistory(newHistory)
    setViewingPath(previousPath === basePath ? null : previousPath)
    setSelectedPartition(null)
    setHoveredPartition(null)
    setSelectedFileInPanel(null)
  }, [history, basePath])

  const navigateToBreadcrumb = useCallback((targetPath: string) => {
    if (navigationLockRef.current || targetPath === effectivePath) return
    
    navigationLockRef.current = true
    setNavigationLock(true)
    
    const historyIndex = history.indexOf(targetPath)
    
    if (targetPath === basePath) {
      setHistory([])
      setViewingPath(null)
    } else if (historyIndex >= 0) {
      setHistory(history.slice(0, historyIndex))
      setViewingPath(targetPath)
    }
    
    setSelectedPartition(null)
    setHoveredPartition(null)
    setSelectedFileInPanel(null)
  }, [history, basePath, effectivePath])

  const handleInspect = useCallback((info: PartitionInfo) => {
    setSelectedPartition(info)
    setSelectedFileInPanel(null)
  }, [])

  const resetZoom = useCallback(() => {
    if (zoomRef.current && svgRef.current) {
      d3.select(svgRef.current).transition().duration(500).call(zoomRef.current.transform, d3.zoomIdentity)
    }
  }, [])

  const toggleFullscreen = async () => {
    if (!wrapperRef.current) return
    try {
      if (!isFullscreen) {
        await wrapperRef.current.requestFullscreen()
        setIsFullscreen(true)
      } else {
        await document.exitFullscreen()
        setIsFullscreen(false)
      }
    } catch (e) {
      console.error('Fullscreen error:', e)
    }
  }

  const handleFileClickInPanel = useCallback((filePath: string) => {
    setSelectedFileInPanel(filePath)
    d3.selectAll('.file-bubble').classed('highlighted', false).attr('stroke-width', 0.5).attr('stroke', 'rgba(255,255,255,0.4)')
    d3.select(`.file-bubble[data-path="${filePath}"]`).classed('highlighted', true).attr('stroke-width', 2.5).attr('stroke', HOVER_HIGHLIGHT_COLOR).raise()
  }, [])

  // --- RENDER EFFECT ---
  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current) return
    if (navigationLock && isFetching) return

    console.log('[RENDER] For:', effectivePath)

    if (simulationRef.current) {
      simulationRef.current.stop()
      simulationRef.current = null
    }

    const container = containerRef.current
    const width = container.clientWidth
    const height = isFullscreen ? window.innerHeight - 280 : 550
    if (width === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height).style('background', TERMINAL_COLORS.background)

    const defs = svg.append('defs')
    const gRoot = svg.append('g').attr('id', 'voronoi-root')
    const gBackgrounds = gRoot.append('g').attr('class', 'layer-backgrounds')
    const gPreview = gRoot.append('g').attr('class', 'layer-preview')
    const gBubbles = gRoot.append('g').attr('class', 'layer-bubbles')
    const gLabels = gRoot.append('g').attr('class', 'layer-labels')
    const gInteraction = gRoot.append('g').attr('class', 'layer-interaction')

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 10])
      .translateExtent([[0, 0], [width, height]])
      .extent([[0, 0], [width, height]])
      .on('zoom', (event) => gRoot.attr('transform', event.transform))

    svg.call(zoom)
    zoomRef.current = zoom

    // Prepare hierarchy
    const prepareHierarchy = (n: VoronoiNode, depth: number = 0): any => {
      const uniqueId = `node-${Math.random().toString(36).substr(2, 9)}`
      if (!n.children || n.children.length === 0) return { ...n, uniqueId, depth }

      const dirs = n.children.filter(c => c.isDirectory)
      const files = n.children.filter(c => !c.isDirectory)
      const children = dirs.map(d => prepareHierarchy(d, depth + 1))

      if (files.length > 0) {
        const filesSize = files.reduce((acc, f) => acc + f.size, 0)
        children.push({
          name: '__files__',
          path: `${n.path}/__files__`,
          size: filesSize,
          isDirectory: false,
          isSynthetic: true,
          originalFiles: files,
          file_count: files.length,
          depth: depth + 1,
          uniqueId: `files-${Math.random().toString(36).substr(2, 9)}`
        })
      }

      return { ...n, children, uniqueId, depth }
    }

    const cacheKey = effectivePath
    const cached = voronoiCacheRef.current.get(cacheKey)
    
    let hierarchyData: any
    let hierarchy: d3.HierarchyNode<any>

    if (cached?.hierarchyData) {
      hierarchyData = cached.hierarchyData
      hierarchy = d3.hierarchy(hierarchyData)
        .sum(d => (!d.children || d.children.length === 0) ? Math.max(d.size || 1, 1) : 0)
        .sort((a, b) => (b.value || 0) - (a.value || 0))
      
      const applyCache = (h: d3.HierarchyNode<any>) => {
        if (h.data.cachedPolygon) (h as any).polygon = h.data.cachedPolygon
        h.children?.forEach(applyCache)
      }
      applyCache(hierarchy)
    } else {
      hierarchyData = prepareHierarchy(data)
      hierarchy = d3.hierarchy(hierarchyData)
        .sum(d => (!d.children || d.children.length === 0) ? Math.max(d.size || 1, 1) : 0)
        .sort((a, b) => (b.value || 0) - (a.value || 0))

      const padding = 15
      const clip: [number, number][] = [[padding, padding], [width - padding, padding], [width - padding, height - padding], [padding, height - padding]]

      const treemap = voronoiTreemap().clip(clip).maxIterationCount(50).convergenceRatio(0.01)

      const applyVoronoi = (h: d3.HierarchyNode<any>, poly: any, depth: number) => {
        try {
          treemap.clip(poly)(h)
          if (depth < 2 && h.children) {
            h.children.forEach(child => {
              if (child.data.isDirectory && !child.data.isSynthetic && (child as any).polygon) {
                applyVoronoi(child, (child as any).polygon, depth + 1)
              }
            })
          }
        } catch (err) {
          console.warn('Voronoi error', err)
        }
      }

      applyVoronoi(hierarchy, clip, 0)

      const saveCache = (h: d3.HierarchyNode<any>) => {
        if ((h as any).polygon) h.data.cachedPolygon = (h as any).polygon
        h.children?.forEach(saveCache)
      }
      saveCache(hierarchy)

      voronoiCacheRef.current.set(cacheKey, { path: cacheKey, hierarchyData, timestamp: Date.now() })
    }

    const allNodes = hierarchy.descendants().filter(d => d.depth > 0 && isValidPolygon((d as any).polygon))
    
    allNodes.forEach(d => {
      defs.append('clipPath')
        .attr('id', `clip-${d.data.uniqueId}`)
        .append('path')
        .attr('d', 'M' + (d as any).polygon.map((p: [number, number]) => p.join(',')).join('L') + 'Z')
    })

    const topLevelNodes = allNodes.filter(d => d.depth === 1)
    const previewNodes = allNodes.filter(d => d.depth === 2)

    console.log('[RENDER] Top-level:', topLevelNodes.length, 'paths:', topLevelNodes.map(d => d.data.path))

    // --- BACKGROUNDS ---
    topLevelNodes.forEach((d: any) => {
      const node = d.data
      const poly = d.polygon
      if (!poly) return

      const isSynthetic = node.isSynthetic
      let fillColor: string, fillOpacity: number, strokeColor: string, strokeWidth: number, strokeOpacity: number

      if (isSynthetic) {
        fillColor = TERMINAL_COLORS.filesContainer
        fillOpacity = 0.12
        strokeColor = TERMINAL_COLORS.filesContainer
        strokeWidth = 1.5
        strokeOpacity = 0.6
      } else if (node.isDirectory) {
        fillColor = getSizeFillColor(node.size)
        fillOpacity = 0.2
        strokeColor = fillColor
        strokeWidth = 2.5
        strokeOpacity = 0.7
      } else {
        fillColor = getFileColor(node.name)
        fillOpacity = 0.3
        strokeColor = fillColor
        strokeWidth = 1
        strokeOpacity = 0.6
      }

      gBackgrounds.append('path')
        .attr('class', 'voronoi-partition-bg')
        .attr('data-path', node.path)
        .attr('d', `M${poly.join('L')}Z`)
        .attr('fill', fillColor)
        .attr('fill-opacity', fillOpacity)
        .attr('stroke', strokeColor)
        .attr('stroke-width', strokeWidth)
        .attr('stroke-opacity', strokeOpacity)
        .attr('stroke-dasharray', isSynthetic ? '4,2' : 'none')
        .style('pointer-events', 'none')
        .datum({ path: node.path, baseColor: fillColor, baseFillOpacity: fillOpacity, baseStrokeColor: strokeColor, baseStrokeWidth: strokeWidth, baseStrokeOpacity: strokeOpacity, isSynthetic })
    })

    // --- PREVIEW ---
    previewNodes.forEach((d: any) => {
      const node = d.data
      const poly = d.polygon
      if (!poly) return

      const isSynthetic = node.isSynthetic
      let fillColor: string, fillOpacity: number, strokeColor: string, strokeWidth: number, strokeOpacity: number

      if (isSynthetic) {
        fillColor = TERMINAL_COLORS.filesContainer
        fillOpacity = 0.03
        strokeColor = TERMINAL_COLORS.filesContainer
        strokeWidth = 0.5
        strokeOpacity = 0.25
      } else if (node.isDirectory) {
        fillColor = getSizeFillColor(node.size)
        fillOpacity = 0.03
        strokeColor = '#ffffff'
        strokeWidth = 1.2
        strokeOpacity = 0.5
      } else {
        fillColor = getFileColor(node.name)
        fillOpacity = 0.08
        strokeColor = fillColor
        strokeWidth = 0.5
        strokeOpacity = 0.25
      }

      gPreview.append('path')
        .attr('class', 'voronoi-partition-preview')
        .attr('data-path', node.path)
        .attr('d', `M${poly.join('L')}Z`)
        .attr('fill', fillColor)
        .attr('fill-opacity', fillOpacity)
        .attr('stroke', strokeColor)
        .attr('stroke-width', strokeWidth)
        .attr('stroke-opacity', strokeOpacity)
        .attr('stroke-dasharray', isSynthetic ? '3,1' : 'none')
        .style('pointer-events', 'none')
    })

    // --- FILE BUBBLES ---
    topLevelNodes.forEach((d: any) => {
      const node = d.data
      const poly = d.polygon
      if (!poly || !node.isSynthetic || !node.originalFiles) return

      const circles = packCirclesInPolygon(poly, node.originalFiles.map((f: any) => ({ node: f, value: f.size })), 20)

      circles.forEach((c) => {
        const bubble = gBubbles.append('circle')
          .attr('class', 'file-bubble')
          .attr('data-path', c.node.path)
          .attr('cx', c.x)
          .attr('cy', c.y)
          .attr('r', c.r)
          .attr('fill', getFileColor(c.node.name))
          .attr('fill-opacity', 0.7)
          .attr('stroke', 'rgba(255,255,255,0.4)')
          .attr('stroke-width', 0.5)
          .attr('clip-path', `url(#clip-${node.uniqueId})`)
          .style('cursor', 'grab')
          .style('pointer-events', 'all')
          .datum({ ...c, polygon: poly, centroid: d3.polygonCentroid(poly) })

        bubble
          .on('mouseenter', function(event: MouseEvent) {
            event.stopPropagation()
            const tooltip = tooltipRef.current
            if (tooltip) {
              tooltip.style.display = 'block'
              tooltip.style.left = event.pageX + 10 + 'px'
              tooltip.style.top = event.pageY + 10 + 'px'
              tooltip.innerHTML = `<div class="font-mono text-xs"><div class="font-bold text-cyan-400">${c.node.name}</div><div class="text-gray-400">${formatBytes(c.node.size)}</div></div>`
            }
            d3.select(this).attr('stroke', HOVER_HIGHLIGHT_COLOR).attr('stroke-width', 2)
          })
          .on('mousemove', function(event: MouseEvent) {
            const tooltip = tooltipRef.current
            if (tooltip) {
              tooltip.style.left = event.pageX + 10 + 'px'
              tooltip.style.top = event.pageY + 10 + 'px'
            }
          })
          .on('mouseleave', function() {
            const tooltip = tooltipRef.current
            if (tooltip) tooltip.style.display = 'none'
            if (!d3.select(this).classed('highlighted')) {
              d3.select(this).attr('stroke', 'rgba(255,255,255,0.4)').attr('stroke-width', 0.5)
            }
          })
      })

      // Physics
      interface BubbleNode extends d3.SimulationNodeDatum { id: string; r: number; node: VoronoiNode; polygon: any }
      const bubbleNodes: BubbleNode[] = circles.map((c, i) => ({ id: `b-${node.uniqueId}-${i}`, x: c.x, y: c.y, r: c.r, node: c.node, polygon: poly }))

      if (bubbleNodes.length > 0) {
        const simulation = d3.forceSimulation(bubbleNodes)
          .force('collision', d3.forceCollide<BubbleNode>().radius(d => d.r + 1).strength(0.8))
          .force('center', d3.forceCenter(d3.polygonCentroid(poly)[0], d3.polygonCentroid(poly)[1]).strength(0.05))
          .force('charge', d3.forceManyBody<BubbleNode>().strength(-5))
          .alphaDecay(0.05)
          .on('tick', () => {
            bubbleNodes.forEach(b => {
              const c = constrainToPolygon(b.x!, b.y!, b.polygon, b.r)
              b.x = c[0]
              b.y = c[1]
            })
            gBubbles.selectAll<SVGCircleElement, any>('.file-bubble').each(function(datum: any) {
              const bn = bubbleNodes.find(b => b.node.path === datum.node.path)
              if (bn) d3.select(this).attr('cx', bn.x!).attr('cy', bn.y!)
            })
          })

        simulationRef.current = simulation

        const drag = d3.drag<SVGCircleElement, any>()
          .on('start', function(event) {
            event.sourceEvent.stopPropagation()
            if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0.3).restart()
            d3.select(this).style('cursor', 'grabbing')
            const datum = d3.select(this).datum() as any
            const bn = bubbleNodes.find(b => b.node.path === datum.node.path)
            if (bn) { bn.fx = bn.x; bn.fy = bn.y }
          })
          .on('drag', function(event) {
            const datum = d3.select(this).datum() as any
            const bn = bubbleNodes.find(b => b.node.path === datum.node.path)
            if (bn) {
              const c = constrainToPolygon(event.x, event.y, datum.polygon, bn.r)
              bn.fx = c[0]
              bn.fy = c[1]
            }
          })
          .on('end', function(event) {
            if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0)
            d3.select(this).style('cursor', 'grab')
            const datum = d3.select(this).datum() as any
            const bn = bubbleNodes.find(b => b.node.path === datum.node.path)
            if (bn) { bn.fx = null; bn.fy = null }
          })

        gBubbles.selectAll('.file-bubble').call(drag as any)
      }
    })

    // --- LABELS ---
    topLevelNodes.forEach((d: any) => {
      const node = d.data
      const poly = d.polygon
      if (!poly) return

      const bounds = getPolygonBounds(poly)
      if (bounds.width > 30 && bounds.height > 20) {
        const centroid = d3.polygonCentroid(poly)
        const displayName = node.isSynthetic ? `${node.file_count} files` : (node.name.length > 20 ? node.name.slice(0, 17) + '...' : node.name)
        const fontSize = Math.min(13, Math.max(7, bounds.width / displayName.length * 1.2))

        gLabels.append('text')
          .attr('x', centroid[0])
          .attr('y', centroid[1])
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('fill', node.isSynthetic ? TERMINAL_COLORS.filesContainer : '#b0b0b0')
          .attr('stroke', 'white')
          .attr('stroke-width', 0.5)
          .attr('font-size', fontSize)
          .attr('font-weight', '600')
          .attr('font-family', 'monospace')
          .style('pointer-events', 'none')
          .style('paint-order', 'stroke fill')
          .text(displayName)
      }
    })

    // --- INTERACTION OVERLAYS ---
    topLevelNodes.forEach((d: any) => {
      const node = d.data
      const poly = d.polygon
      if (!poly) return

      const partitionInfo: PartitionInfo = {
        name: node.isSynthetic ? `Files (${node.file_count})` : node.name,
        path: node.path,
        size: node.size,
        file_count: node.file_count || 0,
        isDirectory: node.isDirectory,
        isSynthetic: node.isSynthetic,
        quotaPercent: getPartitionQuotaPercent(node.size),
        fileQuotaPercent: getFileQuotaPercent(node.file_count || 0),
        parentSize: parentSize,
        parentQuotaPercent: getParentQuotaPercent(node.size),
        depth: 1,
        originalFiles: node.originalFiles
      }

      const overlay = gInteraction.append('path')
        .attr('class', 'voronoi-interaction-overlay')
        .attr('data-path', node.path)
        .attr('data-is-directory', node.isDirectory ? 'true' : 'false')
        .attr('data-is-synthetic', node.isSynthetic ? 'true' : 'false')
        .attr('d', `M${poly.join('L')}Z`)
        .attr('fill', 'transparent')
        .attr('stroke', 'none')
        .style('cursor', (!node.isSynthetic && node.isDirectory) ? 'pointer' : 'default')
        .style('pointer-events', node.isSynthetic ? 'none' : 'all')
        .datum(partitionInfo)

      if (!node.isSynthetic) {
        overlay
          .on('mouseenter', function(event: MouseEvent) {
            if ((event.relatedTarget as Element)?.classList?.contains('file-bubble')) return
            const pathAttr = d3.select(this).attr('data-path')
            gBackgrounds.selectAll('.voronoi-partition-bg')
              .filter(function() { return d3.select(this).attr('data-path') === pathAttr })
              .attr('fill', HOVER_HIGHLIGHT_COLOR)
              .attr('fill-opacity', 0.35)
              .attr('stroke', HOVER_HIGHLIGHT_COLOR)
              .attr('stroke-width', 3.5)
              .attr('stroke-opacity', 1)
              .style('filter', `drop-shadow(0 0 8px ${HOVER_HIGHLIGHT_COLOR})`)
            setHoveredPartition(d3.select(this).datum() as PartitionInfo)
          })
          .on('mouseleave', function(event: MouseEvent) {
            if ((event.relatedTarget as Element)?.classList?.contains('file-bubble')) return
            const pathAttr = d3.select(this).attr('data-path')
            const data = d3.select(this).datum() as PartitionInfo
            if (selectedPartition?.path !== data.path) {
              gBackgrounds.selectAll('.voronoi-partition-bg')
                .filter(function() { return d3.select(this).attr('data-path') === pathAttr })
                .each(function() {
                  const bg = d3.select(this).datum() as any
                  d3.select(this)
                    .attr('fill', bg.baseColor)
                    .attr('fill-opacity', bg.baseFillOpacity)
                    .attr('stroke', bg.baseStrokeColor)
                    .attr('stroke-width', bg.baseStrokeWidth)
                    .attr('stroke-opacity', bg.baseStrokeOpacity)
                    .style('filter', 'none')
                })
            }
            setHoveredPartition(null)
          })

        overlay.on('contextmenu', function(e: MouseEvent) {
          e.preventDefault()
          const pathAttr = d3.select(this).attr('data-path')
          gBackgrounds.selectAll('.voronoi-partition-bg').style('filter', 'none')
          gBackgrounds.selectAll('.voronoi-partition-bg')
            .filter(function() { return d3.select(this).attr('data-path') === pathAttr })
            .style('filter', `drop-shadow(0 0 12px ${HOVER_HIGHLIGHT_COLOR})`)
          handleInspect(d3.select(this).datum() as PartitionInfo)
        })

        // CRITICAL: Click reads path from DOM attribute
        if (node.isDirectory) {
          overlay.on('click', function(e: MouseEvent) {
            e.stopPropagation()
            const clickedPath = d3.select(this).attr('data-path')
            const isDir = d3.select(this).attr('data-is-directory') === 'true'
            const isSyn = d3.select(this).attr('data-is-synthetic') === 'true'
            console.log('[CLICK] path:', clickedPath, '| isDir:', isDir, '| isSyn:', isSyn)
            if (clickedPath && isDir && !isSyn) {
              performDrillDown(clickedPath)
            }
          })
        }
      }
    })

    // Synthetic hover zones
    topLevelNodes.forEach((d: any) => {
      const node = d.data
      const poly = d.polygon
      if (!poly || !node.isSynthetic) return

      const partitionInfo: PartitionInfo = {
        name: `Files (${node.file_count})`,
        path: node.path,
        size: node.size,
        file_count: node.file_count || 0,
        isDirectory: false,
        isSynthetic: true,
        quotaPercent: getPartitionQuotaPercent(node.size),
        fileQuotaPercent: getFileQuotaPercent(node.file_count || 0),
        parentSize: parentSize,
        parentQuotaPercent: getParentQuotaPercent(node.size),
        depth: 1,
        originalFiles: node.originalFiles
      }

      gBackgrounds.append('path')
        .attr('class', 'voronoi-synthetic-hover-zone')
        .attr('data-path', node.path)
        .attr('d', `M${poly.join('L')}Z`)
        .attr('fill', 'transparent')
        .attr('stroke', 'none')
        .style('pointer-events', 'all')
        .lower()
        .datum(partitionInfo)
        .on('mouseenter', function() {
          const pathAttr = d3.select(this).attr('data-path')
          gBackgrounds.selectAll('.voronoi-partition-bg')
            .filter(function() { return d3.select(this).attr('data-path') === pathAttr })
            .attr('fill', HOVER_HIGHLIGHT_COLOR)
            .attr('fill-opacity', 0.2)
            .attr('stroke', HOVER_HIGHLIGHT_COLOR)
            .attr('stroke-width', 2)
            .attr('stroke-opacity', 0.8)
            .style('filter', `drop-shadow(0 0 6px ${HOVER_HIGHLIGHT_COLOR})`)
          setHoveredPartition(d3.select(this).datum() as PartitionInfo)
        })
        .on('mouseleave', function() {
          const pathAttr = d3.select(this).attr('data-path')
          const data = d3.select(this).datum() as PartitionInfo
          if (selectedPartition?.path !== data.path) {
            gBackgrounds.selectAll('.voronoi-partition-bg')
              .filter(function() { return d3.select(this).attr('data-path') === pathAttr })
              .each(function() {
                const bg = d3.select(this).datum() as any
                d3.select(this)
                  .attr('fill', bg.baseColor)
                  .attr('fill-opacity', bg.baseFillOpacity)
                  .attr('stroke', bg.baseStrokeColor)
                  .attr('stroke-width', bg.baseStrokeWidth)
                  .attr('stroke-opacity', bg.baseStrokeOpacity)
                  .style('filter', 'none')
              })
          }
          setHoveredPartition(null)
        })
        .on('contextmenu', function(e: MouseEvent) {
          e.preventDefault()
          handleInspect(d3.select(this).datum() as PartitionInfo)
        })
    })

  }, [data, effectivePath, isFullscreen, performDrillDown, handleInspect, getPartitionQuotaPercent, getFileQuotaPercent, getParentQuotaPercent, parentSize, selectedPartition, navigationLock, isFetching])

  // --- BREADCRUMB ---
  const breadcrumbParts = useMemo(() => {
    const parts: Array<{ name: string; path: string; isClickable: boolean }> = []
    
    const baseName = basePath.split('/').filter(Boolean).pop() || 'root'
    parts.push({ name: baseName, path: basePath, isClickable: effectivePath !== basePath })
    
    history.forEach((histPath) => {
      if (histPath !== basePath) {
        const name = histPath.split('/').filter(Boolean).pop() || histPath
        parts.push({ name, path: histPath, isClickable: histPath !== effectivePath })
      }
    })
    
    if (viewingPath && viewingPath !== basePath && !history.includes(viewingPath)) {
      const name = viewingPath.split('/').filter(Boolean).pop() || viewingPath
      parts.push({ name, path: viewingPath, isClickable: false })
    }
    
    return parts
  }, [basePath, history, viewingPath, effectivePath])

  const canGoBack = history.length > 0
  const activePartition = hoveredPartition || selectedPartition
  const isLocked = isLoading || isFetching || navigationLock

  return (
    <div ref={wrapperRef} className={cn("space-y-3 font-mono text-xs", isFullscreen && "fixed inset-0 z-50 bg-[#0a0e14] p-4")}>
      <div ref={tooltipRef} className="fixed pointer-events-none z-50 bg-black/90 border border-cyan-600 rounded px-2 py-1 hidden" />

      {/* HEADER */}
      <div className="flex flex-col border-b border-gray-800 pb-3 gap-3">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-lg font-bold text-white uppercase tracking-widest">Storage Voronoi Topology</h2>
            <p className="text-gray-500">{selectedSnapshot} · Snapshot Data</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 whitespace-nowrap text-[10px]">GLOBAL QUOTA:</span>
            <div className="flex-1 h-2 bg-gray-900 rounded-full overflow-hidden border border-gray-800">
              <div className={cn("h-full transition-all duration-1000", getQuotaColor(storageQuotaPercent))} style={{ width: `${Math.min(storageQuotaPercent, 100)}%` }} />
            </div>
            <span className={cn("font-bold min-w-[50px] text-right text-[10px]", getQuotaTextColor(storageQuotaPercent))}>{storageQuotaPercent.toFixed(1)}%</span>
            <span className="text-gray-600 text-[9px]">({formatBytes(projectSize)} / {STORAGE_QUOTA_TB}TB)</span>
          </div>

          {viewingPath && (
            <div className="flex items-center gap-2">
              <span className="text-gray-500 whitespace-nowrap text-[10px]">CURRENT DIR:</span>
              <div className="flex-1 h-2 bg-gray-900 rounded-full overflow-hidden border border-gray-800">
                <div className="h-full bg-cyan-600/70 transition-all duration-1000" style={{ width: '100%' }} />
              </div>
              <span className="font-bold min-w-[50px] text-right text-[10px] text-cyan-400">100%</span>
              <span className="text-gray-600 text-[9px]">({formatBytes(parentSize)})</span>
            </div>
          )}
        </div>
      </div>

      {/* PANELS */}
      <div className="flex gap-3">
        <div className="flex-1 bg-[#161b22] border border-gray-800 rounded-lg overflow-hidden h-[420px] flex flex-col">
          <div className="bg-gray-800/50 px-3 py-2 border-b border-gray-700 flex items-center gap-2 shrink-0">
            <Target className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-white uppercase text-[10px] tracking-wider">Partition Info</span>
          </div>

          <div className="p-3 overflow-y-auto flex-1">
            {activePartition ? (
              <div className="space-y-3">
                <div className="flex items-start gap-4">
                  <div className="flex items-center gap-2">
                    {activePartition.isSynthetic ? <Files className="w-6 h-6 text-blue-400" /> : activePartition.isDirectory ? <Folder className="w-6 h-6 text-green-400" /> : <FileText className="w-6 h-6 text-gray-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold truncate">{activePartition.name}</p>
                    <p className="text-gray-500 text-[10px] truncate">{activePartition.path}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                    <div className="flex items-center gap-1 mb-1"><HardDrive className="w-3 h-3 text-gray-600" /><label className="text-gray-600 text-[9px]">SIZE</label></div>
                    <div className="text-cyan-400 font-bold text-sm">{formatBytes(activePartition.size)}</div>
                    <div className={cn("text-[9px]", getSizeSeverity(activePartition.size).color)}>{getSizeSeverity(activePartition.size).label}</div>
                  </div>
                  <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                    <div className="flex items-center gap-1 mb-1"><BarChart3 className="w-3 h-3 text-gray-600" /><label className="text-gray-600 text-[9px]">STORAGE QUOTA</label></div>
                    <div className={cn("font-bold text-sm", getQuotaTextColor(activePartition.quotaPercent))}>{activePartition.quotaPercent.toFixed(2)}%</div>
                    <div className="text-gray-500 text-[9px]">of {STORAGE_QUOTA_TB}TB</div>
                  </div>
                  <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                    <div className="flex items-center gap-1 mb-1"><Files className="w-3 h-3 text-gray-600" /><label className="text-gray-600 text-[9px]">FILE COUNT</label></div>
                    <div className="text-white font-bold text-sm">{activePartition.file_count > 0 ? activePartition.file_count.toLocaleString() : '—'}</div>
                    {activePartition.file_count > 0 && <div className={cn("text-[9px]", getFileCountSeverity(activePartition.file_count).color)}>{getFileCountSeverity(activePartition.file_count).label}</div>}
                  </div>
                  <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                    <div className="flex items-center gap-1 mb-1"><BarChart3 className="w-3 h-3 text-gray-600" /><label className="text-gray-600 text-[9px]">FILE QUOTA</label></div>
                    <div className={cn("font-bold text-sm", getQuotaTextColor(activePartition.fileQuotaPercent))}>{activePartition.fileQuotaPercent.toFixed(3)}%</div>
                    <div className="text-gray-500 text-[9px]">of {(FILE_COUNT_QUOTA / 1_000_000).toFixed(0)}M</div>
                  </div>
                </div>

                {activePartition.parentQuotaPercent !== undefined && activePartition.parentQuotaPercent < 100 && (
                  <div className="bg-black/30 px-3 py-2 rounded border border-gray-800">
                    <div className="flex items-center gap-1 mb-1"><BarChart3 className="w-3 h-3 text-gray-600" /><label className="text-gray-600 text-[9px]">% OF CURRENT DIR</label></div>
                    <div className={cn("font-bold", getQuotaTextColor(activePartition.parentQuotaPercent))}>{activePartition.parentQuotaPercent.toFixed(1)}%</div>
                  </div>
                )}

                {activePartition.isSynthetic && activePartition.originalFiles && activePartition.originalFiles.length > 0 && (
                  <div className="bg-black/30 px-3 py-2 rounded border border-gray-800 max-h-48 overflow-y-auto">
                    <div className="text-gray-500 text-[9px] uppercase mb-2">Files in this region:</div>
                    <div className="space-y-1">
                      {activePartition.originalFiles.slice(0, 50).map((file, idx) => (
                        <div key={idx} onClick={() => handleFileClickInPanel(file.path)} className={cn("flex items-center justify-between gap-2 p-1 rounded hover:bg-cyan-950/30 cursor-pointer transition-colors", selectedFileInPanel === file.path && "bg-cyan-950/50 border border-cyan-700")}>
                          <span className="text-white text-[10px] truncate flex-1">{file.name}</span>
                          <span className="text-gray-400 text-[9px] whitespace-nowrap">{formatBytes(file.size)}</span>
                        </div>
                      ))}
                      {activePartition.originalFiles.length > 50 && <div className="text-gray-600 text-[9px] italic pt-1">+ {activePartition.originalFiles.length - 50} more files</div>}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3 text-gray-600 py-2"><Focus className="w-5 h-5" /><span className="italic">Hover or right-click a partition to view details</span></div>
            )}
          </div>
        </div>

        <div className="w-56 bg-[#161b22]/50 border border-gray-800 rounded-lg p-3 h-[420px] flex flex-col">
          <h4 className="text-white font-bold uppercase text-[9px] tracking-widest border-b border-gray-800 pb-2 mb-2 shrink-0">Controls</h4>
          <div className="space-y-1.5 text-[10px]">
            <div className="flex gap-2"><span className="text-green-500 font-bold w-14">L-CLICK:</span><span className="text-gray-400">Drill into</span></div>
            <div className="flex gap-2"><span className="text-cyan-400 font-bold w-14">R-CLICK:</span><span className="text-gray-400">Select partition</span></div>
            <div className="flex gap-2"><span className="text-gray-200 font-bold w-14">SCROLL:</span><span className="text-gray-400">Zoom</span></div>
            <div className="flex gap-2"><span className="text-yellow-400 font-bold w-14">DRAG:</span><span className="text-gray-400">Pan view</span></div>
            <div className="flex gap-2"><span className="text-purple-400 font-bold w-14">BUBBLES:</span><span className="text-gray-400">Drag files</span></div>
          </div>
          <div className="mt-auto pt-2 border-t border-gray-800 text-[9px] text-gray-600 space-y-1">
            <div>Cache: {voronoiCacheRef.current.size}</div>
            <div className="truncate" title={effectivePath}>View: {effectivePath.split('/').pop()}</div>
            <div>History: {history.length}</div>
            <div className={navigationLock ? 'text-yellow-500' : 'text-green-500'}>{navigationLock ? '🔒 LOCKED' : '✓ Ready'}</div>
          </div>
        </div>
      </div>

      {/* BREADCRUMB */}
      <div className="bg-[#0a0e14] border border-gray-800 p-2 rounded flex items-center gap-2 overflow-x-auto">
        <button onClick={navigateBack} disabled={!canGoBack || isLocked} className={cn("flex items-center justify-center w-7 h-7 rounded border transition-all shrink-0", canGoBack && !isLocked ? "border-gray-700 hover:border-cyan-600 hover:bg-cyan-950/30 text-gray-400 hover:text-cyan-400 cursor-pointer" : "border-gray-800 text-gray-700 cursor-not-allowed")} title="Go back">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-gray-700">|</span>
        <span className="text-green-500 font-bold">$</span>
        {breadcrumbParts.map((part, i) => (
          <div key={`${part.path}-${i}`} className="flex items-center gap-1">
            <button onClick={() => part.isClickable && !isLocked && navigateToBreadcrumb(part.path)} disabled={!part.isClickable || isLocked} className={cn("transition-colors whitespace-nowrap", part.isClickable && !isLocked ? "hover:text-cyan-400 text-gray-400 cursor-pointer" : "text-white cursor-default font-bold")}>
              {part.name}
            </button>
            {i < breadcrumbParts.length - 1 && <span className="text-gray-700">/</span>}
          </div>
        ))}
      </div>

      {/* VISUALIZER */}
      <div ref={containerRef} className={cn("relative border border-gray-800 bg-[#0a0e14] rounded-lg overflow-hidden", isLocked && "pointer-events-none")} style={{ height: isFullscreen ? 'calc(100vh - 280px)' : '550px' }}>
        <svg ref={svgRef} className={cn("w-full h-full cursor-crosshair", isLocked && "pointer-events-none")} />

        <div className="absolute bottom-3 right-3 flex gap-2">
          <Button size="icon" variant="outline" className="bg-black/80 border-gray-700 w-8 h-8 hover:bg-gray-800 hover:border-cyan-700" onClick={resetZoom} disabled={isLocked} title="Recenter View"><Focus className="w-4 h-4" /></Button>
          <Button size="icon" variant="outline" className="bg-black/80 border-gray-700 w-8 h-8 hover:bg-gray-800 hover:border-cyan-700" onClick={toggleFullscreen} title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>{isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}</Button>
        </div>

        {error && <div className="absolute inset-0 flex items-center justify-center bg-black/80"><p className="text-red-500 font-bold">Failed to compute Voronoi: {error.toString()}</p></div>}

        {isLocked && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-cyan-950/50 border border-cyan-600 px-6 py-4 rounded-lg flex items-center gap-3 animate-pulse">
              <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              <div className="text-cyan-400 font-bold">{navigationLock ? 'Navigating...' : 'Loading...'}</div>
            </div>
          </div>
        )}
      </div>

      {/* LEGEND */}
      <div className="flex justify-between items-center text-[10px] uppercase tracking-wider font-mono text-gray-600 px-1">
        <div className="flex gap-4">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: TERMINAL_COLORS.folder, opacity: 0.4 }} />Directories</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded border border-dashed" style={{ borderColor: TERMINAL_COLORS.filesContainer, opacity: 0.7 }} />Files Region</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: TERMINAL_COLORS.file }} />Files</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded border" style={{ borderColor: '#ffffff', opacity: 0.5 }} />Preview</span>
        </div>
        <div className="text-gray-700">Hover partitions • Click to explore • Drag bubbles</div>
      </div>
    </div>
  )
}