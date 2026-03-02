/**
 * 功能测试脚本：验证 V2 (Swagger 2.x) 和 V3 (OpenAPI 3.x) 生成器输出
 * 运行方式：node test-generators.js
 */
const fs = require("fs")
const path = require("path")
const os = require("os")

// 确保已编译
const { ApiGenerator: ApiGeneratorV2 } = require("./out/generatorV2")
const { ApiGenerator: ApiGeneratorV3 } = require("./out/generatorV3")

const tmpDir = path.join(os.tmpdir(), "generator-ts-api-test-" + Date.now())
fs.mkdirSync(tmpDir, { recursive: true })

// ─── 测试数据 ──────────────────────────────────────────────────────────────────

const swagger2Doc = {
  swagger: "2.0",
  info: { title: "Test API", version: "1.0" },
  tags: [{ name: "UserApi", description: "用户管理" }],
  paths: {
    "/users": {
      get: {
        tags: ["UserApi"],
        summary: "获取用户列表",
        operationId: "getUsers",
        parameters: [
          { name: "page", in: "query", type: "integer", description: "页码" },
          { name: "size", in: "query", type: "integer", description: "每页数量" },
        ],
        responses: {
          200: {
            schema: {
              originalRef: "PageResult«UserVO»",
              $ref: "#/definitions/PageResult«UserVO»",
            },
          },
        },
      },
      post: {
        tags: ["UserApi"],
        summary: "创建用户",
        operationId: "createUser",
        parameters: [
          {
            name: "body",
            in: "body",
            required: true,
            schema: { $ref: "#/definitions/CreateUserRequest" },
          },
        ],
        responses: { 200: { schema: { $ref: "#/definitions/UserVO" } } },
      },
    },
    "/users/{id}": {
      get: {
        tags: ["UserApi"],
        summary: "根据ID获取用户",
        parameters: [{ name: "id", in: "path", required: true, type: "integer" }],
        responses: { 200: { schema: { $ref: "#/definitions/UserVO" } } },
      },
      delete: {
        tags: ["UserApi"],
        summary: "删除用户",
        parameters: [{ name: "id", in: "path", required: true, type: "integer" }],
        responses: { 200: { schema: { type: "boolean" } } },
      },
    },
  },
  definitions: {
    UserVO: {
      type: "object",
      description: "用户",
      properties: {
        id: { type: "integer", description: "ID" },
        name: { type: "string", description: "姓名" },
        email: { type: "string", description: "邮箱" },
      },
    },
    CreateUserRequest: {
      type: "object",
      required: ["name", "email"],
      properties: {
        name: { type: "string", description: "姓名" },
        email: { type: "string", description: "邮箱" },
      },
    },
    "PageResult«UserVO»": {
      type: "object",
      properties: {
        total: { type: "integer" },
        records: { type: "array", items: { $ref: "#/definitions/UserVO" } },
        data: { $ref: "#/definitions/UserVO" },
      },
    },
  },
}

const openapi3Doc = {
  openapi: "3.0.0",
  info: { title: "Test API v3", version: "1.0" },
  tags: [{ name: "OrderApi", description: "订单管理" }],
  paths: {
    "/orders": {
      get: {
        tags: ["OrderApi"],
        summary: "获取订单列表",
        operationId: "listOrders",
        parameters: [
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer" } },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Order" },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["OrderApi"],
        summary: "创建订单",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateOrderRequest" },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Order" },
              },
            },
          },
        },
      },
    },
    "/orders/{orderId}": {
      get: {
        tags: ["OrderApi"],
        summary: "获取订单详情",
        parameters: [
          { name: "orderId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Order" },
              },
            },
          },
        },
      },
    },
    "/orders/{orderId}/upload": {
      post: {
        tags: ["OrderApi"],
        summary: "上传订单附件",
        parameters: [
          { name: "orderId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: { file: { type: "string", format: "binary" } },
              },
            },
          },
        },
        responses: { 200: { content: { "application/json": { schema: { type: "boolean" } } } } },
      },
    },
  },
  components: {
    schemas: {
      Order: {
        type: "object",
        description: "订单",
        required: ["id", "amount"],
        properties: {
          id: { type: "string", description: "订单ID" },
          amount: { type: "number", description: "金额" },
          status: { type: "string", enum: ["pending", "paid", "cancelled"], description: "状态" },
          items: { type: "array", items: { $ref: "#/components/schemas/OrderItem" }, description: "商品列表" },
        },
      },
      OrderItem: {
        type: "object",
        properties: {
          productId: { type: "string" },
          quantity: { type: "integer" },
          price: { type: "number" },
        },
      },
      CreateOrderRequest: {
        type: "object",
        required: ["items"],
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/OrderItem" } },
          remark: { type: "string" },
        },
      },
    },
  },
}

