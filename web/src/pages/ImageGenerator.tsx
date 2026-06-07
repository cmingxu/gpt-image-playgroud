import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, ImageIcon, Loader2, Download, Trash2, Clock, ExternalLink, Info, Upload, X, History } from 'lucide-react'

import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Textarea } from '../components/ui/textarea'
import { Select } from '../components/ui/select'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { useToast } from '../hooks/use-toast'
import { cn } from '../lib/utils'

interface HistoryItem {
  id: number
  taskId: string
  genType: string
  status: string
  prompt: string
  resultUrls: string[]
  inputUrls: string[]
  errorMsg: string
  createdAtUtc: string
}

export function ImageGeneratorPage() {
  const [apiEndpoint, setApiEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [genType, setGenType] = useState('t2i')
  const [prompt, setPrompt] = useState(
    '根据提供的图片，我想改变图上文字， 下面 logo 换成"零噪光电"， 型号改成"PDAS19301"， 文字"Amplidied Detector"换成"光电转换器"; 对外观进行合理化微调， 我想生成的图上包含两个设备， 并列排列，一个左倾 30 度角， 一个正面',
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

  // Local file upload state
  const [localFiles, setLocalFiles] = useState<File[]>([])
  const [localPreviews, setLocalPreviews] = useState<string[]>([])
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // History state
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null)

  useEffect(() => {
    return () => {
      if (elapsedRef.current) clearInterval(elapsedRef.current)
    }
  }, [])

  // Cleanup blob URLs when previews change or component unmounts
  useEffect(() => {
    const urls = localPreviews
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [localPreviews])

  const formatElapsed = useCallback((seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return m > 0 ? `${m}分${s}秒` : `${s}秒`
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const resp = await fetch('/api/history?limit=50')
      const data = await resp.json()
      setHistory(data.items || [])
      setHistoryTotal(data.total || 0)
    } catch {
      // Ignore errors when DB is not configured
    }
  }, [])

  // Fetch history on mount
  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  const handleSelectHistory = (item: HistoryItem) => {
    setSelectedHistoryId(item.id)
    setPrompt(item.prompt)
    setGenType(item.genType)
    setLastTaskId(item.taskId)
    if (item.status === 'success') {
      setImages(item.resultUrls)
    } else {
      setImages([])
    }
    // Restore input image URLs and clear any local file state
    setLocalFiles([])
    setLocalPreviews((prev) => {
      prev.forEach((u) => URL.revokeObjectURL(u))
      return []
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
    // Reconstruct URL textarea from history inputUrls
    setImageUrls((item.inputUrls || []).join('\n'))
  }

  const handleDeleteHistory = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await fetch(`/api/history/${id}`, { method: 'DELETE' })
    } catch {
      // Ignore errors
    }
    if (selectedHistoryId === id) {
      setSelectedHistoryId(null)
    }
    fetchHistory()
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])

    if (files.length + localFiles.length > 16) {
      toast({ title: '文件过多', description: '最多选择 16 张图片', variant: 'destructive' })
      return
    }

    const validFiles = files.filter((f) => {
      if (!f.type.startsWith('image/')) {
        toast({ title: '格式不支持', description: `"${f.name}" 不是图片文件`, variant: 'destructive' })
        return false
      }
      if (f.size > 10 * 1024 * 1024) {
        toast({ title: '文件过大', description: `"${f.name}" 超过 10MB 限制`, variant: 'destructive' })
        return false
      }
      return true
    })

    const merged = [...localFiles, ...validFiles].slice(0, 16)
    setLocalFiles(merged)
    setLocalPreviews(merged.map((f) => URL.createObjectURL(f)))

    // Reset input so re-selecting the same file works
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeFile = (index: number) => {
    URL.revokeObjectURL(localPreviews[index])
    setLocalFiles((prev) => prev.filter((_, i) => i !== index))
    setLocalPreviews((prev) => prev.filter((_, i) => i !== index))
  }

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast({ title: '参数错误', description: '请输入提示词', variant: 'destructive' })
      return
    }
    if (genType === 'i2i' && !imageUrls.trim() && localFiles.length === 0) {
      toast({ title: '参数错误', description: '图生图模式需要提供图片（本地上传或链接）', variant: 'destructive' })
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
      // Upload local files first to get base64 data URLs
      let uploadedUrls: string[] = []
      if (genType === 'i2i' && localFiles.length > 0) {
        setUploadingFiles(true)
        const formData = new FormData()
        localFiles.forEach((f) => formData.append('files', f))

        const uploadResp = await fetch('/api/image/upload', {
          method: 'POST',
          body: formData,
        })

        const uploadData = await uploadResp.json()
        if (!uploadResp.ok) {
          throw new Error(uploadData.error || '文件上传失败')
        }
        uploadedUrls = uploadData.urls || []
        setUploadingFiles(false)
      }

      // Merge: manually entered URLs + uploaded base64 URLs
      const manualUrls = imageUrls
        .split('\n')
        .map((u) => u.trim())
        .filter(Boolean)

      const allUrls = [...uploadedUrls, ...manualUrls]

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
          imageUrls: genType === 'i2i' && allUrls.length > 0 ? allUrls : undefined,
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
      setUploadingFiles(false)
      fetchHistory()
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
    <div className="flex gap-6 h-full p-6">
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
              placeholder="https://api.example.com"
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

          {/* 图片上传 & 链接（仅图生图模式） */}
          {genType === 'i2i' && (
            <div className="space-y-4">
              {/* 本地上传 */}
              <div className="space-y-2">
                <Label>本地上传</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/bmp"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  type="button"
                  disabled={localFiles.length >= 16}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full"
                >
                  <Upload className="h-4 w-4" />
                  {localFiles.length > 0
                    ? `已选择 ${localFiles.length}/16 张`
                    : '选择本地图片'}
                </Button>

                {/* 预览缩略图 */}
                {localPreviews.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {localPreviews.map((url, i) => (
                      <div key={i} className="relative w-16 h-16 rounded border overflow-hidden group">
                        <img
                          src={url}
                          alt={`预览 ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="absolute top-0 right-0 bg-destructive text-white rounded-bl p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label={`移除图片 ${i + 1}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* URL 链接（可选） */}
              <div className="space-y-2">
                <Label htmlFor="imageUrls">图片链接（可选）</Label>
                <Textarea
                  id="imageUrls"
                  value={imageUrls}
                  onChange={(e) => setImageUrls(e.target.value)}
                  placeholder="https://example.com/reference.jpg&#10;每行一个链接"
                  rows={2}
                />
              </div>

              <p className="text-xs text-muted-foreground">
                本地上传 + 链接合并，总计最多 16 张图片
              </p>
            </div>
          )}

          {/* 生成按钮 */}
          <Button onClick={handleGenerate} disabled={generating || uploadingFiles} className="w-full">
            {uploadingFiles ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                上传文件中…
              </>
            ) : generating ? (
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

          {/* 生成历史 */}
          {history.length > 0 && (
            <div className="space-y-3 pt-4 border-t">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <History className="h-4 w-4" />
                生成历史
              </h3>
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {history.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleSelectHistory(item)}
                    className={cn(
                      'p-2 rounded-md border cursor-pointer text-xs transition-colors hover:bg-accent',
                      selectedHistoryId === item.id && 'border-primary bg-accent',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'inline-block w-2 h-2 rounded-full shrink-0',
                          item.status === 'success' ? 'bg-green-500' : 'bg-red-500',
                        )}
                      />
                      <span className="font-mono text-muted-foreground">
                        {item.taskId.slice(0, 8)}...
                      </span>
                      <span className="text-muted-foreground">{item.genType}</span>
                      <button
                        onClick={(e) => handleDeleteHistory(item.id, e)}
                        className="ml-auto text-muted-foreground hover:text-destructive shrink-0"
                        aria-label={`删除记录 ${item.id}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="mt-1 truncate text-muted-foreground">
                      {item.status === 'failed' && item.errorMsg
                        ? `❌ ${item.errorMsg}`
                        : item.prompt}
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      {new Date(item.createdAtUtc).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
              {historyTotal > history.length && (
                <p className="text-xs text-muted-foreground text-center">
                  还有 {historyTotal - history.length} 条记录
                </p>
              )}
            </div>
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
            <div className="space-y-6">
              {/* 输入图片（仅历史记录视图） */}
              {selectedHistoryId !== null && (() => {
                const historyItem = history.find((h) => h.id === selectedHistoryId)
                const inputUrls = historyItem?.inputUrls || []
                if (inputUrls.length === 0) return null
                return (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      输入图片
                    </h3>
                    <div className={`grid gap-4 ${inputUrls.length === 1 ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2'}`}>
                      {inputUrls.map((url, i) => (
                        <div key={i} className="space-y-2">
                          <div className="relative group rounded-lg overflow-hidden border bg-muted">
                            <img
                              src={url}
                              alt={`输入图片 ${i + 1}`}
                              className="w-full h-auto object-contain max-h-[40vh]"
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
                  </div>
                )
              })()}

              {/* 生成结果 */}
              <div className="space-y-3">
                {selectedHistoryId !== null && images.length > 0 && (
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    生成结果
                  </h3>
                )}
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
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
