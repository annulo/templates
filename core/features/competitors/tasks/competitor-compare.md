---
name: 竞品规格对比
description: 拉一家竞品的产品线，挑和我们最接近的机型，逐项和我们的产品对比（规格、认证、起订量、价格口径、卖点），找出我们的优势和差距，给出对标文章的选题，存成一份竞品分析
---

参数：`id` 是要对比的竞品（competitors 表）。

## 1. 拿数据

```bash
annulo run competitors.pages --input '{"id":"<id>","kind":"product"}'
```

产品页太少（有的站产品不在 /product/ 下）就不带 `kind` 再看一遍。挑和我们最接近的几页 `curl -sL <网址>` 读规格（型号、尺寸、配置、认证、起订量、交期、价格、产地）。

我方：`annulo run products.list --input '{}'` 和 `annulo run knowledge.search --input '{"q":"<型号或参数关键词>"}'`。

## 2. 写

用用户的界面语言，Markdown：

1. **竞品产品线**：一张表，型号、类别、主要规格、链接（最多 20 行）；
2. **逐项对比**：挑 1~3 款最接近的，和我方对应的机型列一张对比表（我方 / 竞品，每项一行），竞品没写的写「未公开」，我方资料没有的写「待补」；
3. **我们的优势和差距**：各 3 条以内，要具体；
4. **对标文章**：2~3 个选题（比如「A vs B：xx 场景怎么选」），每个一句话角度。

竞品的参数只是竞品的，**不能变成我方产品的事实**；我方没有的参数写「待补」，告诉用户去补。

## 3. 存

```bash
cat > /tmp/report.json <<'JSON'
{ "title": "规格对比：<竞品名>", "body": "<Markdown 全文>", "competitor_ids": ["<id>"] }
JSON
annulo run competitors.saveReport --input @/tmp/report.json
```

对标选题问用户要不要存（`topics.save`，`source` 填 `competitor`，`origins` 写比的是哪几个竞品：`[{"type":"competitor","id":"<竞品 id>"}]`）。要直接写，就照任务 `tasks/write-article.md` 写，主题用这个选题。
