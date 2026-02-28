/** 生成器通用命名配置 */
export interface NamingConfig {
  typesDirName: string
  controllersDirName: string
  controllerFileNameCasing: "default" | "PascalCase" | "camelCase" | "kebab-case"
  controllerClassNameSuffix: string
}

export const DEFAULT_NAMING: NamingConfig = {
  typesDirName: "types",
  controllersDirName: "controllers",
  controllerFileNameCasing: "default",
  controllerClassNameSuffix: "",
}

export function sanitizeName(name: string): string {
  return String(name).replace(/[^\u4e00-\u9fa5a-zA-Z0-9_]/g, "_")
}

export function toPascalCase(s: string): string {
  return s
    .replace(/[-_]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (_, c: string) => c.toUpperCase())
}

export function toCamelCase(s: string): string {
  const p = toPascalCase(s)
  return p.charAt(0).toLowerCase() + p.slice(1)
}

export function toKebabCase(s: string): string {
  return toPascalCase(s)
    .replace(/([A-Z])/g, (m, c: string, offset: number) => (offset === 0 ? c.toLowerCase() : "-" + c.toLowerCase()))
}

export function applyFileCasing(s: string, casing: NamingConfig["controllerFileNameCasing"]): string {
  if (casing === "default") return s
  if (casing === "kebab-case") return toKebabCase(s)
  if (casing === "camelCase") return toCamelCase(s)
  return toPascalCase(s)
}

export function getOperationId(path: string, method: string): string {
  const pathParts = path.split("/").filter(Boolean)
  const lastPart = pathParts[pathParts.length - 1] || ""
  return `${method.toLowerCase()}${lastPart.charAt(0).toUpperCase() + lastPart.slice(1)}`
}

export function getControllerMethodNameSet(controllerName: string): Set<string> {
  if (!(globalThis as any)._controllerMethodNames) {
    ;(globalThis as any)._controllerMethodNames = {}
  }
  if (!(globalThis as any)._controllerMethodNames[controllerName]) {
    ;(globalThis as any)._controllerMethodNames[controllerName] = new Set()
  }
  return (globalThis as any)._controllerMethodNames[controllerName] as Set<string>
}

export function buildUniqueMethodName(path: string, controllerName: string, method: string, operationId?: string): string {
  const usedNames = getControllerMethodNameSet(controllerName)
  const pathParts = path.split("/").filter(Boolean)
  let partStartIndex = pathParts.length > 0 ? pathParts.length - 1 : -1
  const partsIndex: number[] = []
  const isParam = (part: string) => /^\{.+\}$/.test(part)
  let bySuffix = ""

  while (partStartIndex >= 0) {
    const part = pathParts[partStartIndex]
    if (isParam(part)) {
      partStartIndex--
      const paramName = part.replace(/[{}]/g, "")
      if (!bySuffix) {
        bySuffix = "By" + paramName.charAt(0).toUpperCase() + paramName.slice(1)
      } else {
        bySuffix = paramName.charAt(0).toUpperCase() + paramName.slice(1)
      }
    } else {
      partsIndex.unshift(partStartIndex)
      const candidate =
        partsIndex
          .map((item) => {
            const str = pathParts[item] || ""
            if (!str) return ""
            return str.charAt(0).toUpperCase() + str.slice(1)
          })
          .join("") + bySuffix
      if (usedNames.has(`${controllerName}.${candidate}`)) {
        partStartIndex--
      } else {
        partStartIndex = -1
      }
    }
  }

  let methodName =
    partsIndex
      .map((item) => {
        const str = pathParts[item] || ""
        if (!str) return ""
        return str.charAt(0).toUpperCase() + str.slice(1)
      })
      .join("") + bySuffix

  if (!methodName || usedNames.has(`${controllerName}.${methodName}`)) {
    methodName = sanitizeName(operationId || getOperationId(path, method))
  }

  usedNames.add(`${controllerName}.${methodName}`)
  return methodName
}
