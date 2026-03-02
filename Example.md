# Example

本文件汇总 `generator-ts-api` 的常见配置组合与典型场景，便于直接复制到 VS Code `settings.json` 使用。

---

## 1) 最小可用（保持默认）

适合：快速上手，不改动旧流程。

```jsonc
{
  "generator-ts-api.apiDocsUrl": "http://localhost:8080/v3/api-docs",
  "generator-ts-api.outputType": "ts",
  "generator-ts-api.outputSplit": "single",

  "generator-ts-api.httpClient": "axios-wrapper",
  "generator-ts-api.requestImportPath": "",

  "generator-ts-api.compatibilityVersion": "latest",
  "generator-ts-api.typeMapping.dateTimeTarget": "string",
  "generator-ts-api.typeMapping.formatMap": {}
}
```

默认映射（latest）：
- `int64 -> string`
- `date-time -> string`
- `binary -> Blob`

---

## 2) 兼容旧版（0.0.x）

适合：历史项目依赖旧生成类型，不希望一次升级引入大量类型变更。

```jsonc
{
  "generator-ts-api.compatibilityVersion": "0.0.x"
}
```

0.0.x 映射行为：
- `int64 -> number`
- `date-time -> string`
- `binary -> string`

---

## 3) 只把 date-time 改成 Date

适合：项目统一把时间字段当 `Date` 处理。

```jsonc
{
  "generator-ts-api.compatibilityVersion": "latest",
  "generator-ts-api.typeMapping.dateTimeTarget": "Date"
}
```

效果：
- `int64 -> string`（保持 latest 默认）
- `date-time -> Date`
- `binary -> Blob`

---

## 4) 自定义 formatMap 覆盖默认映射

适合：你有团队内部的类型约定。

```jsonc
{
  "generator-ts-api.compatibilityVersion": "latest",
  "generator-ts-api.typeMapping.formatMap": {
    "int64": "bigint",
    "date-time": "Dayjs",
    "binary": "ArrayBuffer",
    "uuid": "string",
    "decimal": "string"
  }
}
```

说明：
- `formatMap` 会覆盖默认映射。
- key 建议用小写（内部会归一化处理）。

---

## 5) latest + 局部覆盖（推荐）

适合：大多数字段用默认，仅少量格式特殊化。

```jsonc
{
  "generator-ts-api.compatibilityVersion": "latest",
  "generator-ts-api.typeMapping.dateTimeTarget": "Date",
  "generator-ts-api.typeMapping.formatMap": {
    "binary": "ArrayBuffer"
  }
}
```

最终效果：
- `int64 -> string`（默认）
- `date-time -> Date`（通过 `dateTimeTarget` 覆盖）
- `binary -> ArrayBuffer`（通过 `formatMap` 覆盖）

---

## 6) 0.0.x + 局部补丁

适合：先保守兼容旧版，只对个别格式做现代化升级。

```jsonc
{
  "generator-ts-api.compatibilityVersion": "0.0.x",
  "generator-ts-api.typeMapping.formatMap": {
    "binary": "Blob"
  }
}
```

最终效果：
- `int64 -> number`（0.0.x）
- `date-time -> string`（0.0.x）
- `binary -> Blob`（被覆盖）

---

## 7) HTTP 客户端模式：axios-wrapper（默认）

适合：已有统一 request 封装（如 `@/utils/request`）。

```jsonc
{
  "generator-ts-api.httpClient": "axios-wrapper",
  "generator-ts-api.requestImportPath": "@/utils/request"
}
```

特点：
- 生成 `getConfigs + request` 风格。
- 与旧版行为最接近。

---

## 8) HTTP 客户端模式：axios

适合：直接用 axios，不依赖项目封装。

```jsonc
{
  "generator-ts-api.httpClient": "axios",
  "generator-ts-api.requestImportPath": "axios"
}
```

特点：
- 生成 `async/await` + `axios.get/post/...`。

---

## 9) HTTP 客户端模式：fetch

适合：原生 fetch 项目或不希望引入 axios。

```jsonc
{
  "generator-ts-api.httpClient": "fetch"
}
```

特点：
- 不生成 axios import。
- 生成 `fetch(...)` 风格方法。

---

## 10) HTTP 客户端模式：custom（模板驱动）

适合：已有完全自定义请求框架（如 `myRequest` / `ky` / `umi-request`）。

