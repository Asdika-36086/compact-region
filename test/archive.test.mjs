// archiveOf: the sidebar pane renders the log originals the way the chat does,
// so it keeps roles, tool calls, and their outputs — not one flat transcript.
import { strict as assert } from 'node:assert'
import { archiveOf } from '../lib/index.js'

const events = [
  { seq: 0, type: 'turn/start', data: { turn: 1 } },
  { seq: 1, type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } } },
  {
    seq: 2,
    type: 'assistant/message',
    data: {
      message: {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'text', text: 'hi' },
          { type: 'tool-call', id: 'call_1', name: 'fs.read', arguments: { path: 'a.txt' } },
        ],
      },
    },
  },
  { seq: 3, type: 'tool/result', data: { callId: 'call_1', message: { role: 'tool', content: [{ type: 'text', text: 'file body' }] } } },
  { seq: 4, type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'context' }], source: { kind: 'runtime-context' } } },
  { seq: 5, type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'checkpoint' }], source: { kind: 'compact-last' } } },
  { seq: 6, type: 'turn/end', data: { turn: 1 } },
]

const session = {
  seq: events.length,
  eventAt(seq) {
    return events[seq]
  },
}

const archive = archiveOf(session, 1, 6)
assert.equal(archive.start, 1)
assert.equal(archive.end, 6)
assert.deepEqual(
  archive.items.map((item) => item.kind),
  ['user', 'reasoning', 'assistant', 'tool', 'note'],
  'checkpoints are skipped; runtime context stays a note',
)
assert.equal(archive.items[0].text, 'hello')
assert.equal(archive.items[2].text, 'hi')
assert.equal(archive.items[3].name, 'fs.read')
assert.equal(archive.items[3].args, JSON.stringify({ path: 'a.txt' }, null, 2), 'tool args keep their JSON shape')
assert.equal(archive.items[3].output, 'file body', 'the tool result attaches to its call')
assert.equal(archive.items[4].source, 'runtime-context')
assert.ok(archive.items.every((item) => typeof item.seq === 'number'))

// A result with no call to attach to still shows up.
const loose = archiveOf({ seq: 3, eventAt: (seq) => [null, null, { seq: 2, type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'orphan' }] } } }][seq] }, 2, 2)
assert.deepEqual(loose.items.map((item) => item.kind), ['tool-output'])
assert.equal(loose.items[0].text, 'orphan')

// A checkpoint that lived inside the span stays a card, with its own range.
const nested = archiveOf(
  {
    seq: 3,
    eventAt: (seq) =>
      [
        null,
        { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: 'inner summary' }], source: { kind: 'compact-region' } }, surfaceOp: { op: 'replace', startSeq: 40, endSeq: 48 }, sourceEventSeqs: [40, 41, 42] },
        { seq: 2, type: 'turn/end', data: {} },
      ][seq],
  },
  1,
  2,
)
assert.equal(nested.items.length, 1)
assert.equal(nested.items[0].kind, 'checkpoint')
assert.equal(nested.items[0].start, 40)
assert.equal(nested.items[0].end, 48)
assert.equal(nested.items[0].shadowed, 3)
assert.equal(nested.items[0].summary, 'inner summary')

// Whatever that inner card replaced must not be listed again beside it.
const nestedHides = archiveOf(
  {
    seq: 6,
    eventAt: (seq) =>
      [
        null,
        { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: 'keep' }], source: { kind: 'user' } } },
        { seq: 2, type: 'user/message', data: { content: [{ type: 'text', text: 'hidden-a' }], source: { kind: 'user' } } },
        { seq: 3, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'hidden-b' }] } } },
        { seq: 4, type: 'user/message', data: { content: [{ type: 'text', text: 'inner' }], source: { kind: 'compact-region' } }, surfaceOp: { op: 'replace', startSeq: 2, endSeq: 3 }, sourceEventSeqs: [2] },
        { seq: 5, type: 'turn/end', data: {} },
      ][seq],
  },
  1,
  5,
)
assert.deepEqual(nestedHides.items.map((item) => item.kind), ['user', 'checkpoint'], 'only the outer survivor and the inner card')
assert.equal(nestedHides.items[0].text, 'keep')

const outOfRange = archiveOf(session, 20, 30)
assert.equal(outOfRange.items.length, 0)

console.log('ok   archiveOf keeps roles, tool calls and outputs, skips checkpoints')
console.log('ok   archiveOf tolerates an out-of-range span')
