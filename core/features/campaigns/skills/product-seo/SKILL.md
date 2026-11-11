---
name: product-seo
description: 围绕产品与使用场景执行 SEO 机会研究、页面规划和持续优化，参考 Danny Postma 官方公开 SEO Blueprint 大纲。用于关键词、竞品、网站页面和 SEO 复盘；社媒内容用 product-growth 与社媒插件。
---

方法参考官方公开大纲：https://www.dannypostma.com/seo-course 。这是面向产品运营的独立执行指南，不包含付费课程内容。

先跑 growth.context，明确产品能力、用户场景、市场语言和转化目标。研究主词、搜索意图、竞品排名页面与内容缺口，再将机会映射到已有页或新页。搜索量与竞争度来自真实关键词工具，保留工具、地区/语言和日期；GSC 展示不能代替全市场搜索量。没有数据标记待验证。

优先级考虑产品相关性、转化意图、竞争与投入。资料不足存 candidate；有可核实需求与竞争证据、来源和时间才存 validated。用 growth.saveOpportunity 校验并去重，同产品/语言/意图/主词只维护一个活跃机会。

页面按意图选择功能、场景、模板、比较、教程、案例或免费工具。优先改善已经服务该意图的页面。比较资料注明日期；案例和模板需要真实展示；工具需要真实运行价值。规划存 growth.savePagePlan，网站实现按 tasks/seo-page-implement.md 和 websites skill 做，操作目标是渠道网站。

规模化页面先验证一小组独立、有价值的页面，观察收录、点击与转化再决定扩展。不要只替换关键词、批量生成缺少独立价值的页面，也不做购买垃圾外链或链接网络。当前政策参考：https://developers.google.com/search/docs/fundamentals/using-gen-ai-content 和 https://developers.google.com/search/docs/essentials/spam-policies 。

外链与分发来自真实模板、案例、工具、合作伙伴与相关目录。可整理合作名单与文案；对外发送须有明确授权。

持续检查抓取、标题描述、内链、canonical、页面速度和搜索意图。SEO 结果按 GSC 窗口解释；转化看 metrics.summary。改变页面后登记 site_changes 并安排复查，不能承诺排名第一或把自然波动当作确定因果。
