// 帮助手册：每篇中英两份，body 是 Markdown（components/Markdown.tsx 渲染：标题、列表、表格、加粗、行内代码、https 链接、单独一行的图片 `![说明](https://…)`）。
// 运营后台左侧「帮助」页显示它；运营助手回答「这个怎么用」时也读这里。
// 写法：只写现在真有的功能，按钮名和页面上一字不差（中文看 messages/zh.json，英文看 messages/en.json；页面名以左侧导航为准）；改了功能顺手改这里。
// 截图：单独一行 `![说明](https://…)`，中英两份用同一张（中文界面）。数据全是编的：内容中心、社媒、账号、总览的图（文件名带 _v2、_v3 或 content_）
// 取自宣传片工程 shuttle-promo 的帮助镜头（src/vb/HelpShots.tsx，演示博主「林夏的生活方式笔记」），其余取自演示项目「示例：自媒体工作台（演示数据）」（creght 项目 qarrue74ctjm）。界面改了要重截。
// 讲 Annulo 本身（设置、模型、定时任务、模板升级、远程访问）的部分要和 Annulo 官网帮助（shuttle-site 的 help/platform.ts）一致，Annulo 改了界面要跟着改。

export type Localized = { zh: string; en: string }
export type Article = { id: string; title: Localized; summary: Localized; body: Localized }

export const quickstart: Article = {
  id: 'quickstart',
  title: { zh: '开始使用', en: 'Getting started' },
  summary: { zh: '起步向导写定位，再按「起步配置」做完：连账号、做第一条内容、发出第一条。', en: 'The setup wizard takes your profile; then finish Getting started: connect an account, make your first piece, publish your first post.' },
  body: {
    zh: `## 1. 起步向导

第一次打开后台会进「开始使用自媒体工作台」，先填你的定位：
- **主要写什么**、**写给谁**：必填。读者可以从下拉里选（职场人、学生、宝爸宝妈、创业者……），也可以自己写一个点「添加」；
- **说话风格**：AI 写文案、写脚本时照这个说话；
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
| 写第一篇内容 | 内容中心里有一条内容，刚建的也算 |
| 发出第一条帖子 | 有一条内容发到了账号上或排了期 |

做没做完是按数据判断的，不用手动打勾。点一项展开说明和去做的按钮；用不上的点「先跳过」，跳过的能「恢复」。

![运营总览上展开的起步配置清单](https://fsu.creght.com/site/2103669300995821568/1791356475965__creator_help_checklist.png)

## 3. 连上社媒账号

左侧下方「账号 → 添加账号」，选平台：X、LinkedIn、Facebook、Instagram、YouTube、小红书、抖音、B 站、知乎。会弹出一个浏览器窗口，在里面登录（抖音、B 站、知乎用 App 扫码）。登录状态只存在这台电脑上。见「账号」一篇。

## 4. 做第一条内容、发第一条

1. 「内容中心 → 选题」点「出一批选题」，助手按你的定位出一批；
2. 挑一个点「做成内容」，或者在「内容」页签点「新建内容」写几句想做什么，再选「让 AI 做」或「自己写」。稿子、文案、图、视频都是这条内容里的文件；
3. 打开这条看看 AI 做的文件，要它接着做（改文案、做封面、做视频）点「交给 AI」；
4. 点「发布」，挑这次发成图文、视频还是长文，用哪份文案、哪些图或哪个视频，勾上账号，点「发布到 N 个账号」；要定时就先点左下角的日历图标选时间。

详见「内容中心」一篇。

## 5. 让助手做事

Annulo 右侧的助手看得到这个项目的数据、内容文件夹和后台代码。比如：
- 「最近 30 天哪条帖子表现最好？」
- 「把最新那条的文案改得更口语一点」
- 「在运营总览加一张每日粉丝趋势图」`,
    en: `## 1. Setup wizard

The first time you open the back office you land in "Get started with Creator studio". Fill in your profile:
- **What do you write about?** and **Who do you write for?** are required. Pick readers from the list (Professionals, Students, Parents, Founders…) or type your own and click "Add";
- **Voice**: AI follows this voice when it writes copy and scripts;
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
| Write your first piece | There's a piece in Content center; a brand-new one counts |
| Publish your first post | A piece is posted to an account or scheduled |

Progress comes from your data; nothing to tick by hand. Click a step to see what to do and a button to do it. Click "Skip for now" for steps you don't need; skipped ones can be restored ("Restore").

![The Getting started checklist on the overview](https://fsu.creght.com/site/2103669300995821568/1791356475965__creator_help_checklist.png)

## 3. Connect a social account

"Accounts → Add account" at the bottom of the sidebar, then pick a platform: X, LinkedIn, Facebook, Instagram, YouTube, Xiaohongshu, Douyin, Bilibili, Zhihu. A browser window opens; log in there (Douyin, Bilibili and Zhihu use a QR code in their app). The login stays on this computer. See "Accounts".

## 4. Make your first piece, publish your first post

1. In Content center → Topics, click "Suggest topics"; the assistant suggests a batch from your profile;
2. Pick one and click "Turn into a piece", or click "New content" on the Content tab, write a few lines about what you want, then choose "Let AI make it" or "Write it myself". The brief, copy, images and videos are files in the piece;
3. Open the piece and look at what AI made; to have it do more (revise the copy, make a cover, make a video), click "Ask AI";
4. Click "Publish", choose whether this goes out as an image post, a video or an article, which copy and which images or video to use, tick the accounts and click "Publish to N accounts". To schedule it, first pick a time with the calendar icon at the bottom left.

See "Content center" for details.

## 5. Ask the assistant

The assistant on the right of Annulo sees this project's data, content folders and back-office code. For example:
- "Which post did best in the last 30 days?"
- "Make the copy of my latest piece more conversational"
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

- **四个数字**：粉丝（全部账号最近一次采集的合计，旁边是近 30 天发布了几条）、待发布文章（做好了还没发的内容）、已连接社媒（登录着的账号数）、发布异常（发布出了问题的账号数，点它去「账号」页处理）。点哪个就去对应的地方；
- **今日工作**：现在该处理的事：做好了还没发的内容（「去发布」）、社媒发布流程需要修复（「交给助手修」）、这周的总结还没写（「现在写」）。不想看的点「×」忽略，数量变多了会再出现；
- **每周总结**：最新一期每周总结的标题和结论，「查看每周总结」打开全文（右上角的「查看每周总结」也一样）；
- **账号**：每个账号的平台、数据采集时间、发布状态（正常、还没发过、发布异常、登录已失效）。点账号名去「账号」，「管理账号」也去那里；
- **更多运营数据**（点开）：待发布的文章、选题（选题是空的时候能直接「出一批选题」）。

![运营总览：四个数字、今日工作、每周总结、账号](https://fsu.creght.com/site/2103669300995821568/1792413756439__creator_help_overview_v3.png)

## 每周总结

左侧「工作台 → 每周总结」。每 7 天，定时任务把写总结交给助手：它拿到这一期各账号的粉丝、互动和发布数，和上一期比，写结论、正文和下周建议，存进这一页。运营总览上显示最新一期。

![每周总结：最新一期](https://fsu.creght.com/site/2103669300995821568/1791356480228__creator_help_reports.png)

- **立即写本周总结**：现在就让助手写一期，和每周自动写的一样，一般几分钟。按钮变成「进行中 · 查看对话」时，点它能看助手每一步在做什么；
- **AI 要求**：助手每次写总结都照这份要求做。想重点看什么、换什么格式，改这里，下一期就按新的写；改坏了能「恢复默认」；
- **看助手怎么写的**：打开写这一期的那段对话；「全部每周总结」回到列表；
- 数字和各页面出自同一份统计，不是助手自己算的。各账号分开说，不同平台的浏览、点赞口径不同，不加在一起比；
- 没有的数据写「没有」：采集失败的、每天的数据还没开始记录的，都照实说。`,
    en: `## Operations overview

Workspace → Operations overview in the sidebar, from top to bottom:

- **Four numbers**: Followers (the total across accounts from the latest collection, plus how many posts went out in the last 30 days), Ready to publish (pieces that are done but not posted yet), Social accounts (signed in), Publishing issues (accounts whose publishing failed; click it to handle them on the Accounts page). Click one to go there;
- **Today's work**: what needs you now: pieces ready to publish ("Publish"), social publishing that needs repair ("Have the assistant fix it"), this week's summary not written yet ("Write now"). Click "×" to dismiss one; it comes back if the number grows;
- **Weekly summary**: the title and summary of the newest weekly summary; "View weekly summary" opens it (so does "View weekly summary" at the top right);
- **Accounts**: each account's platform, data collection time and publishing status (Healthy, Nothing published yet, Publishing issue, Login expired). Click a name to go to Accounts; "Manage accounts" goes there too;
- **More operations data** (click to expand): pieces ready to publish, and topics (when there are none, "Suggest topics" is right there).

![Operations overview: four numbers, today's work, weekly summary, accounts](https://fsu.creght.com/site/2103669300995821568/1792413756439__creator_help_overview_v3.png)

## Weekly summary

Workspace → Weekly summary in the sidebar. Every 7 days a schedule hands the summary to the assistant: it gets this period's followers, engagement and post counts for each account, compares them with the last summary, writes a conclusion, the body and suggestions for next week, and saves it here. The overview shows the latest one.

![Weekly summary: the latest weekly summary](https://fsu.creght.com/site/2103669300995821568/1791356480228__creator_help_reports.png)

- **Write this week's summary**: have the assistant write one now, same as the weekly one; it usually takes a few minutes. While the button shows "In progress · View chat", click it to watch each step;
- **AI instructions**: the assistant follows these every time. Change what to focus on or the format here, and the next summary follows the new version; "Restore default" undoes your edits;
- **See how it was written**: opens the chat that wrote this summary; "All weekly summaries" goes back to the list;
- The numbers come from the same stats as the pages, not from the assistant's own math. Each account is reported separately: platforms count views and likes differently, so they're never added up;
- Missing data is reported as missing: failed collections and daily data that hasn't started recording yet are stated as such.`,
  },
}

