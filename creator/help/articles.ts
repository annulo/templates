// 帮助手册：每篇中英两份，body 是 Markdown（components/Markdown.tsx 渲染：标题、列表、表格、加粗、行内代码、https 链接、单独一行的图片 `![说明](https://…)`）。
// 运营后台左侧「帮助」页显示它；运营助手回答「这个怎么用」时也读这里。
// 写法：只写现在真有的功能，按钮名和页面上一字不差（中文看 messages/zh.json，英文看 messages/en.json；页面名以左侧导航为准）；改了功能顺手改这里。
// 截图：单独一行 `![说明](https://…)`，中英两份用同一张。截图取自演示项目「示例：自媒体工作台（演示数据）」（creght 项目 qarrue74ctjm，数据全是编的），界面改了要重截。
// 讲 Annulo 本身（设置、模型、定时任务、模板升级、远程访问）的部分要和 Annulo 官网帮助（shuttle-site 的 help/platform.ts）一致，Annulo 改了界面要跟着改。

export type Localized = { zh: string; en: string }
export type Article = { id: string; title: Localized; summary: Localized; body: Localized }

export const quickstart: Article = {
  id: 'quickstart',
  title: { zh: '开始使用', en: 'Getting started' },
  summary: { zh: '起步向导写定位，再按「起步配置」做完：连账号、写第一篇、发出第一条。', en: 'The setup wizard takes your profile; then finish Getting started: connect an account, write your first piece, publish your first post.' },
  body: {
    zh: `## 1. 起步向导

第一次打开后台会进「开始使用自媒体工作台」，先填你的定位：
- **主要写什么**、**写给谁**：必填。读者可以从下拉里选（职场人、学生、宝爸宝妈、创业者……），也可以自己写一个点「添加」；
- **说话风格**：写文章、改写帖子时照这个说话；
- **更多信息（选填）**：名字或账号名、一句话定位、关于我、常写的话题、不写什么。

点「下一步」保存。这些都存在「我的定位」里，随时能改。

![起步向导：填写你的定位](https://fsu.creght.com/site/2103669300995821568/1791356483522__creator_help_wizard.png)

第 2 步是「连上一个社媒账号」：点「添加账号」去「账号」页加一个（见下面第 3 节），加好后点页面上方的「做完回到起步向导」回来，再点「进入总览」。现在不想加就点「先跳过」，向导结束、进入运营总览。已经有账号的，第 1 步保存后直接进入运营总览。

现在不想填就点「以后再说」，之后在起步配置里点「打开起步向导」还能回来。

## 2. 起步配置

左侧导航最下面有「起步配置」和进度（比如 1/4），点它会在运营总览上展开清单：

| 一项 | 做完的标志 |
|---|---|
| 填写你的定位 | 填了「主要写什么」和「写给谁」 |
| 连上一个社媒账号 | 「账号」里有一个账号 |
| 写第一篇内容 | 有一篇文章，存成草稿就算 |
| 发出第一条帖子 | 有一篇文章发到了账号上或排了期 |

做没做完是按数据判断的，不用手动打勾。点一项展开说明和去做的按钮；用不上的点「先跳过」，跳过的能「恢复」。

![运营总览上展开的起步配置清单](https://fsu.creght.com/site/2103669300995821568/1791356475965__creator_help_checklist.png)

## 3. 连上社媒账号

左侧下方「账号 → 添加账号」，选平台：X、LinkedIn、Facebook、Instagram、YouTube、小红书、抖音、B 站、知乎。会弹出一个浏览器窗口，在里面登录（抖音、B 站、知乎用 App 扫码）。登录状态只存在这台电脑上。见「账号」一篇。

## 4. 写第一篇、发第一条

1. 「内容中心 → 选题」点「出一批选题」，助手按你的定位出一批；
2. 挑一个点「写成文章」，写好的在「文章」里，是草稿；也可以「新建文章」自己写；
3. 打开文章看一眼，要发到别的平台就「改写」成它支持的类型（比如长文改成图文笔记发小红书、X）；
4. 点「发布」，勾选要发的账号，「立即发布」或者选时间「定时发布」。

详见「内容中心」一篇。

## 5. 让助手做事

Annulo 右侧的助手看得到这个项目的数据和后台代码。比如：
- 「最近 30 天哪条帖子表现最好？」
- 「把最新的文章改得更口语一点」
- 「在运营总览加一张每日粉丝趋势图」`,
    en: `## 1. Setup wizard

The first time you open the back office you land in "Get started with Creator studio". Fill in your profile:
- **What do you write about?** and **Who do you write for?** are required. Pick readers from the list (Professionals, Students, Parents, Founders…) or type your own and click "Add";
- **Voice**: drafts and posts follow this voice;
- **More details (optional)**: Name or handle, One-line positioning, About me, Topics you cover, Avoid.

Click "Next" to save. All of this is stored under My profile, and you can change it anytime.

![Setup wizard: describe your account](https://fsu.creght.com/site/2103669300995821568/1791356483522__creator_help_wizard.png)

Step 2 is "Connect a social account": click "Add account" to add one on the Accounts page (see section 3 below), then click "Return to setup wizard when finished" at the top of the page and "Open Overview". Not now? Click "Skip for now"; the wizard ends and you land on the overview. If you already have an account, saving step 1 takes you straight to the overview.

Not now? Click "Later". You can come back with "Open setup wizard" in the Getting started checklist.

## 2. Getting started checklist

At the bottom of the sidebar, "Getting started" shows your progress (like 1/4). Click it to open the checklist on the overview:

| Step | Done when |
|---|---|
| Describe your account | "What you write about" and "Who you write for" are filled in |
| Connect a social account | There's an account under Accounts |
| Write your first piece | There's an article; a saved draft counts |
| Publish your first post | An article is posted to an account or scheduled |

Progress comes from your data; nothing to tick by hand. Click a step to see what to do and a button to do it. Click "Skip for now" for steps you don't need; skipped ones can be restored ("Restore").

![The Getting started checklist on the overview](https://fsu.creght.com/site/2103669300995821568/1791356475965__creator_help_checklist.png)

## 3. Connect a social account

"Accounts → Add account" at the bottom of the sidebar, then pick a platform: X, LinkedIn, Facebook, Instagram, YouTube, Xiaohongshu, Douyin, Bilibili, Zhihu. A browser window opens; log in there (Douyin, Bilibili and Zhihu use a QR code in their app). The login stays on this computer. See "Accounts".

## 4. Write your first piece, publish your first post

1. In Content center → Topics, click "Suggest topics"; the assistant suggests a batch from your profile;
2. Pick one and click "Write article". The draft shows up under Articles. Or click "New article" and write it yourself;
3. Open the article and give it a look; to post on other platforms, "Rewrite" it into a type they take (e.g. a long-form article into an image post for Xiaohongshu and X);
4. Click "Publish", tick the accounts, then "Publish now" or "Schedule".

See "Content center" for details.

## 5. Ask the assistant

The assistant on the right of Annulo sees this project's data and back-office code. For example:
- "Which post did best in the last 30 days?"
- "Make my latest draft more conversational"
- "Add a daily followers chart to the overview"`,
  },
}

