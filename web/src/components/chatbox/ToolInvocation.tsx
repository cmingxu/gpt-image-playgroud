import { useState } from 'react'
import { Wrench, ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2, ImageIcon, PenTool } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface ToolCallInfo {
  name: string           // e.g. "text_to_image"
  args: string           // JSON string
  status: 'running' | 'success' | 'failed'
  resultImages?: string[]
  referenceImages?: string[]  // Input images used for i2i
  error?: string
}

interface ToolInvocationProps {
  tool: ToolCallInfo
  className?: string
}

const TOOL_META: Record<string, { icon: typeof Wrench; label: string }> = {
  text_to_image: { icon: ImageIcon, label: '文生图' },
  image_to_image: { icon: PenTool, label: '图生图' },
}

function formatArgs(argsJSON: string): string {
  try {
    const obj = JSON.parse(argsJSON)
    if (obj.prompt) {
      return `prompt: "${obj.prompt}"`
    }
    return JSON.stringify(obj, null, 2)
  } catch {
    return argsJSON
  }
}

export function ToolInvocation({ tool, className }: ToolInvocationProps) {
  const [expanded, setExpanded] = useState(false)
  const meta = TOOL_META[tool.name] || { icon: Wrench, label: tool.name }
  const Icon = meta.icon
  const isI2I = tool.name === 'image_to_image'

  return (
    <div className={cn('rounded-xl border bg-card/60 backdrop-blur-sm overflow-hidden', className)}>
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
      >
        {/* Icon */}
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-3.5 w-3.5 text-primary" />
        </div>

        {/* Tool name + args preview */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-foreground">{meta.label}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {formatArgs(tool.args)}
          </div>
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          {tool.status === 'running' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 text-[11px] font-medium text-yellow-700 dark:text-yellow-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              运行中
            </span>
          )}
          {tool.status === 'success' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              已完成
            </span>
          )}
          {tool.status === 'failed' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-400">
              <XCircle className="h-3 w-3" />
              失败
            </span>
          )}

          {(tool.status !== 'running' || isI2I) && (
            expanded
              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded detail — images are rendered on canvas, not in chat */}
      {expanded && (
        <div className="border-t px-3 py-2.5 space-y-2.5">
          {/* Arguments */}
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">参数：</span>
            <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono">
              {tool.args}
            </code>
          </div>

          {/* Result summary — text only, images are on canvas */}
          {tool.status === 'success' && tool.resultImages && tool.resultImages.length > 0 && (
            <div className="text-xs text-muted-foreground">
              已生成 {tool.resultImages.length} 张图片到画布
            </div>
          )}

          {/* Error */}
          {tool.error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950/30 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-400">
              {tool.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
