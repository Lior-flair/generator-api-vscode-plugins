/** 生成器通用命名配置 */
export interface NamingConfig {
  typesDirName: string
  controllersDirName: string
  controllerFileNameCasing: "default" | "PascalCase" | "camelCase" | "kebab-case"
  controllerClassNameSuffix: string
  methodNameCasing: "default" | "PascalCase" | "camelCase" | "kebab-case"
}

export const DEFAULT_NAMING: NamingConfig = {
  typesDirName: "types",
  controllersDirName: "controllers",
  controllerFileNameCasing: "default",
  controllerClassNameSuffix: "",
  methodNameCasing: "default",
}

export function sanitizeName(name: string): string {
  return String(name).replace(/[^\u4e00-\u9fa5a-zA-Z0-9_]/g, "_")
}

const TS_BUILTIN_TYPE_NAMES = new Set([
  "string",
  "number",
  "boolean",
  "any",
  "unknown",
  "never",
  "void",
  "null",
  "undefined",
  "object",
  "true",
  "false",
  "Date",
  "Blob",
  "File",
  "Record",
  "Array",
  "Promise",
  "Map",
  "Set",
  "readonly",
  "keyof",
  "infer",
  "extends",
  "as",
])

export function normalizeIdentifierName(
  name: string,
  casing: NamingConfig["methodNameCasing"] = "default"
): string {
  const normalized = sanitizeName(String(name).trim().replace(/\s+/g, "_"))
  if (!normalized) return "_"
  if (casing === "PascalCase") return toPascalCase(normalized)
  if (casing === "camelCase") return toCamelCase(normalized)
  if (casing === "kebab-case") return toKebabCase(normalized).replace(/-/g, "_")
  return normalized
}

export function normalizeTypeExpression(
  typeExpr: string,
  casing: NamingConfig["methodNameCasing"] = "default"
): string {
  const normalizedBrackets = String(typeExpr)
    .replace(/[«《]/g, "<")
    .replace(/[»》]/g, ">")

  return normalizedBrackets.replace(/[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5\s-]*/g, (segment) => {
    const token = segment.trim().replace(/\s+/g, "_")
    if (!token) return segment
    if (TS_BUILTIN_TYPE_NAMES.has(token)) return token
    return normalizeIdentifierName(token, casing)
  })
}

export function toPascalCase(s: string): string {
  return s
    .replace(/[-_]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (_, c: string) => c.toUpperCase())
}

export function toCamelCase(s: string): string {
  const p = toPascalCase(s)
  return p.charAt(0).toLowerCase() + p.slice(1)
}

export function toKebabCase(s: string): string {
  return toPascalCase(s)
    .replace(/([A-Z])/g, (m, c: string, offset: number) => (offset === 0 ? c.toLowerCase() : "-" + c.toLowerCase()))
}

export function applyFileCasing(s: string, casing: NamingConfig["controllerFileNameCasing"]): string {
  if (casing === "default") return s
  if (casing === "kebab-case") return toKebabCase(s)
  if (casing === "camelCase") return toCamelCase(s)
  return toPascalCase(s)
}

export function buildControllerNames(controllerKey: string, naming: NamingConfig): { className: string; fileName: string } {
  const classBase = naming.controllerFileNameCasing === "default"
    ? sanitizeName(controllerKey)
    : toPascalCase(controllerKey)
  const className = naming.controllerFileNameCasing === "default"
    ? sanitizeName(classBase + naming.controllerClassNameSuffix)
    : classBase + naming.controllerClassNameSuffix
  const fileBase = applyFileCasing(controllerKey, naming.controllerFileNameCasing)
  const fileName = fileBase + (naming.controllerClassNameSuffix
    ? applyFileCasing(naming.controllerClassNameSuffix, naming.controllerFileNameCasing)
    : "")
  return { className, fileName }
}

export function getOperationId(path: string, method: string): string {
  const pathParts = path.split("/").filter(Boolean)
  const lastPart = pathParts[pathParts.length - 1] || ""
  return `${method.toLowerCase()}${lastPart.charAt(0).toUpperCase() + lastPart.slice(1)}`
}

