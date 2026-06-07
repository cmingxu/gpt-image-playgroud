import { useRef, useEffect } from 'react'
import { Loader2, Upload, CornerDownLeft } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

interface PromptInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onAttach?: () => void
  generating?: boolean
  disabled?: boolean
  placeholder?: string
  attachmentCount?: number
  genType?: 't2i' | 'i2i'
  canSendEmpty?: boolean
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  onAttach,
  generating = false,
  disabled = false,
  placeholder = '描述你想生成的图像…',
  attachmentCount = 0,
  genType = 't2i',
  canSendEmpty = false,
}: PromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
    }
  }, [value])

  return (
    <div className="rounded-2xl border bg-card shadow-sm overflow-hidden focus-within:ring-1 focus-within:ring-ring transition-shadow">
      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={1}
        disabled={disabled || generating}
        className="w-full resize-none border-0 bg-transparent px-4 pt-4 pb-2 text-sm placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
      />

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between px-3 pb-3">
        <div className="flex items-center gap-2">
          {/* Attachment button — only shown when onAttach is provided */}
          {onAttach && (
            <button
              type="button"
              onClick={onAttach}
              disabled={disabled || generating || attachmentCount >= 16}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                attachmentCount > 0
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
                (disabled || generating || attachmentCount >= 16) && 'opacity-50 cursor-not-allowed',
              )}
            >
              <Upload className="h-3.5 w-3.5" />
              {attachmentCount > 0 ? `${attachmentCount}/16` : '添加图片'}
            </button>
          )}

          {/* Mode indicator */}
          <span className="text-[11px] text-muted-foreground font-medium">
            {genType === 'i2i' ? '图生图' : '文生图'}
          </span>
        </div>

        {/* Send button */}
        <Button
          size="icon"
          onClick={onSubmit}
          disabled={disabled || generating || (!canSendEmpty && !value.trim())}
          className="h-9 w-9 rounded-xl shrink-0"
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CornerDownLeft className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
