# 前端API文档生成工具

## 功能概述

这是一个用于生成前端代码中可直接调用的 API 文档的工具，支持多种前端框架，能够自动从后端 API 文档生成可直接在代码中使用的 TypeScript/JavaScript API 定义。

## 前置要求

### API 文档来源
- ✅ Swagger / OpenAPI 在线文档链接
- ✅ 本地 JSON 文档文件
- ✅ 本地 YAML 文档文件
- ✅ 其他符合 OpenAPI 规范的文档

### 支持的规范
- ✅ Swagger 2.x
- ✅ OpenAPI 3.x
- ✅ JSON Schema（常见结构）

## 主要功能

### 1) 多框架支持
- ✅ TypeScript API 代码生成
- ✅ React / Vue / Angular 项目可直接接入

### 2) 文档生成能力
- ✅ 自动解析 API 文档（URL / 文件）
- ✅ 自动生成接口定义与请求参数类型
- ✅ 自动生成请求方法（按配置切换风格）
- ✅ 支持自定义模板扩展

### 3) 侧边栏 API 面板
- ✅ 左侧 Activity Bar 提供 `Generator API` 面板
- ✅ 提供中央编辑区可视化配置中心，分类编辑全部生成设置
- ✅ 按工作区保存 API 配置档案，复用上次选择的后端文档与输出路径
- ✅ 展示文档状态：在线 / 离线 / 有变动 / 无变动 / 未知
- ✅ 支持手动检查变更、点击更新 API、开启/关闭自动监听
- ✅ URL 缓存列表支持展示、编辑、复制、删除，并可一键基于缓存新增配置

### 4) Controller 选择生成
- ✅ 可在面板中选择要生成的 Controller
- ✅ 不选择时生成全部 Controller
- ✅ 适合大型后端文档按业务模块生成，减少不必要的 Controller 输出

### 5) Mock 数据生成
- ✅ 基于 `example` / `default` 字段优先生成真实 Mock 值
- ✅ 按 `format`（date-time、email、uuid…）与字段名语义自动合成
- ✅ 支持三种输出格式：纯 JSON / MSW handlers / json-server
- ✅ 前后端并行开发，无需等待真实接口上线

### 6) Request 模板文件生成
- ✅ 独立命令一键生成封装好的 `request.ts` / `request.js` 模板
- ✅ 支持 `axios-wrapper` / `axios` / `fetch` 三种风格
- ✅ 生成内容含请求拦截器、响应拦截器、`getConfigs`、`export default request` 等完整骨架
- ✅ 文件已存在时提示确认覆盖，不静默覆盖

### 7) 命名风格与 import 定制
- ✅ 方法名命名风格配置（`default` / `PascalCase` / `camelCase` / `kebab-case`）
- ✅ 默认模式自动将特殊符号替换为下划线 `_`，确保生成代码可编译
- ✅ 支持直接替换 import 路径（`directReplacementRequestImportPath`），完全自定义 import 语句

### 8) 类型与结构处理
- ✅ 常见 OpenAPI 类型推导
- ✅ 请求/响应结构映射
- ✅ 错误信息透出，便于排查

### 9) 输出格式
- ✅ TypeScript（`.ts`）
- ✅ JavaScript（`.js`）

## 安装方式

1. 打开 VS Code
2. 点击左侧活动栏的扩展图标
3. 搜索 "generator-ts-api"
4. 点击安装按钮

## 使用方法

### 快速开始
1. 在 VS Code 中打开你的前端项目。
2. 点击左侧 Activity Bar 的 `Generator API` 图标，打开 `API 文档` 面板。
3. 点击面板右上角 `+`，新增一个 URL 配置。
4. 点击侧边栏的 `打开配置中心` 或标题栏齿轮，在中央编辑区集中配置来源、输出、命名和请求方式。
5. 首次点击 `更新 API` 时选择输出文件或输出目录；再次生成时可确认复用、重新选择或设置不再提示。
6. 如只想生成部分模块，可在配置中心编辑 `Controller 范围`。
7. 后续可直接点击 `更新 API`，或使用 `检查变更` 查看后端文档是否变化。
8. 需要刷新整个面板时，点击右上角刷新按钮，会重新读取缓存、当前 settings，并检查所有 API 配置状态。