export function getControllerMethodNameSet(controllerName: string): Set<string> {
  if (!(globalThis as any)._controllerMethodNames) {
    ;(globalThis as any)._controllerMethodNames = {}
  }
  if (!(globalThis as any)._controllerMethodNames[controllerName]) {
    ;(globalThis as any)._controllerMethodNames[controllerName] = new Set()
  }
  return (globalThis as any)._controllerMethodNames[controllerName] as Set<string>
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP 客户端配置
// ─────────────────────────────────────────────────────────────────────────────

/** 支持的 HTTP 客户端模式 */
export type HttpClientMode = "axios" | "axios-wrapper" | "fetch" | "custom"

/** 生成结果兼容目标版本 */
export type CompatibilityVersion = "latest" | "0.0.x"

/** OpenAPI/Swagger 标量格式映射 */
export type FormatTypeMappings = Record<string, string>

const DEFAULT_FORMAT_TYPE_MAPPINGS: FormatTypeMappings = {
  int64: "string",
  "date-time": "string",
  binary: "Blob",
}

const LEGACY_0_0_X_FORMAT_TYPE_MAPPINGS: FormatTypeMappings = {
  int64: "number",
  "date-time": "string",
  binary: "string",
}

export interface HttpClientConfig {
  /** 客户端模式 */
  mode: HttpClientMode
  /** import 路径；axios 默认 'axios'，axios-wrapper 默认 '@/utils/request'，fetch 留空，custom 必填 */
  requestImportPath: string
  /** 为 true 时直接使用 requestImportPath 内容作为 import 片段，忽略 mode 的默认 import 生成逻辑 */
  directReplacementRequestImportPath?: boolean
  /** 是否在输出目录生成 request.ts 样板文件（仅首次，不覆盖） */
  generateRequestScaffold: boolean
  /** 自定义模板文件路径（优先于 customTemplateString） */
  customTemplateFile?: string
  /** 自定义内联模板字符串；占位符：{{method}} {{METHOD}} {{url}} {{params}} {{body}} {{returnType}} {{methodName}} {{contentType}} */
  customTemplateString?: string
  /** 生成结果兼容目标版本（latest 默认；0.0.x 兼容旧版类型行为） */
  compatibilityVersion?: CompatibilityVersion
  /** 额外格式映射（会覆盖默认映射），例如：{ "date-time": "Date" } */
  formatTypeMappings?: FormatTypeMappings
}

export const DEFAULT_HTTP_CLIENT_CONFIG: HttpClientConfig = {
  mode: "axios-wrapper",
  requestImportPath: "@/utils/request",
  directReplacementRequestImportPath: false,
  generateRequestScaffold: false,
  compatibilityVersion: "latest",
  formatTypeMappings: {},
}

export function resolveFormatTypeMappings(cfg: HttpClientConfig): FormatTypeMappings {
  const compatibilityVersion = cfg.compatibilityVersion || "latest"
  const base = compatibilityVersion === "0.0.x"
    ? LEGACY_0_0_X_FORMAT_TYPE_MAPPINGS
    : DEFAULT_FORMAT_TYPE_MAPPINGS
  return {
    ...base,
    ...(cfg.formatTypeMappings || {}),
  }
}

/**
 * 根据 schema.type + schema.format 查找可映射的 TypeScript 类型。
 * 返回 undefined 表示未命中映射，应按原有逻辑继续推断。
 */
export function resolveMappedScalarType(
  cfg: HttpClientConfig,
  schemaType?: string | string[],
  schemaFormat?: string | string[]
): string | undefined {
  const normalizedType = Array.isArray(schemaType) ? schemaType[0] : schemaType
  const normalizedFormat = Array.isArray(schemaFormat) ? schemaFormat[0] : schemaFormat
  if (!normalizedFormat) return undefined
  const mappings = resolveFormatTypeMappings(cfg)
  const mapped = mappings[String(normalizedFormat).toLowerCase()]
  if (!mapped) return undefined

  // 若显式声明 type 且明显不属于标量，避免误映射
  if (normalizedType && ["array", "object"].includes(normalizedType)) {
    return undefined
  }
  return mapped
}

/**
 * 根据 HttpClientConfig 生成 import 代码段（插入到生成文件顶部）
 */
export function buildImportSnippet(cfg: HttpClientConfig): string {
  if (cfg.directReplacementRequestImportPath) {
    return (cfg.requestImportPath || "").trim()
  }
  switch (cfg.mode) {
    case "axios":
      return `import axios from '${cfg.requestImportPath || "axios"}'`
    case "fetch":
      return ""
    case "custom":
      return (cfg.requestImportPath || "").trim()
    case "axios-wrapper":
    default:
      return `import request, { getConfigs, type RequestConfig } from "${cfg.requestImportPath || "@/utils/request"}"`
  }
}

/**
 * 为 axios / fetch / custom 模式生成方法体内容（不含 static 签名包裹）。
 * axios-wrapper 模式返回空字符串，调用方使用自有模板。
 */
export function buildMethodBody(
  cfg: HttpClientConfig,
  method: string,
  processedPath: string,
  requestBody: string,
  requestContentType: string,
  returnType: string,
  methodName: string
): string {
  const upperMethod = method.toUpperCase()
  switch (cfg.mode) {
    case "axios": {
      const isGetLike = ["GET", "DELETE", "HEAD"].includes(upperMethod)
      if (isGetLike) {
        return `return axios.${method.toLowerCase()}(\`${processedPath}\`, { params }).then((r: any) => r.data as ${returnType})`
      }
      const bodyRef = requestBody
        ? 'params["body"]'
        : requestContentType === "multipart/form-data"
        ? 'params["formData"]'
        : "params"
      return `return axios.${method.toLowerCase()}(\`${processedPath}\`, ${bodyRef}, { params }).then((r: any) => r.data as ${returnType})`
    }
    case "fetch": {
      const isGetLike = ["GET", "DELETE", "HEAD"].includes(upperMethod)
      if (isGetLike) {
        return (
          `const _qs = new URLSearchParams(params as any).toString()\n` +
          `    return fetch(\`${processedPath}\${_qs ? '?' + _qs : ''}\`).then(r => r.json()) as Promise<${returnType}>`
        )
      }
      const bodyRef = requestBody
        ? 'params["body"]'
        : requestContentType === "multipart/form-data"
        ? 'params["formData"]'
        : "params"
      return (
        `return fetch(\`${processedPath}\`, {\n` +
        `      method: '${upperMethod}',\n` +
        `      body: JSON.stringify(${bodyRef}),\n` +
        `      headers: { 'Content-Type': '${requestContentType || "application/json"}' }\n` +
        `    }).then(r => r.json()) as Promise<${returnType}>`
      )
    }
    case "custom": {
      let template = ""
      if (cfg.customTemplateFile) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const fs = require("fs")
          template = fs.readFileSync(cfg.customTemplateFile, "utf-8")
        } catch {
          template = cfg.customTemplateString || ""
        }
      } else {
        template = cfg.customTemplateString || ""
      }
      if (!template) return "    // custom template not configured"
      return template
        .replace(/\{\{method\}\}/g, method.toLowerCase())
        .replace(/\{\{METHOD\}\}/g, upperMethod)
        .replace(/\{\{url\}\}/g, processedPath)
        .replace(/\{\{params\}\}/g, "params")
        .replace(/\{\{body\}\}/g, requestBody ? 'params["body"]' : "params")
        .replace(/\{\{returnType\}\}/g, returnType)
        .replace(/\{\{methodName\}\}/g, methodName)
        .replace(/\{\{contentType\}\}/g, requestContentType || "application/json")
    }
    default:
      return "" // axios-wrapper：调用方使用内联模板
  }
}

