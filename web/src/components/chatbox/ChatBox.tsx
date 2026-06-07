import { useState, useRef, useCallback, useEffect } from 'react'
import type { Editor } from 'tldraw'
import { useToast } from '../../hooks/use-toast'
import {
  createPlaceholderShapes,
  replacePlaceholders,
  removeShapes,
} from '../../lib/canvas-utils'
import { Attachments } from '../ai/attachments'
import { PromptInput } from '../ai/prompt-input'
import { MessageList, type ChatMessage } from './MessageList'
import type { ToolCallInfo } from './ToolInvocation'
import type { ChoiceOption } from './ChoiceSelector'
import { formatChoicesMessage } from './ChoiceSelector'
import type { EditAnnotation } from '../canvas/EditAnnotationOverlay'
import { renderPlaintextFromRichText } from 'tldraw'
import { WelcomePrompts } from './WelcomePrompts'

interface ChatBoxProps {
  editor: Editor | null
  guestId?: string
  inputImages: string[]
  onInputImagesChange: (urls: string[]) => void
  initialMessages?: ChatMessage[]
  onMessagesChange?: (messages: ChatMessage[]) => void
  // Tracks canvas-origin images (double-clicked) so deletions sync to chatbox
  canvasShapeMapRef?: React.MutableRefObject<Record<string, string>>
  // Edit annotations (native tldraw text + arrow shapes)
  annotations?: EditAnnotation[]
  onRemoveAnnotation?: (id: string) => void
  onRemoveAnnotationsByUrl?: (url: string) => void
  onRemoveAnnotationsByShapeIds?: (shapeIds: Set<string>) => void
  onClearAnnotations?: () => void
}

let msgId = 0
function nextId(): string {
  return `msg-${++msgId}-${Date.now()}`
}

