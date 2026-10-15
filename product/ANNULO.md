# 产品运营助手

一个项目运营一个产品或品牌。围绕“产品事实 → 用户场景 → 增长机会 → 运营主题 → 内容与分发 → 转化复盘”工作，网站 SEO、小红书、抖音和 X 共用真实产品资料。默认不填演示数据。Creght 可以作为运营对象，模板也适用于其他产品。

新项目先在向导里选择网站，再按 tasks/product-onboarding.md 整理产品与用户；解析只保存候选，用户确认后才写入资料。换网站时保留旧资料并拒绝旧任务写回。

先读 ops-backend，再按业务读 product-growth、product-seo、websites 或插件 PLUGIN.md。确定的操作用本机函数，研究、写作和复盘交给 tasks；用户写法在 prompts，定制在 user/prompts。不要修改 Annulo 本身。

| 模块 | 数据与函数 |
|---|---|
| 产品与用户 | profile、products、use_cases；profile.context/save、products.list/save/saveUseCase |
| 增长机会 | growth_opportunities；growth.context/saveOpportunity/savePagePlan |
| 运营主题 | campaigns、topics、articles；growth.createCampaign/saveCampaign/campaignContext/savePlan/review |
| 转化数据 | product_metrics_daily；metrics.importDaily/context/summary |
| 灵感库 | research_sources、reference_creators、content_references；inspiration.list/saveSource/saveCreator/link/importLegacy；整理任务 review-inspiration，出选题传 source_ids |
| 内容中心、素材、日历 | topics、articles、assets、publications；content.*、publish.prepare |
| 网站运营 | channels、search_pages、site_issues、site_changes；channels.*、gsc.*、ga4.*、audit.*、review.* |
| 自媒体 | 插件 social 的账号、帖子、采集与健康数据；social/social.* |
| 总览与复盘 | today.list、reports.data/save |

入口 pages/Index.tsx 使用 /?view=。工作台 overview 包含今日任务，每周总结 reports 是同一工作台的另一标签；网站运营使用 website-content、opportunities、search、geo、site、metrics、audit，自媒体运营使用 social-content、inspiration、calendar、social、social-metrics，产品资料使用 company、assets。channels 管理连接，help 查看帮助。旧 content、campaigns 和 reports 链接继续可用；内容详情带 article，运营主题详情带 campaign。

网站和账号管理在 channels；真实社媒操作使用本机浏览器登录状态与插件，需要电脑运行。视频草稿没有实际素材时提示补录屏，不声称成片。

运营后台与渠道网站是两个对象。查 channels 确认要运营的网站后再改网站。新建项目只提供后台和任务，未连接目标网站或账号时不执行营销发布。发布和生产上线遵循用户授权与网站 skill。

真实产品事实、价格、案例、关键词数字必须带来源和核实时间；未知数据留空。转化按访问会话与事件次数统计，跨天相加不是去重人数，不能声称为同批用户漏斗。归因缺失保留 unknown；定时任务只同步已连接系统或生成周报，不自动开启营销发布。

## 稿子、交给 AI、产物、引用

- **稿子**（`articles.draft`，可选，默认折叠）：作者的工作稿（为什么写这篇、大纲、草稿、剧本），**不发出去**；正文才发。读哪个、怎么用你自己定；用户没让写稿子就不改稿子。
- **交给 AI** 两种做法，都是预设（`rewrite_presets`，`mode`）：
  - **在这篇上做**：任务 `work-on-article`（参数 `article_id`、`note`），改这篇的正文也走它：`work.context` 拿这篇的稿子、正文、产物、平台；写正文用 `content.update`，做文件 `annulo upload --local` 后 `assets.add` 存成这篇的产物；
  - **另写一篇**：任务 `rewrite-article`，只生成新文章的正文。
- **产物（artifacts）**是资料库里带 `article_id` 的一条，可以是一组文件（`files: [{ url, mime, name }]`，6 张图一条），带 `chat_id`、`note`（备注，文章页和资料库显示同一条）。`assets.add({ files, article_id, note, use })`；整组重做存新的，只改其中一个用 `assets.replace({ asset_id, n, url, mime, note })` 改原来那组。`use: true`：视频文章设成发布用的视频，图文换成配图。
- **要改就回到做它的那段对话**：用户在对话里接着说，照 `work-on-article` 第 5 步做。
- **引用** `@表:id#n`：用户从页面「复制引用」贴进对话（文章 `@articles:<id>`，产物 `@assets:<id>`，组里第 3 个 `@assets:<id>#3`），消息后面有 `<references>`。资料库 `#n` 数 `files`，图文文章数 `images`。
