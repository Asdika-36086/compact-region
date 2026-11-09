// 配置与语言包目录的行为测试。全程在临时目录里跑，不碰真实的 DSH 主目录。
import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'compact-region-home-'))
process.env.DSH_HOME = home

const { readConfig, writeConfig, listLanguagePacks } = await import('../lib/index.js')

const langs = join(home, 'compact-region', 'langs')

try {
  // 没有配置文件时：给出默认值，并且说清楚来源是默认而不是当前值。
  {
    const config = await readConfig()
    assert.equal(config.source, 'default')
    assert.equal(config.value.language, 'English')
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
    assert.equal(fallback.language, 'English')

    const current = JSON.parse(await readFile(join(home, 'compact-region', 'config.json'), 'utf8'))
    assert.equal(current.language, '中文')
    console.log('ok   写入同时落默认文件与当前文件')
  }

  // 当前文件被写坏：回落默认值，并带上原因。
  {
    await writeFile(join(home, 'compact-region', 'config.json'), '{ 这不是 JSON', 'utf8')
    const config = await readConfig()
    assert.equal(config.source, 'default')
    assert.equal(config.value.language, 'English')
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
    assert.equal(packs.packs.length, 3)
    assert.equal(packs.packs.some((pack) => pack.id === '忽略我'), false)
    // 能用的在前，坏的沉底；好文件之间按文件名排，不限定具体次序。
    assert.deepEqual(packs.packs.slice(0, 2).map((pack) => pack.id).sort(), ['English', '中文'].sort())
    assert.equal(packs.packs[2].id, '坏掉的')
    assert.equal(typeof packs.packs[2].problem, 'string')
    assert.equal(packs.packs[0].problem, undefined)
    console.log('ok   语言包扫描：好文件在前，坏文件沉底，非 json 被忽略')
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
