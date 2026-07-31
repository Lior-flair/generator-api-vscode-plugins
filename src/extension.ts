// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as path from "path"
import * as vscode from "vscode"
import { ApiGenerator as ApiGeneratorV3 } from "./generatorV3"
import { ApiGenerator as ApiGeneratorV2 } from "./generatorV2"
import { ApiParser } from "./parser"
import { MockGenerator, type MockOutputFormat } from "./mockGenerator"
import { ApiConfigRow, ApiControllerNameMapRow, ApiHistoryItem, ApiPanelProvider } from "./apiPanel"
import { filterApiDocsByControllers, getApiDocHash, getControllerNames } from "./docUtils"
import { ApiProfile, ApiProfileManager, createProfileId } from "./profileManager"
import {
  type CompatibilityVersion,
  DEFAULT_METHOD_NAME_PATH_SUFFIXES,
  type FormatTypeMappings,
  generateRequestScaffoldFile,
  buildRequestTemplateContent,
  type HttpClientConfig,
  type HttpClientMode,
  type NamingConfig,
  type SplitOutputResult,
} from "./generatorCommon"

/** 调试日志：输出到 VS Code 的「调试控制台」(Debug Console) */
function log(...args: unknown[]): void {
  console.log("[generator-ts-api]", ...args)
}

/** 错误日志：输出到「调试控制台」 */
function logError(...args: unknown[]): void {
  console.error("[generator-ts-api]", ...args)
}

/** 根据生成结果构建成功提示文案 */
function buildSuccessMessage(result: SplitOutputResult | void): string {
  if (result) {
    return `API 代码生成成功！共 ${result.controllerCount} 个控制器、${result.typeCount} 个类型，写入 ${result.fileCount} 个文件`
  }
  return "API 代码生成成功！"
}

function buildNamingConfig(config: vscode.WorkspaceConfiguration): NamingConfig {
  return {
    typesDirName: (config.get("naming.typesDirName") as string) || "types",
    controllersDirName: (config.get("naming.controllersDirName") as string) || "controllers",
    controllerFileNameCasing: ((config.get("naming.controllerFileNameCasing") as string) || "default") as "default" | "PascalCase" | "camelCase" | "kebab-case",
    controllerClassNameSuffix: (config.get("naming.controllerClassNameSuffix") as string) || "",
    controllerNameStrategy: ((config.get("naming.controllerNameStrategy") as string) || "tagName") as "tagName" | "tagDescription" | "auto",
    controllerNameMap: (config.get("naming.controllerNameMap") as Record<string, string>) || {},
    skipDuplicateControllerClassNameSuffix: (config.get("naming.skipDuplicateControllerClassNameSuffix") as boolean) !== false,
    methodNameCasing: ((config.get("naming.methodNameCasing") as string) || "default") as "default" | "PascalCase" | "camelCase" | "kebab-case",
    typeNameCasing: ((config.get("naming.typeNameCasing") as string) || "follow") as "follow" | "default" | "PascalCase" | "camelCase" | "kebab-case",
    methodNamePathSuffixesEnabled: (config.get("naming.methodNamePathSuffixesEnabled") as boolean) ?? false,
    methodNamePathSuffixes: (config.get("naming.methodNamePathSuffixes") as string[]) || DEFAULT_METHOD_NAME_PATH_SUFFIXES,
    methodNamePathSuffixScopes: (config.get("naming.methodNamePathSuffixScopes") as Array<{ controller: string; pathPrefix: string }>) || [],
  }
}

interface ProfileConfigEntry {
  key: string
  label: string
  defaultValue: unknown
}

const PROFILE_CONFIG_ENTRIES: ProfileConfigEntry[] = [
  { key: "apiDocsUrl", label: "API URL", defaultValue: "" },
  { key: "apiDocsPath", label: "API 本地路径", defaultValue: "" },
  { key: "framework", label: "框架", defaultValue: "react" },
  { key: "outputType", label: "输出类型", defaultValue: "ts" },
  { key: "outputSplit", label: "输出模式", defaultValue: "single" },
  { key: "outputPath", label: "全局输出位置", defaultValue: "" },
  { key: "outputPathSplit", label: "输出位置对应模式", defaultValue: "" },
  { key: "cleanOutputDir", label: "生成前清理", defaultValue: false },
  { key: "byController.localTypes", label: "Controller 本地类型", defaultValue: false },
  { key: "byControllerSingleFile.extractSharedTypes", label: "抽离共用类型", defaultValue: false },
  { key: "httpClient", label: "HTTP 客户端", defaultValue: "axios-wrapper" },
  { key: "requestImportPath", label: "Request Import", defaultValue: "" },
  { key: "directReplacementRequestImportPath", label: "Import 直接替换", defaultValue: false },
  { key: "generateRequestScaffold", label: "生成 Request 样板", defaultValue: false },
  { key: "compatibilityVersion", label: "兼容版本", defaultValue: "latest" },
  { key: "typeMapping.dateTimeTarget", label: "date-time 类型", defaultValue: "string" },
  { key: "typeMapping.formatMap", label: "Format 映射", defaultValue: {} },
  { key: "naming.typesDirName", label: "类型目录名", defaultValue: "types" },
  { key: "naming.controllersDirName", label: "Controller 目录名", defaultValue: "controllers" },
  { key: "naming.controllerFileNameCasing", label: "Controller 文件命名", defaultValue: "default" },
  { key: "naming.controllerClassNameSuffix", label: "Controller 类后缀", defaultValue: "" },
  { key: "naming.controllerNameStrategy", label: "Controller 命名来源", defaultValue: "tagName" },
  { key: "naming.controllerNameMap", label: "Controller 命名映射", defaultValue: {} },
  { key: "naming.skipDuplicateControllerClassNameSuffix", label: "跳过重复类后缀", defaultValue: true },
  { key: "naming.methodNameCasing", label: "方法命名", defaultValue: "default" },
  { key: "naming.typeNameCasing", label: "类型命名", defaultValue: "follow" },
  { key: "naming.methodNamePathSuffixesEnabled", label: "稳定方法名", defaultValue: false },
  { key: "naming.methodNamePathSuffixes", label: "方法名 Path 后缀", defaultValue: DEFAULT_METHOD_NAME_PATH_SUFFIXES },
  { key: "naming.methodNamePathSuffixScopes", label: "方法名定向作用域", defaultValue: [] },
  { key: "watch.intervalSeconds", label: "监听间隔秒数", defaultValue: 120 },
]

