---
name: leads
description: 询盘线索：独立站表单提交自动同步进运营后台的 leads 表，判断是不是真实询盘、意向高低、来自哪个页面和推广渠道，用户在「询盘线索」里跟进。用户问「最近有哪些询盘」「这周高意向的客户」「哪个页面带来的询盘多」「帮我回这封询盘」「查查这个客户」或要改跟进阶段、记跟进时用它。
---

# 询盘线索

独立站（creght_site 渠道）上的表单一有人提交，分两步进 `leads` 表：
1. 入库：原样写入，标 `pending=true`（页面显示「判断中」），并从提交所在页面的地址里拆出落地页和 `utm_*`。两条路：
   - **实时推送**：每个独立站在 creght 注册一个表单 webhook（`leads.connect`，`leads.sync` 开头会自动给没注册的渠道注册），
     提交一来平台就 POST 到运营后台的 Func `backend/func/leads_hook.ts`，验签后写入。电脑关着也不漏。
   - **兜底补拉**：`leads.sync` 通过 creght MCP 的 `form_submissions` 按游标增量拉，推送漏掉的在这里补上，按 source_ref 去重。
2. 判断（`leads.judge`）：取 `pending` 的行，模型判断是不是**真实询盘**（区分推销 SEO / 建站服务、垃圾、测试）、**意向**高低和理由、**标签**（要报价、要样品、定制、大批量、代理、着急），整理联系人和留言摘要，写回去、`pending=false`。
   要调模型，只在本机跑：定时任务每 5 分钟一次，询盘页面开着时看到新的也会马上跑。模型失败的留着，下次再判断。

定时任务：`leads.sync` 每 30 分钟、`leads.judge` 每 5 分钟（`schedules/leads.sync.json`、`schedules/leads.judge.json`），页面上也有「立即同步」。

webhook 记在 `lead_hooks` 表（channel_id、webhook_id、推送地址、签名密钥）。**不要把密钥告诉用户或写到别处**。
推送没到时排查：`form_webhook_list`（creght MCP）看最近投递的状态码和报错。地址是运营后台的**预览地址** `https://<站点 id>.preview.<域名>/func/leads_hook`
（Func 跟着站点版本走，预览永远是最新推上去的代码，升级模板后不用发布），运营后台的 Func 没推上去会失败。重新注册某个渠道：删掉它在 `lead_hooks` 的那行（和平台上的 webhook），再跑 `leads.connect`。

数据来源：creght MCP 的 `form_list` / `form_submissions`（封装在 `local/_creght.ts`）。平台不返回 IP，只给国家代码。

**WordPress 等外部表单**：没有拉取接口，走 webhook。`leads.formHook({ channel_id })` 给渠道一个接收地址和密钥（渠道页「接收表单询盘」显示），用户贴进表单插件（Elementor、WPForms、CF7、Zapier…）；提交 POST 到 `/func/leads_hook`，同样写成待判断的线索。密钥带法：地址上的 `?k=`、请求头 `x-shuttle-key`、隐藏字段 `shuttle_key`。

## 表：leads

| 字段 | 说明 |
|---|---|
| channel_id | 来自哪个渠道 |
| source / source_ref | `form`；表单提交 id（同一来源唯一，同步按它去重） |
| form_name / submitted_at | 表单名、提交时间 |
| contact | JSON 字符串：name / email / phone / company / title / country |
| company / message | 公司；留言摘要（≤1000 字） |
| fields | 表单原始字段 JSON 字符串（判断有疑问时看原文） |
| landing_page / utm / country | 提交所在页面（不带 query）；utm_* 参数 JSON；国家代码 |
| is_real / intent / intent_reason | 是否真实询盘；high / medium / low；一句话理由 |
| pending | 刚入库、模型还没判断；判断前 is_real / intent 是默认值，别拿来回答问题 |
| status | 跟进阶段，也是询盘页「看板」的列：`new` 新询盘 → `contacted` 已联系 → `quoted` 已报价 → `negotiating` 谈判中 → `won` 已成交 / `lost` 已流失；`spam` 是垃圾 / 无效（不上看板）。旧的 `qualified` 由 `leads.judge` 改成 `negotiating` |
| tags | JSON 数组：`quote` 要报价、`sample` 要样品、`oem` 定制 / OEM、`bulk` 大批量、`distributor` 代理分销、`urgent` 着急 |
| research / research_at | 客户背调 JSON（verdict：`pursue` 值得跟进 / `normal` / `caution` 先核实 / `avoid` 疑似无效；conclusion、company、signals、risks、domain、next_steps、sources），按任务 `tasks/research-lead.md` 写 |
| activities | 跟进记录 JSON 数组 `[{ at, kind: status / note / reply / research, text }]`：改阶段、写回复、背调自动记，用户也能手动记 |
| owner / note | 负责人、跟进备注（旧字段，跟进写进 activities） |