// ─── 测试工具 ──────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✔ ${label}`)
    passed++
  } else {
    console.error(`  ✘ ${label}${detail ? ": " + detail : ""}`)
    failed++
  }
}

function checkIncludes(content, substr, label) {
  check(label, content.includes(substr), `未找到: "${substr}"`)
}

// ─── 测试 V2 生成器（单文件，axios-wrapper 模式）─────────────────────────────

async function testV2SingleFile() {
  console.log("\n[V2 - Swagger 2.x - 单文件 - axios-wrapper]")
  const gen = new ApiGeneratorV2()
  const outFile = path.join(tmpDir, "v2-single.ts")
  await gen.generate(swagger2Doc, "vue", "ts", outFile, "single", undefined, {
    mode: "axios-wrapper",
    requestImportPath: "@/utils/request",
    generateRequestScaffold: false,
  })
  check("文件生成成功", fs.existsSync(outFile))
  const content = fs.readFileSync(outFile, "utf-8")
  checkIncludes(content, "export interface UserVO", "生成 UserVO 接口类型")
  checkIncludes(content, "export interface CreateUserRequest", "生成 CreateUserRequest 接口类型")
  checkIncludes(content, "export interface PageResult", "生成 PageResult 泛型接口")
  checkIncludes(content, "export class UserApi", "生成 UserApi 类")
  checkIncludes(content, "Users(", "生成 Users 方法（get /users）")
  checkIncludes(content, "createUser(", "生成 createUser 方法（post /users，operationId备选）")
  checkIncludes(content, "${params.id}", "路径参数替换正确")
  checkIncludes(content, "from \"@/utils/request\"", "正确导入 request 依赖")
  checkIncludes(content, "getConfigs(", "使用 getConfigs 风格")
  return content
}

// ─── 测试 V2 生成器（byTag，axios 模式）──────────────────────────────────────

async function testV2ByTag() {
  console.log("\n[V2 - Swagger 2.x - byTag - axios]")
  const gen = new ApiGeneratorV2()
  const outDir = path.join(tmpDir, "v2-byTag")
  const naming = { typesDirName: "types", controllersDirName: "modules", controllerFileNameCasing: "default", controllerClassNameSuffix: "" }
  await gen.generate(swagger2Doc, "vue", "ts", outDir, "byTag", naming, {
    mode: "axios",
    requestImportPath: "axios",
    generateRequestScaffold: false,
  })
  check("types/index.ts 生成", fs.existsSync(path.join(outDir, "types/index.ts")))
  check("modules/UserApi.ts 生成", fs.existsSync(path.join(outDir, "modules/UserApi.ts")))
  check("modules/index.ts 生成", fs.existsSync(path.join(outDir, "modules/index.ts")))
  check("根 index.ts 生成", fs.existsSync(path.join(outDir, "index.ts")))
  const typesContent = fs.readFileSync(path.join(outDir, "types/index.ts"), "utf-8")
  checkIncludes(typesContent, "export interface UserVO", "types 中包含 UserVO")
  const ctrlContent = fs.readFileSync(path.join(outDir, "modules/UserApi.ts"), "utf-8")
  checkIncludes(ctrlContent, "static async getUsers(", "axios 模式使用 async/await")
  checkIncludes(ctrlContent, "import axios from 'axios'", "axios 模式导入 axios")
  const rootIndex = fs.readFileSync(path.join(outDir, "index.ts"), "utf-8")
  checkIncludes(rootIndex, "export * from \"./types\"", "根 index 导出 types")
  checkIncludes(rootIndex, "export * from \"./modules\"", "根 index 导出 modules")
}