export const overview: Article = {
  id: 'overview',
  title: { zh: '运营总览与每周总结', en: 'Overview and weekly summary' },
  summary: { zh: '打开后台先看到的一页：几个关键数字、今天要处理的事、最新一期每周总结。', en: "The first page you see: key numbers, today's work and the latest weekly summary." },
  body: {
    zh: `## 运营总览

左侧「工作台 → 运营总览」，从上到下：

- **四个数字**：粉丝（全部账号最近一次采集的合计，旁边是近 30 天发布了几条）、待发布文章（写好了还没发的）、已连接社媒（登录着的账号数）、发布异常（发布或自检出了问题的账号数，点它去「账号」页处理）。点哪个就去对应的地方；
- **今日工作**：现在该处理的事：写好了还没发的文章（「去发布」）、社媒发布流程需要修复（「交给助手修」）、这周的总结还没写（「现在写」）。不想看的点「×」忽略，数量变多了会再出现；
- **每周总结**：最新一期每周总结的标题和结论，「查看每周总结」打开全文（右上角的「查看每周总结」也一样）；
- **账号**：每个账号的平台、数据采集时间、发布自检状态（正常、尚未自检、发布异常、登录已失效）。点账号名去「账号」，「管理账号」也去那里；
- **更多运营数据**（点开）：待发布的文章、选题（选题是空的时候能直接「出一批选题」）。

![运营总览：四个数字、今日工作、每周总结](https://fsu.creght.com/site/2103669300995821568/1791357359359__creator_help_overview_v2.png)

## 每周总结

左侧「工作台 → 每周总结」。每 7 天，定时任务把写总结交给助手：它用一个本机函数拿到这一期各账号的粉丝、互动和发布数，和上一期比，写结论、正文和下周建议，存进这一页。运营总览上显示最新一期。

![每周总结：最新一期](https://fsu.creght.com/site/2103669300995821568/1791356480228__creator_help_reports.png)

- **立即写本周总结**：现在就让助手写一期，和每周自动写的一样，一般几分钟。按钮变成「进行中 · 看过程」时，点它能看助手每一步在做什么；
- **AI 要求**：助手每次写总结都照这份要求做。想重点看什么、换什么格式，改这里，下一期就按新的写；改坏了能「恢复默认」；
- **看助手怎么写的**：打开写这一期的那段对话；「全部每周总结」回到列表；
- 数字和各页面出自同一份统计，不是助手自己算的。各账号分开说，不同平台的浏览、点赞口径不同，不加在一起比；
- 没有的数据写「没有」：采集失败的、每天的数据还没开始记录的，都照实说。`,
    en: `## Operations overview

Workspace → Operations overview in the sidebar, from top to bottom:

- **Four numbers**: Followers (the total across accounts from the latest collection, plus how many posts went out in the last 30 days), Versions to review, Social accounts (signed in), Publishing issues (accounts whose publishing or self-test failed; click it to handle them on the Accounts page). Click one to go there;
- **Today's work**: what needs you now: articles ready to publish ("Publish"), social publishing that needs repair ("Have the assistant fix it"), this week's summary not written yet ("Write now"). Click "×" to dismiss one; it comes back if the number grows;
- **Weekly summary**: the title and summary of the newest weekly summary; "View weekly summary" opens it (so does "View weekly summary" at the top right);
- **Accounts**: each account's platform, data collection time and publishing check (Healthy, Not checked, Publishing issue, Login expired). Click a name to go to Accounts; "Manage accounts" goes there too;
- **More operations data** (click to expand): articles ready to publish, and topics (when there are none, "Suggest topics" is right there).

![Operations overview: four numbers, today's work, latest weekly summary](https://fsu.creght.com/site/2103669300995821568/1791357359359__creator_help_overview_v2.png)

## Weekly summary

Workspace → Weekly summary in the sidebar. Every 7 days a schedule hands the summary to the assistant: a local function gives it this period's followers, engagement and post counts for each account; it compares them with the last summary, writes a conclusion, the body and suggestions for next week, and saves it here. The overview shows the latest one.

![Weekly summary: the latest weekly summary](https://fsu.creght.com/site/2103669300995821568/1791356480228__creator_help_reports.png)

- **Write this week's summary**: have the assistant write one now, same as the weekly one; it usually takes a few minutes. While the button shows "In progress · View progress", click it to watch each step;
- **AI instructions**: the assistant follows these every time. Change what to focus on or the format here, and the next summary follows the new version; "Restore default" undoes your edits;
- **See how it was written**: opens the chat that wrote this summary; "All weekly summaries" goes back to the list;
- The numbers come from the same stats as the pages, not from the assistant's own math. Each account is reported separately: platforms count views and likes differently, so they're never added up;
- Missing data is reported as missing: failed collections and daily data that hasn't started recording yet are stated as such.`,
  },
}

