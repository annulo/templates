---
name: 在这篇上做
description: 在一篇文章上照用户的要求做事：照稿子写正文、配图、做封面、做视频……写正文用 content.update，做出来的文件 annulo upload --local 后用 assets.add 存成这篇的产物；用户在这段对话里接着改
---

参数：`article_id` 是这篇文章，`note` 是用户这次的要求（多半来自一条 AI 预设，用户可能改过）。**照 `note` 做，做什么都由它定**：可能是写这篇的正文，可能是做一组图、一条视频、一个网页，也可能两样都要。

## 1. 拿上下文

```bash
annulo run work.context --input '{"article_id":"<article_id>"}'
```

| 字段 | 是什么 |
|---|---|
| `article` | 这篇：`type`（长文 article / 图文 post / 视频 video）、`title`、**`draft` 稿子**、**`body` 正文**（长文另有 `html`）、`tags`、`images`（图文的配图）、`video`（视频文章发布用的视频） |
| `type_note` | 这种类型的正文字段怎么填 |
| `source` | 改写自哪篇（没有是 null）：它的稿子和正文 |
| `artifacts` | 这篇已有的产物：`ref`（`@assets:<id>`）、`note` 备注、`files`、`in_use`（正在发布用的） |
| `platforms` | 这种类型在用户各平台的限制：标题、正文、话题、配图张数上限；视频的 `video` 是 `only`（只发视频）还是 `optional` |
| `project` | 我的定位（语气、写给谁、不写什么） |

**稿子**是作者的工作稿（为什么写这篇、大纲、草稿、剧本、分镜），不发出去；**正文**是发出去的内容。两个都给你，读哪个、怎么用你自己定。用户没让写稿子就不改稿子。

## 2. 写正文（要求里要写的时候）

照用户的写作要求写（用户改过的在 `user/prompts/write-article.md`，没改过用 `prompts/write-article.md`，看和这篇类型对应的那一节），字段格式照 `type_note`，字数、话题个数不超过 `platforms` 里最严的那个。不编造稿子和定位里没有的数据、案例、经历。写成 JSON 文件再存，只传要改的字段：

```bash
cat > /tmp/article-update.json <<'JSON'
{ "article_id": "<article_id>", "title": "标题", "body": "正文", "tags": ["话题"] }
JSON
annulo run content.update --input @/tmp/article-update.json
```

## 3. 做文件（要求里要图、视频、网页的时候）

- **用什么做由你定**：图片可以用模型生成、用代码画（HTML + 截图、Pillow…）；视频可以用 Remotion、ffmpeg……`note` 里指定了就用它。缺的工具自己装（npm、pip、brew），装了什么在回复里说。
- **工程和中间文件放哪**照系统提示里「工作文件放哪」：不要放进项目目录。同一个项目同一类东西共用一个工程（比如那个目录的 `video/`、`images/` 下），每篇一个子目录，用文章 id 命名，用户在这段对话里接着改时在这里接着做；路径不要写进表里。
- 尺寸按平台：小红书、抖音竖屏 3:4 / 9:16，YouTube、B 站横屏 16:9；图文的张数不超过 `platforms` 的 `images_max`。视频 60 秒左右、开头 3 秒说清讲什么（`note` 没说的时候）。
- 画面里的文字只用稿子、正文和定位里有的，`project` 里「不写什么」的不碰。做完自己看一遍：图片文字有没有出界、被裁、太小；视频抽几帧看。
- 做不成（工具装不上、渲染一直失败）就在回复里说清卡在哪、要用户做什么，不存半成品。

存进项目，再存成这篇的产物（**一次做出来的一组存一条**，比如 6 张图一条；`note` 是备注：做了什么、用了什么工具，不写路径）：

```bash
annulo upload --local 1.png 2.png 3.png        # 每个文件打印一个 local:<name>，按顺序
annulo run assets.add --input '{"urls":["local:<1>","local:<2>","local:<3>"],"article_id":"<article_id>","note":"<备注>","use":true}'
```

`use: true` 把它用到这篇上：视频文章设成发布用的视频，图文把这组图换成配图。长文的图不用 `use`：要插进正文，用 `annulo upload <图>`（不加 `--local`）拿地址，再用第 2 步的 `content.update` 写进正文的 `<img>`，产物里也照样存一份。

## 4. 回复

说做了什么（写了哪些字段、做了几个文件、什么尺寸、用了什么工具），给出链接 `[打开「标题」](/?view=content&article=<article_id>)`，说一句「要改就在这里直接说」。

## 5. 用户在这段对话里接着改

用户看完会回到这段对话里接着说（文章页的「继续对话」打开的就是这里），也可能在别的对话里引用它（`@articles:<id>`、`@assets:<id>`、`@assets:<id>#3`，消息后面有 `<references>`）。

- **整组重做**（「换一种风格再来一组」「视频重做」）：存一个新的产物（`assets.add`），旧的留着。
- **只改其中一个**（「@assets:<id>#3 背景换成白色」「第 2 张字太小」）：改好这一个，存进来，**改原来那组**：

  ```bash
  annulo upload --local new-3.png
  annulo run assets.replace --input '{"asset_id":"<id>","n":3,"url":"local:<name>","note":"第 3 张背景改成白色"}'
  ```

  这篇里用着旧那张的地方（配图、视频）会一起换。
- **改正文**：`content.update`，只改用户提到的。
- 只改用户提到的，别的保持不变。用户说的不是改这篇（问问题、要换个选题），照常回答。
