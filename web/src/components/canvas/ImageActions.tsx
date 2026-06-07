import { useCallback, useState, useEffect, useRef } from 'react'
import { useEditor, useValue } from 'tldraw'
import { Trash2, Download, Copy, Share } from 'lucide-react'

/** Floating action buttons shown on top of a selected image shape. */
export function ImageActions() {
  const editor = useEditor()

  // Reactively track selected shape IDs
  const selectedIds = useValue(
    'selectedIds',
    () => Array.from(editor.getSelectedShapeIds()),
    [editor],
  )

  const shapeId = selectedIds.length === 1 ? selectedIds[0] : null

  // Reactive tick — incremented whenever the selected shape's record changes in the store.
  // This ensures the action buttons stay locked to the shape during drag operations.
  const [tick, setTick] = useState(0)
  const shapeIdRef = useRef(shapeId)
  shapeIdRef.current = shapeId
  useEffect(() => {
    const unlisten = editor.store.listen((entry) => {
      const sid = shapeIdRef.current
      if (!sid) return
      for (const [id] of Object.entries(entry.changes.updated || {})) {
        if (id === sid) { setTick((t) => t + 1); return }
      }
    })
    return unlisten
  }, [editor])

  // Re-read shape & bounds on every reactive tick so drag updates are immediate
  void tick
  const shape = shapeId ? editor.getShape(shapeId as any) : null
  const isActive = shape && shape.type === 'image'
  const bounds = isActive ? editor.getShapePageBounds(shape) : null

  const props = isActive ? (shape.props as { url?: string; assetId?: string }) : null
  // Prefer the asset's src — that's the canonical image data in tldraw v2.
  let imageSrc = ''
  if (props?.assetId) {
    const asset = editor.getAsset(props.assetId as any)
    imageSrc = (asset?.props as any)?.src || ''
  }
  if (!imageSrc) {
    imageSrc = props?.url || ''
  }

  // Convert page coords to viewport coords (InFrontOfTheCanvas uses viewport space)
  const camera = editor.getCamera()
  const screenX = bounds ? (bounds.x + camera.x) * camera.z + (bounds.w * camera.z) / 2 : 0
  const screenY = bounds ? (bounds.y + camera.y) * camera.z - 48 : 0

  // All hooks must be called unconditionally
  const handleDelete = useCallback(() => {
    if (shapeId) editor.deleteShapes([shapeId as any])
  }, [editor, shapeId])

  const handleDownload = useCallback(() => {
    if (!imageSrc) return
    const a = document.createElement('a')
    a.href = imageSrc
    a.download = 'image.png'
    a.click()
  }, [imageSrc])

  const handleDuplicate = useCallback(() => {
    if (shapeId) editor.duplicateShapes([shapeId as any])
  }, [editor, shapeId])

  const handleExport = useCallback(async () => {
    if (!imageSrc) return
    try {
      const resp = await fetch(imageSrc)
      const blob = await resp.blob()
      const item = new ClipboardItem({ [blob.type]: blob })
      await navigator.clipboard.write([item])
    } catch {
      // Clipboard API not available — fallback to download
      const a = document.createElement('a')
      a.href = imageSrc
      a.download = 'image.png'
      a.click()
    }
  }, [imageSrc])

  // Early return AFTER all hooks
  if (!isActive) return null

  const btnClass =
    'inline-flex items-center justify-center w-8 h-8 rounded-lg border bg-white cursor-pointer shadow-sm hover:bg-muted transition-colors'

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transform: `translate(${screenX}px, ${screenY}px) translate(-50%, -100%)`,
        zIndex: 100,
        pointerEvents: 'all',
      }}
    >
      <div style={{ display: 'flex', gap: 4 }}>
        <button className={btnClass} onClick={handleDownload} title="下载">
          <Download size={15} />
        </button>
        <button className={btnClass} onClick={handleExport} title="复制">
          <Copy size={15} />
        </button>
        <button className={btnClass} onClick={handleDuplicate} title="复制一份">
          <Share size={15} />
        </button>
        <button
          className={btnClass + ' text-red-500 border-red-200'}
          onClick={handleDelete}
          title="删除"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  )
}