export const social: Article = {
  id: 'social',
  title: { zh: '社交媒体', en: 'Social media' },
  summary: { zh: 'X、LinkedIn、Facebook、Instagram、YouTube、小红书、抖音、B 站、知乎：看账号状态、粉丝和互动，采集数据，自检。', en: 'X, LinkedIn, Facebook, Instagram, YouTube, Xiaohongshu, Douyin, Bilibili, Zhihu: account status, followers and engagement, collecting stats, self-tests.' },
  body: {
    zh: `社交媒体页看账号和数据。文章的编辑、发布在「内容中心」里做（见「内容中心」一篇），排期在「发布日历」里看。

## 支持哪些平台

在「账号 → 添加账号」加账号，会弹出一个浏览器窗口，在里面登录。登录状态只存在这台电脑上，换电脑要重新登录。

| 平台 | 发什么 | 建议间隔 | 建议每天最多 |
|---|---|---|---|
| X | 推文，最多 4 张图或 1 个视频 | 不限 | 10 条（24 小时内） |
| LinkedIn | 个人账号的帖子，图或视频 | 60 分钟 | 5 条 |
| Facebook | 个人主页或你管理的公司主页的帖子，图或视频 | 30 分钟 | 10 条 |
| Instagram | 帖子，图或视频；没配图时用封面大字生成文字封面 | 60 分钟 | 5 条 |
| YouTube | 视频 | 60 分钟 | 3 个 |
| 小红书 | 笔记，图或视频；没配图时用封面大字生成文字封面 | 2 小时 | 3 篇 |
| 抖音 | 视频，发布后要等抖音审核 | 30 分钟 | 10 条 |
| B 站 | 视频，投稿后要等 B 站审核 | 30 分钟 | 10 条 |
| 知乎 | 专栏文章，正文里可以插图，最多 3 个话题 | 30 分钟 | 5 篇 |

间隔和条数只是建议，超了照样发；发得太密平台可能限流。社媒功能由社媒插件提供，新建项目时已经装好；页面顶部提示没装插件时，到 Annulo 的「设置 → 项目 → 插件」里装上 social。

## 账号概览

左侧「社交媒体」，第一个页签「账号概览」：

- 上面三个数字：账号、近 30 天新增粉丝、待处理账号（登录过期或者发布出了问题的）；
- **账号与发布状态**：每个账号的粉丝（旁边的箭头是近 30 天增减）、连接状态、最近发布，右边是要做的事：「查看数据」「修复发布」「重新登录」；
- **最近发布的表现**：最近发出去的 5 条和它们的浏览、点赞、评论，「看原帖」打开平台上的帖子。

![社交媒体 · 账号概览](https://fsu.creght.com/site/2103669300995821568/1791356482364__creator_help_social.png)

右上角「管理账号」去「账号」，「创建内容」去「内容中心」新建一篇文章。

## 数据表现

第二个页签「数据表现」，上面选账号和时间段（近 7 / 30 / 90 天）：

- 账号卡片：登录状态、粉丝、上次采集时间，「打开主页」「立即采集」，以及上次自检的结果；
- 这段时间发布了几条、新增粉丝和互动，每天的变化图（要采集过两天以上才画得出来）；
- 「帖子」列表：每条的各项数据，点表头按那一列排；可以只看这段时间发的，也可以看全部。点标题打开它出自的文章和发布记录。

![社交媒体 · 数据表现：一个账号的粉丝和帖子数据](https://fsu.creght.com/site/2103669300995821568/1791356481632__creator_help_social_data.png)

## 采集数据

每 6 小时自动采集一次粉丝和每条帖子的数据（Annulo 要开着）。在平台上直接发的帖子也会收进来。
要最新的：账号卡片上「立即采集」，或者「账号概览」里「全部重新采集」（一个一个账号来）。采集要打开浏览器跑一会儿，太频繁可能被平台限流。

## 自检和修复

平台改版后，发帖、采集的流程可能走不通。每天 08:30 会自检一次：走一遍登录、读数据、打开发帖框、找发布按钮，不真的发。
- 账号卡片上能看上次自检的结果，点「自检」现在就测一次（小红书账号的卡片上没有自检）；
- 走不通时，账号卡片上会说是哪一步，运营总览的「今日工作」会出现「社媒发布流程需要修复」。点「交给助手修」，助手照失败时的截图更新这个平台的发布脚本，改完点「重新自检」；
- 一直显示「发布中」、其实没在跑（比如发到一半关了 Annulo）：点「标记为发布失败」再重新发。重新发布前会先去平台上找这一条，已经发出去的不会重发。

## 登录在别的电脑

账号是在另一台电脑上登录的，会显示「登录在别的电脑」，发布、采集由那台电脑做。要改在这台电脑做，点「在这台电脑登录」。`,
    en: `The Social media page is for accounts and numbers. Articles are edited and published in Content center (see "Content center"); scheduled posts show in the Publishing calendar.

## Supported platforms

Add accounts under "Accounts → Add account". A browser window opens; log in there. The login stays on this computer; a new computer needs a new login.

| Platform | What it posts | Suggested gap | Suggested daily max |
|---|---|---|---|
| X | Posts, up to 4 images or 1 video | None | 10 (in 24 hours) |
| LinkedIn | Posts on your personal profile, images or video | 60 minutes | 5 |
| Facebook | Posts on your profile or a Page you manage, images or video | 30 minutes | 10 |
| Instagram | Posts, images or video; without images, a text cover is made from the cover text | 60 minutes | 5 |
| YouTube | Videos | 60 minutes | 3 |
| Xiaohongshu | Notes, images or video; without images, a text cover is made from the cover text | 2 hours | 3 |
| Douyin | Videos; Douyin reviews each one after posting | 30 minutes | 10 |
| Bilibili | Videos; Bilibili reviews each upload | 30 minutes | 10 |
| Zhihu | Column articles with images in the text, up to 3 topics | 30 minutes | 5 |

The spacing and daily counts are only suggestions; posts still go out if you exceed them, but posting too often can get throttled. Social features come from the social plugin, installed with every new project. If a notice at the top says it's missing, install social in Annulo's Settings → Projects → Plugins.

## Accounts

Social media in the sidebar, first tab "Accounts":

- Three numbers at the top: Accounts, New followers (30 days), Accounts needing attention (login expired or publishing problems);
- **Accounts & publishing status**: each account's followers (the arrow is the 30-day change), connection, latest publication, and what to do on the right: "View data", "Fix publishing", "Sign in again";
- **Recent posts**: the last 5 posts with views, likes and comments; "View post" opens it on the platform.

![Social media · Accounts](https://fsu.creght.com/site/2103669300995821568/1791356482364__creator_help_social.png)

At the top right, "Manage accounts" goes to Accounts and "Create content" starts a new article in Content center.

## Performance

The second tab, "Performance". Pick an account and a period at the top (last 7 / 30 / 90 days):

- Account card: login status, followers, last collection, "Profile" and "Collect now", and the last self-test result;
- Posts published in the period, new followers and engagement, and a daily chart (it needs at least two days of collection);
- "Posts" list: each post's numbers; click a column header to sort by it. Show only posts from the period, or all. Click a title to open its article and publishing record in Content center.

![Social media · Performance: one account's followers and posts](https://fsu.creght.com/site/2103669300995821568/1791356481632__creator_help_social_data.png)

## Collecting stats

Followers and every post's numbers are collected every 6 hours (Annulo must be open). Posts you made directly on the platform are picked up too.
For the latest numbers: "Collect now" on the account card, or "Collect all again" on the Accounts tab (one account at a time). Collecting runs a browser for a while; doing it too often can get you rate-limited.

## Self-test and repair

When a platform changes its pages, posting or collecting can break. A self-test runs every day at 08:30: it walks through login, reading data, opening the composer and finding the post button, without posting.
- The account card shows the last result; click "Self-test" to run one now (Xiaohongshu cards don't have a self-test);
- When it fails, the card says which step, and "Social publishing needs repair" appears in Today's work on the overview. Click "Have the assistant fix it"; the assistant updates that platform's posting script from the failure screenshot. Then click "Test again";
- Stuck on "Publishing" but nothing is running (say, Annulo was closed mid-post): click "Mark as failed" and publish again. A retry first looks for the post on the platform, so one that already went out isn't posted twice.

## Signed in on another computer

An account signed in on another computer shows "Logged in on another computer"; that computer does its publishing and collecting. To move it here, click "Log in on this computer".`,
  },
}

