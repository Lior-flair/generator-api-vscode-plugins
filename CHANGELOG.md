# Change Log

## [0.2.0] - 2026年5月25日

#### 新增 `byControllerSingleFile` 输出拆分模式

`generator-ts-api.outputSplit` 新增第四个可选值 `byControllerSingleFile`：每个控制器生成**一个** `.ts` 文件，且该控制器用到的类型（含传递依赖）**内联**在同一文件中，不再生成共享 `types/` 目录。

```text
output/
  controllers/
    用户.ts        ← 顶部内联「用户」用到的类型 + 控制器类
    订单.ts
    index.ts
  index.ts
```

- 与 `byController` 的区别：`byController` 是「一个控制器一个文件夹」，本模式是「一个控制器一个文件」。
- 与 `byTag` 的区别：`byTag` 类型集中在共享 `types/`，本模式类型内联在各控制器文件内、不产生类型导入。
- 权衡：多个控制器共用的类型会在各自文件中重复一份，失去单一数据源；好处是每个文件完全自包含、可单独拷走。

#### 新增「抽离共用类型」开关（`byControllerSingleFile.extractSharedTypes`）

新增配置 `generator-ts-api.byControllerSingleFile.extractSharedTypes`（布尔值，默认 `false`，仅 `byControllerSingleFile` 模式生效）。

为 `true` 时，先统计每个类型被多少个控制器使用：被**两个及以上**控制器共用的类型抽离到共享 `types/` 目录、控制器文件改为 `import` 引入；仅被**单个**控制器使用的类型仍内联在该控制器文件内。这样既保留「每个控制器一个文件」的结构，又避免共用类型在多个文件中重复。

```text
output/
  types/
    index.ts       ← 仅含被多个控制器共用的类型
  controllers/
    用户.ts        ← 内联「用户」独有的类型 + import 共用类型
    订单.ts
    index.ts
  index.ts
```

类型闭包是传递闭包，「共享类型的依赖也必然被同样多的控制器使用」，因此共享集自身封闭、`types/index.ts` 自包含；内联部分引用到的非内联类型必定在共享集里 —— 数学上无遗漏。

#### 新增「类型名命名风格」独立配置（`naming.typeNameCasing`）

旧版行为：类型定义名与类型表达式中的标识符跟随 `methodNameCasing` 一起被归一化。一旦把 `methodNameCasing` 设为 `camelCase`，连 `SysUser` 都会被改成 `sysUser`，常常不是想要的效果。

新增 `generator-ts-api.naming.typeNameCasing`（在「多文件拆分 - 命名规范」分区），可独立控制类型命名：

| 值 | 行为 |
|---|---|
| `follow`（默认） | 跟随 `methodNameCasing`，**与旧版完全一致**，不破坏既有用户 |
| `default` | 保持原始类型名，仅做特殊字符过滤 |
| `PascalCase` | 大驼峰，如 `SysUser`（推荐 TS 类型采用此风格） |
| `camelCase` | 小驼峰，如 `sysUser` |
| `kebab-case` | 连字符 |

典型用法：方法用小驼峰、类型保持大驼峰：

```jsonc
{
  "generator-ts-api.naming.methodNameCasing": "camelCase",
  "generator-ts-api.naming.typeNameCasing": "PascalCase"
}
```

#### `package.json` 配置项按功能分区

设置界面里所有配置项原本平铺在一起，难以查找。改用 VS Code 的 `configuration` **数组**形式，把配置拆成 7 个带标题的小节：

1. **API 文档来源** — `apiDocsUrl`、`apiDocsPath`
2. **代码生成与输出** — `framework`、`outputType`、`outputSplit`、`cleanOutputDir`
3. **多文件拆分 - 命名规范** — `naming.*`
4. **多文件拆分 - 类型组织** — `byController.localTypes`、`byControllerSingleFile.extractSharedTypes`
5. **HTTP 客户端** — `httpClient`、`requestImportPath`、`directReplacementRequestImportPath`、`generateRequestScaffold`、`customTemplate.*`
6. **类型映射** — `compatibilityVersion`、`typeMapping.*`
7. **Mock 数据** — `mock.*`

所有配置 key、默认值、描述均保持不变，**不影响任何已有用户配置**。

#### Bug 修复

