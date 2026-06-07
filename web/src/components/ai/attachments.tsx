import { X, Plus } from 'lucide-react'
import { cn } from '../../lib/utils'

interface AttachmentsProps {
  images: string[]
  onRemove: (index: number) => void
  onAdd?: () => void
  maxCount?: number
}

export function Attachments({ images, onRemove, onAdd, maxCount = 16 }: AttachmentsProps) {
  if (images.length === 0) return null

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {images.map((url, i) => (
        <div
          key={i}
          className="relative h-16 w-16 shrink-0 rounded-xl border bg-muted overflow-hidden group"
        >
          <img
            src={url}
            alt={`附件 ${i + 1}`}
            className="h-full w-full object-cover"
          />
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="absolute -top-1.5 -right-1.5 rounded-full bg-background border shadow-sm p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}

      {onAdd && images.length < maxCount && (
        <button
          type="button"
          onClick={onAdd}
          className="h-16 w-16 shrink-0 rounded-xl border-2 border-dashed border-muted-foreground/25 flex items-center justify-center text-muted-foreground/50 hover:border-primary/50 hover:text-primary transition-colors"
        >
          <Plus className="h-5 w-5" />
        </button>
      )}
    </div>
  )
}

interface AttachmentsGridProps {
  images: string[]
  onRemove: (index: number) => void
  onAdd?: () => void
  maxCount?: number
  className?: string
}

export function AttachmentsGrid({ images, onRemove, onAdd, maxCount = 16, className }: AttachmentsGridProps) {
  return (
    <div className={cn('grid grid-cols-4 sm:grid-cols-6 gap-2', className)}>
      {images.map((url, i) => (
        <div
          key={i}
          className="relative aspect-square rounded-xl border bg-muted overflow-hidden group"
        >
          <img
            src={url}
            alt={`附件 ${i + 1}`}
            className="h-full w-full object-cover"
          />
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="absolute top-1 right-1 rounded-full bg-background/80 backdrop-blur-sm border shadow-sm p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}

      {onAdd && images.length < maxCount && (
        <button
          type="button"
          onClick={onAdd}
          className="aspect-square rounded-xl border-2 border-dashed border-muted-foreground/25 flex items-center justify-center text-muted-foreground/50 hover:border-primary/50 hover:text-primary transition-colors"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}
    </div>
  )
}