/**
 * 根据 HTTP 客户端模式构建 request 模板文件内容字符串
 */
export function buildRequestTemplateContent(mode: HttpClientMode, importPath: string, ext: string = "ts"): string {
  const isTs = ext !== "js"
  switch (mode) {
    case "axios-wrapper": {
      const imp = importPath || "axios"
      if (isTs) {
        return [
          `import axios, { type AxiosRequestConfig, type AxiosResponse, type InternalAxiosRequestConfig, type Method } from '${imp}'`,
          ``,
          `export interface RequestConfig extends AxiosRequestConfig {`,
          `  // 可在此扩展自定义请求配置字段`,
          `}`,
          ``,
          `export interface RequestOptions extends AxiosRequestConfig {`,
          `  // 可在此扩展自定义请求选项字段`,
          `}`,
          ``,
          `const instance = axios.create({`,
          `  baseURL: '',`,
          `  timeout: 10000,`,
          `})`,
          ``,
          `// ── 请求拦截器 ──────────────────────────────────────────────────────────────`,
          `instance.interceptors.request.use(`,
          `  (config: InternalAxiosRequestConfig) => {`,
          `    // 在此添加请求前的处理逻辑，例如注入 Token`,
          `    // const token = localStorage.getItem('token')`,
          `    // if (token) config.headers['Authorization'] = \`Bearer \${token}\``,
          `    return config`,
          `  },`,
          `  (error) => Promise.reject(error)`,
          `)`,
          ``,
          `// ── 响应拦截器 ──────────────────────────────────────────────────────────────`,
          `instance.interceptors.response.use(`,
          `  (response: AxiosResponse) => {`,
          `    // 统一处理响应，例如只返回 data 字段，或检查业务错误码`,
          `    // const { code, message, data } = response.data`,
          `    // if (code !== 0) return Promise.reject(new Error(message))`,
          `    // return data`,
          `    return response.data`,
          `  },`,
          `  (error) => {`,
          `    // 统一处理 HTTP 错误，例如 401 跳转登录页`,
          `    // if (error.response?.status === 401) location.href = '/login'`,
          `    return Promise.reject(error)`,
          `  }`,
          `)`,
          ``,
          `/**`,
          ` * 构建请求配置对象（由生成的 API 代码调用）`,
          ` */`,
          `export function getConfigs(`,
          `  method: Method,`,
          `  contentType: string,`,
          `  url: string,`,
          `  options: RequestOptions = {}`,
          `): RequestConfig {`,
          `  return {`,
          `    method,`,
          `    url,`,
          `    headers: {`,
          `      'Content-Type': contentType,`,
          `      ...(options.headers || {}),`,
          `    },`,
          `    ...options,`,
          `  }`,
          `}`,
          ``,
          `/**`,
          ` * 发起请求（由生成的 API 代码调用）`,
          ` */`,
          `function request(`,
          `  configs: AxiosRequestConfig,`,
          `  resolve: (value: any) => void,`,
          `  reject: (reason?: any) => void`,
          `): void {`,
          `  instance(configs).then(resolve).catch(reject)`,
          `}`,
          ``,
          `export default request`,
          ``,
        ].join("\n")
      } else {
        return [
          `import axios from '${imp}'`,
          ``,
          `const instance = axios.create({`,
          `  baseURL: '',`,
          `  timeout: 10000,`,
          `})`,
          ``,
          `// 请求拦截器`,
          `instance.interceptors.request.use(`,
          `  (config) => {`,
          `    // const token = localStorage.getItem('token')`,
          `    // if (token) config.headers['Authorization'] = \`Bearer \${token}\``,
          `    return config`,
          `  },`,
          `  (error) => Promise.reject(error)`,
          `)`,
          ``,
          `// 响应拦截器`,
          `instance.interceptors.response.use(`,
          `  (response) => {`,
          `    return response.data`,
          `  },`,
          `  (error) => Promise.reject(error)`,
          `)`,
          ``,
          `/** 构建请求配置对象 */`,
          `export function getConfigs(method, contentType, url, options = {}) {`,
          `  return {`,
          `    method,`,
          `    url,`,
          `    headers: { 'Content-Type': contentType, ...(options.headers || {}) },`,
          `    ...options,`,
          `  }`,
          `}`,
          ``,
          `/** 发起请求 */`,
          `function request(configs, resolve, reject) {`,
          `  instance(configs).then(resolve).catch(reject)`,
          `}`,
          ``,
          `export default request`,
          ``,
        ].join("\n")
      }
    }
    case "axios": {
      const imp = importPath || "axios"
      if (isTs) {
        return [
          `import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from '${imp}'`,
          ``,
          `const instance = axios.create({`,
          `  baseURL: '',`,
          `  timeout: 10000,`,
          `})`,
          ``,
          `// ── 请求拦截器 ──────────────────────────────────────────────────────────────`,
          `instance.interceptors.request.use(`,
          `  (config: InternalAxiosRequestConfig) => {`,
          `    // const token = localStorage.getItem('token')`,
          `    // if (token) config.headers['Authorization'] = \`Bearer \${token}\``,
          `    return config`,
          `  },`,
          `  (error) => Promise.reject(error)`,
          `)`,
          ``,
          `// ── 响应拦截器 ──────────────────────────────────────────────────────────────`,
          `instance.interceptors.response.use(`,
          `  (response: AxiosResponse) => {`,
          `    // return response.data`,
          `    return response`,
          `  },`,
          `  (error) => {`,
          `    // if (error.response?.status === 401) location.href = '/login'`,
          `    return Promise.reject(error)`,
          `  }`,
          `)`,
          ``,
          `export default instance`,
          ``,
        ].join("\n")
      } else {
        return [
          `import axios from '${imp}'`,
          ``,
          `const instance = axios.create({`,
          `  baseURL: '',`,
          `  timeout: 10000,`,
          `})`,
          ``,
          `// 请求拦截器`,
          `instance.interceptors.request.use(`,
          `  (config) => {`,
          `    // const token = localStorage.getItem('token')`,
          `    // if (token) config.headers['Authorization'] = \`Bearer \${token}\``,
          `    return config`,
          `  },`,
          `  (error) => Promise.reject(error)`,
          `)`,
          ``,
          `// 响应拦截器`,
          `instance.interceptors.response.use(`,
          `  (response) => response,`,
          `  (error) => Promise.reject(error)`,
          `)`,
          ``,
          `export default instance`,
          ``,
        ].join("\n")
      }
    }
    case "fetch": {
      if (isTs) {
        return [
          `// ── 请求拦截器 ──────────────────────────────────────────────────────────────`,
          `async function requestInterceptor(`,
          `  url: string,`,
          `  options: RequestInit`,
          `): Promise<[string, RequestInit]> {`,
          `  // 在此添加请求前的处理逻辑，例如注入 Token`,
          `  // const token = localStorage.getItem('token')`,
          `  // if (token) options.headers = { ...options.headers, Authorization: \`Bearer \${token}\` }`,
          `  return [url, options]`,
          `}`,
          ``,
          `// ── 响应拦截器 ──────────────────────────────────────────────────────────────`,
          `async function responseInterceptor<T>(response: Response): Promise<T> {`,
          `  if (!response.ok) {`,
          `    throw new Error(\`HTTP error! status: \${response.status} \${response.statusText}\`)`,
          `  }`,
          `  return response.json() as Promise<T>`,
          `}`,
          ``,
          `/**`,
          ` * 封装 fetch 请求`,
          ` */`,
          `export async function fetchRequest<T>(url: string, options: RequestInit = {}): Promise<T> {`,
          `  const [finalUrl, finalOptions] = await requestInterceptor(url, options)`,
          `  const response = await fetch(finalUrl, finalOptions)`,
          `  return responseInterceptor<T>(response)`,
          `}`,
          ``,
          `export default fetchRequest`,
          ``,
        ].join("\n")
      } else {
        return [
          `// 请求拦截器`,
          `async function requestInterceptor(url, options) {`,
          `  // const token = localStorage.getItem('token')`,
          `  // if (token) options.headers = { ...options.headers, Authorization: \`Bearer \${token}\` }`,
          `  return [url, options]`,
          `}`,
          ``,
          `// 响应拦截器`,
          `async function responseInterceptor(response) {`,
          `  if (!response.ok) throw new Error(\`HTTP error! status: \${response.status}\`)`,
          `  return response.json()`,
          `}`,
          ``,
          `/** 封装 fetch 请求 */`,
          `export async function fetchRequest(url, options = {}) {`,
          `  const [finalUrl, finalOptions] = await requestInterceptor(url, options)`,
          `  const response = await fetch(finalUrl, finalOptions)`,
          `  return responseInterceptor(response)`,
          `}`,
          ``,
          `export default fetchRequest`,
          ``,
        ].join("\n")
      }
    }
    default:
      return ""
  }
}

