import { NavLink, Outlet } from 'react-router-dom'
import { Sparkles, Palette } from 'lucide-react'
import { cn } from '../lib/utils'

export function Layout() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
      isActive
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground hover:bg-accent',
    )

  return (
    <div className="h-screen flex flex-col">
      <header className="h-12 shrink-0 border-b flex items-center gap-4 px-4">
        <h1 className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          GPT Image
        </h1>
        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={linkClass}>
            <Sparkles className="h-3.5 w-3.5" />
            生成器
          </NavLink>
          <NavLink to="/playground" className={linkClass}>
            <Palette className="h-3.5 w-3.5" />
            画布
          </NavLink>
        </nav>
      </header>
      <main className="flex-1 min-h-0">
        <Outlet />
      </main>
    </div>
  )
}
