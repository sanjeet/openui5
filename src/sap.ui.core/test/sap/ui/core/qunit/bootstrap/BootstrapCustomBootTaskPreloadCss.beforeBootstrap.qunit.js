sap.ui.require([
	"sap/ui/core/theming/ThemeHelper"
], (
	ThemeHelper
) => {
	"use strict";

	var oLink = document.createElement("link");
	oLink.rel = "stylesheet";
	oLink.href = "test-resources/sap/ui/core/qunit/bootstrap/preloadedCss/themes/base/library.css";
	oLink.setAttribute("id", "sap-ui-theme-fantasyLib");

	function listener(oEvent) {
		var bError = oEvent.type === "error";
		oLink.setAttribute("data-sap-ui-ready", !bError);
		oLink.removeEventListener("load", listener);
		oLink.removeEventListener("error", listener);
	}

	oLink.addEventListener("load", listener);
	oLink.addEventListener("error", listener);

	document.head.appendChild(oLink);

	window["sap-ui-config"] = window["sap-ui-config"] || {};
	window["sap-ui-config"]["xx-bootTask"] = function(callback) {
		sap.ui.require(["sap/ui/core/Lib"], function(Library) {
			Library.load({
				name: "sap.ui.testlib",
				url: "test-resources/sap/ui/core/qunit/testdata/uilib"
			}).then(callback);
		});
	};
	window["sap-ui-config"]["themeroots"] = {};
	// Define theme root for current theme for testing purposes
	const mDefaultThemeInfo = ThemeHelper.getDefaultThemeInfo();
	const sTheme = `${mDefaultThemeInfo.DEFAULT_THEME}${mDefaultThemeInfo.DARK_MODE ? "_dark" : ""}`;
	window["sap-ui-config"]["themeroots"][sTheme] = "foo/bar";

});