export const content: Article = {
  id: 'content',
  title: { zh: '内容中心：选题、文章、发布', en: 'Content center: topics, articles, publishing' },
  summary: { zh: '出选题、写文章（长文、图文笔记、视频），一键发到支持这种类型的账号；要发到别的平台就改写成它支持的类型。', en: 'Get topics, write articles (long-form, image posts, videos), publish each one to the accounts that take its type, and rewrite it into another type for other platforms.' },
  body: {
    zh: `左侧「内容与发布 → 内容中心」，两个页签：「文章」和「选题」。文章就是要发出去的内容，写好了直接发到账号上。

## 文章类型

每篇文章有一个类型，新建时先选。各平台的发帖框不一样，归成三种：

| 类型 | 写什么 | 能发到 |
|---|---|---|
| 长文 | 标题、摘要、富文本正文（小标题、列表，图片插在正文里） | 知乎 |
| 图文笔记 | 标题、纯文字正文、一组配图（第一张是封面） | 小红书、X、LinkedIn、Facebook、Instagram |
| 视频 | 标题、简介、一个视频 | YouTube、抖音、B 站，以及能发视频的图文平台 |

一篇长文想发到小红书、X，就「改写」成图文笔记（见下面）。

## 选题

「选题」页签：
- **出一批选题**：交给助手，按你的定位、已有选题和最近帖子的反响出一批，不和已有的重复；
- **手动添加**：自己写选题和切入点；
- 点选题标题或「编辑选题」，能补内容角度、关键词、读者是谁、读者想知道什么、大纲、写作语言、发到哪些平台、结尾想让读者做什么、还缺的素材，然后「保存并写成文章」；
- 「写成文章」交给助手写这一个；
- 不想写的点「×」（放弃这个选题），放弃的在下面「已写成 / 已放弃的选题」里能「恢复」；
- 点「出一批选题」先弹窗，可以写这一批的额外要求，比如只出某类主题、一次出几个，只用于这一批；不填就照默认的要求出。

![内容中心 · 选题](https://fsu.creght.com/site/2103669300995821568/1791356478101__creator_help_content_topics.png)

## 写文章

三种开头：
- 「新建文章」：先选类型，再写标题或主题；「保存」建一篇空的自己写，「让 AI 写」交给 AI；
- 「AI 写文章」：先选类型，下面是「本次写作要求」，已经填好默认写法（按类型分节），这次可以改，改的只用于这一篇；点「开始写」，助手从选题里挑一个最值得写的；
- 选题上「写成文章」：写这个选题，同样先选类型。

交给助手写的，页面上显示「助手正在写…」，一般几分钟，点「看过程」能看它每一步。写好的文章是「草稿」，在「文章」页签里。长期的写法在页面右上角「更多 → 写作要求」里改。
助手只用「我的定位」里写了的个人经历，不编数据和案例；资料库里有对得上的图会配上。

## 编辑文章

点开一篇：
- 「修改」：按类型改。长文改标题、摘要、正文（能插小标题、列表、图片，也能直接粘贴、拖进图片，输入 / 选要插入的块）；图文笔记改正文和配图（「从资料库选」，拖动调整顺序，没配图时填「封面大字」生成文字封面）；视频选资料库的视频或「上传本机视频」（只存在这台电脑上，最多 8 GB，90 天后清理），再写简介。三种都有话题；
- 「AI 修改」：写清楚哪里要改，它在当前内容上只改你说到的部分，类型不变；「更多 → 改写要求」是它每次改都要遵守的写法；
- 「更多 → 删除这篇」：已经发出去或排了期的不能直接删。

## 改写

文章页点「改写」：选改成哪种类型，写这次的要求，助手另写一篇新的，原文不动。新文章在列表里，详情里写着「改写自」哪篇；原文下面列着「改写出的文章」。

**改写预设**：常用的要求存起来，下次点一下就填好。比如经常把长文改成 X 的推文，就在「改写成图文笔记」下写「简短，200 字以内，开头一句话抓人」，点「存为预设」。点一下预设，类型和要求都填好；改、删、新建在改写弹窗的「管理预设」里。

## 发布

文章页点「发布」：
- 列出所有社媒账号，支持这篇类型的能勾（可以多选）；不支持的灰掉，写着原因，可以先改写；登录过期、登录在别的电脑上的也会写明；
- 超出平台字数上限的、这个账号已经发过一次的，会提示；
- 选「立即发布」或「定时发布」。立即发布逐个发、逐个显示结果；定时的到点由 Annulo 发（Annulo 要开着）。

发出去的是文章当时的内容，之后再改文章，不影响已经发出去的。

## 发布记录

文章页下面的「发布记录」：这篇发到了哪些账号，每个一条，显示状态、时间、平台上的链接、最近一次采集的浏览、点赞、评论。
- 发布失败的写着原因，改好后「重新发布」（重发会先去平台上找，已经发出去的不会重复发）；
- 排了期的能改时间、「立即发布」或取消排期；
- 没发出去的能「删除记录」；
- 「看账号数据」去社交媒体页。

## 文章列表

「文章」页签能搜标题和内容，按「草稿」「已发布」和类型筛。发出去的文章后面列着发到了哪些账号，点一个打开那篇的发布记录。`,
    en: `Content & publishing → Content center in the sidebar, with two tabs: "Articles" and "Topics". An article is what you post: once it's written, publish it to your accounts.

## Article types

Each article has a type, chosen when you create it. Platforms' post forms differ, so there are three:

| Type | What you write | Goes to |
|---|---|---|
| Long-form | Title, summary, rich text (headings, lists, images in the text) | Zhihu |
| Image post | Title, plain text, a set of images (the first is the cover) | Xiaohongshu, X, LinkedIn, Facebook, Instagram |
| Video | Title, description, one video | YouTube, Douyin, Bilibili, and image platforms that take video |

To post a long-form article to Xiaohongshu or X, "Rewrite" it into an image post (below).

## Topics

The "Topics" tab:
- **Suggest topics**: the assistant suggests a batch from your profile, your existing topics and how recent posts did, without repeating what you have;
- **Add manually**: write a topic and an angle yourself;
- Click a topic title or "Edit topic" to add the angle, keywords, who it's for, what readers want to know, outline, language, platforms, what readers should do at the end and missing material, then "Save and draft";
- "Write article" hands that topic to the assistant;
- Click "×" (Drop this topic) for ones you won't write; dropped ones are under "written / dropped topics" below, where you can "Restore" them;
- "Suggest topics" first opens a dialog where you can add requirements for this batch only, like only certain kinds or how many at a time; leave it empty to follow the defaults.

![Content center · Topics](https://fsu.creght.com/site/2103669300995821568/1791356478101__creator_help_content_topics.png)

## Writing

Three ways to start:
- "New article": pick a type, then a title or topic; "Save" creates an empty one to write yourself, "Let AI write it" hands it to AI;
- "Write with AI": pick a type; below it, "Requirements for this article" is filled with your default instructions (one section per type). Changes here apply to this article only. Click "Start writing" and the assistant picks the most worthwhile topic;
- "Write article" on a topic: writes that topic, again after picking a type.

While the assistant writes, the page shows "The assistant is writing…", usually for a few minutes; "View progress" shows each step. The result is a "Draft" under Articles. Change the long-term instructions under "More → Writing instructions" at the top right.
The assistant only uses personal stories you wrote in My profile and doesn't make up data or cases; matching images from the Library are added.

## Editing an article

Open one:
- "Edit": fields depend on the type. Long-form: title, summary and body (headings, lists, images; paste or drop images, type / to insert a block). Image post: text and images ("Pick from library", drag to reorder; without images, "Cover text" becomes a text cover). Video: pick a library video or "Upload from this computer" (stays on this computer, up to 8 GB, cleaned up after 90 days), then the description. All three have hashtags;
- "Ask AI to revise": say what to change; it edits the current content, touches only what you mention, and keeps the type. "More → Revision instructions" is what it follows every time;
- "More → Delete": articles that have been posted or scheduled can't be deleted.

## Rewrite

Click "Rewrite" on an article: pick the type to rewrite into, write what you want, and the assistant writes a new article; the original stays as it is. The new one is in the list and says which article it was "Rewritten from"; the original lists its "Rewritten articles".

**Rewrite presets**: save instructions you use often and fill them in with one click. If you often turn articles into posts for X, write "Short, under 200 words, open with a hook" under "Rewrite into Image post" and click "Save as preset". Clicking a preset fills in both the type and the instructions; edit, delete or add presets under "Manage presets" in the rewrite dialog.

## Publishing

Click "Publish" on an article:
- All social accounts are listed; the ones that take this article's type can be ticked (several is fine). Others are greyed out with the reason, and you can rewrite first. Expired logins and logins on another computer are noted too;
- You're warned when the text is over a platform's limit, or when the article already went to that account;
- Choose "Publish now" or "Schedule". Publish now posts one by one and shows each result; scheduled ones are posted on time by Annulo (Annulo must be open).

What goes out is the article as it is at that moment; editing it later doesn't change what's already posted.

## Publishing records

"Publishing" below the article: one row per account it went to, with status, time, the link on the platform, and views, likes and comments from the latest collection.
- Failed posts show the reason; fix it and "Publish again" (a retry first looks for the post on the platform, so one that already went out isn't posted twice);
- Scheduled ones can be moved, published now, or unscheduled;
- Ones that didn't go out can be removed with "Delete record";
- "Account data" goes to Social media.

## Article list

On the "Articles" tab, search titles and text, and filter by "Draft", "Published" and type. Published articles list the accounts they went to; click one to open that article's record.`,
  },
}

