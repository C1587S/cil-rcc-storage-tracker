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
      >
        <Home className="h-4 w-4" />
      </Button>
      {breadcrumbs.map((crumb, idx) => (
        <div key={crumb.path} className="flex items-center gap-2">
          {idx > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <Button
            variant={crumb.isLast ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setCurrentPath(crumb.path)}
          >
            {crumb.label}
          </Button>
        </div>
      ))}
    </div>
  )
}
