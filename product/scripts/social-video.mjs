#!/usr/bin/env node
// 社媒视频的录制工具（新建社媒内容用，设计见 docs/social-create.md）：用本机的 Chrome（无界面）打开网站，按分镜滚动、逐帧截图，ffmpeg 合成视频。
// 不装 npm 包：Chrome 的调试协议（CDP）直接走 WebSocket（要 Node 22 以上）。只读公开网页，用一个临时的浏览器目录，不碰用户的 Chrome 登录态。
//
//   node scripts/social-video.mjs screens <spec.json>   读网站：一屏一张截图 + 每屏的标题和文字 → <out>/page.json
//     spec: { url, out, width?=1440, height?=1080, max?=10 }
//   node scripts/social-video.mjs record <spec.json>    按分镜录视频 → <out>/video.mp4（还有 frames/，录完删掉）
//     spec: { url, out, name?, width, height, scale?=1, source_height?, fps?=25, accent?, music?, shots: [{ start, end, y_from, y_to, caption?, card?: { title, subtitle? } }] }
//   node scripts/social-video.mjs cover <spec.json>     出封面图 → spec.file
//     spec: { url, file, width, height, scale?=1, source_height?, y, title, subtitle?, accent? }
// source_height：分镜的位置是在多高的页面上量的（竖屏换成手机版网页时按页面高度换算）
//
// 路径都是绝对路径（本机函数 social-create.ts 拼好传进来）。结果打印成一行 JSON；出错打印 { error } 并以 1 退出。

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function chromePath() {
  const env = process.env.ANNULO_CHROME
  const list = [
    env,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
  const found = list.find((p) => p && !p.includes('undefined') && existsSync(p))
  if (!found) throw new Error('没找到 Chrome：请先安装 Google Chrome（或用环境变量 ANNULO_CHROME 指定浏览器程序的位置）')
  return found
}

/** 起一个无界面的 Chrome，连上它的调试接口，开一个标签页 */
async function launch() {
  if (typeof WebSocket === 'undefined') throw new Error(`Node 版本太老（${process.version}）：录视频要 Node 22 以上`)
  const dir = mkdtempSync(join(tmpdir(), 'annulo-video-'))
  const proc = spawn(chromePath(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions', '--force-color-profile=srgb', 'about:blank',
  ], { stdio: 'ignore' })
  const file = join(dir, 'DevToolsActivePort')
  for (let i = 0; i < 150 && !existsSync(file); i++) await sleep(100)
  if (!existsSync(file)) { proc.kill(); throw new Error('Chrome 没有启动起来') }
  const [port, path] = readFileSync(file, 'utf8').trim().split('\n')
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('连不上 Chrome 的调试接口')) })
  let seq = 0
  const pending = new Map(), listeners = []
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data))
    if (msg.id && pending.has(msg.id)) {
      const { ok, bad } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? bad(new Error(msg.error.message)) : ok(msg.result)
    } else if (msg.method) for (const l of listeners) l(msg)
  }
  const send = (method, params = {}, sessionId) => new Promise((ok, bad) => {
    const id = ++seq
    pending.set(id, { ok, bad })
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const page = (method, params) => send(method, params, sessionId)
  await page('Page.enable')
  await page('Runtime.enable')
  const close = () => {
    try { ws.close() } catch {}
    proc.kill()
    setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }) } catch {} }, 500)
  }
  const once = (method, timeout) => new Promise((ok) => {
    const t = setTimeout(() => ok(false), timeout)
    listeners.push((m) => { if (m.method === method && m.sessionId === sessionId) { clearTimeout(t); ok(true) } })
  })
  return { page, close, once }
}

async function evaluate(b, expression) {
  const r = await b.page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result?.value
}

async function open(b, url, width, height, scale = 1) {
  if (!/^https?:\/\//i.test(String(url))) throw new Error(`网址要以 http:// 或 https:// 开头：${url}`)
  await b.page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: width < 600 })
  const loaded = b.once('Page.loadEventFired', 45000)
  await b.page('Page.navigate', { url })
  if (!(await loaded)) throw new Error(`网站 45 秒没打开：${url}`)
  await evaluate(b, 'document.fonts ? document.fonts.ready.then(() => true) : true')
  // 往下滚一遍：懒加载的图、滚到才出现的动效都先触发，再回到顶上
  await evaluate(b, `(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y < h; y += innerHeight / 2) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)) } scrollTo(0, 0); await new Promise(r => setTimeout(r, 600)); return true })()`)
  await evaluate(b, OVERLAY)
}

