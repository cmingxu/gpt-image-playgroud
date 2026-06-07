import { Sparkles, Lightbulb, Wand2, Palette, ImagePlus } from 'lucide-react'

interface WelcomePromptsProps {
  onSelect: (prompt: string) => void
}

const SUGGESTIONS = [
  {
    icon: Wand2,
    label: '生成一张图片',
    prompt: '生成一张赛博朋克风格的猫，霓虹灯背景，高清细节',
  },
  {
    icon: Palette,
    label: '风格转换',
    prompt: '把这张图变成古典油画风格',
  },
  {
    icon: ImagePlus,
    label: '图像合成',
    prompt: '把第一张图的logo放到第二张图的物品上',
  },
  {
    icon: Lightbulb,
    label: '创意生成',
    prompt: '生成一张未来城市的概念设计图，4K，16:9',
  },
]

const TIPS = [
  '点击画布上的图片位置可添加编辑标注',
  '双击图片可将其添加到附件列表',
  '点击 Send 将标注和提示一起发送给 AI',
  '支持多张参考图，AI 会自动理解图片关系',
]

export function WelcomePrompts({ onSelect }: WelcomePromptsProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 space-y-6">
      {/* Hero */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10 mb-2">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <h3 className="text-base font-semibold text-foreground">
          AI 图像助手
        </h3>
        <p className="text-sm text-muted-foreground max-w-[280px]">
          描述你想生成的图像，或点击画布上的图片位置标注局部编辑
        </p>
      </div>

      {/* Suggestion cards — shadcn AI style */}
      <div className="grid grid-cols-2 gap-2 w-full max-w-[320px]">
        {SUGGESTIONS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => onSelect(item.prompt)}
              className="flex flex-col items-start gap-1.5 rounded-xl border bg-card px-3 py-2.5 text-left hover:bg-muted/50 hover:border-primary/30 transition-colors group"
            >
              <div className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <Icon className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-xs font-medium text-foreground">
                {item.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Tips */}
      <div className="w-full max-w-[320px] space-y-1.5">
        <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide">
          使用提示
        </span>
        <div className="space-y-1">
          {TIPS.map((tip, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground/70">
              <span className="mt-0.5 w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0" />
              <span>{tip}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
