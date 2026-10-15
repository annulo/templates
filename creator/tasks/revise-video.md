---
name: 改视频
description: 按用户的意见改一条视频，存成新版本：video.start 在某一版上开新版本，改好渲染，annulo upload --local 存进来，video.finish 记下成片
---

参数：`article_id` 是视频文章，`version_id` 是在哪一版上改（没给就是当前版），`note` 是用户这次的意见（可能来自一条 AI 预设；空的就是「文档改了，照新文档重做」）。

## 1. 开一个新版本，拿上下文

```bash
annulo run video.start --input '{"article_id":"<article_id>","version_id":"<version_id，没给就不传>","note":"<note 原文>"}'
```

返回的字段和 `tasks/make-video.md` 第 1 步一样，另外有：

| 字段 | 是什么 |
|---|---|
| `base` | 在哪一版上改：`n`、`prompt`（那一版的要求）、`notes`（做那一版时记下的怎么做）、`file`、`duration`、`width`、`height`、`doc_snapshot`（那一版照的文档）。为空说明还没有做好的版本，照 `make-video` 从头做 |
| `doc_changed` | 文档在那一版之后改过：照新的 `doc` 改，改动的地方要体现出来 |
| `history` | 从第 1 版到 `base` 每一版的要求，看得出这条视频是怎么一步步改成现在这样的 |
| `video` | 视频文章现在的标题、简介、话题、分区 |

`video.start` 成功后，不管改没改成都要跑一次 `video.finish`。

## 2. 改

- **在 `base` 那一版上改**：照 `tasks/make-video.md` 第 2 步的规则找到这条视频的工程（视频工程下以 `video_article_id` 命名的子目录），从 `base` 那一版的状态接着改；你在那里留了每一版的源码最好（比如按版本号存一份，或者用 git 提交），没有的话以 `base` 的成片为准。工程找不到，就照 `base.doc_snapshot`、`history` 和这次的意见重新做出和那一版接近的样子再改，并在 `notes` 里说明。
- **只改意见里提到的**：没提到的镜头、文字、节奏、尺寸保持和 `base` 一样，不要借机大改。`doc_changed` 为真时，文档改了的地方也跟着改。
- 工具、工作文件放哪、内容规则、渲染后自查，都和 `tasks/make-video.md` 第 2 步一样。

## 3. 存进项目、记下结果

和 `tasks/make-video.md` 第 3、4 步一样：`annulo upload --local <成片.mp4>`，再 `annulo run video.finish`。
`notes` 写这一版改了什么（不写路径）；标题、简介、话题没变就不传。

最后回复用户：这一版改了什么，给出链接 `[打开「标题」](<link>)`。
