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
4. 首次点击 `更新 API` 时选择输出文件或输出目录；之后会自动复用该路径。
5. 如只想生成部分模块，进入该配置的 `操作` -> `选择 Controller`。
6. 后续可直接点击 `更新 API`，或使用 `检查变更` 查看后端文档是否变化。

你也可以继续使用命令面板（Windows/Linux：`Ctrl + Shift + P`，macOS：`Cmd + Shift + P`）执行传统 URL / File 生成命令。

### 侧边栏面板说明

面板分为两部分：

#### API 配置

每个 API 配置会保存当前工作区的一组生成上下文：

- 文档来源 URL
- 输出路径
- 输出拆分模式
- 选中的 Controller
- 自动监听开关
- 最近一次检查/生成状态

配置节点下分为两组：

- `信息`：只读展示状态、输出位置、Controller 范围。
- `操作`：可点击命令，包括更新 API、检查变更、选择 Controller、设置输出位置、开启/关闭自动监听、设为默认、删除配置。

#### URL 缓存

`URL 缓存` 会展示历史使用过的 API 文档地址。

- 点击缓存项：基于该 URL 新增一个 API 配置。
- 编辑：修改缓存名称和 URL。
- 复制：复制 URL 到剪切板。
- 删除：从缓存列表移除。

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
- `generator-ts-api.profile.generateDefault`：使用默认 API 配置更新
- `generator-ts-api.profile.generate`：更新当前 API 配置
- `generator-ts-api.profile.check`：检查 API 文档变更
- `generator-ts-api.profile.pickOutput`：设置输出位置
- `generator-ts-api.profile.pickControllers`：选择要生成的 Controller
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
[配置项速查](./Releases.md)

常用配置：

| 配置项 | 默认值 | 说明 |
|---|---:|---|
| `generator-ts-api.apiDocsUrl` | `""` | API 文档 URL，传统命令 `generate` 使用 |
| `generator-ts-api.apiDocsPath` | `""` | 本地 JSON / YAML 文档路径 |
| `generator-ts-api.outputType` | `ts` | 输出 `ts` 或 `js` |
| `generator-ts-api.outputSplit` | `single` | 输出拆分策略：单文件、按 Tag、按 Controller、每个 Controller 单文件 |
| `generator-ts-api.cleanOutputDir` | `false` | 多文件输出前清理插件生成的旧目录/文件 |
| `generator-ts-api.watch.intervalSeconds` | `120` | 面板自动监听的轮询间隔，最低 60 秒 |

面板中的 API 配置档案存储在当前工作区的 `workspaceState`，URL 历史缓存存储在扩展的 `globalState`：

- 同一个工作区会记住自己的 API 配置和输出路径。
- 不同工作区可以拥有不同的默认 API 配置。
- URL 缓存是全局共享的，方便跨项目复用常用后端文档地址。

## 贡献指南

欢迎提交 Issue 和 Pull Request 来帮助改进这个项目。

## 许可证

[MIT License](./LICENSE.md)

## 版本差异
[Release](./Releases.md)

## 示例
[Example](./Example.md)


## 当 URL 需要账号/密码时的交互行为

如果你通过 URL 拉取 API 文档的后端需要 HTTP 认证（返回 401），插件会在 UI 层与用户交互：

- 首次请求返回 401 时，插件会弹出两个输入框（`showInputBox`）：
  1. 用户名（普通输入框）
  2. 密码（启用 password 模式，输入不可见）

- 插件会使用输入的用户名和密码构造 HTTP Basic Auth（Authorization: Basic ...）头并重试一次请求。
- 如果重试成功，流程继续（解析文档并生成代码）；如果用户取消任一输入框或重试失败，则会中止并显示错误信息。

注意：当前实现只支持 Basic Auth。如果你的服务使用 Bearer Token 或其他认证方式，请在输入用户名或密码时手动输入对应的 token（例如把 token 输入到密码位置，并在后端支持时使用）。后续版本可能会加入更直接的 Bearer Token 支持与凭证缓存。

### 手动测试步骤（快速检验）

1. 在 VS Code 设置中将 `generator-ts-api.apiDocsUrl` 指向一个需要基本认证的 API 文档 URL（或通过命令面板运行 `Generate API Documentation -> From URL`）。
2. 触发从 URL 生成流程，首次请求若返回 401，会依次弹出用户名与密码输入框。
3. 输入正确凭证后，插件会重试请求并继续生成输出文件；若凭证错误或用户取消，会显示失败信息。

### 可选改进