/**
 * 在 outputDir 生成 request.ts 样板文件（文件已存在时跳过，不覆盖）
 */
export function generateRequestScaffoldFile(outputDir: string, cfg: HttpClientConfig, ext: string = "ts"): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path")
  const scaffoldPath = path.join(outputDir, `request.${ext}`)
  if (fs.existsSync(scaffoldPath)) return // 不覆盖已有文件

  const content = buildRequestTemplateContent(cfg.mode, cfg.requestImportPath, ext)
  if (!content) return // custom 模式跳过

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(scaffoldPath, content, "utf-8")
}

export function buildUniqueMethodName(path: string, controllerName: string, method: string, operationId?: string, naming?: NamingConfig): string {
  const usedNames = getControllerMethodNameSet(controllerName)
  const useDefaultCasing = !naming || naming.methodNameCasing === "default"
  const normalizeMethodName = (name: string): string => {
    if (useDefaultCasing) return sanitizeName(name)
    return applyFileCasing(name, naming.methodNameCasing)
  }
  const pathParts = path.split("/").filter(Boolean)
  let partStartIndex = pathParts.length > 0 ? pathParts.length - 1 : -1
  const partsIndex: number[] = []
  const isParam = (part: string) => /^\{.+\}$/.test(part)
  let bySuffix = ""

  while (partStartIndex >= 0) {
    const part = pathParts[partStartIndex]
    if (isParam(part)) {
      partStartIndex--
      const paramName = part.replace(/[{}]/g, "")
      if (!bySuffix) {
        bySuffix = "By" + paramName.charAt(0).toUpperCase() + paramName.slice(1)
      }
    } else {
      partsIndex.unshift(partStartIndex)
      const rawCandidate =
        partsIndex
          .map((item) => {
            const str = pathParts[item] || ""
            if (!str) return ""
            return str.charAt(0).toUpperCase() + str.slice(1)
          })
          .join("") + bySuffix
      const candidate = normalizeMethodName(rawCandidate)
      if (usedNames.has(`${controllerName}.${candidate}`)) {
        partStartIndex--
      } else {
        partStartIndex = -1
      }
    }
  }

  let methodName =
    partsIndex
      .map((item) => {
        const str = pathParts[item] || ""
        if (!str) return ""
        return str.charAt(0).toUpperCase() + str.slice(1)
      })
      .join("") + bySuffix

  methodName = normalizeMethodName(methodName)

  if (!methodName || usedNames.has(`${controllerName}.${methodName}`)) {
    methodName = normalizeMethodName(operationId || getOperationId(path, method))
  }

  usedNames.add(`${controllerName}.${methodName}`)
  return methodName
}

