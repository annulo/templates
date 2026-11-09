---
name: 核对改动是否上线
description: 用户点了「已上线，开始复查」：抓线上页面，对照建议（新标题描述 / 补内容要点）判断改动真的上线了，上线了才开始复查
---

参数：`id` 是 search_pages 表里这个页面的记录；`kind` 是改了什么：`search_meta` 改标题和描述，`search_content` 补内容。

复查要拿「上线前」和「上线后」的数据对比，上线时间记错了结论就是错的：所以先确认线上真的是改过的样子，再开始复查。
建议是你（助手）写的，线上的措辞可能被用户或改站时调整过，按意思判断，不要逐字比。

## 1. 读建议

用 `db_query` 读 search_pages 里这条记录（`id`），拿 `page`（页面地址）、`channel_id`，以及：

- `search_meta`：`suggestion`（JSON：`title`、`description` 是建议改成的，`current_title`、`current_description` 是改之前的）；
- `search_content`：`expand_brief`（JSON：补内容的要点、要加的小节和 FAQ、内链）。

## 2. 抓线上页面

```bash
annulo run gsc.pageContext --input '{"id":"<id>"}'
```

它直接请求线上的页面地址（不是预览），输出里 `title`、`description`、`h1`、`headings`、`body`（正文前 3000 字）是线上现在的样子。

## 3. 判断

- `search_meta`：线上的标题和描述是建议的新版本（或者意思相同、只改了个别措辞），不再是 `current_title` / `current_description` 那份旧的 → 已上线。
- `search_content`：要点里要加的小节、FAQ、关键内容在线上页面的小标题和正文里能找到大部分 → 已上线；正文只读到前 3000 字，没找到的内容可能在后面，拿不准时用 `curl -sL <page>` 看完整页面。
- 打不开页面、线上还是旧的、只上了一小部分 → 没上线。

## 4. 记下来

**已上线**：开始复查，上线时间就是现在（核对通过的这一刻）：

```bash
annulo run review.track --input '{"kind":"<kind>","ref_id":"<id>","channel_id":"<channel_id>"}'
```

回复用户：线上已经是新的（列出线上现在的标题和描述，或者找到了哪些新内容），复查已经开始，大约 17 天后出结果（上线后第 3 天起再取 14 天的数据，和上线前 14 天比），结果在「搜索表现」的「改动复查」里。

**没上线**：不要调 `review.track`，页面状态保持「已改，待上线」。回复用户：线上现在是什么（标题、描述，或者缺了哪些内容），可能是改动还在预览、没发布，发布后再点一次「已上线，开始复查」。
用户在对话里坚持说已经上线了（比如线上被 CDN 缓存、你看到的是旧的），照用户说的调 `review.track`。

## 规则

- 只读、只记复查，不改站点代码，不发布站点；
- 用界面语言回复。
