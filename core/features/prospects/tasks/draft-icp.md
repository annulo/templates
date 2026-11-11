---
name: 分析客户画像
description: 读公司资料、产品和企业资料（需要时看官网），写出理想客户画像（ICP：什么行业、哪些地区、多大规模、找谁、排除谁），转成找买家官网的 Google 搜索词和 Apollo 的筛选条件，存成一个待确认的获客批次；用户在「主动获客」页确认后开始找
---

参数：`batch_id`（可选）是要改的批次；`note` 是用户这次的要求（比如「这次只找德国的零售连锁」）。

## 1. 拿上下文

```bash
annulo run profile.context --input '{}'
annulo run products.list --input '{}'
annulo run knowledge.search --input '{"q":"<主营产品 应用 客户>"}'
annulo run prospects.list --input '{}'
```

公司资料里的 `customer_types`（客户类型）、`markets`（市场）、`buyer_concerns` 最重要；`prospects.list` 里的 `batch` 是上一批的画像和条件（`batch_id` 给了就改这一批），可以在它的基础上调。
信息不够时 `curl -sL <官网>` 看看。

## 2. 写客户画像（`icp`）

用用户的界面语言：

```json
{
  "summary": "一句话：我们要找什么样的公司里的什么人",
  "industries": ["行业 / 细分"],
  "regions": ["国家或地区"],
  "company_size": "员工规模，比如 11-200",
  "roles": ["要找的职位：采购经理、产品经理、老板…"],
  "buying_signals": ["什么样的公司更可能买：在卖相关产品、在做某类项目…"],
  "exclude": ["要排除的：同行工厂、服务商…"]
}
```

## 3. 写 Google 搜索词（`queries`）

用来**从企业官网反查买家**：在 Google 上搜，挑出买家公司的官网，读联系方式。写 8~15 个**英文**搜索词，一个词一行：

- 「产品 / 品类 + 买家类型 + 国家」：`LED panel light distributor Germany`、`commercial lighting wholesaler UK`、`kiosk system integrator Netherlands`；
- 买家类型从画像来：importer、distributor、wholesaler、dealer、reseller、retailer、system integrator、contractor…；
- 也可以用买家网站上常见的话：`"authorized dealer" pos terminals Australia`、`"we supply" LED lighting projects Dubai`；
- 加 `-alibaba -made-in-china -amazon` 去掉平台；**不要**写 `manufacturer`、`factory`、`supplier China`（搜出来的是同行）；
- 每个画像里的重点国家都要有词，一个国家 2~4 个。

## 4. 转成 Apollo 筛选条件（`filters`）

用户有 Apollo 付费套餐时用（按职位找具体的人）。都用**英文**，字段只能是这几个：

- `person_titles`：职位关键词（5~12 个），如 `procurement manager`、`purchasing manager`、`sourcing manager`、`product manager`、`owner`；
- `person_seniorities`：只能从 `owner` `founder` `c_suite` `partner` `vp` `head` `director` `manager` `senior` `entry` `intern` 里选；
- `person_locations`：国家或城市英文名，如 `Germany`、`United States`；
- `organization_num_employees_ranges`：只能从 `1,10` `11,20` `21,50` `51,100` `101,200` `201,500` `501,1000` `1001,2000` `2001,5000` `5001,10000` `10001,` 里选；
- `q_organization_keyword_tags`：公司行业 / 业务关键词（3~8 个），如 `retail`、`pos`、`kiosk`、`education technology`；
- `q_keywords`：可选，一个补充关键词。

条件别太窄（一个批次能找到上百人才有得挑），也别太宽（只写一个泛泛的行业词）。

## 5. 存

```bash
cat > /tmp/icp.json <<'JSON'
{ "batch_id": "<参数里的，没有就不传>", "name": "<批次名，比如：德国零售 POS 采购>", "icp": { … }, "queries": [ … ], "filters": { … } }
JSON
annulo run prospects.saveIcp --input @/tmp/icp.json
```

新批次默认「搜官网」（不要账号，用用户自己的 Chrome 搜 Google）；改已有批次时不传 `source`，保留用户选的找法。

存完回复用户：客户画像的一句话、搜索词的要点，请到「客户 → 主动获客」确认，再点「开始获客」：搜官网要开着 Chrome、装着 Annulo 插件；有 Apollo 付费套餐的也可以在页面上换成 Apollo 找人。