export const social: Article = {
  id: 'social',
  title: { zh: '社交媒体', en: 'Social media' },
  summary: { zh: 'X、LinkedIn、Facebook、Instagram、YouTube、小红书、抖音、B 站、知乎：看账号状态、粉丝和互动，采集数据。', en: 'X, LinkedIn, Facebook, Instagram, YouTube, Xiaohongshu, Douyin, Bilibili, Zhihu: account status, followers and engagement, collecting stats.' },
  body: {
    zh: `社交媒体页看账号和数据。内容的制作和发布在「内容中心」里做（见「内容中心」一篇），排期在「发布日历」里看。

## 支持哪些平台

在「账号 → 添加账号」加账号，会弹出一个浏览器窗口，在里面登录。登录状态只存在这台电脑上，换电脑要重新登录。

| 平台 | 发什么 | 建议间隔 | 建议每天最多 |
|---|---|---|---|
| X | 推文，最多 4 张图或 1 个视频 | 不限 | 10 条（24 小时内） |
| LinkedIn | 个人账号的帖子，图或视频 | 60 分钟 | 5 条 |
| Facebook | 个人主页或你管理的公司主页的帖子，图或视频 | 30 分钟 | 10 条 |
| Instagram | 帖子，图或视频 | 60 分钟 | 5 条 |
| YouTube | 视频 | 60 分钟 | 3 个 |
| 小红书 | 笔记，图或视频（视频可以单独设封面） | 2 小时 | 3 篇 |
| 抖音 | 视频（可以单独设封面），发布后要等抖音审核 | 30 分钟 | 10 条 |
| B 站 | 视频，投稿后要等 B 站审核 | 30 分钟 | 10 条 |
| 知乎 | 专栏文章（长文），正文里可以插图，最多 3 个话题 | 30 分钟 | 5 篇 |

间隔和条数只是建议，超了照样发；发得太密平台可能限流。社媒功能由社媒插件提供，新建项目时已经装好；页面顶部提示没装插件时，到 Annulo 的「设置 → 项目 → 插件」里装上 social。

## 账号概览

左侧「社交媒体」，第一个页签「账号概览」：

- 上面三个数字：账号、近 30 天新增粉丝、待处理账号（登录过期或者发布出了问题的）；
- **账号与发布状态**：每个账号的粉丝（旁边的箭头是近 30 天增减）、连接状态、最近发布，右边是要做的事：「查看数据」「修复发布」「重新登录」；
- **最近发布的表现**：最近发出去的 5 条和它们的浏览、点赞、评论，「看原帖」打开平台上的帖子。

![社交媒体 · 账号概览](https://fsu.creght.com/site/2103669300995821568/1792413761291__creator_help_social_v2.png)

右上角「管理账号」去「账号」，「创建内容」去「内容中心」新建一条。

## 数据表现

第二个页签「数据表现」，上面选账号和时间段（近 7 / 30 / 90 天）：

- 账号卡片：登录状态、粉丝、上次采集时间，「打开主页」「立即采集」；下面两行是上次发布、上次采集成没成（比如「发布正常 · 2 小时前」；成功了但有没做成的小事，比如话题没加上，会写「发布成功，1 项提醒」并逐条列出）；
- 这段时间发布了几条、新增粉丝和互动，每天的变化图（要采集过两天以上才画得出来）；
- 「帖子」列表：每条的各项数据，点表头按那一列排；可以只看这段时间发的，也可以看全部。点标题打开它出自的那条内容和发布记录。

Facebook 公共主页使用官方 API 连接时，近期帖子、数据表现和内容的发布记录可点「查看评论」，显示评论及回复的文字和发布时间，支持「刷新评论」与「加载更多评论」。只有 Facebook 返回的可见评论会显示，可能少于评论总数；读取失败会显示具体错误，不会显示成「暂无评论」。评论内容只在查看时读取，不写入项目数据库。

![社交媒体 · 数据表现：一个账号的粉丝和上次发布、采集情况](https://fsu.creght.com/site/2103669300995821568/1792413761953__creator_help_social_data_v2.png)

## 采集数据

每天自动采集一次粉丝和每条帖子的数据（Annulo 要开着），时间前后随机错开，免得太规律被平台当成脚本；想改频率在 设置 → 定时任务 里点「改时间」。在平台上直接发的帖子也会收进来。
要最新的：账号卡片上「立即采集」，或者「账号概览」里「全部重新采集」（一个一个账号来）；内容的发布记录里也有「更新数据」。采集要打开浏览器跑一会儿，太频繁可能被平台限流。

## 发布、采集失败了

平台改版后，发帖、采集的流程可能走不通。登录有没有过期，每天的自动采集会顺带检查。
- 走不通时，账号卡片上会说是哪一步，运营总览的「今日工作」会出现「社媒发布流程需要修复」。点「交给助手修」，助手照失败时的截图更新这个平台的发布脚本；
- 改完再真做一次：采集失败的点「立即采集」，发布失败的在那条内容的发布记录里点「重新发布」。成功了，失败的提示就消失；
- 一直显示「发布中」、其实没在跑（比如发到一半关了 Annulo）：点「标记为发布失败」再重新发。重新发布前会先去平台上找这一条，已经发出去的不会重发。

## 登录在别的电脑

账号是在另一台电脑上登录的，会显示「登录在别的电脑」，发布、采集由那台电脑做。要改在这台电脑做，点「在这台电脑登录」。`,
    en: `The Social media page is for accounts and numbers. Pieces are made and published in Content center (see "Content center"); scheduled posts show in the Publishing calendar.

## Supported platforms

Add accounts under "Accounts → Add account". A browser window opens; log in there. The login stays on this computer; a new computer needs a new login.

| Platform | What it posts | Suggested gap | Suggested daily max |
|---|---|---|---|
| X | Posts, up to 4 images or 1 video | None | 10 (in 24 hours) |
| LinkedIn | Posts on your personal profile, images or video | 60 minutes | 5 |
| Facebook | Posts on your profile or a Page you manage, images or video | 30 minutes | 10 |
| Instagram | Posts, images or video | 60 minutes | 5 |
| YouTube | Videos | 60 minutes | 3 |
| Xiaohongshu | Notes, images or video (a video can have its own cover) | 2 hours | 3 |
| Douyin | Videos (with their own cover if you like); Douyin reviews each one after posting | 30 minutes | 10 |
| Bilibili | Videos; Bilibili reviews each upload | 30 minutes | 10 |
| Zhihu | Column articles (long-form) with images in the text, up to 3 topics | 30 minutes | 5 |

The spacing and daily counts are only suggestions; posts still go out if you exceed them, but posting too often can get throttled. Social features come from the social plugin, installed with every new project. If a notice at the top says it's missing, install social in Annulo's Settings → Projects → Plugins.

## Accounts

Social media in the sidebar, first tab "Accounts":

- Three numbers at the top: Accounts, New followers (30 days), Accounts needing attention (login expired or publishing problems);
- **Accounts & publishing status**: each account's followers (the arrow is the 30-day change), connection, latest publication, and what to do on the right: "View data", "Fix publishing", "Sign in again";
- **Recent posts**: the last 5 posts with views, likes and comments; "View post" opens it on the platform.

![Social media · Accounts](https://fsu.creght.com/site/2103669300995821568/1792413761291__creator_help_social_v2.png)

At the top right, "Manage accounts" goes to Accounts and "Create content" starts a new piece in Content center.

## Performance

The second tab, "Performance". Pick an account and a period at the top (last 7 / 30 / 90 days):

- Account card: login status, followers, last collection, "Profile" and "Collect now". Below are two lines on whether the last publish and the last collection worked (like "Last publish OK · 2 hours ago"; when it worked but something minor didn't, like a hashtag that wasn't added, it says "Last publish OK, 1 note(s)" and lists them);
- Posts published in the period, new followers and engagement, and a daily chart (it needs at least two days of collection);
- "Posts" list: each post's numbers; click a column header to sort by it. Show only posts from the period, or all. Click a title to open the piece it came from and its publishing record.

For Facebook Pages connected through the official API, "View comments" is available in Recent posts, Performance and a piece's publishing records. The dialog shows comment and reply text with timestamps, plus "Refresh comments" and "Load more comments". Only comments made available by Facebook appear, which may be fewer than the total count. Read failures show an error instead of an empty state. Comments are fetched on demand and are not saved to the project database.

![Social media · Performance: one account's followers and its last publish and collection](https://fsu.creght.com/site/2103669300995821568/1792413761953__creator_help_social_data_v2.png)

## Collecting stats

Followers and every post's numbers are collected once a day (Annulo must be open), at a randomized time so the platforms don't take it for a script; to change how often, click "Reschedule" in Settings → Scheduled tasks. Posts you made directly on the platform are picked up too.
For the latest numbers: "Collect now" on the account card, "Collect all again" on the Accounts tab (one account at a time), or "Refresh data" in a piece's publishing records. Collecting runs a browser for a while; doing it too often can get you rate-limited.

## When publishing or collecting fails

When a platform changes its pages, posting or collecting can break. Whether the login has expired is checked by the daily automatic collection.
- When it fails, the card says which step, and "Social publishing needs repair" appears in Today's work on the overview. Click "Have the assistant fix it"; the assistant updates that platform's posting script from the failure screenshot;
- Then do it for real once more: "Collect now" for a failed collection, "Publish again" in the piece's publishing records for a failed post. Once it works, the failure notice goes away;
- Stuck on "Publishing" but nothing is running (say, Annulo was closed mid-post): click "Mark as failed" and publish again. A retry first looks for the post on the platform, so one that already went out isn't posted twice.

## Signed in on another computer

An account signed in on another computer shows "Logged in on another computer"; that computer does its publishing and collecting. To move it here, click "Log in on this computer".`,
  },
}

