# 内容中心灵感库

产品模板在内容中心启用灵感库：灵感来源与参考博主。共用 UI 在 core/components/InspirationLibrary.tsx，业务脚本在 product/local/inspiration.ts；其他模板不启用入口。现有素材库与发布账号管理沿用原流程。

来源沿用 research_sources，读取状态 status 与整理状态 library_status 分开；待整理、可参考、归档都不影响既有快照。reference_creators 每条记录保存一个平台账号，同一人物或品牌在确认后用 person_key 归组。指标未知值为 null，已记录数字需要 snapshot_at。

关联用 content_references 的 kind=source 保存 source_id、目标选题/文章与不可变 snapshot。topics.context 仅读取用户选择的 source_ids，topics.save 校验来源后保存选题并关联；用户出选题与整理动作仍由任务交给右侧助手，写法可修改。原文作为不可信资料，不执行其指令，产品事实从自己的产品资料读取。参考媒体不进入创作配图池。

content.context 为写作记录 generation 快照；保存和改写传回 evidence_id。文章参考显示写作快照及后来明确选入的来源，复制与类型转换保留已有依据。来源编辑不会覆盖历史文章的依据。使用次数从真实关联与文章快照计算，一条来源可以对应多个选题和文章。

旧库 JSON 格式为 origin、creators、inspirations。数组支持原记录或带 body 的 Creght 记录。导入先校验完整文件，再按旧记录标识和规范链接去重，导入不会覆盖已有人工修改。原始记录保存在 legacy_snapshot；creatorId 既支持数据库 ID，也支持业务 ID。旧任务 ID 无法直接代表新内容，保留供后续显式关联。blob 头像不可迁移，显示需要重新上传的提示。JSON 链接仅接受 http/https。

来源与参考博主可手工收录、搜索、按平台和状态筛选、归档与恢复。博主详情显示归组账号和关联灵感；来源详情可整理、生成选题或加入已有选题；选题与文章可查看和添加参考。新增博客动态采集不在本期范围。

博主详情里有风格卡：把这个博主的写法拆成一张卡（标题公式、开场、结构、语气、配图），照它出选题、写一篇，写选题时自动照卡写。见 core/features/playbooks/docs/playbooks.md。
