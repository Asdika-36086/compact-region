// 字体：插件注入的 CSS 不能把字体留给浏览器的通用族。
// 渲染进程带 --lang=zh-CN 时，裸 monospace 解析成新宋体（NSimSun），英文也会用它来画；
// code/pre 得跟上 DSH 的代码字体栈，卡片和存档面板的正文用应用字体栈。
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'

const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

// 每一条等宽声明都要点名 --ds-font-family-code，通用族只做最后的兜底。
const codeDeclarations = [...client.matchAll(/font(?:-family)?:[^;}\n]*monospace/g)]
assert.ok(codeDeclarations.length > 0, '应当认得出等宽声明')
for (const [declaration] of codeDeclarations) {
  assert.ok(
    declaration.includes('var(--ds-font-family-code'),
    `等宽声明没有用 DSH 的代码字体栈：${declaration}`,
  )
}
assert.equal(client.includes('ui-monospace'), false, 'ui-monospace 在 Chromium 里不是通用族，落到的字体不可控')

// 卡片自己渲染 markdown：正文规则里必须有 code/pre 的字体声明。
const cardStart = client.indexOf('var CARD_CSS')
const cardEnd = client.indexOf('].join', cardStart)
assert.ok(cardStart > 0 && cardEnd > cardStart, '找不到卡片样式')
const cardCss = client.slice(cardStart, cardEnd)
for (const selector of ['.cl-md code{', '.cl-md .cl-md-pre{']) {
  const at = cardCss.indexOf(selector)
  assert.ok(at >= 0, `卡片样式里没有 ${selector.slice(0, -1)}`)
  const rule = cardCss.slice(at, cardCss.indexOf('}', at))
  assert.ok(rule.includes('var(--ds-font-family-code'), `${selector.slice(0, -1)} 没有指定代码字体`)
}

// 卡片正文用应用字体栈，覆盖到 code/pre 之外的一切。
assert.ok(/\.cl-card\{[^}]*font-family:inherit/.test(cardCss), '卡片正文应当继承应用字体')

console.log('ok   注入的 CSS 不再把字体交给通用族，卡片 code/pre 用 DSH 代码字体栈')
