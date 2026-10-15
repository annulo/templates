---
name: 做成视频
description: 照一篇文档做一条视频：video.start 建视频文章和第 1 版，在这台电脑上把视频做出来，annulo upload --local 存进来，video.finish 记下成片
---

参数：`article_id` 是照着做的文档（内容中心里的一篇文章：长文、图文笔记，或从 Notion 导入的），`note` 是用户这次的要求（可能来自一条 AI 预设，可以是空的）。

## 1. 开一个版本，拿上下文

```bash
annulo run video.start --input '{"doc_id":"<article_id>","note":"<note 原文>"}'
```

它新建一篇视频文章（`source_id` 指回文档）和它的第 1 版（制作中），返回：

| 字段 | 是什么 |
|---|---|
| `video_article_id`、`version_id`、`n` | 新视频文章、这一版、第几版。后面存结果要用 `version_id` |
| `doc` | 文档：`title`、`type`、`summary`、`text`（纯文字）。**视频照它做**：结构、要点、措辞都从这里来；文档里写了分镜、时间码就照着做 |
| `note` | 这次的要求 |
| `platforms` | 要发的平台：`video` 是 `only`（只发视频：YouTube、抖音、B 站）还是 `optional`；`title_max`、`body_max`、`tags_max` 是标题、简介、话题的上限 |
| `project` | 我的定位（语气、写给谁、不写什么） |
| `link` | 视频文章的页面地址 |

`video.start` 报错就照报错改了再跑；它一旦成功，后面不管做没做成都要跑一次 `video.finish`（见第 4 步），不然页面上这一版一直是「制作中」。

## 2. 把视频做出来

照 `note` 做，`note` 是空的就照常规做：抖音、小红书用 9:16 竖屏，YouTube、B 站用 16:9 横屏，几个平台都有时以排在前面的为准；60 秒左右；开头 3 秒说清这条视频讲什么。

- **用什么做由你定**：Remotion、ffmpeg、HTML 动画录屏……`note` 里指定了就用它。这台电脑上缺的工具自己装（npm、pip、brew），装了什么在回复里告诉用户。
- **工程和中间文件放哪**照系统提示里「工作文件放哪」：不要放进项目目录。同一个项目做视频共用一个工程（放在那个目录的 `video/` 下），每条视频一个子目录，用视频文章的 id（`video_article_id`）命名，下次改版照这个规则就能找回来；渲染完把这一版的源码留一份（按版本号 `v<n>` 存，或者用 git 提交），以后能从任意一版接着改。路径不要写进表里。
- 画面里的文字、旁白只用文档和定位里有的信息，不编造数据、案例、经历；`project` 里「不写什么」的不碰。
- 用户的素材可以用：`annulo run content.images` 列出资料库里的图片（网址）。不要去翻 Annulo 的数据目录。
- 没有配音工具时做成字幕 + 画面的版本，在回复里说明可以接什么配音。
- 渲染出 mp4（H.264），先自己看一遍：抽几帧截图看文字有没有出界、被裁、太小，时长对不对。有问题改了再渲染。

## 3. 存进项目

```bash
annulo upload --local <成片.mp4>
```

打印 `local:<name>`：视频复制进了项目在这台电脑上的文件，不传云端。

## 4. 记下结果

写成 JSON 文件再存（`title`、`body`、`tags`、`category` 是视频文章发布用的标题、简介、话题、B 站分区，按 `platforms` 里最严的上限写；简介是纯文字，讲清这条视频看什么）：

```bash
cat > /tmp/video-finish.json <<'JSON'
{
  "version_id": "<version_id>",
  "file": "local:<name>",
  "duration": 58.5,
  "width": 1080,
  "height": 1920,
  "notes": "怎么做的、用了什么工具、有几个镜头（给下一次改版的你看，不写路径）",
  "title": "视频标题",
  "body": "视频简介",
  "tags": ["话题"]
}
JSON
annulo run video.finish --input @/tmp/video-finish.json
```

它把这一版标成做好了、设成这篇视频文章的当前视频，并放进资料库。

**做不成**（工具装不上、渲染一直失败）也要记下原因，页面上这一版显示「没做成」：

```bash
annulo run video.finish --input '{"version_id":"<version_id>","error":"没做成的原因，用户看得懂的一句话"}'
```

最后回复用户：做成了什么样（时长、尺寸、几个镜头）、用了什么工具，给出链接 `[打开「标题」](<link>)`。
