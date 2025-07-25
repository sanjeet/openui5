/*!
 * ${copyright}
 */
sap.ui.define([
	"sap/m/MessageBox",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/ui/core/sample/common/Controller",
	"sap/ui/test/TestUtils"
], function (MessageBox, Filter, FilterOperator, Controller, TestUtils) {
	"use strict";

	return Controller.extend("sap.ui.core.sample.odata.v4.RecursiveHierarchy.RecursiveHierarchy", {
		async create(sId, oParentContext, bFilteredOut) {
			const oTable = this.byId(sId);
			const oBinding = oParentContext?.getBinding() ?? oTable.getBinding("rows");
			try {
				const oContext = oBinding.create({
					"@$ui5.node.parent" : oParentContext,
					STATUS : bFilteredOut ? "Out" : ""
				}, /*bSkipRefresh*/true);
				await oContext.created();
				this.scrollTo(oContext.getIndex(), oTable, true);
			} catch (oError) {
				MessageBox.error(oError.message);
			}
		},

		onCollapseAll(oEvent) {
			try {
				oEvent.getSource().getBindingContext().collapse(true);
			} catch (oError) {
				MessageBox.error(oError.message);
			}
		},

		onCreate(oEvent, bFilteredOut) {
			const sId = oEvent.getSource().getParent().getParent().getParent().getId();
			this.create(sId, oEvent.getSource().getBindingContext(), bFilteredOut);
		},

		onCreateRoot(_oEvent, bFilteredOut) {
			this.create("table", null, bFilteredOut);
		},

		onCreateRootInTreeTable(_oEvent, bFilteredOut) {
			this.create("treeTable", null, bFilteredOut);
		},

		async onDelete(oEvent) {
			try {
				await oEvent.getSource().getBindingContext().delete();
			} catch (oError) {
				MessageBox.error(oError.message);
			}
		},

		async onExpandAll(oEvent) {
			try {
				await oEvent.getSource().getBindingContext().expand(true);
			} catch (oError) {
				MessageBox.error(oError.message);
			}
		},

		onInit() {
			// initialization has to wait for view model/context propagation
			this.getView().attachEventOnce("modelContextChange", function () {
				const oUriParameters = new URLSearchParams(window.location.search);
				const sExpandTo = TestUtils.retrieveData( // controlled by OPA
						"sap.ui.core.sample.odata.v4.RecursiveHierarchy.expandTo")
					|| oUriParameters.get("expandTo");
				this._oAggregation = {
					expandTo : sExpandTo === "*"
						? Number.MAX_SAFE_INTEGER
						: parseFloat(sExpandTo || "3"), // Note: parseInt("1E16") === 1
					hierarchyQualifier : "OrgChart"
				};
				if (oUriParameters.has("createInPlace")) {
					this._oAggregation.createInPlace = true;
				}
				const sTreeTable = oUriParameters.get("TreeTable");
				const sVisibleRowCount = TestUtils.retrieveData( // controlled by OPA
						"sap.ui.core.sample.odata.v4.RecursiveHierarchy.visibleRowCount")
					|| oUriParameters.get("visibleRowCount");
				const sThreshold = TestUtils.retrieveData( // controlled by OPA
						"sap.ui.core.sample.odata.v4.RecursiveHierarchy.threshold")
					|| oUriParameters.get("threshold") || "0";
				const sFirstVisibleRow = oUriParameters.get("firstVisibleRow") || "0";

				const oTable = this.byId("table");
				if (sTreeTable === "Y") {
					oTable.unbindRows();
					oTable.setVisible(false);
				} else {
					if (sVisibleRowCount) {
						oTable.getRowMode().setRowCount(parseInt(sVisibleRowCount));
					}
					if (sThreshold) {
						oTable.setThreshold(parseInt(sThreshold));
					}
					if (sFirstVisibleRow) {
						oTable.setFirstVisibleRow(parseInt(sFirstVisibleRow));
					}
					const oRowsBinding = oTable.getBinding("rows");
					oRowsBinding.setAggregation(this._oAggregation);
					oRowsBinding.resume();
					oRowsBinding.attachCreateSent(() => {
						oTable.setBusy(true);
					});
					oRowsBinding.attachCreateCompleted(() => {
						oTable.setBusy(false);
					});
					oTable.setModel(oTable.getModel(), "header")
						.setBindingContext(oRowsBinding.getHeaderContext(), "header");
				}

				const oTreeTable = this.byId("treeTable");
				if (sTreeTable === "N") {
					oTreeTable.unbindRows();
					oTreeTable.setVisible(false);
				} else {
					// enable V4 tree table flag
					oTreeTable._oProxy._bEnableV4 = true;
					if (sVisibleRowCount) {
						oTreeTable.getRowMode().setRowCount(parseInt(sVisibleRowCount));
					}
					if (sThreshold) {
						oTreeTable.setThreshold(parseInt(sThreshold));
					}
					if (sFirstVisibleRow) {
						oTreeTable.setFirstVisibleRow(parseInt(sFirstVisibleRow));
					}
					const oTreeRowsBinding = oTreeTable.getBinding("rows");
					oTreeRowsBinding.setAggregation(this._oAggregation);
					oTreeRowsBinding.resume();
					oTreeRowsBinding.attachCreateSent(() => {
						oTreeTable.setBusy(true);
					});
					oTreeRowsBinding.attachCreateCompleted(() => {
						oTreeTable.setBusy(false);
					});
					oTreeTable.setModel(oTreeTable.getModel(), "treeHeader")
						.setBindingContext(oTreeRowsBinding.getHeaderContext(), "treeHeader");
				}

				this.initMessagePopover(sTreeTable === "N" ? "table" : "treeTable");
			}, this);
		},

		async onMakeRoot(oEvent, bLastSibling, bCopy) {
			try {
				this.getView().setBusy(true);
				const oNode = oEvent.getSource().getBindingContext();

				const iCopyIndex = await oNode.move({
					copy : bCopy,
					nextSibling : bLastSibling ? null : undefined,
					parent : null
				});

				if (bCopy) {
					MessageBox.information("Index: " + iCopyIndex, {title : "New Node Created"});
				}
				this.scrollTo(iCopyIndex ?? oNode.getIndex(),
					oEvent.getSource().getParent().getParent().getParent());
			} catch (oError) {
				MessageBox.error(oError.message);
			} finally {
				this.getView().setBusy(false);
			}
		},

		onMove(oEvent, bInTreeTable, vNextSibling, bCopy) {
			this._bInTreeTable = bInTreeTable;
			this._vNextSibling = vNextSibling === "" ? undefined : vNextSibling;
			this._bCopy = bCopy;
			this._oNode = oEvent.getSource().getBindingContext();
			const oSelectDialog = this.byId("moveDialog");
			oSelectDialog.setBindingContext(this._oNode);
			const oListBinding = oSelectDialog.getBinding("items");
			if (oListBinding.isSuspended()) {
				oListBinding.resume();
			} else {
				oListBinding.refresh();
			}
			oSelectDialog.open();
		},

		async onMoveConfirm(oEvent) {
			try {
				this.getView().setBusy(true);
				const sParentId = oEvent.getParameter("selectedItem").getBindingContext()
					.getProperty("ID");
				const oParent = this._oNode.getBinding().getAllCurrentContexts()
					.find((oNode) => oNode.getProperty("ID") === sParentId);
				if (!oParent) {
					throw new Error(`Parent ${sParentId} not yet loaded`);
				}

				let iCopyIndex;
				if (this._vNextSibling === "?") {
					await this._oNode.move({
						nextSibling : oParent,
						parent : oParent.getParent()
					});
				} else {
					iCopyIndex = await this._oNode.move({
						copy : this._bCopy,
						nextSibling : this._vNextSibling,
						parent : oParent
					});

					if (this._bCopy) {
						MessageBox.information("Index: " + iCopyIndex,
							{title : "New Node Created"});
					}
				}

				this.scrollTo(oParent.getIndex(),
					this.byId(this._bInTreeTable ? "treeTable" : "table"), false,
					iCopyIndex ?? this._oNode.getIndex());
			} catch (oError) {
				MessageBox.error(oError.message);
			} finally {
				this.getView().setBusy(false);
			}
		},

		async onMoveDown(oEvent) {
			var oNode;

			try {
				this.getView().setBusy(true);
				oNode = oEvent.getSource().getBindingContext();

				const [oParent, oSibling] = await Promise.all([
					oNode.requestParent(),
					oNode.requestSibling(+1)
				]);

				if (oNode.created()) { // out-of-place, move it to become the 1st child/root
					await oNode.move({nextSibling : oSibling, parent : oParent});
				} else {
					if (!oSibling) {
						MessageBox.information("Cannot move down",
							{title : "Already last sibling"});
						return;
					}

					oNode.setSelected(true); // opt-in to update nextSibling's index
					await oSibling.move({nextSibling : oNode, parent : oParent});
				}

				this.scrollTo(oNode.getIndex(),
					oEvent.getSource().getParent().getParent().getParent(), true);
			} catch (oError) {
				MessageBox.error(oError.message);
			} finally {
				oNode.setSelected(false);
				this.getView().setBusy(false);
			}
		},

		async onMoveUp(oEvent) {
			var oNode;

			try {
				this.getView().setBusy(true);
				oNode = oEvent.getSource().getBindingContext();
				const oTable = oEvent.getSource().getParent().getParent().getParent();
				oNode.setSelected(true); // MUST NOT make any difference here

				const [oParent, oSibling] = await Promise.all([
					oNode.requestParent(),
					oNode.requestSibling(-1)
				]);

				if (!oSibling) {
					if (oParent) {
						this.scrollTo(oParent.getIndex(), oTable);
					}
					MessageBox.information("Cannot move up", {title : "Already first sibling"});
					return;
				}

				await oNode.move({nextSibling : oSibling, parent : oParent});

				// make sure moved node is visible
				this.scrollTo(oNode.getIndex(), oTable);
			} catch (oError) {
				MessageBox.error(oError.message);
			} finally {
				oNode.setSelected(false);
				this.getView().setBusy(false);
			}
		},

		onNameChanged(oEvent) {
			const oContext = oEvent.getSource().getBindingContext();
			if (oContext.hasPendingChanges()) {
				oContext.requestSideEffects(["AGE", "Name"]);
			} // else: invalid value (has not reached model)
		},

		onRefresh(_oEvent, bKeepTreeState) {
			this.refresh("table", bKeepTreeState);
		},

		onRefreshTreeTable(_oEvent, bKeepTreeState) {
			this.refresh("treeTable", bKeepTreeState);
		},

		/**
		 * Filters the list of potential new parents.
		 *
		 * @param {sap.ui.base.Event} oEvent The event object
		 */
		onSearch(oEvent) {
			const sFilterValue = oEvent.getParameter("value");
			const aFilters = sFilterValue
				? [new Filter({
					filters : [
						new Filter("ID", FilterOperator.Contains, sFilterValue),
						new Filter("Name", FilterOperator.Contains, sFilterValue)
					]
				})]
				: [];
			oEvent.getSource().getBinding("items").filter(aFilters);
		},

		async onShowSelected(_oEvent, sTableId = "table") {
			const oListBinding = this.byId(sTableId).getBinding("rows");
			const bSelectAll = oListBinding.getHeaderContext().isSelected();

			const aNames = await Promise.all(
				oListBinding.getAllCurrentContexts()
					.filter((oContext) => oContext.isSelected() !== bSelectAll)
					.map((oContext) => oContext.requestProperty("Name"))
			);

			MessageBox.information((bSelectAll ? "All except " : "") + aNames.join(", "),
				{title : "Selected Names"});
		},

		onSynchronize() {
			this.byId("table").getBinding("rows").getHeaderContext().requestSideEffects(["*"]);
		},

		onSynchronizeTreeTable() {
			this.byId("treeTable").getBinding("rows").getHeaderContext().requestSideEffects(["*"]);
		},

		onToggleExpand(oEvent) {
			// get the context from the button's row
			var oRowContext = oEvent.getSource().getBindingContext();

			if (oRowContext.isExpanded()) {
				oRowContext.collapse();
			} else {
				oRowContext.expand();
			}
		},

		refresh(sId, bKeepTreeState) {
			const oBinding = this.byId(sId).getBinding("rows");
			if (bKeepTreeState) {
				oBinding.getHeaderContext().requestSideEffects([""]);
			} else {
				oBinding.refresh();
			}
		},

		/**
		 * Scrolls the given table to the range indicated by a given top and bottom index. If the
		 * whole range is already visible, nothing happens. If the range does not fit into the
		 * visible row count, the top index is ignored in favor of the bottom index. When the top
		 * of the range is before the visible area, it is aligned at the top. When the bottom of the
		 * range is after the visible area, there is a choice: either the top is aligned at the top
		 * or the bottom is aligned at the bottom.
		 *
		 * @param {number} iIndex - A top index
		 * @param {sap.m.Table|sap.ui.table.Table} oTable - A table
		 * @param {boolean} [bAlignAtBottom] - Whether to prefer alignment at bottom
		 * @param {number} [iBottomIndex] - An optional bottom index (defaults to top)
		 */
		scrollTo(iIndex, oTable, bAlignAtBottom, iBottomIndex = iIndex) {
			const iFirstVisibleRow = oTable.getFirstVisibleRow();
			const iRowCount = oTable.getRowMode().getRowCount();

			function isVisible(i) {
				return i >= iFirstVisibleRow && i < iFirstVisibleRow + iRowCount;
			}

			if (isVisible(iIndex) && isVisible(iBottomIndex)) {
				return;
			}

			if (iBottomIndex - iIndex >= iRowCount - 1) {
				iIndex = iBottomIndex; // cannot show both :-(
			}

			if (iIndex < iFirstVisibleRow) {
				oTable.setFirstVisibleRow(iIndex);
			} else if (iBottomIndex >= iFirstVisibleRow + iRowCount) {
				if (bAlignAtBottom) {
					oTable.setFirstVisibleRow(iBottomIndex - iRowCount + 1);
				} else {
					oTable.setFirstVisibleRow(iIndex);
				}
			} // else: node is already visible
		}
	});
});
