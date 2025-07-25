/*!
 * ${copyright}
 */
// The SandboxModel is used in the manifest instead of OData V4 model for the following purposes:
// Certain constructor parameters are taken from URL parameters. For the "non-realOData" case, a
// mock server for the back-end requests is set up.
sap.ui.define([
	"sap/ui/core/sample/common/SandboxModelHelper",
	"sap/ui/model/odata/v4/ODataModel"
], function (SandboxModelHelper, ODataModel) {
	"use strict";

	// Note: DO NOT reuse the same source file with a different $top if that leads to a short read!
	var oMockData = {
			sFilterBase : "/analytics/",
			mFixture : {
				"/analytics/Travels?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,CustomerName,Description,EndDate,TotalPrice,TravelID,TravelUUID&$expand=TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Booking($count=true;$top=0)&$skip=0&$top=110" : {
					source : "Travels.json"
				}
			},
			sSourceBase : "sap/ui/core/sample/odata/v4/Travel_CAP/data"
		};

	function SandboxModel(mParameters) {
		return SandboxModelHelper.adaptModelParametersAndCreateModel(mParameters, oMockData);
	}
	SandboxModel.getMetadata = ODataModel.getMetadata;

	return SandboxModel;
});
