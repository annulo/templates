# 网站多语言：文章和落地页

2026-11-09 起草，待定的几项已经和用户定了，**等 zhangliang 看过再做**。外贸、产品运营两个模板一起用（网站运营模块）。只改模板，不改 Annulo：要用的 creght 能力（CMS 的 `_i18n`、站点代码推送）现在都有。

## 照着 creght 的做法

creght 站点自己就支持多语言（例子：www.pofungfurniture.com，源码在 `~/dev/tutorials-case/site`），我们不另搞一套，文章和落地页都按它的结构写进去：

| 层 | creght 怎么做 | 谁来做 |
|---|---|---|
| 站点开语言 | `talizen.config.ts` 写 `i18n: { defaultLocale: "en", locales: ["en","zh","ar","pt"] }`。默认语言的网址不带前缀，其他语言是 `/zh/…`；`hreflang`、`<html lang>`、阿拉伯语的从右往左排版由平台生成 | 用户在 creght 编辑器里开（见「网站还没开多语言」） |
| 界面文字 | 短文字放 `messages/<语言>.json`，用 `getTranslations()` 取；大段文案按语言各一份，放 `lib/copy/<区块>/<语言>.ts`，用 `pick()` 取；站内链接用 `localizedPath()` 加前缀 | 落地页任务 |
| CMS 内容 | 一条内容、一个 slug。默认语言写在原来的字段里，别的语言写在平台保留字段 `body._i18n.<语言> = { 字段: 译文 }`，只放翻译过的字段。页面照常读，访问 `/zh/…` 时 SDK 自动把译文盖上去（weave：`ReservedContentBodyKeys`、`decodeBodyLocalization`） | 文章发布 |

所以：**文章 = 一篇原文 + 每种语言一份译文，发布时写进同一条 CMS 内容的 `_i18n`**；**落地页 = 一个页面文件 + 每种语言一份文案**。

## 网站的语言

- `channels` 加两个字段：`locales`（这个网站开了哪些语言，比如 `["en","zh","ar","pt"]`）、`default_locale`。只有一种语言或者为空，就是单语言网站，界面上不出现任何多语言的东西，和现在一模一样。
- 从站点的 `talizen.config.ts` 读出来，不让用户手填：配置发布（`tasks/setup-publish.md`）的时候顺便读一次存进去；网站设置里加一个「重新读取语言」，站点后来加了语言时点一下。
- 每种语言的网址前缀照 creght 的规则：默认语言不带前缀，别的是 `/<语言>`。

### 网站还没开多语言

后台不改站点代码（2026-11-09 定）：网站设置的语言一栏显示「这个网站只有一种语言」，加一个链接「去 creght 编辑器开多语言」（`adminLink` 打开这个站点的编辑器），用户在编辑器里让站点的 AI 开好，回来点「重新读取语言」。

## 文章

### 数据

- 文章表（三个模板各自的 `tables/articles.json`）加 `lang`：原文是什么语言。新建时取选题简报里的 `language`，没写就取要发的网站的 `default_locale`。
- 新表 `article_translations`（放在 core 的网站模块）：
  - `article_id`、`locale`；
  - `title`、`summary`、`body`、`keywords`：和文章同名的字段，只放译文；封面、图片、视频、slug 都跟原文走；
  - `source_hash`：翻译时原文（标题 + 摘要 + 正文）的指纹。原文后来改了，指纹对不上，就标「原文已改」；
  - `status`：`draft`（AI 刚翻好、用户还没看过）/ `ready`（用户确认过）。默认两种都能发，`draft` 只在页面上标「AI 翻的，没看过」；网站设置里可以改成「确认过才发」（2026-11-09 定）；
  - `chat_id`：翻译它的那段对话；`updated_at`。
- 单独建表、不往文章表里塞 JSON 的原因：每种语言要有自己的状态、能单独改、能看出过没过期，而且三个模板的文章表都不一样，单独一张表放在 core，每个模板都能用。