// ─── 测试 V3 生成器（单文件，fetch 模式）─────────────────────────────────────

async function testV3SingleFile() {
  console.log("\n[V3 - OpenAPI 3.x - 单文件 - fetch]")
  const gen = new ApiGeneratorV3()
  const outFile = path.join(tmpDir, "v3-single.ts")
  await gen.generate(openapi3Doc, "react", "ts", outFile, "single", undefined, {
    mode: "fetch",
    requestImportPath: "",
    generateRequestScaffold: false,
  })
  check("文件生成成功", fs.existsSync(outFile))
  const content = fs.readFileSync(outFile, "utf-8")
  checkIncludes(content, "export interface Order", "生成 Order 接口类型")
  checkIncludes(content, "export interface OrderItem", "生成 OrderItem 接口类型")
  checkIncludes(content, "export class OrderApi", "生成 OrderApi 类")
  checkIncludes(content, "Orders(", "生成 Orders 方法（get /orders）")
  checkIncludes(content, "postOrders(", "生成 postOrders 方法（post /orders）")
  checkIncludes(content, "${params.orderId}", "路径参数替换正确")
  checkIncludes(content, "static async Orders(", "fetch 模式使用 async/await")
  checkIncludes(content, "fetch(", "fetch 模式使用 fetch 调用")
  return content
}

// ─── 测试 V3 生成器（byTag，axios-wrapper）───────────────────────────────────

async function testV3ByTag() {
  console.log("\n[V3 - OpenAPI 3.x - byTag - axios-wrapper]")
  const gen = new ApiGeneratorV3()
  const outDir = path.join(tmpDir, "v3-byTag")
  const naming = { typesDirName: "types", controllersDirName: "modules", controllerFileNameCasing: "PascalCase", controllerClassNameSuffix: "Service" }
  await gen.generate(openapi3Doc, "vue", "ts", outDir, "byTag", naming, {
    mode: "axios-wrapper",
    requestImportPath: "@/utils/request",
    generateRequestScaffold: false,
  })
  check("types/index.ts 生成", fs.existsSync(path.join(outDir, "types/index.ts")))
  check("modules/ 目录生成", fs.existsSync(path.join(outDir, "modules")))
  check("根 index.ts 生成", fs.existsSync(path.join(outDir, "index.ts")))
  const files = fs.readdirSync(path.join(outDir, "modules"))
  check("modules 下有控制器文件", files.some(f => f.endsWith(".ts") && f !== "index.ts"))
  const ctrlFile = files.find(f => f !== "index.ts" && f.endsWith(".ts"))
  if (ctrlFile) {
    const ctrlContent = fs.readFileSync(path.join(outDir, "modules", ctrlFile), "utf-8")
    checkIncludes(ctrlContent, "export class", "控制器类已导出")
    checkIncludes(ctrlContent, "Service", "类名后缀 Service 应用成功")
    checkIncludes(ctrlContent, "from \"@/utils/request\"", "axios-wrapper import 路径正确")
  }
  const typesContent = fs.readFileSync(path.join(outDir, "types/index.ts"), "utf-8")
  checkIncludes(typesContent, "export interface Order", "types 包含 Order 类型")
  checkIncludes(typesContent, "'pending' | 'paid' | 'cancelled'", "enum 类型正确生成")
}

// ─── 测试 V3 - tags 字段为空的文档（兼容性修复验证）────────────────────────────