你也可以继续使用命令面板（Windows/Linux：`Ctrl + Shift + P`，macOS：`Cmd + Shift + P`）执行传统 URL / File 生成命令。

### 侧边栏面板说明

面板由 API 配置、URL 缓存和配置展示三部分组成。右上角提供三个常用操作：

- `刷新面板信息`：重新读取 URL 缓存、当前 `generator-ts-api.*` settings，并检查所有 API 配置的文档状态。
- `新增 URL 配置`：新增一个后端 API 文档 URL 配置。
- `使用默认配置更新 API`：直接用默认 API 配置拉取文档并生成代码。

#### API 配置

每个 API 配置会保存当前工作区的一组生成上下文：

- 文档来源 URL
- 输出路径
- 上次输出拆分模式
- 选中的 Controller
- 自动监听开关
- 最近一次检查/生成状态

配置节点下分为两组：

- `信息`：只读展示状态、输出位置、Controller 范围。
- `操作`：可点击命令，包括更新 API、检查变更、开启/关闭自动监听、设为默认、删除配置。

生成时会直接读取当前 VS Code 生效的 `generator-ts-api.*` 配置，`.vscode/settings.json` 修改后不需要同步到缓存。

输出位置由代码生成命令统一读取工作区 `.vscode/settings.json`：

```jsonc
{
  "generator-ts-api.outputPath": "${workspaceFolder}/src/api",
  "generator-ts-api.outputPathSplit": "byController"
}
```

输出位置由当前工作区的所有 API 配置共用，切换 API 不需要重新选择。`generate`、`generateFromUrl`、`generateFromFile` 或侧边栏“更新 API”需要用户选择输出位置时，会自动写回这份工作区配置。工作区内的位置保存为 `${workspaceFolder}` 相对形式；多根工作区使用 `${workspaceFolder:文件夹名}`。手工填写 `src/api` 这样的普通相对路径时，以第一个工作区文件夹为基准。工作区外的位置仍保存绝对路径。

Controller 过滤同样是工作区统一配置：

```jsonc
{
  "generator-ts-api.selectedControllers": ["用户管理", "订单管理"]
}
```

该列表应用于侧边栏更新以及 `generate`、`generateFromUrl`、`generateFromFile`；空数组表示生成全部 Controller。自动监听仍由每个 API 配置单独开启或关闭。

| 模式 | 输出位置 |
|---|---|
| `single` | 选择一个 `.ts` / `.js` 文件 |
| `byTag` | 选择输出目录 |
| `byController` | 选择输出目录 |
| `byControllerSingleFile` | 选择输出目录 |

#### URL 缓存

`URL 缓存` 默认收起，展开后会展示历史使用过的 API 文档地址。

- 点击缓存项：基于该 URL 新增一个 API 配置。
- 编辑：修改缓存名称和 URL。
- 复制：复制 URL 到剪切板。
- 删除：从缓存列表移除。

#### 配置

`配置` 位于 `URL 缓存` 下方，默认收起，用于展示当前工作区生效的 `generator-ts-api.*` 设置值。它只展示 settings 的实时值，不再与 API 配置缓存做对比。

配置内容按功能分组展示：

- `文档来源`：API URL、本地 API 文档路径。
- `生成输出`：框架、输出类型、输出拆分、生成前清理。
- `HTTP 客户端`：客户端模式、request import、样板文件、兼容版本。
- `命名规范`：目录名、Controller 文件/Class 命名、方法名、类型名。
- `类型与拆分`：format 类型映射、Controller 本地类型、单文件抽离共用类型。
- `面板监听`：自动监听轮询间隔。

