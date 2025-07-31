import * as fs from 'fs';
import * as path from 'path';
import { OpenAPIV3 } from 'openapi-types';

export class ApiGenerator {
  async generate(apiDocs: any, framework: string, outputType: string, outputPath: string): Promise<void> {
    try {
      // 验证API文档
      if (!this.isValidApiDoc(apiDocs)) {
        throw new Error('无效的API文档');
      }

      // 生成代码
      const code = this.generateCode(apiDocs, framework, outputType);
      
      // 确保输出目录存在
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // 写入文件
      fs.writeFileSync(outputPath, code, 'utf-8');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      throw new Error(`生成API代码失败: ${errorMessage}`);
    }
  }

  private isValidApiDoc(doc: any): boolean {
    const isOpenApi3 = doc.openapi && doc.openapi.startsWith('3.');
    const isSwagger2 = doc.swagger && doc.swagger.startsWith('2.');
    return (isOpenApi3 || isSwagger2) && doc.info && doc.paths;
  }

  private generateCode(apiDocs: any, framework: string, outputType: string): string {
    const types: string[] = [];
    const controllers: Map<string, string[]> = new Map();

    // 生成类型定义
    if (this.isOpenApi3(apiDocs)) {
      // OpenAPI 3.x 类型定义
      if (apiDocs.components && apiDocs.components.schemas) {
        for (const [name, schema] of Object.entries(apiDocs.components.schemas)) {
          if (this.isSchemaObject(schema) && schema.type === 'object') {
            const typeDef = this.generateTypeDefinition(this.sanitizeName(name), schema);
            types.push(typeDef);
          }
        }
      }
    } else {
      // Swagger 2.x 类型定义
      if (apiDocs.definitions) {
        for (const [name, schema] of Object.entries(apiDocs.definitions)) {
          if (this.isSchemaObject(schema) && schema.type === 'object') {
            const typeDef = this.generateTypeDefinition(this.sanitizeName(name), schema);
            types.push(typeDef);
          }
        }
      }
    }

    // 生成服务方法并按tag分组
    for (const [path, pathItem] of Object.entries(apiDocs.paths)) {
      if (pathItem) {
        for (const [method, operation] of Object.entries(pathItem)) {
          if (operation && typeof operation === 'object') {
            const serviceMethod = this.generateServiceMethod(path, method, operation);
            const tag = operation.tags?.[0] || 'Default';
            const controllerName = this.sanitizeName(tag);
            
            if (!controllers.has(controllerName)) {
              controllers.set(controllerName, []);
            }
            controllers.get(controllerName)?.push(serviceMethod);
          }
        }
      }
    }

    // 生成controller类
    const controllerClasses: string[] = [];
    for (const [controllerName, methods] of controllers) {
      const controllerClass = `
export class ${controllerName} {
${methods.join('\n\n')}
}`;
      controllerClasses.push(controllerClass);
    }

    // 组合最终代码
    const code = `
import requestClass, { getConfigs, type RequestConfig } from "@/utils/request"
const { fetch:request} = requestClass
// 生成时间: ${new Date().toISOString()}

// 类型定义
${types.join('\n\n')}

// Controller类
${controllerClasses.join('\n\n')}
`;

    return code;
  }

  private isOpenApi3(doc: any): boolean {
    return doc.openapi && doc.openapi.startsWith('3.');
  }

  private isSchemaObject(schema: any): schema is OpenAPIV3.SchemaObject {
    return !('$ref' in schema);
  }

