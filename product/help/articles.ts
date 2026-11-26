export type Localized = { zh: string; en: string };
export type Article = {
  id: string;
  title: Localized;
  summary: Localized;
  body: Localized;
};
export const ARTICLES: Article[] = [
  {
    id: "quickstart",
    title: { zh: "开始运营产品", en: "Start growing your product" },
    summary: {
      zh: "整理产品与用户，连接渠道，再研究机会。",
      en: "Define product facts and audience, connect channels and research opportunities.",
    },
    body: {
      zh: "新项目先选择要运营的网站：输入官网网址，或选择账号下的网站。助手读取所选网站，整理产品定位、真实功能与用户场景，核对后点击「开始运营」保存到「产品与用户」。以后可在「产品与用户 → 从网站整理资料」重新选择或解析网站，也可以手动补充。\n\n在「网站和账号 → 添加账号」连接要运营的网站或社媒账号。Facebook、Instagram 和 Threads 可直接在这里完成官方授权，返回本项目继续添加；单一账号自动绑定，多个资产或 Facebook 主页需要选择，不用先去 Annulo 设置。每个项目连接各自的账号；在账号的「管理连接」或「连接方式」里查看到期提示、重新授权或确认断开。Instagram 需使用专业账号，实际能力以 Meta 授予的权限为准。其他平台按页面提示登录。\n\nCreght 可以作为运营对象：从真实官网整理功能、模板与用户场景。模板不默认填入价格、案例或搜索数据。",
      en: "Start by entering a website URL or selecting a site in your account. The assistant reads the selected site and prepares product positioning, features and user scenarios. Review and confirm to save them under Product and users. Reopen the flow with Read facts from a website whenever needed.\n\nConnect websites or social accounts under Websites and accounts → Add account. Authorize Facebook, Instagram and Threads here, then return to this project to finish adding the account. A single Instagram asset or Threads account is added automatically; multiple assets or Facebook Pages require selection. No visit to Annulo Settings is needed. Each project connects its own accounts. Manage connection or Connection method shows expiry notices, reauthorization and confirmed disconnect. Instagram requires a professional account and the required Meta permissions. Other platforms show their own sign-in instructions.\n\nCreght can be the product you operate: start from its real website, features, templates and use cases. Prices, case studies and search metrics are not prefilled.",
    },
  },
  {
    id: "seo",
    title: { zh: "研究 SEO 机会", en: "Research SEO opportunities" },
    summary: { zh: "将用户需求映射到页面。", en: "Map user demand to pages." },
    body: {
      zh: "在「网站运营 → SEO 与关键词 → 关键词」点「挖一批关键词」：助手按产品和用户场景挖买家会搜的词、筛掉不相关的、归成主题。导入的 SEO 页面地图、以前研究的页面机会也按主题并在这里。无真实指标时保留「待验证」。\n\n每个主题一张卡片，写着现在怎么样和一个下一步按钮：没有页面就「写新内容」（写之前按页面机会出简报），已有页面排在 4~30 位就「改现有页面」，上线后「看排名」。卡片上还能「创建运营主题」，做成多平台内容。优先改善已有页，新增案例、模板、工具要有独立价值。\n\n方法参考 [Danny Postma 官方公开大纲](https://www.dannypostma.com/seo-course)。",
      en: "Under Website → SEO & keywords → Keywords, click Find keywords: the assistant finds what buyers search for based on your product and use cases, drops irrelevant ones and groups them into topics. Imported SEO page maps and earlier page opportunities are merged in by topic too. Metrics remain unverified without measured data.\n\nEach topic is a card with its status and one next step: Write new content when there is no page (with a brief from the page opportunity), Improve page when an existing page ranks 4–30, and See rankings once live. You can also Create campaign from a card for multi-platform content. Improve existing pages first; new case, template and tool pages need independent value.\n\nThe method references [Danny Postma’s public outline](https://www.dannypostma.com/seo-course).",
    },
  },
  {
    id: "campaigns",
    title: { zh: "制作多平台内容", en: "Create channel content" },
    summary: {
      zh: "一个主题连接官网、小红书、抖音和 X。",
      en: "Connect website, Xiaohongshu, Douyin and X content.",
    },
    body: {
      zh: "在主题中选择产品、用户问题、增长目标和承接页面，再点击「规划多平台内容」和「制作一组草稿」。平台内容独立表达，事实和素材共用，已有草稿不会重复创建。\n\n抖音视频需要真实素材，简介与脚本不是成片。内容详情中核对事实和素材，选择目标网站或账号审核、发布或排期。新生成的内容不会自动发布。",
      en: "Choose a product, user problem, goal and landing page for a campaign. Plan channel content, then create campaign drafts. Each platform has its own expression while sharing facts and assets; existing drafts are preserved.\n\nDouyin needs real footage; descriptions and scripts are not finished videos. Review facts and assets in content details before publishing or scheduling. Generated content is not automatically published.",
    },
  },
  {
    id: "competitors",
    title: { zh: "竞品监控", en: "Competitors" },
    summary: {
      zh: "盯同类产品的网站：新上的功能页、文章、落地页提醒你，能转成选题。",
      en: "Watch similar products' sites: new feature pages, posts and landing pages flagged and turned into topics.",
    },
    body: {
      zh: "左侧「网站运营 → 体检 → 竞品监控」。还没有竞品时点「AI 推荐竞品」：助手按用户找同类产品的方式搜（alternative、vs、best），核实官网后推荐几家，你确认了才盯。\n\n每天读一遍竞品网站，新上的功能页、文章、落地页列出来；勾几条交给助手，按用户的问题出我们自己的选题。还能点「AI 竞对总览」「AI 规格对比」，对比功能和价格。增长计划的「分析网站」也会顺带找竞品。",
      en: "Website → Health checks → Competitors in the sidebar. With no competitors yet, click AI suggests competitors: the assistant searches the way users look for similar products (alternative, vs, best), checks their sites and suggests a few to watch once you confirm.\n\nCompetitor sites are read daily and new feature pages, posts and landing pages are listed; pick some and the assistant turns them into our own topics based on users' questions. AI competitor overview and AI spec comparison compare features and prices. Analyze site in the growth plan also looks for competitors.",
    },
  },
  {
    id: "metrics",
    title: { zh: "导入转化数据", en: "Import conversion data" },
    summary: {
      zh: "追踪会话与转化事件。",
      en: "Track sessions and conversion events.",
    },
    body: {
      zh: "先定义注册、激活和付费事件。Creght 的激活可以候选为创建首个项目或首次发布网站，按真实流程确认。\n\n「转化数据」支持 CSV；「下载 CSV 表头」提供字段。日期、来源和数据出处必填，缺失指标留空。\n\n会话和事件次数跨天相加不是去重用户或同批用户漏斗。同日同来源同主题重新导入会替换。渠道合计与主题明细只能选一种，避免重复计数。未知来源写 unknown。",
      en: "Define signup, activation and payment events first. For Creght, creating the first project or publishing the first website are candidates, subject to its actual workflow.\n\nConversion data accepts CSV; download the headers for required fields. Date, source and provenance are required; leave unmeasured fields blank.\n\nSessions and events summed across days are not distinct users or a cohort funnel. Reimporting a daily source/campaign replaces its snapshot. Use either channel totals or campaign breakdowns to prevent double counting; use unknown for unavailable attribution.",
    },
  },
  {
    id: "reviews",
    title: { zh: "复盘与下一步", en: "Review and next steps" },
    summary: {
      zh: "根据真实结果安排下一轮。",
      en: "Choose next actions from measured results.",
    },
    body: {
      zh: "主题详情中查看草稿和转化并发起复盘。结论写回主题，复查到期后出现在总览。\n\n「增长计划 → 每周总结」分别解释网站、社媒与产品数据，明确各自日期窗口；缺少数据时先安排补数据。",
      en: "Campaign details show drafts and conversions and start a review. Conclusions are saved to campaigns; due dates appear on the overview.\n\nWeekly reviews explain website, social and product metrics with their respective date windows; fill data gaps before drawing conclusions.",
    },
  },
];
