import * as fs from "fs"
import * as path from "path"

// ─────────────────────────────────────────────────────────────────────────────
// Mock 数据生成工具类型
// ─────────────────────────────────────────────────────────────────────────────

/** Mock 输出格式 */
export type MockOutputFormat = "json" | "msw" | "json-server"

export interface MockGeneratorOptions {
  /** 输出格式：json / msw / json-server */
  format: MockOutputFormat
  /** MSW / json-server 的 API 基础路径（如 /api），仅 msw / json-server 模式有效 */
  baseUrl?: string
  /** 每个数组字段生成的示例条目数，默认 2 */
  arrayItemCount?: number
}

/** 每个接口的 Mock 条目 */
export interface MockEntry {
  method: string
  path: string
  summary: string
  responseStatus: number
  data: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// 核心生成器
// ─────────────────────────────────────────────────────────────────────────────

export class MockGenerator {
  private opts: Required<MockGeneratorOptions>
  private apiDocs: any = null

  constructor(opts?: Partial<MockGeneratorOptions>) {
    this.opts = {
      format: opts?.format ?? "json",
      baseUrl: opts?.baseUrl ?? "",
      arrayItemCount: opts?.arrayItemCount ?? 2,
    }
  }

  // ─── 对外主入口 ───────────────────────────────────────────────────────────

  /**
   * 解析 apiDocs 并将结果写入 outputPath。
   * - format=json         → 单一 JSON 文件，键为 "METHOD /path"
   * - format=msw          → MSW handlers 文件（TypeScript）
   * - format=json-server  → json-server db.json + routes.json
   */
  async generate(apiDocs: any, outputPath: string): Promise<void> {
    this.apiDocs = apiDocs

    const entries = this.collectEntries()

    switch (this.opts.format) {
      case "json":
        this.writeJsonMock(entries, outputPath)
        break
      case "msw":
        this.writeMswHandlers(entries, outputPath)
        break
      case "json-server":
        this.writeJsonServer(entries, outputPath)
        break
    }
  }

  // ─── 收集所有接口的 Mock 数据 ────────────────────────────────────────────

  private collectEntries(): MockEntry[] {
    const entries: MockEntry[] = []
    const paths = this.apiDocs?.paths || {}

    for (const [apiPath, pathItem] of Object.entries<any>(paths)) {
      if (!pathItem) continue
      const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"]
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method]
        if (!operation) continue

        const { status, data } = this.resolveResponseData(operation)
        entries.push({
          method: method.toUpperCase(),
          path: apiPath,
          summary: operation.summary || operation.operationId || "",
          responseStatus: status,
          data,
        })
      }
    }