- 缓存凭证：可以在 `extension` 的 `context.globalState` 中安全地（并在用户允许的情况下）缓存加密/序列化的凭证以便下次自动使用。
- 支持 Bearer Token：在弹窗中提供一个可选择的“使用 token”选项，允许用户直接粘贴 token 并以 `Authorization: Bearer <token>` 重试。
- 更好的错误提示：在重试失败时显示后端返回的详细错误（如果存在），帮助用户诊断凭证问题。



## 开发计划


### 插件功能与配置扩展清单
| 扩展维度               | 功能/配置名称                | 描述                                                         | 核心价值 / 解决的痛点                                        |
| ---------------------- | ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| **基础配置扩展**       | **自定义 HTTP 客户端**       | 允许用户指定请求基于 `axios`、`fetch` 等，或直接使用自定义的 `request.ts` 模板 | 满足不同项目基础库架构的需求，生成即用                       |
| ^                      | **全局命名规范（Naming）**   | 配置 Interface 前后缀（如 `I*` 或 `*Dto`），以及请求函数名的风格（驼峰/帕斯卡） | 保持生成代码与项目原有代码风格高度一致                       |
| ^                      | **类型映射规则（Type Map）** | 允许用户将 Swagger 的特殊类型（如 `int64`、`date-time`）映射至自定义的 TS 类型 | 解决长整型精度丢失、时间格式化等业务定制需求                 |
| ^                      | **输出与拆包策略**           | 支持将接口按 API `Tags` 模块化分组，输出到不同文件夹或单一特定文件 | 应对大型项目上百个 API 导致单文件过大、难以维护的问题        |
| ^                      | **文档及注释提取**           | 配置是否提取 `summary`、`description` 并转换为标准的 `JSDoc` 注释 | 增强开发时的代码悬浮提示（Hover）体验                        |
| **核心业务赋能**       | **Mock 数据自动生成**        | 基于 API 类型和 `example` 字段，一键生成本地 Mock 脚本或 JSON 数据 | 在后端接口未完成时，实现前后端无缝并行开发                   | ✅ |
| ^                      | **Request 模板生成**         | 独立命令生成封装好的 request.ts，含拦截器/getConfigs/export default 完整骨架 | 新项目秒出可用的请求封装文件，无需手写样板代码               | ✅ |
| ^                      | **请求 Hooks 封装生成**      | 除基础请求外，自动生成 React `SWR`/`React-Query` 或 Vue3 `Composables` 代码 | 深度集成主流前端框架，直接去掉大量样板代码                   |
| ^                      | **远程带鉴权拉取**           | 支持通过配置携带 Header（Token/Cookie）来请求被保护的线上 OpenAPI/Swagger JSON | 能够顺利访问企业内部加锁/需要登录的接口平台                  |
| ^                      | **自动代码格式化**           | 生成后自动调用当前工作区的 `Prettier` 或 `ESLint` 进行后处理 | 防止生成的代码出现大量 Lint 报错导致 CI 阻塞                 |
| **编辑器体验 (UI/UX)** | **侧边栏 API 树视图**        | 在 VS Code 侧边栏独立面板中管理 API 配置、URL 缓存、状态检查与更新 | 允许开发者复用配置、减少重复选择，并按 Controller 生成 | ✅ |
| ^                      | **生成前差异比对 (Diff)**    | 触发全量生成前，通过 VS Code 可视化对比工具（Diff View）展示新旧代码变化 | 避免不小心把开发者手动修改的代码直接覆盖冲掉                 |
| ^                      | **智能悬浮提示 (Hover)**     | 识别代码里出现的 API 路径（如 `"/api/user"`），悬浮时弹窗显示接口的入参/出参结构 | 提高研发连贯性，不用频繁切换浏览器去查阅文档                 |
| ^                      | **多步引导面板 (QuickPick)** | 提供快捷步骤引导项：执行命令 -> 选版本 -> 选模块 -> 选路径   | 极大降低新接手团队成员的学习和配置成本                       |
| **自动化提升**         | **文档变更监听 (Watch)**     | 对远程 API 文档做轻量轮询，检测 hash 变化并更新面板状态 | 及时发现接口变动，避免旧接口引发问题 | ✅ |



### “可落地细节版”

