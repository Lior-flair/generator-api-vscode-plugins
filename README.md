# 前端API文档生成工具

## 功能概述

这是一个用于生成前端代码中可直接调用的 API 文档的工具，支持多种前端框架，能够自动从后端 API 文档生成可直接在代码中使用的 TypeScript/JavaScript API 定义。

## 前置要求

### 后端 API 文档源
- Swagger/OpenAPI 文档链接
- JSON 格式的 API 文档
- YAML 格式的 API 文档
- 其他符合 OpenAPI 规范的文档

### 支持的文档格式
- Swagger UI 链接
- OpenAPI 3.0 规范文档
- JSON Schema
- YAML 格式的 API 定义

## 主要功能

### 1. 多框架支持
- TypeScript API文档生成
- React组件文档生成
- Vue组件文档生成
- Angular组件文档生成

### 2. 文档生成功能
- 自动解析后端 API 文档
- 自动生成接口定义
- 自动生成请求/响应类型
- 自动生成 API 调用方法
- 支持自定义文档模板

### 3. 代码分析功能
- API 文档解析
- 类型推导
- 参数验证
- 错误处理生成

### 4. 文档输出格式
- TypeScript (.ts) 格式
- JavaScript (.js) 格式

## 安装方式

1. 打开 VS Code
2. 点击左侧活动栏的扩展图标
3. 搜索 "generator-ts-api"
4. 点击安装按钮

## 使用方法

### 基本使用
1. 在 VS Code 中打开项目
2. 使用命令面板 (Ctrl+Shift+P 或 Cmd+Shift+P)
3. 输入 "Generate API Documentation"
4. 选择后端 API 文档源（URL 或文件路径）
5. 选择目标框架
6. 选择输出目录

### 命令列表
- `generator-ts-api.generate`: 生成API文档
- `generator-ts-api.generateFromUrl`: 从URL生成API文档
- `generator-ts-api.generateFromFile`: 从文件生成API文档

### 导出效果
```typescript
export const getConfigs = (
  method: Method,
  contentType: string,
  url: string,
  options: AxiosRequestConfig
): AxiosRequestConfig => {
  const configs: AxiosRequestConfig = { ...options, method, url }
  configs.headers = {
    ...options.headers,
    "Content-Type": contentType,
  }
  return configs
}
```
#### services.ts
```typescript
import Types from './types'
import request,{getConfigs} from './serviceOption'

export class xxController{
  /**
   * xx业务接口
   */
  static list(params:{
    /** 名称 */
    name?:string;
    ...;
  }={} as any,options: 使用的请求依赖的的类型，如：AxiosRequestConfig = {}):Promise<通用返回接口<List<XX>>>{
    return new Promise((resolve,reject)=>{
      let url = '/xxController/list';
      const configs:使用的请求依赖的的类型，如：AxiosRequestConfig  = getConfigs(
        'get',
        'application/json',
        url,
        options
      );
       let data = null;

      configs.data = data;
      request(configs, resolve, reject);
    })
  }
}
```
#### types.ts 通用类型及接口涉及到的类型
```typescript
export interface XX{
  /** 名称 */
  name?:string
  ...
}
```
## 配置选项

### VS Code 设置
```json
{
  "generator-ts-api.framework": "react",
  "generator-ts-api.outputType": "ts",
  "generator-ts-api.template": "./templates/default.ts",
  "generator-ts-api.apiDocsUrl": "http://your-api-docs-url",
  "generator-ts-api.apiDocsPath": "./api-docs.json",
  "generator-ts-api.exclude": ["**/test/**", "**/*.test.*"],
  "generator-ts-api.include": ["**/*.ts", "**/*.tsx"]
}
```

## 开发计划

### 近期计划
- [✅] 支持3.x版本文档解析
- [✅] 支持2.x版本文档解析

## 贡献指南

欢迎提交 Issue 和 Pull Request 来帮助改进这个项目。

## 许可证

MIT License


## 版本差异

### `v11.0`
说明：添加`swagger2.0`生成

### `v6.0` 
说明： 修复`static`命名混乱问题：直接使用链接最后生成，重复则继续向前取
### `v5.0`
说明： `static`命名混乱

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



## 后续功能扩展


