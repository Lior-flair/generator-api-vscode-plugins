# Releases

## [Unreleased]

### 新增功能

#### Mock 数据自动生成

新增命令 `generator-ts-api.generateMock`，基于 API 文档的 Schema 和 `example` 字段，一键生成本地 Mock 脚本或 JSON 数据，支持三种输出格式：

| 格式 | 说明 | 输出文件 |
|---|---|---|
| `json`（默认） | 纯 JSON 文件，键为 `"METHOD /path"`，值为响应体 Mock 数据 | `mock-data.json` |
| `msw` | MSW (Mock Service Worker) handlers 文件（TypeScript），可直接用于浏览器端或 Vitest | `handlers.ts` |
| `json-server` | 生成 `db.json` + `routes.json` + `README.md`，配合 `json-server` 启动本地 Mock 服务 | 目录 |

##### Mock 值生成优先级

每个字段的 Mock 值按如下优先级决定，优先使用文档中已有的示例值：

1. `schema.example`
2. `schema.examples[*].value`（OpenAPI 3.1 格式）
3. `schema.default`
4. 按 `type` + `format` + 字段语义自动合成

##### 按 format 的合成规则（未提供 example 时）

| format | 合成值示例 |
|---|---|
| `date-time` | `"2024-01-15T08:30:00Z"` |
| `date` | `"2024-01-15"` |
| `email` | `"example@example.com"` |
| `uuid` | `"550e8400-e29b-41d4-a716-446655440000"` |
| `uri` / `url` | `"https://example.com"` |
| `password` | `"********"` |
| `ipv4` | `"192.168.1.1"` |

##### 字段名语义推断（无 format 时的后备策略）

对于 `string` 类型但无 `format` 的字段，会通过字段名（`title` / `description`）进行语义推断：

| 关键词 | 合成值 |
|---|---|
| 含 `email` | `"example@example.com"` |
| 含 `phone` / `mobile` / `tel` | `"+8613800138000"` |
| 含 `url` / `link` | `"https://example.com"` |
| 含 `name` | `"示例名称"` |
| 含 `token` | JWT 示例字符串 |
| 含 `address` | `"中国上海市浦东新区"` |

##### 新增配置项

| 配置键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `mock.outputFormat` | enum | `json` | 输出格式：`json` / `msw` / `json-server` |
| `mock.baseUrl` | string | `""` | MSW / json-server 模式的 API 基础路径前缀（如 `/api`） |
| `mock.arrayItemCount` | number | `2` | 数组字段每次生成的示例条目数（1–20） |

##### MSW handlers 输出示例

```typescript
import { http, HttpResponse } from 'msw'

const BASE_URL = '/api'

export const handlers = [
  // 获取用户列表
  http.get(`${BASE_URL}/user/list`, () => {
    return HttpResponse.json(
      { list: [{ id: "1", name: "示例名称" }], total: 1 },
      { status: 200 }
    )
  }),
]
```

##### 使用步骤

1. 打开命令面板，执行 `生成Mock数据`
2. 选择 API 文档来源（URL / 本地文件 / 当前配置）
3. 选择输出文件或目录
4. 生成完成后可点击 **打开文件** 直接预览

---

---

## [0.1.0] - 2026-02-28

### 新增功能

#### HTTP 客户端三档配置

新增 `generator-ts-api.httpClient` 配置项，支持四种生成模式：

| 模式 | 说明 | 生成风格 |
|---|---|---|
| `axios-wrapper`（默认） | 保持原有封装风格，通过 `getConfigs + request` 包装器调用 | `new Promise` + `request(configs, resolve, reject)` |
| `axios` | axios 直调，方法改为 `async/await` | `return axios.get(url, { params })` |
| `fetch` | 原生 fetch，无需任何 import | `return fetch(url, {...}).then(r => r.json())` |
| `custom` | 完全自定义，通过模板文件或内联字符串渲染方法体 | 由用户模板决定 |

#### 可配置 request 导入路径

新增 `generator-ts-api.requestImportPath` 配置项，各模式默认值：

- `axios-wrapper`：`@/utils/request`
- `axios`：`axios`
- `fetch`：无 import
- `custom`：留空则不生成 import

#### 自定义模板支持

新增两个配置项支持完全自定义方法体：

- `generator-ts-api.customTemplate.templateFile`：指向外部模板文件路径（`.txt` 等），优先级高于内联字符串
- `generator-ts-api.customTemplate.templateString`：在 `settings.json` 中直接填写内联模板字符串

模板占位符：

| 占位符 | 替换内容 |
|---|---|
| `{{method}}` | HTTP 方法（小写），如 `get` |
| `{{METHOD}}` | HTTP 方法（大写），如 `GET` |
| `{{url}}` | 路径模板字符串，如 `/api/user/${params.id}` |
| `{{params}}` | 固定字面量 `params` |
| `{{body}}` | 请求体引用，如 `params["body"]` 或 `params` |
| `{{returnType}}` | 推断的 TypeScript 返回类型 |
| `{{methodName}}` | 生成的方法名 |
| `{{contentType}}` | 请求 Content-Type |

**示例（自定义 request 封装调用）：**

```json
"generator-ts-api.customTemplate.templateString": "return myRequest<{{returnType}}>({ method: '{{METHOD}}', url: `{{url}}`, data: {{body}}, params: {{params}} })"
```

#### 输出拆分策略（`outputSplit`）

新增 `generator-ts-api.outputSplit` 配置项，支持两种输出模式：

