// ...existing code...
import * as fs from "fs"
import * as path from "path"
import { OpenAPIV3 } from "openapi-types"

export class ApiGenerator {
  private typeNames: string[] = []

  private initializeTypeNames(apiDocs: any): void {
    if (apiDocs.components?.schemas) {
      Object.keys(apiDocs.components.schemas).forEach((name) => {
        this.typeNames.push(this.sanitizeName(name))
      })
    }
    if (apiDocs.definitions) {
      Object.keys(apiDocs.definitions).forEach((name) => {
        this.typeNames.push(this.sanitizeName(name))
      })
    }
  }

  async generate(apiDocs: any, framework: string, outputType: string, outputPath: string): Promise<void> {
    try {
      if (!this.isValidApiDoc(apiDocs)) {
        throw new Error("无效的API文档")
      }

      this.initializeTypeNames(apiDocs)

      const code = this.generateCode(apiDocs, framework, outputType)

      const outputDir = path.dirname(outputPath)
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }

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

  private generateCode(apiDocs: any, framework: string, outputType: string): string {
    const types: string[] = []
    const controllers: Map<string, string[]> = new Map()

    // 生成类型定义 (兼容 OpenAPI3 和 Swagger2)
    if (this.isOpenApi3(apiDocs)) {
      if (apiDocs.components && apiDocs.components.schemas) {
        for (const [name, schema] of Object.entries(apiDocs.components.schemas)) {
          if (this.isSchemaObject(schema) && (schema as any).type === "object") {
            const typeDef = this.generateTypeDefinition(this.sanitizeName(name), schema, apiDocs)
            types.push(typeDef)
          }
        }
      }
    } else {
      if (apiDocs.definitions) {
        for (const [name, schema] of Object.entries(apiDocs.definitions)) {
          if (this.isSchemaObject(schema) && (schema as any).type === "object") {
            const typeDef = this.generateTypeDefinition(this.sanitizeName(name), schema, apiDocs)
            types.push(typeDef)
          }
        }
      }
    }

    // 生成服务方法并按 tag 分组
    for (const [p, pathItem] of Object.entries(apiDocs.paths)) {
      const path = p
      if (pathItem) {
        for (const [method, operation] of Object.entries(pathItem)) {
          if (operation && typeof operation === "object") {
            const serviceMethod = this.generateServiceMethod(path, method, operation, apiDocs)
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

    // 生成 controller 类（包含 tag 描述，如果存在）
    const controllerClasses: string[] = []
    for (const [controllerName, methods] of controllers) {
      const description = (apiDocs.tags || []).find((t: any) => t.name === controllerName)?.description || ""
      const controllerClass = `
/**
 * ${description}
 */
export class ${controllerName} {
${methods.join("\n\n")}
}`
      controllerClasses.push(controllerClass)
    }

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
    return String(name).replace(/[^\u4e00-\u9fa5a-zA-Z0-9_]/g, "_")
  }

  private generateTypeDefinition(name: string, schema: any, apiDocs: any): string {
    const properties = schema.properties || {}
    const required = schema.required || []

    const propertyDefs = Object.entries(properties).map(([propName, propSchema]) => {
      console.log('%c [ propSchema ]-141', 'font-size:12px; background:#a58eed; color:#e9d2ff;', propSchema)
      const sanitizedPropName = this.sanitizeName(propName)
      const isRequired = required.includes(propName)
      const type = this.getTypeScriptType(propSchema, apiDocs)
      const desc =
        propSchema && typeof propSchema === "object" && ("description" in propSchema || "title" in propSchema)
          ? (propSchema as { description?: string; title?: string }).description || (propSchema as { title?: string }).title || ""
          : ""
      return `  /** ${desc} */\n  ${sanitizedPropName}${isRequired ? "" : "?"}: ${type};`
    })

    return `export interface ${name} {\n${propertyDefs.join("\n")}\n}`
  }

  private generateServiceMethod(path: string, method: string, operation: any, apiDocs: any): string {
    // 保证 controller 内方法名唯一
    if (!(globalThis as any)._controllerMethodNames) {
      ;(globalThis as any)._controllerMethodNames = {}
    }
    const tag = operation.tags?.[0] || "Default"
    const controllerName = this.sanitizeName(tag)
    if (!(globalThis as any)._controllerMethodNames[controllerName]) {
      ;(globalThis as any)._controllerMethodNames[controllerName] = new Set()
    }
    const usedNames: Set<string> = (globalThis as any)._controllerMethodNames[controllerName]

    // 使用 path 生成友好方法名，遇到 path 参数则加 ByX 后缀
    const pathParts = path.split("/").filter(Boolean)
    const isParam = (part: string) => /^\{.+\}$/.test(part)
    let partStartIndex = pathParts.length - 1
    let partsIndex: number[] = []
    let bySuffix = ""

    while (partStartIndex >= 0) {
      const part = pathParts[partStartIndex]
      if (isParam(part)) {
        const paramName = part.replace(/[{}]/g, "")
        if (!bySuffix) {
          bySuffix = "By" + paramName.charAt(0).toUpperCase() + paramName.slice(1)
        } else {
          bySuffix = paramName.charAt(0).toUpperCase() + paramName.slice(1) + bySuffix
        }
        partStartIndex--
      } else {
        partsIndex.unshift(partStartIndex)
        const n_methodName =
          partsIndex
            .map((i) => {
              const str = pathParts[i] || ""
              if (!str) return ""
              return str.charAt(0).toUpperCase() + str.slice(1)
            })
            .join("") + bySuffix
        if (usedNames.has(`${controllerName}.${n_methodName}`)) {
          partStartIndex--
        } else {
          break
        }
      }
    }

    let methodName =
      partsIndex
        .map((i) => {
          const str = pathParts[i] || ""
          return str ? str.charAt(0).toUpperCase() + str.slice(1) : ""
        })
        .join("") + bySuffix

    if (!methodName || usedNames.has(`${controllerName}.${methodName}`)) {
      methodName = this.sanitizeName(operation.operationId || this.getOperationId(path, method))
    }

    usedNames.add(`${controllerName}.${methodName}`)

    const paramsType = this.getParamsType(operation, apiDocs)
    const returnType = this.getReturnType(operation, apiDocs)

    // 处理路径中的行内参数（兼容 OAS2/OAS3）
    let processedPath = path
    const opParameters = operation.parameters || []
    const pathParams = opParameters.filter((p: any) => p.in === "path").map((p: any) => p.name)
    pathParams.forEach((paramName: string) => {
      const paramPattern = `{${paramName}}`
      if (processedPath.includes(paramPattern)) {
        processedPath = processedPath.replace(paramPattern, `\${params.${paramName}}`)
      }
    })

    // 处理参数/请求体
    const hasParameters = (operation.parameters && operation.parameters.length > 0) || !!operation.requestBody
    const isGetMethod = method.toLowerCase() === "get"
    const shouldSetParams = isGetMethod || hasParameters
    let params = shouldSetParams ? "configs.params = params;" : ""

    let requestBody = ""
    // Swagger2: body 参数在 parameters 中，OpenAPI3: requestBody
    if (operation.requestBody) {
      const content = operation.requestBody.content || {}
      if (content["application/json"]) {
        requestBody = 'configs.data = params["body"]'
        if (params) {
          params = `
          const {body,...new_params} = params;
          configs.params = new_params;
          `
        }
      } else if (content["multipart/form-data"]) {
        requestBody = 'configs.data = params["formData"]'
        if (params) {
          params = `
          const {formData,...new_params} = params;
          configs.params = new_params;
          `
        }
      } else if (content["application/x-www-form-urlencoded"]) {
        requestBody = 'configs.data = params["formData"]'
        if (params) {
          params = `
          const {formData,...new_params} = params;
          configs.params = new_params;
          `
        }
      }
    } else if (operation.parameters) {
      const bodyParam = operation.parameters.find((p: any) => p.in === "body")
      if (bodyParam) {
        requestBody = 'configs.data = params["body"]'
        if (params) {
          params = `
          const {body,...new_params} = params;
          configs.params = new_params;
          `
        }
      }
    }

    const requestContentType = this.getRequestContentType(operation)
    const securityConfig = this.getSecurityConfig(operation)

    return `  /**
   * ${operation.summary || ""}${operation.description ? "\n  * " + operation.description : ""}${operation.deprecated ? "\n  * @deprecated true" : ""}${operation.callbacks ? "\n * @returns " : ""}
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
          securityConfigs.push(`configs.headers['Authorization'] = 'Bearer ${name}';`)
        } else {
          securityConfigs.push(`configs.headers['${name}'] = '${scopes}';`)
        }
      })
    })

    return securityConfigs.join("\n      ")
  }

  private getResponseContentType(operation: any): string {
    // OAS2: produces / responses[].schema
    if (operation.produces && operation.produces.length > 0) {
      return operation.produces[0]
    }
    // OAS3: responses[].content
    if (operation.responses) {
      const success = operation.responses["200"] || operation.responses["201"] || operation.responses["default"]
      if (success) {
        if (success.content) {
          if (success.content["application/json"]) return "application/json"
          const ct = Object.keys(success.content)[0]
          if (ct) return ct
        } else if (success.schema) {
          return "application/json"
        } else if (success.examples) {
          const exampleType = Object.keys(success.examples)[0]
          if (exampleType) return exampleType
        }
      }
    }
    return "application/json"
  }

  private getParamsType(operation: any, apiDocs: any): string {
    const params: string[] = []

    if (operation.parameters) {
      operation.parameters.forEach((param: any) => {
        if (this.isParameterObject(param)) {
          const paramName = param.name
          const isRequired = param.required === true
          const schema = param.schema || param
          const type = this.getTypeScriptType(schema, apiDocs)
          // collectionFormat on swagger2
          if (param.collectionFormat) {
            switch (param.collectionFormat) {
              case "csv":
              case "ssv":
              case "tsv":
              case "pipes":
              case "multi":
                params.push(`"${paramName}"${isRequired ? "" : "?"}: string[]`)
                break
              default:
                params.push(`"${paramName}"${isRequired ? "" : "?"}: ${type}`)
            }
          } else {
            params.push(`"${paramName}"${isRequired ? "" : "?"}: ${type}`)
          }
        }
      })
    }

    // 请求体
    if (operation.requestBody) {
      const content = operation.requestBody.content || {}
      if (content["application/json"]) {
        const schema = content["application/json"].schema
        if (schema) {
          params.push(`body: ${this.getTypeScriptType(schema, apiDocs)}`)
        }
      } else if (content["multipart/form-data"] || content["application/x-www-form-urlencoded"]) {
        const key = content["multipart/form-data"] ? "multipart/form-data" : "application/x-www-form-urlencoded"
        const schema = content[key].schema
        if (schema) {
          params.push(`formData: ${this.getTypeScriptType(schema, apiDocs)}`)
        }
      }
    } else if (operation.parameters) {
      const bodyParam = operation.parameters.find((p: any) => p.in === "body")
      if (bodyParam && bodyParam.schema) {
        params.push(`body: ${this.getTypeScriptType(bodyParam.schema, apiDocs)}`)
      }
    }

    return `params: {${params.join(", ")}} = {} as any, options: RequestConfig = {} `
  }

  private getReturnType(operation: any, apiDocs: any): string {
    if (operation.responses) {
      const success = operation.responses["200"] || operation.responses["201"] || operation.responses["default"]
      if (success) {
        // OAS3
        if (success.content) {
          if (success.content["application/json"]) {
            const schema = success.content["application/json"].schema
            if (schema) return this.getTypeScriptType(schema, apiDocs)
          }
          const ct = Object.keys(success.content)[0]
          if (ct) {
            const schema = success.content[ct].schema
            if (schema) return this.getTypeScriptType(schema, apiDocs)
          }
        }
        // OAS2
        if (success.schema) {
          return this.getTypeScriptType(success.schema, apiDocs)
        }
      }
    }
    return "any"
  }

  private processGenericType(type: string): string {
    // 保留原实现（可按需优化）
    const matches = type.match(/《([^》]+)》/g)
    if (!matches) return type

    const types = matches.map((match) => match.slice(1, -1))
    const typeCount = new Map<string, number>()
    types.forEach((t) => {
      typeCount.set(t, (typeCount.get(t) || 0) + 1)
    })

    let processedType = type
    typeCount.forEach((count, t) => {
      if (count > 1) {
        if (t === "any" || t === "object") {
          processedType = processedType.replace(new RegExp(`《${t}》`, "g"), "T")
        } else {
          processedType = processedType.replace(new RegExp(`《${t}》`, "g"), `T${t}`)
        }
      }
    })

    const genericParams = Array.from(typeCount.entries())
      .filter(([_, count]) => count > 1)
      .map(([t]) => (t === "any" || t === "object" ? "T" : `T${t}`))
      .join(", ")

    if (genericParams) {
      processedType = `<${genericParams}>${processedType}`
    }

    return processedType
  }

  private getTypeScriptType(schema: any, apiDocs: any): string {
    if (!schema) return "any"

    // $ref 处理（兼容 #/components/schemas/Name 与 #/definitions/Name）
    if ("$ref" in schema) {
      const refPath = schema.$ref
      const typeName = refPath.split("/").pop()
      if (typeName) {
        const sanitized = this.sanitizeName(typeName)
        if (this.typeNames.includes(sanitized)) return sanitized
      }
      const refType = this.resolveRef(refPath, apiDocs)
      if (refType) return this.getTypeScriptType(refType, apiDocs)
      return "any"
    }

    if (schema.type === "array") {
      return `${this.getTypeScriptType(schema.items, apiDocs)}[]`
    }
    if (schema.type === "object") {
      if (schema.title) {
        const sanitized = this.sanitizeName(schema.title)
        if (this.typeNames.includes(sanitized)) return sanitized
      }
      if (schema.properties) {
        const properties = Object.entries(schema.properties).map(([name, prop]: [string, any]) => {
          const isRequired = schema.required?.includes(name) || false
          return `"${name}"${isRequired ? "" : "?"}: ${this.getTypeScriptType(prop, apiDocs)}`
        })
        if (schema.additionalProperties) {
          properties.push(`[key: string]: ${this.getTypeScriptType(schema.additionalProperties, apiDocs)}`)
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
    const lastPart = pathParts[pathParts.length - 1] || ""
    return `${method.toLowerCase()}${lastPart.charAt(0).toUpperCase() + lastPart.slice(1)}`
  }

  private getRequestContentType(operation: any): string {
    // OAS2: consumes
    if (operation.consumes && operation.consumes.length > 0) {
      return operation.consumes[0]
    }
    // OAS3: requestBody.content
    if (operation.requestBody && operation.requestBody.content) {
      if (operation.requestBody.content["application/json"]) return "application/json"
      if (operation.requestBody.content["multipart/form-data"]) return "multipart/form-data"
      if (operation.requestBody.content["application/x-www-form-urlencoded"]) return "application/x-www-form-urlencoded"
      const ct = Object.keys(operation.requestBody.content)[0]
      if (ct) return ct
    }

    // 如果 parameters 包含 body (swagger2)
    if (operation.parameters) {
      const body = operation.parameters.find((p: any) => p.in === "body")
      if (body) return "application/json"
    }

    return "application/json"
  }

  private resolveRef(refPath: string, apiDocs: any): any {
    if (!refPath) return null
    // 支持 "#/components/schemas/Name" 或 "#/definitions/Name" 或 "/components/..."（相对）
    const cleaned = refPath.replace(/^#\//, "").replace(/^\//, "")
    const parts = cleaned.split("/")
    let current = apiDocs
    for (const part of parts) {
      if (current && part in current) {
        current = current[part]
      } else {
        return null
      }
    }
    return current
  }
}