// ─────────────────────────────────────────────────────────────────────────────
// 多文件拆分输出（byTag / byController）公共逻辑
// ─────────────────────────────────────────────────────────────────────────────

/** 标识符可用字符集（含字母、数字、下划线、中文），用于按完整标识符匹配 */
const IDENTIFIER_WORD_CHARS = "A-Za-z0-9_\\u4e00-\\u9fa5"

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** 判断 code 中是否以完整标识符形式出现 name（前后不接标识符字符） */
export function containsIdentifier(code: string, name: string): boolean {
  if (!name) return false
  const re = new RegExp(
    `(?<![${IDENTIFIER_WORD_CHARS}])${escapeRegExp(name)}(?![${IDENTIFIER_WORD_CHARS}])`
  )
  return re.test(code)
}

/** 从代码中提取实际用到的候选类型名（按完整标识符匹配，避免前缀重名误命中） */
export function extractUsedTypeNames(code: string, candidates: string[]): string[] {
  return candidates
    .filter((name) => containsIdentifier(code, name))
    .sort((a, b) => a.localeCompare(b))
}

/**
 * 从种子类型出发，计算其在 typeDefs 中的传递依赖闭包。
 * 用于 byController 本地类型模式：控制器只需带上自己用到的类型及其引用到的类型。
 */
