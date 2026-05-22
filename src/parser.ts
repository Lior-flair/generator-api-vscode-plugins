import axios from 'axios';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

/** 用户取消输入时抛出，用于中止整个解析流程（不再尝试其它候选地址） */
class UserCancelledError extends Error {}

export class ApiParser {
  /** 当只填写基础地址时，自动尝试拼接的常见 API 文档路径（按优先级排序） */
  private static readonly API_DOC_PATH_CANDIDATES = [
    '/v3/api-docs',
    '/v2/api-docs',
    '/openapi.json',
    '/swagger.json',
    '/api-docs',
    '/swagger/v1/swagger.json',
  ];

  async parseFromUrl(url: string): Promise<any> {
    const candidates = this.buildUrlCandidates(url);
    let authHeader: string | undefined;
    let lastErrorMessage = '未知错误';

    for (const candidate of candidates) {
      try {
        const doc = await this.fetchAndParse(candidate, authHeader);
        if (this.looksLikeApiDoc(doc)) {
          return doc;
        }
        lastErrorMessage = `${candidate} 返回的内容不是有效的 OpenAPI/Swagger 文档`;
      } catch (error: unknown) {
        if (error instanceof UserCancelledError) {
          throw new Error(`从URL解析API文档失败: ${error.message}`);
        }
        const axiosError: any = error;
        const status = axiosError?.response?.status;
        const respData = axiosError?.response?.data;

        // 首次遇到 401 时交互获取凭证，并用该候选地址重试一次
        if (status === 401 && !authHeader) {
          authHeader = await this.promptBasicAuth();
          try {
            const doc = await this.fetchAndParse(candidate, authHeader);
            if (this.looksLikeApiDoc(doc)) {
              return doc;
            }
            lastErrorMessage = `${candidate} 返回的内容不是有效的 OpenAPI/Swagger 文档`;
            continue;
          } catch (retryError: unknown) {
            const retryAxios: any = retryError;
            const retryStatus = retryAxios?.response?.status;
            const retryData = retryAxios?.response?.data;
            const retryMessage = retryError instanceof Error ? retryError.message : '未知错误';
            lastErrorMessage = retryStatus
              ? `HTTP ${retryStatus} - ${JSON.stringify(retryData ?? retryMessage)}`
              : retryMessage;
            continue;
          }
        }

        if (status) {
          const shortData = typeof respData === 'string' ? respData : JSON.stringify(respData ?? {});
          lastErrorMessage = `HTTP ${status} - ${shortData}`;
        } else {
          lastErrorMessage = error instanceof Error ? error.message : '未知错误';
        }
      }
    }

    const triedNote = candidates.length > 1 ? `（已尝试 ${candidates.length} 个候选地址）` : '';
    throw new Error(`从URL解析API文档失败${triedNote}: ${lastErrorMessage}`);
  }

  /**
   * 根据用户填写的 URL 构建候选地址列表：
   *  - 始终先尝试原始 URL；
   *  - 若 URL 看起来只是基础地址（未包含 api-docs / swagger / openapi 端点），
   *    则在其后依次拼接常见的 API 文档路径。
   */
  private buildUrlCandidates(url: string): string[] {
    const trimmed = url.trim();
    const candidates = [trimmed];
    const base = trimmed.replace(/\/+$/, '');
    const looksLikeEndpoint = /(api-docs|swagger[^/]*\.(json|ya?ml)|openapi[^/]*\.(json|ya?ml))/i.test(base);
    if (!looksLikeEndpoint) {
      for (const suffix of ApiParser.API_DOC_PATH_CANDIDATES) {
        candidates.push(base + suffix);
      }
    }
    return Array.from(new Set(candidates));
  }

  /** 发起一次请求并解析为对象 */
  private async fetchAndParse(url: string, authHeader?: string): Promise<any> {
    const config = authHeader ? { headers: { Authorization: authHeader } } : undefined;
    const response = await axios.get(url, config);
    return this.parseContent(JSON.stringify(response.data));
  }

  /** 判断解析结果是否为有效的 OpenAPI 3.x / Swagger 2.x 文档 */
  private looksLikeApiDoc(doc: any): boolean {
    if (!doc || typeof doc !== 'object') {
      return false;
    }
    const isOpenApi3 = typeof doc.openapi === 'string' && doc.openapi.startsWith('3.');
    const isSwagger2 = typeof doc.swagger === 'string' && doc.swagger.startsWith('2.');
    return (isOpenApi3 || isSwagger2) && !!doc.paths;
  }

  /** 交互式获取 Basic Auth 凭证；用户取消时抛出 UserCancelledError */
  private async promptBasicAuth(): Promise<string> {
    const username = await vscode.window.showInputBox({
      prompt: '请输入需要访问该URL的用户名 (取消则中止)',
      ignoreFocusOut: true,
    });
    if (typeof username === 'undefined') {
      throw new UserCancelledError('用户取消了用户名输入');
    }
    const password = await vscode.window.showInputBox({
      prompt: '请输入密码 (输入后回车，取消则中止)',
      password: true,
      ignoreFocusOut: true,
    });
    if (typeof password === 'undefined') {
      throw new UserCancelledError('用户取消了密码输入');
    }
    return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
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