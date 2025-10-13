// ...existing code...
import * as fs from "fs"
import * as path from "path"
import { OpenAPIV3 } from "openapi-types"

export class ApiGenerator {
  private typeNames: string[] = []
  // 存放泛型基名 -> { genericName, concreteNames }
  private genericMap: Map<string, { genericName: string; concreteNames: string[] }> = new Map()

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
    const enums: string[] = []
    const controllers: Map<string, string[]> = new Map()
    // 用于存放识别到的泛型基名 -> 列表(具体名)
    const genericCandidates: Map<string, { concreteNames: string[]; representativeSchema: any }> = new Map()

    // 生成类型定义 (兼容 OpenAPI3 和 Swagger2)
    // 第一步：扫描 schema 名称，识别类似 "接口返回对象«X»" 或 "接口返回对象《X》" 的泛型候选项
    const schemasSource = this.isOpenApi3(apiDocs) ? apiDocs.components?.schemas || {} : apiDocs.definitions || {}
    for (const [name, schema] of Object.entries(schemasSource)) {
      // 匹配多种括号样式：《》, «», <>
      const m = String(name).match(/^(.*?)[«《<]([^»》>]+)[»》>]$/)
      if (m) {
        const base = m[1]
        const inner = m[2]
        if (!genericCandidates.has(base)) {
          genericCandidates.set(base, { concreteNames: [], representativeSchema: schema })
        }
        genericCandidates.get(base)!.concreteNames.push(String(name))
      }
    }

    // 对于检测到的泛型基名，如果出现多种具体实现（>1），我们会生成一个泛型接口并跳过为每个具体名生成重复类型
    const genericDefinitions: string[] = []
    const generatedGenericBases = new Set<string>()
    for (const [base, info] of genericCandidates) {
      if (info.concreteNames.length > 1) {
        const genericBaseSan = this.sanitizeName(base)
        if (!generatedGenericBases.has(genericBaseSan)) {
          const genericDef = this.generateGenericTypeDefinition(genericBaseSan, info.representativeSchema, info.concreteNames, apiDocs)
          if (genericDef) {
            genericDefinitions.push(genericDef)
            generatedGenericBases.add(genericBaseSan)
          }
        }
      }
    }

    // 将泛型接口放到 types 里（优先）
    types.push(...genericDefinitions)
    // 为每个被泛型覆盖的具体 wrapper 生成 type alias 指向泛型实例，保证引用类型存在且含泛型参数
    for (const [base, info] of genericCandidates) {
      const genericBaseSan = this.sanitizeName(base)
      if (!generatedGenericBases.has(genericBaseSan)) continue
      for (const rawConcrete of info.concreteNames) {
        const sanitizedConcrete = this.sanitizeName(rawConcrete)
        // 找到具体 schema 以解析 inner type
        let concreteSchema = schemasSource[rawConcrete]
        if (!concreteSchema) {
          const alt = this.sanitizeName(rawConcrete)
          concreteSchema = schemasSource[alt] || schemasSource[String(rawConcrete).replace(/[«»《》<>]/g, "")]
        }
        let innerType = "any"
        if (concreteSchema && concreteSchema.properties) {
          const data = concreteSchema.properties.data || concreteSchema.properties.result
          if (data) {
            if (data.$ref) {
              const name = data.$ref.split("/").pop()
              innerType = name ? this.sanitizeName(name) : "any"
            } else if (data.type === "array" && data.items && data.items.$ref) {
              const name = data.items.$ref.split("/").pop()
              innerType = name ? `${this.sanitizeName(name)}[]` : "any[]"
            } else {
              innerType = this.getTypeScriptType(data, apiDocs)
            }
          }
        }
        const alias = `export type ${sanitizedConcrete} = ${genericBaseSan}<${innerType}>;`
        // 避重：如果已存在相同 alias，跳过
        if (!types.includes(alias)) types.push(alias)
      }
    }
    // 收集在 generateTypeDefinition 中产生的 property-level enums
    const generatedEnums: string[] = []
    if ((this as any).__generatedEnums instanceof Map) {
      for (const enumDef of (this as any).__generatedEnums.values()) generatedEnums.push(enumDef)
    }
    // 将 enums 放在 types 之前
    if (generatedEnums.length > 0) {
      types.unshift(...generatedEnums)
    }

    // 然后正常生成其他类型，跳过被泛型覆盖的具体 wrapper 名称
    const skipNames = new Set<string>()
    for (const info of genericCandidates.values()) {
      if (info.concreteNames.length > 1) info.concreteNames.forEach((n) => skipNames.add(String(n)))
    }

