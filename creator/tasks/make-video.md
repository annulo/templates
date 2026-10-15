---
name: 做成视频
description: 照一篇文档做一条视频：video.context 拿文档和平台，在这台电脑上把视频做出来，annulo upload --local 存进来，content.save 建视频文章，assets.add 放进资料库；用户在这段对话里接着改，每改一次存一个新的
---

参数：`article_id` 是照着做的文档（内容中心里的一篇文章：长文、图文笔记，或从 Notion 导入的），`note` 是用户这次的要求（可能来自一条 AI 预设，可以是空的）。

## 1. 拿上下文

```bash
annulo run video.context --input '{"doc_id":"<article_id>"}'
```

| 字段 | 是什么 |
|---|---|
| `doc` | 文档：`title`、`type`、`summary`、`text`（纯文字）。**视频照它做**：结构、要点、措辞都从这里来；文档里写了分镜、时间码就照着做 |
| `platforms` | 要发的平台，只发视频的在前：`video` 是 `only`（YouTube、抖音、B 站）还是 `optional`；`title_max`、`body_max`、`tags_max` 是标题、简介、话题的上限 |
| `project` | 我的定位（语气、写给谁、不写什么） |

## 2. 把视频做出来

照 `note` 做，`note` 是空的就照常规做：按 `platforms` 排在最前面的平台定横竖屏（抖音、小红书 9:16 竖屏，YouTube、B 站 16:9 横屏）；60 秒左右；开头 3 秒说清这条视频讲什么。

- **用什么做由你定**：Remotion、ffmpeg、HTML 动画录屏……`note` 里指定了就用它。这台电脑上缺的工具自己装（npm、pip、brew），装了什么在回复里告诉用户。
- **工程和中间文件放哪**照系统提示里「工作文件放哪」：不要放进项目目录。同一个项目做视频共用一个工程（放在那个目录的 `video/` 下），每条视频一个子目录，用文档的 id 命名，用户在这段对话里接着改时在这里接着做；路径不要写进表里。
- 画面里的文字、旁白只用文档和定位里有的信息，不编造数据、案例、经历；`project` 里「不写什么」的不碰。
- 用户的素材可以用：`annulo run content.images` 列出资料库里的图片（网址）。不要去翻 Annulo 的数据目录。
- 没有配音工具时做成字幕 + 画面的版本，在回复里说明可以接什么配音。
- 渲染出 mp4（H.264），先自己看一遍：抽几帧截图看文字有没有出界、被裁、太小，时长对不对。有问题改了再渲染。

**做不成**（工具装不上、渲染一直失败）就在回复里说清卡在哪、要用户做什么，不要存半成品。

## 3. 存进项目

```bash
annulo upload --local <成片.mp4>
```

打印 `local:<name>`：视频复制进了项目在这台电脑上的文件，不传云端。

## 4. 建视频文章、放进资料库

先建视频文章（`title`、`body`、`tags`、`category` 是发布用的标题、简介、话题、B 站分区，按 `platforms` 里最严的上限写；简介是纯文字，讲清这条视频看什么）：

```bash
cat > /tmp/video-article.json <<'JSON'
{ "type": "video", "source_id": "<article_id>", "title": "视频标题", "body": "视频简介", "tags": ["话题"], "video": "local:<name>" }
JSON
annulo run content.save --input @/tmp/video-article.json
```

再把成片放进资料库，挂在这篇视频文章上（`note` 是备注：怎么做的、用了什么工具、有几个镜头，给用户和下一次改的你看，不写路径）：

```bash
annulo run assets.add --input '{"url":"local:<name>","article_id":"<content.save 返回的 article_id>","note":"<备注>","use":true}'
```

回复用户：做成了什么样（时长、尺寸、几个镜头）、用了什么工具，给出链接 `[打开「标题」](/?view=content&article=<视频文章的 article_id>)`，说一句「要改就在这里直接说，每改一次存一个新的，旧的都留着」。

## 5. 用户在这段对话里接着改

用户看完会回到这段对话里接着说（视频文章页的「继续对话」打开的就是这里），也可能在别的对话里说「把某条视频改一下」（这时先用 db_query 查 `assets` 里 `article_id` 是那篇视频文章的几条，看备注，问清楚在哪个上改、改什么）。**每改一次存一个新的，旧的留着**：

1. 在工程里改，**只改用户提到的**，别的保持不变；用户说「在之前那个上改」就从那个的状态接着改。渲染、自查照第 2 步。
2. `annulo upload --local <新的成片.mp4>`；
3. `annulo run assets.add --input '{"url":"local:<name>","article_id":"<视频文章的 id>","note":"<这次改了什么>","use":true}'`。不用再建视频文章；标题、简介要跟着改就用 `content.update`（`{"article_id":"…","title":"…","body":"…"}`）。

用户说的不是改视频（问问题、要换个选题），照常回答。
