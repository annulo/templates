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

视频可用 `articles.video_cover` 指定封面图片（资料库地址或本机上传地址），编辑器支持上传、粘贴、选择、替换、移除；复制保留封面。小红书和抖音的即时、定时发布使用该封面，其他平台使用默认封面。模板与社媒插件需要一起更新；封面上传失败时停止发布，不静默改用默认封面。
