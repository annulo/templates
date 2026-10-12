---
name: 每周增长复盘
description: 依据真实网站、社媒与产品转化数据总结增长。
prompt: weekly-report
---

先跑 reports.data（days=7），所有数字使用返回的数据与各自窗口。搜索与社媒口径需单独说明；转化是事件次数，不能写成跨期去重用户或同一批用户漏斗。

结合运营主题和增长机会写 title / summary / body / highlights / suggestions，用 reports.save 保存 period_start 与 period_end。suggestions 中的页面入口使用实际 view：company / opportunities / campaigns / metrics / content / search / channels。无数据明确写待接入，不把缺失当作零，不凭发文或点赞数断言收入增长。
