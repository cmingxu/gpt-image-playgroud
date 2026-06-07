import { AssetRecordType } from 'tldraw'
import { toRichText } from '@tldraw/tlschema'
import type { Editor, TLAsset } from 'tldraw'

/** Load an image URL to get its natural dimensions */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (!url.startsWith('blob:')) {
      img.crossOrigin = 'anonymous'
    }
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

/** Convert a blob URL to a data URL that tldraw accepts */
export async function toSafeUrl(url: string): Promise<string> {
  if (!url.startsWith('blob:')) return url
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return url // fallback — will fail tldraw validation but at least won't crash
  }
}

/** Place images onto the tldraw canvas. Returns created shapes with their source URLs. */
export async function placeImagesOnCanvas(
  editor: Editor | null,
  urls: string[],
  opts?: { nearShapeIds?: string[]; offsetX?: number; offsetY?: number },
): Promise<{ shapeId: string; url: string }[]> {
  if (!editor || urls.length === 0) return []

  // Calculate center position — offset if near existing shapes
  let centerX: number
  let centerY: number

  if (opts?.nearShapeIds && opts.nearShapeIds.length > 0) {
    // Position near the last reference shape
    const lastRef = editor.getShape(opts.nearShapeIds[opts.nearShapeIds.length - 1] as any)
    if (lastRef) {
      const bounds = editor.getShapePageBounds(lastRef)
      if (bounds) {
        centerX = bounds.x + bounds.w + 80
        centerY = bounds.y
      } else {
        const vp = editor.getViewportPageBounds()
        centerX = vp.x + vp.w / 2; centerY = vp.y + vp.h / 2
      }
    } else {
      const vp = editor.getViewportPageBounds()
      centerX = vp.x + vp.w / 2; centerY = vp.y + vp.h / 2
    }
  } else {
    const vp = editor.getViewportPageBounds()
    centerX = vp.x + vp.w / 2; centerY = vp.y + vp.h / 2
  }

  const results = await Promise.allSettled(urls.map((url) => loadImage(url)))

  const assets: TLAsset[] = []
  const shapes: Record<string, any>[] = []
  const placed: { shapeId: string; url: string }[] = []

  let stagger = 0
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('Failed to load image for canvas:', result.reason)
      continue
    }

    const img = result.value
    const { naturalWidth: w, naturalHeight: h } = img
    const safeSrc = await toSafeUrl(img.src)
    const assetId = AssetRecordType.createId()
    const shapeId = `shape:img-${Date.now()}-${stagger}-${Math.random().toString(36).slice(2, 8)}`

    assets.push({
      id: assetId,
      type: 'image',
      typeName: 'asset',
      props: {
        name: `image-${stagger}.png`,
        src: safeSrc,
        w, h,
        mimeType: 'image/png',
        isAnimated: false,
      },
      meta: {},
    } as TLAsset)

    shapes.push({
      id: shapeId,
      type: 'image',
      x: centerX - w / 2 + stagger * 40,
      y: centerY - h / 2 + stagger * 40,
      props: { assetId, w, h, url: '' },
    })

    placed.push({ shapeId, url: safeSrc })
    stagger++
  }

  if (shapes.length > 0) {
    try {
      editor.createAssets(assets)
      editor.createShapes(shapes as any)
      editor.zoomToFit({ animation: { duration: 300 } })
      return placed
    } catch (err) {
      console.error('Failed to place images on canvas:', err)
    }
  }

  return []
}

