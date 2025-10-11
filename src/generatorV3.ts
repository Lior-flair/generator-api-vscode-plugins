import * as fs from "fs"
import * as path from "path"
import { OpenAPIV3 } from "openapi-types"

export class ApiGenerator {
  private typeNames: string[] = []

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
    outputPath: string
  ): Promise<void> {
    try {
      // 验证API文档
      if (!this.isValidApiDoc(apiDocs)) {
        throw new Error("无效的API文档")
      }

      // 初始化类型名称
      this.initializeTypeNames(apiDocs)

      // 生成代码
      const code = this.generateCode(apiDocs, framework, outputType)

      // 确保输出目录存在
      const outputDir = path.dirname(outputPath)
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }

      // 写入文件
      fs.writeFileSync(outputPath, code, "utf-8")
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "未知错误"
      throw new Error(`生成API代码失败: ${errorMessage}`)
    }
  }

  private isValidApiDoc(doc: any): boolean {
    const isOpenApi3 = doc.openapi && doc.openapi.startsWith("3.")
    const isSwagger2 = doc.swagger && doc.swagger.startsWith("2.")
    return (isOpenApi3 || isSwagger2) && doc.info && doc.paths
  }

  private generateCode(
    apiDocs: any,
    framework: string,
    outputType: string
  ): string {
    const types: string[] = []
    const controllers: Map<string, string[]> = new Map()

    // 生成类型定义
    if (this.isOpenApi3(apiDocs)) {
      // OpenAPI 3.x 类型定义
      if (apiDocs.components && apiDocs.components.schemas) {
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
    } else {
      // Swagger 2.x 类型定义
      if (apiDocs.definitions) {
        for (const [name, schema] of Object.entries(apiDocs.definitions)) {
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
        apiDocs.tags.find((tag: any) => tag.name === controllerName)
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
    const code = `
import requestClass, { getConfigs, type RequestConfig } from "@/utils/request"
const { fetch:request} = requestClass

// 生成时间: ${new Date().toISOString()}

// 类型定义
${types.join("\n\n")}

// Controller类
${controllerClasses.join("\n\n")}
`

    return code
  }

  private isOpenApi3(doc: any): boolean {
    return doc.openapi && doc.openapi.startsWith("3.")
  }

  private isSchemaObject(schema: any): schema is OpenAPIV3.SchemaObject {
    return !("$ref" in schema)
  }

  private sanitizeName(name: string): string {
    // 替换特殊字符为下划线，保留中文
    return name.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_]/g, "_")
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
    // 唯一性集合静态存储在 controller 作用域
    if (!(globalThis as any)._controllerMethodNames) {
      ;(globalThis as any)._controllerMethodNames = {}
    }
    const tag = operation.tags?.[0] || "Default"
    const controllerName = this.sanitizeName(tag)
    if (!(globalThis as any)._controllerMethodNames[controllerName]) {
      ;(globalThis as any)._controllerMethodNames[controllerName] = new Set()
    }
    const usedNames: Set<string> = (globalThis as any)._controllerMethodNames[
      controllerName
    ]

    // 1. 只用 path 生成 methodName
    const pathParts = path.split("/").filter(Boolean)
    let partStartIndex = pathParts.length > 0 ? pathParts.length - 1 : -1
    let partsIndex = []
    const isParam = (part: string) => /^\{.+\}$/.test(part)
    let methodName = ""
    let bySuffix = ""

    while (partStartIndex >= 0) {
      const part = pathParts[partStartIndex]
      if (isParam(part)) {
        partStartIndex--
        // 提取参数名
        const paramName = part.replace(/[{}]/g, "")
        console.log(
          "%c [ paramName ]-228",
          "font-size:12px; background:#b20392; color:#f647d6;",
          paramName
        )
        if (!bySuffix) {
          if (!methodName.includes("By")) {
            bySuffix =
              "By" + paramName.charAt(0).toUpperCase() + paramName.slice(1)
          } else {
            bySuffix = paramName.charAt(0).toUpperCase() + paramName.slice(1)
          }
        }
        console.log(
          "%c [ bySuffix ]-234",
          "font-size:12px; background:#8da045; color:#d1e489;",
          bySuffix
        )
      } else {
        partsIndex.unshift(partStartIndex)
        let n_methodName = partsIndex
          .map((item) => {
            const str = pathParts[item] || ""
            if (!str) return ""
            return str.charAt(0).toUpperCase() + str.slice(1)
          })
          .join("")
        n_methodName += bySuffix
        if (usedNames.has(`${controllerName}.${n_methodName}`)) {
          partStartIndex--
        } else {
          partStartIndex = -1
        }
      }
    }
    methodName = partsIndex
      .map((item) => {
        const str = pathParts[item] || ""
        if (!str) return ""
        return str.charAt(0).toUpperCase() + str.slice(1)
      })
      .join("")
    methodName = methodName + bySuffix
    console.log(
      "%c [ bySuffix ]-261",
      "font-size:12px; background:#3961be; color:#7da5ff;",
      bySuffix
    )

    console.log(
      "%c [ `${controllerName}.${methodName}` ]-278",
      "font-size:12px; background:#984309; color:#dc874d;",
      `${controllerName}.${methodName}`
    )
    // 如果 methodName 为空或已全部重复，则用 operationId
    if (!methodName || usedNames.has(`${controllerName}.${methodName}`)) {
      methodName = this.sanitizeName(
        operation.operationId || this.getOperationId(path, method)
      )
    }

    usedNames.add(`${controllerName}.${methodName}`)

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

    return `  /**
   * ${operation.summary || ""}${
      operation.description ? "\n  * " + operation.description : ""
    }${operation.deprecated ? "\n  * @deprecated true" : ""}${
      operation.callbacks ? "\n * @returns " : ""
    }
   */
  static ${methodName}(${paramsType}): Promise<${returnType}> {
    return new Promise((resolve, reject) => {
      const url = \`${processedPath}\`;
      const configs = getConfigs(
        '${method}',
        '${requestContentType}',
        url,
        options
      );
      ${params}
      ${requestBody}
      ${securityConfig}
      request(configs, resolve, reject);
    });
  }`
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

  private getResponseContentType(operation: any): string {
    if (operation.responses) {
      const successResponse = operation.responses["200"]
      if (successResponse && successResponse.content) {
        // 优先使用 application/json
        if (successResponse.content["application/json"]) {
          return "application/json"
        }
        // 检查其他内容类型
        const contentType = Object.keys(successResponse.content)[0]
        if (contentType) {
          return contentType
        }
      }
    }
    return "application/json"
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

  private getOperationId(path: string, method: string): string {
    const pathParts = path.split("/").filter(Boolean)
    const lastPart = pathParts[pathParts.length - 1]
    return `${method.toLowerCase()}${
      lastPart.charAt(0).toUpperCase() + lastPart.slice(1)
    }`
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
