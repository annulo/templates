// 帮助手册：每篇中英两份，body 是 Markdown（components/Markdown.tsx 渲染：标题、列表、表格、加粗、行内代码、https 链接）。
// 运营后台左侧「帮助」页显示它；运营助手回答「这个怎么用」时也读这里。
// 写法：只写现在真有的功能，按钮名和页面上一字不差；改了功能顺手改这里。
// 讲 Annulo 本身（安装、设置、模型、定时任务、模板升级）的部分对应 Annulo e11136c 之后的版本，Annulo 改了界面要跟着改。

export type Localized = { zh: string; en: string }
export type Article = { id: string; title: Localized; summary: Localized; body: Localized }

export const quickstart: Article = {
  id: 'quickstart',
  title: { zh: "开始使用", en: "Getting started" },
  summary: { zh: "进到后台之后先做这几件事：写定位、连账号、写第一篇、发第一条。", en: "Do these first: your profile, an account, your first piece and your first post." },
  body: {
    zh: `第一次打开时会进入起步向导，跟着走就行；也可以「先跳过」，之后在左下角「起步配置」里接着做。

## 1. 写定位

「我的定位」里写：主要写什么、写给谁、什么风格、不写什么。出选题、写文章、改写成各平台的帖子，AI 都照这里来。
「关于我」里写的经历，是 AI 写文章时唯一会用到的个人经历，它不会编。

## 2. 连上一个社媒账号

「账号」里点「添加账号」，选平台（X、小红书、LinkedIn、Facebook、Instagram、YouTube、抖音、B 站），会弹出一个浏览器窗口，在里面登录就添加好了。
登录状态只存在这台电脑上。社媒功能由社媒插件提供，新建项目时已经自动装好。

## 3. 写第一篇

「内容中心 → 选题」点「出一批选题」，AI 按定位出一批；挑一个点「AI 写文章」，写好的进「文章」。也可以自己新建、自己写。

## 4. 发第一条

打开一篇内容，在「媒体版本」里点「添加账号」，选要发的账号，交给 AI 按各平台的写法分别写。审核通过后发布，或者排到某一天。

## 之后每天

「运营总览」的「今日工作」会列出要你处理的事：待审核的版本、登录过期、发布失败的账号、该写周报了。`,
    en: `The first time you open the back office, a setup wizard walks you through. You can skip it and continue later from "Setup" at the bottom left.

## 1. Write your profile

In "My profile", say what you write about, who for, your voice and what you avoid. AI follows this for topics, articles and posts for each platform.
"About me" is the only source of personal stories AI uses in articles; it won't make any up.

## 2. Connect a social account

In "Accounts", click "Add account" and pick a platform (X, Xiaohongshu, LinkedIn, Facebook, Instagram, YouTube, Douyin, Bilibili). A browser window opens; log in there and the account is added.
The login stays on this computer. Social features come from the social plugin, installed automatically with the project.

## 3. Write your first piece

In "Content → Writing plan", click to suggest topics; AI suggests a batch from your profile. Pick one and let AI write it; the draft goes to your content list. You can also write your own.

## 4. Publish your first post

Open a piece and, under "Media versions", click "Add accounts", pick where to post and let AI write each one in its platform's style. Approve, then publish or schedule.

## Every day after

"Today" on the overview lists what needs you: versions to review, expired logins, failed posts, and the weekly summary when it's due.`,
  },
}

