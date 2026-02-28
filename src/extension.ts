// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as path from "path"
import * as vscode from "vscode"
import { ApiGenerator as ApiGeneratorV3 } from "./generatorV3"
import { ApiGenerator as ApiGeneratorV2 } from "./generatorV2"
import { ApiParser } from "./parser"
import {
  generateRequestScaffoldFile,
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
  let requestImportPath = (config.get("requestImportPath") as string) || ""
  if (!requestImportPath) {
    switch (mode) {
      case "axios": requestImportPath = "axios"; break
      case "axios-wrapper": requestImportPath = "@/utils/request"; break
      default: requestImportPath = ""
    }
  }
  return {
    mode,
    requestImportPath,
    generateRequestScaffold: (config.get("generateRequestScaffold") as boolean) || false,
    customTemplateFile: (config.get("customTemplate.templateFile") as string) || undefined,
    customTemplateString: (config.get("customTemplate.templateString") as string) || undefined,
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

  context.subscriptions.push(
    generateCommand,
    generateFromUrlCommand,
    generateFromFileCommand
  )
}

// This method is called when your extension is deactivated
export function deactivate() {}
