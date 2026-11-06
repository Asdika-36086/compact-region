/**
 * compact-region — session statistics shared by the Host half.
 *
 * The Client cannot derive these from its paged window; it asks the Host.
 *
 * A conversation is a sequence of visible slots:
 *
 *   明1 明2 卡[暗 暗 暗 暗 暗] 明3 明4
 *
 *   - a normal turn owns one slot;
 *   - a checkpoint owns one slot of its own, at the position where it replaced
 *     history — it does NOT borrow the first replaced turn's number;
 *   - every turn whose content the checkpoint replaced is hidden, and hidden
 *     turns consume no slot, so the visible numbering stays dense.
 *
 * Pure functions over a Session-shaped object: no Cordis, no I/O.
 */

/** Opening sentence every checkpoint carries; the card shows the text after it. */
export const CHECKPOINT_PREAMBLE =
  'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.'

const CHECKPOINT_SOURCE_KINDS = new Set(['compact-last', 'compact-checkpoint', 'compact-region'])

/** Map every seq to the turn that owns it, using the log's own boundaries. */
export function turnAtSeq(session) {
  const turnAt = new Map()
  let current = null
  const total = session.seq
  for (let seq = 0; seq < total; seq += 1) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    if (event.type === 'turn/start') current = event.data.turn
    turnAt.set(seq, current)
    if (event.type === 'turn/end') current = null
  }
  return turnAt
}

/**
 * Turn owning one surface node. A replacement node was appended later than the
 * history it represents, so its own seq is the wrong coordinate; follow the
 * replaced range back to its origin.
 */
function originTurn(session, seq, turnAt, depth) {
  if (depth > 16) return turnAt.get(seq)
  const event = session.eventAt(seq)
  if (event === undefined) return turnAt.get(seq)
  const op = event.surfaceOp
  if (op !== undefined && op !== null && typeof op === 'object' && op.op === 'replace') {
    return originTurn(session, op.startSeq, turnAt, depth + 1)
  }
  return turnAt.get(event.seq)
}

/** Strip the checkpoint preamble and surrounding whitespace. */
export function summaryOf(content) {
  if (!Array.isArray(content)) return ''
  const text = content
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text')
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('')
  const trimmed = text.trim()
  if (trimmed.startsWith(CHECKPOINT_PREAMBLE)) return trimmed.slice(CHECKPOINT_PREAMBLE.length).trim()
  return trimmed
}

/** The checkpoint carried by one event, or undefined when it carries none. */
function checkpointOf(event) {
  if (event.type !== 'user/message') return undefined
  const op = event.surfaceOp
  if (op === undefined || op === null || typeof op !== 'object' || op.op !== 'replace') return undefined
  const source = event.data?.source
  const kind = typeof source?.kind === 'string' ? source.kind : 'unknown'
  if (!CHECKPOINT_SOURCE_KINDS.has(kind)) return undefined
  return {
    kind,
    start: op.startSeq,
    end: op.endSeq,
    shadowed: Array.isArray(event.sourceEventSeqs) ? event.sourceEventSeqs.length : 0,
    summary: summaryOf(event.data?.content),
  }
}

/**
 * Ordered visible slots and the turns they hid.
 * @returns {{slots: Array<{kind:'turn',turn:number}|{kind:'checkpoint',seq:number,source:string,start:number,end:number,shadowed:number,summary:string}>, hidden: number[], totalTurns: number}}
 */