### 10.1 内联模板

```jsonc
{
  "generator-ts-api.httpClient": "custom",
  "generator-ts-api.customTemplate.templateString": "return myRequest<{{returnType}}>({ method: '{{METHOD}}', url: `{{url}}`, params: {{params}}, data: {{body}} })"
}
```

### 10.2 文件模板（优先级更高）

```jsonc
{
  "generator-ts-api.httpClient": "custom",
  "generator-ts-api.customTemplate.templateFile": "D:/templates/request-method.tpl"
}
```

可用占位符：
- `{{method}}` / `{{METHOD}}`
- `{{url}}`
- `{{params}}`
- `{{body}}`
- `{{returnType}}`
- `{{methodName}}`
- `{{contentType}}`

---

## 11) 输出策略：single（单文件）

适合：小项目、接口数量少。

```jsonc
{
  "generator-ts-api.outputSplit": "single"
}
```

---

## 12) 输出策略：byTag（按模块拆分）

适合：中大型项目、按业务模块维护。

```jsonc
{
  "generator-ts-api.outputSplit": "byTag",
  "generator-ts-api.naming.typesDirName": "types",
  "generator-ts-api.naming.controllersDirName": "modules",
  "generator-ts-api.naming.controllerFileNameCasing": "kebab-case",
  "generator-ts-api.naming.controllerClassNameSuffix": "Service"
}
```

示例输出结构：

```text
output/
  types/
    index.ts
  modules/
    user-service.ts
    order-service.ts
    index.ts
  index.ts
```

---

## 13) 生成 request.ts 样板（随 API 代码自动生成）

适合：新项目快速补齐请求拦截器骨架，每次生成 API 时自动写入。

```jsonc
{
  "generator-ts-api.generateRequestScaffold": true
}
```

说明：
- 仅在目标目录不存在同名 `request.ts` 时生成。
- 已存在时不会覆盖，保护手动修改。
- 生成内容为富注释模板，含请求/响应拦截器示例注释、完整类型签名。

---

## 14b) 独立生成封装 Request 模板文件

适合：不想依赖 API 生成流程、需要单独生成或重新生成 request 文件。

**执行命令**：命令面板 → `生成封装Request模板文件`

### 步骤引导

1. **选择 HTTP 客户端模式**（默认高亮配置中的模式）

   | 选项 | 说明 |
   |---|---|
   | `axios-wrapper` | getConfigs + request 包装器，与生成的 API 代码完全匹配 |
   | `axios` | axios 实例直调风格 |
   | `fetch` | 原生 fetch，无 axios 依赖 |

2. **填写 axios import 路径**（fetch 模式跳过）
   - 预填配置中的路径，留空默认 `"axios"`

3. **选择输出文件类型**：`.ts` 或 `.js`

4. **选择保存位置**：文件已存在时提示确认覆盖

### 生成示例（axios-wrapper + .ts）

```typescript
import axios, { type AxiosRequestConfig, type AxiosResponse,
  type InternalAxiosRequestConfig, type Method } from 'axios'

export interface RequestConfig extends AxiosRequestConfig {}
export interface RequestOptions extends AxiosRequestConfig {}

const instance = axios.create({ baseURL: '', timeout: 10000 })

// ── 请求拦截器
instance.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // const token = localStorage.getItem('token')
    // if (token) config.headers['Authorization'] = `Bearer ${token}`
    return config
  },
  (error) => Promise.reject(error)
)

// ── 响应拦截器
instance.interceptors.response.use(
  (response: AxiosResponse) => {
    // const { code, message, data } = response.data
    // if (code !== 0) return Promise.reject(new Error(message))
    return response.data
  },
  (error) => {
    // if (error.response?.status === 401) location.href = '/login'
    return Promise.reject(error)
  }
)

export function getConfigs(
  method: Method, contentType: string, url: string,
  options: RequestOptions = {}
): RequestConfig {
  return {
    method, url,
    headers: { 'Content-Type': contentType, ...(options.headers || {}) },
    ...options,
  }
}

function request(
  configs: AxiosRequestConfig,
  resolve: (value: any) => void,
  reject: (reason?: any) => void
): void {
  instance(configs).then(resolve).catch(reject)
}

export default request
```

### 生成示例（fetch + .ts）

