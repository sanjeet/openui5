/*global QUnit */

sap.ui.define([
	"sap/ui/model/json/JSONModel",
	"sap/ui/base/ManagedObject",
	"sap/ui/integration/util/BindingResolver",
	"sap/ui/integration/util/BindingHelper",
	"sap/ui/core/date/UI5Date"
],
function (JSONModel, ManagedObject, BindingResolver, BindingHelper, UI5Date) {
	"use strict";

	QUnit.module("BindingResolver resolveValue");

	QUnit.test("Simple binding syntax", function (assert) {

		// Arrange
		var oModel = new JSONModel();
		oModel.setData({
			id: "someid"
		});

		// Act
		var vId = BindingResolver.resolveValue("{id}", oModel);

		// Assert
		assert.equal(vId, "someid", "Should have correctly resolved simple binding syntax.");
	});

	QUnit.test("Simple binding syntax with path", function (assert) {
		// Arrange
		var oModel = new JSONModel();
		oModel.setData({
			items: [
				{
					id: 1
				},
				{
					id: 2
				},
				{
					id: 3
				}
			]
		});

		assert.equal(BindingResolver.resolveValue("{id}", oModel, "/items/0"), 1, "Should have correctly resolved simple binding syntax.");
	});

	QUnit.test("Complex binding syntax", function (assert) {

		// Arrange
		var oModel = new JSONModel();
		oModel.setData({
			id: "someid"
		});

		// Act
		var vId = BindingResolver.resolveValue("Test {id} test", oModel);

		// Assert
		assert.equal(vId, "Test someid test", "Should have correctly resolved complex binding syntax.");
	});

	QUnit.test("Expression binding syntax", function (assert) {

		// Arrange
		var oModel = new JSONModel();
		oModel.setData({
			id: "someid"
		});

		// Act
		var vResolved = BindingResolver.resolveValue("{= ${id} === 'someid' ? 'success' : 'error' }", oModel);

		// Assert
		assert.equal(vResolved, "success", "Should have correctly resolved expression binding syntax.");

		// Act
		oModel.setData({
			id: "someid2"
		});
		var vResolved2 = BindingResolver.resolveValue("{= ${id} === 'someid' ? 'success' : 'error' }", oModel);

		// Assert
		assert.equal(vResolved2, "error", "Should have correctly resolved expression binding syntax.");
	});

	QUnit.test("Simple string", function (assert) {

		// Arrange
		var oModel = new JSONModel();
		oModel.setData({
			id: "someid"
		});

		// Act
		var vResolved = BindingResolver.resolveValue("somestring", oModel);

		// Assert
		assert.equal(vResolved, "somestring", "Should have correctly resolved simple string.");
	});

	QUnit.test("Complex 'object' with bindings", function (assert) {

		// Arrange
		var oModel = new JSONModel();
		oModel.setData({
			id: "someid",
			header: {
				title: {
					text: "The title of the header",
					visible: true
				}
			},
			content: {
				items: [
					{
						id: "item1"
					},
					{
						id: "item2"
					},
					{
						id: "item3"
					}
				]
			}
		});

		var oObjectToResolve = {
			header: {
				title: "{/header/title/text} some title",
				visible: "{= ${/header/title/visible} ? true : false}"
			},
			content: {
				items: [
					{
						id: "{/content/items/0/id}"
					},
					{
						id: "{/content/items/1/id}"
					},
					{
						id: "{/content/items/2/id}"
					},
					"{id}",
					""
				]
			}
		};

		// Act
		var vResolved = BindingResolver.resolveValue(oObjectToResolve, oModel);

		// Assert
		assert.notDeepEqual(vResolved, oObjectToResolve, "Should NOT change the passed object.");
		assert.equal(vResolved.header.title, "The title of the header some title", "Should have correctly resolved complex binding syntax.");
		assert.ok(vResolved.header.visible, "Should have correctly resolved expression binding syntax.");
		assert.equal(vResolved.content.items[0].id, "item1", "Should have correct id.");
		assert.equal(vResolved.content.items[1].id, "item2", "Should have correct id.");
		assert.equal(vResolved.content.items[2].id, "item3", "Should have correct id.");
		assert.equal(vResolved.content.items[3], "someid", "Should have correct value in array.");
		assert.equal(vResolved.content.items[4], "", "Should have correct value in array.");
	});

	QUnit.test("Complex array with elements containing bindings", function (assert) {
		// Arrange
		var oModel = new JSONModel();
		oModel.setData({
			content: {
				items: [
					{ id: "item1" },
					{ id: "item2" },
					{ id: "item3" }
				]
			}
		});

		var oArrayToResolve = [
			{ id: "{/content/items/0/id}" },
			{ id: "{/content/items/1/id} with complex binding" },
			{ id: "{= ${/content/items/2/id}.toUpperCase() }" }
		];

		// Act
		var vResolved = BindingResolver.resolveValue(oArrayToResolve, oModel);

		// Assert
		assert.notDeepEqual(vResolved, oArrayToResolve, "Should NOT change the passed object.");
		assert.equal(vResolved[0].id, "item1", "Should have resolved simple binding.");
		assert.equal(vResolved[1].id, "item2 with complex binding", "Should have resolved complex binding.");
		assert.equal(vResolved[2].id, "ITEM3", "Should have resolved expression binding.");
	});

	QUnit.test("Incorrect values - without model", function (assert) {
		assert.equal(BindingResolver.resolveValue(""), "", "Should have correctly resolved empty string.");
		assert.equal(BindingResolver.resolveValue(undefined), undefined, "Should have correctly resolved undefined.");
		assert.equal(BindingResolver.resolveValue(null), null, "Should have correctly resolved null.");
		assert.equal(BindingResolver.resolveValue(true), true, "Should have correctly resolved true.");
		assert.equal(BindingResolver.resolveValue(false), false, "Should have correctly resolved false.");
		assert.deepEqual(BindingResolver.resolveValue({}), {}, "Should have correctly resolved empty object.");
		assert.deepEqual(BindingResolver.resolveValue([]), [], "Should have correctly resolved empty array.");
	});

	QUnit.test("Incorrect values - with model", function (assert) {
		// Arrange
		var oModel = new JSONModel();
		oModel.setData({
			id: "someid"
		});

		assert.equal(BindingResolver.resolveValue("", oModel), "", "Should have correctly resolved empty string.");
		assert.equal(BindingResolver.resolveValue(undefined, oModel), undefined, "Should have correctly resolved undefined.");
		assert.equal(BindingResolver.resolveValue(null, oModel), null, "Should have correctly resolved null.");
		assert.equal(BindingResolver.resolveValue(true, oModel), true, "Should have correctly resolved true.");
		assert.equal(BindingResolver.resolveValue(false, oModel), false, "Should have correctly resolved false.");
		assert.deepEqual(BindingResolver.resolveValue({}, oModel), {}, "Should have correctly resolved empty object.");
		assert.deepEqual(BindingResolver.resolveValue([], oModel), [], "Should have correctly resolved empty array.");
	});

	QUnit.test("Resolving instances of Date", function (assert) {
		// Arrange
		var oData = {
			value: UI5Date.getInstance()
		};

		// Assert
		assert.strictEqual(BindingResolver.resolveValue(oData, new JSONModel()).value, oData.value, "Date instance is not modified");
	});

	QUnit.module("BindingResolver resolveListBinding");

	QUnit.test("Using absolute path", function (assert) {
		// Arrange
		const oModel = new JSONModel({
			content: {
				items: [
					{ id: "item1" },
					{ id: "item2" }
				]
			}
		});
		const oTemplate = {
			"title": "{id}"
		};
		const aExpected = [
			{ title: "item1" },
			{ title: "item2" }
		];

		// Assert
		assert.deepEqual(BindingResolver.resolveListBinding("/content/items", "/someIrrelevantRootPath", oTemplate, oModel), aExpected, "Should resolve list binding.");
		assert.deepEqual(BindingResolver.resolveListBinding("/content/items", undefined, oTemplate, oModel), aExpected, "Should resolve list binding.");
	});

	QUnit.test("Using absolute path and named model", function (assert) {
		// Arrange
		const oObject = new ManagedObject();
		const oModel = new JSONModel({
			content: {
				items: [
					{ id: "item1" },
					{ id: "item2" }
				]
			}
		});
		oObject.setModel(oModel, "namedModel");
		const oTemplate = {
			"title": "{namedModel>id}"
		};
		const aExpected = [
			{ title: "item1" },
			{ title: "item2" }
		];

		// Assert
		assert.deepEqual(BindingResolver.resolveListBinding("namedModel>/content/items", "/someIrrelevantRootPath", oTemplate, oObject), aExpected, "Should resolve list binding.");
		assert.deepEqual(BindingResolver.resolveListBinding("namedModel>/content/items", undefined, oTemplate, oObject), aExpected, "Should resolve list binding.");
	});

	QUnit.test("Using relative path", function (assert) {
		// Arrange
		const oModel = new JSONModel({
			content: {
				items: [
					{ id: "item1" },
					{ id: "item2" }
				]
			}
		});
		// oObject.setModel(oModel, "namedModel");
		const oTemplate = {
			"title": "{id}"
		};
		const aExpected = [
			{ title: "item1" },
			{ title: "item2" }
		];

		// Assert
		assert.deepEqual(BindingResolver.resolveListBinding("content/items", "/", oTemplate, oModel), aExpected, "Should resolve list binding.");
		assert.deepEqual(BindingResolver.resolveListBinding("items", "/content/", oTemplate, oModel), aExpected, "Should resolve list binding.");
		assert.throws(
			function () {
				BindingResolver.resolveListBinding("content/items", undefined, oTemplate, oModel);
			},
			"Should throw an error when root path is not provided for relative path."
		);
	});

	QUnit.test("Using relative path and named model", function (assert) {
		// Arrange
		const oObject = new ManagedObject();
		const oModel = new JSONModel({
			content: {
				items: [
					{ id: "item1" },
					{ id: "item2" }
				]
			}
		});
		oObject.setModel(oModel, "namedModel");
		const oTemplate = {
			"title": "{namedModel>id}"
		};
		const aExpected = [
			{ title: "item1" },
			{ title: "item2" }
		];

		// Assert
		assert.deepEqual(BindingResolver.resolveListBinding("namedModel>content/items", "namedModel>/", oTemplate, oObject), aExpected, "Should resolve list binding.");
		assert.deepEqual(BindingResolver.resolveListBinding("namedModel>items", "namedModel>/content/", oTemplate, oObject), aExpected, "Should resolve list binding.");
		assert.throws(
			function () {
				BindingResolver.resolveListBinding("namedModel>content/items", undefined, oTemplate, oModel);
			},
			"Should throw an error when root path is not provided for relative path."
		);
	});

	QUnit.test("Template with mixture of binding paths and static values", function (assert) {
		// Arrange
		const oObject = new ManagedObject();

		oObject.setModel(new JSONModel({
			"textFromDefaultModel": "This is a static text from default model"
		}));
		oObject.setModel(new JSONModel({
			content: {
				items: [
					{ id: "item1" },
					{ id: "item2" }
				]
			}
		}), "namedModel");

		const oTemplate = {
			"title": "Item id: {namedModel>id}, static text: {/textFromDefaultModel}",
			"description": "Item description: {notExistingDescription}"
		};
		const aExpected = [
			{
				title: "Item id: item1, static text: This is a static text from default model",
				description: "Item description: "
			},
			{
				title: "Item id: item2, static text: This is a static text from default model",
				description: "Item description: "
			}
		];

		// Assert
		assert.deepEqual(BindingResolver.resolveListBinding("namedModel>content/items", "namedModel>/", oTemplate, oObject), aExpected, "Should resolve list binding with template containing both binding paths and static values.");
	});

	QUnit.module("Resolve values that are already parsed");

	QUnit.test("Object that is binding info with 'path'", function (assert) {
		// Arrange
		var oModel = new JSONModel();
		oModel.setData({
			content: {
				items: [
					{ id: "item1" }
				]
			}
		});

		//  parse
		var oBindingInfoToResolve = BindingHelper.createBindingInfos("{/content/items/0/id}");

		// Act
		var vResolved = BindingResolver.resolveValue(oBindingInfoToResolve, oModel);

		// Assert
		assert.notStrictEqual(vResolved, oBindingInfoToResolve, "Should NOT change the passed object.");
		assert.strictEqual(vResolved, "item1", "Should have properly resolve binding info.");
	});

	QUnit.test("Object that is binding info with 'parts'", function (assert) {
		// Arrange
		var oModel = new JSONModel();
		oModel.setData({
			content: {
				items: [
					{ id: "item1" }
				]
			}
		});

		//  parse
		var oBindingInfoToResolve = BindingHelper.createBindingInfos("this free text will bring 'parts' {/content/items/0/id}");

		// Act
		var vResolved = BindingResolver.resolveValue(oBindingInfoToResolve, oModel);

		// Assert
		assert.notStrictEqual(vResolved, oBindingInfoToResolve, "Should NOT change the passed object.");
		assert.strictEqual(vResolved, "this free text will bring 'parts' item1", "Should have properly resolve binding info.");
	});

	QUnit.module("Get all models from a managed object");

	QUnit.test("Resolve based on models from a manged object", function (assert) {
		// Arrange
		var oObject = new ManagedObject(),
			oModel1 = new JSONModel({
				"test": "value1"
			}),
			oModelFilters = new JSONModel({
				"test": "value2"
			}),
			sText = "{/test} {filters>/test}";

		oObject.setModel(oModel1);
		oObject.setModel(oModelFilters, "filters");

		//  parse
		var oBindingInfoToResolve = BindingHelper.createBindingInfos(sText);

		// Act
		var vResolved = BindingResolver.resolveValue(oBindingInfoToResolve, oObject);

		// Assert
		assert.strictEqual(vResolved, "value1 value2", "Text is resolved correctly based on 2 models.");
	});

});