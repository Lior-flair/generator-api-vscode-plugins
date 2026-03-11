import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { buildImportSnippet, buildUniqueMethodName, DEFAULT_NAMING, DEFAULT_HTTP_CLIENT_CONFIG, normalizeTypeExpression } from '../generatorCommon';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('buildUniqueMethodName should sanitize special symbols in default mode', () => {
		(globalThis as any)._controllerMethodNames = {};
		const methodName = buildUniqueMethodName('/user-center/list@v2', 'UserController', 'get', undefined, DEFAULT_NAMING);
		assert.strictEqual(methodName, 'List_v2');
	});

	test('buildUniqueMethodName should keep only the last path param as suffix to stay compatible', () => {
		(globalThis as any)._controllerMethodNames = {};
		const methodName = buildUniqueMethodName('/bizBatteryExchangeRecord/updateById/{id}/{status}', 'BizBatteryExchangeRecordController', 'get', undefined, DEFAULT_NAMING);
		assert.strictEqual(methodName, 'UpdateByIdByStatus');
	});

	test('buildImportSnippet should directly use requestImportPath when directReplacementRequestImportPath is true', () => {
		const importLine = buildImportSnippet({
			...DEFAULT_HTTP_CLIENT_CONFIG,
			mode: 'axios-wrapper',
			directReplacementRequestImportPath: true,
			requestImportPath: 'import customClient from "@/custom/request"',
		});
		assert.strictEqual(importLine, 'import customClient from "@/custom/request"');
	});

	test('normalizeTypeExpression should replace invalid spaces and symbols in type names', () => {
		const normalized = normalizeTypeExpression('接口返回对象<IPage<customer_base 对象>>');
		assert.strictEqual(normalized, '接口返回对象<IPage<customer_base_对象>>');
	});
});