export function computeTypeClosure(seed: string[], typeDefs: Map<string, string>): string[] {
  const allNames = Array.from(typeDefs.keys())
  const result = new Set<string>()
  const queue = seed.filter((n) => typeDefs.has(n))
  while (queue.length > 0) {
    const name = queue.shift() as string
    if (result.has(name)) continue
    result.add(name)
    const def = typeDefs.get(name) || ""
    for (const candidate of allNames) {
      if (result.has(candidate) || candidate === name) continue
      if (containsIdentifier(def, candidate)) queue.push(candidate)
    }
  }
  return Array.from(result).sort((a, b) => a.localeCompare(b))
}

/** 拆分输出生成结果统计 */
export interface SplitOutputResult {
  /** 生成的控制器数量 */
  controllerCount: number
  /** 类型定义数量 */
  typeCount: number
  /** 实际写入的文件数量 */
  fileCount: number
}

/**
 * 清理上一次拆分输出（仅删除本插件生成的目录/文件，不动用户其它文件）。
 * 删除目标：{typesDirName}/、{controllersDirName}/、根 index.ts、根 index.js。
 */
export function cleanSplitOutputDir(outputDir: string, naming: NamingConfig): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path")
  const targets = [
    path.join(outputDir, naming.typesDirName),
    path.join(outputDir, naming.controllersDirName),
    path.join(outputDir, "index.ts"),
    path.join(outputDir, "index.js"),
  ]
  for (const target of targets) {
    try {
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true })
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * 拆分输出时类型的组织方式：
 *  - shared：所有控制器共享一个 {typesDirName} 目录（byTag / 默认 byController）
 *  - localFile：每个控制器文件夹内单独生成 types 文件（byController + localTypes）
 *  - inline：类型定义直接内联进控制器自身文件（byControllerSingleFile）
 */
