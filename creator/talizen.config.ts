import type { TalizenConfig } from "talizen"

// 主题：从 Shuttle 打开时和 Shuttle 同源，读它记住的主题并监听切换；单独打开时跟随系统。
// 放在 head 里渲染前执行，避免先白后黑闪一下。
const themeScript = `<script>(function(){
  function apply(t){var el=document.documentElement;el.setAttribute('data-theme',t);el.style.colorScheme=t}
  var t='dark';
  try{var s=localStorage.getItem('shuttle.theme');if(s==='light'||s==='dark')t=s;else if(matchMedia('(prefers-color-scheme: light)').matches)t='light'}catch(e){}
  apply(t);
  addEventListener('message',function(e){if(e.origin===location.origin&&e.data&&e.data.type==='shuttle:theme')apply(e.data.theme)});
  // 后退前进从缓存里拿回来的页面不重跑脚本、错过了切主题的消息；别的窗口切了主题这里收不到消息：都按记住的重新设一次
  function saved(){try{var s=localStorage.getItem('shuttle.theme');if(s==='light'||s==='dark')apply(s)}catch(e){}}
  addEventListener('pageshow',function(e){if(e.persisted)saved()});
  addEventListener('storage',function(e){if(e.key==='shuttle.theme')saved()});
})()</script>`

export default {
  // 文章正文编辑器 Tiptap（平台没内置，从 esm.talizen.com 加载）。只在浏览器里用（components/RichEditor.tsx 动态加载），SSR 里没有。
  // importMap 只能写静态值。升级时所有版本号一起改：@tiptap/core、@tiptap/pm 标成 external 由这里统一给一份，
  // 不然各包各带一份 ProseMirror，编辑器会报错。
  importMap: {
    imports: {
      // core 的日期时间选择（components/DateTimePicker.tsx，shadcn 的月历）：react-day-picker 和它的中文
      "react-day-picker": "https://esm.talizen.com/react-day-picker@9.14.0?bundle&external=react,react-dom",
      "date-fns/locale/zh-CN": "https://esm.talizen.com/date-fns@4.1.0/locale/zh-CN?bundle",
      "@tiptap/core": "https://esm.talizen.com/@tiptap/core@3.31.3?bundle&external=@tiptap/pm",
      // 平台会把 importMap 里别的包加进 external，子路径连自己的包也被标成 external、import 不到自己的文件；
      // 这个文件没有依赖，直接用原文件（?raw），怎么加 external 都不影响
      "@tiptap/core/jsx-runtime": "https://esm.talizen.com/@tiptap/core@3.31.3/dist/jsx-runtime/jsx-runtime.js?raw",
      "@tiptap/pm/": "https://esm.talizen.com/@tiptap/pm@3.31.3/",
      "@tiptap/react": "https://esm.talizen.com/@tiptap/react@3.31.3?bundle&external=react,react-dom,@tiptap/core,@tiptap/pm",
      "@tiptap/react/menus": "https://esm.talizen.com/@tiptap/react@3.31.3/menus?bundle&external=react,react-dom,@tiptap/core,@tiptap/pm",
      "@tiptap/starter-kit": "https://esm.talizen.com/@tiptap/starter-kit@3.31.3?bundle&external=@tiptap/core,@tiptap/pm",
      "@tiptap/extensions": "https://esm.talizen.com/@tiptap/extensions@3.31.3?bundle&external=@tiptap/core,@tiptap/pm",
      "@tiptap/extension-image": "https://esm.talizen.com/@tiptap/extension-image@3.31.3?bundle&external=@tiptap/core,@tiptap/pm",
      // 内容文件夹的 .md 用编辑器直接读写 md：官方的 Markdown 扩展、表格、任务列表（components/rich/mdExtensions.ts）。
      // @tiptap/markdown 用 marked 解析，和下面 lib/mdhtml.ts 用的是同一份（external=marked），版本要对上它的依赖（marked ^17）
      "@tiptap/markdown": "https://esm.talizen.com/@tiptap/markdown@3.31.3?bundle&external=@tiptap/core,@tiptap/pm,marked",
      "@tiptap/extension-table": "https://esm.talizen.com/@tiptap/extension-table@3.31.3?bundle&external=@tiptap/core,@tiptap/pm",
      "@tiptap/extension-list": "https://esm.talizen.com/@tiptap/extension-list@3.31.3?bundle&external=@tiptap/core,@tiptap/pm",
      // 发布时 md → HTML 用 marked、老文章搬进文件夹时 HTML → md 用 turndown（lib/mdhtml.ts）
      "marked": "https://esm.talizen.com/marked@17.0.1?bundle",
      "turndown": "https://esm.talizen.com/turndown@7.2.0?bundle",
      "turndown-plugin-gfm": "https://esm.talizen.com/turndown-plugin-gfm@1.0.2?bundle",
      // 拖拽排序（components/Sortable.tsx，发布时的配图顺序）：sortable 和 core 要共用同一份 core（拖拽的上下文在里面），标成 external 由这里统一给
      "@dnd-kit/core": "https://esm.talizen.com/@dnd-kit/core@6.3.1?bundle&external=react,react-dom,@dnd-kit/utilities",
      "@dnd-kit/sortable": "https://esm.talizen.com/@dnd-kit/sortable@10.0.0?bundle&external=react,react-dom,@dnd-kit/core,@dnd-kit/utilities",
      "@dnd-kit/utilities": "https://esm.talizen.com/@dnd-kit/utilities@3.2.2?bundle&external=react",
    },
  },
  // 中英双语：默认中文，英文地址带 /en。Shuttle 外壳切语言时写 cookie CREGHT_LOCALE
  i18n: { defaultLocale: "zh", locales: ["zh", "en"], localeDetection: true },
  metadata: (ctx) =>
    ctx.locale === "en"
      ? { title: "Creator studio", description: "Ideas, drafts and posts for every platform, with followers and engagement in one place" }
      : { title: "自媒体工作台", description: "选题、写文章、各平台的帖子，粉丝和互动都在一处" },
  html: { "data-theme": "dark" },
  head: themeScript,
} satisfies TalizenConfig
