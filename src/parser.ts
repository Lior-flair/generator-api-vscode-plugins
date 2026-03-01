import axios from 'axios';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

export class ApiParser {
  async parseFromUrl(url: string): Promise<any> {
    try {
      const response = await axios.get(url);
      const content = response.data;
      return this.parseContent(JSON.stringify(content));
    } catch (error: unknown) {
      // 如果是401 (需要凭证)，则尝试交互获取用户名/密码并重试一次
      const axiosError: any = error;
      const status = axiosError?.response?.status;
      const respData = axiosError?.response?.data;
      if (status === 401) {
        try {
          const username = await vscode.window.showInputBox({
            prompt: '请输入需要访问该URL的用户名 (取消则中止)',
            ignoreFocusOut: true,
          });
          if (typeof username === 'undefined') {
            throw new Error('用户取消了用户名输入');
          }

          const password = await vscode.window.showInputBox({
            prompt: '请输入密码 (输入后回车，取消则中止)',
            password: true,
            ignoreFocusOut: true,
          });
          if (typeof password === 'undefined') {
            throw new Error('用户取消了密码输入');
          }

          // 使用 Basic Auth 重试一次请求
          const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
          const retryResponse = await axios.get(url, { headers: { Authorization: authHeader } });
          const content = retryResponse.data;
          return this.parseContent(JSON.stringify(content));
        } catch (retryError: unknown) {
          const retryAxios: any = retryError;
          const retryStatus = retryAxios?.response?.status;
          const retryData = retryAxios?.response?.data;
          const retryMessage = retryError instanceof Error ? retryError.message : '未知错误';
          if (retryStatus) {
            throw new Error(`从URL解析API文档失败: HTTP ${retryStatus} - ${JSON.stringify(retryData ?? retryMessage)}`);
          }
          throw new Error(`从URL解析API文档失败: ${retryMessage}`);
        }
      }

      // 非401的情况，尽量把 HTTP 状态码和返回体包含在错误消息里，方便用户定位问题
      if (status) {
        const shortData = typeof respData === 'string' ? respData : JSON.stringify(respData ?? {})
        throw new Error(`从URL解析API文档失败: HTTP ${status} - ${shortData}`);
      }

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