export const content: Article = {
  id: 'content',
  title: { zh: '内容中心：选题、内容、发布', en: 'Content center: topics, content, publishing' },
  summary: { zh: '一条内容的稿子、文案、脚本、图、视频都放在它里面；交给 AI 在里面做，发布时挑这次发什么、发到哪些账号。', en: 'Each piece holds its brief, copy, scripts, images and videos; AI works inside it, and when you publish you pick what goes out and to which accounts.' },
  body: {
    zh: `左侧「内容与发布 → 内容中心」，两个页签：「内容」和「选题」。

**每条内容里放着它自己的文件**：稿子、脚本、文案、视频、图，可以再分子文件夹（比如 A 版、B 版各一个）。你在页面上改，AI 在对话里改，改的是同一份文件。内容本身不分类型，到发布时才挑这次发成图文、视频还是长文。

## 选题

「选题」页签：
- **出一批选题**：先弹窗，可以写这一批的额外要求（只出某类主题、一次出几个），不填就照默认的要求出。助手按你的定位、已有选题和最近帖子的反响出一批，不和已有的重复；
- **手动添加**：自己写选题和切入点；
- 点选题标题或「编辑选题」，能补内容角度、关键词、读者是谁、读者想知道什么、大纲、发到哪些平台、还缺的素材；
- 「做成内容」：用这个选题新建一条内容（见下面），选题的标题和简报会写进稿子；
- 不想写的点「×」（放弃这个选题），放弃的在下面「已写成 / 已放弃的选题」里能「恢复」。

![内容中心 · 选题](https://fsu.creght.com/site/2103669300995821568/1791356478101__creator_help_content_topics.png)

## 新建一条内容

「内容」页签右上角「新建内容」，在「这条想做什么」里写主题、几个要点或一段草稿（第一行当名字），会存成这条内容的「稿子.md」。然后二选一：
- 「自己写」：建好就打开，直接在里面写；
- 「让 AI 做」：建好后交给助手照稿子做，要发的文字写进「文案.md」，要做的图、视频也放进这条内容。什么都没写时，助手从选题里挑一个现在最值得做的。

怎么写（结构、语气、长度）照「写作要求」，在页面右上角「更多 → 写作要求」里改。助手只用「我的定位」里写了的个人经历，不编数据和案例。
在 Notion 里写好的：在「这条想做什么」里只粘那篇 Notion 页面的链接，点「从 Notion 导入」（要先在 Annulo 的 设置 → MCP 里连上 Notion）。

## 内容页

点开一条，从上到下是：名字（双击改名）、文件、发布记录。顶上一排：返回、状态、「交给 AI」「发布」「更多」（复制引用、改写要求、删除这条）。

状态默认按发布记录自动判断（「自动（已发布）」），点它可以手动标成「草稿」或「已发布」，或者「恢复自动更新」。

![内容页：文件默认是网格，下面是发布记录](https://fsu.creght.com/site/2103669300995821568/1792413750753__creator_help_content_folder.png)

## 文件

- **网格**（默认）：所有文件铺在一起，「稿子.md」排第一，其余最近改的在前；图片、视频显示缩略图，名字下面写着大小和在哪个子文件夹。只有一个文件时直接打开它；
- **树**：右上角切换。左边是目录，右边看、改文件，宽屏下是固定高度的两栏，各自滚动。默认打开你上次在这条里看的文件，没有就打开最近改的，再没有就打开稿子。网格还是树记在这台电脑上；
- 「新建文件」（树里还有「新建文件夹」）：点了弹出一个小框填名字，比如「文案.md」「A 版/脚本.md」；
- 点开一个文件：.md 默认用富文本改，可以切到「源码」，改完点「保存」（⌘S / Ctrl+S 也行）。文案开头 \`---\` 包住的那几行（标题、话题）显示成灰色一块，在「源码」里改。图片、视频直接预览；
- 文件名双击改名。右边三个图标：用系统程序打开、在文件夹中显示、删除（点一下变成「挪进废纸篓？」，再点才删）。在网格或树里右键一个文件也有这些操作；
- 「打开文件夹」在电脑上打开整个文件夹，用别的软件改也行。AI 在对话里改了文件，这里几秒内自动刷新；你正在改的文件被别处改了，会问你「载入新版本（丢掉我的修改）」还是「接着改（保存时覆盖）」。

![树状视图：左边目录，右边改文案](https://fsu.creght.com/site/2103669300995821568/1792413757815__creator_help_content_tree.png)

## 交给 AI

顶上「交给 AI」，两种做法：
- **在这篇上做**：写文案、改文案、写脚本、做图、做视频……做出来的都放进这条的文件夹。在「要求」里写要做什么、做成什么样，点「开始」；
- **另写一篇**：选「做成」长文、图文笔记或视频，写这次的要求（选填），点「AI 改写成…」另写一条新的，原文不动。「转换」不经过 AI，只换格式另存一条。

常用的要求存成「AI 预设」：模板自带几条（比如「照稿子写正文」「做视频」），点一下就填进要求；写好的要求点「存为预设」，改、删、新建在「管理预设」里。

![交给 AI：在这篇上做](https://fsu.creght.com/site/2103669300995821568/1792413758575__creator_help_content_ai.png)

交出去后，右侧开一段新对话，文件夹上方出现「AI 正在这条内容上做」，下面一行是这次的要求，点「查看对话」看它每一步。做好的文件出现在文件夹里。
**要改就回到做它的那段对话里直接说**（「第 2 段短一点」「封面字大一点」），右侧的对话历史里找得到；也可以点「更多 → 复制引用」，贴进新对话里说。改文案时的写法照「更多 → 改写要求」。

## 发布

点「发布」，在弹窗里挑这次发什么：
- **发成**：图文、视频或长文。打开时按文件夹里有什么先选好（有视频选视频，有图选图文，不然长文）；
- **从文件填入**：点一份 .md，把它的标题、话题、正文填进下面。名字带「文案」或开头写了标题（\`title:\`）的排在前面、默认用它，比如「B站文案.md」；分镜、脚本这类收在「更多」里。填进来的标题、正文（视频是简介）、话题都能当场改，只改这次发的，不改文件；
- **配图 / 视频**：图文挑一组图（第一张是封面），视频挑一个视频。文件夹里的直接点，也能「上传」或「从资料库选」，上传的会复制进这条的文件夹。名字带「成片」的视频默认选上；视频卡片上点播放按钮先看一遍；
- **视频封面**（小红书、抖音用）：默认用文件夹里名字带「封面」的图，可以另点一张、上传、从资料库选，或者选「平台默认」。

![发布：挑发成什么、从文件填入文案、选视频](https://fsu.creght.com/site/2103669300995821568/1792413759249__creator_help_content_publish.png)

- **发到哪些账号**：账号名后面有平台标签；发不了的灰掉并写原因（比如「这个平台不发视频」「登录过期了，先重新登录」）；这条已经发过、排过期的写着「这篇已发过 · 时间」「这篇已排期 · 时间」，免得重复发；正文超过平台字数上限也会提示；
- 右下角「发布到 N 个账号」马上发，进度在发布记录和右下角看；要定时，先点左下角的日历图标选时间，按钮变成「排期到 N 个账号」，到点由 Annulo 发（Annulo 要开着）。

![发布：视频封面和选账号](https://fsu.creght.com/site/2103669300995821568/1792413759958__creator_help_content_publish_accounts.png)

同一条内容可以发好几次，每次挑不同的文件，比如横版成片发 B 站、竖版成片发抖音。发出去的是当时挑好的内容，之后再改文件，不影响已经发出去的和已经排好的。

## 发布记录

内容页最下面，每发到一个账号一条：账号和平台、时间、这次发的是什么（第一张图或视频、标题），阅读、点赞、评论、收藏、分享，「查看已发布内容」打开平台上的帖子，「更新数据」马上重新采集这个账号。

![发布记录：每次发的内容和互动数据](https://fsu.creght.com/site/2103669300995821568/1792413760672__creator_help_content_records.png)

- 发布失败的写着原因，改好后「重新发布」（会先去平台上找这一条，已经发出去的不会重复发）；
- 一直显示「发布中」：点「标记为发布失败」再重新发；
- 排了期的能改时间、「立即发布」或取消排期；
- 已发布的点右边的删除图标，二选一：「从小红书删除」这类（把平台上的帖子删掉，记录留着），或「只删记录」（平台上的不动，已经手动删过、或者重复记了两条时用）。没发出去的直接「删除记录」；
- 点账号名去「社交媒体 → 数据表现」看这个账号。

## 内容列表

「内容」页签能搜标题和内容，按「草稿」「已发布」筛。AI 做好、还没打开看过的标着「新」，左侧「内容中心」后面是它们的数量。发出去的后面列着发到了哪些账号，点一个打开那条、定位到那条发布记录。
每行右边的「⋯」：复制引用、改写（打开「交给 AI」）、复制、删除这篇；状态也能在右边直接改。已经发出去或排了期的不能删，先在发布记录里处理。

![内容列表](https://fsu.creght.com/site/2103669300995821568/1792413757129__creator_help_content_list.png)`,
    en: `Content & publishing → Content center in the sidebar, with two tabs: "Content" and "Topics".

**Each piece holds its own files**: the brief, scripts, copy, videos and images, and you can add subfolders (say, one for version A and one for version B). You edit them on the page and AI edits them in the chat; it's the same set of files. A piece has no type of its own: you choose whether it goes out as an image post, a video or an article when you publish.

## Topics

The "Topics" tab:
- **Suggest topics**: first opens a dialog where you can add requirements for this batch only (only certain kinds, how many at a time); leave it empty to follow the defaults. The assistant suggests a batch from your profile, your existing topics and how recent posts did, without repeating what you have;
- **Add manually**: write a topic and an angle yourself;
- Click a topic title or "Edit topic" to add the angle, keywords, who it's for, what readers want to know, outline, platforms and missing material;
- "Turn into a piece": starts a new piece from this topic (see below); the topic's title and brief go into its brief;
- Click "×" (Drop this topic) for ones you won't write; dropped ones are under "written / dropped topics" below, where you can "Restore" them.

![Content center · Topics](https://fsu.creght.com/site/2103669300995821568/1791356478101__creator_help_content_topics.png)

## Starting a piece

Click "New content" at the top right of the Content tab and put a subject, a few points or a rough draft in "What to write" (the first line becomes its name). It's saved as the piece's brief.md. Then choose:
- "Write it myself": creates the piece and opens it, ready for you to work in;
- "Let AI make it": creates the piece and hands it to the assistant, which works from the brief, writes the text to post into copy.md and puts any images or videos in the piece too. With nothing filled in, it picks the topic most worth doing now.

How it's written (structure, tone, length) follows your writing instructions; change them under "More → Writing instructions" at the top right. The assistant only uses personal stories you wrote in My profile and doesn't make up data or cases.
Written in Notion? Paste just the Notion page link into "What to write" and click "Import from Notion" (connect Notion first in Annulo, Settings → MCP).

## The piece page

Open a piece. From top to bottom: its name (double-click to rename), its files, and the publishing records. The bar at the top has back, the status, "Ask AI", "Publish" and "More" (Copy reference, Revision instructions, Delete).

The status follows the publishing records by default ("Auto (Published)"). Click it to mark the piece as Draft or Published yourself, or "Restore automatic status".

![A piece: files in grid view, with publishing records below](https://fsu.creght.com/site/2103669300995821568/1792413750753__creator_help_content_folder.png)

## Files

- **Grid** (the default): every file side by side, brief.md first and the rest newest first. Images and videos show thumbnails; under each name are its size and the subfolder it's in. With only one file, it opens straight away;
- **Tree**: switch at the top right. Folders on the left, the open file on the right; on a wide screen it's two fixed-height panes that scroll on their own. It opens the file you last looked at in this piece, or else the newest one, or else the brief. Grid or tree is remembered on this computer;
- "New file" (and "New folder" in the tree): a small box pops up for the name, like copy.md or version A/script.md;
- Open a file: .md files open in rich text, with "Source" to see the raw text; click "Save" when done (⌘S / Ctrl+S works too). The lines between \`---\` at the top of a copy file (title, tags) show as a grey block; edit them in Source. Images and videos show a preview;
- Double-click a file name to rename it. The three icons on the right are Open in app, Show in folder and Delete (the first click turns it into "Move to trash?", the second deletes). Right-click a file in the grid or tree for the same actions;
- "Open folder" opens the whole folder on your computer, so other apps can edit it too. When AI changes a file in the chat, the page picks it up within seconds; if a file you're editing changes elsewhere, you're asked to "Load new version (discard mine)" or "Keep editing (overwrite on save)".

![Tree view: folders on the left, editing the copy on the right](https://fsu.creght.com/site/2103669300995821568/1792413757815__creator_help_content_tree.png)

## Ask AI

"Ask AI" at the top, two ways:
- **Work on this**: write or revise the copy, write a script, make images, make a video… whatever it makes goes into this piece's folder. Say what to make and how under "Instructions", then click "Start";
- **Write a new one**: pick what to "Make it into" (long-form, image post or video), add instructions if you like, and click "AI rewrite into…" to get a new piece; the original stays as it is. "Convert" skips AI and only changes the format, saved as a new piece.

Save instructions you use often as "AI presets": a few come with the template (like "Write from the draft" and "Make the video"), and one click fills them in. Click "Save as preset" to keep your own; edit, delete or add them under "Manage presets".

![Ask AI: Work on this](https://fsu.creght.com/site/2103669300995821568/1792413758575__creator_help_content_ai.png)

Once started, a new chat opens on the right and "AI is working on this" appears above the folder, with this run's instructions below it; "View chat" shows each step. Finished files show up in the folder.
**To change something, say it in the chat that made it** ("make paragraph 2 shorter", "bigger text on the cover"); you'll find it in the chat history on the right. Or use "More → Copy reference" and paste it into a new chat. Revisions to copy follow "More → Revision instructions".

## Publishing

Click "Publish" and pick what goes out this time:
- **Publish as**: image post, video or article. It starts with a guess from what's in the folder (video if there's a video, image post if there are images, otherwise article);
- **Fill from file**: click a .md file to fill the title, tags and text below from it. Files with "copy" in the name or a \`title:\` line at the top come first and are used by default; scripts and storyboards are under "More". You can edit the title, text (the description for videos) and tags right there; that only changes this post, not the file;
- **Images / Video**: an image post takes a set of images (the first is the cover), a video post takes one video. Click files from the folder, or use "Upload" or "From library"; uploads are copied into this piece's folder. A video with "final" in the name is selected by default; click the play button on a video card to watch it first;
- **Video cover** (used by Xiaohongshu and Douyin): defaults to an image in the folder with "cover" in the name. Click another one, upload one, pick from the library, or choose "Platform default".

![Publish: what to publish as, copy filled from a file, the video](https://fsu.creght.com/site/2103669300995821568/1792413759249__creator_help_content_publish.png)

- **Accounts**: each name has a platform tag. Accounts that can't take it are greyed out with the reason (like "This platform doesn't take Video" or "Login expired; log in again first"). Accounts this piece already went to, or is scheduled for, say "Already posted · time" or "Already scheduled · time" so you don't post it twice. You're also warned when the text is over a platform's limit;
- "Publish to N accounts" at the bottom right posts now; follow progress in the publishing records and at the bottom right. To schedule, first pick a time with the calendar icon at the bottom left; the button becomes "Schedule to N accounts", and Annulo posts it on time (Annulo must be open).

![Publish: the video cover and the accounts](https://fsu.creght.com/site/2103669300995821568/1792413759958__creator_help_content_publish_accounts.png)

You can publish one piece several times with different files, like the landscape cut to Bilibili and the portrait cut to Douyin. What goes out is what you picked at that moment; editing the files later doesn't change what's already posted or scheduled.

## Publishing records

At the bottom of the piece, one row per account it went to: the account and platform, the time, what went out (the first image or the video, and the title), views, likes, comments, saves and shares. "View published content" opens the post on the platform, and "Refresh data" collects that account again right away.

![Publishing records: what each post used and how it did](https://fsu.creght.com/site/2103669300995821568/1792413760672__creator_help_content_records.png)

- Failed posts show the reason; fix it and "Publish again" (a retry first looks for the post on the platform, so one that already went out isn't posted twice);
- Stuck on "Publishing": click "Mark as failed", then publish again;
- Scheduled ones can be moved, published now, or unscheduled;
- For a published one, click the delete icon on the right and choose "Delete from Xiaohongshu" (or whichever platform: removes the post there and keeps the record) or "Delete record only" (leaves the platform alone; for posts already deleted there, or duplicate records). Ones that didn't go out just have "Delete record";
- Click the account name to see that account in Social media → Performance.

## The list

The "Content" tab lets you search titles and text, and filter by "Draft" and "Published". Pieces AI finished that you haven't opened yet are marked "New", and the number next to Content center in the sidebar counts them. Published pieces list the accounts they went to; click one to open the piece at that publishing record.
The "⋯" on each row has Copy reference, Rewrite (opens Ask AI), Duplicate and Delete; you can change the status on the right too. Pieces that have been posted or scheduled can't be deleted; handle them under the publishing records first.

![The list](https://fsu.creght.com/site/2103669300995821568/1792413757129__creator_help_content_list.png)`,
  },
}

