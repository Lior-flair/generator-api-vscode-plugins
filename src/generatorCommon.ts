/** 生成器通用命名配置 */
export interface NamingConfig {
  typesDirName: string
  controllersDirName: string
  controllerFileNameCasing: "default" | "PascalCase" | "camelCase" | "kebab-case"
  controllerClassNameSuffix: string
}

export const DEFAULT_NAMING: NamingConfig = {
  typesDirName: "types",
  controllersDirName: "controllers",
  controllerFileNameCasing: "default",
  controllerClassNameSuffix: "",
}

export function sanitizeName(name: string): string {
  return String(name).replace(/[^\u4e00-\u9fa5a-zA-Z0-9_]/g, "_")
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
  switch (cfg.mode) {
    case "axios":
      return `import axios from '${cfg.requestImportPath || "axios"}'`
    case "fetch":
      return ""
    case "custom":
      return ""
    case "axios-wrapper":
    default:
      return (
        `import requestClass, { getConfigs, type RequestConfig } from "${cfg.requestImportPath || "@/utils/request"}"\n` +
        `const { fetch:request} = requestClass`
      )
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
 * 在 outputDir 生成 request.ts 样板文件（文件已存在时跳过，不覆盖）
 */
export function generateRequestScaffoldFile(outputDir: string, cfg: HttpClientConfig, ext: string = "ts"): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path")
  const scaffoldPath = path.join(outputDir, `request.${ext}`)
  if (fs.existsSync(scaffoldPath)) return // 不覆盖已有文件

  let content = ""
  switch (cfg.mode) {
    case "axios":
      content =
        `import axios from '${cfg.requestImportPath || "axios"}'\n\n` +
        `const instance = axios.create({\n  baseURL: '',\n  timeout: 10000,\n})\n\n` +
        `// TODO: Add request interceptor here\n` +
        `instance.interceptors.request.use(\n` +
        `  (config) => {\n    // e.g. config.headers['Authorization'] = 'Bearer ' + getToken()\n    return config\n  },\n` +
        `  (error) => Promise.reject(error)\n)\n\n` +
        `// TODO: Add response interceptor here\n` +
        `instance.interceptors.response.use(\n` +
        `  (response) => response,\n` +
        `  (error) => Promise.reject(error)\n)\n\n` +
        `export default instance\n`
      break
    case "axios-wrapper":
      content =
        `import axios, { type AxiosRequestConfig } from 'axios'\n\n` +
        `export interface RequestConfig extends AxiosRequestConfig {}\n\n` +
        `const instance = axios.create({\n  baseURL: '',\n  timeout: 10000,\n})\n\n` +
        `// TODO: Add request interceptor here\n` +
        `instance.interceptors.request.use(\n` +
        `  (config) => {\n    // e.g. config.headers['Authorization'] = 'Bearer ' + getToken()\n    return config\n  },\n` +
        `  (error) => Promise.reject(error)\n)\n\n` +
        `// TODO: Add response interceptor here\n` +
        `instance.interceptors.response.use(\n` +
        `  (response) => response.data,\n` +
        `  (error) => Promise.reject(error)\n)\n\n` +
        `export function getConfigs(method: string, contentType: string, url: string, options: RequestConfig = {}): AxiosRequestConfig {\n` +
        `  return { method, url, headers: { 'Content-Type': contentType, ...(options.headers || {}) }, ...options }\n` +
        `}\n\n` +
        `function fetchFn(configs: AxiosRequestConfig, resolve: (v: any) => void, reject: (e: any) => void): void {\n` +
        `  instance(configs).then(resolve).catch(reject)\n` +
        `}\n\n` +
        `const requestClass = { fetch: fetchFn }\nexport default requestClass\n`
      break
    case "fetch":
      content =
        `// Fetch-based request utility\n\n` +
        `// TODO: Add request interceptor here\n` +
        `async function requestInterceptor(url: string, options: RequestInit): Promise<[string, RequestInit]> {\n` +
        `  // e.g. options.headers = { ...options.headers, Authorization: 'Bearer ' + getToken() }\n` +
        `  return [url, options]\n}\n\n` +
        `// TODO: Add response interceptor here\n` +
        `async function responseInterceptor(response: Response): Promise<Response> {\n` +
        `  if (!response.ok) throw new Error(response.statusText)\n` +
        `  return response\n}\n\n` +
        `export async function fetchRequest<T>(url: string, options: RequestInit = {}): Promise<T> {\n` +
        `  const [finalUrl, finalOptions] = await requestInterceptor(url, options)\n` +
        `  const response = await fetch(finalUrl, finalOptions)\n` +
        `  const intercepted = await responseInterceptor(response)\n` +
        `  return intercepted.json() as Promise<T>\n}\n`
      break
    default:
      return // custom: 跳过生成
  }
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(scaffoldPath, content, "utf-8")
}

export function buildUniqueMethodName(path: string, controllerName: string, method: string, operationId?: string): string {
  const usedNames = getControllerMethodNameSet(controllerName)
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
      } else {
        bySuffix = paramName.charAt(0).toUpperCase() + paramName.slice(1)
      }
    } else {
      partsIndex.unshift(partStartIndex)
      const candidate =
        partsIndex
          .map((item) => {
            const str = pathParts[item] || ""
            if (!str) return ""
            return str.charAt(0).toUpperCase() + str.slice(1)
          })
          .join("") + bySuffix
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

  if (!methodName || usedNames.has(`${controllerName}.${methodName}`)) {
    methodName = sanitizeName(operationId || getOperationId(path, method))
  }

  usedNames.add(`${controllerName}.${methodName}`)
  return methodName
}
