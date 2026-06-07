/**
 * Browser-native image segmentation using Sobel edge detection.
 * No ML model — fast, instant, works everywhere.
 */

/**
 * Run Sobel edge detection on the given image at the hover point.
 * Returns an ImageData mask highlighting edges and the hovered region.
 */
export async function segmentAtPoint(
  src: string,
  point: { x: number; y: number },
  imageSize: { w: number; h: number },
): Promise<ImageData> {
  const img = await loadImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = imageSize.w
  canvas.height = imageSize.h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, imageSize.w, imageSize.h)
  const imageData = ctx.getImageData(0, 0, imageSize.w, imageSize.h)

  const { data, width: w, height: h } = imageData

  // Convert to grayscale
  const gray = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const off = i * 4
    gray[i] = Math.round(data[off] * 0.299 + data[off + 1] * 0.587 + data[off + 2] * 0.114)
  }

  // Sobel edge detection (3x3 kernel)
  const edges = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const tl = gray[(y - 1) * w + (x - 1)]
      const t = gray[(y - 1) * w + x]
      const tr = gray[(y - 1) * w + (x + 1)]
      const l = gray[y * w + (x - 1)]
      const r = gray[y * w + (x + 1)]
      const bl = gray[(y + 1) * w + (x - 1)]
      const b = gray[(y + 1) * w + x]
      const br = gray[(y + 1) * w + (x + 1)]

      const gx = -tl - 2 * l - bl + tr + 2 * r + br
      const gy = -tl - 2 * t - tr + bl + 2 * b + br
      edges[y * w + x] = Math.min(255, Math.sqrt(gx * gx + gy * gy))
    }
  }

  // Find the hover point's connected region using flood fill
  const px = Math.min(Math.max(Math.round(point.x), 0), w - 1)
  const py = Math.min(Math.max(Math.round(point.y), 0), h - 1)
  const seedGray = gray[py * w + px]

  // Flood fill from hover point with color tolerance
  const region = new Uint8Array(w * h)
  const tolerance = 30
  const queue: number[] = [py * w + px]
  region[py * w + px] = 255
  let head = 0

  while (head < queue.length && head < 80000) {
    const idx = queue[head++]
    const cy = Math.floor(idx / w)
    const cx = idx % w

    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = cx + dx
      const ny = cy + dy
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
      const nidx = ny * w + nx
      if (region[nidx]) continue
      if (Math.abs(gray[nidx] - seedGray) > tolerance) continue
      region[nidx] = 255
      queue.push(nidx)
    }
  }

  // Combine: edges (strong) + flood-filled region (subtle)
  const mask = new ImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4
    const edgeVal = edges[i]
    const regionVal = region[i]

    if (edgeVal > 100 || regionVal > 0) {
      mask.data[idx] = 99       // R - indigo
      mask.data[idx + 1] = 102  // G
      mask.data[idx + 2] = 241  // B
      mask.data[idx + 3] = Math.min(255,
        (edgeVal > 100 ? Math.min(edgeVal, 220) : 0) +
        (regionVal > 0 ? 60 : 0)
      )
    }
  }

  return mask
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Don't set crossOrigin on blob URLs — they're same-origin and don't support CORS
    if (!src.startsWith('blob:')) {
      img.crossOrigin = 'anonymous'
    }
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load: ${src}`))
    img.src = src
  })
}

/** No-op — no model to preload */
export async function preloadModel(): Promise<void> {}