- **`List` / `Collection` 在 camelCase 下变成 `list` / `collection`**：V2 内置的 `export type List<T> = Array<T>` / `export type Collection<T> = Array<T>` 辅助别名是写死的大写形式，但 `normalizeTypeExpression` 会把表达式里的所有标识符按 `methodNameCasing` 归一化，导致 `接口返回对象«List«SysUser»»` 变成 `接口返回对象<list<sysUser>>`，编译器报「找不到名称 list」。已将 `List`、`Collection` 加入归一化白名单。
- **Java/Swagger 标量类型在泛型表达式中无定义**：`接口返回对象«Integer»` / `Result«Boolean»` 这类叶子类型不是真实定义，普通归一化（camelCase 下 `Integer` → `integer`）后得到不存在的类型 → 编译错误；即便 `default` 模式下也只是把 `Integer` 当业务类型查找定义同样失败。新增 `JAVA_SCALAR_TO_TS` 映射，`normalizeTypeExpression` 遇到这类标量直接映射为 TS 类型：

  | Java 类型 | TS 类型 |
  |---|---|
  | `Integer` / `Long` / `Short` / `Byte` / `BigInteger` / `BigDecimal` / `Float` / `Double` / `Number` | `number` |
  | `Boolean` | `boolean` |
  | `String` / `Character` / `CharSequence` | `string` |
  | `Void` | `void` |
  | `Object` | `any` |

#### 技术变更

- `generatorCommon.ts` `TS_BUILTIN_TYPE_NAMES` 新增 `List`、`Collection`
- `generatorCommon.ts` 新增 `JAVA_SCALAR_TO_TS` 映射表
- `generatorCommon.ts` `NamingConfig` 新增 `typeNameCasing` 字段；新导出 `resolveTypeNameCasing(naming)`
- `generatorCommon.ts` `writeControllers` 新增 `extractSharedTypes` 参数；引入 `SplitTypeMode` (`shared` / `localFile` / `inline`) 统一三种类型组织方式
- V2 / V3 `normalizeTypeIdentifier`、V2 `normalizeTypeExpr` 改用 `resolveTypeNameCasing(this.naming)` 而非 `methodNameCasing`
- V2 / V3 `generateBySplit` 改为接收 `splitMode` 字符串，内部推导 `byController` / `singleFile` / `typeMode`
- `generate()` 新增可选参数 `extractSharedTypes`
- `package.json` `configuration` 由单对象改为 7 个分区的数组

## [0.1.6] - 2026年5月22日

#### 新增 `byController` 输出拆分模式

`generator-ts-api.outputSplit` 新增第三个可选值 `byController`，在 `byTag` 基础上让每个控制器单独成一个文件夹。

| 值 | 目录结构 |
|---|---|
| `single` | 所有接口和类型生成到一个文件 |
| `byTag` | `types/index`、`controllers/用户.ts`、`controllers/订单.ts`、`index` |
| `byController` | `types/index`、`controllers/用户/index`、`controllers/订单/index`、`index` |

- `byTag` / `byController` 模式生成时要求选择输出**目录**，`single` 模式选择输出**文件**。
- `controllers/index` 的 `export * from "./用户"` 对扁平文件和文件夹均可解析，两种模式共用。

#### 新增「每个控制器独立类型文件」（`byController.localTypes`）

新增配置 `generator-ts-api.byController.localTypes`（布尔值，默认 `false`，仅 `byController` 模式生效）。

启用后不再生成共享的 `types/` 目录，而是在每个控制器文件夹内单独生成 `types.ts`，仅包含该控制器用到的类型**及其传递依赖**（通过类型定义间的标识符引用计算依赖闭包），控制器从 `./types` 按需引入，使每个控制器文件夹自成一体。

#### 新增「生成前清空旧输出」开关（`cleanOutputDir`）

新增配置 `generator-ts-api.cleanOutputDir`（布尔值，默认 `false`，仅 `byTag` / `byController` 模式生效）。

为 `true` 时，生成前会删除输出目录下由本插件生成的 类型目录、控制器目录 及根 `index` 文件，避免接口删除后残留旧文件。仅删除插件自身生成的目标，不影响输出目录中的其它文件。

#### 类型引入方式改为按需命名导入

旧版行为：`byTag` 控制器文件统一用命名空间导入 `import type * as Types from "../types"`，并在方法代码中为命中的类型名加 `Types.` 前缀。

新版行为：改为按需命名导入，只导入当前控制器实际用到的类型：

```typescript
// 旧
import type * as Types from "../types"
static getUser(...): Promise<Types.User> { ... }

// 新
import type { User } from "../types"
static getUser(...): Promise<User> { ... }
```

