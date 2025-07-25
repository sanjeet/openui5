/* eslint-disable */

var baseUrl = document.location.pathname.substring(0, document.location.pathname.lastIndexOf("/")+1),
	localStorageKey = document.querySelector("script[localstoragekey]").getAttribute("localstoragekey"),
	section = {
		"type": "List",
		"configuration": {
			"editor": "withPreview/",
			"parameters": {
				"stringParameter": {}
			}
		},
		"header": {
			"title": "Card Title",
			"subtitle": "Card Sub Title",
			"icon": {
				"src": "sap-icon://accept"
			}
		}
	},
	manifest = {
		"sap.app": {
			"id": "test.sample",
			"type": "card",
			"i18n": "i18n/i18n.properties",
			"title": "Test Card for Parameters",
			"subTitle": "Test Card for Parameters"
		},
	};

function switchTheme(oSelect) {
	sap.ui.require(["sap/ui/core/Theming"], function(Theming) {
		Theming.setTheme(oSelect.options[oSelect.selectedIndex].value);
	});
}

function switchLanguage(oSelect) {
	sap.ui.require([
		"sap/base/i18n/Localization",
		'sap/base/util/LoaderExtensions',
		"sap/ui/integration/util/Utils"
	], function (
		Localization,
		LoaderExtensions,
		Utils
	) {
		this._sLanguage = oSelect.options[oSelect.selectedIndex].value;
		Localization.setLanguage(this._sLanguage);
		updateAllLayerEditor();
		loadAllChanges();
	});
}

function switchTranslationLanguageForOnlyMode(oSelect) {
	this._sTranslationLanguageForOnlyMode = oSelect.options[oSelect.selectedIndex].value;
	loadCurrentValues("editorTranslation");
}

function switchTranslationLanguageForAllMode(oSelect) {
	this._sTranslationLanguageForAllMode = oSelect.options[oSelect.selectedIndex].value;
	updateAdminContentTranslationLayerEditor();
}

function init() {
	sap.ui.require(["sap-ui-integration-editor"], function () {
		loadLanguages();
		updateAllLayerEditor();
		loadAllChanges();
		//load common implementation for host testing
		sap.ui.require(["testjs/HostImpl"]);
	});

	// Simulate library location for the shared extension
	sap.ui.loader.config({
		paths: {
			"sap/ui/integration/editor/test/testLib": sap.ui.require.toUrl("sap/ui/integration/editor/test/testLib")
		}
	});
}

function getItem(id) {
	return JSON.parse(localStorage.getItem(localStorageKey + id) || "{}");
}

function showCurrentValues(id) {
	var o = document.getElementById(id).getCurrentSettings();
	console.log(o);
	alert(JSON.stringify(o, null, "\t"));
}
function saveCurrentValues(id) {
	var o = document.getElementById(id).getCurrentSettings()
	localStorage.setItem(localStorageKey + id, JSON.stringify(o, null, "\t"));
	updateAllLayerEditor();
}
function deleteCurrentValues(id) {
	localStorage.removeItem(localStorageKey + id);
	loadCurrentValues(id);
	updateAllLayerEditor();
}
function createEditorTag(id, changes, mode, sectionName, language) {
	sectionName = sectionName || "sap.card";
	language = language || "";
	var json = {
		"manifest": "manifest.json",
		"manifestChanges": changes,
		"baseUrl": baseUrl
	};
	return '<ui-integration-editor id="' + id +
		'" mode="' + mode +
		'" section="' + sectionName +
		'" language="' + language +
		'" allow-dynamic-values="true" allow-settings="true" host="host"' +
		'" json=\'' + JSON.stringify(json).replaceAll("'", "&apos;") +
		'\'></ui-integration-editor>';
}
function loadCurrentValues(id) {
	var dom = document.getElementById(id);
	if (!dom) return;
	var settings = getItem(id),
		div = document.createElement("div");
	var sLanguage;
	if (id === "editorTranslation") {
		sLanguage = this._sTranslationLanguageForOnlyMode || "ru";
	} else {
		sLanguage = this._sLanguage || dom.getAttribute("language") || "";
	}
	div.innerHTML = createEditorTag(id, [settings], dom.getAttribute("mode"), dom.getAttribute("section"), sLanguage);
	dom.parentNode.replaceChild(div.firstChild, dom);
}

function loadAllChanges() {
	loadCurrentValues("editorAdmin");
	loadCurrentValues("editorContent")
	loadCurrentValues("editorTranslation");
}

