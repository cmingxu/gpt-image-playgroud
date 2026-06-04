import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, ImageIcon, Loader2, Download, Trash2, Clock, ExternalLink, Info } from 'lucide-react'

import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Textarea } from '../components/ui/textarea'
import { Select } from '../components/ui/select'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { useToast } from '../hooks/use-toast'

export function ImageGeneratorPage() {
  const [apiEndpoint, setApiEndpoint] = useState('https://mm-internal-cn.leonecloud.com')
  const [apiKey, setApiKey] = useState('')
  const [genType, setGenType] = useState('t2i')
  const [prompt, setPrompt] = useState(
    '生成一张单张 9:16 竖版、真实感很强的 手机自拍 RAW 照片。场景为中国城市高端商场或精品内衣店的试衣间，一位 20 多岁的成年亚洲女性 正在试穿新买或准备购买的内衣，在镜子前用手机自拍，想看看上身效果，或者发给闺蜜参考。画面不是广告大片，也不是专业棚拍，而是一张真实、自然、轻微随手感的私人记录照，像手机相册里拍下来的试穿确认图。',
  )
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [resolution, setResolution] = useState('1K')
  const [nsfwChecker, setNsfwChecker] = useState(true)
  const [imageUrls, setImageUrls] = useState('')

  const [images, setImages] = useState<string[]>([])
  const [lastTaskId, setLastTaskId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    return () => {
      if (elapsedRef.current) clearInterval(elapsedRef.current)
    }
  }, [])

  const formatElapsed = useCallback((seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return m > 0 ? `${m}分${s}秒` : `${s}秒`
  }, [])

  const handleGenerate = async () => {
    if (!apiEndpoint.trim()) {
      toast({ title: '参数错误', description: '请输入 API 地址', variant: 'destructive' })
      return
    }
    if (!apiKey.trim()) {
      toast({ title: '参数错误', description: '请输入 API 密钥', variant: 'destructive' })
      return
    }
    if (!prompt.trim()) {
      toast({ title: '参数错误', description: '请输入提示词', variant: 'destructive' })
      return
    }
    if (genType === 'i2i' && !imageUrls.trim()) {
      toast({ title: '参数错误', description: '图生图模式需要提供图片链接', variant: 'destructive' })
      return
    }

    setGenerating(true)
    setElapsed(0)
    setImages([])
    setLastTaskId('')

    const startTime = Date.now()
    elapsedRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    try {
      const urls = imageUrls
        .split('\n')
        .map((u) => u.trim())
        .filter(Boolean)

      const resp = await fetch('/api/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiEndpoint: apiEndpoint.trim(),
          apiKey: apiKey.trim(),
          prompt: prompt.trim(),
          genType,
          aspectRatio,
          resolution,
          nsfwChecker,
          imageUrls: genType === 'i2i' ? urls : undefined,
        }),
      })

      const data = await resp.json()

      if (data.status === 'success') {
        setImages(data.result || [])
        setLastTaskId(data.taskId || '')
        toast({
          title: '生成成功',
          description: `已生成 ${data.result?.length || 0} 张图片`,
        })
      } else if (data.status === 'failed') {
        toast({
          title: '生成失败',
          description: data.errorMsg || '未知错误',
          variant: 'destructive',
        })
        setLastTaskId(data.taskId || '')
      } else {
        throw new Error(data.error || '未知响应')
      }
    } catch (e) {
      toast({
        title: '生成失败',
        description: (e as Error).message,
        variant: 'destructive',
      })
    } finally {
      if (elapsedRef.current) clearInterval(elapsedRef.current)
      setGenerating(false)
    }
  }

  const handleDownload = async (url: string, index: number) => {
    try {
      const resp = await fetch(url)
      const blob = await resp.blob()
      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `生成图片-${index + 1}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(blobUrl)
    } catch {
      window.open(url, '_blank')
    }
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-4rem)] p-6">
      {/* 左侧面板 — 参数配置 */}
      <Card className="w-[420px] shrink-0 flex flex-col">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-primary" />
            GPT Image 2
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto space-y-5">
          {/* API 地址 */}
          <div className="space-y-2">
            <Label htmlFor="apiEndpoint">API 地址</Label>
            <Input
              id="apiEndpoint"
              value={apiEndpoint}
              onChange={(e) => setApiEndpoint(e.target.value)}
              placeholder="https://mm-accelerate.leonecloud.com"
            />
          </div>

          {/* API 密钥 */}
          <div className="space-y-2">
            <Label htmlFor="apiKey">API 密钥</Label>
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="fc_..."
            />
          </div>

          {/* 生成类型 */}
          <div className="space-y-2">
            <Label htmlFor="genType">生成类型</Label>
            <Select id="genType" value={genType} onChange={(e) => setGenType(e.target.value)}>
              <option value="t2i">文生图 (t2i)</option>
              <option value="i2i">图生图 (i2i)</option>
            </Select>
          </div>

          {/* 提示词 */}
          <div className="space-y-2">
            <Label htmlFor="prompt">提示词</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="请描述你想要生成的图像…"
              rows={4}
            />
            <p className="text-xs text-muted-foreground">最多 20,000 个字符</p>
          </div>

          {/* 宽高比 & 分辨率 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="aspectRatio">宽高比</Label>
              <Select id="aspectRatio" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                <option value="auto">自动</option>
                <option value="1:1">1:1</option>
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
                <option value="4:3">4:3</option>
                <option value="3:4">3:4</option>
                <option value="3:2">3:2</option>
                <option value="2:3">2:3</option>
                <option value="5:4">5:4</option>
                <option value="4:5">4:5</option>
                <option value="21:9">21:9</option>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="resolution">分辨率</Label>
              <Select id="resolution" value={resolution} onChange={(e) => setResolution(e.target.value)}>
                <option value="1K">1K</option>
                <option value="2K">2K</option>
                <option value="4K">4K</option>
              </Select>
              {aspectRatio === 'auto' && (
                <p className="text-xs text-muted-foreground">自动比例仅支持 1K 分辨率</p>
              )}
            </div>
          </div>

          {/* NSFW 检测 */}
          <div className="flex items-center gap-3">
            <input
              id="nsfwChecker"
              type="checkbox"
              checked={nsfwChecker}
              onChange={(e) => setNsfwChecker(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            <Label htmlFor="nsfwChecker" className="cursor-pointer">
              开启 NSFW 内容检测
            </Label>
          </div>

          {/* 图片链接（仅图生图模式） */}
          {genType === 'i2i' && (
            <div className="space-y-2">
              <Label htmlFor="imageUrls">图片链接</Label>
              <Textarea
                id="imageUrls"
                value={imageUrls}
                onChange={(e) => setImageUrls(e.target.value)}
                placeholder="https://example.com/reference.jpg&#10;每行一个链接，最多 16 张图片"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">每行一个链接，最多 16 张图片</p>
            </div>
          )}

          {/* 生成按钮 */}
          <Button onClick={handleGenerate} disabled={generating} className="w-full">
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                生成中…（{formatElapsed(elapsed)}）
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                开始生成
              </>
            )}
          </Button>

          {/* 生成中的进度提示 */}
          {generating && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>等待任务完成 — 已等待 {formatElapsed(elapsed)}</span>
            </div>
          )}

          {lastTaskId && !generating && (
            <p className="text-xs text-muted-foreground text-center break-all">
              上次任务：{lastTaskId}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 右侧面板 — 图片预览 */}
      <Card className="flex-1 flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ImageIcon className="h-5 w-5 text-primary" />
            预览
          </CardTitle>
          {images.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => { setImages([]); setLastTaskId('') }}>
              <Trash2 className="h-4 w-4" />
              清除
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto">
          {generating ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">正在生成图片…</p>
                <p className="text-xs">通常需要 10–60 秒</p>
              </div>
            </div>
          ) : images.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
              <ImageIcon className="h-16 w-16 opacity-20" />
              <div className="text-center space-y-1">
                <p className="text-sm">生成的图片将显示在这里</p>
                <p className="text-xs flex items-center gap-1 justify-center">
                  <Info className="h-3 w-3" />
                  异步任务 — 服务器将自动轮询直至完成
                </p>
              </div>
            </div>
          ) : (
            <div className={`grid gap-4 ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2'}`}>
              {images.map((url, i) => (
                <div key={i} className="space-y-2">
                  <div className="relative group rounded-lg overflow-hidden border bg-muted">
                    <img
                      src={url}
                      alt={`生成图片 ${i + 1}`}
                      className="w-full h-auto object-contain max-h-[70vh]"
                    />
                    <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="sm" variant="secondary" onClick={() => handleDownload(url, i)}>
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => window.open(url, '_blank')}>
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
