# 自媒体工作台

这是一个从「自媒体工作台」模板建的项目：用户是自媒体人，在这里定好自己的定位，按定位出选题、做内容（文案、图、视频都放在这条内容的文件夹里），发到各社媒账号或排期，看各账号的数据和每周总结。
项目里只有一个业务；定位在 `profile` 表（只有一行），各业务表里没有「所属项目」字段。

## 用户是谁、怎么跟他说话

用户是写内容的人，不是技术人员。回复和写进界面的文字用他们的话：

| 不要说 | 要说 |
|---|---|
| 写作计划、写作主题、简报、topics | 选题（简报是选题的详情，在「编辑选题」里） |
| 初稿、内容稿、稿件、articles | 文章 |
| 渠道、social_accounts | 账号 |
| 项目资料、profile | 我的定位 |
| 运营周报 | 每周总结 |
| 素材库、素材 | 资料库、资料 |
| 渠道版本、媒体版本、social_posts | 发布记录（一篇文章发到某个账号的那一条） |

本机函数、任务、表名这些是你自己用的，不要出现在给用户看的话里。

## 页面和数据

入口是 `pages/Index.tsx`，用查询参数 `view` 切换视图（`/?view=content`，不是 `/content`）。改完页面调 `page_errors` 时传真实地址，例如 `{"reload":true,"path":"/?view=content"}`。

| 页面（`?view=`） | 表 | 本机函数、任务 |
|---|---|---|
| 总览 `overview`（起步步骤 + 今天要做的 + 粉丝、发布数） | `checklist` | `today.list`（用户问「接下来做什么」先跑它照着答）、`channels.stats` |
| 每周总结 `reports` | `reports` | `reports.data` / `reports.save`；任务 `weekly-report`（每 7 天定时，也能在页面点） |
| 社媒 `social`（账号概览、数据表现） | 社媒插件的 `social_accounts`、`social_daily`、`social_post_daily`、`social_health` | `social/social.*`、`social/stats.summary` |
| 内容中心 `content`（选题 → 内容（一个文件夹）→ 发布时挑发成图文 / 视频 / 长文，发到账号或排期） | `topics`、`articles`、`rewrite_presets`（AI 预设）、`assets`（资料库）、插件的 `social_posts`（发布记录） | `topics.context` / `save`（任务 `suggest-topics`）、`content.context` / `save`（任务 `write-article`）、`content.revisionContext` / `update`（任务 `revise-article`）、`work.context`、`folder.*`（任务 `work-on-content`，见下面「内容文件夹」）、`publish.prepare` |
| 发布日历 `calendar`（按天看排期和发布，拖动改排期） | 读 `social_posts`、`articles` | |
| 我的定位 `company` | `profile` | `profile.get` / `save` |
| 资料库 `assets` | `assets` | |
| 账号 `channels`（添加、登录、移除） | 插件的 `social_accounts` | `channels.remove`、`social/social.login` |

页面链接（回复里提到就写，写法见 annulo skill 的 pages.md）：

- 一条内容：`/?view=content&article=<article_id>`
- 内容文件夹里的文件或目录：`/?view=content&article=<article_id>&file=<文件夹里的相对路径>`，打开就是那个文件（目录列出里面的文件），比如 `</?view=content&article=12&file=A 外贸版/旁白/前 35 秒.mp3>`
- 其他页面：`/?view=<视图>`，视图见上表

新项目先走向导：填定位（`components/wizard/CreatorProfile.tsx`，存 `profile.save`），再添加第一个账号。起步步骤在 `local/_checklist.ts`：定位、添加账号、写第一篇文章、发出第一条帖子。

做页面、加功能、手动改一条数据先读 **ops-backend**（改记录用 `annulo run records.patch`，不要用 creght 命令行）；出选题、写文章、改文章读 **content-studio**；找图、配图读 **assets**；社媒先读 `plugins/social/PLUGIN.md`；本机函数、表声明见 **annulo** skill。

## 内容没有类型

**内容不分长文、图文、视频**：发成什么是发布时挑的（见下面「内容文件夹」）。`articles` 里的 `type`、`body`、`images`、`video` 这些是老数据，以文件夹里的文件为准。

- **同一条内容要发到别的平台**（比如长文要发小红书、X）：不用另存一篇，在这条内容的文件夹里做一份那个平台用的文案和配图（几个版本就分几个目录），用户点「发布」时挑图文、挑这份文案和图。跟用户说「我在这条内容里给你做一份图文版」，或者让他在内容页点「交给 AI」写要求，**不要让他去找「改写」：自媒体没有这个按钮**。
- **照这条另做一条新内容**（换个角度重写、拆成一个系列）：内容页「交给 AI → 另写一篇」，新建一条内容（`source_id` 指回原内容），交给 `work-on-content` 照它的稿子做。
- 新内容带 `unread: true`，用户打开就清掉；左侧「内容中心」的数字数它，列表里新内容单独标出来。

## 内容文件夹、交给 AI、引用

每条内容（文章表 `articles` 的一行）一个**文件夹**，在项目的工作目录里（`~/Annulo/<项目名>/内容/<名字>`，`articles.folder` 记相对工作目录的路径）。稿子、脚本、文案、视频、参考都是里面的文件，可以分目录。内容页上就是这个文件夹：默认网格（所有文件铺平），能切成树，文本和 md 在页面里直接改。设计见 `docs/content-model.md`。

