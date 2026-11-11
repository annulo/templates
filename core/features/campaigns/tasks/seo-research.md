---
name: 研究增长机会
description: 参考 SEO 蓝图研究需求、关键词和页面机会。
prompt: seo-research
---

读 skills/product-seo/SKILL.md，跑 `annulo run growth.context` 取得产品、用户场景、已有页面和机会。

按本次 notes 和用户版 user/prompts/seo-research.md（没有时用 prompts/seo-research.md）研究。可读取公开搜索结果、竞品页面和用户提供的关键词报表；使用实际可用的搜索或浏览器能力，不能编造工具的返回结果。

对每个机会给出：product_id、可选 use_case_id、title、keyword、language、intent、page_type、audience、problem、recommendation、goal、priority、effort。查询真实需求和竞争证据，记录 evidence、source_url、checked_at。对照现有页面：同一搜索意图优先改善已有 target_url，避免重复页面。

搜索量和竞争度只使用关键词工具实际返回的指标，带 data_source 和 checked_at；GSC 展示次数不能当作全市场搜索量。没有数据就省略 search_volume 和 difficulty。证据不足时保存 candidate；证据充分才保存 validated，并说明优先级依据。

逐条写入 `growth.saveOpportunity`（用 JSON 文件传参），同产品同语言同意图同主词已有机会时更新其 id，不能重复。先保存最值得执行的一小组，并汇报页面建议与下一步。不自动建大批页面或发布内容。
