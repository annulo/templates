# 风格卡

拆解一个参考对象得出的写法，写作和出选题时交给 AI 参考。总体方案（博主、竞品、小红书自动收集、分期）见仓库根目录 `docs/reference-playbooks.md`。

- 表 `playbooks`：**一个对象一张卡**（`subject_type` + `subject_id`），重新拆解或在对话里改都更新这张、`version` +1，不留历史版本；文章写作时把用到的卡（id、version、guide…）存进 `evidence_snapshot`，之后改卡不影响旧文章的依据。现在只有 `creator`（参考博主），`competitor` 留给外贸竞品。
- 拆解是任务 `tasks/analyze-reference.md`（读很多条、做判断、用户要看过程），写法文件 `prompts/analyze-reference.md`：用户关心拆哪些方面，页面上能改。本机函数 `local/playbooks.ts` 只取数（`context`）和存表（`save`），`save` 记下 `ctx.chat_id`，卡上「继续对话」回到那段对话接着改。
- 来源少于 3 条有正文或整理过的不拆，让用户先收。
- 写作接入（模板自己的函数）：`topics.save` 带 `playbook_id` 记在选题上、出处记一条 `playbook`；`content.context` 收 `playbook_id`（没给用选题上的），输出 `playbook`；`content.save` 把 `playbook_id`、`playbook_version` 记在文章上。`playbooks.list` 的「用过几次」按选题和文章上的 `playbook_id` 算。
- 界面在 `core/components/Playbook.tsx`（参考博主详情里），灵感库的 `inspiration.list` 带 `playbooks` 时才显示。
- 规则：只学写法，对方的事实、数据、产品不进卡；每条公式带真实原例和出处。
