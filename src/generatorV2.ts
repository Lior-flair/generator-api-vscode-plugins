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
    return doc.openapi && doc.openapi.startsWith("2.")
  }
  private getTypByProperties(p: OpenAPIV2.SchemaObject) {}
  /**
   * 生成泛型类型
   */
  private generateGenericTypes(apiDocs: OpenAPIV2.Document) {
    const getTypeByPropertie = (p: OpenAPIV2.SchemaObject) => {
      let type = "any"
      if ((p.items && p.items.$ref) || (!p.items && !!p.$ref)) {
        type = `T`
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
      let findTypeKey = Object.entries(definitions).find(([name]) => name.startsWith(item) && name.match(/^(.*?)[«《<]([^»》>]+)[»》>]$/))
      if (findTypeKey) {
        const properties = findTypeKey[1]?.properties || {}
        const required: string[] = (properties?.required || []) as string[]
        let propertyDefs: string[] = []
        for (const [key, typeObj] of Object.entries(properties)) {
          const isRequired = required.includes(key)
          if (typeObj.additionalProperties) {
            propertyDefs.push(`/** ${typeObj?.description} */\n[key: string]: T`)
          } else {
            propertyDefs.push(`/** ${typeObj?.description} */\n${key}${isRequired ? "" : "?"}: ${getTypeByPropertie(typeObj)}`)
          }
        }
        genericType = `/** */\nexport interface ${item}<T> {\n${propertyDefs.join("\n")}\n}`

        genericTypesStr.push(genericType)
      }
    })
    return genericTypesStr
  }
  /**
   * 生成类型
   */
  private generateInterfaceType(apiDocs: OpenAPIV2.Document) {}
  private generateController(apiDocs: OpenAPIV2.Document) {}

  private generateCode(apiDocs: OpenAPIV2.Document) {
    const definitions = apiDocs.definitions || {}
    for (const [name, schema] of Object.entries(definitions)) {
      if (name.match(/^(.*?)[«《<]([^»》>]+)[»》>]$/)) {
        this.returnType.set(name, name.replace(/[«《<]/g, "<").replace(/[»》>]/g, ">"))
        const genericTypesName = name.substring(0, name.search(/[«《<]/g))
        if (!this.genericTypes.includes(genericTypesName)) {
          this.genericTypes.push(genericTypesName)
        }
      } else {
        this.typeNames.push(name)
      }
    }
    const genericTypesStr = this.generateGenericTypes(apiDocs)

    const code = `
import requestClass, { getConfigs, type RequestConfig } from "@/utils/request"
const { fetch:request} = requestClass

// 生成时间: ${new Date().toISOString()}

// 泛型类型
${genericTypesStr.join("\n\n")}

// 类型定义

// Controller类
`

    return code
  }
}