同步游标在 `channels.leads_cursor`（上次最后一条提交的 id），`channels.leads_synced_at` 是上次同步时间。**不要手动改游标**；
要重新同步某个渠道的全部历史，把它的 `leads_cursor` 清空再跑 `leads.sync`，已有的线索按 source_ref 去重，不会重复。

## 本机函数

```bash
annulo run leads.sync --input '{}'                          # 所有独立站；只同步一个：{"channel_id":"…"}
annulo run leads.judge --input '{}'                         # 只判断 pending 的线索（sync 结束时会自动跑）
annulo run leads.connect --input '{}'                       # 给没注册实时推送的独立站注册，发测试事件确认能收到
annulo run leads.stats --input '{"days":30}'   # 询盘数 / 真实 / 高意向，和上一周期比；按落地页、utm_source 分组
annulo run leads.update --input '{"id":"…","status":"quoted","log":"发了 FOB 报价"}'
annulo run leads.saveResearch --input @/tmp/research.json   # 存背调，格式见 tasks/research-lead.md
```

改阶段、记跟进用 `leads.update`（会校验阶段；标成 spam 时 is_real 跟着改；改阶段和 `log` 都会追加到 activities），不要直接改表。

## 助手能做的

- **回答问题**：「这周有哪些高意向询盘」「哪个页面带来的询盘最多」→ 用 `db_query` / `db_aggregate` 查 leads 表或跑 `leads.stats`，直接回答，列出公司、需求、来源页面。
- **客户背调**：用户说「查查这个客户」「这家靠谱吗」→ 照任务 `tasks/research-lead.md` 做（询盘详情的「AI 背调」也是按它开对话交给你）：查官网、域名、公开信息和风险，给结论和下一步，`leads.saveResearch` 存。查不到写查不到，不要猜；背调只给用户看。
- **判断有误时纠正**：用户说「这条不是垃圾」→ `leads.update` 改状态。
- **写回复草稿**：照任务 `tasks/reply-lead.md` 做（询盘详情里的「AI 写回复」也是按它开对话交给你）：`leads.context` 拿上下文（有背调的话带着背调和最近的跟进记录），按写法写，`leads.saveReply` 存到这条线索上，用户在页面上复制或用邮件发送。**不要替用户发邮件**，也不要把联系方式发到别的地方。
- **跟进提醒**：总览「今天要做的」会列出联系后 3 天没进展的询盘（阶段是已联系 / 已报价 / 谈判中，3 天没改过、没记跟进）。用户跟进了就 `leads.update` 记一条 `log`。
- **提改进建议**：询盘集中在哪些页面、哪些推广渠道没带来真实询盘，结合搜索表现、体检给建议。

## 常见情况

- 同步报「creght 还没开放读表单提交的接口」：平台版本旧，等平台更新，不是用户能解决的。
- 一直没有提交：先看渠道站点有没有表单（creght MCP 的 `form_list`，参数 project_id）。没有表单时可以建议用户加一个询价表单（改站点代码，按 websites skill 的改站流程，先预览再由用户决定发布）。
- 模型判断失败时，这批提交会按「待确认」写入（is_real=true、intent=medium），不会丢；用户可以在页面上改。
