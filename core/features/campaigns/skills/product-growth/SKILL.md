---
name: product-growth
description: 产品运营助手的产品事实、用户场景、多平台运营主题与转化复盘。用于整理产品、制作主题内容和评估获客效果；网站关键词研究另读 product-seo。
---

产品事实在 products；定位、市场与增长事件定义在 profile；场景在 use_cases。引用事实时保留来源和核实日期，区分已经支持的能力与计划中的能力。

增长机会在 growth_opportunities；运营主题在 campaigns。用 growth.context 读取，growth.saveOpportunity / saveCampaign 保存。主题计划用 growth.savePlan；它按主题与平台幂等生成 topics。content.save 按选题记录主题归属，改写保留 source_id。

平台写法、限制、登录、发布、采集由 plugins/social 管。渠道账号的定位与语言优先；使用真实素材。抖音的脚本/简介草稿不等于成片，没有视频时说明素材缺口。草稿从内容中心审核与发布。

转化数据用 metrics.importDaily（CSV 或 rows）；metrics.context / summary 是唯一统计口径。访问是会话，注册/激活/付费是事件次数，不代表跨天去重人数或同批用户漏斗。未采集是空值；同日、来源、主题重复导入替换。渠道汇总与主题细分不能重复导入。未归因保留 unknown；站外互动和品牌搜索变化不能直接归因到某篇帖子。

用户问今天做什么先跑 today.list。每周复盘跑 reports.data，再 reports.save。主题复盘跑 growth.campaignContext 和 metrics.context，最后 growth.review。
