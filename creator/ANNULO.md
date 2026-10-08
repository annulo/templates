# 自媒体工作台

这是一个从「自媒体工作台」模板建的项目：用户是自媒体人，在这里定好自己的定位，按定位出选题、写文章，再把一篇文章改写成各社媒平台的帖子，审核后发布或排期，看各账号的数据和每周总结。
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
| 内容中心 `content`（选题 → 文章（长文 / 图文笔记 / 视频）→ 发布到支持这种类型的账号 / 排期；改写成别的类型） | `topics`、`articles`、`rewrite_presets`、插件的 `social_posts`（发布记录） | `topics.context` / `save`（任务 `suggest-topics`）、`content.context` / `save`（任务 `write-article`）、`content.revisionContext` / `update`（任务 `revise-article`）、`content.rewriteContext` / `save`（任务 `rewrite-article`）、`publish.prepare` |
| 发布日历 `calendar`（按天看排期和发布，拖动改排期） | 读 `social_posts`、`articles` | |
| 我的定位 `company` | `profile` | `profile.get` / `save` |
| 资料库 `assets` | `assets` | |
| 账号 `channels`（添加、登录、移除、自检） | 插件的 `social_accounts` | `channels.remove`、`social/social.login` / `probe` |

新项目先走向导：填定位（`components/wizard/CreatorProfile.tsx`，存 `profile.save`），再添加第一个账号。起步步骤在 `local/_checklist.ts`：定位、添加账号、写第一篇文章、发出第一条帖子。

做页面、加功能、手动改一条数据先读 **ops-backend**（改记录用 `annulo run records.patch`，不要用 creght 命令行）；出选题、写文章、改文章读 **content-studio**；找图、配图读 **assets**；社媒先读 `plugins/social/PLUGIN.md`；本机函数、表声明见 **annulo** skill。

## 文章类型

一篇文章一种类型（`articles.type`，空的是老数据、按长文看；定义在 `local/_types.ts`）：

| 类型 | 字段 | 发到 |
|---|---|---|
| `article` 长文 | `title`、`summary`、`body`（HTML，图片插在正文里）、`tags` | 知乎这类富文本平台 |
| `post` 图文笔记 | `title`、`body`（纯文字）、`images`（JSON 数组，第一张是封面）、`cover_text`（没图时的封面大字）、`tags` | 小红书、X、LinkedIn、Facebook、Instagram |
| `video` 视频 | `title`、`body`（简介）、`video`、`category`（B 站分区）、`tags` | YouTube、抖音、B 站，以及能发视频的图文平台 |

要发到不支持这种类型的平台，就「改写」成它支持的类型：任务 `rewrite-article`（参数 `article_id`、`type`、`note`）另存一篇新的，`source_id` 指回原文。
`content.save` 存的文章带 `unread: true`（新文章），用户打开就清掉；左侧「内容中心」的数字数它，列表里新文章单独标出来。
用户常用的改写要求存在 `rewrite_presets`（`type` + `prompt`），在改写弹窗里点一下就填好。

## 定位怎么用

`profile` 的字段：`name`（名字 / 账号名）、`positioning`（一句话定位）、`business`（主要写什么）、`profile`（关于我：经历、身份、为什么值得听）、`customer_types`（写给谁）、`buyer_concerns`（读者关心什么）、`advantages`（我的独特之处）、`cooperation`（接什么合作）、`markets`（主要平台和语言）、`tone`（语气）、`keywords`（常写的话题）、`avoid`（不写什么）。
出选题、写文章、写帖子、写总结前都先读它，写出来要像这个人写的；`avoid` 里的话题和说法不要碰。

## 看数据

`annulo run channels.stats --input '{"days":30}'` 一次拿到所有账号的粉丝和互动（`social`）；单个账号用 `annulo run social/stats.summary --input '{"channel_id":"…","days":30}'`，和「社媒 → 数据表现」是同一份数。
`has_base` 为 false 时 `totals` 是这段时间发的帖子的累计值、不是增量，回答时照 `note` 说明口径。

## 社媒插件

社媒（账号、登录、发布、采集、自检、各平台的写法）是公开的 Annulo 插件 **social**（`plugins/social/`，github.com/annulo/plugins），这个模板接它的地方：

- 页面：`lib/shuttle.ts` 的 `listChannels` 读 `social_accounts`；社媒页、内容页的按钮调 `social/social.*`。
- 文章就是要发的内容，不再按账号各写一版：文章页「发布」勾选账号，`publish.prepare({ article_id, channel_ids, scheduled_at? })` 按文章给每个账号建一条 `social_posts`（过一遍插件的规格检查），页面再逐条调 `social/social.publish`；排期的到点由插件的定时任务发。
- 哪个平台支持哪种文章类型按插件的字段表算（`local/_types.ts` 的 `supports`：富文本 → 长文，纯文字 + 配图 → 图文笔记，能发视频 → 视频），插件加了平台不用改模板。
- `content.socialSource({ id })` 还留着：用户在对话里要按插件的任务 `social/write-<平台>` 单独写一条时用（参数 `{ source: { fn: "content.socialSource", id: <文章 id> }, channel_ids }`）；页面上不再用。
- 视频：`lib/social.ts` 里平台的 `video` 是 `'only'`（YouTube、B 站、抖音）或 `'optional'`；`social_posts.video` 有值就按视频发，可以是资料库的视频地址，或编辑框里「上传本机视频」存在这台电脑上的 `local:<name>`。
- 插件不带页面，要换样子直接改这个项目的页面。平台的脚本坏了改 `plugins/social/local/<平台>.ts`（插件升级时三方合并），用户点「交给助手修」开的是插件任务 `social/fix-platform`。
- 插件没装时页面顶部提示去 设置 → 项目 → 插件 装上（模板在 `annulo.json` 里声明了它，新建项目自动装）。

## 浏览器窗口

「打开主页」执行 `social/social.openProfile({ channel_id })`，用账号的 `browser_profile`，窗口留给用户看。你要检查或修的时候，在本机函数里用同一个 `browser_profile` 调 `ctx.browser.open({ profile })` 接管原窗口，不要另开默认浏览器或换 profile（登录状态不同）。