同时类型使用检测改为**按完整标识符匹配**（前后不接标识符字符），避免 `User` 误命中 `UserDetail` 之类的前缀重名类型而产生多余导入。

#### URL 支持自动拼接常见文档路径

「从 URL 生成」与配置的 `apiDocsUrl` 现在支持只填服务基础地址。若填写的 URL 不像文档端点（不含 `api-docs` / `swagger*.json` / `openapi*.json`），插件会依次尝试拼接常见路径：

```
/v3/api-docs   /v2/api-docs   /openapi.json
/swagger.json  /api-docs      /swagger/v1/swagger.json
```

逐个请求并校验返回内容确为 OpenAPI 3.x / Swagger 2.x 文档，命中第一个有效地址即用；Basic Auth 凭证在多个候选间复用；全部失败时错误信息会带上「已尝试 N 个候选地址」与最后一次失败原因。

#### 生成结果提示带数量统计

`byTag` / `byController` 生成成功后的提示由「API文档生成成功！」改为带统计：

> API 代码生成成功！共 N 个控制器、M 个类型，写入 K 个文件

#### Bug 修复

- **修复「输入新URL」始终无效**：`从 URL 生成` 命令中，选择「输入新URL」后弹出输入框，但 QuickPick 隐藏时触发的 `onDidHide` 会抢先 `resolve(undefined)`，导致输入的 URL 被丢弃 —— 表现为输入 URL 后既无 loading 也无错误提示。已通过 `suppressHideResolve` 标志修复。
- **修复从 URL 拉取 YAML 文档失败**：解析时对响应数据无条件 `JSON.stringify`，使 YAML 文本被包成字符串而永不被解析。改为按响应数据类型分支处理。

#### loading 提示统一与补全

- `从 URL 生成`：原本拉取 URL 这段最耗时的过程没有 loading，现改为命令一开始即显示「拉取 API 文档...」，生成阶段更新为「生成代码中...」。
- `从本地文件生成`：loading 提前到解析文件之前。
- `生成 API 代码`：生成阶段文案更新为「生成代码中...」。
- `生成 Request 模板文件`：补充了生成阶段的 loading 提示。

#### 调试日志

各命令入口、关键步骤与错误现在会输出到 VS Code「调试控制台」（`console.log` / `console.error`，统一带 `[generator-ts-api]` 前缀），URL 解析会打印候选地址列表与每个候选的请求结果，便于排查问题。

#### 技术变更

- `generatorCommon.ts` 新增 `extractUsedTypeNames`、`containsIdentifier`、`computeTypeClosure`、`cleanSplitOutputDir`、`writeControllers` 及 `SplitOutputResult` 接口
- V2 / V3 生成器抽取拆分写文件的重复逻辑到 `generatorCommon`，`generateByTag` 统一为 `generateBySplit`
- `generate()` 新增可选参数 `cleanOutputDir`、`byControllerLocalTypes`，并返回 `SplitOutputResult`
- `parser.ts` `parseFromUrl` 重构为多候选地址尝试
- `naming.controllersDirName` 默认值由 `modules` 修正为 `controllers`，与代码 fallback 保持一致
- `package.json` 所有命令标题与配置项描述重写，更清晰

## [0.1.5] - 2026年4月20日

#### 添加字符串字段枚举类型生成支持

- 引入 enumDefs 存储字符串枚举定义
- 实现 toConstKey 方法将枚举值转换为常量键名
- 添加 registerEnumDef 方法注册枚举定义
- 实现 buildEnumDefsCode 方法生成枚举代码
- 在属性类型生成中检测字符串枚举并自动生成
- 更新 V2 和 V3 生成器以支持枚举类型生成
- 添加枚举类型到输出文件中的独立代码块

#### 增强URL历史记录功能支持自定义名称和版本

- 将历史记录数据结构从字符串数组改为对象数组，支持存储名称和Swagger版本
- 添加历史记录管理界面，支持编辑、删除、复制等操作
- 实现向后兼容逻辑，支持旧版字符串数组格式转换
- 在生成API时自动记录Swagger版本信息
- 对对象属性进行排序以确保生成代码的一致性
- 优化请求参数处理逻辑，改进JSON和表单数据的处理方式

### [0.1.4] - 2026-03-11

#### 修复 Swagger 2 生成时部分类型“找不到定义”的问题

旧版行为：在 V2 类型生成中，先对 definition 名称做清洗后，再使用清洗结果回查 `definitions[...]`，当原始 key 含空格或特殊字符（如 `customer_base 对象`）时会回查失败，导致接口类型缺失并在方法签名中报找不到类型。

