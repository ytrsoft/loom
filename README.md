# Loom

Loom 是一个用 TypeScript 写的爬虫框架。它在 Crawlee 之上重新设计了整套开发体验：用一行就能写清楚的抽取 DSL 取代繁琐的 `$(el).find().text().trim()`，用约定取代配置，用组合式 API 组织可复用的爬取逻辑，并且把数据自动、带类型地存进任何 SQL 数据库。

开发者从头到尾不需要接触 Crawlee 的原生 API。整个仓库只有 `packages/core/src/runtime/engine.ts` 一个文件导入 Crawlee，ESLint 规则禁止其他任何地方导入它。

```ts
import {$, defineSpider, schema} from 'loom';

const story = schema({
  id: '@id',
  title: '.titleline > a',
  url: '.titleline > a @href',
  points: $('+ tr .score').int().default(0),
  postedAt: $('+ tr .age').attr('title').match(/(\d{9,})$/).date().optional(),
});

export const hackerNews = defineSpider({
  name: 'hacker-news',
  start: 'https://news.ycombinator.com/news',
  schema: story,
  items: 'tr.athing',
  next: '.morelink',
  maxPages: 3,
  store: {unique: 'id'},
  schedule: '0 * * * *',
});
```

上面这个文件就是一个完整的爬虫：它会抓三页、按 `id` 去重写入 SQLite 中的 `hacker_news` 表（列类型由 schema 推断），每小时运行一次，并且在控制台里实时可见。

## 目录