```typescript
// ── 请求拦截器
async function requestInterceptor(
  url: string, options: RequestInit
): Promise<[string, RequestInit]> {
  // const token = localStorage.getItem('token')
  // if (token) options.headers = { ...options.headers, Authorization: `Bearer ${token}` }
  return [url, options]
}

// ── 响应拦截器
async function responseInterceptor<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

export async function fetchRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const [finalUrl, finalOptions] = await requestInterceptor(url, options)
  const response = await fetch(finalUrl, finalOptions)
  return responseInterceptor<T>(response)
}

export default fetchRequest
```

---

## 14) Swagger 2.x 场景（V2 生成器）

```jsonc
{
  "generator-ts-api.apiDocsUrl": "http://localhost:8080/v2/api-docs",
  "generator-ts-api.outputType": "ts",
  "generator-ts-api.compatibilityVersion": "latest",
  "generator-ts-api.typeMapping.dateTimeTarget": "string"
}
```

说明：
- 文档包含 `swagger: "2.0"` 时会自动走 V2 生成器。

---

## 15) OpenAPI 3.x 场景（V3 生成器）

```jsonc
{
  "generator-ts-api.apiDocsUrl": "http://localhost:8080/v3/api-docs",
  "generator-ts-api.outputType": "ts",
  "generator-ts-api.compatibilityVersion": "latest",
  "generator-ts-api.typeMapping.dateTimeTarget": "Date"
}
```

说明：
- 文档包含 `openapi: "3.x"` 时会自动走 V3 生成器。

---

## 16) URL 需要账号密码（401）

当 URL 首次返回 401：
1. 插件会弹出用户名输入框。
2. 再弹出密码输入框。
3. 自动使用 Basic Auth 重试一次。

若取消输入或重试失败，会中止并提示错误。

---

## 17) 常见组合模板（可直接拷贝）

### A. 新项目推荐（latest + byTag + axios-wrapper）

```jsonc
{
  "generator-ts-api.outputSplit": "byTag",
  "generator-ts-api.httpClient": "axios-wrapper",
  "generator-ts-api.requestImportPath": "@/utils/request",

  "generator-ts-api.compatibilityVersion": "latest",
  "generator-ts-api.typeMapping.dateTimeTarget": "Date",
  "generator-ts-api.typeMapping.formatMap": {
    "int64": "string",
    "binary": "Blob"
  },

  "generator-ts-api.naming.typesDirName": "types",
  "generator-ts-api.naming.controllersDirName": "modules",
  "generator-ts-api.naming.controllerFileNameCasing": "kebab-case",
  "generator-ts-api.naming.controllerClassNameSuffix": "Service"
}
```

### B. 老项目平滑迁移（0.0.x + single）

```jsonc
{
  "generator-ts-api.outputSplit": "single",
  "generator-ts-api.httpClient": "axios-wrapper",
  "generator-ts-api.compatibilityVersion": "0.0.x",
  "generator-ts-api.typeMapping.formatMap": {}
}
```

### C. 极简 fetch 项目（latest + single）

```jsonc
{
  "generator-ts-api.outputSplit": "single",
  "generator-ts-api.httpClient": "fetch",
  "generator-ts-api.compatibilityVersion": "latest",
  "generator-ts-api.typeMapping.dateTimeTarget": "string"
}
```

---

## 18) 配置优先级说明

1. `compatibilityVersion` 决定基础映射（`latest` 或 `0.0.x`）。
2. `typeMapping.dateTimeTarget` 会写入 `date-time` 覆盖值。
3. `typeMapping.formatMap` 最后覆盖（优先级最高）。

即：`formatMap` > `dateTimeTarget` > `compatibilityVersion 默认映射`。

---

## 20) Mock 数据生成：纯 JSON 格式

适合：快速查看每个接口的响应结构，或作为简单的 fixture 文件。

```jsonc
{
  "generator-ts-api.mock.outputFormat": "json",
  "generator-ts-api.mock.arrayItemCount": 2
}
```

执行命令 `生成Mock数据` → 选择来源 → 保存为 `mock-data.json`。

生成示例：