function stringifyConfigValue(value: unknown): string {
  if (value === undefined) return "未设置"
  if (value === "") return "\"\""
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

function readConfigValue(config: vscode.WorkspaceConfiguration, key: string, defaultValue: unknown): unknown {
  return config.get(key, defaultValue)
}

function buildConfigRows(): ApiConfigRow[] {
  const config = vscode.workspace.getConfiguration("generator-ts-api")
  return PROFILE_CONFIG_ENTRIES.map((entry) => ({
    key: entry.key,
    label: entry.label,
    value: stringifyConfigValue(readConfigValue(config, entry.key, entry.defaultValue)),
  }))
}

interface HistoryItem {
  url: string
  name?: string
  swaggerVersion?: string
}

type HistoryQuickPickItem = vscode.QuickPickItem & { historyItem?: HistoryItem }

// 存储 URL 历史记录
const MAX_HISTORY_LENGTH = 10
let urlHistory: HistoryItem[] = [
  { url: "http://192.168.18.238:8080/vmoto-admin-api/v3/api-docs" },
  { url: "http://192.168.18.15:8080/v3/api-docs" },
  { url: "http://192.168.18.15:9090/v3/api-docs" },
  { url: "http://localhost:8080/v3/api-docs" },
]

/** 从 VS Code 配置构建 HttpClientConfig，自动填充各档默认 import 路径 */
function buildHttpClientConfig(config: vscode.WorkspaceConfiguration): HttpClientConfig {
  const mode = ((config.get("httpClient") as string) || "axios-wrapper") as HttpClientMode
  const directReplacementRequestImportPath = (config.get("directReplacementRequestImportPath") as boolean) || false
  const compatibilityVersion = ((config.get("compatibilityVersion") as string) || "latest") as CompatibilityVersion
  const dateTimeTarget = ((config.get("typeMapping.dateTimeTarget") as string) || "string").trim()
  const customFormatMapRaw = (config.get("typeMapping.formatMap") as Record<string, unknown>) || {}
  const formatTypeMappings: FormatTypeMappings = {}
  if (dateTimeTarget) {
    formatTypeMappings["date-time"] = dateTimeTarget
  }
  for (const [key, value] of Object.entries(customFormatMapRaw)) {
    if (typeof value === "string" && key.trim()) {
      formatTypeMappings[key.trim().toLowerCase()] = value
    }
  }
  let requestImportPath = (config.get("requestImportPath") as string) || ""
  if (!directReplacementRequestImportPath && !requestImportPath) {
    switch (mode) {
      case "axios": requestImportPath = "axios"; break
      case "axios-wrapper": requestImportPath = "@/utils/request"; break
      default: requestImportPath = ""
    }
  }
  return {
    mode,
    requestImportPath,
    directReplacementRequestImportPath,
    generateRequestScaffold: (config.get("generateRequestScaffold") as boolean) || false,
    customTemplateFile: (config.get("customTemplate.templateFile") as string) || undefined,
    customTemplateString: (config.get("customTemplate.templateString") as string) || undefined,
    compatibilityVersion,
    formatTypeMappings,
  }
}

/** 若配置了 generateRequestScaffold，在输出目录生成 request.ts 样板（不覆盖已有文件） */
function maybeGenerateScaffold(
  outputFsPath: string,
  outputSplit: string,
  httpClientConfig: HttpClientConfig,
  outputType: string
): void {
  if (!httpClientConfig.generateRequestScaffold) return
  const outputDir = outputSplit !== "single" ? outputFsPath : path.dirname(outputFsPath)
  const ext = outputType === "js" ? "js" : "ts"
  generateRequestScaffoldFile(outputDir, httpClientConfig, ext)
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const apiGeneratorV3 = new ApiGeneratorV3()
  const apiGeneratorV2 = new ApiGeneratorV2()
  const apiParser = new ApiParser()
  const profileManager = new ApiProfileManager(context)

  const loadProfileDocs = async (profile: ApiProfile): Promise<any> => {
    if (profile.sourceType === "url" && profile.url) {
      return apiParser.parseFromUrl(profile.url)
    }
    if (profile.sourceType === "file" && profile.filePath) {
      return apiParser.parseFromFile(profile.filePath)
    }
    throw new Error("API 配置缺少文档来源")
  }

  const buildControllerNameMapRows = async (): Promise<ApiControllerNameMapRow[]> => {
    const profile = profileManager.getDefaultProfile()
    if (!profile) return []
    try {
      const apiDocs = await loadProfileDocs(profile)
      const config = vscode.workspace.getConfiguration("generator-ts-api")
      const nameMap = (config.get("naming.controllerNameMap") as Record<string, string>) || {}
      const rows: ApiControllerNameMapRow[] = []
      const seen = new Set<string>()
      if (Array.isArray(apiDocs?.tags)) {
        for (const tag of apiDocs.tags) {
          const name = typeof tag?.name === "string" ? tag.name.trim() : ""
          if (!name || seen.has(name)) continue
          seen.add(name)
          rows.push({
            name,
            value: typeof nameMap[name] === "string" ? nameMap[name] : "",
            description: typeof tag?.description === "string" ? tag.description : undefined,
          })
        }
      }
      return rows.sort((a, b) => a.name.localeCompare(b.name))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误"
      return [{ name: "无法读取默认 API 文档", value: message }]
    }
  }

  const apiPanelProvider = new ApiPanelProvider(profileManager, () => urlHistory, buildConfigRows, buildControllerNameMapRows)
  const apiPanelTree = vscode.window.createTreeView("generator-ts-api.profiles", {
    treeDataProvider: apiPanelProvider,
    showCollapseAll: true,
  })
  context.subscriptions.push(apiPanelTree)

  const loadUrlHistory = () => {
    const rawHistory = context.globalState.get<any[]>("urlHistory")
    if (rawHistory) {
      urlHistory = rawHistory.map((item: any) =>
        typeof item === "string" ? { url: item } : (item as HistoryItem)
      )
    }
  }
  // 从扩展存储中加载历史记录，兼容旧版 string[] 格式
  loadUrlHistory()

  // 保存 URL 到历史记录（保留已有名称，更新版本）
  const saveUrlToHistory = (url: string, swaggerVersion?: string) => {
    const existing = urlHistory.find((item) => item.url === url)
    urlHistory = urlHistory.filter((item) => item.url !== url)
    urlHistory.unshift({ url, name: existing?.name, swaggerVersion: swaggerVersion || existing?.swaggerVersion })
    if (urlHistory.length > MAX_HISTORY_LENGTH) urlHistory = urlHistory.slice(0, MAX_HISTORY_LENGTH)
    context.globalState.update("urlHistory", urlHistory)
    apiPanelProvider.refresh()
  }

  const EDIT_BTN: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("edit"), tooltip: "编辑名称" }
  const DELETE_BTN: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("trash"), tooltip: "删除" }
  const COPY_BTN: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("copy"), tooltip: "复制 URL" }

  const buildHistoryItems = (): HistoryQuickPickItem[] => [
    { label: "输入新URL", description: "手动输入API文档URL" },
    ...urlHistory.map((item): HistoryQuickPickItem => ({
      label: item.name || item.url,
      description: item.name ? item.url : (item.swaggerVersion ? `[${item.swaggerVersion}]` : "历史记录"),
      historyItem: item,
      buttons: [EDIT_BTN, DELETE_BTN, COPY_BTN],
    })),
  ]

  const showUrlHistoryQuickPick = (): Promise<string | undefined> =>
    new Promise((resolve) => {
      const quickPick = vscode.window.createQuickPick<HistoryQuickPickItem>()
      quickPick.placeholder = "输入新的URL或选择历史记录"
      quickPick.items = buildHistoryItems()
      // 为 true 时，quickPick.hide() 触发的 onDidHide 不再 resolve(undefined)，
      // 用于「输入新URL」「编辑名称」等会主动隐藏面板再异步取值的场景
      let suppressHideResolve = false

      quickPick.onDidAccept(() => {
        const selection = quickPick.selectedItems[0]
        if (!selection) { quickPick.hide(); return }
        if (selection.historyItem) {
          quickPick.hide()
          log("已选择历史 URL:", selection.historyItem.url)
          resolve(selection.historyItem.url)
        } else {
          // 先标记，避免 hide() 触发的 onDidHide 抢先 resolve(undefined)
          suppressHideResolve = true
          quickPick.hide()
          vscode.window.showInputBox({
            prompt: "请输入API文档URL",
            placeHolder: "https://example.com/api-docs",
            value: urlHistory[0]?.url || "",
            ignoreFocusOut: true,
          }).then((value) => {
            log("已输入新 URL:", value ?? "(取消)")
            resolve(value)
          })
        }
      })

      quickPick.onDidHide(() => { if (!suppressHideResolve) resolve(undefined) })

      quickPick.onDidTriggerItemButton(async ({ button, item }: vscode.QuickPickItemButtonEvent<HistoryQuickPickItem>) => {
        const histItem = item.historyItem
        if (!histItem) return
        if (button === COPY_BTN) {
          await vscode.env.clipboard.writeText(histItem.url)
          vscode.window.showInformationMessage("URL 已复制到剪切板")
        } else if (button === DELETE_BTN) {
          urlHistory = urlHistory.filter((h) => h.url !== histItem.url)
          context.globalState.update("urlHistory", urlHistory)
          quickPick.items = buildHistoryItems()
          apiPanelProvider.refresh()
        } else if (button === EDIT_BTN) {
          suppressHideResolve = true
          quickPick.hide()
          const newName = await vscode.window.showInputBox({
            prompt: "修改历史记录名称",
            placeHolder: "留空使用 URL 作为显示名称",
            value: histItem.name || "",
            ignoreFocusOut: true,
          })
          suppressHideResolve = false
          if (newName !== undefined) {
            histItem.name = newName.trim() || undefined
            context.globalState.update("urlHistory", urlHistory)
            apiPanelProvider.refresh()
          }
          quickPick.items = buildHistoryItems()
          quickPick.show()
        }
      })

      quickPick.show()
    })

  // 获取对应的生成器
  const getGenerator = (apiDocs: any) => {
    if (apiDocs.openapi && apiDocs.openapi.startsWith("3.")) {
      return apiGeneratorV3
    } else if (apiDocs.swagger && apiDocs.swagger.startsWith("2.")) {
      return apiGeneratorV2
    } else {
      throw new Error("不支持的API文档版本")
    }
  }

  const pickOutputPath = async (outputSplit: string, outputType: string): Promise<string | undefined> => {
    if (outputSplit !== "single") {
      const folderUri = await vscode.window.showOpenDialog({
        title: "选择输出目录（多文件拆分）",
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "选择输出目录",
      })
      return folderUri?.[0]?.fsPath
    }
    const outputPath = await vscode.window.showSaveDialog({
      title: "选择输出文件位置",
      filters: outputType === "js" ? { JavaScript: ["js"] } : { TypeScript: ["ts"] },
    })
    return outputPath?.fsPath
  }

  const serializeWorkspaceOutputPath = (outputPath: string): string => {
    const folders = vscode.workspace.workspaceFolders || []
    const matchingFolder = folders
      .map((folder) => ({
        folder,
        relativePath: path.relative(folder.uri.fsPath, outputPath),
      }))
      .filter(({ relativePath }) =>
        relativePath === "" ||
        (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
      )
      .sort((a, b) => a.relativePath.length - b.relativePath.length)[0]
    if (!matchingFolder) return outputPath

    const workspaceToken = folders.length > 1
      ? `\${workspaceFolder:${matchingFolder.folder.name}}`
      : "${workspaceFolder}"
    const normalizedRelativePath = matchingFolder.relativePath.replace(/\\/g, "/")
    return normalizedRelativePath
      ? `${workspaceToken}/${normalizedRelativePath}`
      : workspaceToken
  }

  const resolveWorkspaceOutputPath = (configuredPath: string): string => {
    const value = configuredPath.trim()
    if (!value) return ""
    const folders = vscode.workspace.workspaceFolders || []
    const variableMatch = value.match(/^\$\{workspaceFolder(?::([^}]+))?\}(?:[\\/](.*))?$/)
    if (variableMatch) {
      const folderName = variableMatch[1]
      const folder = folderName
        ? folders.find((item) => item.name === folderName)
        : folders[0]
      if (!folder) return ""
      return variableMatch[2]
        ? path.join(folder.uri.fsPath, variableMatch[2])
        : folder.uri.fsPath
    }
    if (path.isAbsolute(value)) return value
    return folders[0] ? path.resolve(folders[0].uri.fsPath, value) : value
  }

  const saveWorkspaceOutputPath = async (
    config: vscode.WorkspaceConfiguration,
    outputPath: string,
    outputSplit: string
  ): Promise<void> => {
    await config.update(
      "outputPath",
      serializeWorkspaceOutputPath(outputPath),
      vscode.ConfigurationTarget.Workspace
    )
    await config.update("outputPathSplit", outputSplit, vscode.ConfigurationTarget.Workspace)
  }

  const generateProfile = async (profile: ApiProfile, forcePickOutput = false): Promise<void> => {
    const loading = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
    loading.text = "$(sync~spin) 拉取 API 文档..."
    loading.show()
    try {
      const config = vscode.workspace.getConfiguration("generator-ts-api")
      const framework = ((config.get("framework") as string) || "react")
      const outputType = ((config.get("outputType") as string) || "ts")
      const outputSplit = ((config.get("outputSplit") as string) || "single")
      const configuredOutputPathSetting = (config.get("outputPath") as string) || ""
      const configuredOutputPath = resolveWorkspaceOutputPath(configuredOutputPathSetting)
      const configuredOutputSplit = (config.get("outputPathSplit") as string) || ""
      const configuredModeChanged = Boolean(
        configuredOutputPath &&
        configuredOutputSplit &&
        configuredOutputSplit !== outputSplit
      )
      const legacyOutputCompatible = Boolean(
        profile.outputPath &&
        (!profile.outputSplit || profile.outputSplit === outputSplit)
      )
      let outputFsPath =
        forcePickOutput || configuredModeChanged
          ? undefined
          : configuredOutputPath || (legacyOutputCompatible ? profile.outputPath : undefined)
      if (!outputFsPath) {
        outputFsPath = await pickOutputPath(outputSplit, outputType)
      }
      if (!outputFsPath) return
      if (
        serializeWorkspaceOutputPath(outputFsPath) !== configuredOutputPathSetting ||
        configuredOutputSplit !== outputSplit
      ) {
        await saveWorkspaceOutputPath(config, outputFsPath, outputSplit)
      }

      const apiDocs = await loadProfileDocs(profile)
      const docHash = getApiDocHash(apiDocs)
      const filteredDocs = filterApiDocsByControllers(apiDocs, profile.selectedControllers)
      const generator = getGenerator(filteredDocs)
      loading.text = "$(sync~spin) 生成代码中..."
      const httpClientConfig = buildHttpClientConfig(config)
      const cleanOutputDir = ((config.get("cleanOutputDir") as boolean) || false)
      const byControllerLocalTypes = ((config.get("byController.localTypes") as boolean) || false)
      const extractSharedTypes = ((config.get("byControllerSingleFile.extractSharedTypes") as boolean) || false)
      const genResult = await generator.generate(
        filteredDocs,
        framework,
        outputType,
        outputFsPath,
        outputSplit,
        buildNamingConfig(config),
        httpClientConfig,
        cleanOutputDir,
        byControllerLocalTypes,
        extractSharedTypes
      )
      maybeGenerateScaffold(outputFsPath, outputSplit, httpClientConfig, outputType)
      await profileManager.updateProfile(profile.id, {
        lastDocHash: docHash,
        lastCheckedAt: Date.now(),
        lastGeneratedAt: Date.now(),
        status: "online",
        statusMessage: "生成成功",
      })
      await profileManager.setDefaultProfile(profile.id)
      if (profile.url) {
        saveUrlToHistory(profile.url, typeof (apiDocs.openapi || apiDocs.swagger) === "string" ? (apiDocs.openapi || apiDocs.swagger) : undefined)
      }
      apiPanelProvider.refresh()
      vscode.window.showInformationMessage(buildSuccessMessage(genResult))
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "未知错误"
      logError("Profile 生成失败:", error instanceof Error ? error.stack || error.message : error)
      await profileManager.updateProfile(profile.id, {
        status: "offline",
        statusMessage: errorMessage,
        lastCheckedAt: Date.now(),
      })
      apiPanelProvider.refresh()
      vscode.window.showErrorMessage(`生成API文档失败: ${errorMessage}`)
    } finally {
      try { loading.hide(); loading.dispose() } catch (_) { /* ignore */ }
      try { ;(globalThis as any)._controllerMethodNames = {} } catch (_) { /* ignore */ }
    }
  }

  const checkProfile = async (profile: ApiProfile, silent = false): Promise<ApiProfile | undefined> => {
    try {
      const apiDocs = await loadProfileDocs(profile)
      const docHash = getApiDocHash(apiDocs)
      const status = profile.lastDocHash && profile.lastDocHash !== docHash ? "changed" : "unchanged"
      const next = await profileManager.updateProfile(profile.id, {
        lastDocHash: profile.lastDocHash || docHash,
        lastCheckedAt: Date.now(),
        status,
        statusMessage: status === "changed" ? "后端文档有变动" : "后端文档无变动",
      })
      apiPanelProvider.refresh()
      if (!silent) {
        vscode.window.showInformationMessage(status === "changed" ? "API 文档有变动" : "API 文档无变动")
      }
      return next
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "未知错误"
      const next = await profileManager.updateProfile(profile.id, {
        status: "offline",
        statusMessage: errorMessage,
        lastCheckedAt: Date.now(),
      })
      apiPanelProvider.refresh()
      if (!silent) vscode.window.showErrorMessage(`检查 API 文档失败: ${errorMessage}`)
      return next
    }
  }

  const addProfileFromUrl = async (url: string, defaultName?: string): Promise<void> => {
    const name = await vscode.window.showInputBox({
      title: "新增 API 配置",
      prompt: "填写面板中显示的名称",
      value: defaultName || urlHistory.find((item) => item.url === url)?.name || "后端 API",
      ignoreFocusOut: true,
    })
    if (name === undefined) return
    const profile: ApiProfile = {
      id: createProfileId(),
      name: name.trim() || url,
      sourceType: "url",
      url,
      autoWatch: false,
      status: "unknown",
    }
    await profileManager.upsertProfile(profile)
    await profileManager.setDefaultProfile(profile.id)
    saveUrlToHistory(url)
    apiPanelProvider.refresh()
  }

  const addUrlProfile = async (): Promise<void> => {
    const url = await showUrlHistoryQuickPick()
    if (!url) return
    await addProfileFromUrl(url)
  }

  const copyHistoryItem = async (item: ApiHistoryItem): Promise<void> => {
    await vscode.env.clipboard.writeText(item.url)
    vscode.window.showInformationMessage("URL 已复制到剪切板")
  }

  const deleteHistoryItem = async (item: ApiHistoryItem): Promise<void> => {
    const confirm = await vscode.window.showWarningMessage(
      `删除缓存 URL "${item.name || item.url}"？`,
      { modal: true },
      "删除"
    )
    if (confirm !== "删除") return
    urlHistory = urlHistory.filter((history) => history.url !== item.url)
    await context.globalState.update("urlHistory", urlHistory)
    apiPanelProvider.refresh()
  }

  const editHistoryItem = async (item: ApiHistoryItem): Promise<void> => {
    const name = await vscode.window.showInputBox({
      title: "编辑缓存名称",
      prompt: "留空则使用 URL 作为显示名称",
      value: item.name || "",
      ignoreFocusOut: true,
    })
    if (name === undefined) return
    const url = await vscode.window.showInputBox({
      title: "编辑缓存 URL",
      prompt: "修改 API 文档 URL",
      value: item.url,
      ignoreFocusOut: true,
    })
    if (url === undefined) return
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      vscode.window.showErrorMessage("URL 不能为空")
      return
    }
    urlHistory = urlHistory.filter((history) => history.url !== item.url && history.url !== trimmedUrl)
    urlHistory.unshift({
      url: trimmedUrl,
      name: name.trim() || undefined,
      swaggerVersion: item.swaggerVersion,
    })
    if (urlHistory.length > MAX_HISTORY_LENGTH) urlHistory = urlHistory.slice(0, MAX_HISTORY_LENGTH)
    await context.globalState.update("urlHistory", urlHistory)
    apiPanelProvider.refresh()
  }

  const pickProfileOutput = async (_profile: ApiProfile): Promise<void> => {
    const config = vscode.workspace.getConfiguration("generator-ts-api")
    const outputType = ((config.get("outputType") as string) || "ts")
    const outputSplit = ((config.get("outputSplit") as string) || "single")
    const outputPath = await pickOutputPath(outputSplit, outputType)
    if (!outputPath) return
    await saveWorkspaceOutputPath(config, outputPath, outputSplit)
    apiPanelProvider.refresh()
    vscode.window.showInformationMessage("工作区全局输出位置已更新")
  }

  const pickProfileControllers = async (profile: ApiProfile): Promise<void> => {
    const loading = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
    loading.text = "$(sync~spin) 读取 Controller..."
    loading.show()
    try {
      const apiDocs = await loadProfileDocs(profile)
      const controllerNames = getControllerNames(apiDocs)
      const selected = await vscode.window.showQuickPick(
        controllerNames.map((name) => ({
          label: name,
          picked: profile.selectedControllers?.includes(name) || false,
        })),
        {
          title: "选择要生成的 Controller",
          placeHolder: "不选择表示生成全部 Controller",
          canPickMany: true,
          matchOnDescription: true,
        }
      )
      if (!selected) return
      await profileManager.updateProfile(profile.id, {
        selectedControllers: selected.length > 0 ? selected.map((item) => item.label) : undefined,
        lastCheckedAt: Date.now(),
        lastDocHash: getApiDocHash(apiDocs),
        status: "online",
        statusMessage: "Controller 已更新",
      })
      apiPanelProvider.refresh()
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "未知错误"
      vscode.window.showErrorMessage(`读取 Controller 失败: ${errorMessage}`)
    } finally {
      try { loading.hide(); loading.dispose() } catch (_) { /* ignore */ }
    }
  }

  let watchTimer: NodeJS.Timeout | undefined
  const refreshWatchTimer = () => {
    if (watchTimer) clearInterval(watchTimer)
    const watchedProfiles = profileManager.getProfiles().filter((profile) => profile.autoWatch)
    if (watchedProfiles.length === 0) {
      watchTimer = undefined
      return
    }
    const config = vscode.workspace.getConfiguration("generator-ts-api")
    const intervalSeconds = Math.max((config.get("watch.intervalSeconds") as number) || 120, 60)
    watchTimer = setInterval(() => {
      for (const profile of profileManager.getProfiles().filter((item) => item.autoWatch)) {
        checkProfile(profile, true)
      }
    }, intervalSeconds * 1000)
  }

  const runWithConcurrency = async <T>(
    items: T[],
    limit: number,
    runner: (item: T) => Promise<unknown>
  ): Promise<void> => {
    let nextIndex = 0
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex++]
        await runner(item)
      }
    })
    await Promise.allSettled(workers)
  }

  const refreshPanelInfo = async (): Promise<void> => {
    loadUrlHistory()
    refreshWatchTimer()
    apiPanelProvider.refresh()
    const profiles = profileManager.getProfiles()
    if (profiles.length === 0) {
      vscode.window.showInformationMessage("面板信息已刷新")
      return
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "刷新 API 面板信息",
      },
      async () => {
        await runWithConcurrency(profiles, 3, async (profile) => {
          await checkProfile(profile, true)
        })
      }
    )
    apiPanelProvider.refresh()
    vscode.window.showInformationMessage("面板信息已刷新")
  }

  refreshWatchTimer()

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const generateCommand = vscode.commands.registerCommand(
    "generator-ts-api.generate",
    async () => {
      log("命令触发: generator-ts-api.generate")
      const config = vscode.workspace.getConfiguration("generator-ts-api")
      const apiDocsUrl = config.get("apiDocsUrl") as string
      const apiDocsPath = config.get("apiDocsPath") as string
      const framework = config.get("framework") as string
      const outputType = config.get("outputType") as string
      const outputSplit = (config.get("outputSplit") as string) || "single"
      const namingConfig = buildNamingConfig(config)

      // 右侧 loading
      const loadingRight = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
      )
      loadingRight.text = "$(sync~spin) 拉取 API 文档..."
      loadingRight.show()

      try {
        let apiDocs
        if (apiDocsUrl) {
          apiDocs = await apiParser.parseFromUrl(apiDocsUrl)
        } else if (apiDocsPath) {
          apiDocs = await apiParser.parseFromFile(apiDocsPath)
        } else {
          vscode.window.showErrorMessage("请配置API文档URL或路径")
          return
        }

        const generator = getGenerator(apiDocs)
        let outputFsPath: string | undefined
        if (outputSplit !== "single") {
          const folderUri = await vscode.window.showOpenDialog({
            title: "选择输出目录（多文件拆分）",
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: "选择输出目录",
          })
          outputFsPath = folderUri?.[0]?.fsPath
        } else {
          const outputPath = await vscode.window.showSaveDialog({
            title: "选择输出文件位置",
            filters: {
              TypeScript: ["ts"],
              JavaScript: ["js"],
            },
          })
          outputFsPath = outputPath?.fsPath
        }

        if (outputFsPath) {
          loadingRight.text = "$(sync~spin) 生成代码中..."
          const httpClientConfig = buildHttpClientConfig(config)
          const cleanOutputDir = (config.get("cleanOutputDir") as boolean) || false
          const byControllerLocalTypes = (config.get("byController.localTypes") as boolean) || false
          const extractSharedTypes = (config.get("byControllerSingleFile.extractSharedTypes") as boolean) || false
          const genResult = await generator.generate(
            apiDocs,
            framework,
            outputType,
            outputFsPath,
            outputSplit,
            namingConfig,
            httpClientConfig,
            cleanOutputDir,
            byControllerLocalTypes,
            extractSharedTypes
          )
          maybeGenerateScaffold(outputFsPath, outputSplit, httpClientConfig, outputType)
          vscode.window.showInformationMessage(buildSuccessMessage(genResult))
        }
      } catch (error: unknown) {
        // 显示更详尽的错误（parser 已经尝试包含 HTTP 详情）
        const errorMessage = error instanceof Error ? error.message : "未知错误"
        logError("生成失败:", error instanceof Error ? error.stack || error.message : error)
        vscode.window.showErrorMessage(`生成API文档失败: ${errorMessage}`)
      } finally {
        // 确保状态栏被清理，并且清空全局方法名集合，避免残留影响下次生成
        try {
          loadingRight.hide()
          loadingRight.dispose()
        } catch (_) {
          /* ignore */
        }
        try {
          ;(globalThis as any)._controllerMethodNames = {}
        } catch (_) {
          /* ignore */
        }
      }
    }
  )

  const generateFromUrlCommand = vscode.commands.registerCommand(
    "generator-ts-api.generateFromUrl",
    async () => {
      log("命令触发: generator-ts-api.generateFromUrl")
      const selected = await showUrlHistoryQuickPick()

      if (!selected) {
        log("未选择/输入 URL，命令已取消")
        return
      }

      {
        let loading: vscode.StatusBarItem | undefined
        try {
          loading = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
          )
          loading.text = "$(sync~spin) 拉取 API 文档..."
          loading.show()
          log("开始拉取 API 文档:", selected)
          const apiDocs = await apiParser.parseFromUrl(selected)
          log("API 文档拉取成功，版本:", apiDocs.openapi || apiDocs.swagger || "未知")
          const generator = getGenerator(apiDocs)
          const config = vscode.workspace.getConfiguration("generator-ts-api")
          const framework = config.get("framework") as string
          const outputType = config.get("outputType") as string
          const outputSplit = (config.get("outputSplit") as string) || "single"
          const namingConfig = buildNamingConfig(config)

          let outputFsPath: string | undefined
          if (outputSplit !== "single") {
            const folderUri = await vscode.window.showOpenDialog({
              title: "选择输出目录（多文件拆分）",
              canSelectFolders: true,
              canSelectFiles: false,
              canSelectMany: false,
              openLabel: "选择输出目录",
            })
            outputFsPath = folderUri?.[0]?.fsPath
          } else {
            const outputPath = await vscode.window.showSaveDialog({
              title: "选择输出文件位置",
              filters: {
                TypeScript: ["ts"],
                JavaScript: ["js"],
              },
            })
            outputFsPath = outputPath?.fsPath
          }

          if (!outputFsPath) {
            log("未选择输出位置，命令已取消")
          } else {
            log("输出位置:", outputFsPath, "| 拆分模式:", outputSplit)
            loading.text = "$(sync~spin) 生成代码中..."
            const httpClientConfig = buildHttpClientConfig(config)
            const cleanOutputDir = (config.get("cleanOutputDir") as boolean) || false
            const byControllerLocalTypes = (config.get("byController.localTypes") as boolean) || false
            const extractSharedTypes = (config.get("byControllerSingleFile.extractSharedTypes") as boolean) || false
            const genResult = await generator.generate(
              apiDocs,
              framework,
              outputType,
              outputFsPath,
              outputSplit,
              namingConfig,
              httpClientConfig,
              cleanOutputDir,
              byControllerLocalTypes,
              extractSharedTypes
            )
            maybeGenerateScaffold(outputFsPath, outputSplit, httpClientConfig, outputType)
            // 保存成功的 URL 到历史记录（记录 Swagger 版本）
            saveUrlToHistory(selected, typeof (apiDocs.openapi || apiDocs.swagger) === "string" ? (apiDocs.openapi || apiDocs.swagger) : undefined)
            log("生成完成:", genResult || "单文件模式")
            vscode.window.showInformationMessage(buildSuccessMessage(genResult))
          }
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : "未知错误"
          logError("生成失败:", error instanceof Error ? error.stack || error.message : error)
          vscode.window.showErrorMessage(`生成API文档失败: ${errorMessage}`)
        } finally {
          try {
            if (loading) {
              loading.hide()
              loading.dispose()
            }
          } catch (_) {
            /* ignore */
          }
          try {
            ;(globalThis as any)._controllerMethodNames = {}
          } catch (_) {
            /* ignore */
          }
        }
      }
    }
  )

  const generateFromFileCommand = vscode.commands.registerCommand(
    "generator-ts-api.generateFromFile",
    async () => {
      log("命令触发: generator-ts-api.generateFromFile")
      const fileUri = await vscode.window.showOpenDialog({
        title: "选择API文档文件",
        filters: {
          API文档: ["json", "yaml", "yml"],
        },
      })

      if (fileUri && fileUri[0]) {
        let loading: vscode.StatusBarItem | undefined
        try {
          loading = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
          )
          loading.text = "$(sync~spin) 解析 API 文档..."
          loading.show()
          const apiDocs = await apiParser.parseFromFile(fileUri[0].fsPath)
          const generator = getGenerator(apiDocs)
          const config = vscode.workspace.getConfiguration("generator-ts-api")
          const framework = config.get("framework") as string
          const outputType = config.get("outputType") as string
          const outputSplit = (config.get("outputSplit") as string) || "single"
          const namingConfig = buildNamingConfig(config)

          let outputFsPath: string | undefined
          if (outputSplit !== "single") {
            const folderUri = await vscode.window.showOpenDialog({
              title: "选择输出目录（多文件拆分）",
              canSelectFolders: true,
              canSelectFiles: false,
              canSelectMany: false,
              openLabel: "选择输出目录",
            })
            outputFsPath = folderUri?.[0]?.fsPath
          } else {
            const outputPath = await vscode.window.showSaveDialog({
              title: "选择输出文件位置",
              filters: {
                TypeScript: ["ts"],
                JavaScript: ["js"],
              },
            })
            outputFsPath = outputPath?.fsPath
          }

          if (outputFsPath) {
            loading.text = "$(sync~spin) 生成代码中..."
            const httpClientConfig = buildHttpClientConfig(config)
            const cleanOutputDir = (config.get("cleanOutputDir") as boolean) || false
            const byControllerLocalTypes = (config.get("byController.localTypes") as boolean) || false
            const extractSharedTypes = (config.get("byControllerSingleFile.extractSharedTypes") as boolean) || false
            const genResult = await generator.generate(
              apiDocs,
              framework,
              outputType,
              outputFsPath,
              outputSplit,
              namingConfig,
              httpClientConfig,
              cleanOutputDir,
              byControllerLocalTypes,
              extractSharedTypes
            )
            maybeGenerateScaffold(outputFsPath, outputSplit, httpClientConfig, outputType)
            vscode.window.showInformationMessage(buildSuccessMessage(genResult))
          }
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : "未知错误"
          logError("生成失败:", error instanceof Error ? error.stack || error.message : error)
          vscode.window.showErrorMessage(`生成API文档失败: ${errorMessage}`)
        } finally {
          try {
            if (loading) {
              loading.hide()
              loading.dispose()
            }
          } catch (_) {
            /* ignore */
          }
          try {
            ;(globalThis as any)._controllerMethodNames = {}
          } catch (_) {
            /* ignore */
          }
        }
      }
    }
  )

  // ─── generateMock 命令 ────────────────────────────────────────────────────
  const generateMockCommand = vscode.commands.registerCommand(
    "generator-ts-api.generateMock",
    async () => {
      log("命令触发: generator-ts-api.generateMock")
      const config = vscode.workspace.getConfiguration("generator-ts-api")
      const mockFormat =((config.get("mock.outputFormat") as string) || "json") as MockOutputFormat
      const mockBaseUrl = (config.get("mock.baseUrl") as string) || ""
      const mockArrayItemCount = (config.get("mock.arrayItemCount") as number) || 2

      // 步骤 1：选择 API 文档来源
      const sourceChoice = await vscode.window.showQuickPick(
        [
          { label: "$(globe) 从 URL 拉取", value: "url" },
          { label: "$(file) 从本地文件", value: "file" },
          { label: "$(settings-gear) 使用配置中的 URL/路径", value: "config" },
        ],
        { title: "生成 Mock 数据 — 选择 API 文档来源", placeHolder: "选择数据源" }
      )
      if (!sourceChoice) return

      let loading: vscode.StatusBarItem | undefined
      try {
        let apiDocs: any

        if (sourceChoice.value === "url") {
          const url = await showUrlHistoryQuickPick()
          if (!url) return
          loading = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
          loading.text = "$(sync~spin) 拉取 API 文档..."
          loading.show()
          apiDocs = await apiParser.parseFromUrl(url)
        } else if (sourceChoice.value === "file") {
          const fileUri = await vscode.window.showOpenDialog({
            title: "选择API文档文件",
            filters: { API文档: ["json", "yaml", "yml"] },
          })
          if (!fileUri?.[0]) return
          loading = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
          loading.text = "$(sync~spin) 解析 API 文档..."
          loading.show()
          apiDocs = await apiParser.parseFromFile(fileUri[0].fsPath)
        } else {
          // config
          const apiDocsUrl = config.get("apiDocsUrl") as string
          const apiDocsPath = config.get("apiDocsPath") as string
          if (!apiDocsUrl && !apiDocsPath) {
            vscode.window.showErrorMessage("请先在设置中配置 generator-ts-api.apiDocsUrl 或 apiDocsPath")
            return
          }
          loading = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
          loading.text = "$(sync~spin) 拉取 API 文档..."
          loading.show()
          apiDocs = apiDocsUrl
            ? await apiParser.parseFromUrl(apiDocsUrl)
            : await apiParser.parseFromFile(apiDocsPath)
        }

        if (loading) {
          loading.text = "$(sync~spin) 生成 Mock 数据..."
        }

        // 步骤 2：选择输出位置
        let outputFsPath: string | undefined
        if (mockFormat === "json-server") {
          const folderUri = await vscode.window.showOpenDialog({
            title: "选择 json-server Mock 输出目录",
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: "选择输出目录",
          })
          outputFsPath = folderUri?.[0]?.fsPath
        } else {
          const ext = mockFormat === "msw" ? "ts" : "json"
          const defaultName = mockFormat === "msw" ? "handlers" : "mock-data"
          const saveUri = await vscode.window.showSaveDialog({
            title: "保存 Mock 文件",
            defaultUri: vscode.Uri.file(`${defaultName}.${ext}`),
            filters: mockFormat === "msw"
              ? { TypeScript: ["ts"] }
              : { JSON: ["json"] },
          })
          outputFsPath = saveUri?.fsPath
        }
        if (!outputFsPath) return

        // 步骤 3：生成
        const mockGenerator = new MockGenerator({
          format: mockFormat,
          baseUrl: mockBaseUrl,
          arrayItemCount: mockArrayItemCount,
        })
        await mockGenerator.generate(apiDocs, outputFsPath)

        const openAction = "打开文件"
        const msg = await vscode.window.showInformationMessage(
          `Mock 数据生成成功！格式: ${mockFormat}`,
          openAction
        )
        if (msg === openAction) {
          const targetFile = mockFormat === "json-server"
            ? vscode.Uri.file(path.join(outputFsPath, "db.json"))
            : vscode.Uri.file(outputFsPath)
          vscode.window.showTextDocument(targetFile)
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "未知错误"
        logError("生成 Mock 数据失败:", error instanceof Error ? error.stack || error.message : error)
        vscode.window.showErrorMessage(`生成 Mock 数据失败: ${errorMessage}`)
      } finally {
        try { loading?.hide(); loading?.dispose() } catch (_) { /* ignore */ }
      }
    }
  )

  // ─── generateRequestTemplate 命令 ──────────────────────────────────────────
  const generateRequestTemplateCommand = vscode.commands.registerCommand(
    "generator-ts-api.generateRequestTemplate",
    async () => {
      log("命令触发: generator-ts-api.generateRequestTemplate")
      const config = vscode.workspace.getConfiguration("generator-ts-api")
      const configMode =((config.get("httpClient") as string) || "axios-wrapper") as HttpClientMode
      const configOutputType = (config.get("outputType") as string) || "ts"

      // ── 步骤 1：选择 HTTP 客户端模式 ──────────────────────────────────────
      const modeItems: (vscode.QuickPickItem & { value: HttpClientMode })[] = [
        {
          label: "$(symbol-class) axios-wrapper",
          description: "（推荐）getConfigs + request 包装器风格，含完整封装",
          value: "axios-wrapper",
          picked: configMode === "axios-wrapper",
        },
        {
          label: "$(symbol-method) axios",
          description: "axios 直调：生成 axios.get / axios.post 风格",
          value: "axios",
          picked: configMode === "axios",
        },
        {
          label: "$(globe) fetch",
          description: "原生 fetch 直调，无需 axios 依赖",
          value: "fetch",
          picked: configMode === "fetch",
        },
      ]

      const selectedMode = await vscode.window.showQuickPick(modeItems, {
        title: "生成 Request 模板文件 — 选择 HTTP 客户端模式",
        placeHolder: `当前配置: ${configMode}`,
        matchOnDescription: true,
      })
      if (!selectedMode) return

      const chosenMode: HttpClientMode = selectedMode.value

      // ── 步骤 2：确认 import 路径（fetch 模式跳过）─────────────────────────
      let importPath = ""
      if (chosenMode !== "fetch") {
        let defaultImportPath = (config.get("requestImportPath") as string) || ""
        if (!defaultImportPath) {
          defaultImportPath = chosenMode === "axios" ? "axios" : "axios"
        }
        const inputValue = await vscode.window.showInputBox({
          title: "生成 Request 模板文件 — 填写 axios import 路径",
          prompt: `填写 axios 库的 import 路径（留空使用默认值 "axios"）`,
          value: defaultImportPath,
          placeHolder: "axios",
          ignoreFocusOut: true,
        })
        if (inputValue === undefined) return // 用户取消
        importPath = inputValue.trim() || "axios"
      }

      // ── 步骤 3：选择输出文件类型 ──────────────────────────────────────────
      const extItems = [
        { label: "TypeScript (.ts)", value: "ts", picked: configOutputType === "ts" },
        { label: "JavaScript (.js)", value: "js", picked: configOutputType === "js" },
      ]
      const selectedExt = await vscode.window.showQuickPick(extItems, {
        title: "生成 Request 模板文件 — 选择输出文件类型",
        placeHolder: "选择输出文件后缀",
      })
      if (!selectedExt) return
      const ext = selectedExt.value

      // ── 步骤 4：选择保存位置 ──────────────────────────────────────────────
      const saveUri = await vscode.window.showSaveDialog({
        title: "保存 Request 模板文件",
        defaultUri: vscode.Uri.file(`request.${ext}`),
        filters: ext === "ts" ? { TypeScript: ["ts"] } : { JavaScript: ["js"] },
        saveLabel: "生成",
      })
      if (!saveUri) return
      const outputFsPath = saveUri.fsPath

      // ── 步骤 5：若文件已存在，询问是否覆盖 ───────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs")
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pathModule = require("path")
      if (fs.existsSync(outputFsPath)) {
        const overwrite = await vscode.window.showWarningMessage(
          `文件 "${pathModule.basename(outputFsPath)}" 已存在，是否覆盖？`,
          { modal: true },
          "覆盖"
        )
        if (overwrite !== "覆盖") return
      }

      // ── 步骤 6：生成内容并写入文件 ────────────────────────────────────────
      const loading = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
      loading.text = "$(sync~spin) 生成 Request 模板文件..."
      loading.show()
      try {
        const content = buildRequestTemplateContent(chosenMode, importPath, ext)
        if (!content) {
          vscode.window.showErrorMessage("所选模式不支持生成模板（custom 模式需手动编写）")
          return
        }

        const outputDir = pathModule.dirname(outputFsPath)
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
        fs.writeFileSync(outputFsPath, content, "utf-8")
      } finally {
        try { loading.hide(); loading.dispose() } catch (_) { /* ignore */ }
      }

      const openAction = "打开文件"
      const msg = await vscode.window.showInformationMessage(
        `Request 模板文件已生成：${pathModule.basename(outputFsPath)}`,
        openAction
      )
      if (msg === openAction) {
        vscode.window.showTextDocument(saveUri)
      }
    }
  )

  const addUrlProfileCommand = vscode.commands.registerCommand(
    "generator-ts-api.profile.addUrl",
    addUrlProfile
  )

  const refreshPanelCommand = vscode.commands.registerCommand(
    "generator-ts-api.profile.refreshPanel",
    refreshPanelInfo
  )

  const addProfileFromHistoryCommand = vscode.commands.registerCommand(
    "generator-ts-api.profile.addFromHistory",
    async (item: ApiHistoryItem) => addProfileFromUrl(item.url, item.name)
  )

  const editHistoryItemCommand = vscode.commands.registerCommand(
    "generator-ts-api.history.edit",
    async (item: ApiHistoryItem) => editHistoryItem(item)
  )

  const copyHistoryItemCommand = vscode.commands.registerCommand(
    "generator-ts-api.history.copy",
    async (item: ApiHistoryItem) => copyHistoryItem(item)
  )

  const deleteHistoryItemCommand = vscode.commands.registerCommand(
    "generator-ts-api.history.delete",
    async (item: ApiHistoryItem) => deleteHistoryItem(item)
  )

  const generateDefaultProfileCommand = vscode.commands.registerCommand(
    "generator-ts-api.profile.generateDefault",
    async () => {
      const profile = profileManager.getDefaultProfile()
      if (!profile) {
        await addUrlProfile()
        return
      }
      await generateProfile(profile)
    }
  )

  const generateProfileCommand = vscode.commands.registerCommand(
    "generator-ts-api.profile.generate",
    async (profile: ApiProfile) => generateProfile(profile)
  )

  const checkProfileCommand = vscode.commands.registerCommand(
    "generator-ts-api.profile.check",
    async (profile: ApiProfile) => checkProfile(profile)
  )

  const pickProfileOutputCommand = vscode.commands.registerCommand(
    "generator-ts-api.profile.pickOutput",
    async (profile: ApiProfile) => pickProfileOutput(profile)
  )

  const pickProfileControllersCommand = vscode.commands.registerCommand(
    "generator-ts-api.profile.pickControllers",
    async (profile: ApiProfile) => pickProfileControllers(profile)
  )

  const toggleProfileWatchCommand = vscode.commands.registerCommand(
    "generator-ts-api.profile.toggleWatch",
    async (profile: ApiProfile) => {
      await profileManager.updateProfile(profile.id, { autoWatch: !profile.autoWatch })
      refreshWatchTimer()
      apiPanelProvider.refresh()
    }
  )

  const setDefaultProfileCommand = vscode.commands.registerCommand(
    "generator-ts-api.profile.setDefault",
    async (profile: ApiProfile) => {
      await profileManager.setDefaultProfile(profile.id)
      apiPanelProvider.refresh()
    }
  )

  const deleteProfileCommand = vscode.commands.registerCommand(
    "generator-ts-api.profile.delete",
    async (profile: ApiProfile) => {
      const confirm = await vscode.window.showWarningMessage(
        `删除 API 配置 "${profile.name}"？`,
        { modal: true },
        "删除"
      )
      if (confirm !== "删除") return
      await profileManager.deleteProfile(profile.id)
      refreshWatchTimer()
      apiPanelProvider.refresh()
    }
  )

  context.subscriptions.push(
    generateCommand,
    generateFromUrlCommand,
    generateFromFileCommand,
    generateMockCommand,
    generateRequestTemplateCommand,
    addUrlProfileCommand,
    refreshPanelCommand,
    addProfileFromHistoryCommand,
    editHistoryItemCommand,
    copyHistoryItemCommand,
    deleteHistoryItemCommand,
    generateDefaultProfileCommand,
    generateProfileCommand,
    checkProfileCommand,
    pickProfileOutputCommand,
    pickProfileControllersCommand,
    toggleProfileWatchCommand,
    setDefaultProfileCommand,
    deleteProfileCommand,
    new vscode.Disposable(() => {
      if (watchTimer) clearInterval(watchTimer)
    })
  )
}

// This method is called when your extension is deactivated
export function deactivate() {}
