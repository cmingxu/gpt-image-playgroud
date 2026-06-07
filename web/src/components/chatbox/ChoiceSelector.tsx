import { Check, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface ChoiceOption {
  key: string        // e.g. "resolution"
  label: string      // e.g. "分辨率"
  options: string[]  // e.g. ["1K","2K","4K"]
}

interface ChoiceSelectorProps {
  choices: ChoiceOption[]
  selected: Record<string, string>
  onSelect: (key: string, value: string) => void
  disabled?: boolean
}

const RESOLUTION_DESC: Record<string, string> = {
  '1K': '标清',
  '2K': '高清',
  '4K': '超清',
}

export function ChoiceSelector({ choices, selected, onSelect, disabled }: ChoiceSelectorProps) {
  if (!choices || choices.length === 0) return null

  return (
    <div className="space-y-3">
      {choices.map((choice) => (
        <div key={choice.key} className="space-y-1.5">
          {/* Section label */}
          <div className="flex items-center gap-1.5">
            <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              {choice.label}
            </span>
            {selected[choice.key] && (
              <span className="text-[11px] text-primary font-medium">
                — {selected[choice.key]}
                {RESOLUTION_DESC[selected[choice.key]] && (
                  <span className="text-muted-foreground ml-0.5">
                    {RESOLUTION_DESC[selected[choice.key]]}
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Chip options */}
          <div className="flex flex-wrap gap-1.5">
            {choice.options.map((opt) => {
              const isSelected = selected[choice.key] === opt
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(choice.key, opt)}
                  className={cn(
                    // shadcn ai suggestion chip style
                    'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all',
                    'border hover:shadow-sm',
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-background text-foreground/80 border-border hover:border-primary/50 hover:text-foreground hover:bg-muted/50',
                    disabled && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  {isSelected ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <span className="h-3 w-3 rounded-full border border-current opacity-30" />
                  )}
                  {opt}
                  {RESOLUTION_DESC[opt] && (
                    <span className={cn(
                      'text-[10px] opacity-60',
                      isSelected && 'opacity-80',
                    )}>
                      {RESOLUTION_DESC[opt]}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Format selected choices as a natural message for the LLM */
export function formatChoicesMessage(choices: ChoiceOption[], selected: Record<string, string>): string {
  const parts: string[] = []
  for (const c of choices) {
    if (selected[c.key]) {
      parts.push(`${c.label}: ${selected[c.key]}`)
    }
  }
  return parts.join('，')
}
