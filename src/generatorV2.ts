import * as fs from "fs"
import * as path from "path"
import { OpenAPIV2 } from "openapi-types"
import {
  buildControllerNames,
  buildImportSnippet,
  buildMethodBody,
  buildUniqueMethodName,
  DEFAULT_HTTP_CLIENT_CONFIG,
  DEFAULT_NAMING,
  type HttpClientConfig,
  type NamingConfig,
  resolveMappedScalarType,
  sanitizeName,
} from "./generatorCommon"

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
  /** 当前生成任务的 HTTP 客户端配置 */
  private httpClientConfig: HttpClientConfig = DEFAULT_HTTP_CLIENT_CONFIG

  async generate(apiDocs: any, framework: string, outputType: string, outputPath: string, outputSplit: string = "single", namingConfig: NamingConfig = DEFAULT_NAMING, httpClientConfig: HttpClientConfig = DEFAULT_HTTP_CLIENT_CONFIG): Promise<void> {
    try {
      if (!this.isValidApiDoc(apiDocs)) {
        throw new Error("无效的API文档")
      }

      this.httpClientConfig = httpClientConfig

      if (outputSplit === "byTag") {
        // 按 Tag 拆分多文件输出
        this.generateByTag(apiDocs, framework, outputType, outputPath, namingConfig)
      } else {
        const code = this.generateCode(apiDocs)

        const outputDir = path.dirname(outputPath)
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true })
        }

        fs.writeFileSync(outputPath, code, "utf-8")
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "未知错误"
      throw new Error(`生成API代码失败: ${errorMessage}`)
    }
  }

  /**
   * 按 Tag 拆分输出：
   *  - types.{ext}   汎型类型 + 接口类型 + 参数类型
   *  - {Tag}.{ext}   每个 Tag 对应的 Controller 类
   *  - index.{ext}   统一 re-export
   */
  private generateByTag(apiDocs: any, framework: string, outputType: string, outputDir: string, naming: NamingConfig = DEFAULT_NAMING): void {
    const ext = outputType === "js" ? "js" : "ts"

    // 重置状态，与 generateCode 的配置一致
    this.genericTypes = []
    this.returnType = new Map()
    this.typeNames = []
    this.genericEnums = new Map()

    const definitions = apiDocs.definitions || {}
    for (const [name] of Object.entries(definitions)) {
      const matchName = name.match(/[«《<]/g) || []
      if (matchName.length > 0) {
        this.returnType.set(name, name.replace(/[«《<]/g, "<").replace(/[»》>]/g, ">"))
        const genericTypesName = name.substring(0, name.search(/[«《<]/g))
        if (!this.genericTypes.includes(genericTypesName)) {
          this.genericTypes.push(genericTypesName)
        }
      }
    }
    const typeNames: string[] = []
    for (const [name] of Object.entries(definitions)) {
      const matchName = name.match(/[«《<]/g) || []
      if (matchName.length === 0 && !this.genericTypes.includes(name)) {
        typeNames.push(this.sanitizeName(name))
      }
    }
    this.typeNames = Array.from(new Set(typeNames))

    // 收集类型
    const genericTypesStr = this.generateGenericTypes(apiDocs)
    const types = this.generateInterfaceType(apiDocs)
    const { controllers, paramTypes } = this.generateController(apiDocs)

    // ── 子目录路径 ─────────────────────────────────────────────────
    const typesDir = path.join(outputDir, naming.typesDirName)
    const controllersDir = path.join(outputDir, naming.controllersDirName)
    ;[typesDir, controllersDir].forEach((d) => {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
    })

    // ── 1. 写入 {typesDirName}/index.{ext} ────────────────────────
    const typesCode =
      `// 生成时间: ${new Date().toISOString()}\n\n` +
      `export type List<T> = Array<T>\nexport type Collection<T> = Array<T>\n` +
      genericTypesStr.join("\n\n") + "\n\n" +
      types.join("\n\n") + "\n\n" +
      paramTypes.join("\n\n") + "\n"
    fs.writeFileSync(path.join(typesDir, `index.${ext}`), typesCode, "utf-8")

    const paramTypeNames = paramTypes
      .map((typeDef) => typeDef.match(/export interface\s+([^\s<{]+)/)?.[1])
      .filter((name): name is string => Boolean(name))
    const typeImportCandidates = Array.from(new Set([
      "List",
      "Collection",
      ...this.typeNames,
      ...this.genericTypes,
      ...paramTypeNames,
    ]))

    // ── 2. 写入各 {controllersDirName}/{fileName}.{ext} ───────────
    const fileNames: string[] = []
    for (const [controllerKey, methods] of controllers) {
      const { className, fileName } = buildControllerNames(controllerKey, naming)

      const description = (apiDocs.tags || []).find((t: any) =>
        t.name === controllerKey || this.sanitizeName(t.name) === controllerKey
      )?.description || ""
      let methodsCode = methods.join("\n\n")
      const importLine = buildImportSnippet(this.httpClientConfig)
      const typeImportLine = ext === "ts"
        ? (() => {
            const usedTypes = this.extractUsedTypeNames(methodsCode, typeImportCandidates)
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

    // controllers/index.{ext}
    const controllersIndexCode = fileNames.map((n) => `export * from "./${n}"`).join("\n") + "\n"
    fs.writeFileSync(path.join(controllersDir, `index.${ext}`), controllersIndexCode, "utf-8")

    // ── 3. 根 index.{ext} ──────────────────────────────────────────
    const rootIndexCode = `export * from "./${naming.typesDirName}"\nexport * from "./${naming.controllersDirName}"\n`
    fs.writeFileSync(path.join(outputDir, `index.${ext}`), rootIndexCode, "utf-8")
  }

  private isValidApiDoc(doc: any): boolean {
    const isOpenApi3 = doc.openapi && doc.openapi.startsWith("3.")
    const isSwagger2 = doc.swagger && doc.swagger.startsWith("2.")
    return (isOpenApi3 || isSwagger2) && doc.info && doc.paths
  }
  private sanitizeName(name: string): string {
    return sanitizeName(name)
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

  private normalizeFormat(format: unknown): string | undefined {
    if (typeof format === "string") return format
    if (Array.isArray(format) && typeof format[0] === "string") return format[0]
    return undefined
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
      const mapped = resolveMappedScalarType(this.httpClientConfig, p.type, this.normalizeFormat((p as any).format))
      if (mapped) return mapped
      return "string"
    }
    if (p.type === "number" || p.type === "integer") {
      const mapped = resolveMappedScalarType(this.httpClientConfig, p.type, this.normalizeFormat((p as any).format))
      if (mapped) return mapped
      return "number"
    }
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
      const mapped = resolveMappedScalarType(this.httpClientConfig, p.type, this.normalizeFormat((p as any).format))
      if (mapped) {
        return mapped
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

        const methodName = buildUniqueMethodName(
          p as string,
          controllerName,
          method,
          op.operationId
        )

        const parameters = (op.parameters || []) as any[]

        // params type generation（v2: path/query/body/formData 进入 params；header 写入注释）
        const paramsName = `${controllerName}${methodName}Params`
        const paramsProps: string[] = []
        const seenFields = new Set<string>()
        const queryParamNames: string[] = []
        const pathParamNames: string[] = []
        const headerParamNotes: string[] = []
        const formDataFieldDefs: string[] = []
        let formDataRequired = false
        let hasBody = false
        let hasFormData = false

        // collect parameters array (path, query, header, formData, body)
        for (const param of parameters) {
          if ((param as any).$ref) continue
          const inType = param.in
          const pname = param.name
          const isRequired = param.required === true

          if (inType === "body") {
            const schema = param.schema as OpenAPIV2.SchemaObject
            const t = this.getTypByProperties(schema)
            if (!seenFields.has("body")) {
              paramsProps.push(`  body${isRequired ? "" : "?"}: ${t}`)
              seenFields.add("body")
            }
            hasBody = true
          } else if (inType === "formData") {
            const schemaType = (param as any).type ? this.getTypByProperties(param as any) : "any"
            formDataFieldDefs.push(`"${pname}"${isRequired ? "" : "?"}: ${schemaType}`)
            if (isRequired) formDataRequired = true
            hasFormData = true
          } else if (inType === "path" || inType === "query") {
            if (seenFields.has(pname)) continue
            const t = param.type ? this.getTypByProperties(param as any) : this.getTypByProperties(param.schema)
            paramsProps.push(`/** ${param?.description ? param?.description : ""} */\n  "${pname}"${isRequired ? "" : "?"}: ${t}`)
            seenFields.add(pname)
            if (inType === "query") queryParamNames.push(pname)
            if (inType === "path") pathParamNames.push(pname)
          } else if (inType === "header") {
            const t = param.type ? this.getTypByProperties(param as any) : this.getTypByProperties(param.schema)
            headerParamNotes.push(`@param [header] ${pname}: ${t} (${isRequired ? "required" : "optional"})`)
          } else {
            const t = param.type ? this.getTypByProperties(param as any) : this.getTypByProperties(param.schema)
            headerParamNotes.push(`@param [${inType || "unknown"}] ${pname}: ${t} (${isRequired ? "required" : "optional"})`)
          }
        }

        if (formDataFieldDefs.length > 0 && !seenFields.has("formData")) {
          paramsProps.push(`  formData${formDataRequired ? "" : "?"}: { ${formDataFieldDefs.join(", ")} }`)
          seenFields.add("formData")
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

        let optionsAssignment = ""

        if (queryParamNames.length > 0 || hasBody || hasFormData) {
          const parts: string[] = []

          // query → options.params
          if (queryParamNames.length > 0) {
            const queryObject = `\n    {\n      ${queryParamNames.map((n) => `"${n}": params["${n}"]`).join(",\n      ")}\n    }`
            parts.push(`params:${queryObject}`)
          }

          // body or formData → options.data
          if (hasBody) {
            parts.push(`data: params["body"]`)
          } else if (hasFormData) {
            parts.push(`data: params["formData"]`)
          }

          optionsAssignment = `const finalOptions = {\n  ...options,\n  ${parts.join(",\n  ")}\n};`
        } else {
          optionsAssignment = "const finalOptions = { ...options };"
        }

        /** =-===========================end 处理params */

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
        pathParamNames.forEach((paramName: string) => {
          const paramPattern = `{${paramName}}`
          if (processedPath.includes(paramPattern)) {
            // insert a literal ${params.xxx} into the generated code
            processedPath = processedPath.replace(paramPattern, "${params." + paramName + "}")
          }
        })

        // request content type (formData/body)
        const requestContentType = (op.parameters || []).some((p: any) => p.in === "formData") ? "" : "application/json"
        // const requestContentType = (op.parameters || []).some((p: any) => p.in === "formData") ? "multipart/form-data" : "application/json"

        const methodComment =
          `  /**\n* ${op.summary || ""}` +
          (op.description && op.description !== op.summary ? "\n* " + op.description : "") +
          (op.deprecated ? "\n* @deprecated true" : "") +
          (op.example ? "\n* @example" + op.example : "") +
          (headerParamNotes.length > 0 ? `\n* ${headerParamNotes.join("\n* ")}` : "") +
          "\n*/"

        let methodCode: string
        if (this.httpClientConfig.mode !== "axios-wrapper") {
          // axios / fetch / custom：async/await 风格，无 options 参数
          const cleanParams = paramsTypeUsage.replace(/, options: RequestConfig = \{\}$/, "")
          const body = buildMethodBody(
            this.httpClientConfig,
            method,
            processedPath,
            hasBody ? "body" : "",
            requestContentType,
            returnType,
            methodName
          )
          methodCode = `${methodComment}\n  static async ${methodName}(${cleanParams}): Promise<${returnType}> {\n    ${body}\n  }`
        } else {
          methodCode = `${methodComment}\n  static ${methodName}(${paramsTypeUsage}): Promise<${returnType}> {\n    return new Promise((resolve, reject) => {\n      const url = \`${processedPath}\`;\n      ${optionsAssignment}\n      const configs = getConfigs(\n        '${method}',\n        '${requestContentType}',\n        url,\n        finalOptions\n      );\n      request(configs, resolve, reject);\n    });\n  }`
        }

        controllers.get(controllerName)?.push(methodCode)
      }
    }

    // assemble controller classes
    const controllerClasses: string[] = []
    for (const [controllerName, methods] of controllers) {
      const description = (apiDocs.tags || []).find((t: any) => t.name === controllerName)?.description || ""
      controllerClasses.push(`\n/**\n * ${description}\n */\nexport class ${controllerName} {\n${methods.join("\n\n")}\n}`)
    }

    return { controllerClasses, paramTypes, controllers }
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
    const typeNames:string [] = []
    for (const [name, schema] of Object.entries(definitions)) {
      const matchName = name.match(/[«《<]/g) || []
      if (matchName.length === 0) {
        if (!this.genericTypes.includes(name) === true) {
          typeNames.push(this.sanitizeName(name))
        }
      }
    }
    this.typeNames = Array.from(new Set(typeNames))
    const genericTypesStr = this.generateGenericTypes(apiDocs)
    // generate non-generic interface types
    const types = this.generateInterfaceType(apiDocs)

    // generate controllers and parameter types
    const { controllerClasses, paramTypes } = this.generateController(apiDocs)

    const importLine = buildImportSnippet(this.httpClientConfig)
    const code =
      (importLine ? importLine + "\n\n" : "") +
      `// 生成时间: ${new Date().toISOString()}\n\n` +
      `// 泛型类型\n` +
      `export type List<T> = Array<T>\nexport type Collection<T> = Array<T>\n` +
      genericTypesStr.join("\n\n") + "\n\n" +
      `// 类型定义\n` + types.join("\n\n") + "\n\n" +
      `// 参数类型\n` + paramTypes.join("\n\n") + "\n\n" +
      `// Controller类\n` + controllerClasses.join("\n\n") + "\n"

    return code
  }
}
