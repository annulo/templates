---
name: ops-backend
description: 运营后台的通用结构和做法：业务表怎么读写、页面和组件在哪、本机函数 / 任务 / 交给助手怎么选、怎么改导航和起步步骤、怎么加一个模块、界面规范、改后台的流程。用户要改后台页面、加功能、手动改一条数据时先读它（本机函数、表声明的基础写法见 annulo skill；这个模板自己的业务看 ANNULO.md / SHUTTLE.md）。
---

# 运营后台

工作目录就是这个运营后台（一个项目就是一个业务，里面不再分项目，各业务表里也没有所属项目的字段）。用户在 Annulo 里看它：
左侧后台渲染的是工作目录里的文件，改完保存几秒内自动刷新，不用推、也不用让用户刷新。**不要把运营后台的预览地址给用户**。

## 读写业务表

- **读用 `db_query` / `db_aggregate` 工具**：找「最高 / 最近 / 某段时间内」用 `filter` + `order_by` + `limit`；按天合计、涨了多少、每个账号多少条用 `db_aggregate`，都在 Annulo 里算，不要全拉下来再筛；长正文的表传 `fields` 只取要的字段。
- **写调本机函数**：有业务函数的用业务函数（`content.save`、`profile.save` 这类，各模块的 skill 里写着），它们会校验字段、维护关联。
- **没有现成函数、要手动改一条**：用共用的 `records.*`（离线项目、在线项目都能用）：
  ```bash
  annulo run records.patch  --input '{"table":"topics","id":"<id>","data":{"status":"dropped"}}'   # 顶层浅合并，null 删字段
  annulo run records.create --input '{"table":"assets","data":{"kind":"text","text":"…","source":"agent"}}'
  annulo run records.remove --input '{"table":"topics","id":"<id>"}'
  ```
  不要用 creght 命令行写运营后台的表，也不要直接改数据文件。删除前先跟用户确认。

用户在后台点「交给助手…」按钮时，会发来一句带着 id 的话：照着 id 去读表、干活，干完把状态写回表里，后台刷新就能看到。

## 目录

- `pages/Index.tsx`：外壳：左侧模块导航，右侧按 `?view=` 渲染视图；状态都在地址栏参数里（view、tab、channel…），读写用这里的 `readParam` / `writeParam`
- `components/views/`：各模块的视图，一个模块一个文件
- `components/charts/TrendChart.tsx`：折线图（纯 SVG），新图表仿照它写，放 `components/charts/`，不要引入图表库
- `components/Task.tsx`：交给助手的任务。`TaskButton` 开一段对话、在右侧打开，跑的时候变成「进行中 · 看过程」；`TaskRequirements` 显示并编辑任务的写法（「AI 要求」）；`TaskRunning` / `TaskFailed` 显示在跑的和上次失败的
- `components/AskButton.tsx`：把一句话交给助手（`askInNewChat`），给开放的、要改代码的活（排查问题、一次性配置）
- `components/RunButton.tsx`：执行本机函数的按钮（确定的操作：检测、同步、发布），带进度，缺密钥时给「去设置」。默认把进度和报错写在按钮下面，只适合单独放的按钮；**和别的按钮排在一行时一律加 `inline`**，报错用 `onError` 交给这一行自己显示，否则会把旁边的按钮顶歪
- `components/ui.tsx`：Button、Segmented、RangeToggle、Badge、Panel、Notice、Skeleton、Dialog、Field、PageHeader
- `components/Select.tsx`：下拉选择（按钮 + 弹出菜单，每项可带图标和第二行字）。**下拉一律用它，不要用系统的 `<select>`**；选项少（2–4 个）又常切换的用 `Segmented`
- `lib/shuttle.ts`：**页面所有数据都从这里取**：`dbList / dbCreate / dbPatch / dbDelete`（业务表）、`runLocal`（本机函数）、`listChannels`、`shuttleFetch`、`openShuttleSettings`、`uploadFile`（上传文件拿公开地址）、`setSecret / secretsSet`（写本机密钥、查配了没有）
- `local/*.ts`：本机函数（见下）；`tables/<表>.json`：业务表的声明，文件名就是表的 key
- `tasks/<id>.md`：交给助手的任务；`prompts/<id>.md`：任务的默认写法；`user/`：用户自己的定制（见下文「原则」）
- `messages/zh.json`、`messages/en.json`：界面文案，两边都要写
- `index.css`：设计令牌，**不要改**

## 本机函数

`local/*.ts`，由 Annulo 在本机直接执行（不经过模型）。写法、`ctx` 能用什么、怎么试跑，见 **annulo skill**。页面里用 `runLocal(fn, input, onEvent)` 调，或者直接用 `RunButton` / `<Button fn="文件.函数">`。
插件的函数带插件 id（`social/social.publish`），用法看 `plugins/<id>/PLUGIN.md`。

在线项目（连着 creght）也能在手机、别的电脑上打开后台，那里没有 Annulo。**页面代码不用为它分情况**，只在函数文件里声明：

```ts
export const cloud = ['list', 'stats']   // 只读写表（ctx.db）的：在云端跑，手机上随时能用
export const remote = ['publish']        // 要电脑（浏览器登录态、密钥、外部接口）的：电脑上 Annulo 开着、打开了「远程访问」时，转给电脑跑
```

没声明的函数在手机上自动灰掉。`dbList` 这些在手机上改走 `backend/func/db.ts`，新加的表要加进它的 `TABLES`（改了 `backend/func/*.ts` 要 `annulo push -m '说明'` 才生效）。
不是本机函数、只在 Annulo 里才有的按钮（上传本机文件、本机密钥）写 `<Button needsShuttle>`；`TaskButton`、`AskButton` 自己会灰。组件里不要自己判断在不在 Annulo 里。

