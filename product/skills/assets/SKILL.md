---
name: assets
description: 资料库：图片、视频地址和常用文字，写内容、写社媒帖子配图时复用。用户让你找图、配图、存一段常用话术时用它。
---

# 资料库

`assets` 表一行一个素材：`kind`（image / video / text）、`url`（图片、视频的地址：在线项目是 https，离线项目是本机的 `/_annulo/uploaded/…`）、`text`（文字素材）、`name`、`tags`（JSON 数组字符串）、`source`、`created_at`。

- 用户在「资料库」页上传文件（`source: "upload"`）、贴地址或写文字添加；写社媒帖子时编辑框里能「从资料库选」配图，选的时候也能当场上传（写进 `social_posts.images`）。
- 用户让你找图、配图时先查 `assets`（`db_query`，按 `tags`、`name` 筛）。
- 你整理出来的图片地址、常用话术也可以存进去：`annulo run records.create --input '{"table":"assets","data":{"kind":"text","name":"…","text":"…","tags":"[\"…\"]","source":"agent"}}'`。
- 你手上有本机的图（自己生成的、下载的、用户附在对话里的）：先 `annulo upload <文件…>` 拿地址（和「资料库」页上传是同一条路），
  再 `annulo run records.create --input '{"table":"assets","data":{"kind":"image","url":"<拿到的地址>","name":"…","tags":"[\"…\"]","source":"agent"}}'`。
  地址原样存，不要自己补主机和端口；不要把本机路径（`/Users/…`、`/tmp/…`）写进 `url`。
- 本机的大视频不用进资料库：写帖子时在编辑框里「上传本机视频」，存在这台电脑上（`local:<name>`），发布时本机浏览器直接用。
