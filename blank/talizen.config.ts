import type { TalizenConfig } from 'talizen'

// 主题：在 Annulo 里打开时和外壳同源，读它记住的主题并监听切换；单独打开时跟随系统。放在 head 里，渲染前执行。
const themeScript = `<script>(function(){
  function apply(t){var el=document.documentElement;el.setAttribute('data-theme',t);el.style.colorScheme=t}
  var t='dark';
  try{var s=localStorage.getItem('annulo.theme')||localStorage.getItem('shuttle.theme');if(s==='light'||s==='dark')t=s;else if(matchMedia('(prefers-color-scheme: light)').matches)t='light'}catch(e){}
  apply(t);
  addEventListener('message',function(e){if(e.origin===location.origin&&e.data&&(e.data.type==='annulo:theme'||e.data.type==='shuttle:theme'))apply(e.data.theme)});
})()</script>`

export default {
  // 页面默认能加载的包（react、radix-ui、lucide-react……）之外，要用的包在这里声明：写死版本，加 ?bundle 把依赖打成一个文件，
  // external 掉 react（不然页面里有两份 React）；子路径每个一条。用 esm.talizen.com：esm.sh 的 ?bundle 不打 date-fns 这类包，一次要请求几百个文件。
  importMap: {
    imports: {
      'react-day-picker': 'https://esm.talizen.com/react-day-picker@9.14.0?bundle&external=react,react-dom',
      'date-fns/locale/zh-CN': 'https://esm.talizen.com/date-fns@4.1.0/locale/zh-CN?bundle',
    },
  },
  i18n: { defaultLocale: 'zh', locales: ['zh', 'en'], localeDetection: true },
  metadata: (ctx) => (ctx.locale === 'en' ? { title: 'My project' } : { title: '我的项目' }),
  html: { 'data-theme': 'dark' },
  head: themeScript,
} satisfies TalizenConfig
