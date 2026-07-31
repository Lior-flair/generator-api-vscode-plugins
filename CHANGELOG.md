# Change Log

All notable changes to the "generator-ts-api" extension will be documented in this file.

## [Unreleased]

### Added

- 新增 `generator-ts-api.naming.methodNamePathSuffixesEnabled` 开关，默认关闭以兼容旧版本。
- 新增 `generator-ts-api.naming.methodNamePathSuffixes` 后缀列表配置。
- 新增 `generator-ts-api.naming.methodNamePathSuffixScopes`，支持按 Controller 和 path 前缀定向启用稳定命名。
- 对 `list`、`detail`、`page`、CRUD、查询、状态切换、导入导出等常用 path 后缀，生成方法名时自动向前拼接一个 path 段。
- Swagger 2.x 与 OpenAPI 3.x 生成器使用相同命名规则。

### Changed

- static 方法名不再依赖同一 Controller 内接口的遍历顺序，生成结果更加稳定。

## [0.1.0] - 2026-02-28

- 支持 Swagger 2.x 与 OpenAPI 3.x。
- 支持单文件和按 Tag 拆分输出。
- 支持 axios-wrapper、axios、fetch 与自定义模板。
- 支持类型映射、请求样板和 Mock 数据生成。