async function testV3NoTags() {
  console.log("\n[V3 - OpenAPI 3.x - 无 tags 字段 - 兼容性修复验证]")
  const docNoTags = {
    openapi: "3.0.0",
    info: { title: "No Tags API", version: "1.0" },
    // 故意不提供 tags 字段
    paths: {
      "/ping": {
        get: {
          tags: ["PingApi"],
          summary: "健康检查",
          responses: { 200: { content: { "application/json": { schema: { type: "string" } } } } },
        },
      },
    },
    components: { schemas: {} },
  }
  const gen = new ApiGeneratorV3()
  const outFile = path.join(tmpDir, "v3-notags.ts")
  let error = null
  try {
    await gen.generate(docNoTags, "vue", "ts", outFile, "single", undefined, {
      mode: "fetch",
      requestImportPath: "",
      generateRequestScaffold: false,
    })
  } catch (e) {
    error = e
  }
  check("无 tags 字段不报错", error === null, error ? error.message : "")
  if (!error) {
    check("文件成功生成", fs.existsSync(outFile))
  }
}

// ─── 测试 generateRequestScaffold 功能 ──────────────────────────────────────

async function testScaffold() {
  console.log("\n[V3 - generateRequestScaffold - axios-wrapper]")
  const gen = new ApiGeneratorV3()
  const outDir = path.join(tmpDir, "v3-scaffold")
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, "api.ts")
  await gen.generate(openapi3Doc, "vue", "ts", outFile, "single", undefined, {
    mode: "axios-wrapper",
    requestImportPath: "@/utils/request",
    generateRequestScaffold: true,
  })
  const { generateRequestScaffoldFile } = require("./out/generatorCommon")
  generateRequestScaffoldFile(outDir, { mode: "axios-wrapper", requestImportPath: "@/utils/request", generateRequestScaffold: true }, "ts")
  check("request.ts 样板文件生成", fs.existsSync(path.join(outDir, "request.ts")))
  const scaffoldContent = fs.readFileSync(path.join(outDir, "request.ts"), "utf-8")
  checkIncludes(scaffoldContent, "export function getConfigs(", "样板文件包含 getConfigs 函数")
  checkIncludes(scaffoldContent, "export default request", "样板文件导出 request")
}

// ─── 测试 TypeMapping（latest + 覆盖 + 0.0.x 兼容）──────────────────────────

