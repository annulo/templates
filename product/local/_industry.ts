// 行业文件：外贸和产品运营共用的本机函数（business 模块）里，按行业写的那部分放这里，每个模板一份。

/** 项目资料写成给模型看的一段话（_ai.ts 的 projectBrief）：开头一行的叫法、每个字段的标签（按顺序，有值才写）、什么都没填时的提示 */
export const BRIEF = {
  title: '产品',
  fields: [
    ['positioning', '价值主张'], ['business', '解决的问题'], ['advantages', '可核实优势'],
    ['customer_types', '目标用户'], ['markets', '市场与语言'], ['buyer_concerns', '用户问题'],
    ['goal', '增长目标'], ['signup_event', '注册定义'], ['activation_event', '激活定义'], ['paid_event', '付费定义'],
    ['pricing', '价格与来源'], ['competitors', '竞品与替代方案'], ['tone', '内容语气'], ['keywords', '候选关键词'],
    ['source_url', '事实来源'], ['verified_at', '核实时间'],
  ] as [string, string][],
  empty: '',
}
