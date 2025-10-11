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

## 贡献指南

欢迎提交 Issue 和 Pull Request 来帮助改进这个项目。

## 许可证

MIT License


## 版本差异

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