export type SplitTypeMode = "shared" | "localFile" | "inline"

/** writeControllers 入参 */
export interface WriteControllersParams {
  /** 输出根目录 */
  outputDir: string
  /** 控制器目录（通常为 outputDir/{controllersDirName}） */
  controllersDir: string
  /** 文件扩展名（ts / js） */
  ext: string
  /** 是否每个控制器独立文件夹（仅 byController 模式为 true） */
  byController: boolean
  naming: NamingConfig
  httpClientConfig: HttpClientConfig
  /** controllerKey -> 该控制器的方法代码片段数组 */
  controllers: Map<string, string[]>
  /** 根据 controllerKey 返回控制器描述文本 */
  describe: (controllerKey: string) => string
  /** 全部可作为类型导入的候选类型名 */
  typeImportCandidates: string[]
  /** 类型组织方式 */
  typeMode: SplitTypeMode
  /** localFile / inline 模式需要：类型名 -> 类型定义代码 */
  typeDefMap?: Map<string, string>
  /**
   * 仅 inline 模式有效：为 true 时，被两个及以上控制器共用的类型会被抽离到
   * 共享 {typesDirName} 目录，控制器文件改为 import；仅被单个控制器使用的
   * 类型仍内联在该控制器文件内，避免共用类型在多个文件中重复。
   */
  extractSharedTypes?: boolean
}

/**
 * 写入各 Controller 文件、controllers/index 与根 index。
 * 返回控制器数量与写入文件数量。
 */
