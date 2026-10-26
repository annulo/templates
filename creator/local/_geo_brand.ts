// 自媒体的品牌问题句式（AI 搜索检测「AI 怎么介绍你」那一块）：网站运营的共用代码 local/geo.ts 有这个文件就用它，没有用外贸、产品的（公司、产品、起订量）。
// 读者知道你的名字以后会怎么问 AI：这个人是谁、写什么、有什么作品、在哪能看到。key 用来去重，改句式不要改 key。

/** 问题用什么语言：「平台和语言」里写了英文、海外平台才用英文，默认中文 */
function lang(p: any): 'en' | 'zh' {
  const m = String(p?.markets ?? '')
  return /英文|English|海外|overseas|global|\bX\b|LinkedIn|YouTube|Instagram|Facebook/i.test(m) && !/中文|小红书|抖音|B 站|B站|知乎|公众号/.test(m) ? 'en' : 'zh'
}

export function brandTemplates(b: string, p: any) {
  const topic = String(p?.business ?? '').split(/[,，、;；\n]/)[0]?.trim() || ''
  const out: { key: string; question: string; keywords: string }[] = lang(p) === 'zh'
    ? [
        { key: 'about', question: `${b}是谁？主要在写什么、做什么内容？`, keywords: `${b},介绍` },
        { key: 'works', question: `${b}有哪些代表作品或文章？`, keywords: `${b},作品` },
        { key: 'where', question: `在哪些平台能看到${b}的内容？`, keywords: `${b},平台,账号` },
        { key: 'offer', question: `${b}有没有课程、咨询或别的合作方式？`, keywords: `${b},课程,合作` },
        { key: 'website', question: `${b}的个人网站是哪个？`, keywords: `${b},网站` },
      ]
    : [
        { key: 'about', question: `Who is ${b}, and what do they create content about?`, keywords: `${b}, about` },
        { key: 'works', question: `What are ${b}'s best-known works or articles?`, keywords: `${b}, works` },
        { key: 'where', question: `Where can I follow ${b}'s content?`, keywords: `${b}, platforms` },
        { key: 'offer', question: `Does ${b} offer courses, consulting or other ways to work together?`, keywords: `${b}, courses, consulting` },
        { key: 'website', question: `What is ${b}'s personal website?`, keywords: `${b}, website` },
      ]
  if (topic)
    out.push(lang(p) === 'zh'
      ? { key: 'compare', question: `写${topic}的博主里，${b}怎么样？和别人比有什么特点？`, keywords: `${b},${topic},对比` }
      : { key: 'compare', question: `Among creators covering ${topic}, how does ${b} compare? What sets them apart?`, keywords: `${b}, ${topic}, comparison` })
  return out
}
