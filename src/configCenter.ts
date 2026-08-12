import * as vscode from "vscode"

type ConfigKind = "text" | "number" | "boolean" | "select" | "json"

interface ConfigField {
  key: string
  label: string
  description: string
  category: string
  kind: ConfigKind
  defaultValue: unknown
  options?: Array<{ value: string; label: string }>
  advanced?: boolean
}

interface ConfigFieldState extends ConfigField {
  value: unknown
  source: "workspaceFolder" | "workspace" | "global" | "default"
}

const FIELDS: ConfigField[] = [
  { key: "apiDocsUrl", label: "API 文档地址", description: "远程 OpenAPI / Swagger 地址，也可填写服务基础地址。", category: "文档来源", kind: "text", defaultValue: "" },
  { key: "apiDocsPath", label: "本地文档路径", description: "本地 JSON、YAML 或 YML 文档路径；URL 已填写时优先使用 URL。", category: "文档来源", kind: "text", defaultValue: "" },
  { key: "apiDocsPathMode", label: "本地路径保存方式", description: "相对路径以工作区根目录为基准；工作区外文件自动保存为绝对路径。", category: "文档来源", kind: "select", defaultValue: "workspaceRelative", options: [{ value: "workspaceRelative", label: "相对工作区" }, { value: "absolute", label: "绝对路径" }] },
  { key: "framework", label: "目标框架", description: "生成代码时使用的前端框架适配。", category: "生成与输出", kind: "select", defaultValue: "react", options: options(["react", "vue", "angular"]) },
  { key: "outputType", label: "输出语言", description: "生成 TypeScript 或 JavaScript 文件。", category: "生成与输出", kind: "select", defaultValue: "ts", options: [{ value: "ts", label: "TypeScript (.ts)" }, { value: "js", label: "JavaScript (.js)" }] },
  { key: "outputSplit", label: "拆分方式", description: "决定生成单文件，或按 Tag、Controller 组织目录。", category: "生成与输出", kind: "select", defaultValue: "single", options: [{ value: "single", label: "单文件" }, { value: "byTag", label: "按 Tag" }, { value: "byController", label: "按 Controller 文件夹" }, { value: "byControllerSingleFile", label: "每个 Controller 单文件" }] },
  { key: "outputPath", label: "输出位置", description: "所有生成入口共用的输出位置，支持 workspaceFolder 变量。", category: "生成与输出", kind: "text", defaultValue: "" },
  { key: "confirmOutputPathBeforeGenerate", label: "生成前确认输出位置", description: "关闭后每次生成直接使用当前输出路径，不再提示。", category: "生成与输出", kind: "boolean", defaultValue: true },
  { key: "selectedControllers", label: "Controller 范围", description: "原始 OpenAPI Tag 名称数组；空数组表示全部。", category: "生成与输出", kind: "json", defaultValue: [] },
  { key: "cleanOutputDir", label: "生成前清理", description: "生成前清理上一次由插件生成的目标。", category: "生成与输出", kind: "boolean", defaultValue: false },
  { key: "httpClient", label: "请求客户端", description: "决定请求方法的生成形式和默认 import。", category: "HTTP 请求", kind: "select", defaultValue: "axios-wrapper", options: options(["axios-wrapper", "axios", "fetch", "custom"]) },
  { key: "requestImportPath", label: "Request Import", description: "request 模块 import 路径；留空时按客户端模式取默认值。", category: "HTTP 请求", kind: "text", defaultValue: "" },
  { key: "directReplacementRequestImportPath", label: "直接插入 Import", description: "将 Request Import 内容作为完整 import 代码插入。", category: "HTTP 请求", kind: "boolean", defaultValue: false, advanced: true },
  { key: "generateRequestScaffold", label: "生成 Request 样板", description: "输出目录不存在 request 文件时生成基础封装。", category: "HTTP 请求", kind: "boolean", defaultValue: false },
  { key: "naming.typesDirName", label: "类型目录名", description: "共享类型定义的目录名称。", category: "命名规则", kind: "text", defaultValue: "types", advanced: true },
  { key: "naming.controllersDirName", label: "Controller 目录名", description: "控制器代码的目录名称。", category: "命名规则", kind: "text", defaultValue: "controllers", advanced: true },
  { key: "naming.controllerFileNameCasing", label: "Controller 文件命名", description: "Controller 文件名与类名的命名风格。", category: "命名规则", kind: "select", defaultValue: "default", options: casingOptions(), advanced: true },
  { key: "naming.controllerClassNameSuffix", label: "Controller 类后缀", description: "例如 Controller；留空时不追加。", category: "命名规则", kind: "text", defaultValue: "", advanced: true },
  { key: "naming.controllerNameStrategy", label: "Controller 命名来源", description: "从 Tag 名称、说明或自动规则生成名称。", category: "命名规则", kind: "select", defaultValue: "tagName", options: options(["tagName", "tagDescription", "auto"]), advanced: true },
  { key: "naming.controllerNameMap", label: "Controller 命名映射", description: "将原始 Tag 映射为稳定的文件名或类名。", category: "命名规则", kind: "json", defaultValue: {}, advanced: true },
  { key: "naming.skipDuplicateControllerClassNameSuffix", label: "跳过重复类后缀", description: "来源已包含后缀时不再重复追加。", category: "命名规则", kind: "boolean", defaultValue: true, advanced: true },
  { key: "naming.methodNameCasing", label: "方法命名", description: "生成请求方法名的大小写风格。", category: "命名规则", kind: "select", defaultValue: "default", options: casingOptions() },
  { key: "naming.typeNameCasing", label: "类型命名", description: "生成类型定义名称的大小写风格。", category: "命名规则", kind: "select", defaultValue: "follow", options: [{ value: "follow", label: "跟随方法命名" }, ...casingOptions()], advanced: true },
  { key: "naming.methodNamePathSuffixesEnabled", label: "稳定方法名", description: "启用通用 Path 后缀稳定命名。", category: "命名规则", kind: "boolean", defaultValue: false, advanced: true },
  { key: "naming.methodNamePathSuffixes", label: "方法名 Path 后缀", description: "需要稳定命名的通用 Path 后缀数组。", category: "命名规则", kind: "json", defaultValue: [], advanced: true },
  { key: "naming.methodNamePathSuffixScopes", label: "方法名定向作用域", description: "按 Controller 和 Path 前缀限制稳定命名范围。", category: "命名规则", kind: "json", defaultValue: [], advanced: true },
  { key: "byController.localTypes", label: "Controller 本地类型", description: "在每个 Controller 目录生成独立 types 文件。", category: "类型与兼容", kind: "boolean", defaultValue: false, advanced: true },
  { key: "byControllerSingleFile.extractSharedTypes", label: "抽离共用类型", description: "将多个 Controller 共用的类型抽离到共享目录。", category: "类型与兼容", kind: "boolean", defaultValue: false, advanced: true },
  { key: "compatibilityVersion", label: "兼容版本", description: "控制默认标量类型映射，旧项目可保持 0.0.x 行为。", category: "类型与兼容", kind: "select", defaultValue: "latest", options: [{ value: "latest", label: "最新版本" }, { value: "0.0.x", label: "兼容 0.0.x" }] },
  { key: "typeMapping.dateTimeTarget", label: "date-time 类型", description: "OpenAPI date-time 字段生成的 TypeScript 类型。", category: "类型与兼容", kind: "select", defaultValue: "string", options: options(["string", "Date"]) },
  { key: "typeMapping.formatMap", label: "自定义 Format 映射", description: "自定义 OpenAPI format 到 TypeScript 类型的映射。", category: "类型与兼容", kind: "json", defaultValue: {}, advanced: true },
  { key: "mock.outputFormat", label: "Mock 输出格式", description: "生成普通 JSON、MSW handlers 或 json-server 文件。", category: "Mock", kind: "select", defaultValue: "json", options: options(["json", "msw", "json-server"]) },
  { key: "mock.baseUrl", label: "Mock 基础路径", description: "MSW 和 json-server 接口路径前缀。", category: "Mock", kind: "text", defaultValue: "", advanced: true },
  { key: "mock.arrayItemCount", label: "数组示例数量", description: "Mock 数组字段默认生成的条目数量。", category: "Mock", kind: "number", defaultValue: 2, advanced: true },
  { key: "watch.intervalSeconds", label: "监听间隔", description: "侧边栏自动监听的检查间隔，最低 60 秒。", category: "监听与更新", kind: "number", defaultValue: 120 },
]