export function computeSlots(session) {
  const turnAt = turnAtSeq(session)
  const slots = []
  const seenTurns = new Set()
  for (const seq of session.surface.nodes) {
    const event = session.eventAt(seq)
    if (event === undefined || event.type === 'system/message') continue
    const checkpoint = checkpointOf(event)
    if (checkpoint !== undefined) {
      slots.push({
        kind: 'checkpoint',
        seq,
        source: checkpoint.kind,
        start: checkpoint.start,
        end: checkpoint.end,
        shadowed: checkpoint.shadowed,
        summary: checkpoint.summary,
      })
      continue
    }
    const turn = originTurn(session, seq, turnAt, 0)
    if (turn === undefined || turn === null || seenTurns.has(turn)) continue
    seenTurns.add(turn)
    slots.push({ kind: 'turn', turn })
  }
  const all = []
  for (const turn of turnAt.values()) {
    if (turn === undefined || turn === null) continue
    if (!all.includes(turn)) all.push(turn)
  }
  const hidden = all.filter((turn) => !seenTurns.has(turn))

  // A turn is a fragment when part of its model-visible history was replaced
  // but part of it survived. Count the eligible events the log committed for
  // each turn and compare with what the surface still holds.
  const eligible = new Map()
  for (let seq = 0; seq < session.seq; seq += 1) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    if (event.type !== 'assistant/message' && event.type !== 'tool/result' && event.type !== 'developer/message' && event.type !== 'user/message') continue
    if (checkpointOf(event) !== undefined) continue
    const turn = turnAt.get(seq)
    if (turn === undefined || turn === null) continue
    if (!eligible.has(turn)) eligible.set(turn, new Set())
    eligible.get(turn).add(seq)
  }
  const surviving = new Map()
  for (const seq of session.surface.nodes) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    if (checkpointOf(event) !== undefined) continue
    const turn = originTurn(session, seq, turnAt, 0)
    if (turn === undefined || turn === null) continue
    if (!surviving.has(turn)) surviving.set(turn, new Set())
    surviving.get(turn).add(seq)
  }
  for (const slot of slots) {
    if (slot.kind !== 'turn') continue
    const total = eligible.get(slot.turn)?.size ?? 0
    const kept = surviving.get(slot.turn)?.size ?? 0
    slot.fragment = total > 0 && kept < total
  }
  return { slots, hidden, totalTurns: all.length }
}

/** Back-compat view: turn numbers in slot order plus the hidden ones. */
export function computeTurns(session) {
  const { slots, hidden, totalTurns } = computeSlots(session)
  return {
    slots,
    visible: slots.filter((slot) => slot.kind === 'turn').map((slot) => slot.turn),
    hidden,
    totalTurns,
  }
}

/** Checkpoints already on the surface, in log order. */
export function computeCheckpoints(session) {
  const checkpoints = []
  const total = session.seq
  for (let seq = 0; seq < total; seq += 1) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    const checkpoint = checkpointOf(event)
    if (checkpoint === undefined) continue
    checkpoints.push({ seq, ...checkpoint })
  }
  return { checkpoints }
}

/**
 * The contiguous surface span covered by a turn range.
 * @returns {{start:number,end:number,count:number}|null}
 */
export function computeRange(session, fromTurn, toTurn) {
  const turnAt = turnAtSeq(session)
  const nodes = session.surface.nodes
  let startIdx = -1
  let endIdx = -1
  for (let i = 0; i < nodes.length; i += 1) {
    const event = session.eventAt(nodes[i])
    if (event === undefined || event.type === 'system/message') continue
    const turn = originTurn(session, nodes[i], turnAt, 0)
    if (turn === undefined || turn === null) continue
    if (turn === fromTurn && startIdx === -1) startIdx = i
    if (turn === toTurn) endIdx = i
  }
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return null
  return {
    start: nodes[startIdx],
    end: nodes[endIdx],
    count: endIdx - startIdx + 1,
  }
}

/**
 * The contiguous surface span covered by a run of selected slots.
 *
 * A slot is either a turn (`t:<turn>`) or a checkpoint card (`c:<seq>`). Both
 * are ordinary surface positions, so the span is simply from the first
 * selected node to the last one — cards are not special and never need a
 * separate calculation.
 *
 * @returns {{start:number,end:number,count:number}|null}
 */
export function computeSlotRange(session, keys) {
  const turnAt = turnAtSeq(session)
  const nodes = session.surface.nodes
  const picked = new Set()
  for (const key of keys) {
    const text = String(key)
    const kind = text.slice(0, 1)
    const value = Number(text.slice(2))
    if (!Number.isInteger(value)) continue
    if (kind === 'c') {
      const index = nodes.indexOf(value)
      if (index !== -1) picked.add(index)
      continue
    }
    for (let i = 0; i < nodes.length; i += 1) {
      const event = session.eventAt(nodes[i])
      if (event === undefined || event.type === 'system/message') continue
      if (originTurn(session, nodes[i], turnAt, 0) === value) picked.add(i)
    }
  }
  if (picked.size === 0) return null
  const indexes = [...picked].sort((a, b) => a - b)
  const startIdx = indexes[0]
  const endIdx = indexes[indexes.length - 1]
  return {
    start: nodes[startIdx],
    end: nodes[endIdx],
    count: endIdx - startIdx + 1,
  }
}