export function ChatBox({ editor, guestId, inputImages, onInputImagesChange, initialMessages, onMessagesChange, canvasShapeMapRef, annotations = [], onRemoveAnnotation, onRemoveAnnotationsByUrl, onRemoveAnnotationsByShapeIds, onClearAnnotations }: ChatBoxProps) {
  const { toast } = useToast()

  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages || [])
  const msgListRef = useRef<HTMLDivElement>(null)

  const placeholderIdsRef = useRef<string[]>([])
  const inputImagesRef = useRef(inputImages)
  inputImagesRef.current = inputImages  // keep fresh for listener closure
  const isBatchEditRef = useRef(false)  // track if current generation was a batch edit

  // Track active choice prompt for auto-submit when all options selected
  const choiceMsgIdRef = useRef<string | null>(null)
  const choiceDataRef = useRef<ChoiceOption[]>([])

  const genType = inputImages.length > 0 ? 'i2i' : 't2i'

  // Sync: when a canvas image is deleted, remove from attachments list and pending edits too.
  // All images come from tldraw — tracked via canvasShapeMapRef from Playground.
  useEffect(() => {
    if (!editor || !canvasShapeMapRef) return
    const cleanup = editor.store.listen((entry) => {
      const removed = entry.changes.removed
      const urlsToRemove = new Set<string>()
      const removedShapeIds = new Set<string>()
      for (const id of Object.keys(removed)) {
        removedShapeIds.add(id)
        const url = canvasShapeMapRef.current[id]
        if (url) {
          delete canvasShapeMapRef.current[id]
          urlsToRemove.add(url)
        }
      }
      if (urlsToRemove.size > 0) {
        onInputImagesChange(inputImagesRef.current.filter((u) => !urlsToRemove.has(u)))
      }
      // Also remove annotations on deleted shapes (even if not in canvasShapeMapRef)
      if (removedShapeIds.size > 0) {
        onRemoveAnnotationsByShapeIds?.(removedShapeIds)
      }
    })
    return cleanup
  }, [editor, onInputImagesChange, canvasShapeMapRef, onRemoveAnnotationsByShapeIds])

  // Notify parent when messages change (for persistence)
  useEffect(() => {
    onMessagesChange?.(messages)
  }, [messages, onMessagesChange])

  // Accumulate choice selections in a ref for the auto-send check
  const choiceSelectionsRef = useRef<Record<string, string>>({})

  // Handle choice selection — auto-send when all choices are made
  const handleChoiceSelect = (key: string, value: string) => {
    const msgId = choiceMsgIdRef.current
    if (!msgId) return

    // Update the ref
    choiceSelectionsRef.current = { ...choiceSelectionsRef.current, [key]: value }

    // Update the message display
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m
        return { ...m, choiceSelected: { ...choiceSelectionsRef.current } }
      }),
    )

    // Check if all choices are selected — auto-send
    const choices = choiceDataRef.current
    const allDone = choices.every((c) => !!choiceSelectionsRef.current[c.key])
    if (allDone && !generating) {
      const msg = formatChoicesMessage(choices, choiceSelectionsRef.current)
      // Clear choices state
      choiceMsgIdRef.current = null
      choiceDataRef.current = []
      choiceSelectionsRef.current = {}
      // Set prompt and auto-submit
      setPrompt(msg)
      // Use setTimeout to let state settle, then submit
      setTimeout(() => {
        sendMessage(msg)
      }, 50)
    }
  }

  const removeImage = useCallback(
    (index: number) => {
      // Only remove from attachments list — canvas shapes are not deleted
      const url = inputImages[index]
      if (!url) return
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
      onInputImagesChange(inputImages.filter((_, i) => i !== index))
      // Also remove any annotations on this image
      onRemoveAnnotationsByUrl?.(url)
    },
    [inputImages, onInputImagesChange, onRemoveAnnotationsByUrl],
  )

  const scrollMessagesToBottom = useCallback(() => {
    setTimeout(() => {
      if (msgListRef.current) {
        msgListRef.current.scrollTop = msgListRef.current.scrollHeight
      }
    }, 50)
  }, [])

  // Clean up placeholders and place results
  const finishGeneration = useCallback(async (
    resultUrls: string[],
    _isI2I: boolean,
  ) => {
    // Replace placeholders with real images at the exact same positions
    if (resultUrls.length > 0) {
      await replacePlaceholders(editor, placeholderIdsRef.current, resultUrls)
    } else {
      // No results — just remove placeholders
      removeShapes(editor, placeholderIdsRef.current)
    }
    placeholderIdsRef.current = []
  }, [editor])

  // Poll async task until completion, updating tool status in the message
  const pollTask = useCallback(async (
    taskId: string,
    placeholderMsgId: string,
    isI2I: boolean,
  ) => {
    const maxPolls = 120
    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, 2500))

      try {
        const resp = await fetch(`/api/task/${taskId}`)
        if (!resp.ok) continue

        const task = await resp.json()
        if (task.status === 'success') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === placeholderMsgId
                ? {
                    ...m,
                    content: task.message || '图片已生成',
                    loading: false,
                    taskId: undefined,
                    tool: m.tool
                      ? { ...m.tool, status: 'success' as const, resultImages: task.imageUrls || [] }
                      : undefined,
                  }
                : m,
            ),
          )
          await finishGeneration(task.imageUrls || [], isI2I)
          if (isBatchEditRef.current) { isBatchEditRef.current = false; onClearAnnotations?.() }
          setGenerating(false)
          return
        } else if (task.status === 'failed') {
          // Remove placeholders on failure
          removeShapes(editor, placeholderIdsRef.current)
          placeholderIdsRef.current = []

          setMessages((prev) =>
            prev.map((m) =>
              m.id === placeholderMsgId
                ? {
                    ...m,
                    content: '生成失败',
                    loading: false,
                    taskId: undefined,
                    tool: m.tool
                      ? { ...m.tool, status: 'failed' as const, error: task.error || '未知错误' }
                      : undefined,
                  }
                : m,
            ),
          )
          toast({ title: '生成失败', description: task.error || '未知错误', variant: 'destructive' })
          if (isBatchEditRef.current) { isBatchEditRef.current = false; onClearAnnotations?.() }
          setGenerating(false)
          return
        }
      } catch {
        // Network error, retry next interval
      }
    }
    // Timeout
    removeShapes(editor, placeholderIdsRef.current)
    placeholderIdsRef.current = []
    if (isBatchEditRef.current) { isBatchEditRef.current = false; onClearAnnotations?.() }

    setMessages((prev) =>
      prev.map((m) =>
        m.id === placeholderMsgId
          ? {
              ...m,
              content: '生成超时，请重试',
              loading: false,
              taskId: undefined,
              tool: m.tool
                ? { ...m.tool, status: 'failed' as const, error: '任务超时' }
                : undefined,
            }
          : m,
      ),
    )
    setGenerating(false)
  }, [editor, toast, finishGeneration, onClearAnnotations])

  // Core send logic — accepts a message string and optional image override (for batch edits)
  const sendMessage = async (msg: string, overrideImages?: string[]) => {
    if (!msg.trim() || generating) return

    const effectiveImages = overrideImages ?? inputImages
    const genType = effectiveImages.length > 0 ? 'i2i' : 't2i'

    // Track if this is a batch edit so pollTask can clean up
    if (overrideImages) isBatchEditRef.current = true

    // Add user message
    const userMsg: ChatMessage = {
      id: nextId(),
      role: 'user',
      content: msg.trim(),
      inputImages: effectiveImages.length > 0 ? [...effectiveImages] : undefined,
    }
    setMessages((prev) => [...prev, userMsg])
    scrollMessagesToBottom()

    setGenerating(true)
    setPrompt('')

    try {
      // Upload all reference images as base64 data URLs for the API
      let imageUrls: string[] | undefined
      if (genType === 'i2i' && effectiveImages.length > 0) {
        const alreadyData = effectiveImages.filter((url) => url.startsWith('data:'))
        const needUpload = effectiveImages.filter((url) => !url.startsWith('data:'))

        if (needUpload.length > 0) {
          const formData = new FormData()
          const responses = await Promise.all(
            needUpload.map(async (url) => {
              const resp = await fetch(url)
              return resp.blob()
            }),
          )
          responses.forEach((blob, i) => {
            const ext = blob.type === 'image/png' ? 'png' : 'jpg'
            formData.append('files', blob, `image-${i}.${ext}`)
          })
          const uploadResp = await fetch('/api/image/upload', { method: 'POST', body: formData })
          const uploadData = await uploadResp.json()
          if (!uploadResp.ok) throw new Error(uploadData.error || '上传失败')
          imageUrls = [...alreadyData, ...(uploadData.urls || [])]
        } else {
          imageUrls = alreadyData
        }
      }

      let data: any = null

      // Try agent chat endpoint
      try {
        const chatResp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: guestId || 'playground',
            message: msg,
            inputImages: imageUrls,
          }),
        })
        data = await chatResp.json()

        // Agent returned a tool call with async task
        if (data.taskId && data.toolName) {
          const isI2I = data.toolName === 'image_to_image'
          const refImages = isI2I && effectiveImages.length > 0
            ? [...effectiveImages]
            : undefined

          // Create a single centered placeholder on canvas
          placeholderIdsRef.current = createPlaceholderShapes(editor, 1)

          const tool: ToolCallInfo = {
            name: data.toolName,
            args: data.toolArgs || '{}',
            status: 'running',
            referenceImages: refImages,
          }
          const placeholderId = nextId()
          const placeholderMsg: ChatMessage = {
            id: placeholderId,
            role: 'assistant',
            thinking: data.thinking || undefined,
            content: data.message || '正在生成...',
            loading: true,
            taskId: data.taskId,
            tool,
          }
          setMessages((prev) => [...prev, placeholderMsg])
          scrollMessagesToBottom()
          pollTask(data.taskId, placeholderId, isI2I)
          return
        }

        // Agent returned text directly (no tool call) — may include choices
        if (data.message) {
          const hasChoices = data.choices && data.choices.length > 0
          const msgId = nextId()
          const assistantMsg: ChatMessage = {
            id: msgId,
            role: 'assistant',
            thinking: data.thinking || undefined,
            content: data.message,
            images: data.imageUrls?.length > 0 ? data.imageUrls : undefined,
            choices: hasChoices ? data.choices : undefined,
            onChoiceSelect: hasChoices ? handleChoiceSelect : undefined,
          }

          // Track this message for auto-submit when all choices are made
          if (hasChoices) {
            choiceMsgIdRef.current = msgId
            choiceDataRef.current = data.choices
            choiceSelectionsRef.current = {}
          }

          setMessages((prev) => [...prev, assistantMsg])
          scrollMessagesToBottom()
          if (data.imageUrls?.length > 0) {
            await finishGeneration(data.imageUrls, false)
          }
          setGenerating(false)
          return
        }
      } catch {
        // Fall back to direct generate
      }

      // Direct generate fallback
      if (!data?.imageUrls?.length && !data?.taskId) {
        // Create a single centered placeholder
        placeholderIdsRef.current = createPlaceholderShapes(editor, 1)

        const resp = await fetch('/api/image/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: msg,
            genType,
            aspectRatio: 'auto',
            resolution: '1K',
            imageUrls,
          }),
        })
        data = await resp.json()
        if (data.status === 'success' && data.result?.length > 0) {
          const assistantMsg: ChatMessage = {
            id: nextId(),
            role: 'assistant',
            content: `已生成 ${data.result.length} 张图片`,
            images: data.result,
          }
          setMessages((prev) => [...prev, assistantMsg])
          scrollMessagesToBottom()
          await finishGeneration(data.result, genType === 'i2i')
          toast({ title: '生成成功', description: `已生成 ${data.result.length} 张图片` })
        } else if (data.status === 'failed') {
          removeShapes(editor, placeholderIdsRef.current)
          placeholderIdsRef.current = []
          const errorMsg: ChatMessage = {
            id: nextId(),
            role: 'assistant',
            content: `生成失败: ${data.errorMsg || '未知错误'}`,
          }
          setMessages((prev) => [...prev, errorMsg])
          scrollMessagesToBottom()
          toast({ title: '生成失败', description: data.errorMsg || '未知错误', variant: 'destructive' })
        } else {
          throw new Error(data.error || '未知响应')
        }
      }

      // Clear after generation
      if (overrideImages) {
        // Batch edit send — clear pending edits, not inputImages state
        isBatchEditRef.current = false
        onClearAnnotations?.()
      } else {
        // Normal send — clear input images
        inputImages.forEach((url) => {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url)
        })
        onInputImagesChange([])
      }
      setGenerating(false)
    } catch (e) {
      removeShapes(editor, placeholderIdsRef.current)
      placeholderIdsRef.current = []
      // Clear pending edits if this was a batch edit send
      if (overrideImages) { isBatchEditRef.current = false; onClearAnnotations?.() }
      const errorMsg: ChatMessage = {
        id: nextId(),
        role: 'assistant',
        content: `生成失败: ${(e as Error).message}`,
      }
      setMessages((prev) => [...prev, errorMsg])
      scrollMessagesToBottom()
      toast({ title: '生成失败', description: (e as Error).message, variant: 'destructive' })
      setGenerating(false)
    }
  }

  // Read edit text from an annotation's text shape on the canvas
  const getAnnotationText = useCallback((ann: EditAnnotation): string => {
    if (!editor) return ''
    const shape = editor.getShape(ann.textShapeId as any)
    if (!shape) return ''
    try {
      const richText = (shape.props as any)?.richText
      if (!richText) return ''
      const plain = renderPlaintextFromRichText(editor as any, richText)
      // Strip the "修改: " prefix
      return plain.replace(/^修改:\s*/, '').trim()
    } catch { return '' }
  }, [editor])

  // Public submit handler — reads from prompt state, includes annotations if any
  const handleSubmit = () => {
    const hasAnnotations = annotations.length > 0
    const hasPrompt = prompt.trim().length > 0

    if (!hasAnnotations && !hasPrompt) return

    if (hasAnnotations) {
      // Build batch edit message: collect unique images + format edit instructions
      const uniqueUrls: string[] = []
      const urlIndexMap = new Map<string, number>()
      for (const a of annotations) {
        if (!urlIndexMap.has(a.imageUrl)) {
          urlIndexMap.set(a.imageUrl, uniqueUrls.length)
          uniqueUrls.push(a.imageUrl)
        }
      }

      const editLines = annotations.map((a) => {
        const idx = (urlIndexMap.get(a.imageUrl) ?? 0) + 1
        const pctX = Math.round(a.relativeX * 100)
        const pctY = Math.round(a.relativeY * 100)
        const text = getAnnotationText(a) || '（未填写）'
        return `- 参考图${idx} 位置(${pctX}%, ${pctY}%): ${text}`
      })

      const editMsg = `[编辑标注] 共${annotations.length}处:\n${editLines.join('\n')}`
      const fullMsg = hasPrompt ? `${prompt.trim()}\n\n${editMsg}` : editMsg

      sendMessage(fullMsg, uniqueUrls)
      return
    }

    sendMessage(prompt.trim())
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Message history — scrollable fill, or welcome prompts when empty */}
      <div ref={msgListRef} className="flex-1 min-h-0 overflow-y-auto px-3 pt-3 pr-4 pb-6">
        {messages.length === 0 ? (
          <WelcomePrompts onSelect={(text) => { setPrompt(text) }} />
        ) : (
          <MessageList messages={messages} />
        )}
      </div>

      {/* Bottom input area */}
      <div className="shrink-0 border-t bg-background/50 px-3 py-3 space-y-2.5">
        <Attachments
          images={inputImages}
          onRemove={removeImage}
          onAdd={() => {}}
        />

        {/* Pending position-based annotations */}
        {annotations.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">
                编辑标注 ({annotations.length})
              </span>
            </div>
            <div className="space-y-1 max-h-[160px] overflow-y-auto">
              {annotations.map((ann, i) => {
                const pctX = Math.round(ann.relativeX * 100)
                const pctY = Math.round(ann.relativeY * 100)
                const text = getAnnotationText(ann)
                return (
                  <div
                    key={ann.id}
                    className="flex items-start gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-xs group"
                  >
                    {/* Number badge */}
                    <span className="inline-flex items-center justify-center w-5 h-5 shrink-0 rounded-full bg-red-500 text-white text-[10px] font-bold mt-0.5">
                      {i + 1}
                    </span>
                    {/* Edit text */}
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground leading-relaxed line-clamp-2">
                        {text || '修改: （双击文字编辑）'}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        位置 ({pctX}%, {pctY}%)
                      </p>
                    </div>
                    {/* Remove button */}
                    <button
                      type="button"
                      onClick={() => onRemoveAnnotation?.(ann.id)}
                      className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <line x1="2" y1="2" x2="10" y2="10" />
                        <line x1="10" y1="2" x2="2" y2="10" />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <PromptInput
          value={prompt}
          onChange={setPrompt}
          onSubmit={handleSubmit}
          generating={generating}
          disabled={generating}
          placeholder={annotations.length > 0 ? '描述整体编辑要求（可选）…' : '描述你想生成的图像…'}
          attachmentCount={inputImages.length}
          genType={genType}
          canSendEmpty={annotations.length > 0}
        />
      </div>
    </div>
  )
}
