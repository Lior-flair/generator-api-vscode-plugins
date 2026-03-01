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
  sanitizeName,
} from "./generatorCommon"

export class ApiGenerator {
  private typeNames: string[] = []
  private httpClientConfig: HttpClientConfig = DEFAULT_HTTP_CLIENT_CONFIG

  private initializeTypeNames(apiDocs: any): void {
    // OpenAPI 3.x schemas
    if (apiDocs.components?.schemas) {
      Object.keys(apiDocs.components.schemas).forEach((name) => {
        this.typeNames.push(this.sanitizeName(name))
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
          types.push(this.generateTypeDefinition(this.sanitizeName(name), schema as any, apiDocs))
        }
      }
    }
    const typesCode = `// 生成时间: ${new Date().toISOString()}\n\n// 类型定义\n${types.join("\n\n")}\n`
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

    // ── 3. 写入各 Controller 文件 ─────────────────────────────────
    const fileNames: string[] = [] // 实际写入的文件名（不含后缀）
    for (const [controllerKey, methods] of controllers) {
      const { className, fileName } = buildControllerNames(controllerKey, naming)

      const description =
        (apiDocs.tags || []).find((tag: any) => tag.name === controllerKey ||
          this.sanitizeName(tag.name) === controllerKey)?.description || ""
      const importLine = buildImportSnippet(this.httpClientConfig)
      const controllerCode =
        (importLine ? importLine + "\n\n" : "") +
        `/**\n * ${description}\n */\n` +
        `export class ${className} {\n${methods.join("\n\n")}\n}\n`
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
            this.sanitizeName(name),
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
    const code =
      (importLine ? importLine + "\n\n" : "") +
      `// 生成时间: ${new Date().toISOString()}\n\n` +
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

  private generateTypeDefinition(
    name: string,
    schema: any,
    apiDocs: any
  ): string {
    const properties = schema.properties || {}
    const required = schema.required || []

    const propertyDefs = Object.entries(properties).map(
      ([propName, propSchema]) => {
        const sanitizedPropName = this.sanitizeName(propName)
        const isRequired = required.includes(propName)
        const type = this.getTypeScriptType(
          propSchema as OpenAPIV3.SchemaObject,
          apiDocs
        )
        return `  /** ${
          (propSchema as OpenAPIV3.SchemaObject).description ||
          (propSchema as OpenAPIV3.SchemaObject).title ||
          ""
        } */\n  ${sanitizedPropName}${isRequired ? "" : "?"}: ${type};`
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
      operation.operationId
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
    const hasParameters =
      operation.parameters && operation.parameters.length > 0
    const isGetMethod = method.toLowerCase() === "get"
    const shouldSetParams = isGetMethod || hasParameters
    let params = shouldSetParams ? "configs.params = params;" : ""
    // 处理请求体
    let requestBody = ""
    if (operation.requestBody) {
      const content = operation.requestBody.content
      if (content) {
        // 优先使用 application/json
        if (content["application/json"]) {
          requestBody = 'configs.data = params["body"]'
          if (params) {
            params = `
          const {body,...new_params} = params;
          configs.params = new_params;
          `
          }
        }
        // 处理 multipart/form-data
        else if (content["multipart/form-data"]) {
          requestBody = 'configs.data = params["formData"]'
          if (params) {
            params = `
      const { formData, ...new_params } = params
      configs.params = new_params
          `
          }
        }
        // 处理 application/x-www-form-urlencoded
        else if (content["application/x-www-form-urlencoded"]) {
          requestBody = 'configs.data = params["formData"]'
          if (params) {
            params = `
      const { formData, ...new_params } = params
      configs.params = new_params
          `
          }
        }
      }
    }

    // 处理请求类型
    const requestContentType = this.getRequestContentType(operation)

    // 处理安全定义
    const securityConfig = this.getSecurityConfig(operation)

    const comment =
      `  /**\n   * ${operation.summary || ""}` +
      (operation.description ? "\n   * " + operation.description : "") +
      (operation.deprecated ? "\n   * @deprecated true" : "") +
      (operation.callbacks ? "\n   * @returns " + operation.callbacks : "") +
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
    return `${comment}\n  static ${methodName}(${paramsType}): Promise<${returnType}> {\n    return new Promise((resolve, reject) => {\n      const url = \`${processedPath}\`;\n      const configs = getConfigs(\n        '${method}',\n        '${requestContentType}',\n        url,\n        options\n      );\n      ${params}\n      ${requestBody}\n      ${securityConfig}\n      request(configs, resolve, reject);\n    });\n  }`
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
        const sanitizedName = this.sanitizeName(typeName)
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
        const sanitizedName = this.sanitizeName(schema.title)
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
      return "string"
    }
    if (schema.type === "number" || schema.type === "integer") {
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