`Controller 命名映射` 会作为 `命名规范` 下的展开节点展示。展开时插件会读取默认 API 配置对应的文档，遍历 `apiDocs.tags[].name` 作为映射 key；如果 `.vscode/settings.json` 中的 `generator-ts-api.naming.controllerNameMap` 存在同名 key，则在右侧显示映射值，否则显示为空。

### 文档状态说明

| 状态 | 含义 |
|---|---|
| 在线 | 文档可访问，最近生成成功 |
| 离线 | 拉取或解析失败 |
| 有变动 | 当前文档 hash 与上次记录不一致 |
| 无变动 | 当前文档 hash 与上次记录一致 |
| 未知 | 尚未检查或尚未生成 |

### 自动监听

自动监听是对远程 URL 的轻量轮询检查，不会默认开启。你可以在配置的 `操作` 中开启/关闭。

- 轮询只负责检查文档 hash 是否变化。
- 检测到变化后，面板状态会显示为 `有变动`。
- 需要生成时点击 `更新 API`。
- 轮询间隔由 `generator-ts-api.watch.intervalSeconds` 控制，默认 120 秒，最低 60 秒。

### 命令列表
- `generator-ts-api.generate`：按当前配置生成
- `generator-ts-api.generateFromUrl`：从 URL 拉取并生成
- `generator-ts-api.generateFromFile`：从本地文件读取并生成
- `generator-ts-api.generateMock`：生成 Mock 数据（JSON / MSW / json-server）
- `generator-ts-api.generateRequestTemplate`：独立生成封装 Request 模板文件
- `generator-ts-api.profile.addUrl`：新增 URL 配置
- `generator-ts-api.profile.refreshPanel`：刷新面板信息并检查所有 API 配置状态
- `generator-ts-api.profile.generateDefault`：使用默认 API 配置更新
- `generator-ts-api.profile.generate`：更新当前 API 配置
- `generator-ts-api.profile.check`：检查 API 文档变更
- 输出位置统一通过工作区配置 `generator-ts-api.outputPath` 设置。
- Controller 过滤统一通过工作区配置 `generator-ts-api.selectedControllers` 设置。
- `generator-ts-api.profile.toggleWatch`：开启/关闭自动监听

### 导出示例

#### request.ts（axios-wrapper 示例，由命令或 generateRequestScaffold 生成）
```typescript
import axios, { type AxiosRequestConfig, type AxiosResponse, type InternalAxiosRequestConfig, type Method } from 'axios'

export interface RequestConfig extends AxiosRequestConfig {
  // 可在此扩展自定义请求配置字段
}

export interface RequestOptions extends AxiosRequestConfig {
  // 可在此扩展自定义请求选项字段
}

const instance = axios.create({
  baseURL: '',
  timeout: 10000,
})

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
  (response: AxiosResponse) => response.data,
  (error) => Promise.reject(error)
)

export function getConfigs(
  method: Method,
  contentType: string,
  url: string,
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

#### services.ts（生成后的调用风格示例）
```typescript
import request, { getConfigs, type RequestConfig } from "@/utils/request"

