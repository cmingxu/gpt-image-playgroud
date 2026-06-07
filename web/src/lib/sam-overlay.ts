import { OverlayUtil } from '@tldraw/editor'
import type { TLOverlay } from '@tldraw/editor'
import { segmentAtPoint } from './segment-engine'

interface SAMOverlayData extends TLOverlay {
  type: 'sam-mask'
  props: {
    x: number; y: number; w: number; h: number
    hoverX: number; hoverY: number
    imageSrc: string
    cachedKey: string
  }
}

export class SAMOverlayUtil extends OverlayUtil<SAMOverlayData> {
  static override type = 'sam-mask' as const

  private maskBitmaps = new Map<string, ImageBitmap>()
  private encodingSet = new Set<string>()

  override isActive(): boolean {
    const hovered = this.editor.getHoveredShape()
    return hovered?.type === 'image'
  }

  override getOverlays(): SAMOverlayData[] {
    const hoveredShape = this.editor.getHoveredShape()
    if (!hoveredShape || hoveredShape.type !== 'image') return []

    const bounds = this.editor.getShapePageBounds(hoveredShape)
    if (!bounds) return []

    const pointer = this.editor.inputs.currentPagePoint
    if (
      pointer.x < bounds.x || pointer.x > bounds.x + bounds.w ||
      pointer.y < bounds.y || pointer.y > bounds.y + bounds.h
    ) {
      return []
    }

    const props = hoveredShape.props as { url?: string; w?: number; h?: number; assetId?: string }
    let imageSrc = props.url || ''
    if (!imageSrc && props.assetId) {
      const asset = this.editor.getAsset(props.assetId as any)
      imageSrc = (asset?.props as any)?.src || ''
    }
    if (!imageSrc) return []

    // Coarse grid cache key — decoder runs per grid cell, not per pixel
    const gx = Math.round(pointer.x / 20) * 20
    const gy = Math.round(pointer.y / 20) * 20
    const cacheKey = `${imageSrc}_${gx}_${gy}`

    return [{
      id: `sam-${hoveredShape.id}`,
      type: 'sam-mask' as const,
      props: {
        x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h,
        hoverX: pointer.x - bounds.x,
        hoverY: pointer.y - bounds.y,
        imageSrc,
        cachedKey: cacheKey,
      },
    }]
  }

  override render(ctx: CanvasRenderingContext2D, overlays: SAMOverlayData[]): void {
    if (overlays.length === 0) return

    const overlay = overlays[0]
    const { x, y, w, h, hoverX, hoverY, imageSrc } = overlay.props
    const cacheKey = overlay.props.cachedKey
    const zoom = this.editor.getZoomLevel()

    // Draw cached mask with clean semi-transparent overlay (like SAM-in-Browser)
    const cached = this.maskBitmaps.get(cacheKey)
    if (cached) {
      ctx.save()
      ctx.globalAlpha = 0.5
      // Draw random color per image for multi-mask effect (like SAM-in-Browser)
      ctx.drawImage(cached, x, y, w, h)
      ctx.restore()
      return
    }

    // Draw green dot indicator while processing (like SAM-in-Browser)
    ctx.save()
    ctx.beginPath()
    ctx.arc(x + hoverX, y + hoverY, 6 / zoom, 0, Math.PI * 2)
    ctx.fillStyle = '#22c55e'
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2 / zoom
    ctx.stroke()
    ctx.restore()

    // Trigger async decode
    if (!this.encodingSet.has(cacheKey)) {
      this.encodingSet.add(cacheKey)
      this.runSegment(imageSrc, hoverX, hoverY, w, h, cacheKey)
    }
  }

  private async runSegment(
    src: string, hoverX: number, hoverY: number,
    shapeW: number, shapeH: number, cacheKey: string,
  ) {
    try {
      const t0 = performance.now()
      console.log(`[SAM] segmenting at (${hoverX.toFixed(0)}, ${hoverY.toFixed(0)})`)

      const img = await this.loadImage(src)
      const naturalW = img.naturalWidth || shapeW
      const naturalH = img.naturalHeight || shapeH

      const imgX = hoverX * (naturalW / shapeW)
      const imgY = hoverY * (naturalH / shapeH)

      const maskData = await segmentAtPoint(src, { x: imgX, y: imgY }, { w: naturalW, h: naturalH })

      // Convert to ImageBitmap for fast canvas drawImage (same approach as SAM-in-Browser)
      const maskBitmap = await createImageBitmap(maskData)

      console.log(`[SAM] mask ready in ${(performance.now() - t0).toFixed(0)}ms`)

      this.maskBitmaps.set(cacheKey, maskBitmap)
      // Limit cache size
      if (this.maskBitmaps.size > 40) {
        const first = this.maskBitmaps.keys().next().value
        if (first) {
          this.maskBitmaps.get(first)?.close()
          this.maskBitmaps.delete(first)
        }
      }
      this.editor.updateViewportScreenBounds(this.editor.getViewportScreenBounds())
    } catch (e) {
      console.error('[SAM] failed:', e)
    } finally {
      this.encodingSet.delete(cacheKey)
    }
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`Failed to load: ${src}`))
      img.src = src
    })
  }
}