function loadLanguages() {
	sap.ui.require([
		"sap/base/i18n/Localization",
		'sap/base/util/LoaderExtensions',
		"sap/ui/integration/util/Utils"
	], function (
		Localization,
		LoaderExtensions,
		Utils
	) {
		//load the language list
		var aLanguageList = LoaderExtensions.loadResource("sap/ui/integration/editor/languages.json", {
			dataType: "json",
			failOnError: false,
			async: false
		});
		var sCurrentLanguage =  Localization.getLanguage().replaceAll('_', '-');
		var oLanguageSelect = document.getElementById("languageSelect");
		if (oLanguageSelect) {
			for (var sLanguage in aLanguageList) {
				var oOption = document.createElement("OPTION");
				oOption.text = aLanguageList[sLanguage];
				oOption.value = sLanguage;
				if (sLanguage === sCurrentLanguage) {
					oOption.selected = true;
				}
				oLanguageSelect.add(oOption);
			}
			for (var sLanguage in Utils.languageMapping) {
				var oOption = document.createElement("OPTION");
				oOption.text =  sLanguage + "/" + Utils.languageMapping[sLanguage];
				oOption.value = sLanguage;
				if (sLanguage === sCurrentLanguage) {
					oOption.selected = true;
				}
				oLanguageSelect.add(oOption);
			}
		}
		var oTranslationLanguageSelectForOnlyMode = document.getElementById("translationLanguageSelectForOnlyMode");
		if (oTranslationLanguageSelectForOnlyMode) {
			var sTranslationLanguageForOnlyMode = this._sTranslationLanguageForOnlyMode || "ru";
			for (var sLanguage in aLanguageList) {
				var oOption = document.createElement("OPTION");
				oOption.text = aLanguageList[sLanguage];
				oOption.value = sLanguage;
				if (sLanguage === sTranslationLanguageForOnlyMode) {
					oOption.selected = true;
				}
				oTranslationLanguageSelectForOnlyMode.add(oOption);
			}
			for (var sLanguage in Utils.languageMapping) {
				var oOption = document.createElement("OPTION");
				oOption.text =  sLanguage + "/" + Utils.languageMapping[sLanguage];
				oOption.value = sLanguage;
				if (sLanguage === sTranslationLanguageForOnlyMode) {
					oOption.selected = true;
				}
				oTranslationLanguageSelectForOnlyMode.add(oOption);
			}
		}
		var oTranslationLanguageSelectForAllMode = document.getElementById("translationLanguageSelectForAllMode");
		if (oTranslationLanguageSelectForAllMode) {
			var sTranslationLanguageForAllMode = this._sTranslationLanguageForAllMode || "ru";
			for (var sLanguage in aLanguageList) {
				var oOption = document.createElement("OPTION");
				oOption.text = aLanguageList[sLanguage];
				oOption.value = sLanguage;
				if (sLanguage === sTranslationLanguageForAllMode) {
					oOption.selected = true;
				}
				oTranslationLanguageSelectForAllMode.add(oOption);
			}
			for (var sLanguage in Utils.languageMapping) {
				var oOption = document.createElement("OPTION");
				oOption.text =  sLanguage + "/" + Utils.languageMapping[sLanguage];
				oOption.value = sLanguage;
				if (sLanguage === sTranslationLanguageForAllMode) {
					oOption.selected = true;
				}
				oTranslationLanguageSelectForAllMode.add(oOption);
			}
		}
	});
}

function updateAllLayerEditor() {
	updateAdminContentTranslationLayerEditor();
	updateAdminContentLayerEditor();
	var target = document.getElementById("all");
	if (!target) return;
	var sectionName = target.getAttribute("section");
	target.innerHTML = "";
	var settings = [],
		admin = getItem("editorAdmin"),
		content = getItem("editorContent"),
		translation = getItem("editorTranslation");
	settings.push(admin, content, translation);
	target.innerHTML = createEditorTag("editorAll", settings, "all", sectionName, this._sLanguage || "");
}

function updateAdminContentLayerEditor() {
	var target = document.getElementById("admincontent");
	if (!target) return;
	var sectionName = target.getAttribute("section");
	target.innerHTML = "";
	var settings = [],
		admin = getItem("editorAdmin"),
		content = getItem("editorContent");
	settings.push(admin, content);
	target.innerHTML = createEditorTag("editorAdminContent", settings, "content", sectionName, "");
}
function updateAdminContentTranslationLayerEditor() {
	var target = document.getElementById("admincontenttranslation");
	if (!target) return;
	var sectionName = target.getAttribute("section");
	target.innerHTML = "";
	var settings = [],
		admin = getItem("editorAdmin"),
		content = getItem("editorContent"),
		translation = getItem("editorTranslation");
	settings.push(admin, content, translation);
	var sLanguage = this._sTranslationLanguageForAllMode || "ru";
	target.innerHTML = createEditorTag("editorAdminContentTranslation", settings, "translation", sectionName, sLanguage);
}