### 翻译

- 文章页上，要发的网站有多种语言时，正文上面出现语言标签：`English（原文）｜中文 · 已翻译｜العربية · 原文已改｜Português · 未翻译`。点哪种语言就看、改哪种语言的译文（手动改直接存进 `article_translations`）。
- 按钮「翻译」（`TaskButton`，新任务 `tasks/translate-article.md`），默认勾上网站开了、但还没翻译或者原文已改的那几种语言。本机函数只负责取数和存表：`translations.context` 拿原文、已有的译文、术语表、网站的语言；`translations.save` 按语言存译文和 `source_hash`。
- **写法**（用户能改）：`prompts/translate-article.md`，页面上「AI 要求」改了存到 `user/prompts/translate-article.md`。内容是每种语言的语气、地区（比如葡语用巴西葡语）、要不要本地化举例。
- **规则**（写在任务文件里，用户改不到）：照 pofung 的翻译指南（`~/dev/tutorials-case/docs/i18n-work/GUIDE.md`）写——
  - 按意思翻，不增删事实（起订量、交期、尺寸、认证），不编造；
  - HTML 结构、链接、`src`、class 原样保留，只翻文字和 `alt`；站内链接不加语言前缀，站点自己会加；
  - 型号、品牌、单位、数字不翻；阿拉伯语用西方数字；
  - SEO 标题要短，大约 40 个拉丁字符或 22 个汉字；
  - 用术语表里的说法；遇到没收录的专有词，翻完把它加进术语表。
- **接着改回到原来的对话**：译文记了 `chat_id`，「继续对话」打开翻它的那段对话。原文改了以后点「更新译文」，也回到那段对话，只改原文变动的地方；找不到原来的对话才新开一段。

### 术语表

- 新表 `glossary`：`term`（原文里的词）、`translations`（`{ "zh": "岩板", "ar": "…" }`）、`keep`（不翻，比如品牌、型号）、`note`。
- 翻文章、做落地页都读它，各语言的说法才统一。助手翻译时遇到新的专有词就补进去，用户在 网站 → 语言 页面上也能改。

### 发布

发布脚本 `local/pub_<网站>.ts` 现在写死了「文章哪项填进 CMS 哪个字段」。多语言要用同一套字段映射给每种语言算一遍，所以把这部分拆出来：

```ts
// 字段映射：只写一遍，原文和每种译文都用它
export function fields(a: Article, ctx: any) { return { title: a.title, excerpt: a.summary, content: a.body, cover: a.cover, … } }
export async function publish(input, ctx) {
  return publishTo(ctx, input, '<网站 id>', async ({ a, ch, prev, dry, i18n }) => {
    const body = { ...fields(a, ctx), ...(i18n ? { _i18n: i18n } : {}) }
    …   // 和现在一样新建或更新
  }, fields)
}
```

`publishTo`（`local/_publish.ts`）在多语言网站上多做几件事：

1. **默认语言的内容放主字段**：文章 `lang` 等于网站默认语言，就用原文；不等，就用默认语言的译文。都没有的话不发，提示「先翻成 <默认语言>」。
2. **其余语言算 `_i18n`**：对每种能发的译文（默认 `draft`、`ready` 都算，设了「确认过才发」就只算 `ready`），把译文代进文章、用 `fields()` 算一遍，和主字段比，**不一样的字段**就是这种语言的 `_i18n`。哪些字段要翻不用猜：映射出来跟着文字变的就是要翻的，封面、日期、分类这些自然一样，不会进去。
3. **不覆盖别人的译文**：更新前先读出线上这条内容，保留线上 `_i18n` 里后台不管的语言（比如用户在 creght 编辑器里手动翻的），只替换后台有译文的那几种（和 pofung 的 `upload.py` 一样）。`_creght.ts` 补一个按 id 读单条内容的函数。
4. **图片**：译文正文里的本机图片和原文一起传，按 sha256 去重，不重复传。
5. **记录**：`publications` 加 `locale_urls`（`{ "zh": "https://…/zh/blog/x" }`），按网址前缀的规则拼。发布记录、效果追踪（`trackChange` 的 `pages`）都带上这些网址。
6. **原文已改、译文没更新的**：照样按旧译文发出去，发布结果里写 `warning`，列出哪几种语言的译文落后于原文。

