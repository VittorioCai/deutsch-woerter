<div align="center">

# Deutsch Wörter

**导入你自己的德语词库，离线可用，什么都不上传。**

[**▶ 打开应用**](https://vittoriocai.github.io/deutsch-woerter/) · 不用注册，不用安装，不用上传

[![MIT licence](https://img.shields.io/badge/licence-MIT-2b49d6)](LICENSE)
[![Deploy](https://github.com/VittorioCai/deutsch-woerter/actions/workflows/deploy.yml/badge.svg)](https://github.com/VittorioCai/deutsch-woerter/actions/workflows/deploy.yml)
![PWA · 离线](https://img.shields.io/badge/PWA-%E7%A6%BB%E7%BA%BF%E5%8F%AF%E7%94%A8-0a8f55)
![无后端](https://img.shields.io/badge/%E5%90%8E%E7%AB%AF-%E6%97%A0-697386)

[English](README.md)

</div>

---

<table>
<tr>
<td width="50%"><img src="docs/screenshots/01-start.png" alt="开始界面"><br><sub><b>打开就能用。</b>一键载入内置的 284 词示例词库，或者直接拖入自己的 CSV。</sub></td>
<td width="50%"><img src="docs/screenshots/02-home.png" alt="首页"><br><sub><b>每天只需要点一个按钮。</b>跨章节的所有到期复习，加上几个新词。</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/08-compound.png" alt="巧记"><br><sub><b>告诉你为什么。</b>性别看词尾、复合词拆开看、复数自动推 —— 当场算出来，对任何词库都生效。</sub></td>
<td width="50%"><img src="docs/screenshots/05-drill.png" alt="专项训练"><br><sub><b>练拼写查不出来的东西：</b>der/die/das、复数形式、动词变位、haben/sein、介词 + 格、例句填空、听写。</sub></td>
</tr>
</table>

## 为什么会有这个东西

背单词的 App 都想要你注册、订阅，把学习数据放在它们的服务器上 —— 而且没有一个装着**你的**词库，
你课上真正在用的那一份。这个应用把它反过来：**词由你提供，数据留在你的设备上，代码你自己能读。**

这也是它不自带任何教材词汇的原因 —— 把一个 App 发出去，并不等于有权把别人的词汇表一起发出去。
它自带的是一份为这个项目单独写的 284 词入门词库，让你打开就能用。

## 它能做什么

- **今日任务 —— 每天那一个按钮。** 所有章节里到期该复习的词，加上几个新词，一次做完。
  间隔重复本来就该替你决定今天学什么；章节选择器留着，但不在日常路径上。
  已经「掌握」的词也会按间隔回来抽查一次 —— 三次答对不等于一年后还记得。
  新词**从你学到的那一章开始往后给**，学完一章自动往下走；前面全学完了才回头捡跳过的。
- **学新词 —— 分层推进。** 认识这个词 → 看德语认意思 → 看意思认德语 → 拼写，中间穿插间隔复习。
  拼写可以关掉，只做快速过一遍；这些词照样推进复习间隔，但**进不了「已掌握」** ——
  在这个应用里「已掌握」的意思是你写得出来，不只是认得出来。
- **单词检测 —— 检测模式。** 错词优先，英德双向，拼写检查，冠词可松可严。
  **和背词共用一套进度**：这里答对了，那边的复习就往后推；答错了就退回复习队列，
  反馈里会直接写出来。反过来，勾了「优先抽错词」时，背词今天到期的词会排在最前面。
- **专项训练 · 七种。** der/die/das、由词形记号推导的复数形式、
  **动词变位**（`nehmen → er nimmt`，可分动词前缀甩到句末，B1 词条还考过去式）、
  完成时用 haben 还是 sein、**介词 + 格**（`warten auf +四格`，B1 考、拼写检查永远测不到）、
  把词从它自己的例句里挖空填回去、听写。这些正是拼写检查会悄悄放过的部分 ——
  题目全部由你词库里已有的词形栏、释义栏和例句现算出来。
- **查词 + 章节地图。** 一个面板，空着是 36 章的进度地图，一打字就变成搜索：
  德语、中文、英文、词形栏都查，变音字母不打也能找到（`tur` / `tuer` 都能找到 `die Tür`）。
  地图上点一章可以「从这章开始」或者「这一章我都会了」。
- **应用内改词条。** 释义、词形、例句都能当场改，改动按词条编号存成一层补丁，
  **重新导入词库也不会丢**，也会跟着备份走。德语词本身改不了 —— 那会重置这个词的进度。
- **真人发音。** 有录音的词优先用 [Wikimedia Commons](https://commons.wikimedia.org/)
  的母语者录音（常用词命中率约九成），听过一次就缓存；没有录音的用设备上最好的德语语音 ——
  系统会给语音排序，不会再默认挑那个最机械的 compact 版。
- **会解释的错题本。** 拼错的词按**错因**分组 —— 变音漏写、冠词错、拼写接近 —— 而不是列一堆词让你自己看。
- **巧记：不只给答案，还告诉你为什么。** 德语的性别大量可以从词尾推，复合词跟最后一节走，
  动词前缀自带含义 —— 所以这些解析是从单词**当场算出来**的，不是预先写好存在旁边的。
  `die Wohnung` 会告诉你「-ung 结尾是阴性、复数 -en、还有这四个同类词」；
  `das Kinderzimmer` 会被拆成 Kind +er+ Zimmer，性别从 `das Zimmer` 读出来。
  不占体积、离线可用，而且对**你导入的任何词库**都生效，不是只对别人写好的那些词生效。
- **可安装、可离线。** 添加到主屏幕，飞机上也能背。

## 导入你自己的词库

第一屏就能导入，之后随时点「更换词库」。支持两种格式。

**表格导出的 CSV 或 TSV。** 第一行是表头。只有 `de` 是必填，`zh` / `en` 至少要有一个：

```csv
de,zh,en,level,chapter,grammar,example
das Haus,房子,house,A1,1,Plural: die Häuser,Das Haus ist sehr alt.
die Tür,门,door,A1,1,Plural: die Türen,
```

| 列名 | 含义 |
| --- | --- |
| `de` | 德语单词，名词请带冠词 —— **必填** |
| `zh` | 中文释义，作为主释义显示 |
| `en` | 英文释义，用于检测模式，也在没有中文时兜底 |
| `level` | 任意标签（`A1`、`B2`、`职场`…），不写默认 `A1` |
| `chapter` | 任意标签，不写默认 `1` |
| `grammar` | 复数，如 `Plural: die Häuser`，或紧凑写法 `-en` / `"-e`（`"` 表示变音） |
| `example` | 跟单词一起显示的例句 |

表头用德语、英语或中文都认（`Deutsch`、`Kapitel`、`中文`、`释义`…）。

**JSON**，也就是「导出词库」写出来的样子：

```json
{"name":"我的词库","cards":[{"de":"das Haus","zh":"房子","level":"A1","chapter":"1"}]}
```

[`src/starter-deck.json`](src/starter-deck.json) 就是一份完整的示例。

读不懂的行会在导入前列给你看，不会悄悄丢掉。请保持原有行序：同一章里重复出现的同一个词靠位置区分。

## 你的数据

学习进度、拼写错题本和已掌握档案存在 `localStorage`，词库存在 IndexedDB。什么都不会发出去 ——
这也意味着没有人替你备份：

- **备份**（首页的 🛟）按设备能给什么就给什么：电脑版 Chrome / Edge 可以**选一个文件夹自动备份**，
  每次打开应用写一次（选 iCloud / 云端硬盘的文件夹就等于同步到云上，不需要服务器也不需要账号）；
  手机上用系统分享菜单把备份发到「文件」或云盘；其他情况照旧下载 JSON。
  提醒是按**上次备份之后你又学了多少**来触发的，不只是按天数。
  自动备份永远写两个文件，上一份会留着 —— 覆盖唯一一份副本正是备份可能毁掉它要保护的东西的时刻。
- **导入学习记录** 默认是**合并**（同一个词保留较新的那条），不是替换 ——
  从另一台设备恢复备份不会把这台的记录抹掉。
- **导出词库** 把词库写回文件。存在手机也能打开的地方，换设备时还要用。

进度是按 `level|chapter|de` 的哈希来存的，不是按行号 ——
所以增删词条不会动到你已经学过的任何东西，同一个词出现在两个词库里时，换库也能接着用原来的进度。
这个哈希在浏览器里和 `tests/data.test.ts` 里算法完全一致，预期值以字面量钉在测试里：
**哪天这个测试需要改，就说明有人的学习历史刚被作废了。**

## 本地开发

```sh
npm ci
npx playwright install chromium   # Linux 上加 --with-deps
npm run dev                       # 先构建，然后在 127.0.0.1:4321 提供 dist/
npm run verify                    # tsc + vitest + build + playwright，CI 跑的就是这个
npm run screenshots               # 重新生成上面那些截图
```

端到端测试自带一份很小的、我们自己编的词库（[`tests/fixtures/deck.json`](tests/fixtures/deck.json)），
并且是走应用自己的解析器导入的 —— 导入一坏，整个测试套件就红。测试不碰网络：
Wikimedia 是打桩的，因为一个"在不同机器上悄悄测了不同东西"的测试，比没有测试更糟。

## 代码结构

`scripts/build.mjs` 把 `src/` 里的东西变成页面真正加载的文件，输出到 `dist/`。
`npm run dev`、`npm test`、`npm run build` 都会跑它；`dist/` 从不提交。

| 改这里 | 生成到 `dist/` |
| --- | --- |
| `src/index.html`、`learn.css`、`icon.svg`、`app.webmanifest`、`starter-deck.json` | 原样复制 |
| `src/learn.core.js`、`insight.js`、`wrongbook-addon.js`、`mastered-addon.js`、`drills-addon.js`、`browse-addon.js`、`backup-addon.js`、`edit-addon.js`、`link-addon.js`、`md5.js` | `learn.js` |
| `src/store.js` | `store.js` |
| `src/deck.js` | `deck.js` |
| `src/sw.source.js` | `sw.js` |

`src/store.js` 独占所有对 `localStorage` 的读写。写入是批量的，所以任何需要读回自己状态的代码
都必须在内存里保留一份并合并进去 —— 在一个 flush 窗口内重新读存储会拿到过期值，
然后悄悄把待写入的改动覆盖掉。

`src/insight.js` 是巧记的规则表。只有几乎无例外的规则才会被当作事实说出来，
那些仅仅是"恰好以这几个字母结尾"的词逐个列在例外里；没有把握时它什么都不说 ——
编一个解释比空面板更糟。它也永远不会和词库矛盾：规则算出来的性别跟卡片上的冠词不一致时就闭嘴，
这一条有测试守着。

`src/deck.js` 负责词库：解析、卡片 id、IndexedDB。SHA-256 是手写的，没有用 `crypto.subtle` ——
后者在非安全上下文里根本不存在，而且是异步的；这串数字是你的进度找到对应单词的唯一依据，
"到哪都算出同一个结果"比原生速度重要得多。

Service Worker 的缓存名由它缓存的内容推导，所以一次部署不可能把老访客永久钉在旧的 JavaScript 上。

## 许可

[MIT](LICENSE) —— 代码和示例词库都是。你导入的词库是你自己的，跟这个仓库无关。
