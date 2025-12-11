'use client'

import { useNavigationStore } from '@/lib/stores/navigationStore'
import { Button } from '@/components/ui/button'
import { ChevronRight, Home } from 'lucide-react'

export function PathNavigator() {
  const { breadcrumbs, setCurrentPath } = useNavigationStore()

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setCurrentPath('/')}
        className="hover:bg-[#ff9900]/10"
      >
        <Home className="h-4 w-4 text-[#ff9900]" />
      </Button>
      {breadcrumbs.map((crumb, idx) => (
        <div key={crumb.path} className="flex items-center gap-2">
          {idx > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <Button
            variant={crumb.isLast ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setCurrentPath(crumb.path)}
            className={crumb.isLast ? 'bg-[#ff9900] hover:bg-[#ff9900]/90 text-white' : 'hover:bg-[#ff9900]/10'}
          >
            {crumb.label}
          </Button>
        </div>
      ))}
    </div>
  )
}