  private sanitizeName(name: string): string {
    // 替换特殊字符为下划线，保留中文
    return name.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_]/g, '_');
  }

  private generateTypeDefinition(name: string, schema: any): string {
    const properties = schema.properties || {};
    const required = schema.required || [];

    const propertyDefs = Object.entries(properties).map(([propName, propSchema]) => {
      const sanitizedPropName = this.sanitizeName(propName);
      const isRequired = required.includes(propName);
      if (this.isSchemaObject(propSchema)) {
        const type = this.getTypeScriptType(propSchema);
        return `  /** ${propSchema.description || propSchema.title || ''} */\n  ${sanitizedPropName}${isRequired ? '' : '?'}: ${type};`;
      }
      return `  ${sanitizedPropName}${isRequired ? '' : '?'}: any;`;
    });

    return `export interface ${name} {\n${propertyDefs.join('\n')}\n}`;
  }

  private generateServiceMethod(path: string, method: string, operation: any): string {
    const paramsType = this.getParamsType(operation);
    const returnType = this.getReturnType(operation);
    const methodName = this.sanitizeName(operation.operationId || this.getOperationId(path, method));

    // 处理路径中的行内参数
    let processedPath = path;
    if (operation.parameters) {
      const pathParams = operation.parameters
        .filter((param: any) => param.in === 'path')
        .map((param: any) => param.name);
      
      pathParams.forEach((paramName: string) => {
        const paramPattern = `{${paramName}}`;
        if (processedPath.includes(paramPattern)) {
          processedPath = processedPath.replace(paramPattern, `\${params.${paramName}}`);
        }
      });
    }

    // 处理参数
    const hasParameters = operation.parameters && operation.parameters.length > 0;
    const isGetMethod = method.toLowerCase() === 'get';
    const shouldSetParams = isGetMethod || hasParameters;
    let params = shouldSetParams ? 'configs.params = params;' : '';

    // 处理请求体
    let requestBody = '';
    if (operation.parameters) {
      const bodyParam = operation.parameters.find((p: any) => p.in === 'body');
      if (bodyParam) {
        requestBody = 'configs.data = params["body"]';
        if(params){
          params = `
          const {body,...new_params} = params;
          configs.params = new_params;
          `
        }
      }
    }

    // 处理请求类型
    const requestContentType = this.getRequestContentType(operation);

    // 处理安全定义
    const securityConfig = this.getSecurityConfig(operation);

    return `  /**
   * ${operation.summary || ''}${operation.description?'\n  * '+operation.description:''}${operation.deprecated ? '\n  * @deprecated true' : ''}${operation.callbacks ? '\n * @returns ' : ''}
   */
  static ${methodName}(${paramsType}): Promise<${returnType}> {
    return new Promise((resolve, reject) => {
      const url = \`${processedPath}\`;
      const configs = getConfigs(
        '${method}',
        '${requestContentType}',
        url,
        options
      );
      ${params}
      ${requestBody}
      ${securityConfig}
      request(configs, resolve, reject);
    });
  }`;
  }

  private getSecurityConfig(operation: any): string {
    if (!operation.security) return '';
    
    const securityConfigs: string[] = [];
    operation.security.forEach((sec: any) => {
      Object.entries(sec).forEach(([name, scopes]: [string, any]) => {
        if (Array.isArray(scopes)) {
          securityConfigs.push(`configs.headers['Authorization'] = 'Bearer ${name}';`);
        } else {
          securityConfigs.push(`configs.headers['${name}'] = '${scopes}';`);
        }
      });
    });
    
    return securityConfigs.join('\n      ');
  }

  private getResponseContentType(operation: any): string {
    // 优先检查 operation.produces
    if (operation.produces && operation.produces.length > 0) {
      return operation.produces[0];
    }
    
    // 检查响应定义
    if (operation.responses) {
      const successResponse = operation.responses['200'];
      if (successResponse) {
        // 检查响应类型
        if (successResponse.schema) {
          return 'application/json';
        }
        // 检查示例
        if (successResponse.examples) {
          const exampleType = Object.keys(successResponse.examples)[0];
          if (exampleType) {
            return exampleType;
          }
        }
      }
    }
    
    return 'application/json';
  }

  private getParamsType(operation: any): string {
    const params: string[] = [];
    
    if (operation.parameters) {
      operation.parameters.forEach((param: any) => {
        if (this.isParameterObject(param)) {
          const paramName = param.name;
          const isRequired = param.required === true;
          const type = this.getTypeScriptType(param);
          
          // 处理 collectionFormat
          if (param.collectionFormat) {
            switch (param.collectionFormat) {
              case 'csv':
              case 'ssv':
              case 'tsv':
              case 'pipes':
                params.push(`"${paramName}"${isRequired ? '' : '?'}: string[]`);
                break;
              case 'multi':
                params.push(`"${paramName}"${isRequired ? '' : '?'}: string[]`);
                break;
              default:
                params.push(`"${paramName}"${isRequired ? '' : '?'}: ${type}`);
            }
          } else {
            params.push(`"${paramName}"${isRequired ? '' : '?'}: ${type}`);
          }
        }
      });
    }

    return `params: {${params.join(', ')}} = {} as any, options: RequestConfig = {} `;
  }

  private getReturnType(operation: any): string {
    if (operation.responses) {
      const successResponse = operation.responses['200'];
      if (successResponse) {
        if (successResponse.schema) {
          const type = this.getTypeScriptType(successResponse.schema);
          return this.processGenericType(type);
        }
        if (successResponse.examples) {
          const exampleType = Object.keys(successResponse.examples)[0];
          if (exampleType) {
            return 'any';
          }
        }
      }
    }
    return 'any';
  }

  private processGenericType(type: string): string {
    // 使用正则表达式匹配《、》之间的内容
    const matches = type.match(/《([^》]+)》/g);
    if (!matches) return type;

    // 提取所有类型
    const types = matches.map(match => match.slice(1, -1));
    
    // 统计类型出现次数
    const typeCount = new Map<string, number>();
    types.forEach(t => {
      typeCount.set(t, (typeCount.get(t) || 0) + 1);
    });

    // 处理重复类型
    let processedType = type;
    typeCount.forEach((count, t) => {
      if (count > 1) {
        // 如果类型是 any 或 object，使用泛型
        if (t === 'any' || t === 'object') {
          processedType = processedType.replace(new RegExp(`《${t}》`, 'g'), 'T');
        } else {
          processedType = processedType.replace(new RegExp(`《${t}》`, 'g'), `T${t}`);
        }
      }
    });

    // 添加泛型声明
    const genericParams = Array.from(typeCount.entries())
      .filter(([_, count]) => count > 1)
      .map(([t]) => t === 'any' || t === 'object' ? 'T' : `T${t}`)
      .join(', ');

    if (genericParams) {
      processedType = `<${genericParams}>${processedType}`;
    }

    return processedType;
  }

  private getTypeScriptType(schema: any): string {
    if (!schema) return 'any';
    
    if (schema.type === 'array') {
      return `${this.getTypeScriptType(schema.items)}[]`;
    }
    if (schema.type === 'object') {
      if (schema.properties) {
        const properties = Object.entries(schema.properties).map(([name, prop]: [string, any]) => {
          const isRequired = schema.required?.includes(name) || false;
          return `"${name}"${isRequired ? '' : '?'}: ${this.getTypeScriptType(prop)}`;
        });
        return `{${properties.join(', ')}}`;
      }
      return 'any';
    }
    if (schema.type === 'string') {
      if (schema.enum) {
        return schema.enum.map((v: string) => `'${v}'`).join(' | ');
      }
      return 'string';
    }
    if (schema.type === 'number' || schema.type === 'integer') {
      return 'number';
    }
    if (schema.type === 'boolean') {
      return 'boolean';
    }
    if (schema.type === 'file') {
      return 'File';
    }
    return 'any';
  }

  private isParameterObject(param: any): boolean {
    return !('$ref' in param);
  }

  private getOperationId(path: string, method: string): string {
    const pathParts = path.split('/').filter(Boolean);
    const lastPart = pathParts[pathParts.length - 1];
    return `${method.toLowerCase()}${lastPart.charAt(0).toUpperCase() + lastPart.slice(1)}`;
  }

  private getRequestContentType(operation: any): string {
    // 优先检查 operation.consumes
    if (operation.consumes && operation.consumes.length > 0) {
      return operation.consumes[0];
    }
    
    // 检查参数中的 body 参数
    if (operation.parameters) {
      const bodyParam = operation.parameters.find((p: any) => p.in === 'body');
      if (bodyParam) {
        return 'application/json';
      }
    }
    
    return 'application/json';
  }
} 