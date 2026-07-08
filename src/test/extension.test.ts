import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { buildControllerNames, buildImportSnippet, buildUniqueMethodName, DEFAULT_NAMING, DEFAULT_HTTP_CLIENT_CONFIG, normalizeTypeExpression, resolveControllerNamingKey } from '../generatorCommon';
import { ApiGenerator as ApiGeneratorV2 } from '../generatorV2';
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

	test('resolveControllerNamingKey should use description in auto mode only for Chinese tag names', () => {
		const tags = [
			{ name: '用户管理', description: 'UserController' },
			{ name: 'OrderController', description: '订单管理' },
		];
		const naming = { ...DEFAULT_NAMING, controllerNameStrategy: 'auto' as const };
		assert.strictEqual(resolveControllerNamingKey('用户管理', tags, naming), 'UserController');
		assert.strictEqual(resolveControllerNamingKey('OrderController', tags, naming), 'OrderController');
	});

	test('buildControllerNames should skip duplicate configured suffix', () => {
		const naming = {
			...DEFAULT_NAMING,
			controllerFileNameCasing: 'PascalCase' as const,
			controllerClassNameSuffix: 'Controller',
			skipDuplicateControllerClassNameSuffix: true,
		};
		const names = buildControllerNames('UserController', naming);
		assert.strictEqual(names.className, 'UserController');
		assert.strictEqual(names.fileName, 'UserController');
	});

	test('buildControllerNames should sanitize controller names before file casing', () => {
		const defaultNames = buildControllerNames('User Center.Controller', DEFAULT_NAMING);
		assert.strictEqual(defaultNames.className, 'User_Center_Controller');
		assert.strictEqual(defaultNames.fileName, 'User_Center_Controller');

		const kebabNames = buildControllerNames('User Center.Controller', {
			...DEFAULT_NAMING,
			controllerFileNameCasing: 'kebab-case',
		});
		assert.strictEqual(kebabNames.className, 'UserCenterController');
		assert.strictEqual(kebabNames.fileName, 'user-center-controller');
	});

	test('V2 params interface should only use controller prefix when method names collide', () => {
		const generator = new ApiGeneratorV2() as any;
		generator.naming = {
			...DEFAULT_NAMING,
			controllerNameStrategy: 'auto',
			methodNameCasing: 'camelCase',
			controllerClassNameSuffix: 'Controller',
			skipDuplicateControllerClassNameSuffix: true,
		};
		const makeParams = () => Array.from({ length: 6 }, (_, index) => ({
			name: `field${index}`,
			in: 'query',
			type: 'string',
		}));
		const apiDocs = {
			swagger: '2.0',
			info: { title: 'test', version: '1.0.0' },
			tags: [
				{ name: '用户管理', description: 'UserController' },
				{ name: '订单管理', description: 'OrderController' },
				{ name: '库存管理', description: 'StockController' },
			],
			paths: {
				'/user/list': { get: { tags: ['用户管理'], parameters: makeParams(), responses: {} } },
				'/order/list': { get: { tags: ['订单管理'], parameters: makeParams(), responses: {} } },
				'/stock/page': { get: { tags: ['库存管理'], parameters: makeParams(), responses: {} } },
			},
			definitions: {},
		};
		const result = generator.generateController(apiDocs);
		const joined = result.paramTypes.join('\n');
		assert.match(joined, /export interface UserControllerListParams/);
		assert.match(joined, /export interface OrderControllerListParams/);
		assert.match(joined, /export interface PageParams/);
		assert.doesNotMatch(joined, /StockControllerPageParams/);
	});
});
