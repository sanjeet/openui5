/*global QUnit, sinon*/

sap.ui.define([
	"sap/ui/core/Lib",
	"sap/ui/core/Theming",
	"sap/ui/support/supportRules/report/DataCollector",
	"sap/ui/core/UIComponent"
], function (Lib, Theming, DataCollector, UIComponent) {
		"use strict";

		QUnit.module("Data collector", {
			beforeEach: function () {
				this.DataCollector = new DataCollector();
			},
			afterEach: function () {
				this.DataCollector = null;
			}
		});

		QUnit.test("Location", function (assert) {
			// Arrange
			var sLocationUrl = "https://sdk.openui5.org/nightly/resources/sap/ui/support";
			this.DataCollector.setSupportAssistantLocation(sLocationUrl);

			// Assert
			assert.equal(this.DataCollector.getSupportAssistantInfo().location, sLocationUrl, "Location is correctly set");
		});

		QUnit.test("Info", function (assert) {
			// Arrange
			var oVersion = {
				version: "1.77.0-SNAPSHOT",
				buildTimestamp: "202003270040",
				scmRevision: "67adf13a9d5e2c1c0278b790b21e065da26ce404"
			};

			this.DataCollector.setSupportAssistantVersion(oVersion);

			// Assert
			assert.equal(this.DataCollector.getSupportAssistantInfo().versionAsString, "1.77.0-SNAPSHOT (built at 202003270040, last change 67adf13a9d5e2c1c0278b790b21e065da26ce404)", "Version string is correctly set");
			assert.equal(this.DataCollector.getSupportAssistantInfo().version.version, "1.77.0-SNAPSHOT", "Version is correctly set");
			assert.equal(this.DataCollector.getSupportAssistantInfo().version.buildTimestamp, "202003270040", "buildTimestamp is correctly set");
			assert.equal(this.DataCollector.getSupportAssistantInfo().version.scmRevision, "67adf13a9d5e2c1c0278b790b21e065da26ce404", "scmRevision is correctly set");
		});

		QUnit.test("Application Info 'sap.app'", function (assert) {
			// Arrange
			var DataCollectorTestComponent = UIComponent.extend("DataCollectorTestComponent", {
				metadata: {
					manifest: {
						"sap.app": {
							type: "application"
						}
					}
				}
			});
			var oComponent1 = new DataCollectorTestComponent();
			var oComponent2 = new DataCollectorTestComponent();

			// Assert
			assert.deepEqual(
				this.DataCollector.getAppInfo(),
				[
					{
						type: "application"
					},
					{
						type: "application"
					}
				],
				"App info is OK"
			);

			// Clean up
			oComponent1.destroy();
			oComponent2.destroy();
		});

		QUnit.test("Application Info 'sap.fiori'", function (assert) {
			// Arrange
			var DataCollectorTestComponent1 = UIComponent.extend("DataCollectorTestComponentWithSapFiori", {
				metadata: {
					manifest: {
						"sap.app": {
							type: "application"
						},
						"sap.fiori": {}
					}
				}
			});
			var DataCollectorTestComponent2 = UIComponent.extend("DataCollectorTestComponentWithoutSapFiori", {
				metadata: {
					manifest: {
						"sap.app": {
							type: "application"
						}
					}
				}
			});
			var oComponent1 = new DataCollectorTestComponent1();
			var oComponent2 = new DataCollectorTestComponent2();

			// Assert
			assert.deepEqual(
				this.DataCollector.getAppInfo(),
				[
					{
						type: "application"
					},
					{},
					{
						type: "application"
					}
				],
				"App info is OK"
			);

			// Clean up
			oComponent1.destroy();
			oComponent2.destroy();
		});

		QUnit.test("Technical Info", function (assert) {
			var done = assert.async();
			// Arrange
			var oGetLoadedLibrariesMock = sinon.stub(Lib, "all").returns(["sap.m"]);
			var oGetThemeRoot = sinon.stub(Theming, "getThemeRoot");
			oGetThemeRoot.withArgs("fiori_3", "0").returns("http://www.example.com/");
			var oGetThemeMock = sinon.stub(Theming, "getTheme").returns("fiori_3");

			this.DataCollector.getTechInfoJSON().then(function (oTechData) {
				// Assert
				assert.equal(oTechData.themePaths[0].theme, "fiori_3", "Theme string is correctly set");
				assert.equal(oTechData.themePaths[0].relativePath, "http://www.example.com/0/themes/fiori_3/", "Theme path is correctly set");

				oGetLoadedLibrariesMock.restore();
				oGetThemeRoot.restore();
				oGetThemeMock.restore();

				done();
			});
		});
});