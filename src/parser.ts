import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { OpenAPIV3 } from 'openapi-types';

export class ApiParser {
  async parseFromUrl(url: string): Promise<any> {
    try {
      const response = await axios.get(url);
      console.log('%c [ response ]-11', 'font-size:15px; background:#877b10; color:#cbbf54;', response)
      const content = response.data;
      console.log('%c [ content ]-13', 'font-size:15px; background:#668661; color:#aacaa5;', content)
      return this.parseContent(JSON.stringify(content));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      throw new Error(`从URL解析API文档失败: ${errorMessage}`);
    }
  }

  async parseFromFile(filePath: string): Promise<any> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.parseContent(content);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      throw new Error(`从文件解析API文档失败: ${errorMessage}`);
    }
  }

  private async parseContent(content: string): Promise<any> {
    try {
      // 尝试解析为JSON
      try {
        return JSON.parse(content);
      } catch (e) {
        // 如果不是JSON，尝试解析为YAML
        try {
          return yaml.parse(content);
        } catch (e) {
          throw new Error('API文档格式无效，必须是有效的JSON或YAML');
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      throw new Error(`解析API文档内容失败: ${errorMessage}`);
    }
  }

  async validateApiDocs(apiDocs: any): Promise<boolean> {
    try {
      // 基本验证
      if (!apiDocs || typeof apiDocs !== 'object') {
        throw new Error('API文档必须是有效的对象');
      }

      // 验证OpenAPI版本
      const isOpenApi3 = apiDocs.openapi && apiDocs.openapi.startsWith('3.');
      const isSwagger2 = apiDocs.swagger && apiDocs.swagger.startsWith('2.');
      
      if (!isOpenApi3 && !isSwagger2) {
        throw new Error('仅支持OpenAPI 3.x或Swagger 2.x版本');
      }

      // 验证必要字段
      if (!apiDocs.info || !apiDocs.paths) {
        throw new Error('API文档缺少必要字段(info或paths)');
      }

      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      throw new Error(`API文档验证失败: ${errorMessage}`);
    }
  }
} 