import * as fs from "fs"
import * as path from "path"
import { OpenAPIV3 } from "openapi-types"
import {
  buildControllerNames,
  buildImportSnippet,
  buildMethodBody,
  buildUniqueMethodName,
  DEFAULT_HTTP_CLIENT_CONFIG,
  DEFAULT_NAMING,
  type HttpClientConfig,
  type NamingConfig,
  normalizeIdentifierName,
  resolveMappedScalarType,
  sanitizeName,
  toPascalCase,
} from "./generatorCommon"

export class ApiGenerator {
  private typeNames: string[] = []
  private enumDefs: Map<string, string[]> = new Map()
  private httpClientConfig: HttpClientConfig = DEFAULT_HTTP_CLIENT_CONFIG
  private naming: NamingConfig = DEFAULT_NAMING

  private initializeTypeNames(apiDocs: any): void {
    // OpenAPI 3.x schemas
    if (apiDocs.components?.schemas) {
      Object.keys(apiDocs.components.schemas).forEach((name) => {
        this.typeNames.push(this.normalizeTypeIdentifier(name))
      })
    }
  }

  async generate(
    apiDocs: any,
    framework: string,
    outputType: string,
    outputPath: string,
    outputSplit: string = "single",
    namingConfig: NamingConfig = DEFAULT_NAMING,
    httpClientConfig: HttpClientConfig = DEFAULT_HTTP_CLIENT_CONFIG
  ): Promise<void> {
    try {
      // 验证API文档
      if (!this.isValidApiDoc(apiDocs)) {
        throw new Error("无效的API文档")
      }

      // 保存 HTTP 客户端配置供内部方法使用
      this.httpClientConfig = httpClientConfig

      // 保存命名配置供内部方法使用
      this.naming = namingConfig

      // 重置状态，避免多次调用残留
      this.typeNames = []
      this.enumDefs = new Map()

      // 初始化类型名称
      this.initializeTypeNames(apiDocs)

      if (outputSplit === "byTag") {
        // 按 Tag 拆分多文件输出
        this.generateByTag(apiDocs, framework, outputType, outputPath, namingConfig)
      } else {
        // 生成代码（单文件）
        const code = this.generateCode(apiDocs, framework, outputType)

        // 确保输出目录存在
        const outputDir = path.dirname(outputPath)
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true })
        }

