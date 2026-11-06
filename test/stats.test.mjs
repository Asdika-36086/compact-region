// stats.test.mjs — pure-function checks for the Host statistics.
// Run from the plugin directory with `npm test` (or `node test/stats.test.mjs`).
// These fixtures are synthetic; this test does not need a live DSH session.
import { computeCheckpoints, computeSlots, computeTurns, CHECKPOINT_PREAMBLE, summaryOf } from '../lib/stats.js'

let failures = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`ok   ${name}`)
  } else {
    failures += 1
    console.log(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`)
  }
}

/** Build a Session-shaped fake from a seq-ordered array of events. */
function sessionOf(events, surfaceSeqs, replaceGeneration = 0) {
  return {
    seq: events.length,
    eventAt: (seq) => events[seq],
    surface: { nodes: surfaceSeqs, replaceGeneration },
  }
}

// turn 1: system + user; turn 2: user; turn 3: user.
// A compact-last checkpoint at seq 10 replaces the range 2..5 and now sits at
// the head of the surface. Model: the card is its OWN slot; turns 1 and 2 are
// hidden and consume no slot.
const events = [
  { type: 'turn/start', seq: 0, data: { turn: 1 } },
  { type: 'system/message', seq: 1, data: { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } } },
  { type: 'user/message', seq: 2, data: { role: 'user', content: [{ type: 'text', text: 'q1' }] } },
  { type: 'turn/end', seq: 3, data: { turn: 1 } },
  { type: 'turn/start', seq: 4, data: { turn: 2 } },
  { type: 'user/message', seq: 5, data: { role: 'user', content: [{ type: 'text', text: 'q2' }] } },
  { type: 'turn/end', seq: 6, data: { turn: 2 } },
  { type: 'turn/start', seq: 7, data: { turn: 3 } },
  { type: 'user/message', seq: 8, data: { role: 'user', content: [{ type: 'text', text: 'q3' }] } },
  { type: 'turn/end', seq: 9, data: { turn: 3 } },
  {
    type: 'user/message',
    seq: 10,
    data: {
      role: 'user',
      source: { kind: 'compact-last' },
      content: [{ type: 'text', text: `${CHECKPOINT_PREAMBLE}\n\n## 摘要\n- 目标` }],
    },
    surfaceOp: { op: 'replace', startSeq: 2, endSeq: 5 },
    sourceEventSeqs: [2, 5],
  },
]

const session = sessionOf(events, [1, 10, 8])

const slots = computeSlots(session)
check('slot kinds are checkpoint then turn', slots.slots.map((s) => s.kind), ['checkpoint', 'turn'])
check('card carries its own identity', [slots.slots[0].seq, slots.slots[0].start, slots.slots[0].end], [10, 2, 5])
check('card shadow count', slots.slots[0].shadowed, 2)
check('card summary strips the preamble', slots.slots[0].summary, '## 摘要\n- 目标')
check('the next turn keeps its own number, no offset', { kind: slots.slots[1].kind, turn: slots.slots[1].turn }, { kind: 'turn', turn: 3 })
check('replaced turns are hidden and consume no slot', slots.hidden, [1, 2])
check('visible turns are the turn slots only', computeTurns(session).visible, [3])
check('total turns comes from the log', slots.totalTurns, 3)

const { checkpoints } = computeCheckpoints(session)
check('checkpoints reads the card', checkpoints.length, 1)
check('checkpoint identity', [checkpoints[0].kind, checkpoints[0].start, checkpoints[0].end], ['compact-last', 2, 5])
check('checkpoints skips non-checkpoint replacements', computeCheckpoints(sessionOf([
  { type: 'turn/start', seq: 0, data: { turn: 1 } },
  { type: 'user/message', seq: 1, data: { role: 'user', content: [] } },
  { type: 'tool/result', seq: 2, data: { message: { role: 'tool', content: [] } }, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 } },
], [2])).checkpoints.length, 0)

check('summaryOf leaves foreign text alone', summaryOf([{ type: 'text', text: 'plain' }]), 'plain')
check('summaryOf tolerates junk', summaryOf(null), '')

// A turn with two model-visible events where only one survived a replacement is
// a fragment: it keeps a slot, is not hidden, and is flagged.
const fragmentEvents = [
  { type: 'turn/start', seq: 0, data: { turn: 1 } },
  { type: 'user/message', seq: 1, data: { role: 'user', content: [] } },
  { type: 'assistant/message', seq: 2, data: { message: { role: 'assistant', content: [] } } },
  { type: 'turn/start', seq: 3, data: { turn: 2 } },
  { type: 'user/message', seq: 4, data: { role: 'user', content: [] } },
  {
    type: 'user/message',
    seq: 5,
    data: { role: 'user', source: { kind: 'compact-last' }, content: [] },
    surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 },
    sourceEventSeqs: [2],
  },
]
const fragmentSlots = computeSlots(sessionOf(fragmentEvents, [1, 5, 4]))
check('fragment keeps its slot and is flagged', fragmentSlots.slots.map((s) => ({ kind: s.kind, turn: s.turn, fragment: s.fragment })), [
  { kind: 'turn', turn: 1, fragment: true },
  { kind: 'checkpoint', turn: undefined, fragment: undefined },
  { kind: 'turn', turn: 2, fragment: false },
])
check('fragment is not hidden', fragmentSlots.hidden, [])

process.exit(failures === 0 ? 0 : 1)
