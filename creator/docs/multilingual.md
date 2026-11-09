# 网站多语言：文章和落地页

2026-11-09 起草，zhangliang 确认后开始做，四步都已做完。外贸、产品运营两个模板一起用（网站运营模块）。只改模板，不改 Annulo：要用的 creght 能力（CMS 的 `_i18n`、站点代码推送）现在都有。

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

**发布脚本不用改**（2026-11-09 实现时改的，原来打算拆一个 `fields()`）：现有的脚本试发（`dry`）时本来就返回要发出去的 `{ collection, slug, body, url }`，
`publishTo`（`local/_publish.ts`）拿它当字段映射用。在多语言网站上它多做这几件事：

1. **默认语言的内容放主字段**：文章 `lang` 等于网站默认语言，就用原文；不等，就用默认语言的译文。都没有的话不发，提示「先翻成 <默认语言>」。
2. **其余语言算 `_i18n`**：对每种能发的译文（默认 `draft`、`ready` 都算，设了「确认过才发」就只算 `ready`），把译文代进文章（标题、摘要、正文、关键词，译文空着的字段照用原文），
   让脚本试发一次，和原文试发出来的 `body` 比，**不一样的字段**就是这种语言的 `_i18n`。哪些字段要翻不用猜：脚本里跟着文字变的（标题、正文、SEO 标题、标签）自然不一样，封面、日期、分类一样，不会进去。
3. **默认语言照常发，`_i18n` 另写一次**：脚本照旧新建或更新这条内容（只有默认语言）；发完再单独更新一次 `body._i18n`。creght 对 JSON Schema 集合的 body 是**顶层浅合并**（weave `internal/repo/cms.go` 的 `mergeJSONSchemaContentBody`），
   所以脚本更新主字段时线上的 `_i18n` 原样留着，写 `_i18n` 时要整份发：先读出线上的（`_creght.ts` 的 `getContent`），保留后台没有译文的语言（比如用户在 creght 编辑器里手动翻的），只换这次有的。
4. **图片**：译文正文里的本机图片和原文一起传，按 sha256 去重，不重复传。
5. **记录**：`publications` 加 `locales`（这次发上去的语言）、`locale_urls`（`{ "zh": "https://…/zh/blog/x" }`），按网址前缀的规则拼。效果追踪（`trackChange` 的 `pages`）带上各语言的网址。
6. **出错不算发布失败**：默认语言发好了、某种语言映射出错或者 `_i18n` 没写上，发布记录还是已发布，`warning` 里写清楚（发布记录上会出现「让 AI 修发布脚本」）。
   原文改了、译文没更新的照样按旧译文发，只在文章页标「原文已改」，不写进 `warning`（那不是脚本的问题）。

**老的发布脚本**试发时没有返回 `body`：只发默认语言，`warning` 提示「让 AI 更新发布脚本」（setup-publish 现在写明 `dry` 要返回 `body`）。单语言网站、WordPress 和现在完全一样。

WordPress 没有原生多语言（要装 WPML、Polylang 这类插件，各家接口不一样），这次不做：WordPress 网站只有一种语言。

## 落地页

落地页是直接写站点代码的（`docs/landing-pages.md`），多语言就照 pofung 的 `page/stone-dining-tables.tsx` 做：一个页面文件，文案按语言放在 `lib/copy/<落地页>/<语言>.ts`。

- **表**：`landing_pages` 加 `locales`（这页做了哪几种语言，总带默认语言：页面在默认语言的地址上也要能看）、`urls`（每种语言的预览和线上地址）；`language` 留着，是主打的语言。单语言网站这两个字段为空，和以前一样。
  `urls` 不用助手写：`landing.save` 按默认语言的 `preview_url` / `url` 加语言前缀算好存下。
- **新建**：新建框里，网站开了多种语言时多一项「做哪几种语言」，默认全选，默认语言不能取消。从关键词来的（关键词有 `lang`），这种语言的版本是主打，其他语言的版本照它的意思写，不逐字翻。
- **任务**（`tasks/landing-page.md` 加一节）：
  - 先看站点已有的多语言写法（`messages/`、`lib/copy/`、`lib/i18n.ts` 这类），照它的写；
  - 文案按语言分文件，`generateMetadata` 也按语言取标题和描述；站内链接用 `localizedPath()`；读术语表；
  - 每种语言都打开预览看一遍（阿拉伯语要看从右往左的排版：页面里用 `start` / `end`、`ms-` / `me-`，不写死左右）；
  - 用户之后在这段对话里说「再加一个西语」，就补一个文案文件、更新 `locales`。
- **写法**：沿用 `prompts/landing-page.md`。各语言的语气偏好写在翻译的写法里，两个任务都读它。
- **效果追踪**：第一次上线记的 `site_changes` 把所有语言的网址都放进 `pages`。

## 不在这次做

- 关键词、搜索表现、站点体检按语言分开看（关键词已经有 `lang`，搜索数据要按网址前缀拆）；
- GEO 问题按语言问；
- 社媒帖子翻译（它跟着社媒账号的语言走，不跟网站）；
- WordPress 多语言；
- 后台里给网站开多语言（改站点代码）：先让用户去 creght 编辑器开。

## 验证过的

- creght MCP 的 `cms_content_update` 会存下 `body._i18n`（只是不参与 schema 校验），body 是顶层浅合并，见上面「发布」第 3 条。
- MCP 原来没有按 id 读一条内容的工具，只能翻 `cms_content_list`：已请 weave 加 `cms_content_get`（2026-11-09 派的任务），`getContent` 先用它，没有就翻页找。
- 用 pofung 项目真实的发布脚本、文章和线上内容跑过（MCP 用只读快照代替）：中文的 title、content、excerpt、tags 算出来和线上手翻的一样，线上的阿语、葡语原样保留；
  seoTitle、seoDescription 跟着 pofung 脚本的映射（= 标题、= 摘要）走，和线上当初单独翻的 SEO 标题不一样，这是脚本的映射，英文主字段也是这样。
- 站点的语言设置不用读代码：creght 站点的每个页面都内嵌 `window.TalizenConfig = { i18n: {"locales":[…],"defaultLocale":"en"} }`，`languages.read` 抓首页读它。

## 分几步做

1. ✅ 网站语言：`channels.locales`（`languages.read` 抓首页读），setup-publish 配好后读一次，文章页打开时没读过的自动读；网站设置的发布卡片下面显示语言（`components/SiteLanguages.tsx`）；
2. ✅ 文章翻译：`article_translations`、`glossary`、任务 `tasks/translate-article.md`（写法 `prompts/translate-article.md`）、文章页的语言一栏（`components/ArticleLanguages.tsx`，挂在 core 的 `ArticleDetail`）；
3. ✅ 多语言发布：`publishTo` 用脚本试发算 `_i18n`、发完单独写、`locales` / `locale_urls`；setup-publish 写明 `dry` 返回 `body`。测试 `publish/tests/multilingual.test.mjs`；
4. ✅ 落地页多语言：`landing_pages.locales` / `urls`、`landing.create` / `context` / `save` 认语言、任务加「多语言网站」一节、新建框选语言、列表显示各语言地址。

## 已定（2026-11-09）

1. 译文默认翻好就能发，`draft` 只在页面上标一下；网站设置里可以改成「确认过才发」。
2. 网站开多语言让用户去 creght 编辑器里开，后台不改站点代码。
3. 术语表单独一张表 `glossary`，不和产品资料、知识库合在一起。
