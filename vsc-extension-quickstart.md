# generator-ts-api 开发指南

## 环境要求

- Node.js 20.x
- VS Code 1.60 或更高版本
- npm

## 本地开发

```bash
npm install
npm run compile
```

在 VS Code 中按 `F5` 启动 Extension Development Host，然后从命令面板执行：

- `生成 API 代码`
- `从 URL 生成 API 代码`
- `从文件生成 API 代码`
- `生成 Mock 数据`

修改 TypeScript 源码时可运行：

```bash
npm run watch
```

## 验证

```bash
npm run compile
node test-generators.js
```

测试覆盖 Swagger 2.x、OpenAPI 3.x、单文件/按 Tag 输出、HTTP 客户端模式、类型映射、Mock 生成以及 static 方法名唯一性规则。

## 打包

```bash
npm run build
```

发布前应确认：

- `package.json` 中的配置声明与 `README.md`、`Releases.md`、`Example.md` 一致。
- `npm run compile` 无 TypeScript 错误。
- `node test-generators.js` 全部通过。
- 新增配置具备默认值、说明和回归测试。