```json
{
  "GET /user/list": {
    "status": 200,
    "summary": "获取用户列表",
    "data": {
      "list": [
        { "id": "1", "name": "示例名称", "createdAt": "2024-01-15T08:30:00Z" },
        { "id": "1", "name": "示例名称", "createdAt": "2024-01-15T08:30:00Z" }
      ],
      "total": 50
    }
  },
  "POST /user": {
    "status": 200,
    "summary": "创建用户",
    "data": { "id": "1" }
  }
}
```

---

## 21) Mock 数据生成：MSW (Mock Service Worker)

适合：React / Vue 项目前后端并行开发，搭配 Vitest 或浏览器偏移模拟请求。

```jsonc
{
  "generator-ts-api.mock.outputFormat": "msw",
  "generator-ts-api.mock.baseUrl": "/api",
  "generator-ts-api.mock.arrayItemCount": 3
}
```

执行命令 `生成Mock数据` → 保存为 `handlers.ts`，生成内容示例：

```typescript
import { http, HttpResponse } from 'msw'

const BASE_URL = '/api'

export const handlers = [
  // 获取用户列表
  http.get(`${BASE_URL}/user/list`, () => {
    return HttpResponse.json(
      {
        "list": [
          { "id": "1", "name": "示例名称", "email": "example@example.com" },
          { "id": "1", "name": "示例名称", "email": "example@example.com" },
          { "id": "1", "name": "示例名称", "email": "example@example.com" }
        ],
        "total": 50
      },
      { status: 200 }
    )
  }),
]
```

在项目入口注册：

```typescript
// src/mocks/browser.ts（浏览器端）
import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'
export const worker = setupWorker(...handlers)

// vitest.setup.ts（测试端）
import { setupServer } from 'msw/node'
import { handlers } from './mock/handlers'
export const server = setupServer(...handlers)
```

---

## 22) Mock 数据生成：json-server

适合：无需修改前端代码、快速起一个本地 REST Mock 服务。

```jsonc
{
  "generator-ts-api.mock.outputFormat": "json-server",
  "generator-ts-api.mock.arrayItemCount": 5
}
```

执行命令 `生成Mock数据` → 选择输出**目录**，生成：

```text
mock/
  db.json        ← 资源数据
  routes.json    ← 路由映射
  README.md      ← 使用说明
```

一键启动：

```bash
npm install -g json-server
json-server --watch mock/db.json --routes mock/routes.json --port 3100
```

访问 `http://localhost:3100/user` 即可获取 Mock 数据。

---

## 23) Mock 数据生成：使用配置中的 URL/路径

适合：已在设置中配置了 `apiDocsUrl` 或 `apiDocsPath`，一键生成无需重复输入。

```jsonc
{
  "generator-ts-api.apiDocsUrl": "http://localhost:8080/v3/api-docs",
  "generator-ts-api.mock.outputFormat": "json",
  "generator-ts-api.mock.arrayItemCount": 2
}
```

执行命令 `生成Mock数据` → 选择 **使用配置中的 URL/路径** → 直接生成。

---

## 24) 常见 Mock 组合模板

### A. 新项目 + MSW + 覆盖 baseUrl

```jsonc
{
  "generator-ts-api.mock.outputFormat": "msw",
  "generator-ts-api.mock.baseUrl": "https://api.example.com",
  "generator-ts-api.mock.arrayItemCount": 2
}
```

### B. 快速验证接口结构（纯 JSON）

```jsonc
{
  "generator-ts-api.mock.outputFormat": "json",
  "generator-ts-api.mock.arrayItemCount": 1
}
```

### C. 离线演示环境（json-server）

```jsonc
{
  "generator-ts-api.mock.outputFormat": "json-server",
  "generator-ts-api.mock.arrayItemCount": 10
}
```

---

## 25) 快速排查

- 生成类型不符合预期：检查 `compatibilityVersion` 与 `typeMapping.formatMap`。
- 还是旧导入风格：检查 `httpClient` 是否仍是 `axios-wrapper`。
- 没拆分文件：检查 `outputSplit` 是否为 `byTag`。
- 没生成 `request.ts`（随 API 代码）：检查 `generateRequestScaffold`，以及目标目录是否已有同名文件。
- 想单独生成 request 文件：使用命令面板执行 `生成封装Request模板文件`，可选择模式和保存位置，已存在文件会提示确认覆盖。

---

如需扩展更多格式映射（如 `byte`、`password`、`email`、`uri`、`float`、`double`），可直接在 `generator-ts-api.typeMapping.formatMap` 中添加键值对。