async function testTypeMappings() {
  console.log("\n[TypeMapping - latest / override / 0.0.x]")

  const v3MapDoc = {
    openapi: "3.0.0",
    info: { title: "TypeMap API", version: "1.0" },
    tags: [{ name: "TypeMapApi", description: "类型映射" }],
    paths: {
      "/type-map": {
        get: {
          tags: ["TypeMapApi"],
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TypeMappingModel" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        TypeMappingModel: {
          type: "object",
          properties: {
            id64: { type: "integer", format: "int64" },
            createdAt: { type: "string", format: "date-time" },
            file: { type: "string", format: "binary" },
          },
        },
      },
    },
  }

  const v2MapDoc = {
    swagger: "2.0",
    info: { title: "TypeMap API", version: "1.0" },
    tags: [{ name: "TypeMapApi", description: "类型映射" }],
    paths: {
      "/type-map": {
        get: {
          tags: ["TypeMapApi"],
          responses: {
            200: {
              schema: { $ref: "#/definitions/TypeMappingModel" },
            },
          },
        },
      },
    },
    definitions: {
      TypeMappingModel: {
        type: "object",
        properties: {
          id64: { type: "integer", format: "int64" },
          createdAt: { type: "string", format: "date-time" },
          file: { type: "string", format: "binary" },
        },
      },
    },
  }

  const v3 = new ApiGeneratorV3()
  const v2 = new ApiGeneratorV2()

  const v3LatestFile = path.join(tmpDir, "v3-typemap-latest.ts")
  await v3.generate(v3MapDoc, "vue", "ts", v3LatestFile, "single", undefined, {
    mode: "fetch",
    requestImportPath: "",
    generateRequestScaffold: false,
    compatibilityVersion: "latest",
  })
  const v3Latest = fs.readFileSync(v3LatestFile, "utf-8")
  checkIncludes(v3Latest, "id64?: string;", "V3 latest: int64 -> string")
  checkIncludes(v3Latest, "createdAt?: string;", "V3 latest: date-time -> string")
  checkIncludes(v3Latest, "file?: Blob;", "V3 latest: binary -> Blob")

  const v3OverrideFile = path.join(tmpDir, "v3-typemap-override.ts")
  await v3.generate(v3MapDoc, "vue", "ts", v3OverrideFile, "single", undefined, {
    mode: "fetch",
    requestImportPath: "",
    generateRequestScaffold: false,
    compatibilityVersion: "latest",
    formatTypeMappings: {
      int64: "bigint",
      "date-time": "Date",
      binary: "ArrayBuffer",
    },
  })
  const v3Override = fs.readFileSync(v3OverrideFile, "utf-8")
  checkIncludes(v3Override, "id64?: bigint;", "V3 override: int64 -> bigint")
  checkIncludes(v3Override, "createdAt?: Date;", "V3 override: date-time -> Date")
  checkIncludes(v3Override, "file?: ArrayBuffer;", "V3 override: binary -> ArrayBuffer")

  const v3LegacyFile = path.join(tmpDir, "v3-typemap-legacy.ts")
  await v3.generate(v3MapDoc, "vue", "ts", v3LegacyFile, "single", undefined, {
    mode: "fetch",
    requestImportPath: "",
    generateRequestScaffold: false,
    compatibilityVersion: "0.0.x",
  })
  const v3Legacy = fs.readFileSync(v3LegacyFile, "utf-8")
  checkIncludes(v3Legacy, "id64?: number;", "V3 0.0.x: int64 -> number")
  checkIncludes(v3Legacy, "createdAt?: string;", "V3 0.0.x: date-time -> string")
  checkIncludes(v3Legacy, "file?: string;", "V3 0.0.x: binary -> string")

  const v2LatestFile = path.join(tmpDir, "v2-typemap-latest.ts")
  await v2.generate(v2MapDoc, "vue", "ts", v2LatestFile, "single", undefined, {
    mode: "axios-wrapper",
    requestImportPath: "@/utils/request",
    generateRequestScaffold: false,
    compatibilityVersion: "latest",
  })
  const v2Latest = fs.readFileSync(v2LatestFile, "utf-8")
  checkIncludes(v2Latest, "id64?: string;", "V2 latest: int64 -> string")
  checkIncludes(v2Latest, "createdAt?: string;", "V2 latest: date-time -> string")
  checkIncludes(v2Latest, "file?: Blob;", "V2 latest: binary -> Blob")

  const v2LegacyFile = path.join(tmpDir, "v2-typemap-legacy.ts")
  await v2.generate(v2MapDoc, "vue", "ts", v2LegacyFile, "single", undefined, {
    mode: "axios-wrapper",
    requestImportPath: "@/utils/request",
    generateRequestScaffold: false,
    compatibilityVersion: "0.0.x",
  })
  const v2Legacy = fs.readFileSync(v2LegacyFile, "utf-8")
  checkIncludes(v2Legacy, "id64?: number;", "V2 0.0.x: int64 -> number")
  checkIncludes(v2Legacy, "createdAt?: string;", "V2 0.0.x: date-time -> string")
  checkIncludes(v2Legacy, "file?: string;", "V2 0.0.x: binary -> string")
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"=".repeat(60)}`)
  console.log("generator-ts-api 功能测试")
  console.log(`临时输出目录: ${tmpDir}`)
  console.log("=".repeat(60))

  try {
    await testV2SingleFile()
    await testV2ByTag()
    await testV3SingleFile()
    await testV3ByTag()
    await testV3NoTags()
    await testScaffold()
    await testTypeMappings()
  } catch (e) {
    console.error("\n[FATAL] 测试运行异常:", e)
    failed++
  }

  console.log(`\n${"=".repeat(60)}`)
  console.log(`测试结果: ${passed} 通过，${failed} 失败`)
  console.log("=".repeat(60))

  // 清理临时目录
  fs.rmSync(tmpDir, { recursive: true, force: true })

  if (failed > 0) process.exit(1)
}

main()