export const calendar: Article = {
  id: 'calendar',
  title: { zh: '发布日历与资料库', en: 'Publishing calendar and library' },
  summary: { zh: '按天看所有排期和发布、拖动改排期；几条内容都会用到的图片、视频和常用文字放资料库。', en: 'See every scheduled and published post by day and drag to reschedule; keep images, videos and text you reuse across pieces in the library.' },
  body: {
    zh: `## 发布日历

左侧「内容与发布 → 发布日历」，按「周」或「月」看各账号的已排期、发布中、已发布、发布失败、已删除的帖子。

![发布日历：月视图](https://fsu.creght.com/site/2103669300995821568/1791357359958__creator_help_calendar_v2.png)

- 点一条打开它出自的那条内容；
- 已排期的帖子可以拖到别的日子，时间不变；不能拖到过去；
- 上面列着还没排期的帖子（如果有），拖到某一天就排上（默认 10:00）；
- 到点由 Annulo 发布（Annulo 要开着）。

## 资料库

左侧「知识库 → 资料库」，放几条内容都会用到的图片、视频和常用文字（头像、片头、常用的开头和金句）。一条内容自己的图和视频放在它的文件夹里，不用进资料库。发布时配图、选视频、选视频封面，或者在文件夹的编辑器里插图，都能「从资料库选」。

![资料库](https://fsu.creght.com/site/2103669300995821568/1791356473061__creator_help_assets.png)

- 「上传」：选图片或视频，单个最多 200 MB，能多选，也能直接拖进页面；
- 「添加资料」：贴图片或视频地址（一行一个，要公开能打开的 https 地址，发布到社媒时平台要下载得到），或者存一段文字（常用的开头、金句、个人经历片段）；
- 按「全部 / 图片 / 视频 / 文字」筛，按名称、标签、内容搜；
- 每一项能复制地址或文字、改名称和标签、删除。删除不影响已经发出去的内容；
- 助手存进来的资料标着「助手」。`,
    en: `## Publishing calendar

Content & publishing → Publishing calendar in the sidebar, by "Week" or "Month": every account's scheduled, publishing, published, failed and deleted posts.

![Publishing calendar: month view](https://fsu.creght.com/site/2103669300995821568/1791357359958__creator_help_calendar_v2.png)

- Click an item to open the piece it came from;
- Drag a scheduled post to another day; the time stays the same. You can't drag into the past;
- Posts that aren't scheduled yet (if any) are listed at the top; drag one onto a day to schedule it (10:00 by default);
- Annulo publishes on time (Annulo must be open).

## Library

Knowledge → Library in the sidebar keeps images, videos and reusable text that several pieces use (an avatar, an intro clip, openers and quotes you reuse). A piece's own images and videos belong in its folder, not here. When you publish (images, video, video cover) or insert an image in the folder's editor, "From library" picks from here.

![Library](https://fsu.creght.com/site/2103669300995821568/1791356473061__creator_help_assets.png)

- "Upload": pick images or videos, up to 200 MB each, several at once, or drop them onto the page;
- "Add resource": paste image or video URLs (one per line; they must be public https URLs, since platforms download them when posting), or save a piece of text (openers, quotes, personal stories you reuse);
- Filter by All / Images / Videos / Text, and search names, tags and content;
- Each item can be copied (URL or text), renamed and retagged, or deleted. Deleting doesn't affect content that's already out;
- Items the assistant saved are marked "Assistant".`,
  },
}

