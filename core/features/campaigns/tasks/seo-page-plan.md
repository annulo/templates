---
name: 规划 SEO 页面
description: 把增长机会转成有依据的页面简报。
prompt: seo-page-plan
---

参数 opportunity_id 必填。读 product-seo skill；跑 growth.context 找到该机会、产品事实、用户场景和已有页面。

从关键词地图进入时，机会最初仍是 candidate：先核对当前搜索意图、页面和产品事实，再决定更新已有页还是新增。旧人工 SERP 1–5 难度不是工具 KD，不能写进 difficulty 或据此伪造搜索量。近义词共用主页面；Search Console 页面汇总不是单个词排名，也不能关联到单笔订单。历史素材与研究记录不能授权发布。

明确搜索意图、页面类型、推荐 URL、已有页更新或新建、核心价值、独立素材、内部链接、CTA 和验证指标。比较页核实竞品资料和日期；模板与案例页需真实作品；免费工具需明确可运行的功能。

按写法产出 title / outline / cta / gaps；把这些字段和 opportunity_id 存到 `growth.savePagePlan`，它会幂等创建网站选题。大纲内保留页面目标、结构和真实资料来源。告诉用户可在「内容中心」查看简报；真正的页面实现走 seo-page-implement。