| 值 | 说明 |
|---|---|
| `single`（默认） | 所有类型 + Controller 生成到单一文件 |
| `byTag` | 按 OpenAPI Tag 拆分，每个模块一个文件，并自动生成 `index.ts` 统一导出 |

`byTag` 模式生成的目录结构示例：

```
📁 选定目录 /
├── definitions/                         ← typesDirName 设为 "definitions"
│   └── index.ts
├── services/                            ← controllersDirName 设为 "services"
│   ├── account-service.ts               ← controllerFileNameCasing 为 kebab-case
│   ├── user-order-service.ts
│   └── index.ts                         ← 包含 export * from "./user-order-service"
└── index.ts                             ← export 各子文件夹
```

#### 命名规范（`naming`）

新增四个命名配置项，仅在 `byTag` 模式下生效：

| 配置键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `naming.typesDirName` | string | `types` | 类型定义文件夹名称 |
| `naming.controllersDirName` | string | `modules` | 控制器文件夹名称 |
| `naming.controllerFileNameCasing` | enum | `default` | 控制器文件名命名风格 |
| `naming.controllerClassNameSuffix` | string | `""` | 类名及文件名后缀 |

`controllerFileNameCasing` 可选值：

- `default`：保持 Tag 原始名称（仅过滤特殊字符）
- `PascalCase`：大驼峰，如 `UserController.ts`
- `camelCase`：小驼峰，如 `userController.ts`
- `kebab-case`：连字符，如 `user-controller.ts`

`controllerClassNameSuffix` 示例：填 `Controller` 则生成 `UserController`，留空则为 `User`。

#### 拦截器注入样板文件

新增 `generator-ts-api.generateRequestScaffold` 配置项（默认 `false`）。

启用后，生成 API 代码时会在输出目录同级写入 `request.ts` 样板文件，内容因模式而异：

- **`axios`**：创建 axios 实例 + 请求/响应拦截器占位注释 (`// TODO: Add request interceptor here`)
- **`axios-wrapper`**：完整的 `getConfigs` + `fetch` 函数骨架 + 拦截器占位注释
- **`fetch`**：基于 `fetchRequest` 封装函数 + `requestInterceptor` / `responseInterceptor` 占位函数
- **`custom`**：跳过生成

> **注意**：已存在 `request.ts` 时不覆盖，保护用户已有的拦截逻辑。

---

### 配置项速查

```jsonc
{
  // 输出拆分策略
  "generator-ts-api.outputSplit": "single", // "single" | "byTag"

  // byTag 模式命名规范
  "generator-ts-api.naming.typesDirName": "types",
  "generator-ts-api.naming.controllersDirName": "modules",
  "generator-ts-api.naming.controllerFileNameCasing": "default", // "PascalCase" | "camelCase" | "kebab-case"
  "generator-ts-api.naming.controllerClassNameSuffix": "",

  // HTTP 客户端模式
  "generator-ts-api.httpClient": "axios-wrapper", // "axios" | "fetch" | "custom"

  // request import 路径（留空时按模式自动填充默认值）
  "generator-ts-api.requestImportPath": "",

  // 是否生成 request.ts 拦截器样板（不覆盖已有文件）
  "generator-ts-api.generateRequestScaffold": false,

  // 生成结果兼容目标版本：latest | 0.0.x
  "generator-ts-api.compatibilityVersion": "latest",

  // date-time 映射目标：string | Date
  "generator-ts-api.typeMapping.dateTimeTarget": "string",

  // 自定义 format -> TS 类型映射（会覆盖默认映射）
  "generator-ts-api.typeMapping.formatMap": {
    "int64": "string",
    "binary": "Blob"
  },

  // 自定义模板文件路径（custom 模式，优先于 templateString）
  "generator-ts-api.customTemplate.templateFile": "",

  // 自定义内联模板字符串（custom 模式）
  "generator-ts-api.customTemplate.templateString": ""
}
```

---

### 技术变更

- `generatorCommon.ts` 新增 `HttpClientMode` 类型、`HttpClientConfig` 接口、`DEFAULT_HTTP_CLIENT_CONFIG` 常量
- `generatorCommon.ts` 新增格式映射与兼容策略：默认 `int64 -> string`、`date-time -> string`、`binary -> Blob`，支持 `formatMap` 覆盖与 `0.0.x` 回退兼容
- `generatorCommon.ts` 新增 `buildImportSnippet(cfg)` — 生成文件顶部 import 代码段
- `generatorCommon.ts` 新增 `buildMethodBody(cfg, ...)` — 生成 API 方法体
- `generatorCommon.ts` 新增 `generateRequestScaffoldFile(outputDir, cfg, ext)` — 写入 request.ts 样板
- `generatorV3.ts` / `generatorV2.ts`：`generate()` 新增可选第 7 参数 `httpClientConfig`；所有硬编码 import 行改为 `buildImportSnippet()` 动态生成；非 `axios-wrapper` 模式方法签名改为 `async`
- `extension.ts` 新增 `buildHttpClientConfig()` / `maybeGenerateScaffold()` 辅助函数，三个命令均已对接新配置

---

## 历史版本

### 初始功能（0.0.x）

- 从 URL 或本地文件解析 OpenAPI 3.x / Swagger 2.x 文档
- 生成 TypeScript / JavaScript API 代码，支持 `ts` / `js` 输出类型
- URL 历史记录（最多保留 10 条），支持快速选择历史 URL 重新生成
- 支持 Basic Auth 重试（HTTP 401 时弹出凭据输入框）
- 生成过程中状态栏显示 loading 动画