export const company: Article = {
  id: 'company',
  title: { zh: '我的定位', en: 'My profile' },
  summary: { zh: '写什么、写给谁、什么风格：出选题、做内容、写每周总结，助手都照这里来。', en: 'What you write, who for, in what voice: the assistant follows this for topics, content and the weekly summary.' },
  body: {
    zh: `左侧「知识库 → 我的定位」。助手出选题、写文案和脚本、写每周总结前都先读它，写出来要像你写的。起步向导里填的也存在这里。

![我的定位](https://fsu.creght.com/site/2103669300995821568/1791357360610__creator_help_company_v2.png)

分四块：
- **概况**：名字或账号名、一句话定位、主要写什么、关于我。「关于我」写你的经历、身份、为什么值得听：**内容里的个人经历只从这里取，不会编**；
- **专长**：专长和经历、能提供什么（比如接什么合作）；
- **读者**：写给谁、平台和语言、读者最关心的问题；
- **风格**：说话风格、常写的话题（逗号分隔）、不写什么。「不写什么」里的话题和说法，助手不会碰。

改完点页面底部的「保存」，下一次出选题、做内容就按新的来。`,
    en: `Knowledge → My profile in the sidebar. The assistant reads it before suggesting topics, writing copy and scripts, or writing the weekly summary, so the result sounds like you. What you entered in the setup wizard is stored here too.

![My profile](https://fsu.creght.com/site/2103669300995821568/1791357360610__creator_help_company_v2.png)

Four sections:
- **Overview**: Name or handle, One-line positioning, What you write about, About me. "About me" is your background, who you are and why people should listen: **personal stories in your content only come from here; nothing is made up**;
- **Expertise**: Expertise and track record, What you offer (for example, the collaborations you take on);
- **Audience**: Who you write for, Platforms and languages, What your readers care about most;
- **Voice**: Voice, Topics you cover (comma-separated), Avoid. The assistant stays away from topics and phrasing listed under "Avoid".

Click "Save" at the bottom of the page; the next topics and content follow the new version.`,
  },
}

