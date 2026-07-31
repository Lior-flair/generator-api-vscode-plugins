# 命名规则

本文档说明 `generator-ts-api.naming.*` 相关配置如何影响生成结果。

## 文件夹命名

相关配置：

```json
{
  "generator-ts-api.naming.typesDirName": "types",
  "generator-ts-api.naming.controllersDirName": "controllers"
}
```

影响：

- `typesDirName`：共享类型目录名，默认 `types`
- `controllersDirName`：Controller 输出目录名，默认 `controllers`

示例：

```text
byTag:
  types/
  controllers/User.ts

byController:
  types/
  controllers/User/index.ts

byControllerSingleFile:
  controllers/User.ts
```

## Controller 文件命名

相关配置：

```json
{
  "generator-ts-api.naming.controllerFileNameCasing": "default",
  "generator-ts-api.naming.controllerClassNameSuffix": "",
  "generator-ts-api.naming.controllerNameStrategy": "tagName",
  "generator-ts-api.naming.controllerNameMap": {},
  "generator-ts-api.naming.skipDuplicateControllerClassNameSuffix": true
}
```

影响：

- `byTag`：`controllers/{fileName}.ts`
- `byController`：`controllers/{fileName}/index.ts`
- `byControllerSingleFile`：`controllers/{fileName}.ts`

命名来源：

- `tagName`：使用 `apiDocs.tags[].name`，保持旧版行为
- `tagDescription`：优先使用 `apiDocs.tags[].description`
- `auto`：当 `tags.name` 含中文且 `tags.description` 是英文标识风格时使用 description
- `controllerNameMap`：手动映射，优先级最高

命名风格：

- `default`：保留名称结构，仅清理特殊符号
- `PascalCase`：大驼峰
- `camelCase`：小驼峰
- `kebab-case`：连字符

所有命名来源都会先清理空格、点号等特殊符号，再生成文件名和 Class 名。

## Controller Class 命名

Controller Class 与 Controller 文件名共用命名来源和 suffix 配置。

示例：

```json
{
  "generator-ts-api.naming.controllerNameStrategy": "auto",
  "generator-ts-api.naming.controllerFileNameCasing": "PascalCase",
  "generator-ts-api.naming.controllerClassNameSuffix": "Controller",
  "generator-ts-api.naming.skipDuplicateControllerClassNameSuffix": true
}
```

如果后端文档为：

```json
{
  "name": "用户管理",
  "description": "UserController"
}
```

则 `auto` 会使用 `UserController`。当 suffix 已经存在时不会重复追加，因此不会生成 `UserControllerController`。

## Interface / Type 命名

相关配置：

```json
{
  "generator-ts-api.naming.typeNameCasing": "follow"
}
```

可选值：

- `follow`：跟随 `methodNameCasing`
- `default`：保留后端 schema/type 原始名称，仅清理非法字符
- `PascalCase`：大驼峰，推荐用于 TypeScript 类型
- `camelCase`：小驼峰
- `kebab-case`：连字符，会转为合法 TypeScript 标识符

影响：

- `interface` 名
- `type` 名
- 类型表达式中的自定义类型标识符
- 枚举类型名

## Method 命名

相关配置：

```json
{
  "generator-ts-api.naming.methodNameCasing": "default"
}
```

方法名主要从 path / operationId 推导，并做冲突处理。

示例：

```text
/user-center/list@v2
```

`default` 下会清理特殊符号：

```ts
List_v2
```

### 通用 path 后缀稳定命名

默认关闭，以保证升级后已有项目的方法名不变：

```jsonc
{
  "generator-ts-api.naming.methodNamePathSuffixesEnabled": false
}
```

可按原始 OpenAPI Tag/Controller 和 path 前缀定向开启：

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

作用域命中时，方法名使用 `pathPrefix` 后的完整静态路径：

```text
/mobile-api/billing/application/detail → BillingApplicationDetail
/mobile-api/billing/title/detail       → BillingTitleDetail
/mobile-api/order/detail               → OrderDetail
/mobile-api/billing/order/page         → BillingOrderPage
/mobile-api/order/page                 → OrderPage
```

规则说明：

- `controller` 匹配原始 `tags.name` 或清理特殊字符后的 Controller key，不受英文类名映射影响。
- `pathPrefix` 按完整路径段匹配，`/mobile-api` 不会误匹配 `/mobile-api-v2`。
- 后缀匹配不区分大小写。
- 配置了作用域时，只有 Controller 与 path 前缀同时匹配才处理。
- 作用域为 `[]` 时，新规则对所有 Controller 生效，并默认向前取一个静态 path 段。
- 最终结果继续应用 `methodNameCasing`。
- 关闭开关后完全使用旧版冲突处理逻辑。

## Params Interface 命名

当前没有单独配置。参数类型名优先只使用 Method 名：

```ts
export interface GetListParams {}
```

当不同 Controller 下生成了相同 Method 名时，为了避免类型名冲突，才会追加 Controller 前缀：

```ts
export interface UserControllerListParams {}
export interface OrderControllerListParams {}
```

Controller 前缀会跟随 `controllerNameStrategy` 的最终结果。比如 `auto` 命中 `tags[].description` 时，参数类型前缀也会使用 description 清洗后的英文命名，而不是原始中文 `tags[].name`。

受以下配置间接影响：

- Controller 命名策略
- Controller suffix
- Method 命名风格
- Type 命名风格

补充：V3 生成器多数场景会内联参数对象，不一定生成独立的 `Params` interface。

## 固定文件名

以下文件名目前固定，不受命名配置影响：

- `index.ts` / `index.js`
- `request.ts` / `request.js`
- `types/index.ts`
- `controllers/index.ts`

## 常见配置

中文 tag 使用英文 description 生成文件名和 Class 名：

```json
{
  "generator-ts-api.naming.controllerNameStrategy": "auto",
  "generator-ts-api.naming.controllerFileNameCasing": "PascalCase",
  "generator-ts-api.naming.controllerClassNameSuffix": "Controller",
  "generator-ts-api.naming.skipDuplicateControllerClassNameSuffix": true
}
```

后端 name/description 都不规范时手动映射：

```json
{
  "generator-ts-api.naming.controllerNameMap": {
    "用户管理": "UserController",
    "订单管理": "OrderController"
  }
}
```
