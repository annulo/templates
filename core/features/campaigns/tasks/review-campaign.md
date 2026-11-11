---
name: 复盘运营主题
description: 结合内容表现和产品转化记录复盘结论。
prompt: review-campaign
---

参数 campaign_id。跑 growth.campaignContext 和 metrics.context（传同 campaign_id、days=30），读取已有 publications 与 social_posts 的真实发布和互动记录；社媒增量、累计量与采集时间必须明确。

根据数据区分已观察结果与待验证判断。没有转化接入时说明缺数据，给埋点/导入建议；不能把社媒互动当成注册或激活，不能声称单个关键词带来某个注册。日期不同的指标不要直接比较。

按写法给出 conclusion 和下一轮具体行动，通过 growth.review 保存（状态 review 或用户明确结束时 done，可带下一次 review_at）。不自动改变线上内容。
