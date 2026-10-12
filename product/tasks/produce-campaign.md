---
name: 制作一组内容草稿
description: 按运营主题计划生成各平台草稿。
prompt: produce-campaign
---

参数 campaign_id。跑 growth.campaignContext。先按用户要求和 prompts/produce-campaign.md（用户版优先）确认本次范围。

逐条处理已规划 topics：如果该 topic 已有关联文章，保留现有草稿，不重复创建；需要修改时走 revise-article。没有文章时读取 tasks/write-article.md，按 topic_id 和 content_type 跑 content.context，用相同 evidence_id 保存 content.save。

尊重 topic.target_platform、简报语言、平台限制、产品事实和账号定位。官网长文正文是 HTML，图文和视频简介用纯文字。只有真实素材地址才可写 images、video；视频不足就保存视频简介草稿并说明需要补录屏。没有完成视频文件时不能声称已制作视频。

最后列出各平台的草稿与待补素材，提供内容中心入口。只生产草稿，不审核、不排期、不发布。