export const calendar: Article = {
  id: 'calendar',
  title: { zh: '发布日历与资料库', en: 'Publishing calendar and library' },
  summary: { zh: '按天看所有排期和发布、拖动改排期；图片、视频和常用文字放资料库。', en: 'See every scheduled and published post by day and drag to reschedule; keep images, videos and reusable text in the library.' },
  body: {
    zh: `## 发布日历

左侧「内容与发布 → 发布日历」，按「周」或「月」看各账号的已排期、发布中、已发布、发布失败、已删除的帖子。

![发布日历：月视图](https://fsu.creght.com/site/2103669300995821568/1791357359958__creator_help_calendar_v2.png)

- 点一条打开它出自的文章；
- 已排期、已通过的帖子可以拖到别的日子，时间不变；不能拖到过去；
- 上面列着审核通过、还没排期的帖子，拖到某一天就排上（默认 10:00）；
- 到点由 Annulo 发布。

## 资料库

左侧「知识库 → 资料库」，集中放图片、视频和常用文字，写文章、配社媒图时从这里选（按钮叫「从资料库选」）。

![资料库](https://fsu.creght.com/site/2103669300995821568/1791356473061__creator_help_assets.png)

- 「上传」：选图片或视频，单个最多 200 MB，能多选，也能直接拖进页面；
- 「添加资料」：贴图片或视频地址（一行一个，要公开能打开的 https 地址，发布到社媒时平台要下载得到），或者存一段文字（常用的开头、金句、个人经历片段）；
- 按「全部 / 图片 / 视频 / 文字」筛，按名称、标签、内容搜；
- 每一项能复制地址或文字、改名称和标签、删除。删除不影响已经发出去的内容；
- 助手存进来的资料标着「助手」。助手写文章时，会从这里挑对得上的图配进正文。`,
    en: `## Publishing calendar

Content & publishing → Publishing calendar in the sidebar, by "Week" or "Month": every account's scheduled, publishing, published, failed and deleted posts.

![Publishing calendar: month view](https://fsu.creght.com/site/2103669300995821568/1791357359958__creator_help_calendar_v2.png)

- Click an item to open its article in Content center;
- Drag a scheduled or approved post to another day; the time stays the same. You can't drag into the past;
- Approved posts that aren't scheduled yet are listed at the top; drag one onto a day to schedule it (10:00 by default);
- Annulo publishes on time and pushes a post back if the platform's spacing rules require.

## Library

Knowledge → Library in the sidebar keeps images, videos and reusable text in one place; pick from it when writing articles and adding images to posts (the button says "Pick from library").

![Library](https://fsu.creght.com/site/2103669300995821568/1791356473061__creator_help_assets.png)

- "Upload": pick images or videos, up to 200 MB each, several at once, or drop them onto the page;
- "Add resource": paste image or video URLs (one per line; they must be public https URLs, since platforms download them when posting), or save a piece of text (openers, quotes, personal stories you reuse);
- Filter by All / Images / Videos / Text, and search names, tags and content;
- Each item can be copied (URL or text), renamed and retagged, or deleted. Deleting doesn't affect content that's already out;
- Items the assistant saved are marked "Assistant". When it writes an article, it picks matching images from here.`,
  },
}

