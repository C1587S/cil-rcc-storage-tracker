'use client'

import { useState, useMemo } from 'react'
import { useSnapshots } from '@/lib/hooks/useSnapshots'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

// --- TYPES ---
interface DayData {
  date: string
  dateObj: Date
  month: number
  year: number
  hasSnapshot: boolean
}

interface WeekData {
  index: number
  days: DayData[] // Always 7 days (Sun-Sat)
  startMonth: number // Used for labels
  startYear: number  // Used for labels
}

// --- CONFIG ---
const CELL_SIZE = 11
const GAP_SIZE = 3
const WEEK_WIDTH = CELL_SIZE + GAP_SIZE

export function SnapshotCalendar() {
  const { data: snapshotsData, isLoading } = useSnapshots()
  const router = useRouter()
  
  const [endDate, setEndDate] = useState(new Date())
  const weeksToShow = 100 // Showing slightly more than a year to ensure overlap

  const snapshots = snapshotsData?.snapshots ?? []
  
  // Fast lookup
  const snapshotMap = useMemo(() => new Set(snapshots.map(s => s.date)), [snapshots])

  // --- DATA GENERATION ---
  const weeks = useMemo(() => {
    const w: WeekData[] = []
    
    // 1. Determine the last day (Saturday) of the current view
    const current = new Date(endDate)
    // Adjust to Saturday so our columns are always aligned Sun-Sat
    const dayOfWeek = current.getDay() // 0=Sun, 6=Sat
    // If today is Tue (2), add 4 days to get Sat (6)
    current.setDate(current.getDate() + (6 - dayOfWeek))
    
    // 2. Determine the very first day of the grid (Top-Left cell)
    // We go back 'weeksToShow' weeks, then start at Sunday
    const totalDays = weeksToShow * 7
    const startOfGrid = new Date(current)
    startOfGrid.setDate(startOfGrid.getDate() - totalDays + 1)
    
    // 3. Build the grid column by column
    for (let i = 0; i < weeksToShow; i++) {
      const weekStart = new Date(startOfGrid)
      weekStart.setDate(weekStart.getDate() + (i * 7))

      const days: DayData[] = []
      
      // Build 7 rows (Sun -> Sat)
      for (let d = 0; d < 7; d++) {
        const dObj = new Date(weekStart)
        dObj.setDate(dObj.getDate() + d)
        
        const iso = dObj.toISOString().split('T')[0]
        days.push({
          date: iso,
          dateObj: dObj,
          month: dObj.getMonth(),
          year: dObj.getFullYear(),
          hasSnapshot: snapshotMap.has(iso)
        })
      }

      w.push({
        index: i,
        days,
        startMonth: days[0].month, // We use the Sunday of the week for the top label
        startYear: days[0].year
      })
    }
    return w
  }, [endDate, weeksToShow, snapshotMap])

  // --- LOGIC: LABELS ---
  // We only show the Year label if this week's year is different from the previous week's year
  // OR if it's the very first week and we want context.
  const getYearLabel = (weekIndex: number, currentYear: number) => {
    if (weekIndex === 0) return currentYear
    const prevWeek = weeks[weekIndex - 1]
    if (prevWeek && prevWeek.startYear !== currentYear) {
      return currentYear
    }
    return null
  }

  // We show the Month label if the month changed relative to the previous column
  // GitHub usually places the label on the first column where that month is dominant
  const getMonthLabel = (weekIndex: number, currentMonth: number) => {
    if (weekIndex === 0) return monthNames[currentMonth]
    const prevWeek = weeks[weekIndex - 1]
    if (prevWeek && prevWeek.startMonth !== currentMonth) {
      return monthNames[currentMonth]
    }
    return null
  }

  // --- LOGIC: BORDERS (The "Stepped" Line) ---
  // We draw a left border on a cell IF:
  // 1. It's not the first column (index > 0)
  // 2. The day's Month (or Year) is different from the day exactly to its left (index - 1)
  const getBorderClass = (weekIndex: number, dayIndex: number, currentDay: DayData) => {
    if (weekIndex === 0) return ''

    const prevWeek = weeks[weekIndex - 1]
    const leftNeighbor = prevWeek.days[dayIndex]

    const isNewYear = currentDay.year !== leftNeighbor.year
    const isNewMonth = currentDay.month !== leftNeighbor.month

    if (isNewYear) return 'border-l-[2px] border-blue-500' // Thick line for year
    if (isNewMonth) return 'border-l-[1px] border-zinc-600' // Thin line for month
    
    return 'border-l-[1px] border-transparent' // Placeholder to keep spacing identical
  }

  const handlePrevious = () => {
    const d = new Date(endDate)
    d.setDate(d.getDate() - (weeksToShow * 7))
    setEndDate(d)
  }

  const handleNext = () => {
    const today = new Date()
    const d = new Date(endDate)
    d.setDate(d.getDate() + (weeksToShow * 7))
    setEndDate(d > today ? today : d)
  }

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  if (isLoading) return <div className="h-24 flex items-center justify-center text-muted-foreground">Loading...</div>

  return (
    <div className="w-full select-none">
      
      {/* Controls */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handlePrevious} className="h-7 px-2">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleNext} disabled={endDate >= new Date()} className="h-7 px-2">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          {snapshots.length} snapshots
        </div>
      </div>

      <div className="flex gap-2">
        
        {/* Row Labels (Mon/Wed/Fri) */}
        {/* Top padding pushes these down to align with the grid rows, ignoring header height */}
        <div className="flex flex-col pt-[36px] gap-[3px] text-[9px] text-muted-foreground text-right pr-1">
          <span className="h-[11px] invisible">Sun</span>
          <span className="h-[11px] leading-[11px]">Mon</span>
          <span className="h-[11px] invisible">Tue</span>
          <span className="h-[11px] leading-[11px]">Wed</span>
          <span className="h-[11px] invisible">Thu</span>
          <span className="h-[11px] leading-[11px]">Fri</span>
          <span className="h-[11px] invisible">Sat</span>
        </div>

        {/* Scrollable Container */}
        <div className="flex-1 overflow-x-auto pb-4">
          <div className="inline-flex flex-col">
            
            {/* 1. Year Labels */}
            <div className="flex h-[14px] relative mb-1">
              {weeks.map((week) => {
                const label = getYearLabel(week.index, week.startYear)
                return (
                  <div key={`year-${week.index}`} style={{ width: WEEK_WIDTH }} className="flex-shrink-0 relative">
                    {label && (
                      <span className="absolute left-0 top-0 text-[10px] font-bold text-white z-10">
                        {label}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* 2. Month Labels */}
            <div className="flex h-[14px] relative mb-1">
              {weeks.map((week) => {
                const label = getMonthLabel(week.index, week.startMonth)
                return (
                  <div key={`month-${week.index}`} style={{ width: WEEK_WIDTH }} className="flex-shrink-0 relative">
                    {label && (
                      <span className="absolute left-0 top-0 text-[9px] text-muted-foreground">
                        {label}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* 3. The Grid */}
            <div className="flex" style={{ gap: `${GAP_SIZE}px` }}>
              {weeks.map((week) => (
                <div 
                  key={week.index} 
                  className="flex flex-col flex-shrink-0"
                  style={{ width: CELL_SIZE, gap: `${GAP_SIZE}px` }} 
                >
                  {week.days.map((d, dayIndex) => {
                    const borderClass = getBorderClass(week.index, dayIndex, d)
                    
                    return (
                      <div
                        key={dayIndex}
                        onClick={() => d.hasSnapshot && router.push(`/dashboard/${d.date}`)}
                        // We use negative margin on the left to pull the border into the gap space
                        // This prevents the cell from shrinking
                        className={`
                          h-[11px] w-[11px] rounded-[1px] box-border relative
                          ${d.hasSnapshot ? 'bg-[#39ff14]' : 'bg-zinc-800/50'}
                          ${borderClass}
                          ${d.hasSnapshot ? 'cursor-pointer hover:ring-1 hover:ring-white hover:z-20' : ''}
                        `}
                        // If we have a border, we shift slightly to make it look like a separator
                        style={{
                          marginLeft: borderClass.includes('border-l') ? '-1px' : '0px'
                        }}
                        title={`${d.date}`}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {/* Legend */}
      <div className="flex items-center gap-2 mt-2 ml-8 text-[10px] text-muted-foreground">
        <span>Less</span>
        <div className="w-[10px] h-[10px] rounded-[1px] bg-zinc-800/50" />
        <div className="w-[10px] h-[10px] rounded-[1px] bg-[#39ff14]" />
        <span>More</span>
      </div>
    </div>
  )
}