export const overview: Article = {
  id: 'overview',
  title: { zh: "运营总览", en: "Overview" },
  summary: { zh: "粉丝、待审核、已连接的账号、发布异常，今天要做的事，和最新一期周报。", en: "Followers, items to review, connected accounts, publishing problems, today’s to-dos and the latest weekly summary." },
  body: {
    zh: `## 顶部四个数

- **粉丝**：各账号最近一次采集的粉丝合计，旁边是近 30 天发了几条；
- **待审核版本**：等你审核的各平台版本，点了打开最新那一条；
- **已连接社媒**：登录正常的账号数；
- **发布异常**：平台改版、发布或自检走不通的账号。

## 今日工作

按数据算出来的待办：待审核的版本、要修的账号、该写周报了。可以点按钮直接去做，也可以「忽略」，数量变多了会再出现。

## 最新周报

最新一期每周总结的结论；点「查看周报」看全文和下周建议。

## 渠道与账号

每个账号的平台、上次采集时间、发布自检的状态。点账号名去「账号」页处理。`,
    en: `## The four numbers at the top

- **Followers**: the total across accounts from the latest collection, plus how many posts went out in the last 30 days;
- **Versions to review**: platform versions waiting for you; click to open the newest;
- **Connected social**: accounts whose login works;
- **Publishing problems**: accounts where publishing or the self-test fails, usually because the platform changed.

## Today

To-dos worked out from your data: versions to review, accounts to fix, the weekly summary when it's due. Act on them directly, or dismiss one; it comes back if the count goes up.

## Latest summary

The conclusion of the latest weekly summary; open it for the full text and next week's suggestions.

## Accounts

Each account's platform, last collection and self-test status. Click a name to handle it on the Accounts page.`,
  },
}

export const content: Article = {
  id: 'content',
  title: { zh: "内容中心", en: "Content" },
  summary: { zh: "选题 → 文章 → 各账号的版本 → 审核、发布。", en: "Writing plan → drafts → a version per account → review and publish." },
  body: {
    zh: `## 选题

想写的主题。「出一批选题」让 AI 按定位出一批；点一个主题可以填简报（写给谁、要回答的问题、大纲、要发的平台、结尾引导），再「AI 写文章」。

## 文章

一篇内容的母稿，用编辑器改；「让 AI 改」写一句要求交给助手改，旁边「AI 要求」里是每次都要遵守的写法，可以自己改。

## 媒体版本

一篇内容发到各账号的版本。「添加账号」选要发的账号，可以空白新建，也可以交给 AI 按各平台的写法分别写（每个平台的写法也能在这里改）。
每个版本单独编辑、审核；审核通过后「发布」，或者排到某一天（到点自动发）；「批量发布」一次发出所有审核通过的。
发出去的版本上会显示浏览、点赞、评论（每 6 小时采集一次）。

## 发布日历

排期和已发布的帖子按天排开，已排期、已通过的可以拖到别的日子改时间。`,
    en: `## Writing plan

Topics you want to write. Let AI suggest a batch from your profile; open a topic to fill in a brief (audience, the question to answer, outline, platforms, call to action), then let AI write the article.

## Drafts

The master copy of a piece, edited in the editor. "Revise with AI" takes a one-line request; "AI instructions" next to it are the rules it always follows, and you can edit them.

## Media versions

The versions of a piece for each account. "Add accounts" picks where to post: start blank, or let AI write each in its platform's style (each platform's instructions can be edited here too).
Edit and review each version on its own; once approved, publish it or schedule it for a day (it goes out automatically). "Publish all" sends every approved version.
Published versions show views, likes and comments, collected every 6 hours.

## Calendar

Scheduled and published posts by day; drag scheduled or approved ones to another day.`,
  },
}

