import { useCallback, useEffect, useState, useRef } from 'react'
import {
  Tldraw,
  DefaultToolbar,
  DefaultMinimap,
  SelectToolbarItem,
  HandToolbarItem,
  AssetToolbarItem,
} from 'tldraw'
import type { Editor } from 'tldraw'
import { ChatBox } from '../components/chatbox/ChatBox'
import { SAMOverlayUtil } from '../lib/sam-overlay'
import { LoadingOverlayUtil } from '../lib/loading-overlay'
import { ImageActions } from '../components/canvas/ImageActions'
import { EditAnnotationOverlay, type EditAnnotation } from '../components/canvas/EditAnnotationOverlay'
import { UserMenu } from '../components/UserMenu'
import { useGuestSession } from '../hooks/useGuestSession'
import { Paintbrush } from 'lucide-react'

const PERSIST_KEY = 'gpt-image-canvas'

export function PlaygroundPage() {
  const [inputImages, setInputImages] = useState<string[]>([])
  const [editor, setEditor] = useState<Editor | null>(null)
  const session = useGuestSession()
  const chatLogRef = useRef<any[]>([])
  // Tracks canvas-origin images (double-clicked) so the deletion listener can sync them
  const canvasShapeMapRef = useRef<Record<string, string>>({})

  // Edit annotations (native tldraw text + arrow shapes)
  const [annotations, setAnnotations] = useState<EditAnnotation[]>([])

  const handleAnnotationCreated = useCallback(
    (ann: EditAnnotation) => {
      setAnnotations((prev) => [...prev, ann])
      // Auto-add the image to attachments if not already there
      setInputImages((prev) => {
        if (prev.includes(ann.imageUrl)) return prev
        return [...prev, ann.imageUrl].slice(0, 16)
      })
    },
    [],
  )

  const handleRemoveAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => {
      const ann = prev.find((a) => a.id === id)
      if (ann && editor) {
        // Delete both shapes from canvas
        try { editor.deleteShapes([ann.textShapeId, ann.arrowShapeId] as any) } catch { /* ignore */ }
      }
      return prev.filter((a) => a.id !== id)
    })
  }, [editor])

  // Remove all annotations referencing a given image URL
  const handleRemoveAnnotationsByUrl = useCallback((url: string) => {
    setAnnotations((prev) => {
      const toRemove = prev.filter((a) => a.imageUrl === url)
      if (toRemove.length > 0 && editor) {
        const ids = toRemove.flatMap((a) => [a.textShapeId, a.arrowShapeId])
        try { editor.deleteShapes(ids as any) } catch { /* ignore */ }
      }
      return prev.filter((a) => a.imageUrl !== url)
    })
  }, [editor])

  // Remove all annotations whose image shape was deleted from canvas
  const handleRemoveAnnotationsByShapeIds = useCallback((shapeIds: Set<string>) => {
    setAnnotations((prev) => {
      const toRemove = prev.filter((a) => shapeIds.has(a.imageShapeId))
      if (toRemove.length > 0 && editor) {
        const ids = toRemove.flatMap((a) => [a.textShapeId, a.arrowShapeId])
        try { editor.deleteShapes(ids as any) } catch { /* ignore */ }
      }
      return prev.filter((a) => !shapeIds.has(a.imageShapeId))
    })
  }, [editor])

  const handleClearAnnotations = useCallback(() => {
    if (editor && annotations.length > 0) {
      const ids = annotations.flatMap((a) => [a.textShapeId, a.arrowShapeId])
      try { editor.deleteShapes(ids as any) } catch { /* ignore */ }
    }
    setAnnotations([])
  }, [editor, annotations])

  // Load saved chat log from localStorage on mount (canvas auto-persisted by tldraw via IndexedDB)
  useEffect(() => {
    if (!session?.guestId) return
    try {
      const raw = localStorage.getItem(`gpt-image-chat-${session.guestId}`)
      if (raw) {
        try { chatLogRef.current = JSON.parse(raw) } catch {}
      }
    } catch { /* ignore */ }
  }, [session?.guestId])

  // Double-click on image shapes adds them (or all selected images) to attachments.
  // All images come from tldraw — no file upload from chatbox.
  useEffect(() => {
    if (!editor) return
    const container = editor.getContainer()
    if (!container) return

    const getImageSrc = (shape: any): string => {
      if (shape.type !== 'image') return ''
      const props = shape.props as { url?: string; assetId?: string }
      // Prefer the asset's src — that's the canonical image data in tldraw v2.
      // props.url may contain a stale blob URL, a filename, or be empty.
      if (props.assetId) {
        const asset = editor.getAsset(props.assetId as any)
        const assetSrc = (asset?.props as any)?.src
        if (assetSrc) return assetSrc
      }
      // Fall back to props.url only if no asset is available
      return typeof props.url === 'string' && props.url.length > 0 ? props.url : ''
    }

    const handleDoubleClick = (_e: MouseEvent) => {
      const point = editor.inputs.currentPagePoint
      const shape = editor.getShapeAtPoint(point, { hitInside: true, margin: 4 })
      if (!shape || shape.type !== 'image') return

      // If multiple image shapes are selected, add all of them
      const selectedIds = editor.getSelectedShapeIds()
      const imageShapes: any[] = [shape]
      if (selectedIds.length > 1) {
        for (const id of selectedIds) {
          const s = editor.getShape(id as any)
          if (s && s.type === 'image' && s.id !== shape.id) {
            imageShapes.push(s)
          }
        }
      }

      const newUrls: string[] = []
      for (const s of imageShapes) {
        const src = getImageSrc(s)
        if (!src) continue
        canvasShapeMapRef.current[s.id] = src
        newUrls.push(src)
      }

      if (newUrls.length === 0) return

      setInputImages((prev) => {
        const existing = new Set(prev)
        for (const u of newUrls) existing.add(u)
        return Array.from(existing).slice(0, 16)
      })
    }

    container.addEventListener('dblclick', handleDoubleClick)
    return () => container.removeEventListener('dblclick', handleDoubleClick)
  }, [editor])

  // Clean up annotations when their text/arrow shapes are manually deleted on canvas
  useEffect(() => {
    if (!editor) return
    const unlisten = editor.store.listen((entry) => {
      const removedIds = new Set(Object.keys(entry.changes.removed || {}))
      if (removedIds.size === 0) return
      setAnnotations((prev) => {
        const toRemove = prev.filter((a) => removedIds.has(a.textShapeId) || removedIds.has(a.arrowShapeId))
        if (toRemove.length === 0) return prev
        // Also delete the paired shape if only one was removed
        for (const ann of toRemove) {
          const otherId = removedIds.has(ann.textShapeId) ? ann.arrowShapeId : ann.textShapeId
          if (!removedIds.has(otherId)) {
            try { editor.deleteShapes([otherId as any]) } catch { /* ignore */ }
          }
        }
        return prev.filter((a) => !removedIds.has(a.textShapeId) && !removedIds.has(a.arrowShapeId))
      })
    })
    return unlisten
  }, [editor])

  // Auto-update arrow endpoints when images with annotations are moved
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations

  useEffect(() => {
    if (!editor) return
    const unlisten = editor.store.listen((entry) => {
      const updatedIds = new Set(Object.keys(entry.changes.updated || {}))
      if (updatedIds.size === 0) return
      const affected = annotationsRef.current.filter((a) => updatedIds.has(a.imageShapeId))
      if (affected.length === 0) return

      // Batch using rAF — drag produces many updates per frame
      requestAnimationFrame(() => {
        for (const ann of affected) {
          const img = editor.getShape(ann.imageShapeId as any)
          if (!img) continue

          const pw = (img.props as any)?.w || 0
          const ph = (img.props as any)?.h || 0
          const pointX = img.x + ann.relativeX * pw
          const pointY = img.y + ann.relativeY * ph

          const placeLeft = ann.relativeX > 0.5
          const arrowStartX = placeLeft ? img.x : img.x + pw
          const arrowStartY = pointY

          editor.updateShape({
            id: ann.arrowShapeId as any,
            type: 'arrow',
            x: arrowStartX,
            y: arrowStartY,
            props: {
              start: { x: 0, y: 0 },
              end: { x: pointX - arrowStartX, y: pointY - arrowStartY },
            },
          } as any)
        }
      })
    })
    return unlisten
  }, [editor])

  const handleMount = useCallback((ed: Editor) => {
    setEditor(ed)
    // Enable small grid for visual reference
    ed.updateInstanceState({ isGridMode: true })
    ed.updateDocumentSettings({ gridSize: 10 })
  }, [])

  // Canvas auto-persisted by tldraw via IndexedDB (persistenceKey).
  // We only need to save chat log to localStorage.
  const chatSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleChatUpdate = useCallback((messages: any[]) => {
    chatLogRef.current = messages
    if (!session?.guestId) return
    // Debounce chat log save
    if (chatSaveTimerRef.current) clearTimeout(chatSaveTimerRef.current)
    chatSaveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(`gpt-image-chat-${session.guestId}`, JSON.stringify(messages))
      } catch { /* ignore */ }
    }, 2000)
  }, [session?.guestId])

  // Backup images to server: upload base64 assets and replace with server URLs.
  // This ensures images are accessible via URL even if IndexedDB is cleared.
  useEffect(() => {
    if (!editor || !session?.guestId) return
    // Run once after mount and periodically
    let running = false
    const backup = async () => {
      if (running) return
      running = true
      try {
        const records = editor.store.allRecords()
        const images: Record<string, string> = {}
        for (const r of records) {
          if (r.typeName === 'asset' && (r as any).type === 'image') {
            const src: string = (r as any).props?.src || ''
            const idx = src.indexOf(';base64,')
            if (src.startsWith('data:') && idx > 0) {
              images[r.id] = src.substring(idx + 8)
            }
          }
        }
        if (Object.keys(images).length === 0) return
        const resp = await fetch('/api/images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images }),
        })
        const { urls } = await resp.json()
        if (!urls) return
        // Update asset records with server URLs
        const updates: any[] = []
        for (const [assetId, url] of Object.entries(urls)) {
          updates.push({ id: assetId, typeName: 'asset', props: { src: url } } as any)
        }
        if (updates.length > 0) editor.store.put(updates)
      } catch { /* ignore */ }
      running = false
    }
    const interval = setInterval(backup, 30000)
    backup()
    return () => clearInterval(interval)
  }, [editor, session?.guestId])

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="h-12 shrink-0 border-b flex items-center justify-between px-4 bg-background z-50">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <Paintbrush className="h-4 w-4 text-primary" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Image Canvas</span>
          <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
            Beta
          </span>
        </div>
        {session && <UserMenu guestId={session.guestId} />}
      </header>

      {/* Canvas + chat */}
      <div className="flex-1 min-h-0 relative">
      <Tldraw
        onMount={handleMount}
        persistenceKey={PERSIST_KEY}
        locale="zh-cn"
        colorScheme="light"
        overlayUtils={[SAMOverlayUtil, LoadingOverlayUtil]}
        components={{
          Toolbar: () => (
            <DefaultToolbar orientation="vertical">
              <SelectToolbarItem />
              <HandToolbarItem />
              <AssetToolbarItem />
            </DefaultToolbar>
          ),
          StylePanel: () => null,
          InFrontOfTheCanvas: () => (
            <ImageActions />
          ),
          Minimap: DefaultMinimap,
          ImageToolbar: () => null,
        }}
      >
        {/* Long-press edit annotation detector — renders nothing, uses useEditor() */}
        <EditAnnotationOverlay onAnnotationCreated={handleAnnotationCreated} />

        {/* Chat overlay — floated right panel */}
        <div
          className="absolute top-12 right-0 bottom-0 w-[400px] z-40
            border-l bg-background/95 backdrop-blur-sm shadow-lg select-auto"
          style={{ marginBottom: 'var(--tlui-bottom, 0px)' }}
        >
          <ChatBox
            editor={editor}
            guestId={session?.guestId}
            inputImages={inputImages}
            onInputImagesChange={setInputImages}
            initialMessages={chatLogRef.current}
            onMessagesChange={handleChatUpdate}
            canvasShapeMapRef={canvasShapeMapRef}
            annotations={annotations}
            onRemoveAnnotation={handleRemoveAnnotation}
            onRemoveAnnotationsByUrl={handleRemoveAnnotationsByUrl}
            onRemoveAnnotationsByShapeIds={handleRemoveAnnotationsByShapeIds}
            onClearAnnotations={handleClearAnnotations}
          />
        </div>
      </Tldraw>
      </div>
    </div>
  )
}