    return entries
  }

  // ─── 解析某个 operation 的响应数据 ──────────────────────────────────────

  private resolveResponseData(operation: any): { status: number; data: unknown } {
    const responses: Record<string, any> = operation.responses || {}

    // 优先 200，其次 201，再其次第一个 2xx，最后取第一个
    const preferredStatuses = [200, 201, 204]
    let pickedStatus = 200
    let pickedResponse: any = null

    for (const s of preferredStatuses) {
      if (responses[String(s)]) {
        pickedStatus = s
        pickedResponse = responses[String(s)]
        break
      }
    }
    if (!pickedResponse) {
      const firstKey = Object.keys(responses)[0]
      if (firstKey) {
        pickedStatus = parseInt(firstKey, 10) || 200
        pickedResponse = responses[firstKey]
      }
    }
    if (!pickedResponse) return { status: pickedStatus, data: null }

    // 解析 $ref 响应
    const resolvedResponse = "$ref" in pickedResponse
      ? this.resolveRef(pickedResponse.$ref)
      : pickedResponse

    // 查找 schema（OpenAPI 3.x / 2.x）
    let schema: any = null
    if (resolvedResponse.content) {
      // OpenAPI 3.x
      const jsonContent = resolvedResponse.content["application/json"]
        || resolvedResponse.content[Object.keys(resolvedResponse.content)[0]]
      schema = jsonContent?.schema ?? null
    } else if (resolvedResponse.schema) {
      // Swagger 2.x
      schema = resolvedResponse.schema
    }

    if (!schema) return { status: pickedStatus, data: null }

    const data = this.generateFromSchema(schema, 0)
    return { status: pickedStatus, data }
  }

  // ─── 根据 Schema 生成 Mock 值 ────────────────────────────────────────────

  /**
   * 优先级：
   *  1. schema.example
   *  2. schema.examples[*].value（OpenAPI 3.1）
   *  3. schema.default
   *  4. 按 type/format 合成
   */
  generateFromSchema(schema: any, depth: number): unknown {
    if (!schema) return null
    if (depth > 8) return null // 防止无限递归

    // 解析 $ref
    if ("$ref" in schema) {
      const resolved = this.resolveRef(schema.$ref)
      return resolved ? this.generateFromSchema(resolved, depth + 1) : null
    }

    // allOf / oneOf / anyOf 取第一个
    if (schema.allOf?.length) return this.generateFromSchema(schema.allOf[0], depth + 1)
    if (schema.oneOf?.length) return this.generateFromSchema(schema.oneOf[0], depth + 1)
    if (schema.anyOf?.length) return this.generateFromSchema(schema.anyOf[0], depth + 1)

    // 优先使用 example
    if (schema.example !== undefined) return schema.example
    // OpenAPI 3.1 examples map
    if (schema.examples && typeof schema.examples === "object") {
      const firstKey = Object.keys(schema.examples)[0]
      if (firstKey) {
        const ex = schema.examples[firstKey]
        if (ex?.value !== undefined) return ex.value
      }
    }
    // default
    if (schema.default !== undefined) return schema.default

    // 根据 type 合成
    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type

    switch (type) {
      case "string":
        return this.syntheticString(schema)
      case "number":
        return this.syntheticNumber(schema)
      case "integer":
        return this.syntheticInteger(schema)
      case "boolean":
        return true
      case "null":
        return null
      case "array":
        return this.syntheticArray(schema, depth)
      case "object":
        return this.syntheticObject(schema, depth)
      default:
        // 没有 type，尝试推断
        if (schema.properties) return this.syntheticObject(schema, depth)
        if (schema.items) return this.syntheticArray(schema, depth)
        return null
    }
  }

  // ─── 各类型合成器 ─────────────────────────────────────────────────────────

  private syntheticString(schema: any): string {
    if (schema.enum?.length) return schema.enum[0]
    const format: string = schema.format || ""
    const fieldHint: string = (schema.title || schema.description || "").toLowerCase()

    switch (format) {
      case "date-time": return "2024-01-15T08:30:00Z"
      case "date": return "2024-01-15"
      case "time": return "08:30:00"
      case "email": return "example@example.com"
      case "uri":
      case "url": return "https://example.com"
      case "uuid": return "550e8400-e29b-41d4-a716-446655440000"
      case "hostname": return "example.com"
      case "ipv4": return "192.168.1.1"
      case "ipv6": return "::1"
      case "binary":
      case "byte": return ""
      case "password": return "********"
      case "phone": return "+8613800138000"
    }

    // 根据字段名语义推断
    if (fieldHint.includes("name")) return "示例名称"
    if (fieldHint.includes("title")) return "示例标题"
    if (fieldHint.includes("desc")) return "这是一段描述文字"
    if (fieldHint.includes("phone") || fieldHint.includes("mobile") || fieldHint.includes("tel")) return "+8613800138000"
    if (fieldHint.includes("email")) return "example@example.com"
    if (fieldHint.includes("url") || fieldHint.includes("link")) return "https://example.com"
    if (fieldHint.includes("id")) return "1"
    if (fieldHint.includes("code")) return "CODE_001"
    if (fieldHint.includes("status")) return "1"
    if (fieldHint.includes("color")) return "#409EFF"
    if (fieldHint.includes("icon")) return "el-icon-user"
    if (fieldHint.includes("path") || fieldHint.includes("route")) return "/example/path"
    if (fieldHint.includes("token")) return "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc"
    if (fieldHint.includes("remark") || fieldHint.includes("note") || fieldHint.includes("comment")) return "备注信息"
    if (fieldHint.includes("address")) return "中国上海市浦东新区"

    // minLength / maxLength 参考
    if (schema.minLength && schema.minLength > 0) {
      return "示例文本".padEnd(schema.minLength, "文")
    }

    return "示例字符串"
  }

  private syntheticNumber(schema: any): number {
    const min = schema.minimum ?? 0
    const max = schema.maximum ?? (schema.minimum ? schema.minimum + 100 : 100)
    return Math.round((min + max) / 2 * 100) / 100
  }

  private syntheticInteger(schema: any): number {
    const format: string = schema.format || ""
    if (format === "int64") return 1000000001
    const min = schema.minimum ?? 1
    const max = schema.maximum ?? (schema.minimum ? schema.minimum + 100 : 100)
    return Math.floor((min + max) / 2)
  }

  private syntheticArray(schema: any, depth: number): unknown[] {
    const count = this.opts.arrayItemCount
    const item = schema.items || {}
    const result: unknown[] = []
    for (let i = 0; i < count; i++) {
      result.push(this.generateFromSchema(item, depth + 1))
    }
    return result
  }

  private syntheticObject(schema: any, depth: number): Record<string, unknown> {
    const obj: Record<string, unknown> = {}
    const properties: Record<string, any> = schema.properties || {}
    const required: string[] = schema.required || []

    // 总是包含 required 字段，可选字段也一并包含（更直观）
    for (const [key, propSchema] of Object.entries(properties)) {
      void required // 不做过滤，保持完整性
      obj[key] = this.generateFromSchema(propSchema, depth + 1)
    }

    // additionalProperties
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      obj["additionalProp1"] = this.generateFromSchema(schema.additionalProperties, depth + 1)
    }

    return obj
  }

  // ─── $ref 解析 ────────────────────────────────────────────────────────────

  private resolveRef(refPath: string): any {
    const normalized = refPath.replace(/^#\//, "")
    const parts = normalized.split("/")
    let current = this.apiDocs
    for (const part of parts) {
      if (current == null) return null
      current = current[part]
    }
    return current ?? null
  }

  // ─── 输出：纯 JSON ─────────────────────────────────────────────────────────

  private writeJsonMock(entries: MockEntry[], outputPath: string): void {
    const result: Record<string, unknown> = {}
    for (const e of entries) {
      result[`${e.method} ${e.path}`] = {
        status: e.responseStatus,
        summary: e.summary,
        data: e.data,
      }
    }
    const dir = path.dirname(outputPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf-8")
  }

  // ─── 输出：MSW handlers ──────────────────────────────────────────────────

  private writeMswHandlers(entries: MockEntry[], outputPath: string): void {
    const baseUrl = this.opts.baseUrl ? `'${this.opts.baseUrl}'` : "''"

    const handlerLines: string[] = entries.map((e) => {
      const httpMethod = e.method.toLowerCase()
      // 将 OpenAPI 路径参数 {id} 转换为 msw 路径参数 :id
      const mswPath = e.path.replace(/\{([^}]+)\}/g, ":$1")
      const dataJson = JSON.stringify(e.data, null, 4)
        .split("\n")
        .join("\n    ")

      return (
        `  // ${e.summary || e.method + " " + e.path}\n` +
        `  http.${httpMethod}(\`\${BASE_URL}${mswPath}\`, () => {\n` +
        `    return HttpResponse.json(\n` +
        `      ${dataJson},\n` +
        `      { status: ${e.responseStatus} }\n` +
        `    )\n` +
        `  }),`
      )
    })

    const content =
      `/**\n` +
      ` * Mock Service Worker (MSW) handlers\n` +
      ` * 自动生成，请勿手动修改\n` +
      ` * 生成时间: ${new Date().toISOString()}\n` +
      ` *\n` +
      ` * 使用方式:\n` +
      ` *   import { handlers } from './mock/handlers'\n` +
      ` *   setupWorker(...handlers)  // 浏览器端\n` +
      ` *   setupServer(...handlers)  // Node.js/Vitest 端\n` +
      ` */\n` +
      `import { http, HttpResponse } from 'msw'\n\n` +
      `const BASE_URL = ${baseUrl}\n\n` +
      `export const handlers = [\n` +
      handlerLines.join("\n\n") + "\n" +
      `]\n`

    const dir = path.dirname(outputPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(outputPath, content, "utf-8")
  }

  // ─── 输出：json-server ─────────────────────────────────────────────────────

  private writeJsonServer(entries: MockEntry[], outputDir: string): void {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

    // db.json：以路径最后一段为资源名
    const db: Record<string, unknown> = {}
    const routes: Record<string, string> = {}

    for (const e of entries) {
      const segments = e.path.replace(/\{[^}]+\}/g, "").split("/").filter(Boolean)
      const resourceName = segments[segments.length - 1] || "resource"
      const key = resourceName

      if (!db[key]) {
        // GET 列表接口 → data 若为数组直接用，否则包装
        if (e.method === "GET") {
          db[key] = Array.isArray(e.data) ? e.data : [e.data]
        }
      }

      // 路由映射：去参数版路径 → json-server 资源路径
      const cleanPath = e.path.replace(/\/\{[^}]+\}/g, "/:id")
      routes[cleanPath] = `/${key}`
    }

    fs.writeFileSync(
      path.join(outputDir, "db.json"),
      JSON.stringify(db, null, 2),
      "utf-8"
    )
    fs.writeFileSync(
      path.join(outputDir, "routes.json"),
      JSON.stringify(routes, null, 2),
      "utf-8"
    )

    // 生成使用说明 README
    const readmeContent =
      `# Mock Server (json-server)\n\n` +
      `自动生成，请勿手动修改\n` +
      `生成时间: ${new Date().toISOString()}\n\n` +
      `## 快速启动\n\n` +
      `\`\`\`bash\n` +
      `npm install -g json-server\n` +
      `json-server --watch db.json --routes routes.json --port 3100\n` +
      `\`\`\`\n\n` +
      `## 资源列表\n\n` +
      Object.keys(db).map((k) => `- \`/${k}\``).join("\n") + "\n"

    fs.writeFileSync(path.join(outputDir, "README.md"), readmeContent, "utf-8")
  }
}