    if (this.isOpenApi3(apiDocs)) {
      if (apiDocs.components && apiDocs.components.schemas) {
        for (const [name, schema] of Object.entries(apiDocs.components.schemas)) {
          if (skipNames.has(String(name))) continue
          if (this.isSchemaObject(schema) && (schema as any).type === "object") {
            // top-level enum as schema
            if ((schema as any).enum) {
              const enumName = this.sanitizeName(name) + "Enum"
              enums.push(this.generateEnumDefinition(enumName, (schema as any).enum))
            }
            const typeDef = this.generateTypeDefinition(this.sanitizeName(name), schema, apiDocs)
            types.push(typeDef)
          }
        }
      }
    } else {
      if (apiDocs.definitions) {
        for (const [name, schema] of Object.entries(apiDocs.definitions)) {
          if (skipNames.has(String(name))) continue
          if (this.isSchemaObject(schema) && (schema as any).type === "object") {
            if ((schema as any).enum) {
              const enumName = this.sanitizeName(name) + "Enum"
              enums.push(this.generateEnumDefinition(enumName, (schema as any).enum))
            }
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
      // 如果 propSchema 包含 enum，先生成 enum 定义并使用枚举名
      let type = this.getTypeScriptType(propSchema, apiDocs)
      if (propSchema && (propSchema as any).enum) {
        const enumName = `${name}_${this.sanitizeName(propName)}_Enum`
        // 生成枚举并 prepend 到 types（由调用者统一合并），这里直接把枚举定义放在类型注释中以便后续收集
        const enumDef = this.generateEnumDefinition(enumName, (propSchema as any).enum)
        type = enumName
        // 将枚举放在 types 头部（简单策略：直接插入 types via push to a global array is complex here). We'll attach enum definitions to schema by side-effect map
        ;(this as any).__generatedEnums = (this as any).__generatedEnums || new Map<string, string>()
        ;(this as any).__generatedEnums.set(enumName, enumDef)
      }
      const desc =
        propSchema && typeof propSchema === "object" && ("description" in propSchema || "title" in propSchema)
          ? (propSchema as { description?: string; title?: string }).description || (propSchema as { title?: string }).title || ""
          : ""
      return `  /** ${desc} */\n  ${sanitizedPropName}${isRequired ? "" : "?"}: ${type};`
    })

    return `export interface ${name} {\n${propertyDefs.join("\n")}\n}`
  }

  private generateEnumDefinition(name: string, values: any[]): string {
    // 如果值都是字符串或数字，生成 union 或 enum
    const allStrings = values.every((v) => typeof v === "string")
    const allNumbers = values.every((v) => typeof v === "number")
    if (allStrings || allNumbers) {
      // 使用 TypeScript union of literals（更灵活，避免 runtime enum）
      const literal = values.map((v) => (typeof v === "string" ? `'${v}'` : String(v))).join(" | ")
      return `export type ${name} = ${literal};`
    }
    // Fallback
    return `export type ${name} = any;`
  }

  private generateGenericTypeDefinition(baseName: string, representativeSchema: any, concreteNames: string[], apiDocs: any): string {
    const genericName = this.sanitizeName(baseName)
    // 记录映射，方便 getTypeScriptType 使用
    this.genericMap.set(genericName, { genericName, concreteNames: concreteNames.map((n) => this.sanitizeName(n)) })

    // 从 apiDocs 中获取所有具体 schema
    const schemasSource = this.isOpenApi3(apiDocs) ? apiDocs.components?.schemas || {} : apiDocs.definitions || {}

    const propMaps: Array<Record<string, any>> = []
    const presentNames: string[] = []
    for (const rawName of concreteNames) {
      // rawName 可能包含特殊字符，尝试多种键
      let schema = schemasSource[rawName]
      if (!schema) {
        const alt = this.sanitizeName(rawName)
        schema = schemasSource[alt] || schemasSource[String(rawName).replace(/[«»《》<>]/g, "")]
      }
      if (schema && typeof schema === "object") {
        propMaps.push(schema.properties || {})
        presentNames.push(String(rawName))
      }
    }

    // 计算交集字段
    let intersection = new Set<string>()
    if (propMaps.length > 0) {
      intersection = new Set(Object.keys(propMaps[0]))
      for (let i = 1; i < propMaps.length; i++) {
        intersection = new Set(Array.from(intersection).filter((k) => k in propMaps[i]))
      }
    }

    // 生成字段定义：对 intersection 内的字段推断类型；data/result 使用泛型T
    const fieldLines: string[] = []
    for (const key of Array.from(intersection)) {
      // 收集每个 concrete 对应字段的类型字符串
      const typesSet = new Set<string>()
      for (let i = 0; i < propMaps.length; i++) {
        const propSchema = propMaps[i][key]
        if (!propSchema) continue
        if (key === "data" || key === "result") {
          // 作为泛型占位
          // 若 data 是数组且 items 有 $ref，则为 T[]
          if (propSchema.type === "array") {
            typesSet.add("T[]")
          } else {
            typesSet.add("T")
          }
        } else {
          const t = this.getTypeScriptType(propSchema, apiDocs)
          typesSet.add(t)
        }
      }
      const typesArr = Array.from(typesSet)
      const typeStr = typesArr.length === 1 ? typesArr[0] : typesArr.join(" | ")
      fieldLines.push(`  ${this.sanitizeName(key)}?: ${typeStr};`)
    }

    // 对非交集字段做注释，指出每个具体类型的额外字段，便于审查
    const unionKeys = new Set<string>()
    for (const pm of propMaps) Object.keys(pm).forEach((k) => unionKeys.add(k))
    const extraKeys = Array.from(unionKeys).filter((k) => !intersection.has(k))
    const comments: string[] = []
    if (extraKeys.length > 0) {
      comments.push("// 以下字段在部分具体实现中存在：")
      for (const name of presentNames) {
        const schema = schemasSource[name] || schemasSource[this.sanitizeName(name)]
        if (!schema) continue
        const keys = Object.keys(schema.properties || {}).filter((k) => !intersection.has(k))
        if (keys.length > 0) {
          comments.push(`// ${name}: ${keys.join(", ")}`)
        }
      }
    }

    // 生成最终泛型接口文本
    const bodyLines = [...comments, ...fieldLines]
    // 为了兼容未列出的字段，保留索引签名
    bodyLines.push(`  [key: string]: any;`)

    const def = `export interface ${genericName}<T> {\n${bodyLines.join("\n")}\n}`
    return def
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
    const paramsMap: Map<string, string> = new Map()

    if (operation.parameters) {
      operation.parameters.forEach((param: any) => {
        if (this.isParameterObject(param)) {
          const paramName = param.name
          const isRequired = param.required === true
          const schema = param.schema || param
          const type = this.getTypeScriptType(schema, apiDocs)
          let paramDecl = `"${paramName}"${isRequired ? "" : "?"}: ${type}`
          if (param.collectionFormat) {
            switch (param.collectionFormat) {
              case "csv":
              case "ssv":
              case "tsv":
              case "pipes":
              case "multi":
                paramDecl = `"${paramName}"${isRequired ? "" : "?"}: string[]`
                break
              default:
                break
            }
          }
          // 去重：以最后出现为准（覆盖此前相同 name 的声明）
          paramsMap.set(paramName, paramDecl)
        }
      })
    }

    // 请求体
    if (operation.requestBody) {
      const content = operation.requestBody.content || {}
      if (content["application/json"]) {
        const schema = content["application/json"].schema
        if (schema) {
          paramsMap.set("body", `body: ${this.getTypeScriptType(schema, apiDocs)}`)
        }
      } else if (content["multipart/form-data"] || content["application/x-www-form-urlencoded"]) {
        const key = content["multipart/form-data"] ? "multipart/form-data" : "application/x-www-form-urlencoded"
        const schema = content[key].schema
        if (schema) {
          paramsMap.set("formData", `formData: ${this.getTypeScriptType(schema, apiDocs)}`)
        }
      }
    } else if (operation.parameters) {
      const bodyParam = operation.parameters.find((p: any) => p.in === "body")
      if (bodyParam && bodyParam.schema) {
        paramsMap.set("body", `body: ${this.getTypeScriptType(bodyParam.schema, apiDocs)}`)
      }
    }

    const params = Array.from(paramsMap.values())
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
        // 如果该类型属于 genericMap 的 concrete 名称之一，返回泛型形式
        for (const [genericBase, info] of this.genericMap) {
          if (info.concreteNames.includes(sanitized)) {
            // 提取 inner type 名称（尝试从具体 schema 的 properties 中找）
            // 这里简单使用 any 或查找 schema 中的 data 字段的类型
            const refType = this.resolveRef(refPath, apiDocs)
            let innerType = "any"
            if (refType && refType.properties) {
              if (refType.properties.data && refType.properties.data.$ref) {
                const innerRef = refType.properties.data.$ref
                const name = innerRef.split("/").pop()
                innerType = name ? this.sanitizeName(name) : "any"
              }
            }
            return `${genericBase}<${innerType}>`
          }
        }
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
        // 如果是被泛型合并的具体 wrapper，返回泛型使用
        for (const [genericBase, info] of this.genericMap) {
          if (info.concreteNames.includes(sanitized)) {
            // 找到 inner 类型
            let innerType = "any"
            if (schema.properties && schema.properties.data) {
              const data = schema.properties.data
              if (data.$ref) {
                const name = data.$ref.split("/").pop()
                innerType = name ? this.sanitizeName(name) : "any"
              } else {
                innerType = this.getTypeScriptType(data, apiDocs)
              }
            }
            return `${genericBase}<${innerType}>`
          }
        }
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
