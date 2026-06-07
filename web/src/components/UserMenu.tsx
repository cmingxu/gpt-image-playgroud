import { useState } from 'react'
import { User, Settings, Image, Zap } from 'lucide-react'
import { cn } from '../lib/utils'

interface UserMenuProps {
  guestId: string
  className?: string
}

export function UserMenu({ guestId, className }: UserMenuProps) {
  const [open, setOpen] = useState(false)

  const guestLabel = `访客 ${guestId.slice(-6)}`

  return (
    <div className={cn('relative', className)}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full border bg-background hover:bg-muted transition-colors px-2.5 py-1.5 text-sm"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
          <User className="h-3.5 w-3.5 text-primary" />
        </div>
        <span className="max-w-[100px] truncate text-xs font-medium text-muted-foreground">
          {guestLabel}
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-64 rounded-xl border bg-card shadow-lg overflow-hidden">
            {/* User info header */}
            <div className="px-4 py-3 border-b bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-medium">{guestLabel}</div>
                  <div className="text-[11px] text-muted-foreground">游客账户</div>
                </div>
              </div>
            </div>

            {/* Usage stats */}
            <div className="px-4 py-2.5 space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Image className="h-3.5 w-3.5" />
                <span>生成次数</span>
                <span className="ml-auto font-mono font-medium text-foreground">--</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Zap className="h-3.5 w-3.5" />
                <span>Token 用量</span>
                <span className="ml-auto font-mono font-medium text-foreground">--</span>
              </div>
            </div>

            <div className="border-t" />

            {/* Actions */}
            <div className="p-1.5">
              <button
                onClick={() => { setOpen(false) }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted transition-colors"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                设置
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