### 插件功能与配置扩展清单
| 扩展维度               | 功能/配置名称                | 描述                                                         | 核心价值 / 解决的痛点                                        |
| ---------------------- | ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| **基础配置扩展**       | **自定义 HTTP 客户端**       | 允许用户指定请求基于 `axios`、`fetch` 等，或直接使用自定义的 `request.ts` 模板 | 满足不同项目基础库架构的需求，生成即用                       |
| ^                      | **全局命名规范（Naming）**   | 配置 Interface 前后缀（如 `I*` 或 `*Dto`），以及请求函数名的风格（驼峰/帕斯卡） | 保持生成代码与项目原有代码风格高度一致                       |
| ^                      | **类型映射规则（Type Map）** | 允许用户将 Swagger 的特殊类型（如 `int64`、`date-time`）映射至自定义的 TS 类型 | 解决长整型精度丢失、时间格式化等业务定制需求                 |
| ^                      | **输出与拆包策略**           | 支持将接口按 API `Tags` 模块化分组，输出到不同文件夹或单一特定文件 | 应对大型项目上百个 API 导致单文件过大、难以维护的问题        |
| ^                      | **文档及注释提取**           | 配置是否提取 `summary`、`description` 并转换为标准的 `JSDoc` 注释 | 增强开发时的代码悬浮提示（Hover）体验                        |
| **核心业务赋能**       | **Mock 数据自动生成**        | 基于 API 类型和 `example` 字段，一键生成本地 Mock 脚本或 JSON 数据 | 在后端接口未完成时，实现前后端无缝并行开发                   |
| ^                      | **请求 Hooks 封装生成**      | 除基础请求外，自动生成 React `SWR`/`React-Query` 或 Vue3 `Composables` 代码 | 深度集成主流前端框架，直接去掉大量样板代码                   |
| ^                      | **远程带鉴权拉取**           | 支持通过配置携带 Header（Token/Cookie）来请求被保护的线上 OpenAPI/Swagger JSON | 能够顺利访问企业内部加锁/需要登录的接口平台                  |
| ^                      | **自动代码格式化**           | 生成后自动调用当前工作区的 `Prettier` 或 `ESLint` 进行后处理 | 防止生成的代码出现大量 Lint 报错导致 CI 阻塞                 |
| **编辑器体验 (UI/UX)** | **侧边栏 API 树视图**        | 在 VS Code 侧边栏独立面板中，按树状结构渲染解析到的所有 API  | 允许开发者直观浏览，并支持**右键按需勾选生成**单个或部分接口 |
| ^                      | **生成前差异比对 (Diff)**    | 触发全量生成前，通过 VS Code 可视化对比工具（Diff View）展示新旧代码变化 | 避免不小心把开发者手动修改的代码直接覆盖冲掉                 |
| ^                      | **智能悬浮提示 (Hover)**     | 识别代码里出现的 API 路径（如 `"/api/user"`），悬浮时弹窗显示接口的入参/出参结构 | 提高研发连贯性，不用频繁切换浏览器去查阅文档                 |
| ^                      | **多步引导面板 (QuickPick)** | 提供快捷步骤引导项：执行命令 -> 选版本 -> 选模块 -> 选路径   | 极大降低新接手团队成员的学习和配置成本                       |
| **自动化提升**         | **文件变更监听 (Watch)**     | 启用后台服务监听本地 `swagger.json` 的更新，自动热重载生成最新 TS 代码 | 一旦接口变动立刻同步到代码层，防止旧接口引发线上 Bug         |



### “可落地细节版”

| 维度   | 扩展项             | 细化内容（建议做到的粒度）                                   | 实现复杂度 | 风险点                         | 优先级 | 实现 |
| ------ | ------------------ | ------------------------------------------------------------ | ---------- | ------------------------------ | ------ | ---- |
| 配置   | HTTP 客户端适配    | 支持 axios/fetch/自定义模板三档；可配置 request 导入路径、拦截器注入位 | 中         | 各项目请求封装差异大           | P1     |      |
| 配置   | 类型映射 TypeMap   | 支持 int64→string、date-time→string/Date、binary→Blob；允许覆盖默认映射 | 低-中      | 历史代码类型变更导致编译告警   | P1     |      |
| 配置   | 输出拆分策略       | 单文件 / 按 tag 分文件 / 按模块分目录；可配置文件名规则      | 中         | 导入路径和覆盖策略复杂         | P1     | ✅    |
| 配置   | 命名规范           | 方法名风格、Model 前后缀、重复名冲突策略（加模块前缀/序号）  | 中         | 改名影响调用方                 | P2     |      |
| 功能   | 文档校验接入主流程 | 解析后先校验再生成；支持 strict/loose 模式；失败给出可读提示 | 低         | 严格模式可能拦截“旧但可用”文档 | P1     |      |
| 功能   | V3 引用解析修正    | 全链路解析 $ref（参数/返回体/requestBody）；避免 any 退化    | 中         | 改动后生成结果变化较大         | P1     |      |
| 功能   | 认证增强           | URL 拉取支持 Bearer、Basic、自定义 Header；失败重试与历史记忆 | 中         | 凭证安全与日志脱敏             | P2     |      |
| 功能   | 生成后格式化       | 可选执行 Prettier/ESLint fix；失败不阻断生成，仅告警         | 低         | 工作区未安装格式化器           | P2     |      |
| UX     | 生成前 Diff 预览   | 若目标文件已存在，先展示差异再确认覆盖                       | 中         | 大文件 Diff 性能               | P2     |      |
| UX     | 向导式 QuickPick   | 版本选择→范围选择→输出目录→确认；保留上次选择                | 中         | 步骤过多影响熟练用户效率       | P3     |      |
| UX     | 错误分级展示       | 弹窗短错误 + 输出通道详细堆栈；网络错误给操作建议            | 低         | 敏感信息泄露                   | P1     |      |
| 自动化 | Watch 模式         | 监听本地文档变化自动增量生成；防抖+并发锁                    | 中         | 高频改动导致重复写盘           | P2     |      |
| 自动化 | 回归测试快照       | V2/V3 固定输入快照，断言签名/类型片段稳定性                  | 中         | 时间戳等非稳定内容干扰         | P1     |      |
| 自动化 | 文档一致性校验     | README 配置项与插件声明配置项做一致性检查                    | 低         | 文档更新滞后                   | P3     |      |

#### **建议先做的 MVP（1-2 周）**

- P1-1：V3 引用解析修正 + 文档校验接入（先解决“生成正确性”）。
- P1-2：TypeMap + 输出拆分策略（先解决“可定制性”）。
- P1-3：错误分级 + 最小快照测试（先解决“可维护性”）。

#### **验收口径（建议）**

- 正确性：同一份 OpenAPI 文档生成后无 any 异常扩散。
- 稳定性：连续生成 3 次结果一致（除时间戳）。
- 可用性：新项目 10 分钟内可完成首次配置并产出可编译代码。
