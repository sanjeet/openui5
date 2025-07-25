/*global sinon */

sap.ui.define([
	"./TableQUnitUtils",
	"sap/ui/table/rowmodes/Fixed",
	"sap/ui/model/odata/v4/ODataModel",
	"sap/ui/test/TestUtils",
	"sap/ui/core/sample/odata/v4/RecursiveHierarchy/SandboxModel",
	"sap/ui/core/sample/odata/v4/DataAggregation/SandboxModel",
	"sap/base/util/merge"
], function(
	TableQUnitUtils,
	FixedRowMode,
	ODataModel,
	TestUtils,
	HierarchySandboxModel,
	DataAggregationSandboxModel,
	merge
) {
	"use strict";

	let iCount;
	let oCurrentModel;

	function createData(iStartIndex, iLength) {
		const aData = [];

		if (iStartIndex + iLength > iCount) {
			iLength = iCount - iStartIndex;
		}

		for (let i = iStartIndex; i < iStartIndex + iLength; i++) {
			aData.push({
				ID: i,
				Name: "Test Product (" + i + ")"
			});
		}

		return aData;
	}

	function createResponseMessage(iStartIndex, iLength, iPageSize, iCount) {
		const mResponse = {};
		const bPageLimitReached = iPageSize != null && iPageSize > 0 && iLength > iPageSize;

		if (bPageLimitReached) {
			const sSkipTop = "$skip=" + iStartIndex + "&$top=" + iLength;
			const sSkipToken = "&$skiptoken=" + iPageSize;
			mResponse.value = createData(iStartIndex, iPageSize);
			mResponse["@odata.nextLink"] = "http://localhost:8088/MyServiceWithPaging/Products?" + sSkipTop + sSkipToken;
		} else {
			mResponse.value = createData(iStartIndex, iLength);
		}

		if (iCount != null) {
			mResponse["@odata.count"] = iCount;
		}

		return mResponse;
	}

	function setupODataV4Server() {
		const oSandbox = sinon.sandbox.create();

		TestUtils.setupODataV4Server(oSandbox, {}, null, null, [{
			regExp: /^GET \/MyService(WithPaging)?\/\$metadata$/,
			response: {
				source: "metadata_tea_busi_product.xml"
			}
		}, {
			regExp: /^GET \/MyService(WithPaging)?\/Products\?(\$count=true&)?\$skip=(\d+)\&\$top=(\d+)$/,
			response: {
				buildResponse: function(aMatches, oResponse) {
					const iPageSize = aMatches[1] ? 50 : 0;
					const bWithCount = !!aMatches[2];
					const iSkip = parseInt(aMatches[3]);
					const iTop = parseInt(aMatches[4]);
					const mResponseMessage = createResponseMessage(iSkip, iTop, iPageSize, bWithCount ? iCount : undefined);

					oResponse.message = JSON.stringify(mResponseMessage);
				}
			}
		}, {
			regExp: /^GET \/MyService\/Products\?(\$count=true&)?\$filter=Name%20eq%20'DoesNotExist'/,
			response: {
				buildResponse: function(aMatches, oResponse) {
					const bWithCount = !!aMatches[1];
					const mResponseMessage = createResponseMessage(0, 0, undefined, bWithCount ? 0 : undefined);

					oResponse.message = JSON.stringify(mResponseMessage);
				}
			}
		}, {
			regExp: /^GET \/MyService\/Products\?(\$count=true&)?\$filter=Name%20eq%20'Test%20Product%20\(1\)'/,
			response: {
				buildResponse: function(aMatches, oResponse) {
					const bWithCount = !!aMatches[1];
					const mResponseMessage = createResponseMessage(1, 1, undefined, bWithCount ? 1 : undefined);

					oResponse.message = JSON.stringify(mResponseMessage);
				}
			}
		}]);

		return oSandbox;
	}

	const TableQUnitUtilsODataV4 = Object.assign({}, TableQUnitUtils);

	/**
	 * Creates an ODataModel for a service that provides list data.
	 *
	 * Data structure (entities and their properties):
	 *
	 * - Products
	 *   - Name
	 *
	 * @param {object} mOptions Configuration options
	 * @param {boolean} [mOptions.paging=false] Whether to enable service-side paging
	 * @param {int} [mOptions.count=400] The number of entries the service returns
	 * @param {object} [mOptions.modelParameters] Parameters that are passed to the model constructor
	 * @returns {sap.ui.model.odata.v4.ODataModel} The created ODataModel
	 */
	TableQUnitUtilsODataV4.createModelForList = function(mOptions) {
		mOptions = {
			paging: false,
			count: 400,
			...mOptions
		};
		iCount = mOptions.count;
		oCurrentModel?.destroy();

		const oSandbox = setupODataV4Server();

		oCurrentModel = new ODataModel({
			serviceUrl: mOptions.paging ? "/MyServiceWithPaging/" : "/MyService/",
			...mOptions.modelParameters
		});

		oCurrentModel.destroy = function() {
			oSandbox.restore();
			oCurrentModel = null;
			return ODataModel.prototype.destroy.apply(this, arguments);
		};

		return oCurrentModel;
	};

	/**
	 * Creates the default settings for a table with list data. The settings include the rows binding info, column instances, the ODataV4 model
	 * instance, and further settings that are required to generate requests for which mock data is available.
	 *
	 * The binding is initially suspended and should be resumed after the table is created.
	 *
	 * @param {object} [mOptions] Configuration options
	 * @param {boolean} [mOptions.paging=false] Whether to enable service-side paging
	 * @param {int} [mOptions.count=400] The number of entries the service returns
	 * @param {object} [mOptions.modelParameters] Parameters that are passed to the model constructor
	 * @param {boolean} [mOptions.suspended=false] Whether the binding should be suspended initially
	 * @param {object} [mOptions.tableSettings] Table settings to be merged with the default settings
	 * @returns {object} The default settings for the table
	 */
	TableQUnitUtilsODataV4.createSettingsForList = function(mOptions = {}) {
		return merge({
			rows: {
				path: "/Products",
				parameters: {
					$count: true
				},
				suspended: mOptions.suspended === true
			},
			columns: [
				TableQUnitUtils.createTextColumn({label: "Name", text: "Name", bind: true})
			],
			models: this.createModelForList(mOptions)
		}, mOptions.tableSettings);
	};

	/**
	 * Creates the default settings for a table with hierarchical data. The settings include the rows binding info, column instances, the ODataV4
	 * model instance, and further settings that are required to generate requests for which mock data is available.
	 *
	 * The binding is initially suspended and should be resumed after the table is created.
	 *
	 * @param {object} [mTableSettings] Table settings to be merged with the default settings
	 * @returns {object} The default settings for the table
	 */
	TableQUnitUtilsODataV4.createSettingsForHierarchy = function(mTableSettings) {
		oCurrentModel?.restoreSandbox?.();
		oCurrentModel?.destroy();
		oCurrentModel = new HierarchySandboxModel({
			serviceUrl: "/sap/opu/odata4/IWBEP/TEA/default/IWBEP/TEA_BUSI/0001/",
			autoExpandSelect: true
		});

		return merge({
			rows: {
				path: "/EMPLOYEES",
				parameters: {
					$count: false,
					$orderby: "AGE",
					$$aggregation: {
						hierarchyQualifier: "OrgChart",
						expandTo: 3
					}
				},
				suspended: true
			},
			columns: [
				TableQUnitUtils.createTextColumn({label: "ID", text: "ID", bind: true}),
				TableQUnitUtils.createTextColumn({label: "Name", text: "Name", bind: true}),
				TableQUnitUtils.createTextColumn({label: "Age", text: "AGE", bind: true}),
				TableQUnitUtils.createTextColumn({label: "Manager's ID", text: "MANAGER_ID", bind: true})
			],
			models: oCurrentModel
		}, mTableSettings);
	};

	/**
	 * Creates the default settings for a table with aggregated data. The settings include the rows binding info, column instances, the ODataV4 model
	 * instance, and further settings that are required to generate requests for which mock data is available.
	 *
	 * The binding is initially suspended and should be resumed after the table is created.
	 *
	 * @param {object} [mTableSettings] Table settings to be merged with the default settings
	 * @returns {object} The default settings for the table
	 */
	TableQUnitUtilsODataV4.createSettingsForDataAggregation = function(mTableSettings) {
		oCurrentModel?.restoreSandbox?.();
		oCurrentModel?.destroy();
		oCurrentModel = new DataAggregationSandboxModel({
			serviceUrl: "/odata/v4/sap.fe.managepartners.ManagePartnersService/"
		});

		return merge({
			rows: {
				path: "/BusinessPartners",
				parameters: {
					$count: false,
					$orderby: "Country desc,Region desc,Segment,AccountResponsible",
					$$aggregation: {
						aggregate: {
							SalesAmountLocalCurrency: {
								grandTotal: true,
								subtotals: true,
								unit: "LocalCurrency"
							},
							SalesNumber: {}
						},
						group: {
							AccountResponsible: {},
							Country_Code: {additionally: ["Country"]}
						},
						groupLevels: ["Country_Code", "Region", "Segment"],
						grandTotalAtBottomOnly: false,
						subtotalsAtBottomOnly: false
					}
				},
				suspended: true
			},
			columns: [
				TableQUnitUtils.createTextColumn({label: "Country", text: "Country", bind: true}),
				TableQUnitUtils.createTextColumn({label: "Region", text: "Region", bind: true}),
				TableQUnitUtils.createTextColumn({label: "Local Currency", text: "LocalCurrency", bind: true})
			],
			rowMode: new FixedRowMode({
				rowCount: 5
			}),
			threshold: 0,
			models: oCurrentModel
		}, mTableSettings);
	};

	TableQUnitUtilsODataV4.expandAndScrollTableWithDataAggregation = async function(oTable) {
		const aRows = oTable.getRows();

		await aRows[3].getBindingContext().expand();
		await oTable.qunit.whenRenderingFinished();
		oTable.setFirstVisibleRow(6);
		await oTable.qunit.whenBindingChange();
		await oTable.qunit.whenRenderingFinished();
		await aRows[4].getBindingContext().expand();
		await oTable.qunit.whenRenderingFinished();
		oTable.setFirstVisibleRow(9);
		await oTable.qunit.whenRenderingFinished();
		await aRows[4].getBindingContext().expand();
		await oTable.qunit.whenRenderingFinished();
		oTable.setFirstVisibleRow(12);
		await oTable.qunit.whenRenderingFinished();
	};

	return TableQUnitUtilsODataV4;
});