/** Create placeholder shapes on canvas while images are generating. Returns shape IDs. */
export function createPlaceholderShapes(
  editor: Editor | null,
  count: number,
  opts?: { nearShapeIds?: string[] },
): string[] {
  if (!editor || count <= 0) return []

  let cx: number, cy: number
  if (opts?.nearShapeIds && opts.nearShapeIds.length > 0) {
    const ref = editor.getShape(opts.nearShapeIds[opts.nearShapeIds.length - 1] as any)
    if (ref) {
      const bounds = editor.getShapePageBounds(ref)
      if (bounds) { cx = bounds.x + bounds.w + 80; cy = bounds.y }
      else { const vp = editor.getViewportPageBounds(); cx = vp.x + vp.w / 2; cy = vp.y + vp.h / 2 }
    } else {
      const vp = editor.getViewportPageBounds(); cx = vp.x + vp.w / 2; cy = vp.y + vp.h / 2
    }
  } else {
    const vp = editor.getViewportPageBounds()
    cx = vp.x + vp.w / 2; cy = vp.y + vp.h / 2
  }

  const size = 420
  const ids: string[] = []

  for (let i = 0; i < count; i++) {
    const offsetX = i * 48
    const offsetY = i * 24
    const pid = `shape:placeholder-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`

    try {
      // Placeholder card — rounded rectangle (label rendered by LoadingOverlayUtil)
      editor.createShapes([{
        id: pid,
        type: 'geo',
        x: cx - size / 2 + offsetX,
        y: cy - size / 2 + offsetY,
        props: {
          geo: 'rectangle',
          w: size,
          h: size,
          color: 'violet',
          fill: 'semi',
          dash: 'draw',
          size: 'm',
        },
      }] as any)
      ids.push(pid)
    } catch (err) {
      console.error('Failed to create placeholder:', err)
    }
  }

  editor.zoomToFit({ animation: { duration: 300 } })
  return ids
}

/** Draw directional arrows from source shapes to target shapes on the canvas. */
export function connectWithArrows(
  editor: Editor | null,
  fromShapeIds: string[],
  toShapeIds: string[],
): void {
  if (!editor || fromShapeIds.length === 0 || toShapeIds.length === 0) return

  const arrowShapes: any[] = []

  for (const fromId of fromShapeIds) {
    const fromBounds = editor.getShapePageBounds(fromId as any)
    if (!fromBounds) continue

    for (const toId of toShapeIds) {
      const toBounds = editor.getShapePageBounds(toId as any)
      if (!toBounds) continue

      const sx = fromBounds.x + fromBounds.w
      const sy = fromBounds.y + fromBounds.h / 2
      const ex = toBounds.x
      const ey = toBounds.y + toBounds.h / 2

      arrowShapes.push({
        type: 'arrow',
        x: sx,
        y: sy,
        props: {
          start: { x: 0, y: 0 },
          end: { x: ex - sx, y: ey - sy },
          color: 'violet',
          dash: 'dashed',
          size: 's',
          arrowheadStart: 'none',
          arrowheadEnd: 'arrow',
        },
      })
    }
  }

  if (arrowShapes.length > 0) {
    try {
      editor.createShapes(arrowShapes)
    } catch (err) {
      console.error('Failed to create arrow connectors:', err)
    }
  }
}

/** Replace placeholder shapes with real images at the exact same positions. */
export async function replacePlaceholders(
  editor: Editor | null,
  placeholderIds: string[],
  imageUrls: string[],
): Promise<string[]> {
  if (!editor || placeholderIds.length === 0 || imageUrls.length === 0) return []

  // Capture placeholder bounds before removing them
  const positions: { x: number; y: number; w: number; h: number }[] = []
  for (const pid of placeholderIds) {
    if (!pid.startsWith('shape:placeholder-')) {
      // Only capture actual placeholder shapes (not label text shapes)
      const shape = editor.getShape(pid as any)
      if (!shape || shape.type !== 'geo') continue
    }
    const bounds = editor.getShapePageBounds(pid as any)
    if (bounds) {
      positions.push({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h })
    }
  }

  // Remove all placeholders and labels
  removeShapes(editor, placeholderIds)

  // Load images — pair with placeholder positions, extras get center fallback
  const imageItems = imageUrls.map((url, i) => ({
    url,
    pos: positions[i] || null,
    load: loadImage(url),
  }))
  const results = await Promise.allSettled(imageItems)

  const assets: TLAsset[] = []
  const shapeDefs: Record<string, any>[] = []
  const outIds: string[] = []
  let fallbackIdx = 0

  for (const item of results) {
    if (item.status === 'rejected') continue

    const { pos } = item.value
    const img = await item.value.load.catch(() => null)
    if (!img) continue

    const assetId = AssetRecordType.createId()
    const shapeId = `shape:img-${Date.now()}-${fallbackIdx}-${Math.random().toString(36).slice(2, 8)}`
    const imgW = img.naturalWidth
    const imgH = img.naturalHeight
    const safeSrc = await toSafeUrl(img.src)

    assets.push({
      id: assetId,
      type: 'image',
      typeName: 'asset',
      props: {
        name: `gen-${fallbackIdx}.png`,
        src: safeSrc,
        w: imgW,
        h: imgH,
        mimeType: 'image/png',
        isAnimated: false,
      },
      meta: {},
    } as TLAsset)

    // Position at placeholder location — fit image within placeholder bounds
    let px: number, py: number, pw: number, ph: number
    if (pos) {
      // Center the image within the placeholder bounds, maintaining aspect ratio
      const scale = Math.min(pos.w / imgW, pos.h / imgH, 1)
      pw = imgW * scale
      ph = imgH * scale
      px = pos.x + (pos.w - pw) / 2
      py = pos.y + (pos.h - ph) / 2
    } else {
      const vp = editor.getViewportPageBounds()
      px = vp.x + vp.w / 2 - imgW / 2 + fallbackIdx * 40
      py = vp.y + vp.h / 2 - imgH / 2 + fallbackIdx * 40
      pw = imgW
      ph = imgH
    }

    shapeDefs.push({
      id: shapeId,
      type: 'image',
      x: px,
      y: py,
      props: { assetId, w: pw, h: ph, url: '' },
    })
    outIds.push(shapeId)
    fallbackIdx++
  }

  if (shapeDefs.length > 0) {
    try {
      editor.createAssets(assets)
      editor.createShapes(shapeDefs as any)
    } catch (err) {
      console.error('Failed to replace placeholders:', err)
    }
  }

  return outIds
}

