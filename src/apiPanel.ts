import * as path from "path"
import * as vscode from "vscode"
import { ApiProfile, ApiProfileManager } from "./profileManager"

export interface ApiHistoryItem {
  url: string
  name?: string
  swaggerVersion?: string
}

export interface ApiConfigRow {
  key: string
  label: string
  value: string
}

export interface ApiControllerNameMapRow {
  name: string
  value: string
  description?: string
}

type NodeKind = "profile" | "action" | "empty" | "historyRoot" | "historyItem" | "configRoot" | "section" | "info" | "configSection" | "configRow" | "configMapRoot" | "configMapItem" | "configCenter"

interface ApiConfigGroup {
  id: string
  label: string
  icon: string
  keys: string[]
}

const CONFIG_GROUPS: ApiConfigGroup[] = [
  {
    id: "source",
    label: "文档来源",
    icon: "link",
    keys: ["apiDocsUrl", "apiDocsPath", "apiDocsPathMode"],
  },
  {
    id: "output",
    label: "生成输出",
    icon: "output",
    keys: ["framework", "outputType", "outputSplit", "outputPath", "outputPathSplit", "confirmOutputPathBeforeGenerate", "selectedControllers", "cleanOutputDir"],
  },
  {
    id: "http",
    label: "HTTP 客户端",
    icon: "plug",
    keys: ["httpClient", "requestImportPath", "directReplacementRequestImportPath", "generateRequestScaffold", "compatibilityVersion"],
  },
  {
    id: "naming",
    label: "命名规范",
    icon: "symbol-key",
    keys: [
      "naming.typesDirName",
      "naming.controllersDirName",
      "naming.controllerFileNameCasing",
      "naming.controllerClassNameSuffix",
      "naming.controllerNameStrategy",
      "naming.controllerNameMap",
      "naming.skipDuplicateControllerClassNameSuffix",
      "naming.methodNameCasing",
      "naming.typeNameCasing",
      "naming.methodNamePathSuffixesEnabled",
      "naming.methodNamePathSuffixes",
      "naming.methodNamePathSuffixScopes",
    ],
  },
  {
    id: "types",
    label: "类型与拆分",
    icon: "symbol-interface",
    keys: ["typeMapping.dateTimeTarget", "typeMapping.formatMap", "byController.localTypes", "byControllerSingleFile.extractSharedTypes"],
  },
  {
    id: "panel",
    label: "面板监听",
    icon: "eye",
    keys: ["watch.intervalSeconds"],
  },
]

export class ApiPanelNode extends vscode.TreeItem {
  constructor(
    public readonly kind: NodeKind,
    label: string,
    public readonly profile?: ApiProfile,
    command?: vscode.Command,
    public readonly historyItem?: ApiHistoryItem,
    public readonly configRow?: ApiConfigRow,
    public readonly controllerNameMapRow?: ApiControllerNameMapRow,
    public readonly configGroupId?: string
  ) {
    const collapsibleState =
      kind === "profile" || kind === "section" || kind === "configMapRoot"
        ? vscode.TreeItemCollapsibleState.Expanded
        : kind === "historyRoot" || kind === "configRoot" || kind === "configSection"
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    super(label, collapsibleState)
    this.command = command
  }
}

