// 给用户看的文字（报错、进度）按界面语言出两份：L(ctx, '中文', 'English')。ctx.locale 是 'zh' | 'en'。
// 文件名以 _ 开头：只给别的文件 import，不是能调的函数。
export const L = (ctx: any, zh: string, en: string) => (ctx?.locale === 'en' ? en : zh)