/** Remove shapes by ID from the canvas. */
export function removeShapes(editor: Editor | null, shapeIds: string[]): void {
  if (!editor || shapeIds.length === 0) return
  try {
    editor.deleteShapes(shapeIds as any)
  } catch (err) {
    console.error('Failed to remove shapes:', err)
  }
}

/** Result of creating an edit annotation on the canvas. */
export interface AnnotationShapeResult {
  textShapeId: string
  arrowShapeId: string
}

/**
 * Create a native tldraw text + arrow pair for an edit annotation.
 * The text is placed outside the image bounds (left or right based on point position),
 * and the arrow points from the image edge to the exact point.
 */
export function createAnnotationShapes(
  editor: Editor,
  imageShapeId: string,
  pageX: number,
  pageY: number,
): AnnotationShapeResult | null {
  const shape = editor.getShape(imageShapeId as any)
  if (!shape || shape.type !== 'image') return null

  const bounds = editor.getShapePageBounds(shape)
  if (!bounds) return null

  const relX = (pageX - bounds.x) / bounds.w
  // Place text to the LEFT if point is on the right half, RIGHT otherwise
  const placeLeft = relX > 0.5
  const textW = 200
  const gap = 48

  // Text position: aligned with point Y, outside image horizontally
  let textX: number
  let arrowStartX: number
  let arrowStartY = pageY

  if (placeLeft) {
    textX = bounds.x - textW - gap
    // Arrow starts at the left edge of the image, same Y as point
    arrowStartX = bounds.x
  } else {
    textX = bounds.x + bounds.w + gap
    // Arrow starts at the right edge of the image, same Y as point
    arrowStartX = bounds.x + bounds.w
  }

  // Clamp text Y to stay near the image
  const textY = Math.max(bounds.y - 10, Math.min(bounds.y + bounds.h - 30, pageY - 15))

  const textShapeId = `shape:edit-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const arrowShapeId = `shape:edit-arrow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // Arrow end point offset (from arrow start to the held point)
  const endX = pageX - arrowStartX
  const endY = pageY - arrowStartY

  try {
    editor.createShapes([
      {
        id: textShapeId,
        type: 'text',
        x: textX,
        y: textY,
        props: {
          richText: toRichText('修改: '),
          color: 'red',
          size: 'm',
          w: textW,
          autoSize: true,
        },
      },
      {
        id: arrowShapeId,
        type: 'arrow',
        x: arrowStartX,
        y: arrowStartY,
        props: {
          start: { x: 0, y: 0 },
          end: { x: endX, y: endY },
          color: 'red',
          size: 's',
          arrowheadStart: 'none',
          arrowheadEnd: 'arrow',
        },
      },
    ] as any)

    // Auto-focus the text shape for editing after a short delay
    setTimeout(() => {
      try { editor.setEditingShape(textShapeId as any) } catch { /* ignore */ }
    }, 100)

    return { textShapeId, arrowShapeId }
  } catch (err) {
    console.error('Failed to create annotation shapes:', err)
    return null
  }
}
