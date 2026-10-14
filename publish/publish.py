#!/usr/bin/env python3
"""发布本仓库的模板：main 上是源码（core/ + 每个模板自己的文件），组装好的成品提交到 release 分支、在那里打 tag。

  python3 publish/publish.py <模板> --local [项目目录] [--push]      用工作区的改动试到本地项目（不用提交、不发版）
  python3 publish/publish.py release --note "What changed" --tag v0.14.0   组装、提交到 release 分支、打 tag
                                                               （先在改了的模板的 changelog.yaml 最上面写这一版的各语言说明；--note 只写英文）
  python3 publish/publish.py release --dry-run                  只组装、列出 release 分支会改哪些文件
  python3 publish/publish.py release --only product …           只更新指定模板，其他模板保留 release 上已发布的文件

Annulo 只读 tag（不读 main）：每个 tag 上要是拼好的成品，Annulo 照 tag 上的目录原样复制、按 tag 升级项目。
所以 tag 都打在 release 分支上，release 分支只由这个脚本提交，不在那里改。
步骤：
  1. git archive HEAD 取 core/ 和模板目录（只用已提交的内容；HEAD 要已经推到 origin/main，协作者拿得到同一份）；
  2. 每个模板按 targets.json 组装（lib.compose），整目录换掉 release 分支上的同名目录（在 .build/release 的 worktree 里），README、LICENSE 跟 main 一样；
  3. 用 GitHub 的作者名 bysir 提交、推送 release，打 tag、推 tag；
  4. 帮助手册同步到官网并上线（同级 shuttle-site 的 scripts/sync-help.py；官网有别的没发布的改动时它会停下）。
"""

import argparse
import json
import re
import shutil
import subprocess

import lib

ROOT = lib.REPO
BUILD = ROOT / '.build'
RELEASE = 'release'
# 提交作者：GitHub 上的名字，不用 zhangliang
AUTHOR = ['-c', 'user.name=bysir', '-c', 'user.email=zbysir@qq.com']
REPO_URL = 'https://github.com/annulo/templates'
TARGETS = json.loads((ROOT / 'publish' / 'targets.json').read_text())
SHARED = ('README.md', 'LICENSE')  # release 分支根目录跟 main 一样的文件


def git(*a, cwd=ROOT, check=True, capture=True):
    return lib.run(['git', *a], cwd=cwd, check=check, capture=capture)


def site(name):
    """Annulo 记在项目 template 分支里的模板站点（见 Annulo 的 internal/wsgit/gitsource.go）"""
    return f'git:{REPO_URL}#{name}'


def compose(name, everything, where):
    return lib.compose(f'{name}/', TARGETS[name], everything, where)


def check_changelog(everything, tag, selected):
    """打 tag 前检查升级说明：至少一个模板的 changelog.yaml（已提交的）写了这一版，tag 说明只写英文。
    Annulo 的升级卡片按界面语言读 changelog.yaml（见 Annulo 的 internal/wsgit/changelog.go），tag 说明只在文件里没有这一版时显示。
    没改动的模板不用写这一版。"""
    if not re.fullmatch(r'v\d+\.\d+\.\d+', tag):
        raise SystemExit('tag 要是 semver：v1.2.3（预发布的 tag Annulo 不认）')
    if not any(lib.changelog_has(everything.get(f'{n}/changelog.yaml', b''), tag[1:]) for n in selected):
        raise SystemExit(f'没有一个模板的 changelog.yaml 写了 {tag[1:]}：在改了的模板的 <模板>/changelog.yaml 最上面加一条'
                         f'（version、zh、en……），提交、推送后再发；tag 说明（--note）只写英文')


def head(dry_run):
    """要发的提交：HEAD，必须已经推到 origin/main（先提交推送、再发布；--dry-run 只提醒）"""
    h = git('rev-parse', 'HEAD')
    dirty = git('status', '--porcelain')
    if dirty:
        lib.warn('工作区有没提交的改动，这些不会发布（只发已提交的内容）：\n' + '\n'.join('   ' + l for l in dirty.splitlines()))
    git('fetch', '-q', 'origin')
    if subprocess.run(['git', 'merge-base', '--is-ancestor', h, 'origin/main'], cwd=ROOT).returncode != 0:
        msg = f'HEAD {h[:8]} 还不在 origin/main 上：先 git push（发布前要先提交、推送，协作者拿得到同一份代码）'
        if not dry_run:
            raise SystemExit(msg)
        lib.warn(msg)
    return h