// 叠在网页上的字幕、片头片尾卡、封面字：在网页里画，字体用系统的（中文不用另找字体文件）
const OVERLAY = `(() => {
  if (window.__annulo) return true
  const font = 'system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
  const el = (css) => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;font-family:' + font + ';' + css; document.documentElement.appendChild(d); return d }
  const cap = el('left:50%;bottom:7%;transform:translateX(-50%);width:max-content;max-width:86vw;text-align:center;color:#fff;font-weight:800;line-height:1.3;padding:.35em .8em;border-radius:.4em;background:rgba(0,0,0,.55);display:none')
  const card = el('inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#fff;padding:8%')
  const cover = el('inset:0;display:none;flex-direction:column;justify-content:flex-end;color:#fff;padding:8% 7%')
  window.__annulo = {
    cap(text, size) { cap.style.fontSize = size + 'px'; cap.textContent = text || ''; cap.style.display = text ? 'block' : 'none'; card.style.display = 'none' },
    card(title, sub, size, accent) {
      card.style.background = 'linear-gradient(135deg,' + accent + ',#111827)'
      card.innerHTML = ''
      const t = document.createElement('div'); t.textContent = title || ''; t.style.cssText = 'font-size:' + size * 1.9 + 'px;font-weight:900;line-height:1.2'
      const s = document.createElement('div'); s.textContent = sub || ''; s.style.cssText = 'margin-top:.8em;font-size:' + size + 'px;opacity:.85;font-weight:600'
      card.append(t, s); card.style.display = 'flex'; cap.style.display = 'none'
    },
    cover(title, sub, size, accent) {
      cover.style.background = 'linear-gradient(180deg,rgba(0,0,0,0) 25%,' + accent + 'cc 58%,' + accent + ' 82%)'
      cover.innerHTML = ''
      const t = document.createElement('div'); t.textContent = title || ''; t.style.cssText = 'font-size:' + size + 'px;font-weight:900;line-height:1.15;white-space:pre-wrap;text-shadow:0 2px 12px rgba(0,0,0,.35)'
      const s = document.createElement('div'); s.textContent = sub || ''; s.style.cssText = 'margin-top:.6em;font-size:' + size * 0.42 + 'px;font-weight:700;opacity:.92'
      cover.append(t, s); cover.style.display = 'flex'; cap.style.display = 'none'; card.style.display = 'none'
    },
  }
  return true
})()`

async function shot(b, file, format = 'jpeg') {
  const { data } = await b.page('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality: 88 } : {}) })
  writeFileSync(file, Buffer.from(data, 'base64'))
}

/** 读网站：一屏一张截图，记下每屏的标题和文字，给页面预览、给 AI 出分镜 */
async function screens(spec) {
  const width = spec.width || 1440, height = spec.height || 1080, max = Math.min(spec.max || 10, 20)
  mkdirSync(spec.out, { recursive: true })
  const b = await launch()
  try {
    await open(b, spec.url, width, height)
    const meta = await evaluate(b, `({ title: document.title, description: document.querySelector('meta[name="description"]')?.content || document.querySelector('meta[property="og:description"]')?.content || '', page_height: document.documentElement.scrollHeight, text: document.body.innerText.slice(0, 8000) })`)
    const count = Math.min(max, Math.max(1, Math.ceil(meta.page_height / height - 0.15)))
    const list = []
    for (let i = 0; i < count; i++) {
      const y = Math.max(0, Math.min(i * height, meta.page_height - height))
      await evaluate(b, `scrollTo(0, ${y})`)
      await sleep(700)
      const info = await evaluate(b, `(() => {
        const fixed = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const p = getComputedStyle(x).position; if (p === 'fixed' || x.matches('nav,header,footer')) return true } return false }
        const inView = (e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.bottom > 0 && r.top < innerHeight && r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && Number(st.opacity) > 0.1 && !fixed(e) }
        const heading = [...document.querySelectorAll('h1,h2,h3')].find(inView)
        const text = [...document.querySelectorAll('h1,h2,h3,h4,p,li,button,a')].filter(inView).map(e => e.innerText.trim()).filter(Boolean)
        return { heading: heading ? heading.innerText.trim().replace(/\\s+/g, ' ') : '', text: [...new Set(text)].join(' / ').replace(/\\s+/g, ' ').slice(0, 400) }
      })()`)
      const file = join(spec.out, `screen-${String(i + 1).padStart(2, '0')}.jpg`)
      await shot(b, file)
      list.push({ n: i + 1, file, y, ...info })
    }
    const out = { url: spec.url, title: meta.title, description: meta.description, width, height, page_height: meta.page_height, text: meta.text, screens: list }
    writeFileSync(join(spec.out, 'page.json'), JSON.stringify(out, null, 2))
    return out
  } finally {
    b.close()
  }
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

function ffmpeg(args) {
  return new Promise((ok, bad) => {
    let err = ''
    const p = spawn(process.env.ANNULO_FFMPEG || 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000) })
    p.on('error', () => bad(new Error('没找到 ffmpeg：Mac 上用 brew install ffmpeg 安装，Windows 用 winget install ffmpeg')))
    p.on('close', (code) => (code === 0 ? ok() : bad(new Error('ffmpeg 合成失败：' + err.split('\n').slice(-6).join(' ')))))
  })
}

