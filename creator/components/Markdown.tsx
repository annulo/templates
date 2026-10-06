import ReactMarkdown from 'react-markdown'
import { cn } from '../lib/utils'

// Markdown 预览（稿件正文、任务的写法）。页面的 Tailwind 没有 typography 插件（prose），这里给常用元素配样式。
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('space-y-3 text-sm leading-relaxed [overflow-wrap:anywhere]', className)}>
      <ReactMarkdown
        components={{
          h1: (p) => <h1 className="pt-2 text-xl font-semibold" {...p} />,
          h2: (p) => <h2 className="pt-2 text-lg font-semibold" {...p} />,
          h3: (p) => <h3 className="pt-1 text-base font-semibold" {...p} />,
          ul: (p) => <ul className="list-disc space-y-1 pl-5" {...p} />,
          ol: (p) => <ol className="list-decimal space-y-1 pl-5" {...p} />,
          a: (p) => <a className="text-primary-text underline underline-offset-2" target="_blank" rel="noreferrer" {...p} />,
          blockquote: (p) => <blockquote className="border-l-2 border-border pl-3 text-muted-foreground" {...p} />,
          code: (p) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...p} />,
          img: (p) => <img className="max-h-80 rounded-lg border border-border" alt="" {...p} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