- 拿文件夹：`annulo run folder.create --input '{"article_id":"<id>"}'`，没有就建，返回 `dir`（绝对路径）；**每段对话开始动文件前跑一次**，它会把这段对话记到这条内容上（`articles.chat_id`）。之后直接在 `dir` 里读写文件。
- **稿子**是最外层的 `稿子.md`（英文界面 `brief.md`）：这条内容要做什么、要求、大纲、参考，用户写的，动手前先读。`articles.draft` 是老数据，内容页打开时会搬进 `稿子.md`。
- **文案**（要发出去的文字）是名字带「文案」的 `.md`（英文 `copy.md`）：开头 `---` 包住 `title:`、`tags:`，下面是正文或视频简介。**发布是挑选**：内容本身没有类型，用户点「发布」时挑这次发成图文、视频还是长文，用哪份文案、哪些图、哪个视频（文件夹里的或资料库的），选账号；`folder.publish` 每个账号新建一条帖子，存的就是挑好的内容。同一条内容可以挑不同的文件发好几次。所以做几个版本不用问用户拆不拆，每个版本一个目录就行。
- 做出来的文件**都放进文件夹**：不要 `annulo upload`、`assets.add`，也不用 `content.update` 写正文（用户明确要求的除外）。资料库（`assets`）只放几条内容都会用到的素材。
- **交给 AI**两种做法，常用的要求存成预设（`rewrite_presets`，`mode` 是 `here` 或 `new`；自媒体不看预设的 `type`、`types`，做成什么写在要求里）：
  - **在这条上做**：任务 `work-on-content`（参数 `article_id`、`note`），写文案、改文案、做图、做视频都走它；
  - **另写一篇**：页面新建一条内容（`source_id` 指回原内容，稿子里写照哪条另写和这次的要求），也交给 `work-on-content`，`note` 里给原内容的 `article_id`：先 `folder.list` 读原内容的文件，原内容不动。
- **要改就回到做它的那段对话**：用户在对话里接着说，照 `work-on-content` 第 4 步做。
- **引用** `@表:id#n`：用户从页面「复制引用」贴进对话（内容 `@articles:<id>`，资料库的 `@assets:<id>`，组里第 3 个 `@assets:<id>#3`），消息后面有 `<references>`。引用一条内容时，它的文件在它的文件夹里。

## 定位怎么用

`profile` 的字段：`name`（名字 / 账号名）、`positioning`（一句话定位）、`business`（主要写什么）、`profile`（关于我：经历、身份、为什么值得听）、`customer_types`（写给谁）、`buyer_concerns`（读者关心什么）、`advantages`（我的独特之处）、`cooperation`（接什么合作）、`markets`（主要平台和语言）、`tone`（语气）、`keywords`（常写的话题）、`avoid`（不写什么）。
出选题、写文章、写帖子、写总结前都先读它，写出来要像这个人写的；`avoid` 里的话题和说法不要碰。

## 看数据

`annulo run channels.stats --input '{"days":30}'` 一次拿到所有账号的粉丝和互动（`social`）；单个账号用 `annulo run social/stats.summary --input '{"channel_id":"…","days":30}'`，和「社媒 → 数据表现」是同一份数。
`has_base` 为 false 时 `totals` 是这段时间发的帖子的累计值、不是增量，回答时照 `note` 说明口径。

## 社媒插件

社媒（账号、登录、发布、采集、各平台的写法）是公开的 Annulo 插件 **social**（`plugins/social/`，github.com/annulo/plugins），这个模板接它的地方：

- 页面：`lib/shuttle.ts` 的 `listChannels` 读 `social_accounts`；社媒页、内容页的按钮调 `social/social.*`。
- 内容页「发布」挑发成什么、用哪些文件，勾选账号，`folder.publish` 给每个账号建一条 `social_posts`（存的就是挑好的内容，过一遍插件的规格检查），页面再逐条调 `social/social.publish`；排期的到点由插件的定时任务照帖子发。
- 哪个平台支持哪种文章类型按插件的字段表算（`local/_types.ts` 的 `supports`：富文本 → 长文，纯文字 + 配图 → 图文笔记，能发视频 → 视频），插件加了平台不用改模板。
- `content.socialSource({ id })` 还留着：用户在对话里要按插件的任务 `social/write-<平台>` 单独写一条时用（参数 `{ source: { fn: "content.socialSource", id: <文章 id> }, channel_ids }`）；页面上不再用。
- 视频：`lib/social.ts` 里平台的 `video` 是 `'only'`（YouTube、B 站、抖音）或 `'optional'`；`social_posts.video` 有值就按视频发，可以是资料库的视频地址，或编辑框里「上传本机视频」存在这台电脑上的 `local:<name>`。
- 插件不带页面，要换样子直接改这个项目的页面。平台的脚本坏了改 `plugins/social/local/<平台>.ts`（插件升级时三方合并），用户点「交给助手修」开的是插件任务 `social/fix-platform`。
- 插件没装时页面顶部提示去 设置 → 项目 → 插件 装上（模板在 `annulo.json` 里声明了它，新建项目自动装）。

## 浏览器窗口

「打开主页」执行 `social/social.openProfile({ channel_id })`，用账号的 `browser_profile`，窗口留给用户看。你要检查或修的时候，在本机函数里用同一个 `browser_profile` 调 `ctx.browser.open({ profile })` 接管原窗口，不要另开默认浏览器或换 profile（登录状态不同）。

视频可用 `articles.video_cover` 指定封面图片（资料库地址或本机上传地址），编辑器支持上传、粘贴、选择、替换、移除；复制保留封面。小红书和抖音的即时、定时发布使用该封面，其他平台使用默认封面。模板与社媒插件需要一起更新；封面上传失败时停止发布，不静默改用默认封面。