新版行为：改为遍历原始 `definitions` 条目生成类型定义，再输出规范化后的类型名，避免“清洗名索引原始字典”造成的丢类型问题。

#### 修复返回类型/泛型类型名包含空格导致的非法标识符问题

旧版行为：返回类型表达式在部分场景会保留空格或不规范符号（如 `Promise<接口返回对象<IPage<customer_base 对象>>>`），生成代码可能出现语法错误或类型名不一致。

新版行为：新增统一类型命名与表达式规范化能力：

- 新增 `normalizeIdentifierName`：默认将非法字符与空白替换为 `_`
- 新增 `normalizeTypeExpression`：统一处理 `«»《》` 泛型符号与类型表达式中的标识符清洗
- 覆盖 V2/V3 的返回类型、`$ref` 类型、schema title 类型场景，保证输出为合法 TS 标识符

#### 命名规则联动增强

- 当选择命名规则（`PascalCase` / `camelCase` / `kebab-case`）时，类型名会按所选规则归一化
- `default` 模式下继续保持兼容：不规范命名默认使用 `_` 替代

#### 测试补充

- 新增回归测试：验证类型表达式中空格与非法符号会被正确清洗（`customer_base 对象` -> `customer_base_对象`）

### [0.1.3] - 2026-03-10

#### 修复了路径参数后缀覆盖问题

旧版行为：在 generatorCommon.ts:559 中，buildUniqueMethodName 处理多个连续 path 参数时，原逻辑会把已生成的 By... 后缀覆盖掉。

新版行为：只在第一次遇到尾部参数时设置 By...，后续参数不再覆盖，保持旧版兼容命名。

### [0.1.2] - 2026-03-10

#### 修复方法名默认模式下特殊符号未清理的问题

旧版行为：当 `methodNameCasing` 为 `default` 时，路径中的特殊符号（如 `@`、`-`、`.` 等）会直接保留在生成的方法名中，导致生成的代码无法编译。

新版行为：默认模式下，方法名会统一经过 `sanitizeName` 处理，将非法字符替换为下划线 `_`。

示例：
- 路径 `/user-center/list@v2` → 旧版生成 `List@v2`（语法错误）→ 新版生成 `List_v2`
- 此修复同时确保方法名判重逻辑与最终输出一致，避免重名误判

#### 新增方法名命名风格配置（`naming.methodNameCasing`）

新增 `generator-ts-api.naming.methodNameCasing` 配置项，支持四种风格：

| 值 | 说明 | 示例 |
|---|---|---|
| `default`（默认） | 保持原始方法名，特殊符号替换为 `_` | `List_v2` |
| `PascalCase` | 大驼峰 | `CreatePaymentIntent` |
| `camelCase` | 小驼峰 | `createPaymentIntent` |
| `kebab-case` | 连字符 | `create-payment-intent` |

#### 新增直接替换 import 路径配置（`directReplacementRequestImportPath`）

新增 `generator-ts-api.directReplacementRequestImportPath` 配置项（布尔值，默认 `false`）。

启用后，生成代码文件顶部的 import 语句将**直接使用** `requestImportPath` 配置的完整内容，忽略 `httpClient` 模式的默认 import 生成逻辑。

适用场景：
- 项目使用非标准请求封装，需要完全自定义 import 语句
- 需要导入多个模块或使用特殊路径别名

示例配置：

```jsonc
{
  "generator-ts-api.directReplacementRequestImportPath": true,
  "generator-ts-api.requestImportPath": "import { request } from '@/services/http'"
}
```

生成代码顶部将直接输出：
```typescript
import { request } from '@/services/http'
```

---

### [0.1.1] - 2026-03-02

#### 修复 `byTag` 拆分后`Controller`引入类型问题

旧版：`import type {} from '../types'`

新版：`import type * as Types from "../types"`