1. [设计原则](#设计原则)
2. [快速开始](#快速开始)
3. [约定](#约定)
4. [抽取 DSL](#抽取-dsl)
5. [定义爬虫](#定义爬虫)
6. [浏览器模式](#浏览器模式)
7. [组合式 API](#组合式-api)
8. [插件与钩子](#插件与钩子)
9. [存储与数据库](#存储与数据库)
10. [运行、调度与增量抓取](#运行调度与增量抓取)
11. [服务器与控制台](#服务器与控制台)
12. [测试](#测试)
13. [场景速查](#场景速查)
14. [架构](#架构)
15. [代码风格](#代码风格)

## 设计原则

**约定优于配置。** 爬虫放在 `src/spiders/` 下即被发现，数据库默认是 `.loom/loom.db`，表名就是爬虫名，列来自 schema，端口默认 3000。不写配置文件也能工作。

**抽取是声明，不是过程。** 一个字段就是一个不可变的值，例如 `$('.price').number()`。字段可以存进常量、在爬虫之间共享、继续追加变换，同时它还携带类型信息，所以 TypeScript 类型和数据库列都直接从抽取代码推导出来。

**默认必填，问题可读。** 字段默认必填。列表中某一行缺数据时只丢弃那一行，并报告 `[3].price: $('.price').number() matched nothing`；整页缺数据时请求会重试。可能缺失的字段用 `.optional()` 或 `.default()` 标明。

**组合而不是继承。** 可复用的逻辑写成普通函数（组合式函数）或插件，不需要继承任何基类。

**同一套 API 覆盖所有场景。** 静态 HTML、浏览器渲染页面、JSON 接口、页面里嵌入的 JSON 和 JSON-LD 都使用同一个 `$()`。如果某个需求框架没有直接覆盖，可以用 `ctx.fetch()`、`ctx.browser.evaluate()`、自定义插件、自定义驱动或原始 Drizzle 实例来实现，仍然不需要接触 Crawlee。

**忘记 await 也不会丢数据。** `save`、`follow`、`enqueue`、`download` 会被自动追踪，处理函数返回后统一等待完成，其中的错误也会被抛出。

## 快速开始

需要 Node.js 20.12 或更高版本，以及 pnpm 9。

```bash
pnpm install
pnpm build                     # 构建所有包（含控制台）
cd examples/hacker-news
pnpm dev                       # 打开 http://localhost:3000
```

在终端里直接运行某个爬虫：

```bash
pnpm loom run hacker-news                 # 带实时进度条
pnpm loom run books --max-requests 50
pnpm loom run quotes --headful            # 浏览器模式下显示浏览器窗口
pnpm loom export hacker-news -f csv -o stories.csv
```

浏览器模式的爬虫需要先安装浏览器：`npx playwright install chromium`。

新建项目：

```bash
pnpm add loom @libsql/client && pnpm add -D @loom/cli
pnpm loom init                 # 生成 loom.config.ts 和第一个爬虫
pnpm loom new product-prices   # 也可以加 --browser 或 --api
```

## 约定

| 项目 | 默认值 | 如何覆盖 |
|---|---|---|
| 爬虫位置 | `src/spiders/**` 中导出的每个 spider | `spidersDir`，或 `spiders: [...]` |
| 数据库 | `sqlite:.loom/loom.db` | `database`，或环境变量 `LOOM_DATABASE_URL` |
| 表名 | 爬虫名转 snake_case（`hacker-news` → `hacker_news`） | `store: {table: 'stories'}` |
| 列名 | 字段名转 snake_case（`postedAt` → `posted_at`） | 自带 Drizzle 表 |
| 列类型 | 由字段推断（`.int()` → 整数列，`.date()` → 时间列） | `computed('json')` 等 |
| 元数据列 | `_id`、`_url`、`_run_id`、`_created_at`、`_updated_at` | 自带 Drizzle 表 |
| 并发 | HTTP 模式 10，浏览器模式 3 | `concurrency` |
| 重试 | 3 次，换新会话 | `retries` |
| 超时 | 60 秒 | `timeout: '30s'` |
| `follow()` 范围 | 只跟随同域名链接 | `sameDomain: false` |
| `@href` / `@src` | 自动转为绝对地址 | 用 `$(sel).attr('href')` 取原值 |
| 同一爬虫 | 同时只运行一个实例 | `start(name, {parallel: true})` |
| 服务器 | `localhost:3000`，带控制台 | `server`，或 `LOOM_PORT`、`LOOM_HOST` |
| 认证 | 无 | `server.token`，或 `LOOM_TOKEN` |

一个典型的项目结构：

```
my-crawlers/
├── loom.config.ts          可选
├── src/
│   ├── spiders/            每个导出的 spider 自动注册
│   ├── composables/        可复用的爬取逻辑（useXxx）
│   ├── plugins/            可复用的钩子组合
│   └── routes.ts           自定义 API（可选）
├── test/                   离线测试
└── .loom/                  运行状态、下载文件、默认数据库
```

## 抽取 DSL

### 简写字符串

在 shape 里直接写字符串是最常用的写法：

| 写法 | 含义 |
|---|---|
| `'h1'` | `<h1>` 的文本，已去除首尾空白并合并连续空白 |
| `'a.more @href'` | `href` 属性，自动转为绝对地址 |
| `'img @src'` | 图片地址，会识别 `data-src` 等懒加载属性和 `srcset` |
| `'@id'` | 当前元素自身的属性（在列表项中很常用） |
| `'meta[name=x] @content'` | 任意属性 |

### `$()` 与类型转换

`$(selector)` 先定位节点，再通过方法生成字段：

```ts
$('.title').text()            // string
$('.price').number()          // "¥1,299.50" → 1299.5，"1.2k" → 1200，"3.2万" → 32000
$('.count').int()             // 截断为整数
$('time').date()              // ISO 日期、时间戳、"3 hours ago"、"3小时前"、"2024年1月2日"
$('.flag').bool()             // true/yes/1/是
$('a').href()                 // 绝对地址
$('img').src()                // 绝对地址，支持懒加载属性
$('.body').html()             // 内部 HTML
$('.badge').exists()          // boolean，不会缺失
$('.item').count()            // number，不会缺失
$('script#data').value()      // 原始值（JSON 中保持原类型）
```

字符串字段可以继续追加变换，每个变换都会返回一个新字段：

```ts
$('.sku').text().match(/SKU-(\d+)/)          // 有捕获组时取第 1 组
$('.sku').text().match(/(?<id>\d+)/, 'id')   // 也可以取命名组
$('.name').text().replace(/\s*\(.*\)/, '')
$('.price').text().strip('¥', '元').number()
$('.tags').text().split(',')                 // string[]
$('.status').text().test(/in stock/i)        // boolean
$('.star').attr('class').match(/star-(\w+)/).lookup({one: 1, two: 2})
$('.x').text().pipe(value => customParse(value), 'json')  // 自定义变换
$('.name').text().lower()
```

### 可选与默认值

```ts
$('.discount').number().optional()   // 缺失时为 null，类型为 number | null
$('.points').int().default(0)        // 缺失或解析失败时为 0
```

### 列表

`.all()` 把字段切换为列表模式，之后的每个变换都逐个元素应用：

```ts
$('.tag').all().text()                       // string[]
$('.gallery img').all().src().unique()       // 去重后的绝对地址
$('.price').all().number().filter(p => p > 0)
$('.crumb').all().text().join(' / ')         // 列表 → 单个字符串
$('.crumb').all().text().first()             // 也有 last()、limit(n)
```

### 嵌套对象与对象列表

```ts
const product = schema({
  name: 'h1',
  seller: {name: '.seller .name', url: '.seller a @href'},   // 同一作用域下的嵌套对象
  specs: $('table.specs tr').list({key: 'th', value: 'td'}), // 对象列表
  variants: $('.variant').list({
    sku: '@data-sku',
    price: $('.price').number(),
  }),
});
```

在 `list()` 中，某个元素缺少必填字段时只丢弃这个元素，同时报告丢弃原因。

### 兄弟行

有些站点的一条记录横跨几个兄弟元素（Hacker News 和很多表格都是这样）。选择器以 `+` 或 `~` 开头时，从当前元素的兄弟节点开始查找：

```ts
$('+ tr .score')       // 下一行中的 .score
$('~ .note')           // 后面所有兄弟中的 .note
```

### JSON 接口

响应是 JSON 时，同一个 `$()` 把选择器当作点路径解析：

```ts
const repo = schema({
  id: $('id').int(),
  name: 'full_name',                       // 简写同样可用
  stars: $('stargazers_count').int(),
  owner: {login: 'owner.login'},
  topics: $('topics').all().text(),
  firstTag: 'tags[0].name',
});

ctx.extractAll('items', repo);             // 遍历数组
ctx.extract($('items[*].id').all().int()); // 通配符
```

### 页面里嵌入的 JSON、JSON-LD 和 meta

```ts
// Next.js / Nuxt 等框架把状态放在 <script> 里
$('script#__NEXT_DATA__').json('props.pageProps.product').object({
  name: 'name',
  price: $('price.amount').number(),
});

// 也能处理 window.__STATE__ = {...}; 这种包裹形式
$('script:contains("__STATE__")').json('user').object({id: $('id').int()});

// 结构化数据往往比可见的页面更干净，也会自动展开 @graph
jsonLd('Product').object({name: 'name', price: $('offers.price').number()});

meta('og:title');      // <meta property="og:title" content="...">
```

### schema 与类型推断

```ts
const product = schema({title: 'h1', price: $('.price').number()});
type Product = Infer<typeof product>;     // {title: string; price: number}

const detailed = product.extend({stock: $('.stock').int()});
const summary = product.pick('title');
const withoutPrice = product.omit('price');
```

`computed()` 用来声明由处理函数自己填写的键。它在页面上什么都不抽取，只用来提供类型和数据库列：

```ts
const book = schema({title: 'h1', coverFile: computed<string>()});
await save({...extract(book), coverFile: await download(url)});
```

### 在爬虫之外使用

`extractFrom` 和 `extractAllFrom` 可以直接处理你已经拿到的任意 HTML 或 JSON：

```ts
import {extractAllFrom, extractFrom} from 'loom';

const title = extractFrom(html, 'h1');
const rows = extractAllFrom(html, 'tr.row', {name: 'td.name', qty: $('td.qty').int()});
```

## 定义爬虫

### 声明式

只写配置、不写处理函数，就能覆盖“列表页 + 分页”“列表页 + 详情页”这两种最常见的场景：

```ts
export const products = defineSpider({
  name: 'products',
  start: 'https://shop.example/category/lamps',
  schema: listItem,                 // 每个列表项抽取的字段
  items: '.product-card',
  detail: {                         // 可选：进入每个列表项的详情页
    link: 'a.title',                // 在列表项内部解析链接
    schema: productDetail,          // 详情页字段，会与列表项合并
  },
  next: 'a[rel=next]',
  maxPages: 20,
  store: {unique: 'sku'},
});
```

保存的数据类型是 `Infer<listItem> & Infer<productDetail>`，`ctx.save()` 和 `loom.items()` 都按这个类型检查。

### 命令式

需要更多控制时，就使用路由。起始 URL 由 `start` 路由（或简写 `parse`）处理，`follow(selector, 'route')` 把请求交给指定路由：

```ts
export const books = defineSpider({
  name: 'books',
  start: 'https://books.toscrape.com/catalogue/category/books_1/index.html',
  schema: book,
  maxPages: 3,
  store: {unique: 'upc'},
  routes: {
    async start({follow, next, page}) {
      await follow('article.product_pod h3 a', 'book', {data: {listPage: page}});
      await next('li.next a');
    },
    async book({extract, download, save, data}) {
      const item = extract(book);
      await save({
        ...item,
        coverFile: await download(item.image),
        listPage: Number(data['listPage']),
      });
    },
  },
});
```

### 上下文 `ctx`

`ctx` 上的所有方法都已绑定，可以直接解构使用。

| 成员 | 说明 |
|---|---|
| `url`、`status`、`headers`、`body` | 最终地址（重定向之后）、状态码、响应头、正文（浏览器模式下是渲染后的 DOM） |
| `route`、`depth`、`page`、`data` | 当前路由、链接深度、分页序号、上一个页面传来的数据 |
| `extract(target)` | 抽取字段、简写、shape 或 schema；缺少必填数据时请求会重试 |
| `extractAll(selector, target)` | 对每个匹配节点抽取；缺数据的项被丢弃并报告 |
| `json<T>()` | 把响应解析为 JSON |
| `save(item \| items)` | 依次经过插件、去重和批量写入 |
| `seen(key)` | 该唯一键之前是否已经入库（用于增量抓取） |
| `follow(selector, route?, options?)` | 跟随页面上的链接；支持 `data`、`limit`、`include`、`exclude`、`sameDomain` 选项 |
| `enqueue(urls \| requests, route?)` | 添加明确的 URL，或带 `method`、`headers`、`body` 的请求 |
| `next(selector?)` | 跟随“下一页”，遵守 `maxPages` 限制 |
| `fetch(url, init?)` | 发起附带请求，复用当前会话、代理和请求头；返回值同样支持 `extract()` |
| `download(url, {dir, name})` | 下载文件到 `.loom/files/<spider>/`，返回文件路径 |
| `browser` | 浏览器操作（仅浏览器模式） |
| `log`、`state` | 日志，以及本次运行内共享的键值状态 |
| `skip(reason)`、`retry(reason)`、`stop(reason)` | 结束当前请求、换新会话后重试、平稳停止整个运行 |

### 起始地址

```ts
start: 'https://a.com'
start: ['https://a.com/1', 'https://a.com/2']
start: {url: 'https://api.x.com/search', method: 'POST', body: {q: 'lamps'}}
start: pages('https://x.com/list?page={page}', 1, 50)
start: sitemap('https://x.com/sitemap.xml', {include: '/products/**', limit: 5000})
start: async function* () { for (const id of await loadIds()) yield `https://x.com/p/${id}`; }
```

### 网络与行为设置

以下设置可以写在单个爬虫上，也可以写在 `loom.config.ts` 的 `defaults` 中对所有爬虫生效：

```ts
{
  concurrency: 5,
  rateLimit: '2/s',              // 也可以写 '30/min'、'1000/h'，或用数字表示每秒请求数
  retries: 3,
  timeout: '45s',
  maxRequests: 10_000,
  maxDepth: 3,
  maxPages: 20,
  headers: {'accept-language': 'zh-CN'},
  userAgent: 'MyBot/1.0 (+https://example.com/bot)',
  cookies: {session: 'abc'},
  proxy: ['http://user:pass@p1:8000', 'http://p2:8000'],  // 按会话轮换
  robots: true,                  // 遵守 robots.txt
  sameDomain: true,
  dedupe: 'always',              // 跨运行去重，下文详述
}
```

## 浏览器模式

设置 `mode: 'browser'` 后，页面由 Chromium（也可以选 Firefox 或 WebKit）渲染。`ctx.extract()` 的用法完全不变。每次交互之后，Loom 会等待页面稳定并刷新快照，所以随后的抽取总能读到最新的 DOM。

```ts
export const feed = defineSpider({
  name: 'feed',
  mode: 'browser',
  start: 'https://app.example/feed',
  schema: post,
  browser: {block: ['image', 'font', 'media'], waitFor: '.post', viewport: {width: 1280, height: 900}},
  async parse({browser, extractAll, save}) {
    await browser.click('#accept-cookies', {optional: true});
    await browser.click('button.load-more', {repeat: 10});   // 反复点击，按钮消失时停止
    await browser.infiniteScroll({items: '.post', max: 500});
    await save(extractAll('.post', post));
  },
});
```

| 操作 | 说明 |
|---|---|
| `goto`、`reload` | 导航 |
| `click(sel, {optional, repeat, waitFor})` | 点击 |
| `fill`、`type`、`press`、`select`、`check`、`hover` | 表单与输入 |
| `scroll('bottom' \| px)`、`infiniteScroll({items, max})` | 滚动 |
| `waitFor(sel \| ms)`、`waitForIdle()` | 等待 |
| `waitForResponse(pattern)`、`responses(pattern)` | 获取页面发出的 XHR/fetch 响应，常常比解析 DOM 更直接 |
| `evaluate(fn, arg)` | 在页面里执行代码 |
| `screenshot()`、`cookies()`、`setCookies()` | 截图与 Cookie |

例如，直接读取页面调用的接口：

```ts
await browser.click('.tab-reviews');
const reviews = await (await browser.waitForResponse('/api/reviews*')).json<Review[]>();
```

## 组合式 API

处理函数运行期间，当前上下文在整条异步调用链上都可以取到。因此可以把逻辑拆成小函数，不必层层传递 `ctx`：

```ts
// src/composables/use_breadcrumbs.ts
export function useBreadcrumbs(selector = '.breadcrumb li'): string[] {
  return useContext().extract($(selector).all().text());
}

// src/composables/use_consent.ts
export async function useDismissConsent(): Promise<void> {
  await useBrowser().click('#onetrust-accept-btn-handler', {optional: true});
}

// 在任意路由里使用
async product({extract, save}) {
  await useDismissConsent();
  await save({...extract(product), category: useBreadcrumbs().at(-2) ?? null});
}
```

可用的组合式函数有 `useContext()`、`useBrowser()`、`useLogger()`、`useRunState()`、`useRequest()`。

## 插件与钩子

插件就是一组带名字的钩子。执行顺序是：配置中的全局插件，然后爬虫的 `use` 列表，最后爬虫自己的 `hooks`。

| 钩子 | 时机与用途 |
|---|---|
| `onRunStart(run)` / `onRunEnd(run)` | 运行开始前 / 结束后，例如准备资源、发送通知 |
| `beforeRequest(request)` | 请求入队前，可以修改请求，或返回 `false` 丢弃它 |
| `afterResponse(ctx)` | 处理函数执行前，例如检测封锁、补充登录 |
| `onItem(item, ctx)` | 每条数据入库前；返回修改后的数据，返回 `null` 则丢弃 |
| `onError(error, request)` | 每次请求失败时 |

```ts
export const tagSource = (source: string) =>
  definePlugin({name: 'tag-source', onItem: item => ({...item, source})});
```

内置插件：

- `detectBlocking({statuses, selectors, text})`：遇到 403、429、503 或验证码页时换会话重试。
- `formLogin({url, fields, submit, loggedIn})`：检测到未登录时自动走表单登录。
- `mapItems(fn)`：入库前转换每条数据。
- `filterItems(fn)`：入库前过滤数据。

## 存储与数据库

### 支持的数据库

Loom 把差异按 SQL 家族划分。三套方言分别负责 DDL、表结构检查和 upsert 语法，查询构建则统一使用 Drizzle。

```ts
database: 'sqlite:./data/loom.db'               // 优先 better-sqlite3，未安装或无法加载时用 @libsql/client
database: 'postgres://user:pass@host/db'        // pg
database: 'mysql://user:pass@host/db'           // mysql2，兼容 MariaDB、TiDB
database: 'libsql://my-db.turso.io'             // Turso / libSQL（需要 authToken）
database: {dialect: 'postgres', db: drizzle(neon(process.env.DATABASE_URL!))}
```

本地 SQLite 文件默认使用 `@libsql/client`：它为各平台提供预编译二进制文件，安装时不需要编译。如果同时装了 `better-sqlite3` 并且能正常加载，Loom 会优先用它（同步驱动，写入更快）。

最后一种写法接受**任何** Drizzle 实例，例如 Neon、Supabase、Vercel Postgres、PGlite、PlanetScale、Cloudflare D1、Bun SQLite。驱动按需加载，项目只需要安装实际用到的那个。如果要用 URL 接入其他驱动，可以用 `registerDriver(/^d1:/, factory)` 注册。

### 自动建表与表结构演进

- 带 schema 的爬虫：字段会建成带类型的列，`store.unique` 会建成唯一索引，写入时自动 upsert。同一批数据中的重复项会先去重。
- 不带 schema 的爬虫：遇到新的键时自动执行 `ALTER TABLE ... ADD COLUMN`，进程重启后会从数据库读回已有的列。
- 自带 Drizzle 表：`store: {table: productsTable}`。这时 Loom 不执行任何 DDL，只写入表里存在的列，表结构交给 drizzle-kit 迁移管理。

### 查询与导出

```ts
const stories = await loom.items(hackerNews);   // 返回带类型的集合

await stories.find({where: {author: 'pg'}, orderBy: '-points', limit: 20});
await stories.find({where: (t, {gt, and, like}) => and(gt(t.points, 100), like(t.title, '%AI%'))});
await stories.page({limit: 50, offset: 100});    // 返回 {items, total}
await stories.count({author: 'pg'});
await stories.exists({id: '42'});
await stories.delete({site: null});
for await (const row of stories.iterate()) { /* 分批读取，不会一次装进内存 */ }
for await (const chunk of stories.export('csv')) process.stdout.write(chunk);

loom.database.orm<BetterSQLite3Database>();      // 原始 Drizzle 实例
stories.drizzleTable;                            // 对应的 Drizzle 表对象
```

## 运行、调度与增量抓取

```ts
const loom = await createLoom();              // 读取约定和配置
const run = loom.start('books');              // 后台运行，返回运行句柄
run.stats;                                    // 实时统计
run.stop();                                   // 平稳停止
const summary = await run.done;

await loom.run('books', {overrides: {maxRequests: 100}, resume: true});
loom.schedule();                              // 启动所有 schedule 定时任务
loom.on('item:saved', e => console.log(e.count));
await loom.history({spider: 'books'});
```

增量抓取有两种方式：

- 精确判断：在入口路由里用 `ctx.seen(id)` 过滤掉已入库的条目，只为新条目入队。示例见 `examples/hacker-news/src/spiders/hn_api.ts`。
- 粗粒度：`dedupe: 'always'` 跳过之前运行中已经成功抓取过的 URL。起始 URL 和 `next()` 翻页的页面始终会重新抓取，因为它们的内容会变化。

断点续爬：`loom run books --resume`（或 `resume: true`）会把请求队列保存在 `.loom/state/<spider>`，下次从中断处继续。

## 服务器与控制台

`loom dev` 和 `loom start` 都会启动下面这些接口。

| 接口 | 说明 |
|---|---|
| `GET /api/spiders` | 爬虫列表，含列、数据量和最近一次运行 |
| `POST /api/spiders/:name/runs` | 开始运行，可选参数 `{maxRequests, headful, resume}` |
| `GET /api/spiders/:name/items` | 分页数据，支持 `limit`、`offset`、`order`、`q`（文本搜索）、`where`（JSON 等值条件） |
| `GET /api/spiders/:name/export?format=csv` | 流式导出，格式可选 csv、json、ndjson |
| `GET /api/runs`、`GET /api/runs/:id`、`POST /api/runs/:id/stop` | 运行记录与控制 |
| `WS /ws` | 实时事件推送 |

WebSocket 连接后，服务器先发送 `{type: 'hello', runs}`，之后推送各种事件：`run:start`、`run:end`、`request:done`、`request:failed`、`item:saved`、`item:dropped`、`stats`、`log`。客户端可以发送 `{type: 'subscribe', events: [...]}` 只订阅需要的事件。处理不过来的客户端会被跳过高频事件，不会拖垮服务器。

添加自定义接口：

```ts
// src/routes.ts
export const topStories = defineRoutes((router, loom) => {
  router.get('/top-stories', async (_req, res) => {
    res.json(await (await loom.items(hackerNews)).find({orderBy: '-points', limit: 10}));
  });
});

// loom.config.ts
export const config = defineConfig({server: {routes: [topStories], token: process.env['LOOM_TOKEN']}});
```

控制台用 React + Vite 构建，由服务器直接托管。它显示每个爬虫的实时“织布带”：每完成一个请求就织进一格，每秒一列，成功、重试和失败用不同颜色区分，吞吐量和异常一眼可见。此外还有统计数字、可搜索排序的数据表、实时日志和运行历史。开发控制台本身时，运行 `pnpm --filter @loom/dashboard dev`，它会把请求代理到 3000 端口。

## 测试

`testRoute()` 用固定的 HTML 或 JSON 运行某个路由，不需要网络、浏览器或数据库。它返回这个路由保存的数据、入队的请求和报告的问题：

```ts
import {testRoute} from 'loom/testing';

const result = await testRoute(books, 'book', {url, html: fixture, data: {listPage: 1}});
assert.equal(result.items[0]?.price, 51.77);
assert.deepEqual(result.issues, []);
```

插件、钩子和组合式函数在测试里同样会执行。需要附带请求的路由可以传入 `{fetch: url => ({url, json: {...}})}` 作为假响应。

## 场景速查

| 我想要…… | 用法 |
|---|---|
| 列表页加翻页 | `items` + `next` + `maxPages` |
| 按页码翻页 | `start: pages('…?page={page}', 1, 50)` |
| 列表页加详情页并合并字段 | 声明式 `detail: {link, schema}`，或命令式 `follow(sel, 'detail', {data})` |
| 整站递归抓取 | `follow('a', 'start', {include: '/docs/**'})` 配合 `maxDepth` |
| 从 sitemap 开始 | `start: sitemap(url, {include})` |
| 抓 JSON 接口 | 用 `$()` 写点路径，`json<T>()`，`enqueue()` |
| POST 请求或 GraphQL | `enqueue({url, method: 'POST', body: {query}})` |
| 页面里嵌入的 JSON | `$('script#x').json('path')` |
| JSON-LD 结构化数据 | `jsonLd('Product').object({...})` |
| 一条记录跨多行的表格 | `$('+ tr .cell')` |
| 依赖 JavaScript 渲染的网站 | `mode: 'browser'` |
| 无限滚动或“加载更多” | `browser.infiniteScroll()` / `click(sel, {repeat})` |
| 直接读取页面调用的接口 | `browser.waitForResponse()` / `responses()` |
| 需要登录 | `formLogin()` 插件，或用 `cookies` / `headers` 带上凭证 |
| 遇到封锁或验证码 | `detectBlocking()` + `proxy: [...]` + `ctx.retry()` |
| 控制抓取频率 | `rateLimit: '1/s'` + `concurrency` |
| 增量抓取 | `ctx.seen()` / `dedupe: 'always'` |
| 定时运行 | `schedule: '*/30 * * * *'` + `loom start` |
| 中断后继续 | `--resume` |
| 下载图片或 PDF | `ctx.download(url, {dir})` |
| 入库前清洗或过滤 | `mapItems()` / `filterItems()` / `onItem` |
| 只推送、不入库 | `store: false` 并监听 `item:saved` 事件 |
| 用 PostgreSQL 或 MySQL | `LOOM_DATABASE_URL=postgres://…` |
| 使用自己的表结构 | `store: {table: drizzleTable}` |
| 在脚本里调用 | `createLoom()` + `loom.run()` + `loom.items()` |
| 写单元测试 | `testRoute()` / `extractFrom()` |
| 添加业务接口 | `defineRoutes()` |

## 架构

```
            ┌────────────┐
            │ @loom/cli  │   loom dev | start | run | list | new | export | init
            └─────┬──────┘
                  │
     ┌────────────┴───────────┐
     │      @loom/server      │   Express REST + WebSocket，托管控制台
     └─────┬─────────────┬────┘
           │             │
           │      ┌──────┴───────────┐
           │      │ @loom/dashboard  │   React + Vite
           │      └──────────────────┘
     ┌─────┴──────┐
     │    loom    │   createLoom、defineConfig、运行历史、调度
     └──┬──────┬──┘
        │      │
┌───────┴──┐ ┌─┴─────────────┐
│@loom/core│ │ @loom/storage │   Drizzle：SQLite、PostgreSQL、MySQL、任意驱动
└────┬─────┘ └───────────────┘
     │   抽取 DSL、spider、ctx、组合式 API、插件、事件
     │
     └── runtime/engine.ts ── 唯一导入 Crawlee 的文件
```

`@loom/storage` 不依赖爬虫，可以单独用来存储任何对象。`@loom/core` 也不依赖数据库，它通过 `ItemSink` 接口写数据，所以可以替换成写入 Kafka、写文件或任何其他目标的实现。

## 代码风格

本仓库遵循 Google TypeScript 风格指南，用 [gts](https://github.com/google/gts) 检查和格式化（`pnpm lint`、`pnpm fix`）：

- 文件名使用 snake_case，测试文件以 `_test.ts` 结尾。
- 只用具名导出。唯一的例外是 Vite 配置，因为工具要求默认导出。
- 对象类型用 `interface`，不使用 `any`（内部用结构化接口描述 Drizzle 的通用 API）。
- 导出的符号都有 JSDoc，每个文件开头有 `@fileoverview`。
- 类成员使用 `private readonly`，不使用 `#private`。

`$` 作为标识符是有意保留的约定，方便熟悉 jQuery/cheerio 的开发者。若团队希望严格避免，可以改用等价的别名 `select()`。

## 当前状态

这份代码在没有网络的环境中完成，所以还没有安装依赖、构建或运行过。各个包都用 TypeScript 做了类型检查，但第三方库（Crawlee、Drizzle、Express、React 等）使用的是手写的简化类型声明，而不是真实的类型。因此第一次在真实环境里执行 `pnpm install && pnpm build && pnpm test` 时，可能需要对少量第三方 API 的签名做调整。重点要核对：Crawlee 的 `crawler.stop()` 和 `respectRobotsTxtFile`（需要 3.13 或更高版本）、Drizzle 0.38 的列构建器签名，以及 Express 5 的类型。