export const social: Article = {
  id: 'social',
  title: { zh: '社媒：小红书和 X', en: 'Social: Xiaohongshu and X' },
  summary: { zh: '登录、从文章生成、审核、立即发布或排期、采集数据。', en: 'Sign in, generate from articles, review, post now or schedule, collect stats.' },
  body: {
    zh: `## 添加账号

「社媒 → 添加账号」，选小红书或 X，在弹出的浏览器窗口里登录（最多等 5 分钟）。登录状态只存在这台电脑上，换电脑要重新登录。
登录过期时账号上会提示，点「重新登录」。

## 写内容

- 「从文章生成」：选一篇文章和要发的账号，每个账号按自己的定位各写一条，写完是「待审核」。
- 也可以在对话里让助手按主题直接写。

## 审核和发布

每条内容：预览、**通过**、修改（改完重新审核）、退回。通过之后：
- **立即发布**，或者**排期**到某个时间；排期的可以「取消排期」，也可以在「排期日历」里拖动改时间。
- 到点的排期内容每 5 分钟检查一次、自动发布（Annulo 要开着）。

**没审核通过的内容不会发出去**，助手也不会替你点通过。

发布前会按平台规格检查，也限制频率，避免账号被限流：

| | 规格 | 频率 |
|---|---|---|
| 小红书 | 标题 20 字、正文 1000 字、话题 10 个；不放站外链接、不引导加微信、不用「最好」「全网第一」这类绝对化用语 | 两篇隔 2 小时，一天 3 篇 |
| X | 正文加话题 280（中日韩文字和 emoji 算 2，链接算 23）、话题 3 个、图片 4 张 | 两条之间不限间隔，24 小时内最多 10 条 |

碰到频率限制的排期内容会留到下一轮再发。

## 配图

在「修改」里「从素材库选」图片，也能当场上传。小红书没有配图时，发布前会用封面文字生成一张文字封面。

## 数据

每 6 小时采集一次粉丝和每条内容的浏览、点赞、评论、收藏、分享，也可以「立即采集」。在平台上直接发的内容也会收进来。
采集要打开浏览器跑半分钟，太频繁可能被平台限流。

## 删除

- 「从小红书删除」/「从X删除」：把已发布的内容从平台上删掉，不能恢复。
- 「删除记录」：已删除或已退回的内容，连同它每天的数据从后台删掉。`,
    en: `## Adding an account

Social → "Add account", pick Xiaohongshu or X and sign in in the browser window that opens (it waits up to 5 minutes). The login stays on this computer; a new computer needs a new login.
When a login expires the account says so — click "Sign in again".

## Writing

- "Generate from article": pick an article and the accounts; each account gets one written to its own positioning, "In review".
- Or ask the assistant in the chat to write on a topic.

## Review and posting

For each post: Preview, **Approve**, Edit (saving sends it back to review), Send back. Once approved:
- **Publish now**, or **Schedule** it; scheduled posts can be unscheduled ("Unschedule") or dragged to another day in the Calendar.
- Due posts are checked every 5 minutes and posted automatically (Annulo must be open).

**Nothing is posted without your approval**, and the assistant won't approve for you.

Before posting, each platform's limits are checked and posting is rate-limited to keep accounts safe:

| | Limits | Rate |
|---|---|---|
| Xiaohongshu | Title 20 characters, body 1000, 10 hashtags; no external links, no "add me on WeChat", no absolute claims like "the best" | 2 hours apart, 3 a day |
| X | Body plus hashtags 280 (CJK and emoji count 2, links 23), 3 hashtags, 4 images | 30 minutes apart, 10 a day |

Scheduled posts that hit the rate limit wait for the next round.

## Images

"Pick from assets" in Edit, or upload on the spot. Xiaohongshu posts without images get a text cover generated from the cover text.

## Stats

Every 6 hours followers and each post's views, likes, comments, saves and shares are collected; "Collect now" runs it immediately. Posts you made directly on the platform are picked up too.
Collecting opens a browser for about half a minute; doing it too often can get you rate-limited.

## Deleting

- "Delete from Xiaohongshu" / "Delete from X" removes a published post from the platform — it can't be undone.
- "Delete record" removes a deleted or sent-back post, and its daily stats, from the back office.`,
  },
}

export const channels: Article = {
  id: 'channels',
  title: { zh: "账号", en: "Accounts" },
  summary: { zh: "添加社媒账号、登录、发布自检；登录状态只在这台电脑上。", en: "Add social accounts, log in, self-test publishing; logins stay on this computer." },
  body: {
    zh: `## 添加账号

「添加账号」选平台，会弹出一个浏览器窗口，在里面登录，登录好了自动添加。支持 X、小红书、LinkedIn、Facebook、Instagram、YouTube、抖音、B 站。
登录状态只存在登录用的那台电脑上；在别的电脑上登录的账号会标出是哪台，定时发布、采集由那台电脑做。

## 登录过期

账号上点「重新登录」。换电脑、清了浏览器数据也要重新登录。

## 发布自检

平台常改页面，按钮一换发布就会悄悄坏掉。每天会自动自检一次（走一遍登录、打开发帖框、找到发布按钮，不真的发）；不通的会提示，点「交给助手修」，它照着失败时的截图改发布脚本，改到自检通过。

## 移除

移除只是不再在这里运营它，账号本身不受影响，之后还能再添加回来。`,
    en: `## Add an account

"Add account", pick a platform, and a browser window opens; log in and the account is added. X, Xiaohongshu, LinkedIn, Facebook, Instagram, YouTube, Douyin and Bilibili are supported.
The login stays on the computer you logged in on; accounts logged in elsewhere show which computer, and that computer does their scheduled publishing and collection.

## Login expired

Click "Log in again" on the account. Switching computers or clearing browser data also needs a new login.

## Publishing self-test

Platforms change their pages often, and publishing can break silently. A daily self-test walks through login, opening the composer and finding the post button, without posting. If it fails you'll see it; "Have the assistant fix it" updates the script from the failure screenshot until the self-test passes.

## Remove

Removing only stops running the account here; the account itself is unaffected and can be added back later.`,
  },
}

