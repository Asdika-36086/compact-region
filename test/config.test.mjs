// 配置与语言包目录的行为测试。全程在临时目录里跑，不碰真实的 DSH 主目录。
import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'compact-region-home-'))
process.env.DSH_HOME = home

const { readConfig, writeConfig, listLanguagePacks, resolvePack } = await import('../lib/index.js')

const langs = join(home, 'compact-region', 'langs')

try {
  // 没有配置文件时：给出默认值，并且说清楚来源是默认而不是当前值。
  {
    const config = await readConfig()
    assert.equal(config.source, 'default')
    assert.equal(config.value.language, 'en')
    assert.equal(config.problem, undefined)
    console.log('ok   没有配置文件时回落到默认值')
  }

  // 写入后：两个文件都在，default 保存默认值，current 保存当前值。
  {
    await writeConfig({ language: '中文' })
    const config = await readConfig()
    assert.equal(config.source, 'current')
    assert.equal(config.value.language, '中文')

    const fallback = JSON.parse(await readFile(join(home, 'compact-region', 'config.default.json'), 'utf8'))
    assert.equal(fallback.language, 'en')

    const current = JSON.parse(await readFile(join(home, 'compact-region', 'config.json'), 'utf8'))
    assert.equal(current.language, '中文')
    console.log('ok   写入同时落默认文件与当前文件')
  }

  // 当前文件被写坏：回落默认值，并带上原因。
  {
    await writeFile(join(home, 'compact-region', 'config.json'), '{ 这不是 JSON', 'utf8')
    const config = await readConfig()
    assert.equal(config.source, 'default')
    assert.equal(config.value.language, 'en')
    assert.equal(typeof config.problem, 'string')
    console.log('ok   当前配置损坏时回退默认值并报告原因')
  }

  // 语言包目录：能解析的排在前面，坏文件沉底并带上 problem。
  {
    await mkdir(langs, { recursive: true })
    await writeFile(join(langs, 'English.json'), '{"schema":1}', 'utf8')
    await writeFile(join(langs, '中文.json'), '{"schema":1}', 'utf8')
    await writeFile(join(langs, '坏掉的.json'), '{ 坏掉', 'utf8')
    await writeFile(join(langs, '忽略我.txt'), 'not json', 'utf8')

    const packs = await listLanguagePacks()
    const ids = packs.packs.map((pack) => pack.id)
    // 内置的 en / zh 一定在，用户目录里的三个也在。
    for (const id of ['en', 'zh', 'English', '中文', '坏掉的']) assert.ok(ids.includes(id), `缺少 ${id}`)
    assert.equal(ids.includes('忽略我'), false)
    // 能用的在前，坏的沉底；好文件之间按文件名排，不限定具体次序。
    assert.equal(packs.packs[ids.length - 1].id, '坏掉的')
    assert.equal(typeof packs.packs[ids.length - 1].problem, 'string')
    assert.equal(packs.packs[0].problem, undefined)
    // 用户目录里的同名文件覆盖内置的。
    const overridden = packs.packs.find((pack) => pack.id === '中文')
    assert.equal(overridden.source, 'user')
    assert.equal(packs.packs.find((pack) => pack.id === 'en').source, 'builtin')
    console.log('ok   语言包扫描：内置与用户目录合并，坏文件沉底，非 json 被忽略')
  }

  // 只写了一半语言的包：缺的字段从内置英文补上，不是整包作废。
  {
    await writeFile(join(langs, '半成品.json'), '{"schema":1,"prompt":{"intro":"只用我自己的开场白"}}', 'utf8')
    const pack = await resolvePack('半成品')
    assert.equal(pack.prompt.intro, '只用我自己的开场白')
    assert.equal(pack.prompt.heading, '## Summary of this stretch')
    assert.equal(pack.ui.compress, 'Compress')
    console.log('ok   半成品语言包：自己写的覆盖英文，其余照旧')
  }
} finally {
  delete process.env.DSH_HOME
  await rm(home, { recursive: true, force: true })
}

// 面板文案的两种语言必须逐条对齐：漏一条翻译，界面语言切过去就会露出键名。
{
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const counts = new Map()
  for (const match of client.matchAll(/'(card|error)\.[a-zA-Z0-9]+':/g)) {
    const key = match[0].slice(1, -2)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  assert.ok(counts.size >= 10, '应当认得出面板文案的键')
  const missing = [...counts.entries()].filter(([, count]) => count !== 2).map(([key]) => key)
  assert.deepEqual(missing, [], `这些键没有同时出现在中英两份里：${missing.join(', ')}`)
  console.log(`ok   面板文案中英各一份，共 ${counts.size} 条`)
}

// 随包发布的两份语言包必须键对齐；代码里的英文兜底也要跟 en.json 一模一样，
// 否则第一帧和加载完之后会显示两套不同的英文。
{
  const en = JSON.parse(await readFile(new URL('../lib/langs/en.json', import.meta.url), 'utf8'))
  const zh = JSON.parse(await readFile(new URL('../lib/langs/zh.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(zh.ui).sort(), Object.keys(en.ui).sort())
  assert.deepEqual(Object.keys(zh.prompt).sort(), Object.keys(en.prompt).sort())
  assert.equal(zh.prompt.requirements.length, en.prompt.requirements.length)

  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const marker = 'var FALLBACK_UI = {'
  const start = client.indexOf(marker)
  assert.ok(start >= 0, '找不到英文兜底表')
  let depth = 0
  let end = -1
  for (let i = start + marker.length - 1; i < client.length; i += 1) {
    if (client[i] === '{') depth += 1
    else if (client[i] === '}') {
      depth -= 1
      if (depth === 0) { end = i + 1; break }
    }
  }
  assert.ok(end > 0, '兜底表没有闭合')
  const fallback = eval('(' + client.slice(start + marker.length - 1, end) + ')')
  // 客户端用到的每一条都要和 en.json 对上；en.json 里只给宿主用的几条可以多出来。
  for (const [key, value] of Object.entries(fallback)) assert.equal(en.ui[key], value, `兜底表里的 ${key} 和 en.json 不一致`)
  const hostOnly = Object.keys(en.ui).filter((key) => !(key in fallback)).sort()
  assert.deepEqual(hostOnly, ['errEmptyHistory', 'errNoModel', 'errStaleRange'])
  console.log('ok   内置语言包键对齐，代码里的英文兜底与 en.json 一致')
}