export const company: Article = {
  id: 'company',
  title: { zh: '我的定位', en: 'My profile' },
  summary: { zh: '写什么、写给谁、什么风格：出选题、写文章、改写帖子，助手都照这里来。', en: 'What you write, who for, in what voice: the assistant follows this for topics, articles and posts.' },
  body: {
    zh: `左侧「知识库 → 我的定位」。助手出选题、写文章、改写成各平台的帖子、写每周总结前都先读它，写出来要像你写的。起步向导里填的也存在这里。

![我的定位](https://fsu.creght.com/site/2103669300995821568/1791357360610__creator_help_company_v2.png)

分四块：
- **概况**：名字或账号名、一句话定位、主要写什么、关于我。「关于我」写你的经历、身份、为什么值得听：**文章里的个人经历只从这里取，不会编**；
- **专长**：专长和经历、能提供什么（比如接什么合作）；
- **读者**：写给谁、平台和语言、读者最关心的问题；
- **风格**：说话风格、常写的话题（逗号分隔）、不写什么。「不写什么」里的话题和说法，助手不会碰。

改完点页面底部的「保存」，下一次出选题、写东西就按新的来。`,
    en: `Knowledge → My profile in the sidebar. The assistant reads it before suggesting topics, writing articles, adapting posts for each platform or writing the weekly summary, so the result sounds like you. What you entered in the setup wizard is stored here too.

![My profile](https://fsu.creght.com/site/2103669300995821568/1791357360610__creator_help_company_v2.png)

Four sections:
- **Overview**: Name or handle, One-line positioning, What you write about, About me. "About me" is your background, who you are and why people should listen: **personal stories in articles only come from here; nothing is made up**;
- **Expertise**: Expertise and track record, What you offer (for example, the collaborations you take on);
- **Audience**: Who you write for, Platforms and languages, What your readers care about most;
- **Voice**: Voice, Topics you cover (comma-separated), Avoid. The assistant stays away from topics and phrasing listed under "Avoid".

Click "Save" at the bottom of the page; the next topics and drafts follow the new version.`,
  },
}

export const channels: Article = {
  id: 'channels',
  title: { zh: '账号', en: 'Accounts' },
  summary: { zh: '添加和移除社媒账号、登录、发布自检；登录状态只在这台电脑上。', en: 'Add and remove social accounts, log in, self-test publishing; logins stay on this computer.' },
  body: {
    zh: `左侧下方的「账号」：连接你要运营的社媒账号。添加、登录、发布自检都在这里，数据在「社交媒体」里看。

![账号](https://fsu.creght.com/site/2103669300995821568/1791356475190__creator_help_channels.png)

上面每个账号一张小卡片，带平台和状态（已连接、登录过期、发布失败、登录在别的电脑……），点一张在下面看详情。

## 添加

「添加账号」，选平台：X、LinkedIn、Facebook、Instagram、YouTube、小红书、抖音、B 站、知乎。点「登录…」会弹出一个浏览器窗口，在里面登录（抖音、B 站、知乎用 App 扫码），登录好了账号就加上了。
- 登录状态只存在这台电脑上，不上传；
- LinkedIn 先支持个人账号；Facebook 个人主页和你管理的公司主页都能加。

## 账号详情

- 登录状态、上次采集时间；
- 「打开主页」：用这个账号自己的浏览器打开它在平台上的主页；
- 「立即采集」：现在采集一次粉丝和帖子数据；
- 「重新登录」：登录过期、换了电脑、清了浏览器数据时用；账号登录在别的电脑上时是「在这台电脑登录」；
- 「看数据」：去「社交媒体 → 数据表现」；
- 发布自检和发布失败的提示，见「社交媒体」一篇。

账号已经加上、但这个平台在项目里还没接入的，会显示「未接入」，点「让助手接入 …」（后面是平台名）交给助手把这个平台接进来。

## 移除

「移除」，再「确认移除」。只是不再在这里运营它，账号本身不受影响，之后还能再添加回来。`,
    en: `"Accounts" at the bottom of the sidebar connects the social accounts you run. Adding, logging in and publishing self-tests happen here; the numbers are under Social media.

![Accounts](https://fsu.creght.com/site/2103669300995821568/1791356475190__creator_help_channels.png)

Each account has a small card at the top with its platform and status (Connected, Login expired, Failed, Logged in on another computer…). Click one to see its details below.

## Adding

"Add account", then pick a platform: X, LinkedIn, Facebook, Instagram, YouTube, Xiaohongshu, Douyin, Bilibili, Zhihu. Click "Log in to …" and a browser window opens; log in there (Douyin, Bilibili and Zhihu use a QR code in their app), and the account is added.
- The login stays on this computer and isn't uploaded;
- LinkedIn supports personal profiles for now; on Facebook you can add your profile and the Pages you manage.

## Account details

- Login status and last collection;
- "Profile": opens the account's page on the platform in its own browser;
- "Collect now": collects followers and post numbers now;
- "Sign in again": when the login expired, or after switching computers or clearing browser data. For an account logged in on another computer it says "Log in on this computer";
- "View data": goes to Social media → Performance;
- Publishing self-tests and failed posts: see "Social media".

If the account is added but its platform isn't set up in this project yet, it shows "Not set up". Click "Set up … with the assistant" (the platform name is in the button) to have the assistant add the platform.

## Removing

"Remove", then "Remove" again to confirm. You just stop running it here; the account itself is unaffected and can be added back later.`,
  },
}