        // 写入文件
        fs.writeFileSync(outputPath, code, "utf-8")
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "未知错误"
      throw new Error(`生成API代码失败: ${errorMessage}`)
    }
  }

  /**
   * 按 Tag 拆分输出：
   *  - types.{ext}   所有类型定义
   *  - {Tag}.{ext}   每个 Tag 对应的 Controller 类
   *  - index.{ext}   统一 re-export
   */
  private generateByTag(
    apiDocs: any,
    framework: string,
    outputType: string,
    outputDir: string,
    naming: NamingConfig = DEFAULT_NAMING
  ): void {
    const ext = outputType === "js" ? "js" : "ts"

    // ── 子目录路径 ────────────────────────────────────────────────
    const typesDir = path.join(outputDir, naming.typesDirName)
    const controllersDir = path.join(outputDir, naming.controllersDirName)
    ;[outputDir, typesDir, controllersDir].forEach((d) => {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
    })

    // ── 1. 收集类型定义 → {typesDirName}/index.{ext} ──────────────
    const types: string[] = []
    if (apiDocs.components?.schemas) {
      for (const [name, schema] of Object.entries(apiDocs.components.schemas)) {
        if (this.isSchemaObject(schema) && (schema as any).type === "object") {
          types.push(this.generateTypeDefinition(this.normalizeTypeIdentifier(name), schema as any, apiDocs))
        }
      }
    }
    const enumDefsCode = this.buildEnumDefsCode()
    const typesCode =
      `// 生成时间: ${new Date().toISOString()}\n\n` +
      (enumDefsCode ? `// 枚举类型\n${enumDefsCode}\n\n` : "") +
      `// 类型定义\n${types.join("\n\n")}\n`
    fs.writeFileSync(path.join(typesDir, `index.${ext}`), typesCode, "utf-8")

    // ── 2. 按 Tag 分组生成 Controller 方法 ───────────────────────
    const controllers: Map<string, string[]> = new Map()
    for (const [p, pathItem] of Object.entries(apiDocs.paths)) {
      if (pathItem) {
        for (const [method, operation] of Object.entries(pathItem as any)) {
          if (operation && typeof operation === "object") {
            const serviceMethod = this.generateServiceMethod(p, method, operation)
            const tag = (operation as any).tags?.[0] || "Default"
            // key 用清洁后的 sanitizeName（保证 Map 唯一性）
            const controllerKey = this.sanitizeName(tag)
            if (!controllers.has(controllerKey)) {
              controllers.set(controllerKey, [])
            }
            controllers.get(controllerKey)?.push(serviceMethod)
          }
        }
      }
    }

    const typeImportCandidates = Array.from(new Set(this.typeNames))

    // ── 3. 写入各 Controller 文件 ─────────────────────────────────
    const fileNames: string[] = [] // 实际写入的文件名（不含后缀）
    for (const [controllerKey, methods] of controllers) {
      const { className, fileName } = buildControllerNames(controllerKey, naming)

      const description =
        (apiDocs.tags || []).find((tag: any) => tag.name === controllerKey ||
          this.sanitizeName(tag.name) === controllerKey)?.description || ""
      let methodsCode = methods.join("\n\n")
      const importLine = buildImportSnippet(this.httpClientConfig)
      const typeImportLine = ext === "ts"
        ? (() => {
            const usedTypes = this.extractUsedTypeNames(methodsCode, typeImportCandidates)
              .filter((name) => name !== "RequestConfig")
            if (usedTypes.length === 0) return ""
            methodsCode = this.prefixTypeReferences(methodsCode, usedTypes)
            return `import type * as Types from "../${naming.typesDirName}"`
          })()
        : ""
      const controllerCode =
        [importLine, typeImportLine].filter(Boolean).join("\n\n") +
        ([importLine, typeImportLine].filter(Boolean).length > 0 ? "\n\n" : "") +
        `/**\n * ${description}\n */\n` +
        `export class ${className} {\n${methodsCode}\n}\n`
      fs.writeFileSync(path.join(controllersDir, `${fileName}.${ext}`), controllerCode, "utf-8")
      fileNames.push(fileName)
    }

    // controllers/{controllersDirName}/index.{ext}
    const controllersIndexCode = fileNames.map((n) => `export * from "./${n}"`).join("\n") + "\n"
    fs.writeFileSync(path.join(controllersDir, `index.${ext}`), controllersIndexCode, "utf-8")

    // ── 4. 根 index 文件 ──────────────────────────────────────────
    const rootIndexCode = `export * from "./${naming.typesDirName}"\nexport * from "./${naming.controllersDirName}"\n`
    fs.writeFileSync(path.join(outputDir, `index.${ext}`), rootIndexCode, "utf-8")
  }

  private isValidApiDoc(doc: any): boolean {
    return doc.openapi && doc.openapi.startsWith("3.") && doc.info && doc.paths
  }

  private toConstKey(value: string): string {
    const sanitized = sanitizeName(String(value)).replace(/^_+|_+$/g, "")
    const pascal = toPascalCase(sanitized || "_")
    return /^\d/.test(pascal) ? `_${pascal}` : (pascal || "_Unknown")
  }

  private registerEnumDef(name: string, values: string[]): void {
    if (!this.enumDefs.has(name)) {
      this.enumDefs.set(name, values)
      if (!this.typeNames.includes(name)) this.typeNames.push(name)
    }
  }

  private buildEnumDefsCode(): string {
    if (this.enumDefs.size === 0) return ""
    const parts: string[] = []
    for (const [name, values] of this.enumDefs) {
      const entries = values.map((v) => `  ${this.toConstKey(v)}: '${v}'`).join(",\n")
      parts.push(
        `export const ${name} = {\n${entries},\n} as const\n` +
        `export type ${name} = typeof ${name}[keyof typeof ${name}]`
      )
    }
    return parts.join("\n\n")
  }

  private generateCode(
    apiDocs: any,
    framework: string,
    outputType: string
  ): string {
    const types: string[] = []
    const controllers: Map<string, string[]> = new Map()

    // 生成类型定义
    if (apiDocs.components?.schemas) {
      for (const [name, schema] of Object.entries(
        apiDocs.components.schemas
      )) {
        if (this.isSchemaObject(schema) && schema.type === "object") {
          const typeDef = this.generateTypeDefinition(
            this.normalizeTypeIdentifier(name),
            schema,
            apiDocs
          )
          types.push(typeDef)
        }
      }
    }

    // 生成服务方法并按tag分组
    for (const [path, pathItem] of Object.entries(apiDocs.paths)) {
      if (pathItem) {
        for (const [method, operation] of Object.entries(pathItem)) {
          if (operation && typeof operation === "object") {
            const serviceMethod = this.generateServiceMethod(
              path,
              method,
              operation
            )
            const tag = operation.tags?.[0] || "Default"
            const controllerName = this.sanitizeName(tag)

            if (!controllers.has(controllerName)) {
              controllers.set(controllerName, [])
            }
            controllers.get(controllerName)?.push(serviceMethod)
          }
        }
      }
    }

    // 生成controller类
    const controllerClasses: string[] = []
    for (const [controllerName, methods] of controllers) {
      const description =
        (apiDocs.tags || []).find((tag: any) => tag.name === controllerName)
          ?.description || ""
      const controllerClass = `
/**
 * ${description}
 */
export class ${controllerName} {
${methods.join("\n\n")}
}`
      controllerClasses.push(controllerClass)
    }

    // 组合最终代码
    const importLine = buildImportSnippet(this.httpClientConfig)
    const enumDefsCode = this.buildEnumDefsCode()
    const code =
      (importLine ? importLine + "\n\n" : "") +
      `// 生成时间: ${new Date().toISOString()}\n\n` +
      (enumDefsCode ? `// 枚举类型\n${enumDefsCode}\n\n` : "") +
      `// 类型定义\n${types.join("\n\n")}\n\n` +
      `// Controller类\n${controllerClasses.join("\n\n")}\n`

    return code
  }

  private isSchemaObject(schema: any): schema is OpenAPIV3.SchemaObject {
    return !("$ref" in schema)
  }

  private sanitizeName(name: string): string {
    return sanitizeName(name)
  }

  private normalizeTypeIdentifier(name: string): string {
    return normalizeIdentifierName(name, this.naming.methodNameCasing)
  }

  private extractUsedTypeNames(code: string, candidates: string[]): string[] {
    return candidates
      .filter((name) => code.includes(name))
      .sort((a, b) => a.localeCompare(b))
  }

  private prefixTypeReferences(code: string, typeNames: string[]): string {
    const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return [...typeNames]
      .sort((a, b) => b.length - a.length)
      .reduce((result, typeName) => {
        const escaped = escapeRegExp(typeName)
        const tail = `(?![A-Za-z0-9_\u4e00-\u9fa5])`
        return result
          .replace(new RegExp(`(:\\s*)(${escaped})${tail}`, "g"), "$1Types.$2")
          .replace(new RegExp(`(<\\s*)(${escaped})${tail}`, "g"), "$1Types.$2")
          .replace(new RegExp(`(\\|\\s*)(${escaped})${tail}`, "g"), "$1Types.$2")
          .replace(new RegExp(`(&\\s*)(${escaped})${tail}`, "g"), "$1Types.$2")
          .replace(new RegExp(`(,\\s*)(${escaped})${tail}(?!\\s*:)`, "g"), "$1Types.$2")
      }, code)
  }

  private generateTypeDefinition(
    name: string,
    schema: any,
    apiDocs: any
  ): string {
    const properties = schema.properties || {}
    const required = schema.required || []

    const propertyDefs = Object.entries(properties).sort(([a], [b]) => a.localeCompare(b)).map(
      ([propName, propSchema]) => {
        const sanitizedPropName = this.sanitizeName(propName)
        const isRequired = required.includes(propName)
        const ps = propSchema as any
        let type: string
        if ((ps.type === "string" || !ps.type) && Array.isArray(ps.enum) && ps.enum.length > 0) {
          const enumName = name + toPascalCase(sanitizeName(propName))
          this.registerEnumDef(enumName, ps.enum)
          type = enumName
        } else {
          type = this.getTypeScriptType(ps as OpenAPIV3.SchemaObject, apiDocs)
        }
        return `  /** ${ps.description || ps.title || ""} */\n  ${sanitizedPropName}${isRequired ? "" : "?"}: ${type};`
      }
    )

    return `export interface ${name} {\n${propertyDefs.join("\n")}\n}`
  }

  private generateServiceMethod(
    path: string,
    method: string,
    operation: any
  ): string {
    const tag = operation.tags?.[0] || "Default"
    const controllerName = this.sanitizeName(tag)
    const methodName = buildUniqueMethodName(
      path,
      controllerName,
      method,
      operation.operationId,
      this.naming
    )

    const paramsType = this.getParamsType(operation)
    const returnType = this.getReturnType(operation)

    // 处理路径中的行内参数
    let processedPath = path
    if (operation.parameters) {
      const pathParams = operation.parameters
        .filter((param: any) => param.in === "path")
        .map((param: any) => param.name)

      pathParams.forEach((paramName: string) => {
        const paramPattern = `{${paramName}}`
        if (processedPath.includes(paramPattern)) {
          processedPath = processedPath.replace(
            paramPattern,
            `\${params.${paramName}}`
          )
        }
      })
    }

    // 处理参数
    const hasQueryOrPathParameters = Array.isArray(operation.parameters) && operation.parameters.some(
      (param: any) => this.isParameterObject(param) && (param.in === "path" || param.in === "query")
    )
    let paramsAssign = hasQueryOrPathParameters ? "configs.params = params;" : ""
    // 处理请求体（requestBody 仅用于 buildMethodBody 的 truthy 判断）
    let requestBody = ""
    let dataAssign = ""
    if (operation.requestBody) {
      const content = operation.requestBody.content
      if (content) {
        if (content["application/json"]) {
          requestBody = "application/json"
          if (paramsAssign) {
            paramsAssign = "const { body, ...queryParams } = params;\n      configs.params = queryParams;"
            dataAssign = "configs.data = body;"
          } else {
            dataAssign = "configs.data = params.body;"
          }
        } else if (content["multipart/form-data"] || content["application/x-www-form-urlencoded"]) {
          requestBody = content["multipart/form-data"] ? "multipart/form-data" : "application/x-www-form-urlencoded"
          if (paramsAssign) {
            paramsAssign = "const { formData, ...queryParams } = params;\n      configs.params = queryParams;"
            dataAssign = "configs.data = formData;"
          } else {
            dataAssign = "configs.data = params.formData;"
          }
        }
      }
    }

    // 处理请求类型
    const requestContentType = this.getRequestContentType(operation)

    // 处理安全定义
    const securityConfig = this.getSecurityConfig(operation)

    const nonQueryPathParameterNotes = this.getNonQueryPathParameterNotes(operation)
    const comment =
      `  /**\n   * ${operation.summary || ""}` +
      (operation.description ? "\n   * " + operation.description : "") +
      (operation.deprecated ? "\n   * @deprecated true" : "") +
      (operation.callbacks ? "\n   * @returns " + operation.callbacks : "") +
      (nonQueryPathParameterNotes ? `\n   * ${nonQueryPathParameterNotes}` : "") +
      "\n   */"

    if (this.httpClientConfig.mode !== "axios-wrapper") {
      // axios / fetch / custom：async/await 风格，无 options 参数
      const cleanParamsType = paramsType.replace(/, options: RequestConfig = \{\}\s*$/, "")
      const body = buildMethodBody(
        this.httpClientConfig,
        method,
        processedPath,
        requestBody,
        requestContentType,
        returnType,
        methodName
      )
      return `${comment}\n  static async ${methodName}(${cleanParamsType}): Promise<${returnType}> {\n    ${body}\n  }`
    }

    // axios-wrapper：保留原有 Promise + getConfigs + request 风格
    const configLines = [paramsAssign, dataAssign, securityConfig].filter(Boolean)
    const configSection = configLines.length > 0 ? "\n      " + configLines.join("\n      ") : ""
    return `${comment}\n  static ${methodName}(${paramsType}): Promise<${returnType}> {\n    return new Promise((resolve, reject) => {\n      const url = \`${processedPath}\`;\n      const configs = getConfigs(\n        '${method}',\n        '${requestContentType}',\n        url,\n        options\n      );${configSection}\n      request(configs, resolve, reject);\n    });\n  }`
  }

  private getSecurityConfig(operation: any): string {
    if (!operation.security) return ""

    const securityConfigs: string[] = []
    operation.security.forEach((sec: any) => {
      Object.entries(sec).forEach(([name, scopes]: [string, any]) => {
        if (Array.isArray(scopes)) {
          securityConfigs.push(
            `configs.headers['Authorization'] = 'Bearer ${name}';`
          )
        } else {
          securityConfigs.push(`configs.headers['${name}'] = '${scopes}';`)
        }
      })
    })

    return securityConfigs.join("\n      ")
  }

  private getParamsType(operation: any): string {
    const params: string[] = []

    if (operation.parameters) {
      operation.parameters.forEach((param: any) => {
        if (this.isParameterObject(param)) {
          if (param.in !== "path" && param.in !== "query") return
          const paramName = param.name
          const isRequired = param.required === true
          const type = this.getTypeScriptType(
            param.schema || param,
            operation.components?.schemas || {}
          )
          params.push(`"${paramName}"${isRequired ? "" : "?"}: ${type}`)
        }
      })
    }

    // 处理请求体
    if (operation.requestBody) {
      const content = operation.requestBody.content
      if (content) {
        // 优先使用 application/json
        if (content["application/json"]) {
          const schema = content["application/json"].schema
          if (schema) {
            params.push(
              `body: ${this.getTypeScriptType(
                schema,
                operation.components?.schemas || {}
              )}`
            )
          }
        }
        // 处理 multipart/form-data
        else if (content["multipart/form-data"]) {
          const schema = content["multipart/form-data"].schema
          if (schema) {
            params.push(
              `formData: ${this.getTypeScriptType(
                schema,
                operation.components?.schemas || {}
              )}`
            )
          }
        }
        // 处理 application/x-www-form-urlencoded
        else if (content["application/x-www-form-urlencoded"]) {
          const schema = content["application/x-www-form-urlencoded"].schema
          if (schema) {
            params.push(
              `formData: ${this.getTypeScriptType(
                schema,
                operation.components?.schemas || {}
              )}`
            )
          }
        }
      }
    }

    return `params: {${params.join(
      ", "
    )}} = {} as any, options: RequestConfig = {} `
  }

  private getNonQueryPathParameterNotes(operation: any): string {
    if (!operation.parameters || !Array.isArray(operation.parameters)) return ""

    const notes = operation.parameters
      .filter((param: any) => this.isParameterObject(param))
      .filter((param: any) => param.in !== "path" && param.in !== "query")
      .map((param: any) => {
        const type = this.getTypeScriptType(
          param.schema || param,
          operation.components?.schemas || {}
        )
        const requiredMark = param.required ? "required" : "optional"
        return `@param [${param.in}] ${param.name}: ${type} (${requiredMark})`
      })

    return notes.join("\n   * ")
  }

  private getReturnType(operation: any): string {
    if (operation.responses) {
      const successResponse = operation.responses["200"]
      if (successResponse && successResponse.content) {
        // 优先使用 application/json
        if (successResponse.content["application/json"]) {
          const schema = successResponse.content["application/json"].schema
          if (schema) {
            return this.getTypeScriptType(
              schema,
              operation.components?.schemas || {}
            )
          }
        }
        // 检查其他内容类型
        const contentType = Object.keys(successResponse.content)[0]
        if (contentType) {
          const schema = successResponse.content[contentType].schema
          if (schema) {
            return this.getTypeScriptType(
              schema,
              operation.components?.schemas || {}
            )
          }
        }
      }
    }
    return "any"
  }

  private getTypeScriptType(schema: any, apiDocs: any): string {
    if (!schema) return "any"

    // 处理 $ref 引用
    if ("$ref" in schema) {
      const refPath = schema.$ref
      // 从引用路径中提取类型名称
      const typeName = refPath.split("/").pop()
      if (typeName) {
        const sanitizedName = this.normalizeTypeIdentifier(typeName)
        // 检查是否在已知类型列表中
        if (this.typeNames.includes(sanitizedName)) {
          return sanitizedName
        }
      }
      // 如果类型名称未找到，则解析引用
      const refType = this.resolveRef(refPath, apiDocs)
      if (refType) {
        return this.getTypeScriptType(refType, apiDocs)
      }
      return "any"
    }

    if (schema.type === "array") {
      return `${this.getTypeScriptType(schema.items, apiDocs)}[]`
    }
    if (schema.type === "object") {
      // 如果对象有 title 属性，可能是一个命名类型
      if (schema.title) {
        const sanitizedName = this.normalizeTypeIdentifier(schema.title)
        if (this.typeNames.includes(sanitizedName)) {
          return sanitizedName
        }
      }

      if (schema.properties) {
        const properties = Object.entries(schema.properties).map(
          ([name, prop]: [string, any]) => {
            const isRequired = schema.required?.includes(name) || false
            return `"${name}"${isRequired ? "" : "?"}: ${this.getTypeScriptType(
              prop,
              apiDocs
            )}`
          }
        )
        if (schema.additionalProperties) {
          properties.push(
            `[key: string]: ${this.getTypeScriptType(
              schema.additionalProperties,
              apiDocs
            )}`
          )
        }
        return `{${properties.join(", ")}}`
      }
      return "any"
    }
    if (schema.type === "string") {
      if (schema.enum) {
        return schema.enum.map((v: string) => `'${v}'`).join(" | ")
      }
      const mapped = resolveMappedScalarType(this.httpClientConfig, schema.type, schema.format)
      if (mapped) return mapped
      return "string"
    }
    if (schema.type === "number" || schema.type === "integer") {
      const mapped = resolveMappedScalarType(this.httpClientConfig, schema.type, schema.format)
      if (mapped) return mapped
      return "number"
    }
    if (schema.type === "boolean") {
      return "boolean"
    }
    if (schema.type === "file") {
      return "File"
    }
    return "any"
  }

  private isParameterObject(param: any): boolean {
    return !("$ref" in param)
  }

  private getRequestContentType(operation: any): string {
    if (operation.requestBody) {
      const content = operation.requestBody.content
      if (content) {
        // 优先使用 application/json
        if (content["application/json"]) {
          return "application/json"
        }
        // 处理 multipart/form-data
        else if (content["multipart/form-data"]) {
          return "multipart/form-data"
        }
        // 处理 application/x-www-form-urlencoded
        else if (content["application/x-www-form-urlencoded"]) {
          return "application/x-www-form-urlencoded"
        }
      }
    }
    return "application/json"
  }

  private resolveRef(refPath: string, apiDocs: any): any {
    // 移除 #/ 前缀
    const path = refPath.replace("#/", "")
    // 按 / 分割路径
    const parts = path.split("/")

    let current = apiDocs
    for (const part of parts) {
      if (current && current[part]) {
        current = current[part]
      } else {
        return null
      }
    }

    return current
  }
}
