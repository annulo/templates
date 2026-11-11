# business 模块的测试用：按发布的方式组装外贸、产品运营（工作区的文件），插件拷进 plugins/。外贸在同级的 shuttle-template（没有就只组装产品运营）
import sys, json, shutil, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import lib
PUB = Path(__file__).resolve().parents[3]; PRIV = PUB.parent / 'shuttle-template'
out = Path(sys.argv[1])
for name in ['product'] + (['trade'] if (PRIV / 'publish/targets.json').exists() else []):
    if name == 'product':
        cfg = json.loads((PUB / 'publish/targets.json').read_text())['product']
        files = lib.compose('product/', cfg, lib.worktree_files(PUB, ['product/', 'core/']), 'x')
    else:
        cfg = json.loads((PRIV / 'publish/targets.json').read_text())['trade']
        files = lib.compose('templates/trade/', cfg, {**lib.worktree_files(PRIV, ['templates/trade/']), **lib.worktree_files(PUB, ['core/'])}, 'x')
    d = out / name
    if d.exists(): shutil.rmtree(d)
    for p, b in files.items():
        f = d / p; f.parent.mkdir(parents=True, exist_ok=True); f.write_bytes(b)
    shutil.copytree(PUB.parent / 'annulo-plugins-public/social', d / 'plugins/social')
    print(name, len(files))