export const assistant: Article = {
  id: 'assistant',
  title: { zh: '运营助手', en: 'The assistant' },
  summary: { zh: '它能做什么、不会替你做什么、怎么让它改后台、在手机上怎么用。', en: "What it does, what it won't do for you, how to have it change the back office, and using it from your phone." },
  body: {
    zh: `Annulo 右侧的运营助手看得到这个项目的数据、账号和后台代码，能动手做事。

![Annulo 窗口：右侧助手在回答数据问题](https://fsu.creght.com/site/2103669300995821568/1791356473851__creator_help_assistant.png)

## 能做什么

- 回答数据问题：「最近 30 天哪条帖子表现最好」「小红书这个月涨了多少粉」，需要时画成图；
- 出选题、写文章、改文章、写各平台的帖子（写好的帖子都要你审）；
- 改后台本身：「在运营总览加一张每日粉丝趋势图」「加一个字段」，见下面；
- 写每周总结，解释某个数字是怎么算的。

## 按钮和助手

后台很多按钮是直接执行的（采集、自检、发布），不经过助手。
要 AI 读东西、想东西的按钮（出一批选题、AI 写文章、AI 修改、改写、立即写本周总结、交给助手修…）会新开一段对话在后台跑，在右侧能看到；按钮变成「进行中 · 看过程」，点它打开那段对话，跑完页面自动刷新。这类按钮旁边常有「AI 要求」（或「写作要求」），里面是它每次都照着做的写法，可以改，改坏了能「恢复默认」。

## 不会替你做的

- 不会替你审核通过内容，没通过的不会发；
- 不会从平台上删除内容，除非你明确要求；
- 不会编你的经历：文章里的个人经历只取自「我的定位」；
- 读不到你在 Annulo「设置 → 密钥」里存的值，也不会把 key 写进代码、表或对话。

## 让它改后台

直接说要什么。它改好后台代码，这一轮结束时左侧后台自动刷新。
每次改动都记在项目的 git 里，哪一步不对，跟它说「回滚刚才的改动」。
后台页面报错时，顶部会出现「交给助手修复」，点了才把报错发给它。报错出在不是它这次改的地方时，它会先问你，不会直接去改。

## 定时交给助手的事

有的定时任务是到点把一件事交给助手，比如每周写总结。到点会开一段标题以「定时：」开头的新对话；你不在场，它不会停下来等你回答，缺的信息按合理的默认做完，并在最后说明。

## 给助手的说明

Annulo「设置 → 项目」里的「给助手的说明」：写你对这个项目里助手的要求，比如回答的风格、不能做的事。它会放进系统提示，和项目自带的说明冲突时以它为准，升级模板不会改它；改完从新对话开始生效。

## 在手机上用

连了 creght 的在线项目，可以在手机或别的电脑上打开后台（地址在 Annulo「设置 → 远程访问」里），用 creght 账号登录：
- 数据都能看，文章也能改；
- 发布、采集、交给 AI 的按钮要转到你的电脑上跑：电脑上的 Annulo 要开着、打开着这个项目，并且在「设置 → 远程访问」里打开「允许远程调用这台电脑」。页面顶部会显示电脑在不在线；
- 手机上没有右侧的助手，左侧多一个「助手」：发一句话交给电脑上的助手做，过程和结果在这里看。`,
    en: `The assistant on the right of Annulo sees this project's data, accounts and back-office code, and it can act on them.

![The Annulo window with the assistant answering a data question](https://fsu.creght.com/site/2103669300995821568/1791356473851__creator_help_assistant.png)

## What it does

- Answers questions about your data: "which post did best in the last 30 days?", "how many Xiaohongshu followers did I gain this month?", with a chart when useful;
- Suggests topics, writes and revises articles, writes posts for each platform (every post waits for your review);
- Changes the back office itself: "add a daily followers chart to the overview", "add a field" (see below);
- Writes the weekly summary and explains how a number is calculated.

## Buttons and the assistant

Many buttons run directly (collecting, self-tests, publishing) without the assistant.
Buttons that need AI to read or think (Suggest topics, Write with AI, Ask AI to revise, Rewrite, Write this week's summary, Have the assistant fix it…) open a new chat that runs in the background, visible on the right. The button turns into "In progress · View progress"; click it to open that chat, and the page refreshes when it's done. These buttons often have "AI instructions" (or "Writing instructions") next to them: the rules it follows every time. You can edit them, and "Restore default" undoes your edits.

## What it won't do for you

- Approve content for you; nothing unapproved gets posted;
- Delete content from a platform unless you explicitly ask;
- Make up your experience: personal stories in articles only come from My profile;
- It can't read the values you saved in Annulo's Settings → Keys, and it won't put keys into code, tables or the chat.

## Changing the back office

Just say what you want. It edits the back-office code, and when the turn ends the back office on the left refreshes itself.
Every change is recorded in the project's git history; if a step went wrong, tell it to "roll back that change".
If a back-office page throws an error, "Ask the assistant to fix" appears at the top; the error is sent only when you click it. If the error is somewhere the assistant didn't change this time, it asks you before touching it.

## Scheduled jobs for the assistant

Some schedules hand a job to the assistant, like writing the weekly summary. Each run opens a new chat whose title starts with "定时：" (Scheduled). You're not there, so it doesn't stop to ask; it makes sensible assumptions and lists them at the end.

## Instructions for the assistant

"Instructions for the assistant" in Annulo's Settings → Projects: your rules for the assistant in this project, like tone or things it must not do. They go into its system prompt, win over the project's built-in notes, and aren't touched by template upgrades. Changes apply from the next new chat.

## Using it from your phone

For an online project (connected to creght), you can open the back office on a phone or another computer (the address is in Annulo's Settings → Remote access) and sign in with your creght account:
- You can see all the data and edit articles;
- Publishing, collecting and AI buttons run on your computer: Annulo must be running there with this project open, and "Allow remote use of this computer" turned on in Settings → Remote access. The top of the page shows whether the computer is online;
- There's no assistant panel on the phone; "Assistant" appears in the sidebar instead. Send it a message and the assistant on your computer does the work; follow the progress and result there.`,
  },
}

export const settings: Article = {
  id: 'settings',
  title: { zh: '设置', en: 'Settings' },
  summary: { zh: '自媒体工作台用到的 Annulo 设置：模型、插件、定时任务、模板升级。', en: 'The Annulo settings this template uses: models, plugins, schedules, template upgrades.' },
  body: {
    zh: `设置在 Annulo 里，不在后台页面上：后台左下角的「Annulo 设置」打开它，「用量」看模型用了多少 token。每一项的完整说明见 Annulo 官网帮助的「设置一览」；这里只写自媒体工作台用到的部分。

## 模型

「设置 → 模型」里三种都行，对话框底部也能随时切换：
- **自己的服务商**：选一个服务商、填 API key、勾要用的模型。key 只存在本机；
- **本机 Agent**：这台电脑上装好的 Claude Code / Codex；
- **creght 平台的模型**：连了 creght 才有，按 AI 积分计费。

出选题、写文章、改文章、改写、写每周总结，都用这里选的模型。

## 密钥

自媒体工作台不用另外加密钥：社媒账号用浏览器登录，登录状态存在这台电脑上。助手接了别的服务、缺 key 时，会提示到「设置 → 密钥」添加。**不要把 key 发在对话里。**

## 插件

社交媒体的功能来自社媒插件（social），新建项目时自动装好。「设置 → 项目 → 插件」里装、升级，和模板分开升级。

## 定时任务

「设置 → 定时任务」里列着后台自己会跑的事，每个都能看上次结果、「立即运行」、暂停：

| 任务 | 多久一次 |
|---|---|
| 写每周总结（交给助手） | 7 天 |
| 发布到点的社媒帖子 | 各平台 5~15 分钟 |
| 采集社媒数据 | 各平台 6 小时 |
| 社媒自检 | 每天 08:30 |

没有某个平台的账号时，那个平台的任务什么都不做。**只在 Annulo 开着的时候跑**，关机或退出期间错过的，下次打开时补跑一次。

## 模板升级

「设置 → 项目」里当前项目的模板卡片：有新版本时显示「升级到 vN」和每一版改了什么。

![Annulo 设置 → 项目：模板和插件卡片](https://fsu.creght.com/site/2103669300995821568/1791356481002__creator_help_settings_project.png)

- 升级会把模板的改动合进这个项目，你自己改过的地方保留；两边改了同一处的，点「交给助手解决」；
- 你改过的「AI 要求」存在项目的 \`user/\` 目录里，升级不会覆盖；
- 卡片提示先更新 Annulo 时，说明这一版模板用到了新版 Annulo 的能力，先更新 Annulo 再升级；
- 改坏了模板自带的文件，可以「恢复模板文件」，勾选要恢复的文件。`,
    en: `Settings live in Annulo, not in the back-office pages: "Annulo settings" at the bottom left of the back office opens them, and "Usage" shows how many tokens the models used. Annulo's own help ("Settings at a glance" on the Annulo website) covers every item; this article covers only what Creator studio uses.

## Models

Settings → Models offers three kinds, and you can switch anytime at the bottom of the chat box:
- **Your own provider**: pick a provider, enter an API key and tick the models to use. The key stays on this computer;
- **Local agent**: Claude Code / Codex installed on this computer;
- **creght platform models**: available when creght is connected, billed in AI credits.

Suggesting topics, writing, revising and rewriting articles, and the weekly summary all use the model chosen here.

## Keys

Creator studio needs no extra keys: social accounts log in with a browser, and the login stays on this computer. If the assistant connects another service that needs a key, it asks you to add it in Settings → Keys. **Don't paste keys into the chat.**

## Plugins

The Social media features come from the social plugin, installed with every new project. Install and upgrade it in Settings → Projects → Plugins; it upgrades separately from the template.

## Schedules

Settings → Schedules lists what the back office runs by itself. Each shows its last result, and has "Run now" and pause:

| Task | How often |
|---|---|
| Write the weekly summary (handed to the assistant) | 7 days |
| Publish social posts that are due | 5–15 minutes per platform |
| Collect social stats | 6 hours per platform |
| Social self-test | Daily at 08:30 |

A platform's tasks do nothing when you have no account on it. **They only run while Annulo is open**; anything missed while the computer was off or Annulo was closed runs once when you open it again.

## Template upgrades

In Settings → Projects, the current project's template card shows "Upgrade to vN" and what changed in each version.

![Annulo Settings → Projects: the template and plugin cards](https://fsu.creght.com/site/2103669300995821568/1791356481002__creator_help_settings_project.png)

- Upgrading merges the template's changes into your project and keeps your own edits; where both sides changed the same spot, click "Ask the assistant to resolve";
- Your edited "AI instructions" live in the project's \`user/\` folder; upgrades don't overwrite them;
- If the card says to update Annulo first, this template version needs a newer Annulo. Update Annulo, then upgrade;
- If you broke a file that came with the template, use "Restore template files" and tick the ones to restore.`,
  },
}

