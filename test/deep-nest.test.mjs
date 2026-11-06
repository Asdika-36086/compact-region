// 深层嵌套：archiveOf 必须按"表面"逐层收敛，任何一层都不能漏出更深处的内容。
// 真实会话目前只出现过 2 层，这里用同一套事件形状造出 2–6 层的链来验证通用性。
import { strict as assert } from 'node:assert'
import { archiveOf } from '../lib/index.js'
import { CHECKPOINT_PREAMBLE } from '../lib/stats.js'

function buildSession(depth) {
  const events = [{ seq: 0, type: 'turn/start', data: { turn: 1 } }]
  // 最底层的普通内容：seq 1..4
  for (let i = 1; i <= 4; i += 1) {
    events.push(
      i % 2 === 1
        ? { seq: i, type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'base-' + i }], source: { kind: 'user' } } }
        : { seq: i, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'base-' + i }] } } },
    )
  }
  // 卡片链：第 k 张卡片在 seq=4+k，替换 [1, 4+k-1]，把上一张卡片也包进去。
  for (let k = 1; k <= depth; k += 1) {
    const seq = 4 + k
    const start = 1
    const end = 4 + k - 1
    events.push({
      seq,
      type: 'user/message',
      data: { role: 'user', content: [{ type: 'text', text: CHECKPOINT_PREAMBLE + '\n\nL' + k + ' 摘要' }], source: { kind: 'compact-region' } },
      surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
      sourceEventSeqs: Array.from({ length: end - start + 1 }, (_, j) => start + j),
    })
  }
  const bySeq = new Map(events.map((e) => [e.seq, e]))
  return { seq: events.length, eventAt: (seq) => bySeq.get(seq) }
}

const rows = []
for (let depth = 2; depth <= 6; depth += 1) {
  const session = buildSession(depth)
  for (let k = depth; k >= 1; k -= 1) {
    const archive = archiveOf(session, 1, 4 + k - 1)
    const kinds = archive.items.map((item) => item.kind)
    const texts = archive.items.map((item) => item.text ?? item.summary ?? '')
    const cards = archive.items.filter((item) => item.kind === 'checkpoint')
    if (k > 1) {
      assert.equal(texts.some((t) => t.startsWith('base-')), false, 'depth ' + depth + ' level ' + k + ': 深层原文泄漏')
      assert.equal(cards.length, 1, 'depth ' + depth + ' level ' + k + ' 应只有一个卡片，实际 ' + cards.length)
      assert.equal(cards[0].summary, 'L' + (k - 1) + ' 摘要', 'depth ' + depth + ' level ' + k + ' 露出的应是 L' + (k - 1))
      assert.equal(kinds.length, 1, 'depth ' + depth + ' level ' + k + ' 除卡片外不应有条目：' + kinds.join(','))
    } else {
      // 最内层的窗口就是第一张卡片替换掉的原文，不该再有卡片。
      assert.equal(cards.length, 0, 'depth ' + depth + ' level 1 不应再有卡片')
      assert.deepEqual(texts, ['base-1', 'base-2', 'base-3', 'base-4'], 'depth ' + depth + ' level 1 应只剩最底层原文')
    }
    rows.push({ depth, level: k, items: archive.items.length, kinds: kinds.join(',') || '(empty)', card: cards.length ? cards[0].summary : '-' })
  }
}

console.log('depth  level  items  kinds        card')
for (const r of rows) console.log(String(r.depth).padEnd(6), String(r.level).padEnd(6), String(r.items).padEnd(6), r.kinds.padEnd(12), r.card)
console.log('ok   2–6 层嵌套：每层只见上一张卡片，深层原文 0 泄漏')
