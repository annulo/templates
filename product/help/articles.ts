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
      zh: "在「产品与用户」填写官网、定位、目标用户与增长目标。「从官网整理资料」读取真实产品说明，也可以手动添加产品事实与用户场景。\n\n在「网站和账号」连接要运营的网站和小红书、抖音、X 账号。发布和采集使用电脑上的登录状态。\n\nCreght 可以作为运营对象：从真实官网整理功能、模板与用户场景。模板不默认填入价格、案例或搜索数据。",
      en: "Fill in your website, positioning, audience and growth goals under Product and audience. Import verified facts from the website or enter them manually.\n\nConnect websites and Xiaohongshu, Douyin and X accounts under Websites and accounts. Publishing and collection use the computer’s login sessions.\n\nCreght can be the product you operate: start from its real website, features, templates and use cases. Prices, case studies and search metrics are not prefilled.",
    },
  },
  {
    id: "seo",
    title: { zh: "研究 SEO 机会", en: "Research SEO opportunities" },
    summary: { zh: "将用户需求映射到页面。", en: "Map user demand to pages." },
    body: {
      zh: "在「增长机会」点击「研究 SEO 机会」，研究关键词、搜索意图、竞争和已有页面。无真实指标时保留「待验证」。\n\n点击「规划 SEO 页面」生成简报，或从机会创建运营主题。优先改善已有页，新增案例、模板、工具要有独立价值。\n\n方法参考 [Danny Postma 官方公开大纲](https://www.dannypostma.com/seo-course)。",
      en: "Research SEO opportunities examines keywords, intent, competition and existing pages. Metrics remain unverified without measured data.\n\nPlan SEO page creates a brief. You can also create a campaign from the opportunity. Improve existing pages first; new case, template and tool pages need independent value.\n\nThe method references [Danny Postma’s public outline](https://www.dannypostma.com/seo-course).",
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
      zh: "主题详情中查看草稿和转化并发起复盘。结论写回主题，复查到期后出现在总览。\n\n「每周总结」分别解释网站、社媒与产品数据，明确各自日期窗口；缺少数据时先安排补数据。",
      en: "Campaign details show drafts and conversions and start a review. Conclusions are saved to campaigns; due dates appear on the overview.\n\nWeekly reviews explain website, social and product metrics with their respective date windows; fill data gaps before drawing conclusions.",
    },
  },
];