export const faq: Article = {
  id: 'faq',
  title: { zh: '常见问题与排错', en: 'FAQ and troubleshooting' },
  summary: { zh: '定时任务没跑、登录过期、发布失败、数字对不上、升级冲突……', en: "Tasks that didn't run, expired logins, failed posts, numbers that look wrong, upgrade conflicts…" },
  body: {
    zh: `## 定时任务没跑

定时任务只在 Annulo 开着的时候跑。关机或退出 Annulo 期间错过的，下次打开时补跑一次（不会把错过的每一次都补上）。
在 Annulo 的「设置 → 定时任务」里能看每个任务上次的结果和报错，也能「立即运行」。被暂停的任务不会跑。

## 社媒提示登录过期

到「社交媒体」或「账号」点那个账号的「重新登录」。登录状态只存在这台电脑上，换电脑、清了浏览器数据都要重新登录。
X 登录后一直跳验证的，可以让助手看一下（X 可能识别了自动打开的浏览器）。

## 发布失败

- 看文章「发布记录」里的报错，改好后重新发布。重新发布前会先去平台上找这一条，已经发出去的不会重发；
- 一直显示「发布中」：点「标记为发布失败」再重新发；
- 报「页面可能改了」，或者运营总览出现「社媒发布流程需要修复」：平台改版了，点「交给助手修」，改完点「重新自检」；
- X 报「内容重复」：X 不让发和之前一样的内容，改一下正文再发；
- 抖音、B 站发出去后还要等平台审核，审核期间平台上可能暂时看不到。

## 左侧后台空白或报错

顶部出现报错时点「交给助手修复」。如果是别人正在改后台引起的，助手会先问你。
运营后台要在 Annulo 里打开；在手机上打开要用 creght 账号登录，见「运营助手」一篇。

## 数字对不上 / 显示 0

- 社媒数据每 6 小时采集一次，要最新的点「立即采集」或「全部重新采集」；
- 每天的变化要采集过两天以上才有，刚加的账号先只显示累计值；
- 各平台的浏览、点赞口径不同（比如 LinkedIn 是展示、YouTube 是播放），不要加在一起比。

## 模板升级有冲突

升级时两边改了同一处，模板卡片会提示上次升级有冲突，点「交给助手解决」：它保留你自己的改动，同时把模板的新改动合进来。

## 改坏了想回到之前

后台的每次改动都记在项目的 git 里。跟助手说「回滚刚才的改动」或者「回到昨天的版本」。`,
    en: `## A scheduled task didn't run

Schedules only run while Annulo is open. Anything missed while your computer was off or Annulo was closed runs once when you open it again (not once per missed run).
Annulo's Settings → Schedules shows each task's last result and error, and has "Run now". Paused tasks don't run.

## A social account says the login expired

On Social media or Accounts, click "Sign in again" on that account. Logins live only on this computer; a new computer or cleared browser data means logging in again.
If X keeps asking for verification after you log in, ask the assistant to take a look (X may have spotted the automated browser).

## Posting failed

- Read the error in the article's publishing record, fix it and publish again. A retry first looks for the post on the platform, so one that already went out isn't posted twice;
- Stuck on "Publishing": click "Mark as failed", then publish again;
- "The page may have changed", or "Social publishing needs repair" on the overview: the platform changed. Click "Have the assistant fix it", then "Test again";
- X says "duplicate content": X won't accept the same text twice; tweak it and post again;
- Douyin and Bilibili review videos after posting; the video may not be visible on the platform until that's done.

## The back office is blank or shows an error

When an error appears at the top, click "Ask the assistant to fix". If someone else's in-progress change caused it, the assistant asks you first.
The back office needs to be opened in Annulo; on a phone, sign in with your creght account (see "The assistant").

## Numbers look wrong or show 0

- Social stats are collected every 6 hours; click "Collect now" or "Collect all again" for the latest;
- Daily changes need at least two days of collection; a newly added account shows totals only at first;
- Platforms count differently (LinkedIn counts impressions, YouTube counts plays, for example), so don't add them up.

## A template upgrade had conflicts

When both sides changed the same spot, the template card says the last upgrade has conflicts. Click "Ask the assistant to resolve": it keeps your changes and merges in the template's.

## I broke something and want it back

Every back-office change is in the project's git history. Tell the assistant "roll back that change" or "go back to yesterday's version".`,
  },
}
