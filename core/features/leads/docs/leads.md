# 询盘：从收询盘到商机跟进

外贸用户最在意的是询盘。这一页把「收到询盘」接到「跟进成交」：自动判断、客户背调、按阶段管、记跟进。参考的是 TradeMax 的独立站询盘和商机看板（2026-10 规划）。

## 数据

都在 `leads` 表上，不另建表（手机上打开后台走云端 Func，读写的还是这一张表）：

| 字段 | 谁写 | 用途 |
|---|---|---|
| `status` | 用户（列表、看板、详情）、助手（`leads.update`） | 跟进阶段：new → contacted → quoted → negotiating → won / lost，spam 不上看板。看板的列就是这几个阶段。旧值 qualified 由 `leads.judge` 顺手改成 negotiating |
| `tags` | `leads.judge`（模型） | quote / sample / oem / bulk / distributor / urgent，只认这几个，模型给别的丢掉 |
| `research`、`research_at` | 助手按 `tasks/research-lead.md`，`leads.saveResearch` 校验后存 | 客户背调，结构见 `lib/shuttle.ts` 的 `LeadResearch` |
| `activities` | `leads.update`（改阶段、`log`）、`saveReply`、`saveResearch` | 跟进记录，最多 200 条，新的在后面 |

「今天要做的」的跟进提醒看 `updated_at`：改阶段、记跟进都会更新它。

## 页面（`components/views/Leads.tsx`）

- 顶上四个数在页面里按 `leads` 算（24 小时、本周比上周、高意向没结束的、已成交），不依赖 `leads.stats`，手机上也有；按页面、推广渠道的分组仍用 `leads.stats`（近 30 天），放最下面。
- 快捷筛选、搜索、列表 / 看板、打开的那条都在网址参数里（`filter`、`mode`、`lead`），能直接链接过来。
- 「新」标识：真实的新询盘、没在这台电脑上点开看过（看过的 id 存浏览器 localStorage）。
- 详情是弹窗，三块：概览（原文、联系人、回复草稿）、客户背调、跟进记录。
- 导出 Excel 是页面里生成 CSV（带 BOM），导的是当前筛选的结果。

## 背调为什么是任务

背调要查网页、看域名、做判断，用户想看过程，属于「用户点按钮、要 AI 读东西想东西的活」：写成任务交给右侧助手（`TaskButton`），本机函数只负责取数（`leads.context`）和校验存表（`leads.saveResearch`）。
背调是按固定流程查事实、给判断，不是用户有偏好的产出，所以没有「AI 要求」写法文件。

回复任务（`tasks/reply-lead.md`）读背调的 `next_steps` 定报价口径；背调内容不写进给买家的回复。

## 以后

- 分配业务员、按人看：等团队（服务端版本的账号和角色）。
- 主动获客（Apollo、领英）找来的客户也进这张表，用同一套阶段和跟进。
- 高意向的新询盘自动排背调（现在是用户点）。
