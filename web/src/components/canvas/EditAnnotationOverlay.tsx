import { useEffect, useRef } from 'react'
import { useEditor } from 'tldraw'
import { createAnnotationShapes } from '../../lib/canvas-utils'

/** Metadata for an edit annotation on the canvas. */
export interface EditAnnotation {
  id: string
  textShapeId: string     // tldraw text shape ID — prompt content is in shape.props.richText
  arrowShapeId: string    // tldraw arrow shape ID — points to image position
  imageShapeId: string    // the image being edited
  imageUrl: string        // URL of the image
  relativeX: number       // 0-1 position on image
  relativeY: number       // 0-1 position on image
}

interface EditAnnotationOverlayProps {
  /** Called when a long-press creates a new annotation (text + arrow shapes). */
  onAnnotationCreated: (annotation: EditAnnotation) => void
}

let editCounter = 0

/**
 * Headless long-press detector for creating edit annotations on images.
 * - Listens for mousedown on an image shape → starts 2-second timer
 * - Mouse move > 5px or mouseup cancels the timer
 * - On timer fire: creates native tldraw text + arrow shapes, enters text editing
 * - Renders nothing (null) — all visuals are native tldraw shapes
 */
export function EditAnnotationOverlay({ onAnnotationCreated }: EditAnnotationOverlayProps) {
  const editor = useEditor()

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startRef = useRef<{ pageX: number; pageY: number; shapeId: string } | null>(null)

  // Get image source from a shape (prefer asset src over props.url)
  const getImageSrc = (shape: any): string => {
    if (shape.type !== 'image') return ''
    const props = shape.props as { url?: string; assetId?: string }
    if (props.assetId) {
      const asset = editor.getAsset(props.assetId as any)
      const assetSrc = (asset?.props as any)?.src
      if (assetSrc) return assetSrc
    }
    return typeof props.url === 'string' && props.url.length > 0 ? props.url : ''
  }

  useEffect(() => {
    const container = editor.getContainer()
    if (!container) return

    const cancelTimer = () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
      startRef.current = null
    }

    const handleMouseDown = (e: MouseEvent) => {
      // Only respond to primary button
      if (e.button !== 0) return

      const point = editor.inputs.currentPagePoint
      const shape = editor.getShapeAtPoint(point, { hitInside: true, margin: 4 })
      if (!shape || shape.type !== 'image') return

      const src = getImageSrc(shape)
      if (!src) return

      startRef.current = { pageX: point.x, pageY: point.y, shapeId: shape.id }

      timerRef.current = setTimeout(() => {
        timerRef.current = null
        const s = startRef.current
        if (!s) return

        const result = createAnnotationShapes(editor, s.shapeId, s.pageX, s.pageY)
        if (!result) { startRef.current = null; return }

        const bounds = editor.getShapePageBounds(s.shapeId as any)
        const shape = editor.getShape(s.shapeId as any)
        const relX = bounds ? (s.pageX - bounds.x) / bounds.w : 0.5
        const relY = bounds ? (s.pageY - bounds.y) / bounds.h : 0.5

        const annotation: EditAnnotation = {
          id: `edit-${++editCounter}-${Date.now()}`,
          textShapeId: result.textShapeId,
          arrowShapeId: result.arrowShapeId,
          imageShapeId: s.shapeId,
          imageUrl: getImageSrc(shape) || '',
          relativeX: relX,
          relativeY: relY,
        }

        onAnnotationCreated(annotation)
        startRef.current = null
      }, 2000)
    }

    const handleMouseUp = () => {
      cancelTimer()
    }

    const handleMouseMove = (_e: MouseEvent) => {
      if (!startRef.current) return
      const point = editor.inputs.currentPagePoint
      const dx = point.x - startRef.current.pageX
      const dy = point.y - startRef.current.pageY
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        cancelTimer()
      }
    }

    container.addEventListener('mousedown', handleMouseDown)
    container.addEventListener('mouseup', handleMouseUp)
    container.addEventListener('mousemove', handleMouseMove)
    return () => {
      container.removeEventListener('mousedown', handleMouseDown)
      container.removeEventListener('mouseup', handleMouseUp)
      container.removeEventListener('mousemove', handleMouseMove)
      cancelTimer()
    }
  }, [editor, onAnnotationCreated])

  return null
}