export class ApiPanelProvider implements vscode.TreeDataProvider<ApiPanelNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ApiPanelNode | undefined | void>()
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event

  constructor(
    private readonly profileManager: ApiProfileManager,
    private readonly getUrlHistory: () => ApiHistoryItem[],
    private readonly getConfigRows: () => ApiConfigRow[],
    private readonly getControllerNameMapRows: () => vscode.ProviderResult<ApiControllerNameMapRow[]>
  ) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire()
  }

  getTreeItem(element: ApiPanelNode): vscode.TreeItem {
    return element
  }

  getChildren(element?: ApiPanelNode): vscode.ProviderResult<ApiPanelNode[]> {
    if (!element) {
      const profiles = this.profileManager.getProfiles()
      const historyRoot = new ApiPanelNode("historyRoot", "URL 缓存")
      historyRoot.iconPath = new vscode.ThemeIcon("history")
      historyRoot.contextValue = "apiHistoryRoot"
      const configRoot = new ApiPanelNode("configRoot", "配置")
      configRoot.iconPath = new vscode.ThemeIcon("settings-gear")
      configRoot.contextValue = "apiConfigRoot"
      const configCenter = new ApiPanelNode("configCenter", "打开配置中心", undefined, {
        command: "generator-ts-api.openConfigCenter",
        title: "打开配置中心",
      })
      configCenter.description = "表格编辑"
      configCenter.iconPath = new vscode.ThemeIcon("settings-gear")
      configCenter.contextValue = "apiConfigCenter"
      if (profiles.length === 0) {
        const empty = new ApiPanelNode("empty", "暂无 API 配置")
        empty.description = "点击 + 添加"
        empty.iconPath = new vscode.ThemeIcon("info")
        return [empty, configCenter, historyRoot, configRoot]
      }
      const defaultId = this.profileManager.getDefaultProfileId()
      return profiles.map((profile) => {
        const node = new ApiPanelNode("profile", profile.name, profile)
        node.description = profile.id === defaultId ? "默认" : undefined
        node.tooltip = this.buildProfileTooltip(profile)
        node.contextValue = "apiProfile"
        node.iconPath = this.getStatusIcon(profile.status)
        return node
      }).concat(configCenter, historyRoot, configRoot)
    }

    if (element.kind === "historyRoot") {
      const history = this.getUrlHistory()
      if (history.length === 0) {
        const empty = new ApiPanelNode("empty", "暂无缓存 URL")
        empty.iconPath = new vscode.ThemeIcon("info")
        return [empty]
      }
      return history.map((item) => {
        const node = new ApiPanelNode("historyItem", item.name || item.url, undefined, {
          command: "generator-ts-api.profile.addFromHistory",
          title: "从缓存新增配置",
          arguments: [item],
        }, item)
        node.description = item.name ? item.url : (item.swaggerVersion ? `[${item.swaggerVersion}]` : "")
        node.tooltip = item.url
        node.contextValue = "apiHistoryItem"
        node.iconPath = new vscode.ThemeIcon("link")
        return node
      })
    }

    if (element.kind === "configRoot") {
      return CONFIG_GROUPS.map((group) => {
        const node = new ApiPanelNode("configSection", group.label, undefined, undefined, undefined, undefined, undefined, group.id)
        node.description = `${group.keys.length} 项`
        node.tooltip = group.keys.join("\n")
        node.contextValue = "apiConfigSection"
        node.iconPath = new vscode.ThemeIcon(group.icon)
        return node
      })
    }

    if (element.kind === "configSection" && element.configGroupId) {
      const group = CONFIG_GROUPS.find((item) => item.id === element.configGroupId)
      if (!group) return []
      const configRows = this.getConfigRows()
        .filter((row) => group.keys.includes(row.key) && row.key !== "naming.controllerNameMap")
        .map((row) => {
        const node = new ApiPanelNode("configRow", row.label, undefined, undefined, undefined, row)
        node.description = row.value
        node.tooltip = `${row.key}\n${row.value}`
        node.contextValue = "apiConfigRow"
        node.iconPath = new vscode.ThemeIcon("settings")
        return node
      })
      if (element.configGroupId !== "naming") return configRows
      const mapRoot = new ApiPanelNode("configMapRoot", "Controller 命名映射")
      mapRoot.description = "按默认 API 文档 tags.name 展示"
      mapRoot.tooltip = "generator-ts-api.naming.controllerNameMap"
      mapRoot.contextValue = "apiControllerNameMapRoot"
      mapRoot.iconPath = new vscode.ThemeIcon("symbol-class")
      return configRows.concat(mapRoot)
    }

    if (element.kind === "configMapRoot") {
      const rows = this.getControllerNameMapRows()
      return Promise.resolve(rows).then((items) => {
        if (!items || items.length === 0) {
          const empty = new ApiPanelNode("empty", "暂无 Controller")
          empty.description = "默认 API 文档无 tags"
          empty.iconPath = new vscode.ThemeIcon("info")
          return [empty]
        }
        return items.map((row) => {
          const node = new ApiPanelNode("configMapItem", row.name, undefined, undefined, undefined, undefined, row)
          node.description = row.value || ""
          node.tooltip = [
            `key: ${row.name}`,
            `value: ${row.value || ""}`,
            row.description ? `description: ${row.description}` : "",
          ].filter(Boolean).join("\n")
          node.contextValue = "apiControllerNameMapItem"
          node.iconPath = row.value ? new vscode.ThemeIcon("check") : new vscode.ThemeIcon("circle-outline")
          return node
        })
      })
    }

    if (element.kind === "profile" && element.profile) {
      return [
        this.sectionNode("信息", "info", element.profile),
        this.sectionNode("操作", "tools", element.profile),
      ]
    }

    if (element.kind !== "section" || !element.profile) return []
    const profile = element.profile
    const config = vscode.workspace.getConfiguration("generator-ts-api")
    const globalOutputPath = (config.get("outputPath") as string) || ""
    const outputLabel = globalOutputPath ? path.basename(globalOutputPath) : "未设置"
    const splitLabel = (config.get("outputPathSplit") as string) || "跟随设置"
    const selectedControllers = (config.get("selectedControllers") as string[]) || []
    const controllerLabel = selectedControllers.length
      ? `${selectedControllers.length} 个`
      : "全部"

    if (element.label === "信息") {
      return [
        this.infoNode(`状态: ${this.statusText(profile)}`, profile, this.getStatusIcon(profile.status)),
        this.infoNode(`输出: ${outputLabel}`, profile, new vscode.ThemeIcon("folder")),
        this.infoNode(`上次模式: ${splitLabel}`, profile, new vscode.ThemeIcon("split-horizontal")),
        this.infoNode(`Controller: ${controllerLabel}`, profile, new vscode.ThemeIcon("symbol-class")),
        this.infoNode(`自动监听: ${profile.autoWatch ? "开启" : "关闭"}`, profile, new vscode.ThemeIcon(profile.autoWatch ? "eye" : "eye-closed")),
      ]
    }

    return [
      this.actionNode("更新 API", "sync", profile, "generator-ts-api.profile.generate"),
      this.actionNode("检查变更", "pulse", profile, "generator-ts-api.profile.check"),
      this.actionNode(profile.autoWatch ? "关闭自动监听" : "开启自动监听", profile.autoWatch ? "eye-closed" : "eye", profile, "generator-ts-api.profile.toggleWatch"),
      this.actionNode("设为默认", "star", profile, "generator-ts-api.profile.setDefault"),
      this.actionNode("删除配置", "trash", profile, "generator-ts-api.profile.delete"),
    ]
  }

  private sectionNode(label: string, icon: string, profile: ApiProfile): ApiPanelNode {
    const node = new ApiPanelNode("section", label, profile)
    node.contextValue = "apiProfileSection"
    node.iconPath = new vscode.ThemeIcon(icon)
    return node
  }

  private actionNode(label: string, icon: string, profile: ApiProfile, command: string): ApiPanelNode {
    const node = new ApiPanelNode("action", label, profile, {
      command,
      title: label,
      arguments: [profile],
    })
    node.contextValue = "apiProfileAction"
    node.iconPath = new vscode.ThemeIcon(icon)
    return node
  }

  private infoNode(label: string, profile: ApiProfile, iconPath: vscode.ThemeIcon): ApiPanelNode {
    const node = new ApiPanelNode("info", label, profile)
    node.iconPath = iconPath
    node.contextValue = "apiProfileInfo"
    return node
  }

  private statusText(profile: ApiProfile): string {
    switch (profile.status) {
      case "online": return "在线"
      case "offline": return "离线"
      case "changed": return "有变动"
      case "unchanged": return "无变动"
      default: return "未知"
    }
  }

  private getStatusIcon(status: ApiProfile["status"]): vscode.ThemeIcon {
    switch (status) {
      case "online": return new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("testing.iconPassed"))
      case "changed": return new vscode.ThemeIcon("warning", new vscode.ThemeColor("testing.iconQueued"))
      case "unchanged": return new vscode.ThemeIcon("check", new vscode.ThemeColor("testing.iconPassed"))
      case "offline": return new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed"))
      default: return new vscode.ThemeIcon("question", new vscode.ThemeColor("descriptionForeground"))
    }
  }

  private buildProfileTooltip(profile: ApiProfile): string {
    const source = profile.sourceType === "url" ? profile.url : profile.filePath
    const config = vscode.workspace.getConfiguration("generator-ts-api")
    const globalOutputPath = (config.get("outputPath") as string) || ""
    return [
      profile.name,
      source ? `来源: ${source}` : "",
      globalOutputPath ? `全局输出: ${globalOutputPath}` : "",
      profile.statusMessage ? `状态: ${profile.statusMessage}` : "",
    ].filter(Boolean).join("\n")
  }
}