def release(note, tag, dry_run, only):
    selected = only or sorted(TARGETS)
    h = head(dry_run)
    everything = lib.commit_files(ROOT, h)
    if tag:
        check_changelog(everything, tag, selected)
        if git('tag', '-l', tag) or git('ls-remote', '--tags', 'origin', f'refs/tags/{tag}'):
            raise SystemExit(f'tag {tag} 已经有了')
    products = {n: compose(n, everything, f'提交 {h[:8]} ') for n in selected}
    # release 分支的 worktree：每次从 origin/release 重新开始
    wt = BUILD / 'release'
    if not (wt / '.git').exists():
        if wt.exists():
            shutil.rmtree(wt)
        git('worktree', 'prune')
        git('worktree', 'add', '-q', '--detach', wt, f'origin/{RELEASE}')
    w = lambda *a, check=True: git(*a, cwd=wt, check=check)
    w('checkout', '-q', '--detach', f'origin/{RELEASE}')
    w('reset', '-q', '--hard')
    w('clean', '-qfdx')
    for name, files in products.items():
        out = wt / name
        if out.exists():
            shutil.rmtree(out)
        for rel, data in files.items():
            f = out / rel
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(data)
        print(f'== {name}：{len(files)} 个文件', flush=True)
    for p in SHARED:
        if p in everything:
            (wt / p).write_bytes(everything[p])
    w('add', '-A')
    stat = w('diff', '--cached', '--stat')
    print(stat or 'release 分支没有变化')
    if dry_run:
        w('reset', '-q', '--hard')
        print(f'（--dry-run：没有提交；产物在 {wt}）')
        return
    if stat:
        lib.run(['git', *AUTHOR, 'commit', '-q', '-m', f'{note}\n\nBuilt from main {h[:8]}'], cwd=wt)
        w('push', '-q', 'origin', f'HEAD:{RELEASE}')
    if tag:
        lib.run(['git', *AUTHOR, 'tag', '-a', tag, '-m', note], cwd=wt)
        w('push', '-q', 'origin', tag)
        print(f'发了 {tag}：用户的项目在 设置 → 项目 里能升级')
        lib.sync_site_help(ROOT.parent)
    elif stat:
        lib.warn('只推了 release 分支、没打 tag：用户拿不到这次改动，发版本带 --tag vX.Y.Z')


def main():
    ap = argparse.ArgumentParser(description='发布 github.com/annulo/templates 的模板（main 是源码，成品在 release 分支）')
    ap.add_argument('target', choices=sorted(TARGETS) + ['release'], help='模板名（和 --local 一起用），或 release：组装全部模板、打 tag')
    ap.add_argument('--tag', help='和 release 一起用：打这个 semver tag（v1.2.3），tag 说明用 --note（英文）；changelog.yaml 要先写好这一版')
    ap.add_argument('--note', help='版本说明（英文）：升级卡片按界面语言读模板的 changelog.yaml，这里只在文件里没有这一版时显示')
    ap.add_argument('--dry-run', action='store_true', help='只组装、列出 release 分支会改哪些文件')
    ap.add_argument('--only', nargs='+', choices=sorted(TARGETS), help='和 release 一起用：只更新指定模板，保留其他模板已发布的文件')
    ap.add_argument('--local', nargs='?', const='', metavar='项目目录', help='用工作区的改动试到本地项目（默认 Annulo 当前打开的项目），不提交、不发版')
    ap.add_argument('--push', action='store_true', help='和 --local 一起用：写完 annulo push 推到 creght（改了 backend/func 时要；页面不用推）')
    a = ap.parse_args()
    if a.local is not None:
        if a.target == 'release':
            raise SystemExit('--local 要写具体的模板名（creator、product……）')
        theirs = compose(a.target, lib.worktree_files(ROOT, ['core/', f'{a.target}/']), '工作区')
        lib.apply_local(a.target, theirs, a.local, a.push, [site(a.target)], BUILD)
        return
    if a.target != 'release':
        raise SystemExit(f'发布是几个模板一起：python3 publish/publish.py release --note … --tag vX.Y.Z（只更新 {a.target} 加 --only {a.target}）；试到本地项目加 --local')
    if not a.dry_run and not a.note:
        raise SystemExit('发布要带 --note（英文）「这版改了什么」：提交说明和 tag 说明用它，升级卡片读 changelog.yaml（只看改动用 --dry-run）')
    if a.note and re.search(r'[一-鿿]', a.note):
        raise SystemExit('--note 只写英文：各语言的升级说明写在 <模板>/changelog.yaml')
    release(a.note, a.tag, a.dry_run, a.only)


if __name__ == '__main__':
    main()
