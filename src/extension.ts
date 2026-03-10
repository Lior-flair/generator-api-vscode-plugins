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
} from "./generatorCommon"

// 存储 URL 历史记录
const MAX_HISTORY_LENGTH = 10
let urlHistory: string[] = [
  "http://192.168.18.238:8080/vmoto-admin-api/v3/api-docs",
  "http://192.168.18.15:8080/v3/api-docs",
  "http://192.168.18.15:9090/v3/api-docs",
  "http://localhost:8080/v3/api-docs",
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
  const outputDir = outputSplit === "byTag" ? outputFsPath : path.dirname(outputFsPath)
  const ext = outputType === "js" ? "js" : "ts"
  generateRequestScaffoldFile(outputDir, httpClientConfig, ext)
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const apiGeneratorV3 = new ApiGeneratorV3()
  const apiGeneratorV2 = new ApiGeneratorV2()
  const apiParser = new ApiParser()

  // 从扩展存储中加载历史记录
  urlHistory = context.globalState.get("urlHistory", urlHistory)

  // 保存 URL 到历史记录
  const saveUrlToHistory = (url: string) => {
    // 移除已存在的相同 URL
    urlHistory = urlHistory.filter((item) => item !== url)
    // 添加到开头
    urlHistory.unshift(url)
    // 保持历史记录长度
    if (urlHistory.length > MAX_HISTORY_LENGTH) {
      urlHistory = urlHistory.slice(0, MAX_HISTORY_LENGTH)
    }
    // 保存到扩展存储
    context.globalState.update("urlHistory", urlHistory)
  }

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
        if (outputSplit === "byTag") {
          const folderUri = await vscode.window.showOpenDialog({
            title: "选择输出目录（按 Tag 拆分）",
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
          const httpClientConfig = buildHttpClientConfig(config)
          await generator.generate(
            apiDocs,
            framework,
            outputType,
            outputFsPath,
            outputSplit,
            namingConfig,
            httpClientConfig
          )
          maybeGenerateScaffold(outputFsPath, outputSplit, httpClientConfig, outputType)
          vscode.window.showInformationMessage("API文档生成成功！")
        }
      } catch (error: unknown) {
        // 显示更详尽的错误（parser 已经尝试包含 HTTP 详情）
        const errorMessage = error instanceof Error ? error.message : "未知错误"
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
      // 创建快速选择项
      const quickPick = vscode.window.createQuickPick()
      quickPick.placeholder = "输入新的URL或选择历史记录"
      quickPick.items = [
        { label: "输入新URL", description: "手动输入API文档URL" },
        ...urlHistory.map((url) => ({
          label: url,
          description: "历史记录",
        })),
      ]

      // 处理选择
      const selected = await new Promise<string | undefined>((resolve) => {
        quickPick.onDidAccept(() => {
          const selection = quickPick.selectedItems[0]
          if (selection) {
            if (selection.label === "输入新URL") {
              // 如果选择了"输入新URL"，显示输入框
              vscode.window
                .showInputBox({
                  prompt: "请输入API文档URL",
                  placeHolder: "https://example.com/api-docs",
                  value: urlHistory[0] || "",
                  valueSelection: urlHistory[0]
                    ? [0, urlHistory[0].length]
                    : undefined,
                  ignoreFocusOut: true,
                })
                .then(resolve)
            } else {
              // 如果选择了历史记录，直接使用
              resolve(selection.label)
            }
          } else {
            resolve(undefined)
          }
          quickPick.hide()
        })

        quickPick.onDidHide(() => {
          if (!quickPick.selectedItems.length) {
            resolve(undefined)
          }
        })

        quickPick.show()
      })

      if (selected) {
        let loading: vscode.StatusBarItem | undefined
        try {
          const apiDocs = await apiParser.parseFromUrl(selected)
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
          }

          let outputFsPath: string | undefined
          if (outputSplit === "byTag") {
            const folderUri = await vscode.window.showOpenDialog({
              title: "选择输出目录（按 Tag 拆分）",
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
            // 添加右侧 loading（拉取/生成）
            loading = vscode.window.createStatusBarItem(
              vscode.StatusBarAlignment.Right,
              100
            )
            loading.text = "$(sync~spin) 生成中..."
            loading.show()
            const httpClientConfig = buildHttpClientConfig(config)
            await generator.generate(
              apiDocs,
              framework,
              outputType,
              outputFsPath,
              outputSplit,
              namingConfig,
              httpClientConfig
            )
            maybeGenerateScaffold(outputFsPath, outputSplit, httpClientConfig, outputType)
            // 保存成功的 URL 到历史记录
            saveUrlToHistory(selected)
            vscode.window.showInformationMessage("API文档生成成功！")
          }
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : "未知错误"
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
      const fileUri = await vscode.window.showOpenDialog({
        title: "选择API文档文件",
        filters: {
          API文档: ["json", "yaml", "yml"],
        },
      })

      if (fileUri && fileUri[0]) {
        let loading: vscode.StatusBarItem | undefined
        try {
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
          }

          let outputFsPath: string | undefined
          if (outputSplit === "byTag") {
            const folderUri = await vscode.window.showOpenDialog({
              title: "选择输出目录（按 Tag 拆分）",
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
            // 添加右侧 loading（生成）
            loading = vscode.window.createStatusBarItem(
              vscode.StatusBarAlignment.Right,
              100
            )
            loading.text = "$(sync~spin) 生成中..."
            loading.show()
            const httpClientConfig = buildHttpClientConfig(config)
            await generator.generate(
              apiDocs,
              framework,
              outputType,
              outputFsPath,
              outputSplit,
              namingConfig,
              httpClientConfig
            )
            maybeGenerateScaffold(outputFsPath, outputSplit, httpClientConfig, outputType)
            vscode.window.showInformationMessage("API文档生成成功！")
          }
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : "未知错误"
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
      const config = vscode.workspace.getConfiguration("generator-ts-api")
      const mockFormat = ((config.get("mock.outputFormat") as string) || "json") as MockOutputFormat
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
          const quickPick = vscode.window.createQuickPick()
          quickPick.placeholder = "输入新的URL或选择历史记录"
          quickPick.items = [
            { label: "输入新URL", description: "手动输入API文档URL" },
            ...urlHistory.map((url) => ({ label: url, description: "历史记录" })),
          ]
          const url = await new Promise<string | undefined>((resolve) => {
            quickPick.onDidAccept(() => {
              const sel = quickPick.selectedItems[0]
              if (sel?.label === "输入新URL") {
                vscode.window.showInputBox({ prompt: "请输入API文档URL", placeHolder: "https://example.com/api-docs", ignoreFocusOut: true }).then(resolve)
              } else {
                resolve(sel?.label)
              }
              quickPick.hide()
            })
            quickPick.onDidHide(() => resolve(undefined))
            quickPick.show()
          })
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
      const config = vscode.workspace.getConfiguration("generator-ts-api")
      const configMode = ((config.get("httpClient") as string) || "axios-wrapper") as HttpClientMode
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
      const content = buildRequestTemplateContent(chosenMode, importPath, ext)
      if (!content) {
        vscode.window.showErrorMessage("所选模式不支持生成模板（custom 模式需手动编写）")
        return
      }

      const outputDir = pathModule.dirname(outputFsPath)
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
      fs.writeFileSync(outputFsPath, content, "utf-8")

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