| 维度   | 扩展项             | 细化内容（建议做到的粒度）                                   | 实现复杂度 | 风险点                         | 优先级 | 实现 | 兼容v0.0.16 |
| ------ | ------------------ | ------------------------------------------------------------ | ---------- | ------------------------------ | ------ | ---- | ----------- |
| 功能   | 文档生成           | 支持3.x版本文档解析                                          | 高         | 手写生成，每次修改都是两套     | P00    | ✅    | ✅           |
| ^      | ^                  | 支持2.x版本文档解析                                          | ^          | ^                              | P00    | ✅    | ✅           |
| 功能   | Mock 数据生成      | json / MSW handlers / json-server 三种格式；example 优先，按 format / 字段名语义合成 | 中 | 文档无 example 时合成值需人工校对 | P1 | ✅ | — |
| 功能   | Request 模板生成   | 独立命令按模式生成 request.ts/js，含拦截器、getConfigs、export default | 低 | — | P1 | ✅ | ✅ |
| 功能   | 侧边栏 API 面板    | 工作区 API 配置档案、URL 缓存、状态检查、默认配置、一键更新 | 中 | TreeView 交互能力有限 | P1 | ✅ | ✅ |
| 功能   | Controller 选择生成 | 按 operation tag 选择 Controller 生成；未选择时生成全部 | 中 | 类型裁剪需继续做依赖闭包 | P1 | ✅ | ✅ |
| 自动化 | 远程文档变更监听   | 对配置的 URL 做轮询 hash 检查，显示有变动/无变动/离线状态 | 中 | 频繁请求后端、鉴权过期 | P2 | ✅ | ✅ |
| 配置   | HTTP 客户端适配    | 支持 axios/fetch/自定义模板三档；可配置 request 导入路径、拦截器注入位 | 中         | 各项目请求封装差异大           | P1     | ✅    | ✅           |
| 配置   | 类型映射 TypeMap   | 支持 int64→string、date-time→string/Date、binary→Blob；允许覆盖默认映射 | 低-中      | 历史代码类型变更导致编译告警   | P1     | ✅    | ✅           |
| 配置   | 输出拆分策略       | 单文件 / 按 tag 分文件 / 按模块分目录；可配置文件名规则      | 中         | 导入路径和覆盖策略复杂         | P1     | ✅    | ✅           |
| 配置   | 文件命名规则       | 如果按 tag 分文件，tag的name是中文，想用英文怎么解决         | 高         | 中文转英文                     | P2     |      |             |
| 配置   | 命名规范           | 方法名风格、Model 前后缀、重复名冲突策略（加模块前缀/序号）  | 中         | 改名影响调用方                 | P2     |      |             |
| 功能   | 文档校验接入主流程 | 解析后先校验再生成；支持 strict/loose 模式；失败给出可读提示 | 低         | 严格模式可能拦截“旧但可用”文档 | P1     |      |             |
| 功能   | V3 引用解析修正    | 全链路解析 $ref（参数/返回体/requestBody）；避免 any 退化    | 中         | 改动后生成结果变化较大         | P1     |      |             |
| 功能   | 认证增强           | URL 拉取支持 Bearer、Basic、自定义 Header；失败重试与历史记忆 | 中         | 凭证安全与日志脱敏             | P2     |      |             |
| 功能   | 生成后格式化       | 可选执行 Prettier/ESLint fix；失败不阻断生成，仅告警         | 低         | 工作区未安装格式化器           | P2     |      |             |
| UX     | 生成前 Diff 预览   | 若目标文件已存在，先展示差异再确认覆盖                       | 中         | 大文件 Diff 性能               | P2     |      |             |
| UX     | 向导式 QuickPick / TreeView | 面板管理配置，QuickPick 选择 URL / Controller，保留上次选择 | 中 | 步骤过多影响熟练用户效率 | P3 | ✅ | ✅ |
| UX     | 错误分级展示       | 弹窗短错误 + 输出通道详细堆栈；网络错误给操作建议            | 低         | 敏感信息泄露                   | P1     |      |             |
| 自动化 | Watch 模式         | 远程文档轮询检查 hash 变化；自动生成暂不默认启用             | 中         | 高频检查、重复写盘             | P2     | ✅    | ✅           |
| 自动化 | 回归测试快照       | V2/V3 固定输入快照，断言签名/类型片段稳定性                  | 中         | 时间戳等非稳定内容干扰         | P1     |      |             |
| 自动化 | 文档一致性校验     | README 配置项与插件声明配置项做一致性检查                    | 低         | 文档更新滞后                   | P3     |      |             |

#### **建议先做的 MVP（1-2 周）**

- P1-1：V3 引用解析修正 + 文档校验接入（先解决“生成正确性”）。
- P1-2：TypeMap + 输出拆分策略（先解决“可定制性”）。
- P1-3：错误分级 + 最小快照测试（先解决“可维护性”）。

#### **验收口径（建议）**

- 正确性：同一份 OpenAPI 文档生成后无 any 异常扩散。
- 稳定性：连续生成 3 次结果一致（除时间戳）。
- 可用性：新项目 10 分钟内可完成首次配置并产出可编译代码。