- 类型导入改为命名空间形式：`import type * as Types from "../types"`（实际路径仍按配置的 [typesDirName](vscode-file://vscode-app/d:/toolSoft/Microsoft VS Code/072586267e/resources/app/out/vs/code/electron-browser/workbench/workbench.html) 生成）。
- 在控制器方法代码中，凡是命中 [types/index.ts](vscode-file://vscode-app/d:/toolSoft/Microsoft VS Code/072586267e/resources/app/out/vs/code/electron-browser/workbench/workbench.html) 导出的类型名，都会自动加 `Types.` 前缀（如 `User` → `Types.User`，`List<User>` → `Types.List<Types.User>`）。
- 仅影响 `byTag` 输出；single 模式逻辑未改。

#### 独立生成封装 Request 模板文件（新命令）

新增命令 `generator-ts-api.generateRequestTemplate`，通过向导式交互一键生成可直接使用的 `request.ts` / `request.js` 封装文件。

##### 交互步骤（4 步）

1. **选择 HTTP 客户端模式**：`axios-wrapper` / `axios` / `fetch`，默认高亮当前配置值
2. **填写 axios import 路径**（`fetch` 模式跳过）：预填配置中的路径，留空使用 `"axios"`
3. **选择输出文件类型**：`.ts` / `.js`，默认跟随 `outputType` 配置
4. **选择保存位置**：文件已存在时弹出确认覆盖对话框，不静默覆盖

##### 各模式生成内容对比

| 模式 | 生成内容亮点 |
|---|---|
| `axios-wrapper` | `RequestConfig` / `RequestOptions` interface、请求+响应拦截器（含 Token 注釋示例）、`getConfigs(method, contentType, url, options)` 函数、`request(configs, resolve, reject)` 包装函数、`export default request` |
| `axios` | axios 实例、请求+响应拦截器（含注释示例）、`export default instance` |
| `fetch` | `requestInterceptor` / `responseInterceptor` 异步函数、`fetchRequest<T>` 封装函数、`export default fetchRequest` |
| `custom` | 跳过（自定义模板模式无法自动生成）|

##### 生成示例（axios-wrapper + TypeScript）

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

#### 增强 generateRequestScaffold 模板内容

配置 `generator-ts-api.generateRequestScaffold: true` 后，自动生成的 `request.ts` 样板内容已与新命令保持一致，升级为含完整注释示例的富内容模板（不再是简单的 TODO 占位）：

- 请求拦截器含 Token 注入注释示例
- 响应拦截器含业务错误码处理注释示例（`axios-wrapper`）/ HTTP 状态码错误处理（`fetch`）
- `axios-wrapper` 模式的 `getConfigs` 包含完整类型签名

---

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

  // 方法名命名风格
  "generator-ts-api.naming.methodNameCasing": "default", // "PascalCase" | "camelCase" | "kebab-case"

  // HTTP 客户端模式
  "generator-ts-api.httpClient": "axios-wrapper", // "axios" | "fetch" | "custom"

  // request import 路径（留空时按模式自动填充默认值）
  "generator-ts-api.requestImportPath": "",

  // 为 true 时直接使用 requestImportPath 内容作为 import 片段
  "generator-ts-api.directReplacementRequestImportPath": false,

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
- `generatorCommon.ts` 新增 `buildRequestTemplateContent(mode, importPath, ext)` — 统一构建 request 模板内容字符串，供命令和自动生成共用
- `generatorCommon.ts` 重构 `generateRequestScaffoldFile(outputDir, cfg, ext)` — 改为调用 `buildRequestTemplateContent`，内容升级为富注释模板
- `extension.ts` 新增 `generateRequestTemplateCommand`（命令 `generateRequestTemplate`）— 向导式生成封装 request 文件，支持 4 步交互、文件存在确认覆盖
- `generatorV3.ts` / `generatorV2.ts`：`generate()` 新增可选第 7 参数 `httpClientConfig`；所有硬编码 import 行改为 `buildImportSnippet()` 动态生成；非 `axios-wrapper` 模式方法签名改为 `async`
- `extension.ts` 新增 `buildHttpClientConfig()` / `maybeGenerateScaffold()` 辅助函数，三个命令均已对接新配置
- `generatorCommon.ts` `HttpClientConfig` 新增 `directReplacementRequestImportPath` 字段；`buildImportSnippet()` 增加优先分支：为 `true` 时直接返回 `requestImportPath`
- `generatorCommon.ts` `NamingConfig` 新增 `methodNameCasing` 字段；`buildUniqueMethodName()` 重构为统一归一化逻辑
- `generatorV2.ts` / `generatorV3.ts`：`buildUniqueMethodName()` 调用新增 `naming` 参数传递

---

## 历史版本

### 初始功能（0.0.x）

- 从 URL 或本地文件解析 OpenAPI 3.x / Swagger 2.x 文档
- 生成 TypeScript / JavaScript API 代码，支持 `ts` / `js` 输出类型
- URL 历史记录（最多保留 10 条），支持快速选择历史 URL 重新生成
- 支持 Basic Auth 重试（HTTP 401 时弹出凭据输入框）
- 生成过程中状态栏显示 loading 动画
