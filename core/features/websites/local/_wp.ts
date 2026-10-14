// WordPress 站点渠道的读写：走 WordPress 自带的 REST（/wp-json/wp/v2），用户名 + 应用密码（Application Password）做 Basic 认证。
// 文件名以 _ 开头：不作为可调用的函数，只给别的文件 import。
//
// 应用密码不进业务表：页面在添加渠道 / 更新应用密码时写成本机密钥（PUT local/secrets），名字按 secretName() 的约定，渠道上只记密钥名（wp_secret）和用户名（wp_user）。
// 应用密码在 WordPress 后台 → 用户 → 个人资料 → 应用密码 里创建（WordPress 5.6 起自带，站点要走 https）。

import { L } from './_i18n'

export type WPChannel = { id?: string; name?: string; type: string; preview_url?: string; wp_user?: string; wp_secret?: string }

/** 站点地址规范成 https://host[/子目录]，不带结尾的 / */
export function normalizeURL(raw: string, ctx?: any): string {
  let u = String(raw ?? '').trim()
  if (!u) throw new Error(L(ctx, '要填 WordPress 站点地址', 'Enter the WordPress site URL'))
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  const m = /^(https?):\/\/([^/?#]+)([^?#]*)/i.exec(u)
  if (!m) throw new Error(L(ctx, '站点地址不对：', 'Invalid site URL: ') + raw)
  const path = m[3].replace(/\/wp-(json|admin)(\/.*)?$/i, '').replace(/\/+$/, '')
  return `${m[1].toLowerCase()}://${m[2].toLowerCase()}${path}`
}

/** 应用密码的本机密钥名：WP_<域名>_APP_PASSWORD，域名里的点和横线换成下划线，www. 去掉 */
export function secretName(url: string): string {
  const host = (/^https?:\/\/([^/:?#]+)/i.exec(url)?.[1] ?? '').replace(/^www\./, '')
  return `WP_${host.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_APP_PASSWORD`
}

// 本机函数的运行时不保证有 btoa，自己编 base64（用户名和密码按 UTF-8）
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function base64(s: string): string {
  const bytes: number[] = []
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]]
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)] + (b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]) + (c === undefined ? '=' : B64[c & 63])
  }
  return out
}

/** 调一次 WordPress REST。path 从 /wp-json 后面写起（/wp/v2/posts）。auth=false 时不带凭据（读公开数据） */
export async function wp(ctx: any, ch: WPChannel, path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}) {
  const base = normalizeURL(ch.preview_url ?? '', ctx)
  const headers: Record<string, string> = { accept: 'application/json' }
  if (init.auth !== false) {
    const name = ch.wp_secret || secretName(base)
    const pass = ctx.secrets.get(name)
    if (!pass) throw new Error(L(ctx, `还没配置 WordPress 应用密码：到「渠道」页选这个站点点「填应用密码」（在 WordPress 后台 → 用户 → 个人资料 → 应用密码 创建；密钥名 ${name}）`, `No WordPress application password yet: on the Channels page, pick this site and click "Enter app password" (create one in WordPress admin → Users → Profile → Application Passwords; key name ${name})`))
    if (!ch.wp_user) throw new Error(L(ctx, `渠道「${ch.name ?? base}」没有记 WordPress 用户名：移除后重新添加`, `Channel "${ch.name ?? base}" has no WordPress username saved: remove it and add it again`))
    headers.authorization = 'Basic ' + base64(`${ch.wp_user}:${String(pass).replace(/\s+/g, '')}`)
  }
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(base + '/wp-json' + path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) })
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // 不是 JSON：多半是 REST 被安全插件关了，或者地址不是 WordPress
  }
  if (!res.ok || data === null) {
    const msg = data?.message ? String(data.message).replace(/<[^>]+>/g, '') : text.slice(0, 160)
    if (res.status === 401 || res.status === 403) throw new Error(L(ctx, `WordPress 拒绝了（${res.status}）：用户名或应用密码不对，或者这个用户没有权限。${msg}`, `WordPress refused (${res.status}): wrong username or application password, or this user lacks permission. ${msg}`))
    if (res.status === 404) throw new Error(L(ctx, `${base} 上找不到 WordPress REST 接口（/wp-json${path}）：确认地址是 WordPress 站点、REST 没被插件关掉`, `No WordPress REST API at ${base} (/wp-json${path}): check that it's a WordPress site and REST isn't disabled by a plugin`))
    if (data === null && res.ok) throw new Error(L(ctx, `${base} 返回的不是 WordPress 的数据：确认地址是 WordPress 站点`, `${base} didn't return WordPress data: check that it's a WordPress site`))
    throw new Error(`WordPress ${res.status}：${msg}`)
  }
  return data
}
