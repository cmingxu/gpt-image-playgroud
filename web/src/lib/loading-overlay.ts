import { OverlayUtil } from '@tldraw/editor'
import type { TLOverlay } from '@tldraw/editor'

interface LoadingOverlayData extends TLOverlay {
  type: 'loading-placeholder'
  props: {
    x: number; y: number; w: number; h: number
    label: string
  }
}

/**
 * LoadingOverlayUtil renders animated skeleton/shimmer on placeholder shapes
 * while images are being generated, giving the user a visual "waiting" effect.
 */
export class LoadingOverlayUtil extends OverlayUtil<LoadingOverlayData> {
  static override type = 'loading-placeholder' as const

  private startTime = Date.now()

  override isActive(): boolean {
    const shapes = this.editor.getCurrentPageShapes()
    return shapes.some((s) => s.id.startsWith('shape:placeholder-'))
  }

  override getOverlays(): LoadingOverlayData[] {
    const shapes = this.editor.getCurrentPageShapes()
    const overlays: LoadingOverlayData[] = []

    for (const shape of shapes) {
      if (!shape.id.startsWith('shape:placeholder-')) continue

      const bounds = this.editor.getShapePageBounds(shape)
      if (!bounds) continue

      overlays.push({
        id: `loading-${shape.id}`,
        type: 'loading-placeholder' as const,
        props: {
          x: bounds.x,
          y: bounds.y,
          w: bounds.w,
          h: bounds.h,
          label: '生成中...',
        },
      })
    }

    return overlays
  }

  override render(ctx: CanvasRenderingContext2D, overlays: LoadingOverlayData[]): void {
    if (overlays.length === 0) return

    const elapsed = (Date.now() - this.startTime) / 1000

    for (const overlay of overlays) {
      const { x, y, w, h, label } = overlay.props
      const r = 12 // corner radius

      ctx.save()

      // Shimmer animation — sweeping gradient
      const shimmerPos = ((elapsed * 1.5 + x * 0.01) % 2) - 1 // -1 to 1 sweep

      // Card background with gradient shimmer
      const gradient = ctx.createLinearGradient(
        x + w * shimmerPos,
        y,
        x + w * (shimmerPos + 0.4),
        y + h,
      )
      gradient.addColorStop(0, 'rgba(139, 92, 246, 0.08)')   // violet-500
      gradient.addColorStop(0.5, 'rgba(139, 92, 246, 0.18)')
      gradient.addColorStop(1, 'rgba(139, 92, 246, 0.08)')

      // Round rect path
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.lineTo(x + w - r, y)
      ctx.arcTo(x + w, y, x + w, y + r, r)
      ctx.lineTo(x + w, y + h - r)
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
      ctx.lineTo(x + r, y + h)
      ctx.arcTo(x, y + h, x, y + h - r, r)
      ctx.lineTo(x, y + r)
      ctx.arcTo(x, y, x + r, y, r)
      ctx.closePath()

      // Fill with shimmer gradient
      ctx.fillStyle = gradient
      ctx.fill()

      // Dashed border
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.4)'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.lineDashOffset = -elapsed * 30 // marching ants effect
      ctx.stroke()

      // Pulsing dot
      const dotX = x + w / 2
      const dotY = y + h / 2 - 12
      const pulse = Math.sin(elapsed * 3) * 0.3 + 0.7 // 0.4 to 1.0
      const dotRadius = 5 * pulse

      ctx.beginPath()
      ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(139, 92, 246, ${0.6 * pulse})`
      ctx.fill()

      // Small orbiting dot
      const orbitAngle = elapsed * 2
      const orbitRadius = 16
      const orbitX = dotX + Math.cos(orbitAngle) * orbitRadius
      const orbitY = dotY + Math.sin(orbitAngle) * orbitRadius
      ctx.beginPath()
      ctx.arc(orbitX, orbitY, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(139, 92, 246, 0.5)'
      ctx.fill()

      // Label text
      ctx.font = '13px system-ui, -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = 'rgba(139, 92, 246, 0.7)'
      ctx.fillText(label, x + w / 2, y + h / 2 + 6)

      ctx.restore()
    }
  }
}