## 原则：做成软件

- 确定的操作（同步、检测、发布、调外部接口）→ 本机函数 + `RunButton`，点了就做完，不经过助手。
- 没有按钮、没人盯着的后台自动判断 → 本机函数里调一次 `ctx.llm`。只有这一种能在函数里调模型。
- 用户点按钮、要 AI 读东西想东西的活（出选题、写文章、改文章、写总结）→ 写成任务 `tasks/<id>.md`，按钮用 `TaskButton`；本机函数只负责取数（`*.context`）和存表（`*.save`）。开放的、要改代码的活 → `AskButton`。
- **产出内容的任务，用户关心的写法单独一个文件**：默认 `prompts/<id>.md`，用户改的存 `user/prompts/<id>.md`（有它就用它）；发起它的按钮旁边放 `TaskRequirements`。取数、存表、字段格式、平台限制放在任务文件的「规则」里，用户改不到。按固定流程配系统的任务没有写法文件。
- **`user/` 目录是用户自己的东西**：用户在对话里让你改的写法放这里，不要改 `prompts/` 下的默认和任务文件（那是模板的，升级会覆盖）。
- **交给助手的按钮都新开一段对话在后台跑**，在右侧打开，按钮变成「进行中 · 看过程」，跑完恢复、页面重拉数据；不要把话塞进用户当前的对话。
- 页面上显示的失败、过期、没接入这些状态，旁边要有解决它的操作；灰掉的选项写明原因。

## 改导航、说法、起步步骤：改这几个配置文件

页面上能按业务调整的东西集中在这几处，别去改共用的页面代码（模板升级时不容易冲突）：

- `lib/edition.ts`：左侧导航怎么分组、能添加哪些账号或渠道、向导有哪几屏；
- `local/_checklist.ts`：总览起步任务的步骤和说法；`local/today.ts`：总览「今天要做的」；
- `messages/*.json`：界面上的每一句话；
- `ANNULO.md`（老项目是 `SHUTTLE.md`）、`tasks/*.md`。

用户问「接下来做什么」「今天干嘛」时，先跑 `annulo run today.list` 照它回答，别自己另编一套。

## 给后台加一个模块

一个模块是这几样，**都在工作目录里，不改 Annulo**：

1. **表**：加 `tables/<表>.json`（`{ name, desc, json_schema }`，照已有的抄），保存后自动建表；在线项目同时加进 `backend/func/db.ts` 的 `TABLES`。
2. **本机函数**（调外部接口、批量处理）：`local/<模块>.ts`，先用 `annulo run` 跑通；只读写表的列进 `cloud`，要电脑的列进 `remote`。
3. **页面**：`components/views/<模块>.tsx`，在 `lib/edition.ts` 的导航和 `pages/Index.tsx` 里挂上，类型写进 `lib/shuttle.ts` 的 `Tables`。
4. **任务**（要 AI 写的）：`tasks/<id>.md` + 默认写法 `prompts/<id>.md`，页面用 `TaskButton` + `TaskRequirements`。
5. **skill**：写进 `skills/<模块>/SKILL.md`，在 `ANNULO.md` 的模块列表里加一行；想想总览的起步步骤、今天要做的要不要加一项。
6. 用到用户自己的 key：函数里 `ctx.secrets.get`。要用户当场填的，页面放 `type="password"` 输入框，提交时 `setSecret(名字, 值)`，表里只存密钥名；缺了就提示「到 设置 → 密钥 添加 XXX」，配一个 `openShuttleSettings('secrets')` 按钮。**不要让用户改 ~/.zshrc，也不要把 key 写进代码、表、对话。**

## 页面里请求外部接口

浏览器里直接 `fetch('https://外站')` 会被跨域拦截，**不要这么写**：

| 场景 | 做法 |
|---|---|
| 页面上看一眼外部数据（公开 API、抓网页标题） | `shuttleFetch(url, { method, headers, body })`，由本机 Annulo 代为请求 |
| 要用 key、要批量、要写表 | 写成本机函数，页面用 `runLocal` 调 |

`shuttleFetch` 返回 `{ ok, status, status_text, url, headers, body, body_base64, truncated }`，`body` 是文本，二进制在 `body_base64`；不能访问本机和内网地址。
展示外站 HTML 时不要直接 `dangerouslySetInnerHTML`，提取需要的文字或放进 `<pre>`。

## 界面规范

- 卡片 `rounded-xl border border-border bg-background p-4`，标题 `text-sm font-semibold`；指标卡数值 `text-2xl font-semibold tracking-tight tabular-nums`；表格用 `BreakdownTable` 那套。
- 深浅两套主题都要能看，别用只在一种主题下成立的颜色。图表序列色用 `var(--series-1)`、`var(--series-2)`。
- 空状态、加载两种情况都要处理（`Notice` / `Skeleton`）。
- 按钮组、标签和标题放一行的（`flex` + `shrink-0`），窄屏时换行（`flex-wrap`，或 `w-full sm:w-auto`），别把标题挤成竖字。

## 改后台的流程

1. 读相关文件，保持现有写法（Tailwind v4、相对路径 import、组件放 `components/`）。
2. 改完保存就行，左侧后台自动刷新。用 `page_errors` 确认没报错，传真实地址（`{"reload":true,"path":"/?view=content"}`，不是 `/content`）；404 页没有脚本异常不算通过。
3. 页面会在编辑器画布里打开：画布里 `window.location` 不是 http 地址，不要直接 `new URL(window.location.href)`。
4. 回复用户：改了什么、数据口径，左侧后台已经是新的了。