export const assistant: Article = {
  id: 'assistant',
  title: { zh: '运营助手', en: 'The assistant' },
  summary: { zh: '它能做什么、不会替你做什么、怎么让它改后台。', en: 'What it does, what it won’t do for you, and how to have it change the back office.' },
  body: {
    zh: `右侧的「运营助手」看得到这个项目的数据、账号和后台代码，能动手做事。

## 能做什么

- 回答数据问题：「这周哪条帖子点赞最多」「小红书这个月涨了多少粉」，需要时画成图；
- 写选题、文章、小红书笔记、推文，改写成各账号的版本（写好都进待审核）；
- 改后台本身：「在总览加一张每日访客趋势图」「加一个字段」，见下面；
- 写周报、解释某个数字的口径。

后台上很多按钮是直接执行的（采集、自检、发布），不经过助手；写着「交给助手…」的按钮才会把一件事发到右侧对话里。

## 不会替你做的

- 不会替你审核通过内容，没通过的不会发；
- 不会替你发邮件；
- 不会从平台上删除内容，除非你明确要求；
- 不会把 key 写进代码、表或对话。

## 让它改后台

直接说要什么。它改好后台代码、推到预览，这一轮结束时左侧后台会自动刷新。
每次改动都记在项目的 git 里，哪一步不对，跟它说「回滚刚才的改动」就行。
改页面时它会自己检查左侧后台有没有报错，没报错才说改好了。

## 后台出错了

左侧后台页面报错时，顶部会出现「后台页面出错了」和「交给助手修复」，点了才会把报错原文发给它。
报错也可能是别人（或另一段对话）正在改的代码引起的：助手看到报错出在不是它这次改的地方，会先告诉你、问要不要处理，不会直接去改。

## 定时交给助手的事

有的定时任务不是跑固定的程序，而是到点把一段话交给助手，比如每周写周报。
到点时会开一段新对话，标题以「定时：」开头，跑完在对话列表里标成有新回复；在 Annulo 的「设置 → 定时任务」里也能「查看对话」。
这时你不在场，助手不会停下来等你回答，缺的信息按合理的默认做完，并在最后说明。

## 给助手的说明

Annulo 的「设置 → 项目」里有「给助手的说明」：写你对这个项目里助手的要求，比如回答的风格、不能做的事。
它会放进助手的系统提示，和项目自带的说明冲突时以它为准，升级模板不会改它；改完从新对话开始生效。`,
    en: `The assistant on the right can see this project's data, channels and back-office code, and it can act on them.

## What it does

- Answers questions about your data — "which post got the most likes this week?", "how many Xiaohongshu followers did we gain this month?" — with a chart when useful;
- Writes topics, articles, Xiaohongshu notes and posts on X, and adapts them for each account (all go to review);
- Changes the back office itself: "add a daily visitors chart to the overview", "add a field" (see below);
- Writes weekly reports and explains how a number is calculated.

Many buttons in the back office run directly (collecting, self-tests, publishing) without the assistant; only buttons that hand a job to the assistant send it to the chat.

## What it won't do for you

- Approve content for you; nothing unapproved gets posted;
- Send email for you;
- Delete content from a platform unless you explicitly ask;
- Put keys into code, tables or the chat.

## Changing the back office

Just say what you want. It edits the back-office code and pushes to preview; when the turn ends, the back office on the left refreshes itself.
Every change is recorded in the project's git history — if a step went wrong, tell it to "roll back that change".
When it changes a page, it checks the back office for errors itself and only says it's done when there are none.

## When the back office breaks

If a back-office page throws an error, a bar appears at the top — "Back-office page error" with "Ask the assistant to fix". The error is sent to the assistant only when you click it.
An error may come from code someone else (or another conversation) is still editing: if the error points somewhere the assistant didn't change this time, it tells you and asks before touching it.

## Scheduled jobs for the assistant

Some scheduled tasks don't run a fixed program — they hand a message to the assistant at the set time, like writing the weekly report.
Each run opens a new conversation whose title starts with "定时：" (Scheduled), marked as having a new reply when it's done; you can also click "View chat" in Annulo's Settings → Schedules.
You're not there when it runs, so the assistant doesn't stop to ask; it makes sensible assumptions and lists them at the end.

## Instructions for the assistant

Annulo's Settings → Projects has "Instructions for the assistant": your rules for the assistant in this project, like tone of replies or things it must not do.
They go into its system prompt, win over the project's built-in notes, and aren't touched by template upgrades. Changes apply from the next new conversation.`,
  },
}