export class UserController {
  /**
   * 获取用户列表
   */
  static list(
    params: { name?: string; page?: number } = {} as any,
    options: RequestConfig = {}
  ): Promise<{ list: UserVO[]; total: number }> {
    return new Promise((resolve, reject) => {
      const url = "/user/list"
      const configs = getConfigs(
        "get",
        "application/json",
        url,
        options
      )
      configs.params = params
      request(configs, resolve, reject)
    })
  }
}
```

#### types.ts（生成类型示例）
```typescript
export interface UserVO {
  id?: string
  name?: string
  createdAt?: string
}
```
## 配置选项

### VS Code 设置

常用配置：

| 配置项 | 默认值 | 说明 |
|---|---:|---|
| `generator-ts-api.apiDocsUrl` | `""` | API 文档 URL，传统命令 `generate` 使用 |
| `generator-ts-api.apiDocsPath` | `""` | 本地 JSON / YAML 文档路径；从文件生成成功后自动同步 |
| `generator-ts-api.apiDocsPathMode` | `workspaceRelative` | 本地文档路径保存方式：相对工作区或绝对路径 |
| `generator-ts-api.outputType` | `ts` | 输出 `ts` 或 `js` |
| `generator-ts-api.outputSplit` | `single` | 输出拆分策略：单文件、按 Tag、按 Controller、每个 Controller 单文件 |
| `generator-ts-api.outputPath` | `""` | 当前工作区所有 API 配置共用的输出文件或目录 |
| `generator-ts-api.outputPathSplit` | `""` | 输出位置对应的拆分模式，由侧边栏操作自动维护 |
| `generator-ts-api.confirmOutputPathBeforeGenerate` | `true` | 已有输出路径时生成前确认；关闭后直接复用，不再提示 |
| `generator-ts-api.selectedControllers` | `[]` | 工作区所有 API 生成入口共用的 Controller 过滤列表 |
| `generator-ts-api.cleanOutputDir` | `false` | 多文件输出前清理插件生成的旧目录/文件 |
| `generator-ts-api.naming.controllerNameStrategy` | `tagName` | 拆分输出时 Controller 文件名/Class 名的命名来源，可选 `tagName` / `tagDescription` / `auto` |
| `generator-ts-api.naming.controllerNameMap` | `{}` | Controller 命名映射，优先级最高，适合后端 tag name/description 都不规范时手动指定英文名 |
| `generator-ts-api.naming.skipDuplicateControllerClassNameSuffix` | `true` | 命名来源已经带有配置后缀时，不重复追加后缀 |
| `generator-ts-api.naming.methodNamePathSuffixesEnabled` | `false` | 是否启用通用 path 后缀稳定命名；默认关闭以兼容旧版 |
| `generator-ts-api.naming.methodNamePathSuffixes` | 常用后缀列表 | 需要稳定命名的 `page`、`detail` 等 path 后缀 |
| `generator-ts-api.naming.methodNamePathSuffixScopes` | `[]` | 按原始 Tag/Controller 和 path 前缀定向应用；空数组表示不限制作用域 |
| `generator-ts-api.watch.intervalSeconds` | `120` | 面板自动监听的轮询间隔，最低 60 秒 |

### 可视化配置中心

点击侧边栏的 **打开配置中心** 或标题栏齿轮，可在中央编辑区以表格方式修改配置：

- `保存`：只把本次修改的字段写入当前 VS Code Workspace。
- `保存并生成`：先写入 Workspace，再使用更新后的配置生成默认 API。
- 配置来源会标记为工作区文件夹、工作区、用户设置或插件默认值。
- 数组和对象配置使用 JSON 编辑框，格式错误时不会保存。
- 从 URL、本地文档、输出文件或输出目录选择器得到的值会同步到配置中心。
- “监听 API 配置”列表会显示 URL 或本地文件路径、监听状态和默认配置，可直接切换监听、设为默认或从列表移除。
- “URL 缓存”列表支持加入监听列表、编辑和删除；缓存已有名称时直接沿用，不再重复弹出名称输入框。
- 通过 `+` 新增 URL Profile 后，填写的名称会同步到对应 URL 缓存。

列表操作说明：

| 列表 | 操作 | 行为 |
|---|---|---|
| 监听 API 配置 | 开启/关闭监听 | 控制该 URL 或本地文件配置是否参与定时检查 |
| 监听 API 配置 | 设为默认 | 工作区内始终只有一个默认配置，`保存并生成` 优先使用它 |
| 监听 API 配置 | 移除 | 从当前工作区的监听配置中移除，操作前确认 |
| URL 缓存 | 加入监听列表 | 创建 URL Profile；有缓存名称时直接沿用 |
| URL 缓存 | 编辑 | 修改缓存显示名称与 URL |
| URL 缓存 | 删除 | 仅删除全局缓存，不影响已经创建的监听配置 |

生成参数顶部的搜索框会弹性占用剩余宽度，“仅显示已配置”和“显示高级配置”保持单行展示。

单文件夹工作区的 Workspace 配置通常写入 `.vscode/settings.json`；多根工作区可能写入 `.code-workspace` 文件。

### 文档与输出路径保存

本地文档默认保存为可共享的工作区相对路径：

```jsonc
{
  "generator-ts-api.apiDocsPathMode": "workspaceRelative",
  "generator-ts-api.apiDocsPath": "${workspaceFolder}/docs/openapi.json"
}
```

如文档固定在本机工作区之外，可切换为 `absolute`。相对模式选择工作区外文件时，插件会自动回退为绝对路径。

已有兼容输出路径时，生成前可以继续使用、重新选择或选择“使用且不再提示”。也可以直接配置：

```jsonc
{
  "generator-ts-api.confirmOutputPathBeforeGenerate": false
}
```

Controller 命名来源只影响拆分输出的文件名和 Class 名，不改变 `operation.tags[0]`、Controller 选择和过滤逻辑。中文 tag 想使用后端 `tags[].description` 的英文类名时，可以这样配置：

```json
{
  "generator-ts-api.naming.controllerNameStrategy": "auto",
  "generator-ts-api.naming.controllerClassNameSuffix": "Controller",
  "generator-ts-api.naming.skipDuplicateControllerClassNameSuffix": true,
  "generator-ts-api.naming.controllerNameMap": {
    "用户管理": "UserController"
  }
}
```

`auto` 会在 `tags.name` 含中文且 `tags.description` 是英文标识风格时使用 description；否则回退 name。`controllerNameMap` 命中时优先使用映射值。

在侧边栏 `配置` -> `命名规范` -> `Controller 命名映射` 中，可以按默认 API 文档的 `tags[].name` 快速查看当前映射是否完整。

完整命名规则见 [NAMING.md](./NAMING.md)。

如需只稳定某个移动端 Controller 中重复的 `page/detail` 方法名，可使用虚构配置：

```jsonc
{
  "generator-ts-api.naming.methodNamePathSuffixesEnabled": true,
  "generator-ts-api.naming.methodNamePathSuffixes": ["page", "detail"],
  "generator-ts-api.naming.methodNamePathSuffixScopes": [
    {
      "controller": "移动端应用",
      "pathPrefix": "/mobile-api"
    }
  ]
}
```

此时 `/mobile-api/billing/order/page` 固定生成 `BillingOrderPage`，`/mobile-api/order/page` 固定生成 `OrderPage`。后续增加新的 `page` 接口不会改变这两个已有方法名；其他 Controller 仍沿用旧规则。

面板中的 API 配置档案存储在当前工作区的 `workspaceState`，全局输出位置存储在工作区 `settings.json`，URL 历史缓存存储在扩展的 `globalState`：

- 同一个工作区会记住自己的 API 配置和输出路径。
- 同一工作区内的所有 API 配置共用输出路径。
- 不同工作区可以拥有不同的默认 API 配置。
- URL 缓存是全局共享的，方便跨项目复用常用后端文档地址。

## 贡献指南

欢迎提交 Issue 和 Pull Request 来帮助改进这个项目。

## 许可证

[MIT License](./LICENSE.md)

## 版本变更

见 [CHANGELOG.md](./CHANGELOG.md)。

## 示例

[Example](./Example.md)


## 认证说明

如果通过 URL 拉取 API 文档时后端返回 401，插件会提示输入用户名和密码，并使用 HTTP Basic Auth 重试一次请求。

- 用户取消输入或重试失败时，生成流程会中止并显示错误。
- 当前仅支持 Basic Auth。
- Bearer Token、自定义 Header 和凭证缓存暂未作为正式配置提供。
