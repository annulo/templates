---
name: 规划多平台内容
description: 为运营主题规划官网、小红书、抖音与 X 内容。
prompt: plan-campaign
---

参数 campaign_id。跑 growth.campaignContext，读取 product-growth skill。使用真实产品事实、用户场景和已有素材；围绕同一个用户问题，为 campaign.channels 中的平台分别设计标题、角度和结构。

网站使用 article，小红书与 X 使用 post，抖音使用 video。网站与小红书、抖音默认中文，X 默认英文；用户市场和账号定位优先。每个平台在本次计划里最多一条。

将 campaign_id 和 topics 数组存到 growth.savePlan。每条包含 target_platform / title / angle / keywords / outline / language / cta / gaps。素材不足写入 gaps，不能编造截图或视频。已有平台计划返回原计划，若需修改先在内容中心编辑简报。