export const settings: Article = {
  id: 'settings',
  title: { zh: '设置与密钥清单', en: 'Settings and the secrets list' },
  summary: { zh: 'Annulo 设置里的每一项，以及后台会用到的密钥。', en: 'Every section of Annulo’s settings, and the secrets the back office uses.' },
  body: {
    zh: `以下对应 Annulo e11136c 之后的版本。设置在 Annulo 窗口左侧的「设置」里。

## 各项设置

| 设置 | 做什么 |
|---|---|
| 项目 | 切换、改名、新建、删除项目；当前项目的模板版本和升级；插件；给助手的说明 |
| 模型 | 默认用 creght 平台的模型，登录就能用，按 AI 积分计费；也可以接自己的服务商，key 只存在本机 |
| Skill | 写给助手的做事说明，只有启用的才会进助手的上下文 |
| 密钥 | 外部服务的 key，只存在这台电脑上，后台的本机函数和助手的命令行会用到 |
| 连接 | 授权外部账号，授权只存在这台电脑上 |
| 定时任务 | 后台定时跑的任务：上次结果、下次时间、立即运行、暂停；交给助手的任务能「查看对话」 |
| MCP | 接入外部工具（比如 Notion），给助手用 |
| 语言 | 界面用中文还是英文，默认跟随系统；左侧后台和助手的回复也跟着变 |

后台的功能缺哪个密钥时，会直接报「到 设置 → 密钥 添加 XXX」，页面上带「去设置」按钮。
**不要把 key 发在对话里**，也不用改 ~/.zshrc。

## 模板升级

「设置 → 项目」里当前项目的模板卡片：有新版本时显示「升级到 vN」和每一版改了什么。
升级会把模板的改动合进这个项目，你自己改过的地方保留；两边改了同一处的，交给助手解决。合并后推到预览，正式环境不变。
卡片提示「先更新 Annulo 才能升级」时，说明这一版模板用到了新版 Annulo 的能力，先更新 Annulo。`,
    en: `This matches Annulo e11136c and later. Settings are under "Settings" in the left bar of the Annulo window.

## Sections

| Setting | What it does |
|---|---|
| Projects | Switch, rename, create and delete projects; the current project's template version and upgrades; instructions for the assistant |
| Models | Uses creght's models by default — just sign in, billed in AI credits; or connect your own provider, with the key stored only on this computer |
| Skill | Instructions for the assistant; only enabled ones enter its context |
| Keys | Keys for external services, stored only on this computer, used by the back office's local functions and the assistant's terminal |
| Connections | Authorize external accounts; stored only on this computer |
| Schedules | What the back office runs on a schedule: last result, next run, "Run now", pause; jobs handed to the assistant have "View chat" |
| MCP | Connect external tools (e.g. Notion) for the assistant |
| Language | Interface language, Chinese or English (follows the system by default); the back office and the assistant's replies follow it |

When a feature is missing a key, it asks you to add it in Settings → Keys, with an "Open Settings" button.
**Don't paste keys into the chat**, and there's no need to edit ~/.zshrc.

## Template upgrades

The current project's template card in Settings → Projects shows "Upgrade to vN" and what each version changed when there's an update.
Upgrading merges the template's changes into your project and keeps your own edits; where both changed the same spot, the assistant resolves it. The result goes to preview; production is unchanged.
If the card says "Update Annulo to upgrade", that template version needs a newer Annulo — update Annulo, then upgrade.`,
  },
}

