import * as fs from "fs"
import * as path from "path"
import { OpenAPIV2 } from "openapi-types"
import {
  buildImportSnippet,
  buildMethodBody,
  buildUniqueMethodName,
  cleanSplitOutputDir,
  computeTypeClosure,
  DEFAULT_HTTP_CLIENT_CONFIG,
  DEFAULT_NAMING,
  type HttpClientConfig,
  type NamingConfig,
  normalizeIdentifierName,
  normalizeTypeExpression,
  resolveMappedScalarType,
  sanitizeName,
  type SplitOutputResult,
  toPascalCase,
  writeControllers,
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
  /** string 字段枚举提取为 const + type */
  private enumDefs: Map<string, string[]> = new Map()
  /** 当前生成任务的 HTTP 客户端配置 */
  private httpClientConfig: HttpClientConfig = DEFAULT_HTTP_CLIENT_CONFIG
  /** 当前生成任务的命名配置 */
  private naming: NamingConfig = DEFAULT_NAMING

  async generate(apiDocs: any, framework: string, outputType: string, outputPath: string, outputSplit: string = "single", namingConfig: NamingConfig = DEFAULT_NAMING, httpClientConfig: HttpClientConfig = DEFAULT_HTTP_CLIENT_CONFIG, cleanOutputDir: boolean = false, byControllerLocalTypes: boolean = false): Promise<SplitOutputResult | void> {
    try {
      if (!this.isValidApiDoc(apiDocs)) {
        throw new Error("无效的API文档")
      }

      this.httpClientConfig = httpClientConfig
      this.naming = namingConfig

      if (outputSplit === "byTag" || outputSplit === "byController") {
        // 按 Tag / Controller 拆分多文件输出
        return this.generateBySplit(apiDocs, framework, outputType, outputPath, namingConfig, outputSplit === "byController", cleanOutputDir, byControllerLocalTypes)
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
   * 按 Tag / Controller 拆分输出：
   *  byTag 模式：
   *   - {typesDirName}/index.{ext}        泛型类型 + 接口类型 + 参数类型
   *   - {controllersDirName}/{Tag}.{ext}  每个 Tag 对应的 Controller 类
   *   - index.{ext}                       统一 re-export
   *  byController 模式（byController = true）：
   *   - {controllersDirName}/{Tag}/index.{ext}  每个 Controller 独立文件夹
   */
  private generateBySplit(apiDocs: any, framework: string, outputType: string, outputDir: string, naming: NamingConfig = DEFAULT_NAMING, byController: boolean = false, cleanOutputDir: boolean = false, byControllerLocalTypes: boolean = false): SplitOutputResult {
    const ext = outputType === "js" ? "js" : "ts"
    // 是否启用「每个控制器独立类型文件」（仅 byController 模式有效）
    const useLocalTypes = byController && byControllerLocalTypes

    // 重置状态，与 generateCode 的配置一致
    this.genericTypes = []
    this.returnType = new Map()
    this.typeNames = []
    this.genericEnums = new Map()
    this.enumDefs = new Map()

    const definitions = apiDocs.definitions || {}
    for (const [name] of Object.entries(definitions)) {
      const matchName = name.match(/[«《<]/g) || []
      if (matchName.length > 0) {
        this.returnType.set(name, this.normalizeTypeExpr(name))
        const genericTypesName = this.normalizeTypeIdentifier(name.substring(0, name.search(/[«《<]/g)))
        if (!this.genericTypes.includes(genericTypesName)) {
          this.genericTypes.push(genericTypesName)
        }
      }
    }
    const typeNames: string[] = []
    for (const [name] of Object.entries(definitions)) {
      const matchName = name.match(/[«《<]/g) || []
      const normalizedName = this.normalizeTypeIdentifier(name)
      if (matchName.length === 0 && !this.genericTypes.includes(normalizedName)) {
        typeNames.push(normalizedName)
      }
    }
    this.typeNames = Array.from(new Set(typeNames))

    // 收集类型
    const genericTypesStr = this.generateGenericTypes(apiDocs)
    const types = this.generateInterfaceType(apiDocs)
    const { controllers, paramTypes } = this.generateController(apiDocs)

    // ── 清理旧输出（可选）并确保根目录存在 ────────────────────────
    if (cleanOutputDir) cleanSplitOutputDir(outputDir, naming)
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

    // ── 建立 类型名 → 定义代码 映射（供本地类型模式做依赖闭包）──
    const enumDefsCode = this.buildEnumDefsCode()
    const typeDefMap: Map<string, string> = new Map()
    typeDefMap.set("List", "export type List<T> = Array<T>")
    typeDefMap.set("Collection", "export type Collection<T> = Array<T>")
    for (const def of [...genericTypesStr, ...types, ...paramTypes]) {
      const matched = def.match(/export\s+(?:interface|type|const)\s+([A-Za-z0-9_一-龥]+)/)
      if (matched) typeDefMap.set(matched[1], def)
    }
    for (const [enumName, values] of this.enumDefs) {
      typeDefMap.set(enumName, this.buildSingleEnumCode(enumName, values))
    }
    const typeCount = typeDefMap.size

    // ── 1. 共享类型文件（本地类型模式下跳过）──────────────────────
    if (!useLocalTypes) {
      const typesDir = path.join(outputDir, naming.typesDirName)
      if (!fs.existsSync(typesDir)) fs.mkdirSync(typesDir, { recursive: true })
      const typesCode =
        `// 生成时间: ${new Date().toISOString()}\n\n` +
        `export type List<T> = Array<T>\nexport type Collection<T> = Array<T>\n` +
        genericTypesStr.join("\n\n") + "\n\n" +
        (enumDefsCode ? `// 枚举类型\n${enumDefsCode}\n\n` : "") +
        types.join("\n\n") + "\n\n" +
        paramTypes.join("\n\n") + "\n"
      fs.writeFileSync(path.join(typesDir, `index.${ext}`), typesCode, "utf-8")
    }

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

    const describe = (controllerKey: string): string =>
      (apiDocs.tags || []).find((t: any) =>
        t.name === controllerKey || this.sanitizeName(t.name) === controllerKey
      )?.description || ""

    // 本地类型模式：为每个控制器生成只含其用到类型（含传递依赖）的 types 文件
    const buildLocalTypesContent = useLocalTypes
      ? (usedTypes: string[]): string => {
          const closure = computeTypeClosure(usedTypes, typeDefMap)
          const body = closure.map((n) => typeDefMap.get(n)).filter(Boolean).join("\n\n")
          return `// 生成时间: ${new Date().toISOString()}\n\n` + (body ? `${body}\n` : "")
        }
      : undefined

    // ── 2. 写入控制器文件与各级 index ─────────────────────────────
    const { controllerCount, fileCount } = writeControllers({
      outputDir,
      controllersDir: path.join(outputDir, naming.controllersDirName),
      ext,
      byController,
      naming,
      httpClientConfig: this.httpClientConfig,
      controllers,
      describe,
      typeImportCandidates,
      buildLocalTypesContent,
    })

    return {
      controllerCount,
      typeCount,
      // 共享类型模式下额外写了一个 {typesDirName}/index 文件
      fileCount: fileCount + (useLocalTypes ? 0 : 1),
    }
  }

  private isValidApiDoc(doc: any): boolean {
    const isOpenApi3 = doc.openapi && doc.openapi.startsWith("3.")
    const isSwagger2 = doc.swagger && doc.swagger.startsWith("2.")
    return (isOpenApi3 || isSwagger2) && doc.info && doc.paths
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

  private buildSingleEnumCode(name: string, values: string[]): string {
    const entries = values.map((v) => `  ${this.toConstKey(v)}: '${v}'`).join(",\n")
    return (
      `export const ${name} = {\n${entries},\n} as const\n` +
      `export type ${name} = typeof ${name}[keyof typeof ${name}]`
    )
  }

  private buildEnumDefsCode(): string {
    if (this.enumDefs.size === 0) return ""
    return Array.from(this.enumDefs)
      .map(([name, values]) => this.buildSingleEnumCode(name, values))
      .join("\n\n")
  }

  private sanitizeName(name: string): string {
    return sanitizeName(name)
  }

  private normalizeTypeIdentifier(name: string): string {
    return normalizeIdentifierName(name, this.naming.methodNameCasing)
  }

  private normalizeTypeExpr(typeExpr: string): string {
    return normalizeTypeExpression(typeExpr, this.naming.methodNameCasing)
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
      const sanitized = this.normalizeTypeIdentifier(typeName)
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
      let findTypeKey = Object.entries(definitions).find(([name]) => {
        const match = name.match(/[«《<]/g)
        if (!match) return false
        const baseName = name.substring(0, name.search(/[«《<]/g))
        return this.normalizeTypeIdentifier(baseName) === item
      })
      if (findTypeKey) {
        const key = findTypeKey[0]
        const properties = findTypeKey[1]?.properties || {}
        const required: string[] = (properties?.required || []) as string[]
        let propertyDefs: string[] = []
        for (const [key, typeObj] of Object.entries(properties).sort(([a], [b]) => a.localeCompare(b))) {
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
    const emittedNames = new Set<string>()
    for (const [rawName, schema] of Object.entries(definitions)) {
      if ((rawName.match(/[«《<]/g) || []).length > 0) continue
      const normalizedName = this.normalizeTypeIdentifier(rawName)
      if (this.genericTypes.includes(normalizedName)) continue
      if (emittedNames.has(normalizedName)) continue

      const s = schema as OpenAPIV2.SchemaObject
      if (s.type === "object" || s.properties) {
        const properties = s.properties || {}
        const required: string[] = (s.required || []) as string[]
        const propertyDefs = Object.entries(properties).sort(([a], [b]) => a.localeCompare(b)).map(([propName, propSchema]) => {
          const sanitizedPropName = this.sanitizeName(propName)
          const isRequired = required.includes(propName)
          const ps = propSchema as any
          let type: string
          if ((ps.type === "string" || !ps.type) && Array.isArray(ps.enum) && ps.enum.length > 0) {
            const enumName = normalizedName + toPascalCase(sanitizeName(propName))
            this.registerEnumDef(enumName, ps.enum)
            type = enumName
          } else {
            type = this.getTypByProperties(ps as OpenAPIV2.SchemaObject)
          }
          return `  /** ${ps.description || ""} */\n  ${sanitizedPropName}${isRequired ? "" : "?"}: ${type};`
        })
        types.push(`export interface ${normalizedName} {\n${propertyDefs.join("\n")}
}`)
        emittedNames.add(normalizedName)
      }
    }
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
          op.operationId,
          this.naming
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
                  this.returnType.set(orig, this.normalizeTypeExpr(orig))
                  const base = this.normalizeTypeIdentifier(orig.substring(0, orig.search(/[«《<]/g)))
                  if (!this.genericTypes.includes(base)) this.genericTypes.push(base)
                  returnType = this.normalizeTypeExpr(orig)
                }
              } else {
                // non-generic: sanitize name
                returnType = this.normalizeTypeIdentifier(orig)
              }
            } else if ((schema as any).$ref) {
              // as a last fallback, derive name from $ref
              const refPath = (schema as any).$ref as string
              const refName = refPath.split("/").pop() || "any"
              returnType = this.normalizeTypeIdentifier(refName)
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
    this.enumDefs = new Map()
    const definitions = apiDocs.definitions || {}
    for (const [name, schema] of Object.entries(definitions)) {
      const matchName = name.match(/[«《<]/g) || []

      if (matchName.length > 0) {
        this.returnType.set(name, this.normalizeTypeExpr(name))
        const genericTypesName = this.normalizeTypeIdentifier(name.substring(0, name.search(/[«《<]/g)))
        if (!this.genericTypes.includes(genericTypesName)) {
          this.genericTypes.push(genericTypesName)
        }
      }
    }
    const typeNames:string [] = []
    for (const [name, schema] of Object.entries(definitions)) {
      const matchName = name.match(/[«《<]/g) || []
      if (matchName.length === 0) {
        const normalizedName = this.normalizeTypeIdentifier(name)
        if (!this.genericTypes.includes(normalizedName) === true) {
          typeNames.push(normalizedName)
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
    const enumDefsCode = this.buildEnumDefsCode()
    const code =
      (importLine ? importLine + "\n\n" : "") +
      `// 生成时间: ${new Date().toISOString()}\n\n` +
      `// 泛型类型\n` +
      `export type List<T> = Array<T>\nexport type Collection<T> = Array<T>\n` +
      genericTypesStr.join("\n\n") + "\n\n" +
      (enumDefsCode ? `// 枚举类型\n${enumDefsCode}\n\n` : "") +
      `// 类型定义\n` + types.join("\n\n") + "\n\n" +
      `// 参数类型\n` + paramTypes.join("\n\n") + "\n\n" +
      `// Controller类\n` + controllerClasses.join("\n\n") + "\n"

    return code
  }
}
