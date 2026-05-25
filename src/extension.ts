// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as path from "path"
import * as vscode from "vscode"
import { ApiGenerator as ApiGeneratorV3 } from "./generatorV3"
import { ApiGenerator as ApiGeneratorV2 } from "./generatorV2"
import { ApiParser } from "./parser"
import { MockGenerator, type MockOutputFormat } from "./mockGenerator"
import {
  type CompatibilityVersion,
  type FormatTypeMappings,
  generateRequestScaffoldFile,
  buildRequestTemplateContent,
  type HttpClientConfig,
  type HttpClientMode,
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

  // 从扩展存储中加载历史记录，兼容旧版 string[] 格式
  const rawHistory = context.globalState.get<any[]>("urlHistory")
  if (rawHistory) {
    urlHistory = rawHistory.map((item: any) =>
      typeof item === "string" ? { url: item } : (item as HistoryItem)
    )
  }

  // 保存 URL 到历史记录（保留已有名称，更新版本）
  const saveUrlToHistory = (url: string, swaggerVersion?: string) => {
    const existing = urlHistory.find((item) => item.url === url)
    urlHistory = urlHistory.filter((item) => item.url !== url)
    urlHistory.unshift({ url, name: existing?.name, swaggerVersion: swaggerVersion || existing?.swaggerVersion })
    if (urlHistory.length > MAX_HISTORY_LENGTH) urlHistory = urlHistory.slice(0, MAX_HISTORY_LENGTH)
    context.globalState.update("urlHistory", urlHistory)
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
      const namingConfig = {
        typesDirName: (config.get("naming.typesDirName") as string) || "types",
        controllersDirName: (config.get("naming.controllersDirName") as string) || "controllers",
        controllerFileNameCasing: ((config.get("naming.controllerFileNameCasing") as string) || "default") as "default" | "PascalCase" | "camelCase" | "kebab-case",
        controllerClassNameSuffix: (config.get("naming.controllerClassNameSuffix") as string) || "",
        methodNameCasing: ((config.get("naming.methodNameCasing") as string) || "default") as "default" | "PascalCase" | "camelCase" | "kebab-case",
        typeNameCasing: ((config.get("naming.typeNameCasing") as string) || "follow") as "follow" | "default" | "PascalCase" | "camelCase" | "kebab-case",
      }

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
          const namingConfig = {
            typesDirName: (config.get("naming.typesDirName") as string) || "types",
            controllersDirName: (config.get("naming.controllersDirName") as string) || "controllers",
            controllerFileNameCasing: ((config.get("naming.controllerFileNameCasing") as string) || "default") as "default" | "PascalCase" | "camelCase" | "kebab-case",
            controllerClassNameSuffix: (config.get("naming.controllerClassNameSuffix") as string) || "",
            methodNameCasing: ((config.get("naming.methodNameCasing") as string) || "default") as "default" | "PascalCase" | "camelCase" | "kebab-case",
            typeNameCasing: ((config.get("naming.typeNameCasing") as string) || "follow") as "follow" | "default" | "PascalCase" | "camelCase" | "kebab-case",
          }

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
          const namingConfig = {
            typesDirName: (config.get("naming.typesDirName") as string) || "types",
            controllersDirName: (config.get("naming.controllersDirName") as string) || "controllers",
            controllerFileNameCasing: ((config.get("naming.controllerFileNameCasing") as string) || "default") as "default" | "PascalCase" | "camelCase" | "kebab-case",
            controllerClassNameSuffix: (config.get("naming.controllerClassNameSuffix") as string) || "",
            methodNameCasing: ((config.get("naming.methodNameCasing") as string) || "default") as "default" | "PascalCase" | "camelCase" | "kebab-case",
            typeNameCasing: ((config.get("naming.typeNameCasing") as string) || "follow") as "follow" | "default" | "PascalCase" | "camelCase" | "kebab-case",
          }

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

  context.subscriptions.push(
    generateCommand,
    generateFromUrlCommand,
    generateFromFileCommand,
    generateMockCommand,
    generateRequestTemplateCommand
  )
}

// This method is called when your extension is deactivated
export function deactivate() {}
