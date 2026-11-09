/* compact-region — Client half.
 *
 * Renders checkpoint cards, provides contiguous turn selection and editable
 * compaction previews, hides replaced turns, and exposes their archive.
 * Registrations and DOM integrations are disposed with the plugin; optional
 * UI registration failures should leave the chat's default rendering intact.
 */

window.__ModuleLoader__.load({
  id: 'compact-region',
  factory: (require) => {
    'use strict'

    var React = require('react')
    var ReactDOM = require('react-dom')
    var h = React.createElement

    var CARD_KIND = 'compact-region-card'
    var CHECKPOINT_KINDS = { 'compact-last': true, 'compact-checkpoint': true, 'compact-region': true }
    var PREAMBLE = 'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.'

    function isCheckpoint(event) {
      if (event === null || event === undefined || event.type !== 'user/message') return null
      var op = event.surfaceOp
      if (op === undefined || op === null || typeof op !== 'object' || op.op !== 'replace') return null
      var kind = event.data && event.data.source && event.data.source.kind
      if (typeof kind !== 'string' || CHECKPOINT_KINDS[kind] !== true) return null
      return { kind: kind, start: op.startSeq, end: op.endSeq }
    }

    function summaryOf(event) {
      var content = event && event.data && Array.isArray(event.data.content) ? event.data.content : []
      var text = ''
      for (var i = 0; i < content.length; i += 1) {
        var block = content[i]
        if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
          text += block.text
        }
      }
      text = text.trim()
      if (text.indexOf(PREAMBLE) === 0) text = text.slice(PREAMBLE.length).trim()
      return text
    }

    /** One checkpoint event -> one card node. Each checkpoint is its own Context. */
    function cardDefinition() {
      return {
        kind: CARD_KIND,
        target: 'chat',
        match: function (event) {
          if (isCheckpoint(event) === null) return null
          return { id: String(event.seq), role: 'start' }
        },
        start: function (context, match) {
          return { seq: match.event.seq }
        },
        update: function (context) {
          return context.state
        },
        buildViewNode: function (context) {
          var anchor = context.matches && context.matches[0]
          if (anchor === undefined || anchor.event === undefined) return null
          var event = anchor.event
          var info = isCheckpoint(event)
          if (info === null) return null
          var shadowed = Array.isArray(event.sourceEventSeqs) ? event.sourceEventSeqs.length : 0
          var location = context.start && context.start.location ? context.start.location : { kind: 'unresolved' }
          return {
            key: context.key,
            kind: CARD_KIND,
            id: context.id,
            target: 'chat',
            anchorSeq: info.start,
            location: location,
            visibility: 'visible',
            data: {
              checkpointSeq: event.seq,
              source: info.kind,
              start: info.start,
              end: info.end,
              shadowed: shadowed,
              summary: summaryOf(event)
            }
          }
        }
      }
    }

    /** Card + preview CSS, copied from compact-last's `.cl-*` styles. */
    var CARD_CSS = [
      '.cl-card{border:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.22));border-radius:12px;',
      'background:var(--dsw-alias-bg-secondary, rgba(127,127,127,.05));padding:12px 14px;margin:6px 0;',
      'font-family:inherit;color:var(--dsw-alias-label-primary, #ddd);cursor:pointer;transition:border-color .15s}',
      '.cl-card:hover{border-color:var(--dsw-alias-border-l2, rgba(127,127,127,.42))}',
      '.cl-card-head{display:flex;align-items:center;gap:6px;font-size:12px;',
      'color:var(--dsw-alias-label-tertiary, #8a8a8a);margin-bottom:8px}',
      '.cl-card-count{font-weight:600;color:var(--dsw-alias-label-secondary, #aaa)}',
      '.cl-card-body{font-size:13px;line-height:1.6;word-break:break-word}',
      '.cl-card-body.cl-clamp{max-height:5.4em;overflow:hidden;position:relative;',
      '-webkit-mask-image:linear-gradient(180deg,#000 55%,transparent);mask-image:linear-gradient(180deg,#000 55%,transparent)}',
      '.cl-card-actions{display:flex;gap:8px;margin-top:10px}',
      '.cl-btn{font:inherit;font-size:12px;padding:4px 10px;border-radius:7px;cursor:pointer;',
      'border:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3));background:transparent;',
      'color:var(--dsw-alias-label-secondary, #999)}',
      '.cl-btn:hover{background:rgba(127,127,127,.1)}',
      '.cl-btn.primary{border-color:transparent;background:#4a7dff;color:#fff}',
      '.cl-btn[disabled]{opacity:.5;cursor:default}',
      '.cl-md .cl-md-h{font-weight:600;margin:10px 0 6px}',
      '.cl-md .cl-md-p{margin:6px 0}',
      '.cl-md .cl-md-ul,.cl-md .cl-md-ol{margin:6px 0;padding-left:20px}',
      '.cl-md .cl-md-li{margin:3px 0}',
      '.cl-md code{background:rgba(127,127,127,.18);border-radius:4px;padding:1px 5px;font-size:12px}',
      '.cl-md .cl-md-pre{background:rgba(0,0,0,.25);border-radius:8px;padding:10px 12px;overflow:auto;margin:8px 0}',
      '.cl-md strong{font-weight:600}',
      '.cl-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;',
      'justify-content:center;z-index:2147483000;padding:24px}',
      '.cl-modal{width:min(860px,100%);max-height:88vh;display:flex;flex-direction:column;background:#1f1f22;',
      'color:#e8e8ea;border:1px solid rgba(255,255,255,.12);border-radius:12px;',
      'box-shadow:0 18px 60px rgba(0,0,0,.5);overflow:hidden}',
      '.cl-modal-head{display:flex;align-items:baseline;gap:10px;padding:14px 18px;',
      'border-bottom:1px solid rgba(255,255,255,.1)}',
      '.cl-modal-title{font-size:15px;font-weight:600;color:#f2f2f4}',
      '.cl-modal-sub{font-size:12px;color:#9a9aa0}',
      '.cl-modal-body{padding:14px 18px;overflow:auto;flex:1;display:flex;flex-direction:column;gap:8px}',
      '.cl-ta{width:100%;flex:1;min-height:320px;resize:vertical;border:1px solid rgba(255,255,255,.18);',
      'border-radius:8px;padding:10px 12px;font:inherit;font-size:13px;line-height:1.6;background:#161618;',
      'color:#e8e8ea;outline:none;white-space:pre-wrap}',
      '.cl-ta:focus{border-color:#5a8cff}',
      '.cl-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;',
      'border-top:1px solid rgba(255,255,255,.1)}',
      '.cl-hint{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}',
      '.cl-err{color:#d33;font-size:12px;margin-top:6px;white-space:pre-wrap}',
      '.crx{display:flex;flex-direction:column;gap:2px;padding-bottom:32px}',
      '.crx-head{padding:10px 2px 6px;font-size:11.5px;line-height:18px;',
      'color:var(--dsw-alias-label-tertiary,#8a8a8a)}',
      '.crx-head b{font-weight:600;color:var(--dsw-alias-label-secondary,#b8b8b8)}',
      '.crx-user{display:flex;flex-direction:column;align-items:flex-end;gap:6px;padding:8px 0}',
      '.crx-bubble{max-width:88%;padding:10px 16px;border-radius:20px;font-size:14px;line-height:22px;',
      'color:var(--dsw-alias-label-primary,#f9fafb);background:#2c2c2e;white-space:pre-wrap;word-break:break-word}',
      '.crx-ai{padding:8px 0;font-size:14px;line-height:24px;color:var(--dsw-alias-label-primary,#f9fafb);word-break:break-word}',
      '.crx-pre{margin:6px 0;padding:8px 10px;border-radius:8px;background:rgba(0,0,0,.22);',
      'white-space:pre-wrap;word-break:break-word;font:12px/1.6 ui-monospace,monospace;max-height:320px;overflow:auto}',
      '.crx-dc{margin:2px 0}',
      '.crx-dc-head{display:flex;align-items:center;gap:6px;width:100%;padding:2px 0;border:0;border-radius:6px;',
      'background:transparent;font:13px/24px inherit;color:#adb2b8;cursor:pointer;text-align:left}',
      '.crx-dc-head:hover{background:rgba(127,127,127,.10)}',
      '.crx-dc-title{color:#adb2b8}',
      '.crx-dc-sep{opacity:.4}',
      '.crx-dc-name{font-size:13px;color:#adb2b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crx-dc-chev{display:inline-flex;width:14px;height:14px;flex:none;opacity:.75;transform:rotate(-90deg);transition:transform .15s}',
      '.crx-dc[data-open] .crx-dc-chev{transform:rotate(0)}',
      '.crx-dc-body{padding:2px 0 8px 20px}',
      '.crx-dc-cap{margin:0 0 3px;font-size:11px;color:var(--dsw-alias-label-tertiary,#828282)}',
      '.crx-note{margin:2px 0;font-size:11.5px;line-height:20px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}',
      '.crx-note>summary{cursor:pointer;list-style:none;opacity:.85}',
      '.crx-note>summary::-webkit-details-marker{display:none}',
      '.crx-note>summary::before{content:"▸ ";opacity:.7}',
      '.crx-note[open]>summary::before{content:"▾ "}',
      '.crx-note-body{margin:4px 0 6px;padding:6px 8px;border-left:2px solid rgba(127,127,127,.25);',
      'white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:1.5;max-height:240px;overflow:auto;opacity:.85}'

    ].join('')

    function escapeHtml(source) {
      return String(source).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      })
    }

    function inlineMarkup(source) {
      return source
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    }

    /** Minimal markdown: headings, lists, fences, paragraphs (compact-last's renderer). */
    function renderMarkup(source) {
      if (typeof source !== 'string' || source.length === 0) return ''
      var lines = escapeHtml(source).split('\n')
      var out = []
      var inCode = false
      var codeBuf = []
      var listType = null
      var closeList = function () {
        if (listType !== null) {
          out.push('</' + listType + '>')
          listType = null
        }
      }
      for (var i = 0; i < lines.length; i += 1) {
        var line = lines[i]
        if (line.trim().indexOf('```') === 0) {
          if (inCode) {
            out.push('<pre class="cl-md-pre"><code>' + codeBuf.join('\n') + '</code></pre>')
            codeBuf = []
            inCode = false
          } else {
            closeList()
            inCode = true
            codeBuf = []
          }
          continue
        }
        if (inCode) {
          codeBuf.push(line)
          continue
        }
        var heading = /^(#{1,4})\s+(.*)$/.exec(line)
        if (heading !== null) {
          closeList()
          var level = heading[1].length + 1
          out.push('<h' + level + ' class="cl-md-h">' + inlineMarkup(heading[2]) + '</h' + level + '>')
          continue
        }
        var item = /^\s*[-*]\s+(.*)$/.exec(line)
        if (item !== null) {
          if (listType !== 'ul') {
            closeList()
            out.push('<ul class="cl-md-ul">')
            listType = 'ul'
          }
          out.push('<li class="cl-md-li">' + inlineMarkup(item[1]) + '</li>')
          continue
        }
        var ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
        if (ordered !== null) {
          if (listType !== 'ol') {
            closeList()
            out.push('<ol class="cl-md-ol">')
            listType = 'ol'
          }
          out.push('<li class="cl-md-li">' + inlineMarkup(ordered[1]) + '</li>')
          continue
        }
        closeList()
        if (line.trim().length === 0) continue
        out.push('<p class="cl-md-p">' + inlineMarkup(line) + '</p>')
      }
      closeList()
      if (inCode) out.push('<pre class="cl-md-pre"><code>' + codeBuf.join('\n') + '</code></pre>')
      return out.join('')
    }

    function CardView(props) {
      var node = props && props.node && typeof props.node === 'object' ? props.node : null
      var data = node && node.data && typeof node.data === 'object' ? node.data : {}
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var summary = typeof data.summary === 'string' ? data.summary : ''
      var count = typeof data.shadowed === 'number' ? data.shadowed : 0
      var html = summary.length > 0 ? renderMarkup(summary) : escapeHtml('（摘要为空）')
      // The whole card toggles; the action row keeps its own button so opening
      // the archive never doubles as a collapse.
      function toggle(event) {
        var target = event && event.target
        if (target !== null && target !== undefined && typeof target.closest === 'function' && target.closest('button') !== null) return
        setOpen(!open)
      }
      return h(
        'div',
        {
          className: 'cl-card',
          onClick: toggle,
          title: open ? '点击收起' : '点击展开全文'
        },
        h(
          'div',
          { className: 'cl-card-head' },
          h('span', { className: 'cl-card-count' }, String(count)),
          h('span', null, ' 条消息已压缩')
        ),
        h('div', {
          className: 'cl-card-body cl-md' + (open ? '' : ' cl-clamp'),
          dangerouslySetInnerHTML: { __html: html }
        }),
        typeof props.onArchive === 'function'
          ? h(
              'div',
              { className: 'cl-card-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'cl-btn primary',
                  onClick: function (event) {
                    event.preventDefault()
                    event.stopPropagation()
                    props.onArchive(data)
                  }
                },
                '查看对话记录'
              )
            )
          : null
      )
    }

    var ARCHIVE_KIND = 'compact-region-archive'

    function selectedSessionId() {
      var row = document.querySelector('[data-row-key^="session:"][aria-selected="true"]')
      if (row === null) return null
      var key = row.getAttribute('data-row-key') || ''
      var id = key.slice('session:'.length)
      return id.length > 0 ? id : null
    }

    function archiveAddress(sessionId, start, end) {
      return 'dsh-resource://' + ARCHIVE_KIND + '/session/' + encodeURIComponent(sessionId) + '/' + start + '/' + end
    }

    /** Sprite glyph from the page's own icon sheet, so the rows match the chat. */
    function icon(id, size) {
      return h('svg', {
        width: size ?? 14,
        height: size ?? 14,
        'data-icon': id,
        'aria-hidden': 'true',
        style: { flex: 'none' }
      }, h('use', { href: '#' + id }))
    }

    /** A collapsible row shaped like the chat's tool / reasoning cards. */
    function Disclosure(props) {
      var openState = React.useState(props.defaultOpen === true)
      var open = openState[0]
      var setOpen = openState[1]
      var body =
        open === false
          ? null
          : h('div', { className: 'crx-dc-body' },
              props.caption ? h('p', { className: 'crx-dc-cap' }, props.caption) : null,
              props.children)
      return h('div', { className: 'crx-dc', 'data-open': open ? '' : undefined },
        h('button', {
          type: 'button',
          className: 'crx-dc-head',
          'aria-expanded': open,
          onClick: function () { setOpen(!open) }
        },
          props.icon ? icon(props.icon, 14) : null,
          h('span', { className: 'crx-dc-chev' }, icon('dsw-icon-chevron-down-outline-regular', 14)),
          h('span', { className: 'crx-dc-title' }, props.title),
          props.name ? h('span', { className: 'crx-dc-sep' }, '·') : null,
          props.name ? h('span', { className: 'crx-dc-name' }, props.name) : null,
          props.summary ? h('span', { className: 'crx-dc-name', style: { opacity: 0.65 } }, props.summary) : null
        ),
        body)
    }

    /** One archived event rendered the way the chat renders it. */
    function archiveItem(item, key, host) {
      if (item.kind === 'checkpoint') {
        // A checkpoint that lived inside this span was a card on screen when the
        // span was compressed; keep it a card, and let it open its own tab.
        return h(CardView, {
          key: key,
          node: {
            data: {
              shadowed: typeof item.shadowed === 'number' ? item.shadowed : 0,
              summary: typeof item.summary === 'string' ? item.summary : '',
              start: item.start,
              end: item.end
            }
          },
          onArchive: function (data) {
            if (host && typeof host.openArchive === 'function') host.openArchive(data)
          }
        })
      }
      if (item.kind === 'user') {
        return h('div', { className: 'crx-user', key: key }, h('div', { className: 'crx-bubble' }, item.text))
      }
      if (item.kind === 'assistant') {
        return h('div', {
          className: 'crx-ai cl-md',
          key: key,
          dangerouslySetInnerHTML: { __html: renderMarkup(item.text) }
        })
      }
      if (item.kind === 'reasoning') {
        return h(Disclosure, { key: key, title: '思考', icon: 'dsw-icon-think-outline-regular', defaultOpen: false },
          h('pre', { className: 'crx-pre' }, item.text))
      }
      if (item.kind === 'tool') {
        var hasResult = typeof item.output === 'string' && item.output.length > 0
        var summary = item.args ? item.args.replace(/\s+/g, ' ').slice(0, 60) : ''
        return h(Disclosure, {
          key: key,
          title: '工具调用',
          icon: 'dsw-icon-sparkle-regular',
          name: item.name,
          summary: hasResult ? summary : '（未返回输出）',
          defaultOpen: false
        },
          item.args ? h('pre', { className: 'crx-pre' }, item.args) : null,
          hasResult ? h('p', { className: 'crx-dc-cap' }, '输出') : null,
          hasResult ? h('pre', { className: 'crx-pre' }, item.output) : null)
      }
      if (item.kind === 'tool-output') {
        return h(Disclosure, { key: key, title: '工具输出', icon: 'dsw-icon-sparkle-regular', defaultOpen: false },
          h('pre', { className: 'crx-pre' }, item.text))
      }
      // note: runtime context / time / skill catalog — the chat keeps these out of sight.
      return h('details', { className: 'crx-note', key: key },
        h('summary', null, '上下文 · ' + (item.source || 'system') + ' · seq ' + item.seq),
        h('div', { className: 'crx-note-body' }, item.text))
    }

    /** Sidebar pane listing the messages a checkpoint replaced, from the log. */
    function ArchivePane(props) {
      var info = props && props.useTabInfo ? props.useTabInfo() : null
      var tab = info && info.tab ? info.tab : null
      var contentId = tab && typeof tab.contentId === 'string' ? tab.contentId : ''
      var match = /^dsh-resource:\/\/compact-region-archive\/session\/([^/]+)\/(\d+)\/(\d+)$/.exec(contentId)
      var snapState = React.useState({ phase: 'loading', items: [], err: '', start: 0, end: 0 })
      var snap = snapState[0]
      var setSnap = snapState[1]
      React.useEffect(function () {
        if (match === null) {
          setSnap({ phase: 'error', items: [], err: '无法解析存档地址：' + contentId, start: 0, end: 0 })
          return undefined
        }
        var cancelled = false
        var sessionId = match[1]
        try { sessionId = decodeURIComponent(match[1]) } catch (error) { sessionId = match[1] }
        var connection = props.ctx.get('connection')
        if (connection === undefined || connection.rpc === undefined) {
          setSnap({ phase: 'error', items: [], err: 'connection 不可用', start: 0, end: 0 })
          return undefined
        }
        connection.rpc
          .call('/compact-region', 'archive', { sessionId: sessionId, start: Number(match[2]), end: Number(match[3]) }, undefined)
          .then(function (result) {
            if (cancelled) return
            if (result && result.ok === true && result.value) {
              var value = result.value
              var items = Array.isArray(value.items) ? value.items : []
              // 旧的 host 只返回 messages：降级成同样的气泡，别让面板空掉。
              if (items.length === 0 && Array.isArray(value.messages)) {
                items = value.messages.map(function (m) {
                  return { kind: m.role === 'assistant' ? 'assistant' : 'user', seq: m.seq, text: m.text }
                })
              }
              setSnap({ phase: 'ready', items: items, err: '', start: value.start ?? 0, end: value.end ?? 0 })
            } else {
              setSnap({ phase: 'error', items: [], err: (result && result.error && result.error.message) || '读取失败', start: 0, end: 0 })
            }
          })
          .catch(function (error) {
            if (!cancelled) setSnap({ phase: 'error', items: [], err: String(error && error.message ? error.message : error), start: 0, end: 0 })
          })
        return function () {
          cancelled = true
        }
      }, [contentId])

      var body = []
      if (snap.phase === 'loading') body.push(h('div', { className: 'cl-hint', key: 'l' }, '正在读取…'))
      if (snap.err !== '') body.push(h('div', { className: 'cl-err', key: 'e' }, snap.err))
      if (snap.phase === 'ready' && snap.items.length === 0) {
        body.push(h('div', { className: 'cl-hint', key: 'z' }, '（没有可显示的消息）'))
      }
      var host = {
        openArchive: function (data) {
          if (match === null || typeof data.start !== 'number' || typeof data.end !== 'number') return
          var id = match[1]
          try { id = decodeURIComponent(match[1]) } catch (error) { id = match[1] }
          try {
            var sidebar = props.ctx.get('sidebarRight')
            if (sidebar !== undefined && typeof sidebar.openResource === 'function') {
              sidebar.openResource(archiveAddress(id, data.start, data.end))
            }
          } catch (error) {}
        }
      }
      for (var i = 0; i < snap.items.length; i += 1) {
        body.push(archiveItem(snap.items[i], 'm' + i, host))
      }
      return h('div', { className: 'crx', style: { padding: '0 16px', overflowY: 'auto' } },
        h('div', { className: 'crx-head' },
          h('b', null, '被压缩的对话记录'),
          snap.phase === 'ready' ? ' · ' + snap.items.length + ' 项 · seq ' + snap.start + '–' + snap.end : ''),
        body)
    }

    var HIDDEN_ATTR = 'data-compact-region-hidden'
    var STICKY_KINDS = { 'turn-error': 1, 'turn-max-tokens': 1 }
    var HIDE_CSS = '[data-compact-region-hidden]{display:none!important}' + '[data-compact-region-fragment]{position:relative;outline:1px dashed rgba(170,170,170,.55);outline-offset:0}' + '[data-compact-region-fragment-first]::before{content:"该轮次已被部分压缩";position:absolute;top:-10px;left:6px;font-size:10px;line-height:14px;color:#b9b9b9;background:var(--dsw-alias-bg-l1,#151515);padding:0 4px;border-radius:3px;z-index:3}' + '[data-cr-selecting] [data-compact-region-fragment]{outline:none!important}' + '[data-cr-selecting] [data-compact-region-fragment-first]::before{display:none!important}'

    /** Set by the hide layer so an applied checkpoint repaints immediately. */
    var refreshHiding = function () {}

    /** Hide rows whose turn the Host reports as no longer on the surface. */
    function installHiding(ctx, selection) {
      var style = document.createElement('style')
      style.textContent = HIDE_CSS
      document.head.appendChild(style)

      var hidden = {}
      var fragments = {}
      var liveCards = {}
      var liveCardCount = 0
      var cardSlots = []
      var frame = 0
      var disposed = false

      function sessionId() {
        var row = document.querySelector('[data-row-key^="session:"][aria-selected="true"]')
        if (row === null) return null
        var key = row.getAttribute('data-row-key') || ''
        var id = key.slice('session:'.length)
        return id.length > 0 ? id : null
      }

      var currentId = null

      function apply() {
        if (disposed) return
        var flow = document.querySelector('[data-slot="conversation.chat.flow"]')
        if (flow === null) return
        // Switching sessions must forget the previous session's slots at once;
        // otherwise its count keeps the top strip alive until the next poll.
        var id = sessionId()
        if (id !== currentId) {
          currentId = id
          hidden = {}
          fragments = {}
          liveCards = {}
          liveCardCount = 0
          cardSlots = []
        }
        var rows = flow.querySelectorAll('[data-chat-flow-key]')
        var anyRule = cardSlots.length > 0
        for (var key in hidden) { anyRule = true; break }
        if (!anyRule) {
          // Nothing to hide and no checkpoint on this surface: drop the marks
          // and the strip without walking every row.
          for (var r0 = 0; r0 < rows.length; r0 += 1) {
            if (rows[r0].hasAttribute(HIDDEN_ATTR)) rows[r0].removeAttribute(HIDDEN_ATTR)
            if (rows[r0].hasAttribute('data-compact-region-fragment')) {
              rows[r0].removeAttribute('data-compact-region-fragment')
              rows[r0].removeAttribute('data-compact-region-fragment-first')
            }
          }
          return
        }
        var fragmentSeen = {}
        for (var i = 0; i < rows.length; i += 1) {
          var row = rows[i]
          var turn = row.getAttribute('data-chat-turn')
          var kind = row.getAttribute('data-chat-flow-kind') || ''
          // A checkpoint card inherits the anchor turn of the range it replaced.
          // That turn is hidden by definition, so the turn rule must never hide
          // the card itself: only ordinary rows are subject to it.
          var isCard = kind === 'compact-region-card' || kind === 'compact-last-card'
          var hide = !isCard && turn !== null && hidden[turn] === true && STICKY_KINDS[kind] !== 1
          if (!hide && isCard) {
            // A checkpoint card that a later checkpoint already replaced is no
            // longer on the surface; compact-last would still render it. Only
            // act when the slot list actually arrived, otherwise a failed read
            // would hide every card.
            var m = /compact-(?:region|last)-card[:：]?(\d+)$/.exec(row.getAttribute('data-chat-node-key') || '')
            if (m !== null && liveCardCount > 0) hide = liveCards[m[1]] !== true
          }
          if (hide) {
            // Attribute writes are style invalidations even when the value is
            // unchanged: on a long transcript that repaints the whole column.
            if (!row.hasAttribute(HIDDEN_ATTR)) row.setAttribute(HIDDEN_ATTR, '')
          } else if (row.hasAttribute(HIDDEN_ATTR)) {
            row.removeAttribute(HIDDEN_ATTR)
          }
          if (!hide && turn !== null && fragments[turn] === true && row.getBoundingClientRect().height >= 16) {
            if (!row.hasAttribute('data-compact-region-fragment')) row.setAttribute('data-compact-region-fragment', '')
            if (fragmentSeen[turn] !== true) {
              fragmentSeen[turn] = true
              if (!row.hasAttribute('data-compact-region-fragment-first')) row.setAttribute('data-compact-region-fragment-first', '')
            }
          } else {
            if (row.hasAttribute('data-compact-region-fragment')) row.removeAttribute('data-compact-region-fragment')
            if (row.hasAttribute('data-compact-region-fragment-first')) row.removeAttribute('data-compact-region-fragment-first')
          }
        }
      }

      var pending = 0
      function schedule() {
        if (disposed || pending !== 0) return
        // A short debounce: streaming appends mutate the flow many times a
        // second, and each pass reads layout after writing attributes.
        pending = window.setTimeout(function () {
          pending = 0
          try {
            apply()
          } catch (error) {}
        }, 60)
      }

      function refresh() {
        var id = sessionId()
        if (id === null) return
        var requestId = id
        var connection = ctx.get('connection')
        if (connection === undefined || connection.rpc === undefined) return
        var signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
        try {
          connection.rpc
            .call('/compact-region', 'turns', { sessionId: id }, signal)
            .then(function (result) {
              if (disposed || result === null || result === undefined || result.ok !== true || !result.value) return
              // A response for a session the user already left would paint its
              // turns onto the new transcript.
              if (requestId !== sessionId()) return
              currentId = requestId
              hidden = {}
              fragments = {}
              liveCards = {}
              cardSlots = []
              var list = result.value.hidden || []
              for (var i = 0; i < list.length; i += 1) hidden[String(list[i])] = true
              var slots = result.value.slots || []
              for (var s = 0; s < slots.length; s += 1) {
                if (slots[s].kind === 'checkpoint') {
                  liveCards[String(slots[s].seq)] = true
                  cardSlots.push({ seq: slots[s].seq, start: slots[s].start, end: slots[s].end, shadowed: slots[s].shadowed })
                }
                if (slots[s].kind === 'turn' && slots[s].fragment === true) fragments[String(slots[s].turn)] = true
              }
              liveCardCount = Object.keys(liveCards).length
              // The chat keeps control of scroll anchoring; do not force-load older history here.
              schedule()
            })
            .catch(function () {})
        } catch (error) {}
      }

      var observer = new MutationObserver(schedule)
      observer.observe(document.body, { childList: true, subtree: true })
      document.addEventListener('scroll', schedule, true)
      window.addEventListener('resize', schedule)
      refresh()
      var timer = window.setInterval(refresh, 4000)
      refreshHiding = refresh
      schedule()

      return function () {
        disposed = true
        if (refreshHiding === refresh) refreshHiding = function () {}
        observer.disconnect()
        window.clearInterval(timer)
        if (frame !== 0) window.cancelAnimationFrame(frame)
        document.removeEventListener('scroll', schedule, true)
        window.removeEventListener('resize', schedule)
        var rows = document.querySelectorAll('[' + HIDDEN_ATTR + ']')
        for (var i = 0; i < rows.length; i += 1) rows[i].removeAttribute(HIDDEN_ATTR)
        try { style.remove() } catch (error) {}
      }
    }

    var SELECT_STYLE = [
      '[data-compact-region-select]{position:fixed;inset:0;z-index:2147482900;pointer-events:none}',
      '[data-cr-box-host]{position:absolute;left:0;top:0;width:100%;height:0;pointer-events:none;overflow:visible;z-index:5}',
      '[data-cr-hit]{position:absolute;pointer-events:none;border-radius:6px;background:rgba(255,255,255,.02);z-index:5}',
      '[data-cr-hit][data-on]{background:rgba(59,130,246,.10);box-shadow:inset 0 0 0 1px rgba(59,130,246,.9)}',
      '[data-cr-mark]{position:fixed;pointer-events:none;font:11px/16px ui-monospace,monospace;color:#cfe0ff;',
      'background:rgba(24,24,28,.95);padding:1px 5px;border-radius:4px;border:1px solid rgba(120,170,255,.35)}',
      '[data-compact-region-panel]{position:fixed;right:16px;bottom:96px;z-index:2147482901;display:flex;gap:8px;align-items:center;',
      'padding:8px 10px;border-radius:8px;background:rgba(20,20,24,.95);border:1px solid rgba(120,170,255,.55);',
      'color:#dfe7f5;font:12px/18px ui-monospace,monospace;pointer-events:auto}',
      '[data-compact-region-panel] button{font:12px/18px inherit;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.2);',
      'background:transparent;color:#dfe7f5;cursor:pointer}',
      '[data-compact-region-panel] button[data-primary]{background:#2f6bff;border-color:#2f6bff;color:#fff}',
      // Side layout: parked in the empty gutter so it covers nothing at all.
      '[data-compact-region-panel][data-side]{flex-direction:column;align-items:stretch;width:190px;gap:6px}',
      '[data-compact-region-panel][data-side] [data-cr-count]{font-weight:600}',
      '[data-compact-region-panel][data-side] [data-cr-range]{color:#9fb4d8;font-size:11px}',
      '[data-compact-region-panel][data-side] [data-cr-actions]{display:flex;gap:6px}',
      '[data-compact-region-panel][data-side] [data-cr-actions] button{flex:1}',
      '[data-compact-region-note]{color:#f0a040}',
      '[data-compact-region-dialog]{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483002;',
      'width:min(760px,90vw);max-height:74vh;display:flex;flex-direction:column;gap:8px;padding:14px;border-radius:10px;',
      'background:rgba(20,20,24,.98);border:1px solid rgba(120,170,255,.55);box-shadow:0 18px 60px rgba(0,0,0,.55);',
      'color:#dfe7f5;font:12px/18px ui-monospace,monospace}',
      '[data-compact-region-dialog] [data-crd-head]{color:#a9c4f0}',
      '[data-compact-region-dialog] textarea{flex:1;min-height:240px;max-height:52vh;resize:vertical;background:rgba(0,0,0,.35);',
      'color:#e8eefb;border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:8px;font:12px/1.5 ui-monospace,monospace}',
      '[data-compact-region-dialog] [data-crd-row]{display:flex;align-items:center;gap:8px}',
      '[data-compact-region-dialog] [data-crd-note]{flex:1;color:#f0a040;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '[data-compact-region-dialog] button{font:12px/18px inherit;padding:5px 12px;border-radius:6px;',
      'border:1px solid rgba(255,255,255,.2);background:transparent;color:#dfe7f5;cursor:pointer}',
      '[data-compact-region-dialog] button[data-primary]{background:#2f6bff;border-color:#2f6bff;color:#fff}',
      '[data-compact-region-dialog] button[disabled]{opacity:.5;cursor:default}'
    ].join('')

    /** Turn-selection mode: pick a contiguous run of visible turns. */
    function createSelection(ctx) {
      var state = { active: false, selected: {}, slots: null, selectable: {}, sessionId: null, note: '', fromTurn: null, busy: false, op: 0 }
      var layer = null
      var boxHost = null
      var boxHostScroller = null
      var boxHostRestore = ''
      var panel = null
      var dialog = null
      var style = null
      var frame = 0
      var poll = 0
      var observer = null

      function currentSessionId() {
        var row = document.querySelector('[data-row-key^="session:"][aria-selected="true"]')
        if (row === null) return null
        var id = (row.getAttribute('data-row-key') || '').slice('session:'.length)
        return id.length > 0 ? id : null
      }

      /** Ordered selectable entries: turns and checkpoint cards alike. */
      function slotKeys() {
        var list = []
        if (!Array.isArray(state.slots)) return list
        for (var i = 0; i < state.slots.length; i += 1) {
          var slot = state.slots[i]
          if (slot.kind === 'turn') list.push({ key: 't:' + slot.turn, label: 't' + slot.turn, turn: slot.turn })
          else if (slot.kind === 'checkpoint') list.push({ key: 'c:' + slot.seq, label: '卡' + String(slot.seq).slice(-4), seq: slot.seq })
        }
        return list
      }

      function rowKey(row) {
        var kind = row.getAttribute('data-chat-flow-kind') || ''
        if (kind === 'compact-region-card' || kind === 'compact-last-card') {
          var match = /card(\d+)$/.exec(row.getAttribute('data-chat-node-key') || '')
          return match === null ? null : 'c:' + match[1]
        }
        var turn = row.getAttribute('data-chat-turn')
        return turn === null ? null : 't:' + turn
      }

      function selectedKeys() {
        var out = []
        var entries = slotKeys()
        for (var i = 0; i < entries.length; i += 1) if (state.selected[entries[i].key] === true) out.push(entries[i])
        return out
      }

      function contiguous() {
        var entries = slotKeys()
        var picked = []
        for (var i = 0; i < entries.length; i += 1) if (state.selected[entries[i].key] === true) picked.push(i)
        if (picked.length === 0) return false
        for (var k = 1; k < picked.length; k += 1) if (picked[k] !== picked[k - 1] + 1) return false
        return true
      }

      /** The chat scroller element: boxes live inside it, under the composer. */
      function scrollerEl() {
        var first = document.querySelector('[data-chat-flow-key]')
        if (first === null) return null
        var el = first.parentElement
        while (el !== null && el !== document.body) {
          var s = window.getComputedStyle(el)
          if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10) return el
          el = el.parentElement
        }
        return first.parentElement
      }

      function viewRect() {
        var el = scrollerEl()
        return el === null ? null : el.getBoundingClientRect()
      }

      /**
       * Top edge of the composer card. The panel sits above it so the input row
       * stays usable, but selection boxes deliberately run underneath the
       * composer: the message bar paints over them, not the other way round.
       */
      function composerTop() {
        var input = document.querySelector('[contenteditable="true"]')
        if (input === null) return window.innerHeight - 96
        var el = input
        for (var i = 0; i < 8 && el !== null; i += 1) {
          var r = el.getBoundingClientRect()
          if (r.width > 500 && r.height > 80 && r.height < 400) return r.top
          el = el.parentElement
        }
        return input.getBoundingClientRect().top
      }

      function placePanel() {
        var view = viewRect()
        var first = document.querySelector('[data-chat-flow-key]')
        var right = first === null ? window.innerWidth : first.getBoundingClientRect().right
        var gutter = window.innerWidth - right - 16
        if (gutter >= 170) {
          panel.setAttribute('data-side', '')
          panel.style.left = Math.round(right + 8) + 'px'
          panel.style.top = Math.round((view === null ? 76 : view.top) + 24) + 'px'
          panel.style.right = 'auto'
          panel.style.bottom = 'auto'
        } else {
          panel.removeAttribute('data-side')
          panel.style.left = 'auto'
          panel.style.top = 'auto'
          panel.style.right = '16px'
          panel.style.bottom = Math.round(Math.max(8, window.innerHeight - (composerTop() - 10))) + 'px'
        }
      }

      /**
       * Boxes are absolutely positioned inside the scroll container, in content
       * coordinates, so they scroll with the rows and are clipped by the same
       * overflow the conversation is. The composer is a later sibling with its
       * own background, so it covers the box instead of the box dodging it.
       */
      function ensureBoxHost() {
        var scroller = scrollerEl()
        if (scroller === null) return null
        if (boxHost !== null && boxHost.parentElement === scroller) return boxHost
        if (boxHost !== null) {
          try { boxHost.remove() } catch (error) {}
        }
        if (window.getComputedStyle(scroller).position === 'static') {
          boxHostRestore = scroller.style.position
          scroller.style.position = 'relative'
          boxHostScroller = scroller
        }
        boxHost = document.createElement('div')
        boxHost.setAttribute('data-cr-box-host', '')
        boxHost.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:0;pointer-events:none;overflow:visible;z-index:5'
        scroller.appendChild(boxHost)
        return boxHost
      }

      function draw() {
        if (!state.active || layer === null) return
        var host = ensureBoxHost()
        if (host === null) {
          console.warn('[compact-region] no scroller for selection boxes')
          return
        }
        var scroller = host.parentElement
        var srect = scroller.getBoundingClientRect()
        var contentTop = scroller.scrollTop - srect.top
        var contentLeft = scroller.scrollLeft - srect.left
        var clipTop = Math.max(0, Math.round(srect.top))
        var clipBottom = Math.round(srect.bottom)
        var rows = document.querySelectorAll('[data-chat-flow-key]')
        var groups = {}
        var order = []
        for (var i = 0; i < rows.length; i += 1) {
          var row = rows[i]
          var key = rowKey(row)
          if (key === null || state.selectable[key] !== true) continue
          var rect = row.getBoundingClientRect()
          if (rect.height < 8 || rect.bottom < clipTop + 2 || rect.top > clipBottom - 2) continue
          var g = groups[key]
          if (g === undefined) {
            groups[key] = { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
            order.push(key)
          } else {
            if (rect.top < g.top) g.top = rect.top
            if (rect.bottom > g.bottom) g.bottom = rect.bottom
            if (rect.left < g.left) g.left = rect.left
            if (rect.right > g.right) g.right = rect.right
          }
        }
        var boxes = ''
        var marks = ''
        for (var k = 0; k < order.length; k += 1) {
          var key2 = order[k]
          var box = groups[key2]
          if (box.bottom - box.top < 6) continue
          var on = state.selected[key2] === true
          // A little wider than the row so the outline never sits on top of the
          // text edge; the label rides inside the box, at its top-left corner.
          var pad = 6
          boxes += '<div data-cr-hit' + (on ? ' data-on' : '') + ' data-key="' + key2 +
            '" style="left:' + Math.round(box.left + contentLeft - pad) + 'px;top:' + Math.round(box.top + contentTop) +
            'px;width:' + Math.round(box.right - box.left + pad * 2) + 'px;height:' + Math.round(box.bottom - box.top) + 'px"></div>'
          var label = key2.slice(0, 1) === 'c' ? '卡' : 't'
          var markTop = Math.min(Math.max(Math.round(box.top) + 4, clipTop + 4), clipBottom - 24)
          var markLeft = Math.min(Math.max(Math.round(box.left) + 8, srect.left + 4), srect.right - 64)
          marks += '<div data-cr-mark style="left:' + markLeft +
            'px;top:' + markTop + 'px">' + (on ? '☑' : '☐') + ' ' + label + key2.slice(2) + '</div>'
        }
        host.innerHTML = boxes
        layer.innerHTML = marks
        placePanel()
        renderPanel()
      }

      /** Auto-fill per 概述.md: a click outside the range extends it to the new edge. */
      function toggleKey(key) {
        var entries = slotKeys()
        var index = -1
        for (var i = 0; i < entries.length; i += 1) if (entries[i].key === key) { index = i; break }
        if (index === -1) return
        if (state.selected[key] === true) {
          delete state.selected[key]
          return
        }
        var picked = []
        for (var j = 0; j < entries.length; j += 1) if (state.selected[entries[j].key] === true) picked.push(j)
        if (picked.length === 0) {
          state.selected[key] = true
          return
        }
        var min = picked[0]
        var max = picked[picked.length - 1]
        if (index < min) {
          for (var a = index; a <= min; a += 1) state.selected[entries[a].key] = true
        } else if (index > max) {
          for (var b = max; b <= index; b += 1) state.selected[entries[b].key] = true
        } else {
          state.selected[key] = true
        }
      }
      /** One listener for the whole selection: click anywhere in a slot. */
      function onFlowClick(event) {
        if (!state.active) return
        var target = event.target
        if (target === null || typeof target.closest !== 'function') return
        if (target.closest('[data-compact-region-panel]') !== null) return
        // Selection must not swallow the row's own controls: copy, like, branch,
        // links and inputs keep working while turns are being picked.
        if (target.closest('button, a, input, textarea, select, [role="button"], [contenteditable="true"]') !== null) return
        var row = target.closest('[data-chat-flow-key]')
        if (row === null) return
        var key = rowKey(row)
        if (key === null || state.selectable[key] !== true) return
        event.preventDefault()
        event.stopPropagation()
        toggleKey(key)
        state.note = ''
        schedule()
      }

      function renderPanel() {
        var picked = selectedKeys()
        var side = panel.getAttribute('data-side') !== null
        var range = picked.length === 0 ? '未选' : picked[0].label + '…' + picked[picked.length - 1].label
        var signature = picked.length + '|' + range + '|' + state.note + '|' + (side ? 'side' : 'bar')
        if (panel.getAttribute('data-sig') === signature) return
        panel.setAttribute('data-sig', signature)
        var note = state.note === '' ? '' : '<span data-compact-region-note>' + state.note + '</span>'
        if (side) {
          panel.innerHTML =
            '<div data-cr-count>已选 ' + picked.length + ' 轮</div>' +
            '<div data-cr-range>' + range + '</div>' +
            note +
            '<div data-cr-actions><button type="button" data-primary data-act="go">压缩</button>' +
            '<button type="button" data-act="cancel">取消</button></div>'
          return
        }
        panel.innerHTML =
          '<span>' + (picked.length === 0 ? '未选轮次' : '已选 ' + picked.length + ' 个（' + picked[0].label + '…' + picked[picked.length - 1].label + '）') + '</span>' +
          note +
          '<button type="button" data-primary data-act="go">压缩</button>' +
          '<button type="button" data-act="cancel">取消</button>'
      }
      function schedule() {
        if (!state.active || frame !== 0) return
        frame = window.requestAnimationFrame(function () {
          frame = 0
          try {
            draw()
          } catch (error) {
            console.warn('[compact-region] draw failed', error)
          }
        })
      }

      function onChipChange(event) {
        var input = event.target
        if (input === null || typeof input.getAttribute !== 'function') return
        var turn = Number(input.getAttribute('data-turn'))
        if (turn !== turn) return
        if (input.checked) state.selected[turn] = true
        else delete state.selected[turn]
        state.note = ''
        schedule()
      }

      function onLayerClick(event) {
        var action = event.target && event.target.closest ? event.target.closest('[data-act]') : null
        if (action === null) return
        var act = action.getAttribute('data-act')
        if (act === 'cancel') leave()
        else if (act === 'go') go()
      }

      function closeDialog() {
        try {
          if (dialog !== null) dialog.remove()
        } catch (error) {}
        dialog = null
      }

      /** The editable summary preview, styled like compact-last's modal. */
      function showDialog(id, range, preview) {
        closeDialog()
        dialog = document.createElement('div')
        dialog.setAttribute('data-compact-region-dialog', '')
        dialog.innerHTML =
          '<div class="cl-overlay"><div class="cl-modal">' +
          '<div class="cl-modal-head"><div class="cl-modal-title">压缩预览</div>' +
          '<div class="cl-modal-sub">seq ' + range.start + '..' + range.end + ' · ' + range.count + ' 条将被替换 · ' +
          preview.provider + '/' + preview.model + '</div></div>' +
          '<div class="cl-modal-body"><textarea class="cl-ta" data-crd-text spellcheck="false"></textarea>' +
          '<div class="cl-err" data-crd-note></div></div>' +
          '<div class="cl-modal-foot">' +
          '<button type="button" class="cl-btn" data-crd-act="retry">重新生成</button>' +
          '<button type="button" class="cl-btn" data-crd-act="cancel">取消</button>' +
          '<button type="button" class="cl-btn primary" data-crd-act="apply">应用</button>' +
          '</div></div></div>'
        document.body.appendChild(dialog)
        var textarea = dialog.querySelector('[data-crd-text]')
        var note = dialog.querySelector('[data-crd-note]')
        textarea.value = preview.text
        textarea.focus()
        var overlay = dialog.querySelector('.cl-overlay')
        overlay.addEventListener('mousedown', function (event) {
          if (event.target === overlay) closeDialog()
        })

        function setNote(text) {
          note.textContent = text
        }

        dialog.addEventListener('click', function (event) {
          var button = event.target && event.target.closest ? event.target.closest('[data-crd-act]') : null
          if (button === null) return
          var act = button.getAttribute('data-crd-act')
          if (act === 'cancel') {
            closeDialog()
            return
          }
          var connection = ctx.get('connection')
          if (connection === undefined || connection.rpc === undefined) return
          if (act === 'retry') {
            button.disabled = true
            setNote('重新生成…')
            try {
              connection.rpc
                .call('/compact-region', 'preview', { sessionId: id, start: range.start, end: range.end }, undefined)
                .then(function (result) {
                  if (result && result.ok === true && result.value) {
                    textarea.value = result.value.text
                    setNote('')
                  } else {
                    setNote((result && result.error && result.error.message) || '生成失败')
                  }
                })
                .catch(function (error) {
                  setNote(String(error && error.message ? error.message : error))
                })
                .then(function () {
                  button.disabled = false
                })
            } catch (error) {
              button.disabled = false
            }
            return
          }
          if (act === 'apply') {
            button.disabled = true
            setNote('写入中…')
            try {
              connection.rpc
                .call('/compact-region', 'apply', { sessionId: id, start: range.start, end: range.end, text: textarea.value }, undefined)
                .then(function (result) {
                  if (result && result.ok === true) {
                    closeDialog()
                    leave()
                    refreshHiding()
                    // The checkpoint is a replacement node anchored at the
                    // start of the replaced range. If that anchor is older than
                    // the loaded window the chat never assembles the card at
                    // all, so pull the window back to it once and then reveal.
                    try {
                      var sessions = ctx.get('sessions')
                      var binding = sessions && typeof sessions.binding === 'function' ? sessions.binding(id) : undefined
                      var session = binding && binding.session
                      if (session && typeof session.loadThrough === 'function') {
                        session.loadThrough(range.start).catch(function () {})
                      } else if (binding && typeof binding.rebuild === 'function') {
                        binding.rebuild()
                      }
                    } catch (error) {}
                    window.setTimeout(function () {
                      try {
                        var card = document.querySelector('[data-chat-flow-kind="' + CARD_KIND + '"]')
                        if (card !== null && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'center' })
                      } catch (error) {}
                      refreshHiding()
                    }, 600)
                  } else {
                    button.disabled = false
                    setNote((result && result.error && result.error.message) || '写入失败')
                  }
                })
                .catch(function (error) {
                  button.disabled = false
                  setNote(String(error && error.message ? error.message : error))
                })
            } catch (error) {
              button.disabled = false
            }
          }
        })
      }

      function go() {
        if (state.busy) return
        if (!contiguous()) {
          state.note = '选择必须连续'
          schedule()
          return
        }
        var picked = selectedKeys()
        var id = currentSessionId()
        if (id === null) return
        var connection = ctx.get('connection')
        if (connection === undefined || connection.rpc === undefined) return
        var keys = []
        for (var i = 0; i < picked.length; i += 1) keys.push(picked[i].key)
        var token = state.op
        state.busy = true
        state.note = '正在生成摘要…'
        schedule()
        try {
          connection.rpc
            .call('/compact-region', 'range', { sessionId: id, keys: keys }, undefined)
            .then(function (result) {
              if (token !== state.op || !state.active) return null
              if (!(result && result.ok === true && result.value)) {
                state.busy = false
                state.note = '范围失败：' + ((result && result.error && result.error.message) || '无效区间')
                console.warn('[compact-region] range failed', result && result.error)
                schedule()
                return null
              }
              var range = result.value
              return connection.rpc
                .call('/compact-region', 'preview', { sessionId: id, start: range.start, end: range.end }, undefined)
                .then(function (preview) {
                  if (token !== state.op || !state.active) return
                  state.busy = false
                  if (!(preview && preview.ok === true && preview.value)) {
                    state.note = '摘要失败：' + ((preview && preview.error && preview.error.message) || '生成失败')
                    console.warn('[compact-region] preview failed', preview && preview.error)
                    schedule()
                    return
                  }
                  state.note = ''
                  showDialog(id, range, preview.value)
                  schedule()
                })
            })
            .catch(function (error) {
              state.busy = false
              state.note = '请求失败：' + String(error && error.message ? error.message : error)
              console.warn('[compact-region] go failed', error)
              schedule()
            })
        } catch (error) {
          state.busy = false
          state.note = String(error && error.message ? error.message : error)
          schedule()
        }
      }

      function onKey(event) {
        if (event.key === 'Escape' && state.active) {
          event.stopPropagation()
          leave()
        }
      }

      function mount() {
        document.body.setAttribute('data-cr-selecting', '')
        if (style === null) {
          style = document.createElement('style')
          style.textContent = SELECT_STYLE
          document.head.appendChild(style)
        }
        layer = document.createElement('div')
        layer.setAttribute('data-compact-region-select', '')
        document.body.appendChild(layer)
        panel = document.createElement('div')
        panel.setAttribute('data-compact-region-panel', '')
        document.body.appendChild(panel)
        panel.addEventListener('click', onLayerClick, true)
        document.addEventListener('click', onFlowClick, true)
        window.addEventListener('keydown', onKey, true)
        observer = new MutationObserver(schedule)
        observer.observe(document.body, { childList: true, subtree: true })
        document.addEventListener('scroll', schedule, true)
        window.addEventListener('resize', schedule)
        state.sessionId = currentSessionId()
        poll = window.setInterval(function () {
          if (currentSessionId() !== state.sessionId) leave()
        }, 1000)
        schedule()
      }

      function enter(fromTurn) {
        if (state.active) return
        state.op += 1
        state.active = true
        state.busy = false
        state.selected = {}
        state.note = ''
        state.fromTurn = typeof fromTurn === 'number' ? fromTurn : null
        var id = currentSessionId()
        state.sessionId = id
        var connection = ctx.get('connection')
        if (id === null || connection === undefined || connection.rpc === undefined) {
          state.active = false
          return
        }
        try {
          connection.rpc.call('/compact-region', 'turns', { sessionId: id }, undefined).then(function (result) {
            if (!state.active) return
            if (result && result.ok === true && result.value) {
              state.slots = result.value.slots || []
              state.selectable = {}
              var entries = slotKeys()
              for (var si = 0; si < entries.length; si += 1) state.selectable[entries[si].key] = true
              var started = false
              for (var i = 0; i < entries.length; i += 1) {
                if (!started && state.fromTurn !== null && entries[i].key === 't:' + state.fromTurn) started = true
                if (state.fromTurn === null ? i === entries.length - 1 : started) state.selected[entries[i].key] = true
              }
              mount()
            } else {
              state.active = false
              console.warn('[compact-region] turns failed ' + JSON.stringify((result && result.error) || null))
            }
          }).catch(function (error) {
            state.active = false
            console.warn('[compact-region] turns request failed', error)
          })
        } catch (error) {
          state.active = false
          console.warn('[compact-region] turns call threw', error)
        }
      }

      function leave() {
        // Invalidate every in-flight range/preview so a cancelled selection can
        // never pop the preview modal afterwards.
        state.op += 1
        state.active = false
        state.note = ''
        state.busy = false
        state.selected = {}
        document.body.removeAttribute('data-cr-selecting')
        closeDialog()
        window.clearInterval(poll)
        poll = 0
        try { if (observer !== null) observer.disconnect() } catch (error) {}
        window.removeEventListener('keydown', onKey, true)
        document.removeEventListener('click', onFlowClick, true)
        document.removeEventListener('scroll', schedule, true)
        window.removeEventListener('resize', schedule)
        try { if (layer !== null) layer.remove() } catch (error) {}
        try { if (panel !== null) panel.remove() } catch (error) {}
        try { if (boxHost !== null) boxHost.remove() } catch (error) {}
        if (boxHostScroller !== null) {
          try { boxHostScroller.style.position = boxHostRestore } catch (error) {}
        }
        var painted = document.querySelectorAll('[data-cr-sel]')
        for (var i = 0; i < painted.length; i += 1) painted[i].removeAttribute('data-cr-sel')
        layer = null
        boxHost = null
        boxHostScroller = null
        boxHostRestore = ''
        panel = null
      }

      return { enter: enter, leave: leave, isActive: function () { return state.active } }
    }

    var ENTRY_CLASS = 'compact-region-entry'

    /** The row's action bar: the parent of its last button. */
    function findButtonContainer(row) {
      if (row === null || row === undefined) return undefined
      var buttons = Array.prototype.slice.call(row.querySelectorAll('button'))
      var last = buttons.filter(function (button) {
        return button.classList.contains(ENTRY_CLASS) === false
      }).pop()
      var container = last && last.parentElement
      if (container && container.querySelector('button')) return container
      return undefined
    }

    /**
     * Portal host: renders nothing in the header itself, but portals one
     * "⤵ 压缩" button into every user message's action bar. Copying
     * compact-last's placement keeps the button inside the row's own layout
     * instead of floating over the timestamp.
     */
    function createBridge(selection) {
      return function Bridge() {
        var tick = React.useState(0)
        var setTick = tick[1]
        React.useEffect(function () {
          var timer = window.setInterval(function () {
            setTick(function (n) {
              return n + 1
            })
          }, 1000)
          return function () {
            window.clearInterval(timer)
          }
        }, [])
        var portals = []
        var rows = document.querySelectorAll('[data-chat-flow-kind="user"][data-chat-anchor-key], [data-chat-flow-kind="steering"][data-chat-anchor-key]')
        for (var i = 0; i < rows.length; i += 1) {
          var row = rows[i]
          var turn = Number(row.getAttribute('data-chat-turn'))
          if (turn !== turn) continue
          var container = findButtonContainer(row)
          if (container === undefined) continue
          var key = row.getAttribute('data-chat-anchor-key') || String(i)
          portals.push(
            ReactDOM.createPortal(
              h(
                'button',
                {
                  type: 'button',
                  className: ENTRY_CLASS,
                  'data-compact-region-entry': '',
                  title: '从这里开始压缩',
                  style: {
                    font: '12px/18px inherit',
                    padding: '0 4px',
                    marginLeft: 2,
                    border: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    opacity: 0.75,
                    cursor: 'pointer'
                  },
                  onClick: (function (entryTurn) {
                    return function (event) {
                      event.preventDefault()
                      event.stopPropagation()
                      // A second click on any row restarts the selection there
                      // instead of silently doing nothing while a range is open.
                      if (selection.isActive()) selection.leave()
                      selection.enter(entryTurn)
                    }
                  })(turn)
                },
                '⤵ 压缩'
              ),
              container,
              'cr-' + key
            )
          )
        }
        return portals.length > 0 ? portals : null
      }
    }

    /** 读语言包目录：文件名就是语言名，宿主那边的 languages 端点负责扫。 */
    function loadPacks(ctx) {
      return new Promise(function (resolve) {
        var connection = ctx.get('connection')
        if (connection === undefined || connection.rpc === undefined) {
          resolve({ dir: '', packs: [], error: 'connection 不可用' })
          return
        }
        connection.rpc
          .call('/compact-region', 'languages', {}, undefined)
          .then(function (result) {
            if (result && result.ok === true && result.value) resolve(result.value)
            else resolve({ dir: '', packs: [], error: (result && result.error && result.error.message) || '读取语言包目录失败' })
          })
          .catch(function (error) {
            resolve({ dir: '', packs: [], error: String((error && error.message) || error) })
          })
      })
    }

    /**
     * 插件页上的设置卡片。只有一个语言下拉框：选项就是语言包目录里的文件，
     * 每次打开都重新扫一遍，所以新丢进去的文件不用重启就能看见。
     * 整段外面套了 try/catch —— 卡片起不来不能让聊天界面跟着坏。
     */
    function installSettingsCard(ctx) {
      var primitives = require('@deepseek-ai/dsh-client-ui-primitives')
      var forms = ctx.configForms
      if (forms === undefined || typeof forms.get !== 'function') return null
      var model = new primitives.SettingsFormModel(forms.get('compact-region'), [
        {
          field: 'language',
          format: function (value) { return typeof value === 'string' && value.length > 0 ? value : 'en' },
          parse: function (text) { return text === 'en' ? { kind: 'clear' } : { kind: 'set', value: text } },
        },
      ])
      var store = model.bind(function () {
        return Object.assign({}, model.shell(), { language: model.field('language') })
      })

      function SettingsCard(props) {
        var state = props.useSettingsCard(function (snapshot) { return snapshot })
        var listingState = React.useState(null)
        var listing = listingState[0]
        var setListing = listingState[1]
        var tickState = React.useState(0)
        var tick = tickState[0]
        var reload = tickState[1]

        React.useEffect(function () {
          var alive = true
          loadPacks(ctx).then(function (next) { if (alive) setListing(next) })
          return function () { alive = false }
        }, [tick])

        if (props.view === 'summary') return null

        var current = state.language && typeof state.language.text === 'string' && state.language.text.length > 0
          ? state.language.text
          : 'en'
        var disabled = !state.writable || state.saving
        var packs = listing !== null && Array.isArray(listing.packs) ? listing.packs : []
        var options = []
        var known = false
        for (var i = 0; i < packs.length; i += 1) {
          var pack = packs[i]
          if (pack.id === current) known = true
          options.push(
            h('option', { key: 'p' + pack.id, value: pack.id },
              pack.problem === undefined ? pack.id : pack.id + '（无法读取：' + pack.problem + '）')
          )
        }
        if (!known) {
          options.unshift(h('option', { key: 'current', value: current },
            packs.length > 0 ? current + '（目录里没有这个文件）' : current))
        }

        var hint
        if (listing === null) hint = '正在读取语言包目录…'
        else if (listing.error) hint = listing.error
        else if (packs.length === 0) hint = '目录还是空的。把一个 JSON 文件放进去，文件名就是语言名，例如 中文.json。'
        else hint = '目录：' + listing.dir

        return h(primitives.SettingsForm, {
          labels: {
            unavailable: '插件未加载，暂时不能配置',
            readOnly: '当前环境的设置为只读',
            saveFailed: '设置没有被接受，请检查后重试',
            save: '保存',
            saving: '保存中…',
          },
          state: state,
          onSave: props.save,
          onDiscard: props.discard,
        }, h('div', { key: 'body', style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
          h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
            h('span', { key: 'label', style: { fontSize: '13px', flex: '0 0 auto' } }, '摘要语言'),
            h('select', {
              key: 'select',
              value: current,
              disabled: disabled,
              onChange: function (event) { props.edit('language', event.target.value) },
              style: {
                flex: '1 1 auto',
                minWidth: '0',
                fontSize: '13px',
                padding: '4px 6px',
                borderRadius: '6px',
                color: 'inherit',
                background: 'var(--dsw-alias-bg-l2, #1f1f1f)',
                border: '1px solid var(--dsw-alias-border-l2, #3a3a3a)',
              },
            }, options),
            h('button', {
              key: 'refresh',
              type: 'button',
              disabled: disabled,
              onClick: function () { setListing(null); reload(tick + 1) },
              style: {
                flex: '0 0 auto',
                fontSize: '12px',
                padding: '4px 8px',
                borderRadius: '6px',
                cursor: 'pointer',
                color: 'inherit',
                background: 'transparent',
                border: '1px solid var(--dsw-alias-border-l2, #3a3a3a)',
              },
            }, '刷新'),
          ]),
          h('p', {
            key: 'hint',
            style: { margin: '0', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #9a9a9a)', wordBreak: 'break-all' },
          }, hint),
        ]))
      }

      var disposeRegistration = ctx.slots.inject('plugins.bundle.config', function () {
        return ctx.slots.register(
          {
            name: 'plugins.bundle.config',
            key: 'compact-region',
            inject: function () {
              var injected = model.actions()
              injected.hooks = { settingsCard: store }
              return injected
            },
          },
          SettingsCard
        )
      })
      return function () {
        try { disposeRegistration() } catch (error) {}
        try { model.dispose() } catch (error) {}
      }
    }

    return {
      name: 'compact-region',
      inject: ['uiConversation', 'slots', 'connection', 'sessions', 'configForms'],
      apply: function (ctx) {
        var selection = createSelection(ctx)
        var cardStyle = null
        try {
          cardStyle = document.createElement('style')
          cardStyle.dataset.plugin = 'compact-region'
          cardStyle.textContent = CARD_CSS
          document.head.appendChild(cardStyle)
        } catch (error) {
          cardStyle = null
        }
        var settingsDispose = null
        try {
          settingsDispose = installSettingsCard(ctx)
        } catch (error) {
          // 设置卡片是可选装饰：起不来就只少一张卡片。
          settingsDispose = null
        }
        function Trigger() {
          return h(
            'button',
            {
              type: 'button',
              onClick: function () {
                selection.enter()
              },
              style: {
                font: '12px/18px inherit',
                padding: '3px 10px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,.18)',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer'
              }
            },
            '压缩'
          )
        }
        var disposals = []
        try {
          disposals.push(
            ctx.inject(['uiConversation'], function (scope) {
              var ui = scope.get('uiConversation')
              if (!ui || !ui.events) return undefined
              return ui.events.register(cardDefinition())
            })
          )
        } catch (error) {
          // Keep the default rendering when registration fails.
        }
        try {
          disposals.push(
            ctx.slots.inject('conversation.chat.node', function () {
              return ctx.slots.register({ name: 'conversation.chat.node', key: CARD_KIND }, function CardEntry(cardProps) {
                return h(CardView, Object.assign({}, cardProps, {
                  onArchive: function (data) {
                    var sidebar = ctx.get('sidebarRight')
                    var sessionId = selectedSessionId()
                    if (sidebar === undefined || typeof sidebar.openResource !== 'function' || sessionId === null) return
                    if (typeof data.start !== 'number' || typeof data.end !== 'number') return
                    sidebar.openResource(archiveAddress(sessionId, data.start, data.end))
                  }
                }))
              })
            })
          )
        } catch (error) {
          // Keep the unknown-surface fallback when the renderer cannot register.
        }
        try {
          disposals.push(
            ctx.inject(['sidebarRightTabs'], function (scope) {
              return scope.sidebarRightTabs.register({
                id: 'compact-region',
                kind: ARCHIVE_KIND,
                patterns: ['dsh-resource://' + ARCHIVE_KIND + '/**'],
                priority: 'builtin',
                canOpen: function (address) {
                  return typeof address === 'string' && address.indexOf('dsh-resource://' + ARCHIVE_KIND + '/') === 0
                },
                title: function () {
                  return '压缩存档'
                }
              })
            })
          )
        } catch (error) {
          // Without the tab the archive button stays disabled.
        }
        try {
          disposals.push(
            ctx.slots.inject('sidebar.right.pane.tab', function () {
              return ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'compact-region' }, function PaneEntry(paneProps) {
                return h(ArchivePane, Object.assign({ ctx: ctx }, paneProps))
              })
            })
          )
        } catch (error) {
          // Pane registration is optional.
        }
        try {
          disposals.push(installHiding(ctx, selection))
        } catch (error) {
          // Hiding is best-effort; never break the Chat.
        }
        // Manual hook: open any archived range as a sidebar tab. Handy when the
        // card that owns it is older than the loaded window.
        try {
          window.__compactRegionOpenArchive = function (sessionId, start, end) {
            var sidebar = ctx.get('sidebarRight')
            if (sidebar === undefined || typeof sidebar.openResource !== 'function') return false
            sidebar.openResource(archiveAddress(sessionId, start, end))
            return true
          }
        } catch (error) {}
        try {
          var Bridge = createBridge(selection)
          disposals.push(
            ctx.slots.inject('conversation.session.header.actions', function () {
              return ctx.slots.register({ name: 'conversation.session.header.actions', id: 'compact-region-portals', order: 1000 }, Bridge)
            })
          )
        } catch (error) {
          // Without the portal host the per-message button is unavailable.
        }
        return function () {
          try { if (settingsDispose !== null) settingsDispose() } catch (error) {}
          try { selection.leave() } catch (error) {}
          try { if (cardStyle !== null) cardStyle.remove() } catch (error) {}
          for (var i = 0; i < disposals.length; i += 1) {
            try {
              if (typeof disposals[i] === 'function') disposals[i]()
            } catch (error) {}
          }
        }
      }
    }
  }
})