export const faq: Article = {
  id: 'faq',
  title: { zh: '常见问题与排错', en: 'FAQ and troubleshooting' },
  summary: { zh: '定时任务没跑、登录过期、后台报错、升级冲突……', en: 'Tasks that didn’t run, expired logins, back-office errors, upgrade conflicts…' },
  body: {
    zh: `## 定时任务没跑

定时任务只在 Annulo 开着的时候跑。关机或退出 Annulo 期间错过的，下次打开时补跑一次（不会把错过的每一次都补上）。
在 Annulo 的「设置 → 定时任务」里能看每个任务上次的结果和报错，也能「立即运行」。被暂停的任务不会跑。

## 社媒提示登录过期

到「账号」点那个账号的「重新登录」。登录状态只存在这台电脑上，换电脑、清了浏览器数据都要重新登录。
X 登录后一直跳验证的，可以让助手看一下（X 可能识别了自动打开的浏览器）。

## 发布失败

- 报「页面可能改了」：平台改版了，在「账号」里点「交给助手修」，它照着失败时的截图改发布脚本，改到自检通过。
- 不确定到底发出去没有：再点一次发布。发布前会先去平台上查有没有这一条，不会重复发。
- X 报「内容重复」：X 不让发和之前一样的内容，改一下正文再发。

## 左侧后台空白或报错

顶部出现「后台页面出错了」时点「交给助手修复」。如果是别人正在改后台引起的，助手会先问你。
运营后台只能在 Annulo 里打开：单独打开它的预览地址会读不到数据。

## 数字对不上 / 显示 0

- 社媒数据每 6 小时采集一次，要最新的在「社交媒体」里点「全部重新采集」。

## 模板升级有冲突

升级时两边改了同一处，卡片会显示「上次升级有冲突还没解决」，点「交给助手解决」：它保留你自己的改动，同时把模板的新改动合进来，再推到预览。

## 改坏了想回到之前

后台的每次改动都记在项目的 git 里。跟助手说「回滚刚才的改动」或者「回到昨天的版本」即可。`,
    en: `## A scheduled task didn't run

Scheduled tasks only run while Annulo is open. Anything missed while your computer was off or Annulo was closed runs once when you open it again (not once per missed run).
Annulo's Settings → Schedules shows each task's last result and error, and "Run now". Paused tasks don't run.

## A social account says the login expired

Go to Social and click "Sign in again" on that account. Logins live only on this computer; a new computer or cleared browser data means signing in again.
If X keeps asking for verification after you sign in, ask the assistant to take a look (X may have spotted the automated browser).

## Posting failed

- "The page may have changed": the platform changed. On Accounts, click "Have the assistant fix it"; it updates the posting script from the failure screenshot until the self-test passes.
- Not sure whether it went out: click publish again. It checks the platform for the post first, so it won't post twice.
- X says "duplicate content": X won't accept the same text twice; tweak it and post again.

## The back office is blank or shows an error

When "Back-office page error" appears at the top, click "Ask the assistant to fix". If someone else's in-progress change caused it, the assistant asks you first.
The back office only works inside Annulo: opening its preview address on its own can't read your data.

## Numbers look wrong or show 0

- Social stats are collected every 6 hours; click "Collect all again" on Social media for the latest.

## A template upgrade had conflicts

When both sides changed the same spot, the card shows "The last upgrade has unresolved conflicts". Click "Ask the assistant to resolve": it keeps your changes, merges in the template's, and pushes to preview.

## I broke something and want it back

Every back-office change is in the project's git history. Tell the assistant "roll back that change" or "go back to yesterday's version".`,
  },
}
