---
name: AI 推荐竞品
description: 用户还没有竞品、或想多找几家：读项目资料和产品，看 AI 搜索里引用了哪些别家、谷歌上搜这些词排在前面的是谁，自己联网搜、打开官网核实，推荐 5~8 家同行，存成候选等用户确认
---

## 1. 拿上下文

```bash
annulo run competitors.suggestContext --input '{}'
```

输出里：

- `project`：项目定位（主营、优势、客户类型、重点市场……），`products`：产品目录（名称、类目、关键词）；
- `own_sites`：自己的网站域名，不能推荐；
- `existing`：已经有的竞品（`status`：active 在盯、paused 暂停、suggested 推荐过还没确认、rejected 用户说不要），这些域名都不要再推荐；
- `geo_domains`：AI 搜索检测里，买家问 AI 时回答引用到的别家域名（`count` 被引用几次、`questions` 是哪些问题），已经去掉了电商平台和媒体，是最直接的线索；
- `search_queries`：谷歌上给我们带来曝光的搜索词，拿去搜，看排在前面的是谁。

`project` 和 `products` 都是空的：告诉用户先到「公司与产品」填公司资料或加几个产品，不往下做。

## 2. 找

用你自己的联网搜索，按买家找供应商的方式搜，用重点市场的语言（多半是英文）：

- 主营产品 + manufacturer / supplier / factory，加上 OEM、wholesale、重点市场国家名这些买家会带的词；
- `search_queries` 里的词；
- `geo_domains` 里被引用多的，先打开看是不是同行。

对每个候选，打开官网（`curl -sL <网址>` 或你的网页工具）核实：做的是不是同类产品、卖给的是不是同样的客户、网站是不是还在。打不开、只是资讯站或目录站的不要。

按和我们的关系分：

- `direct`：同类工厂、供应商（和我们抢同一批买家，最该盯）；
- `brand`：做同类产品的品牌商（买家拿来比价、比规格）；
- `channel`：渠道商、分销商（可能也是我们的潜在客户，写在 reason 里）。

推荐 5~8 家，`direct` 优先，最多一两家 `brand`、`channel`。

## 3. 存

```bash
cat > /tmp/suggest.json <<'JSON'
{ "items": [
  { "url": "https://example.com", "name": "Example Co.", "kind": "direct", "reason": "一句话：做什么、为什么算竞品（比如：同样做商用自助点餐机，主打欧洲餐饮连锁，有 OEM）", "evidence": "在哪里看到它：搜索词「…」排第 2 / ChatGPT 回答「…」引用了它" }
] }
JSON
annulo run competitors.saveSuggestions --input @/tmp/suggest.json
```

`url` 写官网首页；`reason`、`evidence` 用界面语言写，要具体，不写「同行业公司」这种空话。输出的 `skipped` 是已经有或不能推荐的，不用管。

存完回复用户：推荐了哪几家（一句话一家），请到「竞品监控」里看「AI 推荐的竞品」，觉得对的点「加进监控」，不对的点「不要」。**只存候选，不要替用户加进监控**（不调 `competitors.accept` / `competitors.add`）。
用户在这段对话里说「再找几家」「不要渠道商」，照意见再找、再存一次（已经推荐过的会自动跳过）。

## 规则

- 不推荐电商平台、B2B 平台（阿里巴巴、中国制造网、亚马逊……）、媒体、百科、目录站、社交网站；平台上的店铺也不推荐（盯不了网站地图）；
- 不编造公司和网址：每家都要真的打开过官网；
- 用界面语言回复。
