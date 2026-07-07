import * as crypto from "crypto"

const HTTP_METHODS = new Set(["get", "post", "put", "delete", "patch", "head", "options", "trace"])

function sortValue(value: any): any {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== "object") return value
  return Object.keys(value)
    .sort()
    .reduce((acc: Record<string, any>, key) => {
      acc[key] = sortValue(value[key])
      return acc
    }, {})
}

export function getApiDocHash(apiDocs: any): string {
  const stable = JSON.stringify(sortValue(apiDocs))
  return crypto.createHash("sha256").update(stable).digest("hex")
}

export function getControllerNames(apiDocs: any): string[] {
  const names = new Set<string>()
  if (Array.isArray(apiDocs?.tags)) {
    for (const tag of apiDocs.tags) {
      if (typeof tag?.name === "string" && tag.name.trim()) names.add(tag.name)
    }
  }
  for (const pathItem of Object.values(apiDocs?.paths || {})) {
    if (!pathItem || typeof pathItem !== "object") continue
    for (const [method, operation] of Object.entries(pathItem as Record<string, any>)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue
      const tag = operation?.tags?.[0] || "Default"
      if (typeof tag === "string" && tag.trim()) names.add(tag)
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b))
}

export function filterApiDocsByControllers(apiDocs: any, selectedControllers?: string[]): any {
  if (!selectedControllers || selectedControllers.length === 0) return apiDocs
  const selected = new Set(selectedControllers)
  const next = {
    ...apiDocs,
    paths: {},
    tags: Array.isArray(apiDocs.tags)
      ? apiDocs.tags.filter((tag: any) => selected.has(tag?.name))
      : apiDocs.tags,
  }

  for (const [pathKey, pathItem] of Object.entries(apiDocs.paths || {})) {
    if (!pathItem || typeof pathItem !== "object") continue
    const nextPathItem: Record<string, any> = {}
    for (const [method, operation] of Object.entries(pathItem as Record<string, any>)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) {
        nextPathItem[method] = operation
        continue
      }
      if (!operation || typeof operation !== "object") {
        nextPathItem[method] = operation
        continue
      }
      const tag = (operation as any).tags?.[0] || "Default"
      if (selected.has(tag)) nextPathItem[method] = operation
    }
    if (Object.keys(nextPathItem).length > 0) {
      ;(next.paths as Record<string, any>)[pathKey] = nextPathItem
    }
  }

  return next
}