export const channels: Article = {
  id: 'channels',
  title: { zh: '账号', en: 'Accounts' },
  summary: { zh: '添加和移除社媒账号、登录、看上次发布和采集成没成；登录状态只在这台电脑上。', en: 'Add and remove social accounts, log in, and see whether the last publish and collection worked; logins stay on this computer.' },
  body: {
    zh: `左侧下方的「账号」：连接你要运营的社媒账号。添加、登录、处理发布和采集的失败都在这里，数据在「社交媒体」里看。

![账号](https://fsu.creght.com/site/2103669300995821568/1792413762563__creator_help_channels_v2.png)

上面每个账号一张小卡片，带平台和状态（已连接、登录过期、发布失败、登录在别的电脑……），点一张在下面看详情。

## 添加

「添加账号」，选平台：X、LinkedIn、Facebook、Instagram、YouTube、小红书、抖音、B 站、知乎。点「登录…」会弹出一个浏览器窗口，在里面登录（抖音、B 站、知乎用 App 扫码），登录好了账号就加上了。
- 登录状态只存在这台电脑上，不上传；
- LinkedIn 先支持个人账号；Facebook 个人主页和你管理的公司主页都能加。

## 账号详情

- 登录状态、上次采集时间；
- 「打开主页」：用这个账号自己的浏览器打开它在平台上的主页；
- 「立即采集」：现在采集一次粉丝和帖子数据（登录正常时才有）；
- 「重新登录」：登录过期、换了电脑、清了浏览器数据时用；账号登录在别的电脑上时是「在这台电脑登录」；
- 「看数据」：去「社交媒体 → 数据表现」；
- 下面两行写着上次发布、上次采集成没成（「发布正常 · 2 小时前」「采集失败 · 昨天」……）。失败了会写是哪一步、给出处理的按钮，见「社交媒体」一篇。

账号已经加上、但这个平台在项目里还没接入的，会显示「未接入」，点「让助手接入 …」（后面是平台名）交给助手把这个平台接进来。

## 移除

「移除」，再「确认移除」。只是不再在这里运营它，账号本身不受影响，之后还能再添加回来。`,
    en: `"Accounts" at the bottom of the sidebar connects the social accounts you run. Adding, logging in and fixing failed posts or collections happen here; the numbers are under Social media.

![Accounts](https://fsu.creght.com/site/2103669300995821568/1792413762563__creator_help_channels_v2.png)

Each account has a small card at the top with its platform and status (Connected, Login expired, Failed, Logged in on another computer…). Click one to see its details below.

## Adding

"Add account", then pick a platform: X, LinkedIn, Facebook, Instagram, YouTube, Xiaohongshu, Douyin, Bilibili, Zhihu. Click "Log in to …" and a browser window opens; log in there (Douyin, Bilibili and Zhihu use a QR code in their app), and the account is added.
- The login stays on this computer and isn't uploaded;
- LinkedIn supports personal profiles for now; on Facebook you can add your profile and the Pages you manage.

## Account details

- Login status and last collection;
- "Profile": opens the account's page on the platform in its own browser;
- "Collect now": collects followers and post numbers now (shown while the login is fine);
- "Sign in again": when the login expired, or after switching computers or clearing browser data. For an account logged in on another computer it says "Log in on this computer";
- "View data": goes to Social media → Performance;
- Two lines below say whether the last publish and the last collection worked ("Last publish OK · 2 hours ago", "Last collection failed · yesterday"…). A failure says which step broke and gives you a button to deal with it; see "Social media".

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
    zh: `Annulo 右侧的运营助手看得到这个项目的数据、账号、内容文件夹和后台代码，能动手做事。

![Annulo 窗口：右侧助手在回答数据问题](https://fsu.creght.com/site/2103669300995821568/1791356473851__creator_help_assistant.png)

## 能做什么

- 回答数据问题：「最近 30 天哪条帖子表现最好」「小红书这个月涨了多少粉」，需要时画成图；
- 出选题，在一条内容的文件夹里写文案、改文案、写脚本、做图、做视频；
- 改后台本身：「在运营总览加一张每日粉丝趋势图」「加一个字段」，见下面；
- 写每周总结，解释某个数字是怎么算的。

## 按钮和助手

后台很多按钮是直接执行的（采集、发布），不经过助手。
要 AI 读东西、想东西的按钮（出一批选题、新建内容里的「让 AI 做」、交给 AI、立即写本周总结、交给助手修…）会新开一段对话在后台跑，在右侧能看到；页面上出现「进行中」的提示，点「查看对话」打开那段对话，跑完页面自动刷新。这类按钮旁边常有「AI 要求」（或「写作要求」「改写要求」），里面是它每次都照着做的写法，可以改，改坏了能「恢复默认」。
AI 做出来的东西要改，回到做它的那段对话里接着说，不用新开。

## 不会替你做的

- 不会替你发布：发不发、发到哪些账号，由你在「发布」里定；
- 不会从平台上删除内容，除非你明确要求；
- 不会编你的经历：内容里的个人经历只取自「我的定位」；
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

在 Annulo「设置 → 远程访问」里打开「在手机上打开这台电脑的 Annulo」（要开通 creght 的远程访问）。之后在手机或别的电脑的浏览器里，用的就是电脑上的 Annulo：后台、右侧的助手、发布和采集都和电脑上一样，离线项目也能用。
- 地址和二维码在「设置 → 远程访问」的「在浏览器中打开」里，用 creght 账号登录；新设备第一次打开，要在电脑上点「允许」；
- 手机上后台和助手分成两页，在底部切换；左上角 Annulo 菜单里能「添加到桌面」；
- 电脑和 Annulo 要开着。详细说明见官网帮助 [连接 creght：云端和手机](https://annulo.dev/help/creght)。`,
    en: `The assistant on the right of Annulo sees this project's data, accounts, content folders and back-office code, and it can act on them.

![The Annulo window with the assistant answering a data question](https://fsu.creght.com/site/2103669300995821568/1791356473851__creator_help_assistant.png)

## What it does

- Answers questions about your data: "which post did best in the last 30 days?", "how many Xiaohongshu followers did I gain this month?", with a chart when useful;
- Suggests topics, and in a piece's folder writes and revises copy, writes scripts, and makes images and videos;
- Changes the back office itself: "add a daily followers chart to the overview", "add a field" (see below);
- Writes the weekly summary and explains how a number is calculated.

## Buttons and the assistant

Many buttons run directly (collecting, publishing) without the assistant.
Buttons that need AI to read or think (Suggest topics, "Let AI make it" in New content, Ask AI, Write this week's summary, Have the assistant fix it…) open a new chat that runs in the background, visible on the right. An "In progress" notice appears on the page; "View chat" opens that chat, and the page refreshes when it's done. These buttons often have "AI instructions" (or "Writing instructions", "Revision instructions") next to them: the rules it follows every time. You can edit them, and "Restore default" undoes your edits.
To change something AI made, keep talking in the chat that made it instead of starting a new one.

## What it won't do for you

- Publish for you: whether something goes out, and to which accounts, is your call in "Publish";
- Delete content from a platform unless you explicitly ask;
- Make up your experience: personal stories in your content only come from My profile;
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

In Annulo's Settings → Remote access, turn on "Open this computer's Annulo on your phone" (needs a creght remote access subscription). From then on, a browser on your phone or another computer runs the Annulo on your computer: the back office, the assistant on the right, publishing and collecting all work just like there, offline projects included.
- The addresses and QR codes are under "Open in a browser" in Settings → Remote access; sign in with your creght account. The first time a new device opens it, click "Allow" on the computer;
- On a phone, the back office and the assistant are two pages with a switcher at the bottom; "Add to desktop" is in the Annulo menu at the top left;
- Your computer and Annulo need to be running. Details are in the site help, [Connect creght: cloud and phone](https://annulo.dev/help/creght).`,
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

出选题、交给 AI 做内容、写每周总结，都用这里选的模型。做图、做视频要用的工具，助手会在对话里说用了什么、装了什么。

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
| 采集社媒数据 | 各平台每天一次（时间随机错开） |

没有某个平台的账号时，那个平台的任务什么都不做。**只在 Annulo 开着的时候跑**，关机或退出期间错过的，下次打开时补跑一次。

## 模板升级

「设置 → 项目」里当前项目的模板卡片：有新版本时显示「升级到 vN」和每一版改了什么。

![Annulo 设置 → 项目：模板和插件卡片](https://fsu.creght.com/site/2103669300995821568/1791356481002__creator_help_settings_project.png)

- 升级会把模板的改动合进这个项目，你自己改过的地方保留；两边改了同一处的，点「交给助手解决」；
- 你改过的「AI 要求」存在项目的 \`user/\` 目录里，升级不会覆盖；
- 卡片提示先更新 Annulo 时，说明这一版模板用到了新版 Annulo 的能力，先更新 Annulo 再升级；
- 改坏了模板自带的文件，可以「恢复模板文件」，勾选要恢复的文件；
- 内容文件夹（稿子、文案、视频这些）在项目的工作目录里，模板升级不会动它们。`,
    en: `Settings live in Annulo, not in the back-office pages: "Annulo settings" at the bottom left of the back office opens them, and "Usage" shows how many tokens the models used. Annulo's own help ("Settings at a glance" on the Annulo website) covers every item; this article covers only what Creator studio uses.

## Models

Settings → Models offers three kinds, and you can switch anytime at the bottom of the chat box:
- **Your own provider**: pick a provider, enter an API key and tick the models to use. The key stays on this computer;
- **Local agent**: Claude Code / Codex installed on this computer;
- **creght platform models**: available when creght is connected, billed in AI credits.

Suggesting topics, Ask AI on your pieces and the weekly summary all use the model chosen here. For images and videos, the assistant tells you in the chat which tools it used or installed.

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
| Collect social stats | Once a day per platform (randomized time) |

A platform's tasks do nothing when you have no account on it. **They only run while Annulo is open**; anything missed while the computer was off or Annulo was closed runs once when you open it again.

## Template upgrades

In Settings → Projects, the current project's template card shows "Upgrade to vN" and what changed in each version.

![Annulo Settings → Projects: the template and plugin cards](https://fsu.creght.com/site/2103669300995821568/1791356481002__creator_help_settings_project.png)

- Upgrading merges the template's changes into your project and keeps your own edits; where both sides changed the same spot, click "Ask the assistant to resolve";
- Your edited "AI instructions" live in the project's \`user/\` folder; upgrades don't overwrite them;
- If the card says to update Annulo first, this template version needs a newer Annulo. Update Annulo, then upgrade;
- If you broke a file that came with the template, use "Restore template files" and tick the ones to restore;
- Content folders (briefs, copy, videos and so on) live in the project's work folder; template upgrades don't touch them.`,
  },
}

export const faq: Article = {
  id: 'faq',
  title: { zh: '常见问题与排错', en: 'FAQ and troubleshooting' },
  summary: { zh: '定时任务没跑、登录过期、发布失败、文案没被选上、数字对不上、升级冲突……', en: "Tasks that didn't run, expired logins, failed posts, copy that isn't picked, numbers that look wrong, upgrade conflicts…" },
  body: {
    zh: `## 定时任务没跑

定时任务只在 Annulo 开着的时候跑。关机或退出 Annulo 期间错过的，下次打开时补跑一次（不会把错过的每一次都补上）。
在 Annulo 的「设置 → 定时任务」里能看每个任务上次的结果和报错，也能「立即运行」。被暂停的任务不会跑。

## 社媒提示登录过期

到「社交媒体」或「账号」点那个账号的「重新登录」。登录状态只存在这台电脑上，换电脑、清了浏览器数据都要重新登录。
X 登录后一直跳验证的，可以让助手看一下（X 可能识别了自动打开的浏览器）。

## 发布失败

- 看内容页下面「发布记录」里的报错，改好后「重新发布」。重新发布前会先去平台上找这一条，已经发出去的不会重发；
- 一直显示「发布中」：点「标记为发布失败」再重新发；
- 报「页面可能改了」，或者运营总览出现「社媒发布流程需要修复」：平台改版了，点「交给助手修」，改完点那条内容的「重新发布」；
- X 报「内容重复」：X 不让发和之前一样的内容，改一下正文再发；
- 抖音、B 站发出去后还要等平台审核，审核期间平台上可能暂时看不到。

## 发布时没选上我想要的文案、视频

- 文案：名字带「文案」或开头写了 \`title:\` 的 .md 排在前面、默认用它；别的 .md 在「更多」里，点一下就填进来。想让哪份默认被选上，就照这个起名；
- 视频：名字带「成片」的默认选上；
- 挑好的只管这一次，文件本身不动。

## AI 做的文件没出现

文件夹每隔几秒自动刷新，也可以点文件夹右上角的刷新图标。AI 还在做的时候，文件夹上方有「AI 正在这条内容上做」，点「查看对话」看它做到哪了。

## 左侧后台空白或报错

顶部出现报错时点「交给助手修复」。如果是别人正在改后台引起的，助手会先问你。
运营后台要在 Annulo 里打开；在手机上打开要用 creght 账号登录，见「运营助手」一篇。

## 数字对不上 / 显示 0

- 社媒数据每天采集一次，要最新的点「立即采集」「全部重新采集」，或者发布记录里的「更新数据」；
- 每天的变化要采集过两天以上才有，刚加的账号先只显示累计值；
- 各平台的浏览、点赞口径不同（比如 LinkedIn 是展示、YouTube 是播放），不要加在一起比。

## 模板升级有冲突

升级时两边改了同一处，模板卡片会提示上次升级有冲突，点「交给助手解决」：它保留你自己的改动，同时把模板的新改动合进来。

## 改坏了想回到之前

后台的每次改动都记在项目的 git 里。跟助手说「回滚刚才的改动」或者「回到昨天的版本」。内容文件夹里的文件删了是进废纸篓，能从废纸篓里找回来。`,
    en: `## A scheduled task didn't run

Schedules only run while Annulo is open. Anything missed while your computer was off or Annulo was closed runs once when you open it again (not once per missed run).
Annulo's Settings → Schedules shows each task's last result and error, and has "Run now". Paused tasks don't run.

## A social account says the login expired

On Social media or Accounts, click "Sign in again" on that account. Logins live only on this computer; a new computer or cleared browser data means logging in again.
If X keeps asking for verification after you log in, ask the assistant to take a look (X may have spotted the automated browser).

## Posting failed

- Read the error in the publishing records at the bottom of the piece, fix it and "Publish again". A retry first looks for the post on the platform, so one that already went out isn't posted twice;
- Stuck on "Publishing": click "Mark as failed", then publish again;
- "The page may have changed", or "Social publishing needs repair" on the overview: the platform changed. Click "Have the assistant fix it", then "Publish again" on that piece;
- X says "duplicate content": X won't accept the same text twice; tweak it and post again;
- Douyin and Bilibili review videos after posting; the video may not be visible on the platform until that's done.

## Publish didn't pick the copy or video I wanted

- Copy: .md files with "copy" in the name or a \`title:\` line at the top come first and are used by default; the other .md files are under "More", and one click fills one in. Name a file that way to have it picked by default;
- Video: one with "final" in the name is selected by default;
- What you pick only applies to this post; the files themselves don't change.

## Files AI made don't show up

The folder refreshes itself every few seconds; you can also click the refresh icon at the top right of the folder. While AI is still working, "AI is working on this" shows above the folder; click "View chat" to see how far it got.

## The back office is blank or shows an error

When an error appears at the top, click "Ask the assistant to fix". If someone else's in-progress change caused it, the assistant asks you first.
The back office needs to be opened in Annulo; on a phone, sign in with your creght account (see "The assistant").

## Numbers look wrong or show 0

- Social stats are collected once a day; click "Collect now", "Collect all again" or "Refresh data" in the publishing records for the latest;
- Daily changes need at least two days of collection; a newly added account shows totals only at first;
- Platforms count differently (LinkedIn counts impressions, YouTube counts plays, for example), so don't add them up.

## A template upgrade had conflicts

When both sides changed the same spot, the template card says the last upgrade has conflicts. Click "Ask the assistant to resolve": it keeps your changes and merges in the template's.

## I broke something and want it back

Every back-office change is in the project's git history. Tell the assistant "roll back that change" or "go back to yesterday's version". Files deleted from a content folder go to the trash, so you can get them back from there.`,
  },
}