/** 按分镜录：每一帧滚到该在的位置、换上这一镜的字幕，截一张；最后 ffmpeg 合成 */
async function record(spec) {
  const width = spec.width, height = spec.height, scale = spec.scale || 1, fps = spec.fps || 25
  if (!width || !height) throw new Error('要给出视频的宽高')
  const shots = (spec.shots || []).filter((s) => Number(s.end) > Number(s.start))
  if (!shots.length) throw new Error('分镜是空的')
  const accent = spec.accent || '#4f46e5'
  const capSize = Math.round(Math.min(width, height) * 0.055)
  const frames = join(spec.out, 'frames')
  rmSync(frames, { recursive: true, force: true })
  mkdirSync(frames, { recursive: true })
  const b = await launch()
  let n = 0
  try {
    await open(b, spec.url, width, height, scale)
    const pageHeight = await evaluate(b, 'document.documentElement.scrollHeight')
    const maxY = Math.max(0, pageHeight - height)
    // 分镜的位置是按读网站时（电脑版、source_height 高）量的；竖屏用手机版网页，按页面高度换算
    const k = spec.source_height ? pageHeight / spec.source_height : 1
    for (const s of shots) {
      const count = Math.max(1, Math.round((s.end - s.start) * fps))
      const from = Math.min(maxY, Math.max(0, (Number(s.y_from) || 0) * k)), to = Math.min(maxY, Math.max(0, (Number(s.y_to ?? s.y_from) || 0) * k))
      const set = s.card
        ? `window.__annulo.card(${JSON.stringify(s.card.title || '')}, ${JSON.stringify(s.card.subtitle || '')}, ${capSize}, ${JSON.stringify(accent)})`
        : `window.__annulo.cap(${JSON.stringify(s.caption || '')}, ${capSize})`
      await evaluate(b, `scrollTo(0, ${from}); ${set}; true`)
      await sleep(1200) // 跳到新位置后等滚动触发的动效出来
      for (let k = 0; k < count; k++) {
        if (!s.card && to !== from) await evaluate(b, `scrollTo(0, ${from + (to - from) * ease(count > 1 ? k / (count - 1) : 1)}); true`)
        await shot(b, join(frames, `${String(++n).padStart(6, '0')}.jpg`))
      }
    }
  } finally {
    b.close()
  }
  const file = join(spec.out, spec.name || 'video.mp4')
  const duration = n / fps
  const args = ['-y', '-framerate', String(fps), '-i', join(frames, '%06d.jpg')]
  if (spec.music) args.push('-i', spec.music, '-filter_complex', `[1:a]afade=t=in:d=0.5,afade=t=out:st=${Math.max(0, duration - 1.5)}:d=1.5[a]`, '-map', '0:v', '-map', '[a]', '-shortest', '-c:a', 'aac', '-b:a', '160k')
  args.push('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', file)
  await ffmpeg(args)
  rmSync(frames, { recursive: true, force: true })
  return { file, frames: n, duration, width: width * scale, height: height * scale }
}

async function cover(spec) {
  const b = await launch()
  try {
    await open(b, spec.url, spec.width, spec.height, spec.scale || 1)
    const k = spec.source_height ? (await evaluate(b, 'document.documentElement.scrollHeight')) / spec.source_height : 1
    await evaluate(b, `scrollTo(0, ${(Number(spec.y) || 0) * k}); true`)
    await sleep(700)
    const size = Math.round(Math.min(spec.width, spec.height) * 0.12)
    await evaluate(b, `window.__annulo.cover(${JSON.stringify(spec.title || '')}, ${JSON.stringify(spec.subtitle || '')}, ${size}, ${JSON.stringify(spec.accent || '#4f46e5')}); true`)
    await sleep(200)
    await shot(b, spec.file, 'png')
    return { file: spec.file }
  } finally {
    b.close()
  }
}

const [cmd, specFile] = process.argv.slice(2)
const run = { screens, record, cover }[cmd]
try {
  if (!run || !specFile) throw new Error('用法：node social-video.mjs screens|record|cover <spec.json>')
  const out = await run(JSON.parse(readFileSync(specFile, 'utf8')))
  process.stdout.write(JSON.stringify(out) + '\n')
  process.exit(0)
} catch (e) {
  process.stdout.write(JSON.stringify({ error: e.message }) + '\n')
  process.exit(1)
}