function options(values: string[]): Array<{ value: string; label: string }> {
  return values.map((value) => ({ value, label: value }))
}

function casingOptions(): Array<{ value: string; label: string }> {
  return [{ value: "default", label: "保持原样" }, ...options(["PascalCase", "camelCase", "kebab-case"])]
}

export class ConfigCenterPanel {
  private static current: ConfigCenterPanel | undefined
  private saving = false

  static show(extensionUri: vscode.Uri, onGenerate: () => Thenable<unknown>): void {
    if (ConfigCenterPanel.current) {
      ConfigCenterPanel.current.panel.reveal(vscode.ViewColumn.One)
      ConfigCenterPanel.current.refresh()
      return
    }
    const panel = vscode.window.createWebviewPanel(
      "generatorTsApiConfigCenter",
      "Generator TS API · 配置中心",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    )
    ConfigCenterPanel.current = new ConfigCenterPanel(panel, extensionUri, onGenerate)
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly onGenerate: () => Thenable<unknown>
  ) {
    void this.extensionUri
    this.panel.onDidDispose(() => { ConfigCenterPanel.current = undefined })
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message))
    const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (!this.saving && event.affectsConfiguration("generator-ts-api")) this.refresh()
    })
    this.panel.onDidDispose(() => configListener.dispose())
    this.refresh()
  }

  private getFieldStates(): ConfigFieldState[] {
    const config = vscode.workspace.getConfiguration("generator-ts-api")
    return FIELDS.map((field) => {
      const inspected = config.inspect(field.key)
      let source: ConfigFieldState["source"] = "default"
      if (inspected?.workspaceFolderValue !== undefined) source = "workspaceFolder"
      else if (inspected?.workspaceValue !== undefined) source = "workspace"
      else if (inspected?.globalValue !== undefined) source = "global"
      return { ...field, value: config.get(field.key, field.defaultValue), source }
    })
  }

  private refresh(): void {
    this.panel.webview.html = this.buildHtml(this.getFieldStates())
  }

  private async handleMessage(message: { type?: string; values?: Record<string, unknown> }): Promise<void> {
    if (message.type === "openSettings") {
      await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:Lior.generator-ts-api")
      return
    }
    if (message.type !== "save" && message.type !== "saveAndGenerate") return
    try {
      this.saving = true
      const config = vscode.workspace.getConfiguration("generator-ts-api")
      for (const field of FIELDS) {
        if (!message.values || !Object.prototype.hasOwnProperty.call(message.values, field.key)) continue
        await config.update(field.key, message.values[field.key], vscode.ConfigurationTarget.Workspace)
      }
      this.panel.webview.postMessage({ type: "saved" })
      if (message.type === "saveAndGenerate") await this.onGenerate()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.panel.webview.postMessage({ type: "error", message: detail })
    } finally {
      this.saving = false
    }
  }

  private buildHtml(fields: ConfigFieldState[]): string {
    const nonce = `${Date.now()}${Math.random().toString(36).slice(2)}`
    const categories = [...new Set(fields.map((field) => field.category))]
    const sections = categories.map((category) => {
      const rows = fields.filter((field) => field.category === category).map((field) => this.renderRow(field)).join("")
      return `<section class="section"><button class="section-title" type="button"><span>⌄</span><strong>${escapeHtml(category)}</strong><small>${fields.filter((field) => field.category === category).length} 项</small></button><div class="section-body">${rows}</div></section>`
    }).join("")
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><style nonce="${nonce}">
      *{box-sizing:border-box}body{margin:0;padding:0 0 72px;background:var(--vscode-editor-background);color:var(--vscode-foreground);font:13px var(--vscode-font-family)}button,input,select,textarea{font:inherit}.page{max-width:1320px;margin:auto;padding:26px}.hero{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:18px}h1{font-size:22px;margin:0 0 7px;color:var(--vscode-foreground)}p{margin:0;color:var(--vscode-descriptionForeground);line-height:1.55}.actions,.filters,.footer-actions{display:flex;gap:8px;align-items:center}.btn{border:1px solid var(--vscode-button-border,transparent);border-radius:2px;padding:6px 12px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer}.btn:hover{background:var(--vscode-button-secondaryHoverBackground)}.btn.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.btn.primary:hover{background:var(--vscode-button-hoverBackground)}.notice{padding:10px 12px;margin:0 0 16px;border:1px solid var(--vscode-focusBorder);background:var(--vscode-textBlockQuote-background);line-height:1.5}.filters{justify-content:space-between;margin-bottom:10px}.search{width:min(430px,45vw);height:30px}.filters input[type=checkbox]{vertical-align:-2px}.table{border:1px solid var(--vscode-panel-border);border-radius:4px;overflow:hidden}.head,.row{display:grid;grid-template-columns:160px 190px minmax(240px,1fr) minmax(240px,1.1fr) 110px;align-items:center}.head{min-height:36px;padding:0 14px;background:var(--vscode-editorGroupHeader-tabsBackground);color:var(--vscode-descriptionForeground);font-size:11px}.section-title{width:100%;display:flex;gap:9px;align-items:center;padding:11px 14px;border:0;border-top:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background);color:var(--vscode-foreground);cursor:pointer;text-align:left}.section:first-of-type .section-title{border-top:0}.section-title small{margin-left:auto;color:var(--vscode-descriptionForeground)}.section.collapsed .section-title span{transform:rotate(-90deg)}.section.collapsed .section-body{display:none}.row{min-height:60px;padding:8px 14px;border-top:1px solid var(--vscode-panel-border)}.row:hover{background:var(--vscode-list-hoverBackground)}.cell{min-width:0;padding-right:16px}.category,.desc{color:var(--vscode-descriptionForeground)}.name{font-weight:600}.key{margin-top:3px;color:var(--vscode-disabledForeground);font:10px var(--vscode-editor-font-family)}input[type=text],input[type=number],select,textarea{width:100%;border:1px solid var(--vscode-input-border,transparent);border-radius:2px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);padding:5px 7px;outline:none}textarea{min-height:54px;resize:vertical;font-family:var(--vscode-editor-font-family)}input:focus,select:focus,textarea:focus{border-color:var(--vscode-focusBorder)}.toggle{display:flex;gap:8px;align-items:center}.badge{display:inline-block;border:1px solid var(--vscode-panel-border);border-radius:99px;padding:3px 7px;color:var(--vscode-descriptionForeground);font-size:10px}.badge.workspace,.badge.folder{border-color:var(--vscode-focusBorder);color:var(--vscode-textLink-foreground)}.advanced.hidden,.row.filtered{display:none}.footer{position:fixed;z-index:5;left:0;right:0;bottom:0;display:flex;justify-content:space-between;align-items:center;padding:12px 26px;border-top:1px solid var(--vscode-panel-border);background:var(--vscode-editorWidget-background);box-shadow:0 -6px 20px rgba(0,0,0,.16)}.status{color:var(--vscode-descriptionForeground)}.status.dirty{color:var(--vscode-editorWarning-foreground)}.toast{position:fixed;right:24px;bottom:72px;display:none;padding:9px 12px;background:var(--vscode-notifications-background);border:1px solid var(--vscode-notifications-border);box-shadow:0 5px 20px rgba(0,0,0,.3)}.toast.show{display:block}@media(max-width:1000px){.head,.row{grid-template-columns:120px 160px minmax(210px,1fr) minmax(220px,1fr) 90px}.page{padding:18px}}
    </style></head><body><main class="page"><div class="hero"><div><h1>API 生成配置</h1><p>集中编辑当前工作区的生成参数。第一阶段继续使用现有 generator-ts-api.* 设置，旧版本无需迁移。</p></div><div class="actions"><button class="btn" id="openSettings">打开原始设置</button></div></div><div class="notice">ⓘ 保存后写入工作区配置（Workspace），现有命令、侧边栏 Profile 和旧版读取逻辑保持不变。</div><div class="filters"><input class="search" id="search" type="text" placeholder="搜索配置名称、说明或配置键…"><div><label><input id="configuredOnly" type="checkbox"> 仅显示已配置</label>&nbsp;&nbsp;<label><input id="showAdvanced" type="checkbox"> 显示高级配置</label></div></div><div class="table"><div class="head"><div>归属</div><div>配置项</div><div>说明</div><div>选项 / 输入</div><div>当前来源</div></div>${sections}</div></main><footer class="footer"><div class="status" id="status">未修改</div><div class="footer-actions"><button class="btn" id="save">保存</button><button class="btn primary" id="saveGenerate">保存并生成</button></div></footer><div class="toast" id="toast"></div><script nonce="${nonce}">
      const vscode=acquireVsCodeApi();const rows=[...document.querySelectorAll('.row')];const search=document.querySelector('#search');const configuredOnly=document.querySelector('#configuredOnly');const showAdvanced=document.querySelector('#showAdvanced');const status=document.querySelector('#status');const dirtyKeys=new Set();function filter(){const q=search.value.trim().toLowerCase();rows.forEach(r=>{const text=r.dataset.search.toLowerCase();const hide=!text.includes(q)||(configuredOnly.checked&&r.dataset.source==='default');r.classList.toggle('filtered',hide);if(r.dataset.advanced==='true')r.classList.toggle('hidden',!showAdvanced.checked)});document.querySelectorAll('.section').forEach(s=>{s.style.display=[...s.querySelectorAll('.row')].some(r=>!r.classList.contains('filtered')&&!r.classList.contains('hidden'))?'':'none'})}function changed(event){const row=event.target.closest('.row');if(row)dirtyKeys.add(row.dataset.key);status.textContent='有 '+dirtyKeys.size+' 项未保存更改';status.classList.add('dirty');if(event.target.dataset.kind==='boolean'){const label=event.target.closest('.toggle').querySelector('span');label.textContent=event.target.checked?'开启':'关闭'}}function values(){const result={};rows.forEach(r=>{if(!dirtyKeys.has(r.dataset.key))return;const el=r.querySelector('[data-input]');if(!el)return;let value;if(el.dataset.kind==='boolean')value=el.checked;else if(el.dataset.kind==='number')value=Number(el.value);else if(el.dataset.kind==='json'){try{value=JSON.parse(el.value||'null')}catch(e){throw new Error(r.dataset.label+' 不是有效 JSON')}}else value=el.value;result[r.dataset.key]=value});return result}function send(type){try{vscode.postMessage({type,values:values()});status.textContent='正在保存…'}catch(e){toast(e.message)}}function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2400)}search.addEventListener('input',filter);configuredOnly.addEventListener('change',filter);showAdvanced.addEventListener('change',filter);document.querySelectorAll('[data-input]').forEach(el=>el.addEventListener('input',changed));document.querySelectorAll('.section-title').forEach(el=>el.addEventListener('click',()=>el.closest('.section').classList.toggle('collapsed')));document.querySelector('#save').addEventListener('click',()=>send('save'));document.querySelector('#saveGenerate').addEventListener('click',()=>send('saveAndGenerate'));document.querySelector('#openSettings').addEventListener('click',()=>vscode.postMessage({type:'openSettings'}));window.addEventListener('message',event=>{if(event.data.type==='saved'){dirtyKeys.clear();status.textContent='已保存';status.classList.remove('dirty');toast('配置已保存')}if(event.data.type==='error'){status.textContent='保存失败';toast(event.data.message)}});window.addEventListener('beforeunload',e=>{if(dirtyKeys.size)e.preventDefault()});filter();
    </script></body></html>`
  }

  private renderRow(field: ConfigFieldState): string {
    const sourceLabels: Record<ConfigFieldState["source"], string> = { workspaceFolder: "工作区文件夹", workspace: "工作区", global: "用户设置", default: "插件默认" }
    return `<div class="row advanced${field.advanced ? " hidden" : ""}" data-key="${escapeAttr(field.key)}" data-label="${escapeAttr(field.label)}" data-source="${field.source}" data-advanced="${field.advanced ? "true" : "false"}" data-search="${escapeAttr(`${field.category} ${field.label} ${field.description} ${field.key}`)}"><div class="cell category">${escapeHtml(field.category)}</div><div class="cell"><div class="name">${escapeHtml(field.label)}</div><div class="key">${escapeHtml(field.key)}</div></div><div class="cell desc">${escapeHtml(field.description)}</div><div class="cell">${this.renderControl(field)}</div><div class="cell"><span class="badge ${field.source === "workspace" ? "workspace" : field.source === "workspaceFolder" ? "folder" : ""}">${sourceLabels[field.source]}</span></div></div>`
  }

  private renderControl(field: ConfigFieldState): string {
    const value = field.value
    if (field.kind === "boolean") return `<label class="toggle"><input data-input data-kind="boolean" type="checkbox"${value ? " checked" : ""}><span>${value ? "开启" : "关闭"}</span></label>`
    if (field.kind === "select") return `<select data-input data-kind="select">${(field.options || []).map((option) => `<option value="${escapeAttr(option.value)}"${option.value === value ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>`
    if (field.kind === "json") return `<textarea data-input data-kind="json">${escapeHtml(JSON.stringify(value, null, 2))}</textarea>`
    if (field.kind === "number") return `<input data-input data-kind="number" type="number" value="${escapeAttr(String(value ?? field.defaultValue))}">`
    return `<input data-input data-kind="text" type="text" value="${escapeAttr(String(value ?? ""))}">`
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[character] || character))
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;")
}