**老的发布脚本**没有导出 `fields`：单语言网站照常发；多语言网站发的时候只发默认语言，并提示「让 AI 更新发布脚本」（和现在缺封面字段时的做法一样，照 setup-publish 改）。setup-publish 以后写的新脚本都带 `fields`。

WordPress 没有原生多语言（要装 WPML、Polylang 这类插件，各家接口不一样），这次不做：WordPress 网站只有一种语言。

## 落地页

落地页是直接写站点代码的（`docs/landing-pages.md`），多语言就照 pofung 的 `page/stone-dining-tables.tsx` 做：一个页面文件，文案按语言放在 `lib/copy/<落地页>/<语言>.ts`。

- **表**：`landing_pages` 的 `language` 改成 `locales`（这页做了哪几种语言），加 `urls`（每种语言的预览和正式网址）。老记录的 `language` 读作只有一种语言的 `locales`。
- **新建**：新建框里，网站开了多种语言时多一项「做哪几种语言」，默认全选。从关键词来的（关键词有 `lang`），这种语言的版本是主打，其他语言的版本照它的意思写，不逐字翻。
- **任务**（`tasks/landing-page.md` 加一节）：
  - 先看站点已有的多语言写法（`messages/`、`lib/copy/`、`lib/i18n.ts` 这类），照它的写；
  - 文案按语言分文件，`generateMetadata` 也按语言取标题和描述；站内链接用 `localizedPath()`；读术语表；
  - 每种语言都推到预览、都打开看一遍（阿拉伯语要看从右往左的排版），每种语言的网址存进 `urls`；
  - 用户之后在这段对话里说「再加一个西语」，就补一个文案文件、更新 `locales`。
- **写法**：沿用 `prompts/landing-page.md`。各语言的语气偏好写在翻译的写法里，两个任务都读它。
- **效果追踪**：第一次上线记的 `site_changes` 把所有语言的网址都放进 `pages`。

## 不在这次做

- 关键词、搜索表现、站点体检按语言分开看（关键词已经有 `lang`，搜索数据要按网址前缀拆）；
- GEO 问题按语言问；
- 社媒帖子翻译（它跟着社媒账号的语言走，不跟网站）；
- WordPress 多语言；
- 后台里给网站开多语言（改站点代码）：先让用户去 creght 编辑器开。

## 要先验证的

- 本机函数走的是 creght MCP（`local/_creght.ts`），不是命令行。要先确认 MCP 的更新内容接口会**原样保留** `body._i18n`。pofung 是用命令行写的；weave 的 `usecase/cms.go` 只是在校验前把它剔掉，按理会存下来，要拿一条真内容试一下。不保留的话，就是平台要补的缺口，派给 weave。

## 分几步做

1. 网站语言：`channels.locales`，setup-publish 读配置，网站设置里显示语言；
2. 文章翻译：`article_translations`、`glossary`、翻译任务、文章页语言标签；
3. 多语言发布：`fields` 拆分、`publishTo` 写 `_i18n`、`locale_urls`、更新 setup-publish；
4. 落地页多语言。

1～3 做完，pofung 这样已经开了多语言的网站就能用；4 接着做。

## 已定（2026-11-09）

1. 译文默认翻好就能发，`draft` 只在页面上标一下；网站设置里可以改成「确认过才发」。
2. 网站开多语言让用户去 creght 编辑器里开，后台不改站点代码。
3. 术语表单独一张表 `glossary`，不和产品资料、知识库合在一起。
