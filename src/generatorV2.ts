import * as fs from "fs"
import * as path from "path"
import { OpenAPIV2 } from "openapi-types"
import { SchemaObject } from "openapi-typescript"
export class ApiGenerator {
  /**
   * 泛型类型
   */
  private genericTypes: string[] = []
  /**
   * 泛型类型特殊符号都换成<，字符串拼接时，直接使用
   */
  private returnType: Map<string, string> = new Map()

  /**
   * 实体转类型
   */
  private typeNames: string[] = []
  /**
   * 类型的properties中有enum则定义枚举，先有名字后生成enum
   */
  private genericEnums: Map<string, string[]> = new Map()

  private initializeTypeNames(apiDocs: any): void {
    // if (apiDocs.components?.schemas) {
    //   Object.keys(apiDocs.components.schemas).forEach((name) => {
    //     this.typeNames.push(this.sanitizeName(name))
    //   })
    // }
    // if (apiDocs.definitions) {
    //   Object.keys(apiDocs.definitions).forEach((name) => {
    //     this.typeNames.push(this.sanitizeName(name))
    //   })
    // }
  }

  async generate(apiDocs: any, framework: string, outputType: string, outputPath: string): Promise<void> {
    try {
      if (!this.isValidApiDoc(apiDocs)) {
        throw new Error("无效的API文档")
      }

      this.initializeTypeNames(apiDocs)

      const code = this.generateCode(apiDocs)

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
  private sanitizeName(name: string): string {
    return String(name).replace(/[^\u4e00-\u9fa5a-zA-Z0-9_]/g, "_")
  }
  private isOpenApi(doc: any): boolean {
    // swagger 2.0 uses the `swagger` field
    return doc.swagger && doc.swagger.startsWith("2.")
  }
  private getTypByProperties(p: OpenAPIV2.SchemaObject | any): string {
    if (!p) return "any"
    if ((p as any).$ref) {
      const ref = (p as any).$ref as string
      const typeName = ref.split("/").pop() || "any"
      const sanitized = this.sanitizeName(typeName)
      if (this.typeNames.includes(sanitized)) return sanitized
      return sanitized
    }
    if (p.type === "array") {
      return `${this.getTypByProperties(p.items as OpenAPIV2.SchemaObject)}[]`
    }
    if (p.type === "object") {
      if (p.properties) {
        const props = Object.entries(p.properties).map(([k, v]: [string, any]) => {
          const schema = v as OpenAPIV2.SchemaObject
          return `"${k}": ${this.getTypByProperties(schema)}`
        })
        if (p.additionalProperties) {
          props.push(`[key: string]: ${this.getTypByProperties(p.additionalProperties as OpenAPIV2.SchemaObject)}`)
        }
        return `{ ${props.join(", ")} }`
      }
      return "any"
    }
    if (p.type === "string") {
      if ((p as any).enum) return (p as any).enum.map((v: string) => `'${v}'`).join(" | ")
      return "string"
    }
    if (p.type === "number" || p.type === "integer") return "number"
    if (p.type === "boolean") return "boolean"
    if (p.type === "file") return "File"
    return "any"
  }
  /**
   * 生成泛型类型
   */
  private generateGenericTypes(apiDocs: OpenAPIV2.Document) {
    const getTypeByPropertie = (p: OpenAPIV2.SchemaObject) => {
      let type = p.type || "any"
      if ((p.items && p.items.$ref) || (!p.items && !!p.$ref)) {
        if (p?.type === "array") {
          type = "T[]"
        } else {
          type = `T`
        }
      }
      if (p.type === "number" || p.type === "integer") {
        return "number"
      }
      if (p.type === "boolean") {
        return "boolean"
      }
      if (p.type === "file") {
        return "File"
      }
      return type
    }

    let genericTypesStr: string[] = []
    const definitions = apiDocs.definitions || {}

    this.genericTypes.map((item) => {
      let genericType = ""
      let findTypeKey = Object.entries(definitions).find(([name]) => name.startsWith(item) && name.match(/[«《<]/g))
      if (findTypeKey) {
        const key = findTypeKey[0]
        const properties = findTypeKey[1]?.properties || {}
        const required: string[] = (properties?.required || []) as string[]
        let propertyDefs: string[] = []
        for (const [key, typeObj] of Object.entries(properties)) {
          const isRequired = required.includes(key)
          propertyDefs.push(`/** ${typeObj?.description} */\n${key}${isRequired ? "" : "?"}: ${getTypeByPropertie(typeObj)}`)
        }
        if (!!definitions[key].additionalProperties) {
          genericType = `\nexport type ${item}<T extends string | number | symbol = string, U = any> = {\n[key in T]: U\n}`
        } else {
          genericType = `\nexport interface ${item}<T=any> {\n${propertyDefs.join("\n")}\n}`
        }

        genericTypesStr.push(genericType)
      }
    })
    return genericTypesStr
  }
  /**
   * 生成类型
   */
  private generateInterfaceType(apiDocs: OpenAPIV2.Document) {
    const types: string[] = []
    const definitions = apiDocs.definitions || {}
    this.typeNames.map((item) => {
      const name = item
      const schema = definitions[item]
      if (schema) {
        const s = schema as OpenAPIV2.SchemaObject
        if (s.type === "object" || s.properties) {
          const properties = s.properties || {}
          const required: string[] = (s.required || []) as string[]
          const propertyDefs = Object.entries(properties).map(([propName, propSchema]) => {
            const sanitizedPropName = this.sanitizeName(propName)
            const isRequired = required.includes(propName)
            const type = this.getTypByProperties(propSchema as OpenAPIV2.SchemaObject)
            return `  /** ${(propSchema as any).description || ""} */\n  ${sanitizedPropName}${isRequired ? "" : "?"}: ${type};`
          })
          types.push(`export interface ${this.sanitizeName(name)} {\n${propertyDefs.join("\n")}
}`)
        }
      }
    })
    return types
  }

  private generateController(apiDocs: OpenAPIV2.Document) {
    const controllers: Map<string, string[]> = new Map()
    const paramTypes: string[] = []

    for (const [p, pathItem] of Object.entries(apiDocs.paths || {})) {
      const pathItemObj = pathItem as any
      if (!pathItemObj) continue
      for (const [method, operation] of Object.entries(pathItemObj)) {
        const op = operation as any
        if (!op || typeof op !== "object") continue

        // determine tag and controller name
        const tag = op.tags?.[0] || "Default"
        const controllerName = this.sanitizeName(tag)
        if (!controllers.has(controllerName)) controllers.set(controllerName, [])

        // create unique method name similar to generatorV3
        if (!(globalThis as any)._controllerMethodNames) (globalThis as any)._controllerMethodNames = {}
        if (!(globalThis as any)._controllerMethodNames[controllerName]) (globalThis as any)._controllerMethodNames[controllerName] = new Set()
        const usedNames: Set<string> = (globalThis as any)._controllerMethodNames[controllerName]

        const pathParts = (p as string).split("/").filter(Boolean)
        let partStartIndex = pathParts.length > 0 ? pathParts.length - 1 : -1
        let partsIndex: number[] = []
        const isParam = (part: string) => /^\{.+\}$/.test(part)
        let bySuffix = ""

        while (partStartIndex >= 0) {
          const part = pathParts[partStartIndex]
          if (isParam(part)) {
            partStartIndex--
            const paramName = part.replace(/[{}]/g, "")
            if (!bySuffix) {
              if (!partsIndex.join("").includes("By")) {
                bySuffix = "By" + paramName.charAt(0).toUpperCase() + paramName.slice(1)
              } else {
                bySuffix = paramName.charAt(0).toUpperCase() + paramName.slice(1)
              }
            }
          } else {
            partsIndex.unshift(partStartIndex)
            const n_methodName =
              partsIndex
                .map((item) => {
                  const str = pathParts[item] || ""
                  if (!str) return ""
                  return str.charAt(0).toUpperCase() + str.slice(1)
                })
                .join("") + bySuffix
            if (usedNames.has(`${controllerName}.${n_methodName}`)) {
              partStartIndex--
            } else {
              partStartIndex = -1
            }
          }
        }

        let methodName = partsIndex
          .map((item) => {
            const str = pathParts[item] || ""
            if (!str) return ""
            return str.charAt(0).toUpperCase() + str.slice(1)
          })
          .join("")
        methodName = methodName + bySuffix
        if (!methodName || usedNames.has(`${controllerName}.${methodName}`)) {
          methodName = this.sanitizeName(op.operationId || this.getOperationId(p as string, method))
        }
        usedNames.add(`${controllerName}.${methodName}`)

        // params type generation
        const paramsName = `${controllerName}${methodName}Params`
        const paramsProps: string[] = []
        const seenFields = new Set<string>()

        // collect parameters array (path, query, header, formData, body)
        const parameters = (op.parameters || []) as any[]
        for (const param of parameters) {
          if ((param as any).$ref) continue
          const inType = param.in
          if (inType === "body") {
            const schema = param.schema as OpenAPIV2.SchemaObject
            const t = this.getTypByProperties(schema)
            if (!seenFields.has("body")) {
              paramsProps.push(`  body${param.required ? "" : "?"}: ${t}`)
              seenFields.add("body")
            }
          } else if (inType === "formData") {
            const schemaType = (param as any).type ? this.getTypByProperties(param as any) : "any"
            const key = "formData" + (param.name ? `_${param.name}` : "")
            if (!seenFields.has(key)) {
              // collect individual form fields under formData object
              // we'll represent as formData?: { field: type }
              paramsProps.push(`  formData${param.required ? "" : "?"}: { ${param.name}: ${schemaType} }`)
              seenFields.add(key)
            }
          } else {
            const pname = param.name
            if (!seenFields.has(pname)) {
              const t = param.type ? this.getTypByProperties(param as any) : this.getTypByProperties(param.schema)
              paramsProps.push(`/** ${param?.description ? param?.description: ''} */\n  "${pname}"${param.required ? "" : "?"}: ${t}`)
              seenFields.add(pname)
            }
          }
        }

        // if no params found, keep empty object
        // if (paramsProps.length === 0) paramsProps.push("  // no params")

        // decide whether to generate a separate Params interface
        const uniqueFieldCount = paramsProps.length
        let paramsTypeUsage = "params: { } = {} as any, options: RequestConfig = {}"
        if (uniqueFieldCount > 5) {
          // create params interface
          paramTypes.push(`export interface ${paramsName} {\n${paramsProps.join("\n")}\n}`)
          paramsTypeUsage = `params: ${paramsName} = {} as any, options: RequestConfig = {}`
        } else if (uniqueFieldCount === 0) {
          paramsTypeUsage = "params: { } = {} as any, options: RequestConfig = {}"
        } else {
          // inline the params type
          const inlineType = paramsProps.length > 0 ? `{\n ${paramsProps.map((p) => p.replace(/^\s+/, "")).join(",\n")}  \n}` : "{ }"
          paramsTypeUsage = `params: ${inlineType} = {} as any, options: RequestConfig = {}`
        }

        // determine return type
        let returnType = "any"
        if (op.responses) {
          const resp = op.responses["200"] || op.responses["default"]
          if (resp && resp.schema) {
            const schema = resp.schema as OpenAPIV2.SchemaObject
            // Determine originalRef: prefer schema.originalRef, otherwise fallback to $ref last segment
            const orig = (schema as any).originalRef || ((schema as any).$ref ? ((schema as any).$ref as string).split("/").pop() : undefined)
            if (orig) {
              // if originalRef is a generic-style name, prefer mapped generic returnType if available
              const matchName = orig.match(/[«《<]/g) || []
              if (matchName.length !== 0) {
                const mapped = this.returnType.get(orig)
                if (mapped) {
                  returnType = mapped
                } else {
                  // still record generic mapping if not present
                  this.returnType.set(orig, orig.replace(/[«《<]/g, "<").replace(/[»》>]/g, ">"))
                  const base = orig.substring(0, orig.search(/[«《<]/g))
                  if (!this.genericTypes.includes(base)) this.genericTypes.push(base)
                  returnType = orig.replace(/[«《<]/g, "<").replace(/[»》>]/g, ">")
                }
              } else {
                // non-generic: sanitize name
                returnType = this.sanitizeName(orig)
              }
            } else if ((schema as any).$ref) {
              // as a last fallback, derive name from $ref
              const refPath = (schema as any).$ref as string
              const refName = refPath.split("/").pop() || "any"
              returnType = this.sanitizeName(refName)
            } else {
              returnType = this.getTypByProperties(schema)
            }
          }
        }

        // process path inline params replacement
        let processedPath = p as string
        const pathParams = (op.parameters || []).filter((param: any) => param.in === "path").map((param: any) => param.name)
        pathParams.forEach((paramName: string) => {
          const paramPattern = `{${paramName}}`
          if (processedPath.includes(paramPattern)) {
            // insert a literal ${params.xxx} into the generated code
            processedPath = processedPath.replace(paramPattern, "${params." + paramName + "}")
          }
        })

        // request content type (formData/body)
        const requestContentType = (op.parameters || []).some((p: any) => p.in === "formData") ? "multipart/form-data" : "application/json"

        const methodCode =
          "  /**\n   * " +
          (op.summary || "") +
          (op.description && op.summary !== op.description ? "\n   * " + op.description : "") +
          (op.deprecated ? "\n   * @deprecated true" : "") +
          (op.example ? "\n   * @example " + op.example || op?.["x-example"] : "") +
          "\n   */\n  static " +
          methodName +
          "(" +
          paramsTypeUsage +
          "): Promise<" +
          returnType +
          "> {\n    return new Promise((resolve, reject) => {\n      const url = `" +
          processedPath +
          "`;\n      const configs = getConfigs('" +
          method +
          "', '" +
          requestContentType +
          "', url, options);\n      configs.params = params;\n      request(configs, resolve, reject);\n    });\n  }"

        controllers.get(controllerName)?.push(methodCode)
      }
    }

    // assemble controller classes
    const controllerClasses: string[] = []
    for (const [controllerName, methods] of controllers) {
      const description = (apiDocs.tags || []).find((t: any) => t.name === controllerName)?.description || ""
      controllerClasses.push(`\n/**\n * ${description}\n */\nexport class ${controllerName} {\n${methods.join("\n\n")}\n}`)
    }

    return { controllerClasses, paramTypes }
  }

  private getOperationId(path: string, method: string): string {
    const pathParts = path.split("/").filter(Boolean)
    const lastPart = pathParts[pathParts.length - 1] || ""
    return `${method.toLowerCase()}${lastPart.charAt(0).toUpperCase() + lastPart.slice(1)}`
  }

  private generateCode(apiDocs: OpenAPIV2.Document) {
    const definitions = apiDocs.definitions || {}
    for (const [name, schema] of Object.entries(definitions)) {
      const matchName = name.match(/[«《<]/g) || []

      if (matchName.length > 0) {
        this.returnType.set(name, name.replace(/[«《<]/g, "<").replace(/[»》>]/g, ">"))
        const genericTypesName = name.substring(0, name.search(/[«《<]/g))
        if (!this.genericTypes.includes(genericTypesName)) {
          this.genericTypes.push(genericTypesName)
        }
      }
    }

    for (const [name, schema] of Object.entries(definitions)) {
      const matchName = name.match(/[«《<]/g) || []
      if (matchName.length === 0) {
        if (!this.genericTypes.includes(name) === true) {
          this.typeNames.push(name)
        }
      }
    }
    const genericTypesStr = this.generateGenericTypes(apiDocs)
    // generate non-generic interface types
    const types = this.generateInterfaceType(apiDocs)

    // generate controllers and parameter types
    const { controllerClasses, paramTypes } = this.generateController(apiDocs)

    const code = `\nimport requestClass, { getConfigs, type RequestConfig } from "@/utils/request"\nconst { fetch:request} = requestClass\n\n// 生成时间: ${new Date().toISOString()}\n\n// 泛型类型\nexport type List<T> = Array<T>\nexport type Collection<T> = Array<T>\n${genericTypesStr.join("\n\n")}\n\n// 类型定义\n${types.join("\n\n")}\n\n// 参数类型\n${paramTypes.join("\n\n")}\n\n// Controller类\n${controllerClasses.join("\n\n")}\n`

    return code
  }
}
