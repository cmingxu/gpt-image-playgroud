import { Bot, User, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { ToolInvocation, type ToolCallInfo } from './ToolInvocation'
import { ChoiceSelector, type ChoiceOption } from './ChoiceSelector'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string        // LLM thinking text before tool call
  images?: string[]        // Generated images (assistant)
  inputImages?: string[]   // Reference images uploaded by user
  taskId?: string          // Async task ID for polling
  loading?: boolean        // Whether waiting for task to complete
  tool?: ToolCallInfo      // Tool call info (when a tool is invoked)
  choices?: ChoiceOption[] // Interactive choice options
  choiceSelected?: Record<string, string>  // User's selections
  onChoiceSelect?: (key: string, value: string) => void
}

interface MessageListProps {
  messages: ChatMessage[]
  className?: string
}

export function MessageList({ messages, className }: MessageListProps) {
  if (messages.length === 0) return null

  return (
    <div className={cn('flex flex-col gap-3 pb-2', className)}>
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={cn(
            'flex gap-2.5',
            msg.role === 'user' ? 'justify-end' : 'justify-start',
          )}
        >
          {/* Assistant avatar */}
          {msg.role === 'assistant' && (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-1">
              {msg.loading ? (
                <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
              ) : (
                <Bot className="h-3.5 w-3.5 text-primary" />
              )}
            </div>
          )}

          <div className="max-w-[85%] min-w-0 space-y-2">
            {/* Thinking text — shown above tool or as standalone message */}
            {msg.thinking && !msg.tool && !msg.choices && (
              <div className="rounded-2xl rounded-bl-lg bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
                <p className="whitespace-pre-wrap">{msg.thinking}</p>
              </div>
            )}

            {/* Thinking text + Choices (shadcn AI inline suggestions) */}
            {msg.choices && msg.choices.length > 0 && (
              <div className="rounded-2xl rounded-bl-lg bg-muted overflow-hidden">
                {msg.thinking && (
                  <div className="px-3.5 pt-3 pb-2 text-sm leading-relaxed text-foreground">
                    <p className="whitespace-pre-wrap">{msg.thinking}</p>
                  </div>
                )}
                <div className={cn('px-3.5', msg.thinking ? 'pb-3' : 'py-3')}>
                  <ChoiceSelector
                    choices={msg.choices}
                    selected={msg.choiceSelected || {}}
                    onSelect={msg.onChoiceSelect || (() => {})}
                    disabled={!msg.onChoiceSelect}
                  />
                </div>
              </div>
            )}

            {/* Thinking text + Tool invocation */}
            {msg.tool && (
              <div className="space-y-2">
                {msg.thinking && (
                  <div className="rounded-2xl rounded-bl-lg bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
                    <p className="whitespace-pre-wrap">{msg.thinking}</p>
                  </div>
                )}
                <ToolInvocation tool={msg.tool} />
              </div>
            )}

            {/* No tool, no thinking, no choices — plain text message */}
            {!msg.thinking && !msg.tool && !msg.choices && msg.content && (
              <div
                className={cn(
                  'rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-lg'
                    : 'bg-muted text-foreground rounded-bl-lg',
                )}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            )}

            {/* Loading skeleton for placeholder */}
            {msg.loading && !msg.tool && (
              <div className="rounded-2xl rounded-bl-lg bg-muted px-3.5 py-2.5 animate-pulse space-y-1.5">
                <div className="h-2 bg-muted-foreground/20 rounded w-3/4" />
                <div className="h-2 bg-muted-foreground/20 rounded w-1/2" />
              </div>
            )}

            {/* User input images (reference) */}
            {msg.inputImages && msg.inputImages.length > 0 && (
              <div className="flex gap-1.5 flex-wrap justify-end">
                {msg.inputImages.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`参考图 ${i + 1}`}
                    className="h-12 w-12 rounded-lg object-cover border border-white/20"
                  />
                ))}
              </div>
            )}
          </div>

          {/* User avatar */}
          {msg.role === 'user' && (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary mt-1">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
