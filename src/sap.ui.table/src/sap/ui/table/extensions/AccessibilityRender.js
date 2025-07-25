/*!
 * ${copyright}
 */

// Provides helper sap.ui.table.extensions.AccessibilityRender.
sap.ui.define([
	"./ExtensionBase", "../utils/TableUtils", "../library"
], function(ExtensionBase, TableUtils, library) {
	"use strict";

	// Shortcuts
	const SelectionMode = library.SelectionMode;

	/*
	 * Renders a hidden element with the given id, text and css classes.
	 */
	const _writeAccText = function(oRm, sParentId, sId, sText, aCSSClasses) {
		aCSSClasses = aCSSClasses || [];
		aCSSClasses.push("sapUiInvisibleText");

		oRm.openStart("span", sParentId + "-" + sId);
		aCSSClasses.forEach(function(sClass) {
			oRm.class(sClass);
		});
		oRm.attr("aria-hidden", "true");
		oRm.openEnd();
		if (sText) {
			oRm.text(sText);
		} else {
			oRm.text("."); // This is a workaround for a Chrome bug, BCP: 2370127818
		}
		oRm.close("span");
	};

	//********************************************************************

	/**
	 * Extension for sap.ui.table.TableRenderer which handles ACC related things.
	 * <b>This is an internal class that is only intended to be used inside the sap.ui.table library! Any usage outside the sap.ui.table library is
	 * strictly prohibited!</b>
	 *
	 * @class Extension for sap.ui.table.TableRenderer which handles ACC related things.
	 * @extends sap.ui.table.extensions.ExtensionBase
	 * @author SAP SE
	 * @version ${version}
	 * @constructor
	 * @private
	 * @alias sap.ui.table.extensions.AccessibilityRender
	 */
	const AccRenderExtension = ExtensionBase.extend("sap.ui.table.extensions.AccessibilityRender",
		/** @lends sap.ui.table.extensions.AccessibilityRender.prototype */ {
		/**
		 * @override
		 * @inheritDoc
		 * @returns {string} The name of this extension.
		 */
		_init: function(oTable, mSettings) {
			return "AccRenderExtension";
		},

		/**
		 * Renders all necessary hidden text elements of the table.
		 *
		 * @param {sap.ui.core.RenderManager} oRm The RenderManager that can be used for writing to the Render-Output-Buffer.
		 * @param {sap.ui.table.Table} oTable Instance of the table.
		 * @public
		 */
		writeHiddenAccTexts: function(oRm, oTable) {
			if (!oTable._getAccExtension().getAccMode()) {
				return;
			}

			const sTableId = oTable.getId();

			oRm.openStart("div");
			oRm.class("sapUiTableHiddenTexts");
			oRm.style("display", "none");
			oRm.attr("aria-hidden", "true");
			oRm.openEnd();

			// aria label for group rows
			_writeAccText(oRm, sTableId, "ariarowgrouplabel", TableUtils.getResourceText("TBL_ROW_GROUP_LABEL"));
			// aria label for grand total sums
			_writeAccText(oRm, sTableId, "ariagrandtotallabel", TableUtils.getResourceText("TBL_GRAND_TOTAL_ROW"));
			// aria label for group total sums
			_writeAccText(oRm, sTableId, "ariagrouptotallabel", TableUtils.getResourceText("TBL_GROUP_TOTAL_ROW"));
			// aria description for table cell content
			_writeAccText(oRm, sTableId, "cellacc");
			// aria description for column menu
			_writeAccText(oRm, sTableId, "ariacolmenu", TableUtils.getResourceText("TBL_COL_DESC_MENU"));
			// aria description for column header span
			_writeAccText(oRm, sTableId, "ariacolspan");
			// aria description for a filtered column
			_writeAccText(oRm, sTableId, "ariacolfiltered", TableUtils.getResourceText("TBL_COL_DESC_FILTERED"));
			// aria description for a sorted column
			_writeAccText(oRm, sTableId, "ariacolsortedasc", TableUtils.getResourceText("TBL_COL_DESC_SORTED_ASC"));
			// aria description for a sorted column
			_writeAccText(oRm, sTableId, "ariacolsorteddes", TableUtils.getResourceText("TBL_COL_DESC_SORTED_DES"));
			// aria description for invalid table (table with overlay)
			_writeAccText(oRm, sTableId, "ariainvalid", TableUtils.getResourceText("TBL_TABLE_INVALID"));
			// aria description for column vsisiblity menu item (Show Column)
			_writeAccText(oRm, sTableId, "ariashowcolmenu", TableUtils.getResourceText("TBL_COL_VISBILITY_MENUITEM_SHOW"));
			// aria description for column vsisiblity menu item (Hide Column)
			_writeAccText(oRm, sTableId, "ariahidecolmenu", TableUtils.getResourceText("TBL_COL_VISBILITY_MENUITEM_HIDE"));
			// aria description for row expansion via keyboard
			_writeAccText(oRm, sTableId, "rowexpandtext", TableUtils.getResourceText("TBL_ROW_EXPAND_KEY"));
			// aria description for row collapse via keyboard
			_writeAccText(oRm, sTableId, "rowcollapsetext", TableUtils.getResourceText("TBL_ROW_COLLAPSE_KEY"));
			// aria description for column with required content
			_writeAccText(oRm, sTableId, "ariarequired", TableUtils.getResourceText("TBL_COL_REQUIRED"));

			const oSelectionMode = oTable.getSelectionMode();
			if (oSelectionMode !== SelectionMode.None) {
				// aria description for selection mode in table
				_writeAccText(oRm, sTableId, "ariaselection",
					TableUtils.getResourceText(oSelectionMode === SelectionMode.MultiToggle ? "TBL_TABLE_SELECTION_MULTI" : "TBL_TABLE_SELECTION_SINGLE"));
			}

			if (oTable.getComputedFixedColumnCount() > 0) {
				// aria description for fixed columns
				_writeAccText(oRm, sTableId, "ariafixedcolumn", TableUtils.getResourceText("TBL_FIXED_COLUMN"));
			}

			if (TableUtils.hasRowNavigationIndicators(oTable)) {
				_writeAccText(oRm, sTableId, "rownavigatedtext", TableUtils.getResourceText("TBL_ROW_STATE_NAVIGATED"));
			}

			oRm.close("div");
		},

		/**
		 * Renders the default aria attributes of the element with the given type and settings.
		 *
		 * @param {sap.ui.core.RenderManager} oRm The RenderManager that can be used for writing to the Render-Output-Buffer.
		 * @param {sap.ui.table.Table} oTable Instance of the table.
		 * @param {sap.ui.table.extensions.Accessibility.ELEMENTTYPES} sType The type of the table area to write the aria attributes for.
		 * @param {Object} mParams Accessibility parameters.
		 * @see sap.ui.table.extensions.Accessibility#getAriaAttributesFor
		 * @public
		 */
		writeAriaAttributesFor: function(oRm, oTable, sType, mParams) {
			const oExtension = oTable._getAccExtension();

			if (!oExtension.getAccMode()) {
				return;
			}

			const mAttributes = oExtension.getAriaAttributesFor(sType, mParams);

			let oValue; let sKey;
			for (sKey in mAttributes) {
				oValue = mAttributes[sKey];
				if (Array.isArray(oValue)) {
					oValue = oValue.join(" ");
				}
				if (oValue) {
					oRm.attr(sKey.toLowerCase(), oValue);
				}
			}
		},

		/**
		 * Renders the default row selector content.
		 *
		 * @param {sap.ui.core.RenderManager} oRm The RenderManager that can be used for writing to the Render-Output-Buffer.
		 * @param {sap.ui.table.Table} oTable Instance of the table.
		 * @param {sap.ui.table.Row} oRow Instance of the row.
		 * @see sap.ui.table.TableRenderer.writeRowSelectorContent
		 * @public
		 */
		writeAccRowSelectorText: function(oRm, oTable, oRow) {
			if (!oTable._getAccExtension().getAccMode() || oRow.isGroupHeader() || oRow.isSummary()) {
				return;
			}

			const mKeyboardTexts = oTable._getAccExtension().getKeyboardTexts();
			const sText = oRow._isSelected() ? mKeyboardTexts.rowDeselect : mKeyboardTexts.rowSelect;

			_writeAccText(oRm, oRow.getId(), "rowselecttext", oRow.isEmpty() ? "" : sText, ["sapUiTableAriaRowSel"]);
		},

		/**
		 * Renders the default row highlight content.
		 *
		 * @param {sap.ui.core.RenderManager} oRm The RenderManager that can be used for writing to the Render-Output-Buffer.
		 * @param {sap.ui.table.Table} oTable Instance of the table.
		 * @param {sap.ui.table.Row} oRow Instance of the row.
		 * @param {int} iRowIndex The index of the row.
		 * @see sap.ui.table.TableRenderer#writeRowHighlightContent
		 * @public
		 */
		writeAccRowHighlightText: function(oRm, oTable, oRow, iRowIndex) {
			if (!oTable._getAccExtension().getAccMode()) {
				return;
			}

			const oRowSettings = oRow.getAggregation("_settings");
			const sHighlightText = oRowSettings._getHighlightText();

			_writeAccText(oRm, oRow.getId(), "highlighttext", sHighlightText);
		},

		/**
		 * Renders the hidden label for a creation row.
		 *
		 * @param {sap.ui.core.RenderManager} oRm The RenderManager that can be used for writing to the Render-Output-Buffer.
		 * @param {sap.ui.table.Table} oTable Instance of the table.
		 * @param {sap.ui.table.CreationRow} oCreationRow Instance of the creation row.
		 * @see sap.ui.table.CreationRowRenderer#render
		 * @public
		 */
		writeAccCreationRowText: function(oRm, oTable, oCreationRow) {
			if (!oTable._getAccExtension().getAccMode()) {
				return;
			}

			_writeAccText(oRm, oCreationRow.getId(), "label", TableUtils.getResourceText("TBL_CREATEROW_LABEL"));
		}
	});

	return AccRenderExtension;
});

/**
 * Gets the accessibility render extension.
 *
 * @name sap.ui.table.Table#_getAccRenderExtension
 * @function
 * @returns {sap.ui.table.extensions.AccessibilityRender} The accessibility render extension.
 * @private
 */