export function writeControllers(
  params: WriteControllersParams
): { controllerCount: number; fileCount: number } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path")
  const {
    outputDir,
    controllersDir,
    ext,
    byController,
    naming,
    httpClientConfig,
    controllers,
    describe,
    typeImportCandidates,
    typeMode,
    typeDefMap,
    extractSharedTypes,
  } = params
  const defs = typeDefMap || new Map<string, string>()

  if (!fs.existsSync(controllersDir)) fs.mkdirSync(controllersDir, { recursive: true })

  // 共享类型模式下，控制器文件到 {typesDirName} 目录的相对路径
  const sharedTypesImportPath = byController
    ? `../../${naming.typesDirName}`
    : `../${naming.typesDirName}`

  // inline + 抽离共享类型：先统计每个类型被多少个控制器使用，得出「共享类型集」
  const inlineExtract = typeMode === "inline" && extractSharedTypes === true && ext === "ts"
  const closureCache = new Map<string, string[]>()
  const sharedTypeNames = new Set<string>()
  if (inlineExtract) {
    const usageCount = new Map<string, number>()
    for (const [key, methods] of controllers) {
      const used = extractUsedTypeNames(methods.join("\n\n"), typeImportCandidates).filter(
        (n) => n !== "RequestConfig"
      )
      const closure = computeTypeClosure(used, defs)
      closureCache.set(key, closure)
      for (const t of closure) usageCount.set(t, (usageCount.get(t) || 0) + 1)
    }
    for (const [t, count] of usageCount) {
      if (count >= 2) sharedTypeNames.add(t)
    }
  }

  const fileNames: string[] = []
  let fileCount = 0

  for (const [controllerKey, methods] of controllers) {
    const { className, fileName } = buildControllerNames(controllerKey, naming)
    const description = describe(controllerKey)
    const methodsCode = methods.join("\n\n")
    const importLine = buildImportSnippet(httpClientConfig)

    const usedTypes =
      ext === "ts"
        ? extractUsedTypeNames(methodsCode, typeImportCandidates).filter((n) => n !== "RequestConfig")
        : []

    // 计算该控制器用到类型的传递依赖闭包（localFile / inline 模式需要）
    const closure =
      ext === "ts" && usedTypes.length > 0 && typeMode !== "shared"
        ? closureCache.get(controllerKey) || computeTypeClosure(usedTypes, defs)
        : []

    // 类型部分：import 行（shared / localFile / inline 抽离）或内联代码块（inline）
    let typeImportLine = ""
    let inlineTypesBlock = ""
    if (ext === "ts" && usedTypes.length > 0) {
      if (typeMode === "inline") {
        // 抽离模式下，共用类型不再内联，改为后续 import
        const inlineNames = inlineExtract
          ? closure.filter((n) => !sharedTypeNames.has(n))
          : closure
        const inlineBody = inlineNames.map((n) => defs.get(n)).filter(Boolean).join("\n\n")
        if (inlineBody) inlineTypesBlock = `// 类型定义\n${inlineBody}\n`
        if (inlineExtract) {
          // 本文件（内联类型 + 方法代码）真正引用到的、已抽离的共享类型 → import
          const combined = `${inlineBody}\n${methodsCode}`
          const importNames = closure.filter(
            (n) => sharedTypeNames.has(n) && containsIdentifier(combined, n)
          )
          if (importNames.length > 0) {
            typeImportLine = `import type { ${importNames.join(", ")} } from "${sharedTypesImportPath}"`
          }
        }
      } else {
        const importPath = typeMode === "localFile" ? "./types" : sharedTypesImportPath
        typeImportLine = `import type { ${usedTypes.join(", ")} } from "${importPath}"`
      }
    }

    const headParts = [importLine, typeImportLine, inlineTypesBlock].filter(Boolean)
    const controllerCode =
      headParts.join("\n\n") +
      (headParts.length > 0 ? "\n\n" : "") +
      `/**\n * ${description}\n */\n` +
      `export class ${className} {\n${methodsCode}\n}\n`

    if (byController) {
      // 每个 Controller 独立文件夹：{controllersDir}/{fileName}/index.{ext}
      const controllerSubDir = path.join(controllersDir, fileName)
      if (!fs.existsSync(controllerSubDir)) fs.mkdirSync(controllerSubDir, { recursive: true })
      fs.writeFileSync(path.join(controllerSubDir, `index.${ext}`), controllerCode, "utf-8")
      fileCount++
      if (typeMode === "localFile") {
        const localBody = closure.map((n) => defs.get(n)).filter(Boolean).join("\n\n")
        const localTypesContent =
          `// 生成时间: ${new Date().toISOString()}\n\n` + (localBody ? `${localBody}\n` : "")
        fs.writeFileSync(path.join(controllerSubDir, `types.${ext}`), localTypesContent, "utf-8")
        fileCount++
      }
    } else {
      // 扁平文件：{controllersDir}/{fileName}.{ext}
      fs.writeFileSync(path.join(controllersDir, `${fileName}.${ext}`), controllerCode, "utf-8")
      fileCount++
    }
    fileNames.push(fileName)
  }

  // {controllersDir}/index.{ext}
  const controllersIndexCode = fileNames.map((n) => `export * from "./${n}"`).join("\n") + "\n"
  fs.writeFileSync(path.join(controllersDir, `index.${ext}`), controllersIndexCode, "utf-8")
  fileCount++

  // inline + 抽离模式：把共用类型写入共享 {typesDirName} 目录
  let typesDirExported = typeMode === "shared"
  if (inlineExtract && sharedTypeNames.size > 0) {
    const typesDir = path.join(outputDir, naming.typesDirName)
    if (!fs.existsSync(typesDir)) fs.mkdirSync(typesDir, { recursive: true })
    const sharedBody = Array.from(sharedTypeNames)
      .sort((a, b) => a.localeCompare(b))
      .map((n) => defs.get(n))
      .filter(Boolean)
      .join("\n\n")
    const sharedContent =
      `// 生成时间: ${new Date().toISOString()}\n\n` +
      `// 多个控制器共用的类型\n${sharedBody}\n`
    fs.writeFileSync(path.join(typesDir, `index.${ext}`), sharedContent, "utf-8")
    fileCount++
    typesDirExported = true
  }

  // 根 index.{ext}：存在共享类型目录时一并导出
  const rootExports = [`export * from "./${naming.controllersDirName}"`]
  if (typesDirExported) {
    rootExports.unshift(`export * from "./${naming.typesDirName}"`)
  }
  fs.writeFileSync(path.join(outputDir, `index.${ext}`), rootExports.join("\n") + "\n", "utf-8")
  fileCount++

  return { controllerCount: fileNames.length, fileCount }
}
