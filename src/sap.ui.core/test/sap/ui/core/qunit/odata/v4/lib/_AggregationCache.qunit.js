/*!
 * ${copyright}
 */
sap.ui.define([
	"sap/base/Log",
	"sap/ui/base/SyncPromise",
	"sap/ui/model/odata/ODataUtils",
	"sap/ui/model/odata/v4/lib/_AggregationCache",
	"sap/ui/model/odata/v4/lib/_AggregationHelper",
	"sap/ui/model/odata/v4/lib/_Cache",
	"sap/ui/model/odata/v4/lib/_ConcatHelper",
	"sap/ui/model/odata/v4/lib/_GroupLock",
	"sap/ui/model/odata/v4/lib/_Helper",
	"sap/ui/model/odata/v4/lib/_MinMaxHelper",
	"sap/ui/model/odata/v4/lib/_TreeState"
], function (Log, SyncPromise, ODataUtils, _AggregationCache, _AggregationHelper, _Cache,
		_ConcatHelper, _GroupLock, _Helper, _MinMaxHelper, _TreeState) {
	/*eslint no-sparse-arrays: 0 */
	"use strict";

	/**
	 * Copies the given elements from a cache read into <code>this.aElements</code>.
	 *
	 * @param {object|object[]} aReadElements
	 *   The elements from a cache read, or just a single one
	 * @param {number} iOffset
	 *   The offset within aElements
	 *
	 * @private
	 */
	function addElements(aReadElements, iOffset) {
		var aElements = this.aElements;

		if (!Array.isArray(aReadElements)) {
			aReadElements = [aReadElements];
		}
		aReadElements.forEach(function (oElement, i) {
			var sPredicate = _Helper.getPrivateAnnotation(oElement, "predicate");

			// for simplicity, avoid most sanity checks of _AggregationCache#addElements
			if (iOffset + i >= aElements.length) {
				throw new Error("Array index out of bounds: " + (iOffset + i));
			}
			aElements[iOffset + i] = oElement;
			if (sPredicate) { // Note: sometimes, even $byPredicate is missing...
				aElements.$byPredicate[sPredicate] = oElement;
			}
		});
	}

	/**
	 * Returns a promise which resolves just when the given elements have been copied into the given
	 * aggregation cache.
	 *
	 * @param {sap.ui.model.odata.v4.lib._AggregationCache} oCache
	 *   The cache
	 * @param {object|object[]} aReadElements
	 *   The elements from a cache read, or just a single one
	 * @param {number} iOffset
	 *   The offset within aElements
	 * @returns {sap.ui.base.SyncPromise}
	 *   An async promise for timing
	 *
	 * @private
	 * @see addElements
	 */
	function addElementsLater(oCache, aReadElements, iOffset) {
		return SyncPromise.resolve(Promise.resolve()).then(function () {
			// so that oCache.aElements is actually filled
			addElements.call(oCache, aReadElements, iOffset);
		});
	}

	function mustBeMocked() { throw new Error("Must be mocked"); }

	//*********************************************************************************************
	QUnit.module("sap.ui.model.odata.v4.lib._AggregationCache", {
		beforeEach : function () {
			this.oLogMock = this.mock(Log);
			this.oLogMock.expects("warning").never();
			this.oLogMock.expects("error").never();

			this.oRequestor = {
				buildQueryString : function () { return ""; },
				getServiceUrl : function () { return "/~/"; },
				getUnlockedAutoCopy : mustBeMocked,
				request : mustBeMocked
			};

			// avoid trouble when creating 1st level cache, or with #getDownloadUrl's callback
			// to #getDownloadQueryOptions calling this
			this.mock(_AggregationHelper).expects("buildApply4Hierarchy").atLeast(0).returns({});
		}
	});

	//*********************************************************************************************
[
	{},
	{$$filterBeforeAggregate : "foo", $apply : "bar"}
].forEach(function (mQueryOptions, i) {
	QUnit.test("create: no aggregation #" + i, function (assert) {
		var mAggregate = {},
			oAggregation = i
				? {
					aggregate : mAggregate,
					group : {},
					groupLevels : []
				}
				: null, // improves code coverage
			sQueryOptions = JSON.stringify(mQueryOptions);

		this.mock(_AggregationHelper).expects("hasGrandTotal").exactly(i ? 1 : 0)
			.withExactArgs(sinon.match.same(mAggregate)).returns(false);
		this.mock(_AggregationHelper).expects("hasMinOrMax").exactly(i ? 1 : 0)
			.withExactArgs(sinon.match.same(mAggregate)).returns(false);
		this.mock(_MinMaxHelper).expects("createCache").never();
		this.mock(_Cache).expects("create")
			.withExactArgs("~requestor~", "resource/path", i ? {$apply : "filter(foo)/bar"} : {},
				"~sortExpandSelect~", "deep/resource/path", "~sharedRequest~")
			.returns("~cache~");

		assert.strictEqual(
			// code under test
			_AggregationCache.create("~requestor~", "resource/path", "deep/resource/path",
				mQueryOptions, oAggregation, "~sortExpandSelect~", "~sharedRequest~",
				/*bIsGrouped*/"n/a"),
			"~cache~");

		assert.strictEqual(JSON.stringify(mQueryOptions), sQueryOptions, "unchanged");
	});
});

	//*********************************************************************************************
	QUnit.test("create: no aggregation? no $$filterOnAggregate!", function (assert) {
		this.mock(_AggregationHelper).expects("hasGrandTotal").never();
		this.mock(_AggregationHelper).expects("hasMinOrMax").never();
		this.mock(_MinMaxHelper).expects("createCache").never();
		this.mock(_Cache).expects("create").never();
		const mQueryOptions = {
			$$filterOnAggregate : "" // even falsy values not allowed...
		};

		assert.throws(function () {
			// code under test
			_AggregationCache.create("~requestor~", "resource/path", "deep/resource/path",
				mQueryOptions, /*oAggregation*/null, "~sortExpandSelect~", "~sharedRequest~",
				/*bIsGrouped*/"n/a");
		}, new Error("Unsupported $$filterOnAggregate"));
	});

	//*********************************************************************************************
	/** @deprecated As of version 1.89.0 */
	QUnit.test("create: $filter w/ grandTotal like 1.84", function (assert) {
		const oAggregation = { // filled before by buildApply
			aggregate : {
				y : {
					grandTotal : true
				}
			},
			"grandTotal like 1.84" : true,
			group : {
				a : {}
			},
			groupLevels : []
		};

		// code under test
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "",
			{$filter : "answer eq 42"}, oAggregation);

		assert.ok(oCache instanceof _AggregationCache, "module value is c'tor function");
	});

	//*********************************************************************************************
	QUnit.test("create: min/max", function (assert) {
		var oAggregation = {
				aggregate : {},
				group : {},
				// Note: ODLB#updateAnalyticalInfo called _AggregationHelper.buildApply
				groupLevels : []
			},
			mQueryOptions = {};

		this.mock(_AggregationHelper).expects("hasGrandTotal")
			.withExactArgs(sinon.match.same(oAggregation.aggregate)).returns(false);
		this.mock(_AggregationHelper).expects("hasMinOrMax")
			.withExactArgs(sinon.match.same(oAggregation.aggregate)).returns(true);
		this.mock(_MinMaxHelper).expects("createCache")
			.withExactArgs("~requestor~", "resource/path", sinon.match.same(oAggregation),
				sinon.match.same(mQueryOptions))
			.returns("~cache~");
		this.mock(_Cache).expects("create").never();

		assert.strictEqual(
			// code under test
			_AggregationCache.create("~requestor~", "resource/path", "", mQueryOptions,
				oAggregation),
			"~cache~");
	});

	//*********************************************************************************************
[{
	groupLevels : ["BillToParty"],
	hasGrandTotal : false,
	hasMinOrMax : false
}, {
	hasGrandTotal : false,
	hasMinOrMax : true
}, {
	hasGrandTotal : true,
	hasMinOrMax : false
}].forEach(function (oFixture, i) {
	["$expand", "$select"].forEach(function (sName) {
	QUnit.test("create: " + sName + " not allowed #" + i, function (assert) {
		var oAggregation = {
				aggregate : {},
				group : {},
				groupLevels : oFixture.groupLevels || []
			},
			mQueryOptions = {};

		mQueryOptions[sName] = undefined; // even falsy values are forbidden!

		this.mock(_AggregationHelper).expects("hasGrandTotal")
			.withExactArgs(sinon.match.same(oAggregation.aggregate))
			.returns(oFixture.hasGrandTotal);
		this.mock(_AggregationHelper).expects("hasMinOrMax")
			.withExactArgs(sinon.match.same(oAggregation.aggregate)).returns(oFixture.hasMinOrMax);
		this.mock(_MinMaxHelper).expects("createCache").never();
		this.mock(_Cache).expects("create").never();

		assert.throws(function () {
			// code under test
			_AggregationCache.create(this.oRequestor, "Foo", "", mQueryOptions, oAggregation);
		}, new Error("Unsupported system query option: " + sName));
	});
	});
});

	//*********************************************************************************************
[{
	groupLevels : ["BillToParty"],
	hasMinOrMax : true,
	message : "Unsupported group levels together with min/max"
}, {
	hasGrandTotal : true,
	hasMinOrMax : true,
	message : "Unsupported grand totals together with min/max"
}, {
	oAggregation : {
		hierarchyQualifier : "X"
	},
	hasMinOrMax : true,
	message : "Unsupported recursive hierarchy together with min/max"
}, {
	hasMinOrMax : true,
	message : "Unsupported $$sharedRequest together with min/max",
	bSharedRequest : true
}, {
	groupLevels : ["BillToParty"],
	message : "Unsupported system query option: $filter",
	queryOptions : {$filter : "answer eq 42"}
}, {
	hasGrandTotal : true,
	message : "Unsupported system query option: $filter",
	queryOptions : {$filter : "answer eq 42"}
}, {
	hasGrandTotal : true,
	message : "Unsupported system query option: $search",
	queryOptions : {$search : "blue OR green"}
}, {
	groupLevels : ["BillToParty"],
	message : "Unsupported system query option: $search",
	queryOptions : {$search : "blue OR green"}
}, {
	oAggregation : {
		hierarchyQualifier : "X"
	},
	message : "Unsupported system query option: $search",
	queryOptions : {$search : "blue OR green"}
}, {
	oAggregation : {
		hierarchyQualifier : "X"
	},
	bIsGrouped : true,
	message : "Unsupported grouping via sorter"
}, {
	hasGrandTotal : true,
	message : "Unsupported $$sharedRequest",
	bSharedRequest : true
}, {
	groupLevels : ["BillToParty"],
	message : "Unsupported $$sharedRequest",
	bSharedRequest : true
}, {
	oAggregation : {
		hierarchyQualifier : "X"
	},
	message : "Unsupported $$sharedRequest",
	bSharedRequest : true
}].forEach(function (oFixture) {
	QUnit.test("create: " + oFixture.message, function (assert) {
		var oAggregation = oFixture.oAggregation || {
				aggregate : {},
				group : {},
				groupLevels : oFixture.groupLevels || []
			},
			mQueryOptions = oFixture.queryOptions || {};

		this.mock(_AggregationHelper).expects("hasGrandTotal")
			.withExactArgs(sinon.match.same(oAggregation.aggregate))
			.returns(oFixture.hasGrandTotal);
		this.mock(_AggregationHelper).expects("hasMinOrMax")
			.withExactArgs(sinon.match.same(oAggregation.aggregate)).returns(oFixture.hasMinOrMax);
		this.mock(_MinMaxHelper).expects("createCache").never();
		this.mock(_Cache).expects("create").never();

		assert.throws(function () {
			// code under test
			_AggregationCache.create(this.oRequestor, "Foo", "", mQueryOptions, oAggregation,
				false, oFixture.bSharedRequest, oFixture.bIsGrouped);
		}, new Error(oFixture.message));
	});
});

	//*********************************************************************************************
	QUnit.test("create: grand total handling", function (assert) {
		const oEnhanceCacheWithGrandTotalExpectation = this.mock(_ConcatHelper)
			.expects("enhanceCache")
			.withExactArgs(sinon.match.object, sinon.match.object, [
				/*fnGrandTotal*/sinon.match.func,
				/*fnCount*/sinon.match.func
			]);
		const oAggregation = { // filled before by buildApply
			aggregate : {
				x : {grandTotal : true}
			},
			group : {
				a : {}
			},
			groupLevels : []
		};
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {
			$count : true // Note: no leaf count because of missing group levels!
		}, oAggregation);
		this.mock(oCache).expects("readCount").never();
		this.mock(oCache).expects("readFirst").never();
		this.mock(oCache).expects("readGap").never();

		[undefined, 1, 2, 3, 100, Infinity].forEach(function (iPrefetchLength) {
			assert.throws(function () {
				// code under test
				// (read grand total row separately, but with iPrefetchLength !== 0)
				oCache.read(0, 1, iPrefetchLength);
			}, new Error("Unsupported prefetch length: " + iPrefetchLength));
		});

		// code under test (read grand total row separately)
		const oReadPromise = oCache.read(0, 1, 0, _GroupLock.$cached);

		assert.strictEqual(oReadPromise.isPending(), true);

		this.mock(_AggregationHelper).expects("handleGrandTotal")
			.withExactArgs(sinon.match.same(oAggregation), "~oGrandTotal~");

		// code under test (fnGrandTotal)
		oEnhanceCacheWithGrandTotalExpectation.args[0][2][0]("~oGrandTotal~");

		assert.strictEqual(oReadPromise.isPending(), true, "still async...");

		return oReadPromise.then(function (oReadResult) {
			assert.deepEqual(oReadResult, {value : ["~oGrandTotal~"]});
			assert.strictEqual(oReadResult.value[0], "~oGrandTotal~");
			assert.notOk("$count" in oReadResult.value, "$count not available here");

			// no internal state changes!
			assert.deepEqual(oCache.aElements, []);
			assert.deepEqual(oCache.aElements.$byPredicate, {});
			assert.ok("$count" in oCache.aElements);
			assert.strictEqual(oCache.aElements.$count, undefined);
			assert.strictEqual(oCache.aElements.$created, 0);
		});
	});

	//*********************************************************************************************
[{ // grand total
	aggregate : {
		SalesNumber : {grandTotal : true}
	},
	group : {},
	groupLevels : []
}, { // group levels
	aggregate : {},
	group : {},
	groupLevels : ["group"]
}, { // recursive hierarchy
	hierarchyQualifier : "X"
}].forEach(function (oAggregation, i) {
	QUnit.test("create: #" + i, function (assert) {
		var oCache,
			oDoResetExpectation,
			bHasGrandTotal = i === 0,
			// Note: $expand/$select and $filter only allowed for recursive hierarchy
			mQueryOptions = oAggregation.hierarchyQualifier ? {
				$expand : {
					EMPLOYEE_2_TEAM : {$select : ["Team_Id", "Name"]}
				},
				$filter : "allowed",
				$select : ["ID", "MANAGER_ID"]
			} : {
				$filter : "" // needs to be falsy
			};

		this.mock(_AggregationHelper).expects("hasGrandTotal")
			.withExactArgs(sinon.match.same(oAggregation.aggregate)).returns(bHasGrandTotal);
		this.mock(_AggregationHelper).expects("hasMinOrMax")
			.withExactArgs(sinon.match.same(oAggregation.aggregate))
			.returns(false);
		this.mock(_MinMaxHelper).expects("createCache").never();
		this.mock(_Cache).expects("create").never();
		oDoResetExpectation = this.mock(_AggregationCache.prototype).expects("doReset")
			.withExactArgs(sinon.match.same(oAggregation), bHasGrandTotal)
			.callsFake(function () {
				this.oFirstLevel = {
					addKeptElement : "~addKeptElement~",
					removeKeptElement : "~removeKeptElement~",
					requestSideEffects : "~requestSideEffects~"
				};
				if (i === 2) {
					oAggregation.$NodeProperty = "node/property";
				}
			});

		// code under test
		oCache = _AggregationCache.create(this.oRequestor, "resource/path", "~n/a~", mQueryOptions,
			oAggregation);

		// "super" call
		assert.ok(oCache instanceof _AggregationCache, "module value is c'tor function");
		assert.ok(oCache instanceof _Cache, "_AggregationCache is a _Cache");
		assert.strictEqual(oCache.addTransientCollection, null, "disinherit");
		assert.strictEqual(oCache.oRequestor, this.oRequestor);
		assert.strictEqual(oCache.sResourcePath, "resource/path");
		assert.strictEqual(oCache.mQueryOptions, mQueryOptions);
		assert.strictEqual(oCache.bSortExpandSelect, true);
		assert.strictEqual(typeof oCache.fetchValue, "function");
		assert.strictEqual(typeof oCache.read, "function");
		// c'tor itself
		assert.ok(oDoResetExpectation.alwaysCalledOn(oCache));
		assert.deepEqual(oCache.aElements, []);
		assert.deepEqual(oCache.aElements.$byPredicate, {});
		assert.ok("$count" in oCache.aElements);
		assert.strictEqual(oCache.aElements.$count, undefined);
		assert.strictEqual(oCache.aElements.$created, 0);
		assert.strictEqual(oCache.addKeptElement, "~addKeptElement~", "@borrows ...");
		assert.strictEqual(oCache.removeKeptElement, "~removeKeptElement~", "@borrows ...");
		assert.strictEqual(oCache.requestSideEffects, "~requestSideEffects~", "@borrows ...");
		assert.strictEqual(oCache.isDeletingInOtherGroup(), false); // <-- code under test
		assert.ok(oCache.oTreeState instanceof _TreeState);
		assert.strictEqual(oCache.oTreeState.sNodeProperty, i === 2 ? "node/property" : undefined);
		assert.strictEqual(oCache.bUnifiedCache, false);

		this.mock(oCache).expects("getTypes").withExactArgs().returns("~types~");
		this.mock(_Helper).expects("getKeyFilter")
			.withExactArgs("~node~", "/resource/path", "~types~").returns("~filter~");

		// code under test: callback function provided for _TreeState c'tor
		assert.strictEqual(oCache.oTreeState.fnGetKeyFilter("~node~"), "~filter~");
	});
});

	//*********************************************************************************************
	// Using PICT /r:4848
	//
	// sFilterBeforeAggregate: "", "~filterBeforeAggregate~"
	// # the following parameter is ignored below
	// sFilteredOrderBy: "", "~filteredOrderBy~"
	// bHasGrandTotal:   false, true
	// bLeaf:            false, true
	// oParentGroupNode: undefined, {}
	// bSubtotals:       false, true
	// IF [bLeaf] = "true" THEN [bSubtotals] = "false";
	// IF [oParentGroupNode] = "undefined" THEN [bLeaf] = "false";
	// IF [oParentGroupNode] = "{}" THEN [bHasGrandTotal] = "false";
[{
	sFilterBeforeAggregate : "",
	bHasGrandTotal : true,
	bLeaf : false,
	oParentGroupNode : undefined,
	bSubtotals : false
}, {
	sFilterBeforeAggregate : "",
	bHasGrandTotal : false,
	bLeaf : false,
	oParentGroupNode : {},
	bSubtotals : true
}, {
	sFilterBeforeAggregate : "",
	bHasGrandTotal : false,
	bLeaf : true,
	oParentGroupNode : {},
	bSubtotals : false
}, {
	sFilterBeforeAggregate : "~filterBeforeAggregate~",
	bHasGrandTotal : false,
	bLeaf : false,
	oParentGroupNode : undefined,
	bSubtotals : true
}, {
	sFilterBeforeAggregate : "~filterBeforeAggregate~",
	bHasGrandTotal : false,
	bLeaf : true,
	oParentGroupNode : {},
	bSubtotals : false
}, {
	sFilterBeforeAggregate : "~filterBeforeAggregate~",
	bHasGrandTotal : true,
	bLeaf : false,
	oParentGroupNode : undefined,
	bSubtotals : true
}].forEach(function (oPICT) {
	QUnit.test("createGroupLevelCache: " + JSON.stringify(oPICT), function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {
					x : {
						subtotals : oPICT.bSubtotals
					},
					y : {
						grandTotal : oPICT.bHasGrandTotal,
						unit : "UnitY"
					}
				},
				group : {
					c : {}, // intentionally out of ABC order
					a : {},
					b : {}
				},
				groupLevels : ["a", "b"]
			},
			oAggregationCache,
			aAllProperties = [],
			oCache = {},
			mCacheQueryOptions = {},
			aGroupBy = ["a"],
			iLevel = oPICT.oParentGroupNode ? 3 : 1,
			mQueryOptions = {
				$$filterBeforeAggregate : oPICT.sFilterBeforeAggregate
				// $orderby : "~orderby~"
			};

		function isOK(o) {
			if (oPICT.oParentGroupNode) {
				return o.$$filterBeforeAggregate === (oPICT.sFilterBeforeAggregate
					? "~filter~ and (~filterBeforeAggregate~)"
					: "~filter~");
			}

			return o.$$filterBeforeAggregate === oPICT.sFilterBeforeAggregate;
		}

		if (!oPICT.bHasGrandTotal) {
			mQueryOptions.$count = "n/a";
		}
		if (oPICT.oParentGroupNode) {
			aGroupBy = ["a", "b", "c"];
			oPICT.oParentGroupNode["@$ui5.node.level"] = 2;
			_Helper.setPrivateAnnotation(oPICT.oParentGroupNode, "filter", "~filter~");
		}
		if (oPICT.bLeaf) {
			// Note: duplicates do not hurt for key predicate, but order is important
			aGroupBy = [/*group levels:*/"a", "b", /*sorted:*/"a", "b", "c"];
		} else if (iLevel === 3) {
			oAggregation.groupLevels.push("c");
			oAggregation.groupLevels.push("d"); // leaf level (JIRA: CPOUI5ODATAV4-2755)
		}

		oAggregationCache = _AggregationCache.create(this.oRequestor, "Foo", "",
			{/*$orderby : "~orderby~"*/}, oAggregation);

		this.mock(_AggregationHelper).expects("getAllProperties")
			.withExactArgs(sinon.match.same(oAggregation)).returns(aAllProperties);
		this.mock(_AggregationHelper).expects("filterOrderby")
			.withExactArgs(sinon.match.same(oAggregationCache.mQueryOptions),
				sinon.match.same(oAggregation), iLevel)
			.returns(mQueryOptions);
		if (oPICT.bHasGrandTotal) {
			this.mock(_AggregationHelper).expects("buildApply").never();
		} else {
			this.mock(_AggregationHelper).expects("buildApply")
				.withExactArgs(sinon.match.same(oAggregation), sinon.match(function (o) {
						return !("$count" in o) && o === mQueryOptions && isOK(o);
					}), iLevel)
				.returns(mCacheQueryOptions);
		}
		this.mock(_Cache).expects("create")
			.withExactArgs(sinon.match.same(oAggregationCache.oRequestor), "Foo",
				sinon.match(function (o) {
					// Note: w/o grand total, buildApply determines the query options to be used!
					return o.$count
						&& (oPICT.bHasGrandTotal
							? o === mQueryOptions && isOK(o)
							: o === mCacheQueryOptions);
				}), true)
			.returns(oCache);

		// This must be done before calling createGroupLevelCache, so that bind grabs the mock
		this.mock(_AggregationCache).expects("calculateKeyPredicate").on(null)
			.withExactArgs(sinon.match.same(oPICT.oParentGroupNode), aGroupBy,
				sinon.match.same(aAllProperties), oPICT.bLeaf, oPICT.bSubtotals,
				"~oElement~", "~mTypeForMetaPath~", "~metapath~")
			.returns("~sPredicate~");
		this.mock(_AggregationCache).expects("calculateKeyPredicateRH").never();
		this.mock(_AggregationCache).expects("fixDuplicatePredicate").on(oCache)
			.withExactArgs("~oElement~", "~sPredicate~").returns("~fixedPredicate~");

		assert.strictEqual(
			// code under test
			oAggregationCache.createGroupLevelCache(oPICT.oParentGroupNode, oPICT.bHasGrandTotal),
			oCache
		);

		// code under test (this normally happens inside the created cache's handleResponse method)
		assert.strictEqual(
			oCache.calculateKeyPredicate("~oElement~", "~mTypeForMetaPath~", "~metapath~"),
			"~sPredicate~");

		// code under test: non-hierarchy uses _AggregationCache implementation
		assert.strictEqual(
			oCache.fixDuplicatePredicate("~oElement~", "~sPredicate~"),
			"~fixedPredicate~");

		if (oPICT.oParentGroupNode) {
			assert.strictEqual(oCache.$parentFilter, "~filter~");
		} else {
			assert.notOk("$parentFilter" in oCache);
		}
	});
});

	//*********************************************************************************************
[undefined, {}].forEach(function (oParentGroupNode, i) {
	QUnit.test("createGroupLevelCache: recursive hierarchy, #" + i, function (assert) {
		var oAggregation = {hierarchyQualifier : "X"},
			oCache = {},
			mCacheQueryOptions = {},
			iLevel = oParentGroupNode ? 3 : 1,
			mQueryOptions = {
				$expand : "~expand~",
				// $orderby : "~orderby~"
				$select : ["~select~"]
			},
			oAggregationCache
				= _AggregationCache.create(this.oRequestor, "Foo", "", mQueryOptions, oAggregation);

		if (oParentGroupNode) {
			oParentGroupNode["@$ui5.node.level"] = 2;
			this.mock(_Helper).expects("getPrivateAnnotation")
				.withExactArgs(sinon.match.same(oParentGroupNode), "filter").returns(undefined);
			this.mock(oAggregationCache).expects("getTypes").withExactArgs().returns("~getTypes~");
			this.mock(_Helper).expects("getKeyFilter")
				.withExactArgs(sinon.match.same(oParentGroupNode), "/Foo", "~getTypes~")
				.returns("~filter~");
		}
		this.mock(_AggregationHelper).expects("getAllProperties").never();
		this.mock(_AggregationHelper).expects("filterOrderby").never();
		this.mock(_AggregationHelper).expects("buildApply").withExactArgs(
				sinon.match.same(oAggregation),
				sinon.match(mQueryOptions).and(sinon.match(function (o) {
					return /*!("$count" in o) &&*/ o !== mQueryOptions && (oParentGroupNode
						? o.$$filterBeforeAggregate === "~filter~"
						: !("$$filterBeforeAggregate" in o));
				})),
				iLevel) // actually, we currently do not care about this level for RH...
			.returns(mCacheQueryOptions);
		this.mock(_Cache).expects("create")
			.withExactArgs(sinon.match.same(oAggregationCache.oRequestor), "Foo",
				sinon.match(function (o) {
					// Note: w/o grand total, buildApply determines the query options to be used!
					return o.$count && o === mCacheQueryOptions;
				}), true)
			.returns(oCache);
		// This must be done before calling createGroupLevelCache, so that bind grabs the mock
		this.mock(_AggregationCache).expects("calculateKeyPredicate").never();
		this.mock(_AggregationCache).expects("calculateKeyPredicateRH").on(null)
			.withExactArgs(sinon.match.same(oParentGroupNode), sinon.match.same(oAggregation),
				"~oElement~", "~mTypeForMetaPath~", "~metapath~")
			.returns("~sPredicate~");

		assert.strictEqual(
			// code under test
			oAggregationCache.createGroupLevelCache(oParentGroupNode, false),
			oCache
		);

		// code under test (this normally happens inside the created cache's handleResponse method)
		assert.strictEqual(
			oCache.calculateKeyPredicate("~oElement~", "~mTypeForMetaPath~", "~metapath~"),
			"~sPredicate~");

		assert.notOk("fixDuplicatePredicate" in oCache); // no override for hierarchy
		if (oParentGroupNode) {
			assert.strictEqual(oCache.$parentFilter, "~filter~");
		} else {
			assert.notOk("$parentFilter" in oCache);
		}
	});
});

	//*********************************************************************************************
[{ // only oGrandTotalPromise needed
	aggregate : {
		SalesNumber : {grandTotal : true}
	},
	group : {},
	groupLevels : []
}, { // only oCountPromise needed
	hierarchyQualifier : "X"
}, { // only oCountPromise needed
	aggregate : {},
	group : {},
	groupLevels : ["group"]
}, { // both oCountPromise and oGrandTotalPromise needed
	aggregate : {
		SalesNumber : {grandTotal : true}
	},
	group : {},
	groupLevels : ["group"]
}].forEach(function (oNewAggregation, i) {
	[false, true].forEach(function (bCount) {
		const sTitle = "doReset: #" + i + ", bCount=" + bCount;
		const bCountLeaves = bCount && oNewAggregation.groupLevels?.length > 0;
		const bHasGrandTotal = !!oNewAggregation.aggregate?.SalesNumber?.grandTotal;

	QUnit.test(sTitle, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, {
			hierarchyQualifier : "n/a" // unrealistic for i !== 1, but never mind
		});
		oCache.oCountPromise = "~oOldCountPromise~";
		this.mock(oCache).expects("getDownloadUrl").withExactArgs("").returns("~sDownloadUrl~");
		this.mock(oCache).expects("createCountPromise").exactly(bCount && i === 1 ? 1 : 0)
			.withExactArgs()
			.callsFake(function () {
				assert.strictEqual(oCache.oCountPromise, "~oOldCountPromise~");
				oCache.oCountPromise = "~oNewCountPromise~";
			});
		this.mock(oCache).expects("setQueryOptions").exactly(bCount && i > 1 ? 1 : 0)
			.withExactArgs({$count : true, $$leaves : true});
		this.mock(oCache).expects("createGroupLevelCache")
			.withExactArgs(null, bHasGrandTotal || bCountLeaves)
			.returns("~oFirstLevelCache~");
		let fnLeaves;
		let fnGrandTotal;
		this.mock(_ConcatHelper).expects("enhanceCache")
			.exactly(bHasGrandTotal || bCountLeaves ? 1 : 0)
			.withExactArgs("~oFirstLevelCache~", sinon.match.same(oNewAggregation),
				sinon.match((aAdditionalRowHandlers) => {
					let iIndex = 0;
					if (bCountLeaves) {
						fnLeaves = aAdditionalRowHandlers[iIndex];
						iIndex += 1;
					}
					if (bHasGrandTotal) {
						fnGrandTotal = aAdditionalRowHandlers[iIndex];
						iIndex += 1;
					}

					// code under test (fnCount) - nothing should happen :-)
					aAdditionalRowHandlers[iIndex]({});
					iIndex += 1;

					return aAdditionalRowHandlers.length === iIndex;
				}));
		const mQueryOptions = {
			$count : bCount
		};
		oCache.mQueryOptions = mQueryOptions;

		// code under test
		oCache.doReset(oNewAggregation, bHasGrandTotal);

		assert.strictEqual(oCache.oAggregation, oNewAggregation);
		assert.strictEqual(oCache.sToString, "~sDownloadUrl~");
		assert.strictEqual(oCache.toString(), "~sDownloadUrl~"); // <-- code under test
		assert.strictEqual(oCache.oFirstLevel, "~oFirstLevelCache~");
		assert.ok("oCountPromise" in oCache, "be nice to V8");
		assert.ok("oGrandTotalPromise" in oCache, "be nice to V8");

		if (bCount && i > 1) { // 0: no count needed, 1: recursive hierarchy uses createCountPromise
			assert.ok(oCache.oCountPromise.isPending());

			// code under test
			assert.strictEqual(oCache.fetchValue(null, "$count"), oCache.oCountPromise);

			// code under test
			fnLeaves({UI5__leaves : "42"});

			assert.ok(oCache.oCountPromise.isFulfilled());
			assert.strictEqual(oCache.oCountPromise.getResult(), 42);
		} else if (bCount && i === 1) {
			assert.strictEqual(oCache.oCountPromise, "~oNewCountPromise~");
		} else {
			assert.strictEqual(oCache.oCountPromise, undefined);
		}

		if (bHasGrandTotal) {
			assert.strictEqual(oCache.oGrandTotalPromise.isPending(), true);

			this.mock(_AggregationHelper).expects("handleGrandTotal")
				.withExactArgs(sinon.match.same(oNewAggregation), "~oGrandTotal~");

			// code under test
			fnGrandTotal("~oGrandTotal~");

			assert.strictEqual(oCache.oGrandTotalPromise.isFulfilled(), true);
			assert.strictEqual(oCache.oGrandTotalPromise.getResult(), "~oGrandTotal~");
		} else {
			assert.strictEqual(oCache.oGrandTotalPromise, undefined);
		}

		assert.deepEqual(mQueryOptions, {$count : bCount}, "unchanged");
	});
	});
});

	//*********************************************************************************************
[false, true].forEach(function (bLeaf) {
	[false, true].forEach(function (bParent) {
		[false, true].forEach(function (bHasRealKeyPredicate) {
			var sTitle = "calculateKeyPredicate: leaf=" + bLeaf
					+ ", has real key predicate: " + bHasRealKeyPredicate
					+ ", parent=" + bParent;

			if (bHasRealKeyPredicate && !bLeaf) {
				return; // ignore useless combination
			}

	QUnit.test(sTitle, function (assert) {
		var aAllProperties = ["p1", "p2", ["a", "b"], "p3", "p4", ["c", "d"]],
			oElement = {
				p2 : "v2",
				p4 : "v4"
			},
			oElementMatcher = sinon.match(function (o) {
				return o === oElement && (bParent
					? o.p1 === "v1" && o.p2 === "v2" && o.p3 === "v3" && o.p4 === "v4"
						&& o["p3@$ui5.noData"] === true
					: !("p1" in o) && o.p2 === "v2" && !("p3" in o) && o.p4 === "v4"
						&& !("p3@$ui5.noData" in o));
			}),
			aGroupBy = [/*does not matter*/],
			oGroupNode = {
				p1 : "v1",
				p2 : "n/a",
				p3 : "v3",
				"p3@$ui5.noData" : "true", // truthy, but not true
				"@$ui5.node.level" : 2
			},
			oHelperMock = this.mock(_Helper),
			mTypeForMetaPath = {"/meta/path" : {}};

		oHelperMock.expects("inheritPathValue").exactly(bParent ? 1 : 0)
			.withExactArgs(["a", "b"], sinon.match.same(oGroupNode), sinon.match.same(oElement));
		oHelperMock.expects("inheritPathValue").exactly(bParent ? 1 : 0)
			.withExactArgs(["c", "d"], sinon.match.same(oGroupNode), sinon.match.same(oElement));
		oHelperMock.expects("getKeyPredicate").exactly(bLeaf ? 1 : 0)
			.withExactArgs(oElementMatcher, "/meta/path", sinon.match.same(mTypeForMetaPath))
			.returns(bHasRealKeyPredicate ? "~predicate~" : undefined);
		oHelperMock.expects("getKeyPredicate").exactly(bHasRealKeyPredicate ? 0 : 1)
			.withExactArgs(oElementMatcher, "/meta/path", sinon.match.same(mTypeForMetaPath),
				sinon.match.same(aGroupBy), true).returns("~predicate~");
		oHelperMock.expects("setPrivateAnnotation")
			.withExactArgs(sinon.match.same(oElement), "predicate", "~predicate~");
		oHelperMock.expects("getKeyFilter").exactly(bLeaf ? 0 : 1)
			.withExactArgs(oElementMatcher, "/meta/path", sinon.match.same(mTypeForMetaPath),
				sinon.match.same(aGroupBy))
			.returns("~filter~");
		oHelperMock.expects("setPrivateAnnotation").exactly(bLeaf ? 0 : 1)
			.withExactArgs(sinon.match.same(oElement), "filter", "~filter~");
		this.mock(_AggregationHelper).expects("setAnnotations")
			.withExactArgs(sinon.match.same(oElement), bLeaf ? undefined : false, "~bTotal~",
				bParent ? 3 : 1, bParent ? null : aAllProperties);

		assert.strictEqual(
			// code under test
			_AggregationCache.calculateKeyPredicate(bParent ? oGroupNode : undefined, aGroupBy,
				aAllProperties, bLeaf, "~bTotal~", oElement, mTypeForMetaPath, "/meta/path"),
			"~predicate~");

		assert.deepEqual(oElement, bParent ? {
			p1 : "v1",
			p2 : "v2",
			p3 : "v3",
			"p3@$ui5.noData" : true,
			p4 : "v4"
		} : {
			p2 : "v2",
			p4 : "v4"
		});
	});
		});
	});
});

	//*********************************************************************************************
[undefined, 0, 7].forEach(function (iDistanceFromRoot) {
	// Note: null means no $LimitedDescendantCount, undefined means not $select'ed
	[null, undefined, 0, 42].forEach(function (iLimitedDescendantCount) {
		["collapsed", "expanded", "leaf"].forEach(function (sDrillState) {
			[undefined, {"@$ui5.node.level" : 41}].forEach(function (oGroupNode) {
				var sTitle = "calculateKeyPredicateRH: DistanceFromRoot : " + iDistanceFromRoot
						+ ", LimitedDescendantCount : " + iLimitedDescendantCount
						+ ", DrillState : " + sDrillState
						+ ", oGroupNode : " + JSON.stringify(oGroupNode);

				if (iDistanceFromRoot === undefined && iLimitedDescendantCount
						|| iDistanceFromRoot !== undefined && oGroupNode
						|| sDrillState === "expanded" && !iLimitedDescendantCount
						|| sDrillState === "leaf" && iLimitedDescendantCount) {
					return;
				}

	QUnit.test(sTitle, function (assert) {
		var oAggregation = {
				$DistanceFromRoot : "A/DistFromRoot",
				$DrillState : "B/myDrillState",
				$LimitedDescendantCount : "C/LtdDescendant_Count",
				$metaPath : "/meta/path",
				$path : "n/a"
			},
			sDistanceFromRoot,
			oElement = {
				// B: {myDrillState : sDrillState},
				Foo : "bar",
				XYZ : 42
			},
			iExpectedLevel = 1,
			oHelperMock = this.mock(_Helper),
			bIsExpanded = {
				collapsed : false,
				expanded : true,
				leaf : undefined
			}[sDrillState],
			sLimitedDescendantCount,
			mTypeForMetaPath = {"/meta/path" : {}};

		if (iDistanceFromRoot !== undefined) {
			iExpectedLevel = iDistanceFromRoot + 1;
			sDistanceFromRoot = "" + iDistanceFromRoot; // Edm.Int64!
			// oElement.A = {DistFromRoot : sDistanceFromRoot};
		}
		if (iLimitedDescendantCount === null) {
			delete oAggregation.$LimitedDescendantCount;
		} else {
			sLimitedDescendantCount = iLimitedDescendantCount === undefined
				? undefined
				: "" + iLimitedDescendantCount; // Edm.Int64!
			// oElement.C = {LtdDescendant_Count : sLimitedDescendantCount};
		}
		if (oGroupNode) {
			iExpectedLevel = 42;
		}

		oHelperMock.expects("getKeyPredicate")
			.withExactArgs(sinon.match.same(oElement), "/meta/path",
				sinon.match.same(mTypeForMetaPath))
			.returns("~predicate~");
		oHelperMock.expects("setPrivateAnnotation")
			.withExactArgs(sinon.match.same(oElement), "predicate", "~predicate~");
		oHelperMock.expects("drillDown")
			.withExactArgs(sinon.match.same(oElement), "B/myDrillState")
			.returns(sDrillState);
		oHelperMock.expects("getKeyFilter").never();
		oHelperMock.expects("deleteProperty")
			.withExactArgs(sinon.match.same(oElement), "B/myDrillState");
		oHelperMock.expects("drillDown").exactly(oGroupNode ? 0 : 1)
			.withExactArgs(sinon.match.same(oElement), "A/DistFromRoot")
			.returns(sDistanceFromRoot);
		oHelperMock.expects("deleteProperty").exactly(sDistanceFromRoot ? 1 : 0)
			.withExactArgs(sinon.match.same(oElement), "A/DistFromRoot");
		this.mock(_AggregationHelper).expects("setAnnotations")
			.withExactArgs(sinon.match.same(oElement), bIsExpanded, /*bIsTotal*/undefined,
				iExpectedLevel);
		oHelperMock.expects("setPrivateAnnotation").exactly(iLimitedDescendantCount ? 1 : 0)
			.withExactArgs(sinon.match.same(oElement), "descendants",
				/*parseInt!*/iLimitedDescendantCount);
		oHelperMock.expects("drillDown").exactly(iLimitedDescendantCount === null ? 0 : 1)
			.withExactArgs(sinon.match.same(oElement), "C/LtdDescendant_Count")
			.returns(sLimitedDescendantCount);
		oHelperMock.expects("deleteProperty").exactly(sLimitedDescendantCount ? 1 : 0)
			.withExactArgs(sinon.match.same(oElement), "C/LtdDescendant_Count");

		assert.strictEqual(
			// code under test
			_AggregationCache.calculateKeyPredicateRH(oGroupNode, oAggregation, oElement,
				mTypeForMetaPath, "/meta/path"),
			"~predicate~");

		assert.deepEqual(oElement, {Foo : "bar", XYZ : 42});
	});
			});
		});
	});
});

	//*********************************************************************************************
	QUnit.test("calculateKeyPredicate: nested object", function (assert) {
		var mTypeForMetaPath = {"/Artists" : {}};

		this.mock(_Helper).expects("inheritPathValue").never();
		this.mock(_Helper).expects("getKeyPredicate").never();
		this.mock(_Helper).expects("setPrivateAnnotation").never();
		this.mock(_Helper).expects("getKeyFilter").never();
		this.mock(_AggregationHelper).expects("setAnnotations").never();

		assert.strictEqual(
			// code under test
			_AggregationCache.calculateKeyPredicate(null, null, null, undefined, undefined, null,
				mTypeForMetaPath, "/Artists/BestFriend"),
			undefined);
	});

	//*********************************************************************************************
	QUnit.test("calculateKeyPredicateRH: nested object", function (assert) {
		var mTypeForMetaPath = {"/Artists" : {}};

		this.mock(_Helper).expects("drillDown").never();
		this.mock(_Helper).expects("getKeyPredicate").never();
		this.mock(_Helper).expects("setPrivateAnnotation").never();
		this.mock(_Helper).expects("getKeyFilter").never();
		this.mock(_Helper).expects("deleteProperty").never();
		this.mock(_AggregationHelper).expects("setAnnotations").never();

		assert.strictEqual(
			// code under test
			_AggregationCache.calculateKeyPredicateRH(/*oGroupNode*/null, {/*oAggregation*/},
				/*oElement*/null, mTypeForMetaPath, "/Artists/BestFriend"),
			undefined);
	});

	//*********************************************************************************************
	QUnit.test("calculateKeyPredicateRH: related entity", function (assert) {
		var oAggregation = {
				$DistanceFromRoot : "DistFromRoot",
				$DrillState : "myDrillState",
				$LimitedDescendantCount : "LtdDescendant_Count",
				$metaPath : "/Artists",
				$path : "n/a"
			},
			oElement = {
				DistFromRoot : "23",
				myDrillState : "leaf",
				LtdDescendant_Count : "42"
			},
			mTypeForMetaPath = {
				"/Artists" : {},
				"/Artists/BestFriend" : {}
			};

		this.mock(_Helper).expects("drillDown").never();
		this.mock(_Helper).expects("getKeyPredicate")
			.withExactArgs(sinon.match.same(oElement), "/Artists/BestFriend",
				sinon.match.same(mTypeForMetaPath))
			.returns("~predicate~");
		this.mock(_Helper).expects("setPrivateAnnotation")
			.withExactArgs(sinon.match.same(oElement), "predicate", "~predicate~");
		this.mock(_Helper).expects("getKeyFilter").never();
		this.mock(_Helper).expects("deleteProperty").never();
		this.mock(_AggregationHelper).expects("setAnnotations").never();

		assert.strictEqual(
			// code under test
			_AggregationCache.calculateKeyPredicateRH(/*oGroupNode*/null, oAggregation,
				oElement, mTypeForMetaPath, "/Artists/BestFriend"),
			"~predicate~");

		assert.deepEqual(oElement, {
				DistFromRoot : "23",
				myDrillState : "leaf",
				LtdDescendant_Count : "42"
			}, "unchanged");
	});

	//*********************************************************************************************
[false, true].forEach(function (bParentIsPlaceholder) {
	[false, true].forEach(function (bCandidateFound) {
		const sTitle = "fetchParentIndex: parent is placeholder = " + bParentIsPlaceholder
				+ ", candidate outside collection found = " + bCandidateFound;

		if (bCandidateFound && !bParentIsPlaceholder) {
			return; // parent is either inside or outside collection
		}

	QUnit.test(sTitle, async function (assert) {
		const oAggregation = {
			$DistanceFromRoot : "DistFromRoot",
			$DrillState : "myDrillState",
			$LimitedDescendantCount : "LtdDescendant_Count",
			$NodeProperty : "NodeID",
			$path : "/path",
			aggregate : {},
			group : {},
			groupLevels : ["BillToParty"],
			hierarchyQualifier : "X"
		};
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, oAggregation);
		const sQueryOptions = JSON.stringify(oCache.mQueryOptions);
		this.mock(oCache).expects("getTypes").atLeast(1).withExactArgs().returns("~Types~");
		const oNode = {"@$ui5.node.level" : 3};
		oCache.aElements[20] = {"@$ui5.node.level" : 0};
		oCache.aElements[21] = {"@$ui5.node.level" : 4};
		oCache.aElements[22] = {"@$ui5.node.level" : 4};
		oCache.aElements[23] = oNode;
		oCache.aElements[24] = {"@$ui5.node.level" : 4};
		oCache.aElements[25] = {"@$ui5.node.level" : 5};
		oCache.aElements[26] = {"@$ui5.node.level" : 3};
		const oHelperMock = this.mock(_Helper);
		oHelperMock.expects("getKeyFilter").withExactArgs(oNode, "/Foo", "~Types~")
			.returns("~Key~");
		this.mock(this.oRequestor).expects("buildQueryString")
			.withExactArgs(null, {$apply : "ancestors($root/path,X,NodeID,filter(~Key~),1)"})
			.returns("?~QueryString~");
		this.mock(this.oRequestor).expects("request")
			.withExactArgs("GET", "Foo?~QueryString~", "~oGroupLock~")
			.callsFake(async () => {
				var oPropertiesExpectation, oNodePropertyExpectation;

				await "next tick";

				oHelperMock.expects("getKeyPredicate")
					.withExactArgs("~Parent~", "/Foo", "~Types~")
					.returns("('n/a')");
				if (bCandidateFound) { // parent already in cache
					oCache.aElements.$byPredicate["('n/a')"] = "~ParentOutsideCollection~";
				}
				oHelperMock.expects("getPrivateAnnotation").exactly(bCandidateFound ? 1 : 0)
					.withExactArgs("~ParentOutsideCollection~", "rank")
					.returns(undefined);
				oHelperMock.expects("setPrivateAnnotation")
					.withExactArgs("~Parent~", "parent", sinon.match.same(oCache.oFirstLevel));
				this.mock(oCache).expects("requestRank")
					.withExactArgs("~Parent~", "~oGroupLock~")
					.callsFake(async () => {
						await "next tick";

						assert.ok(oPropertiesExpectation.called, "called in sync");
						assert.ok(oNodePropertyExpectation.called, "called in sync");

						oCache.aElements[17] = "~ParentInsideCollection~";
						this.mock(oCache.oFirstLevel).expects("calculateKeyPredicate")
							.withExactArgs("~Parent~", "~Types~", "/Foo");
						this.mock(oCache).expects("findIndex").withExactArgs("~iRank~")
							.returns(17);
						oHelperMock.expects("hasPrivateAnnotation")
							.withExactArgs("~ParentInsideCollection~", "placeholder")
							.returns(bParentIsPlaceholder);
						this.mock(oCache).expects("insertNode")
							.exactly(bParentIsPlaceholder ? 1 : 0)
							.withExactArgs("~Parent~", "~iRank~", 17);

						return "~iRank~";
					});
				oPropertiesExpectation = this.mock(oCache).expects("requestProperties")
					.withExactArgs("~Parent~", ["DistFromRoot", "myDrillState",
						"LtdDescendant_Count"], "~oGroupLock~", true)
					.resolves();
				oNodePropertyExpectation = this.mock(oCache).expects("requestNodeProperty")
					.withExactArgs("~Parent~", "~oGroupLock~", false)
					.resolves();

				return {value : ["~Parent~"]};
			});

		// code under test
		const oPromise = oCache.fetchParentIndex(26, "~oGroupLock~");
		const oPromise0 = oCache.fetchParentIndex(23, "~oGroupLock~");
		const oPromise1 = oCache.fetchParentIndex(26, "~oGroupLock~");
		const oPromise2 = oCache.fetchParentIndex(23, "~oGroupLock~");

		assert.strictEqual(_Helper.getPrivateAnnotation(oNode, "parentIndexPromise"), oPromise,
			"cached");
		assert.strictEqual(oPromise, oPromise0, "same promise");
		assert.strictEqual(oPromise, oPromise1, "same promise");
		assert.strictEqual(oPromise, oPromise2, "same promise");
		assert.ok(oPromise instanceof SyncPromise);
		assert.strictEqual(await oPromise, 17);
		assert.strictEqual(JSON.stringify(oCache.mQueryOptions), sQueryOptions, "unchanged");
		oHelperMock.restore();
		assert.notOk(_Helper.hasPrivateAnnotation(oNode, "parentIndexPromise"), "gone");
	});
	});
});

	//*********************************************************************************************
	QUnit.test("fetchParentIndex: parent already inside collection", async function (assert) {
		const oAggregation = {
			$DistanceFromRoot : "DistFromRoot",
			$DrillState : "myDrillState",
			$LimitedDescendantCount : "LtdDescendant_Count",
			$NodeProperty : "NodeID",
			$path : "/path",
			aggregate : {},
			group : {},
			groupLevels : ["BillToParty"],
			hierarchyQualifier : "X"
		};
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, oAggregation);
		const sQueryOptions = JSON.stringify(oCache.mQueryOptions);

		this.mock(oCache).expects("getTypes").atLeast(1).withExactArgs().returns("~Types~");
		const oNode = {};
		oCache.aElements[22] = {"@$ui5.node.level" : 0};
		oCache.aElements[23] = oNode;
		this.mock(_Helper).expects("getKeyFilter").withExactArgs(oNode, "/Foo", "~Types~")
			.returns("~Key~");
		this.mock(this.oRequestor).expects("buildQueryString")
			.withExactArgs(null, {$apply : "ancestors($root/path,X,NodeID,filter(~Key~),1)"})
			.returns("?~QueryString~");
		this.mock(this.oRequestor).expects("request")
			.withExactArgs("GET", "Foo?~QueryString~", "~oGroupLock~")
			.callsFake(async () => {
				await "next tick";

				oCache.aElements.$byPredicate["('42')"] = "~ParentInCache~";
				this.mock(_Helper).expects("getKeyPredicate")
					.withExactArgs("~Parent~", "/Foo", "~Types~")
					.returns("('42')");
				this.mock(_Helper).expects("getPrivateAnnotation")
					.withExactArgs("~ParentInCache~", "rank")
					.returns(0); // anything but undefined
				oCache.aElements[42] = "~ParentInCache~";
				this.mock(oCache).expects("requestRank").never();

				return {value : ["~Parent~"]};
			});

		// code under test
		const oPromise = oCache.fetchParentIndex(23, "~oGroupLock~");

		assert.strictEqual(_Helper.getPrivateAnnotation(oNode, "parentIndexPromise"), oPromise,
			"cached");
		assert.ok(oPromise instanceof SyncPromise);
		assert.strictEqual(await oPromise, 42);
		assert.strictEqual(JSON.stringify(oCache.mQueryOptions), sQueryOptions, "unchanged");
		assert.notOk(_Helper.hasPrivateAnnotation(oNode, "parentIndexPromise"), "gone");
	});

	//*********************************************************************************************
	QUnit.test("fetchParentIndex: clean up on failed request", async function (assert) {
		const oAggregation = {
			$DistanceFromRoot : "DistFromRoot",
			$DrillState : "myDrillState",
			$LimitedDescendantCount : "LtdDescendant_Count",
			$NodeProperty : "NodeID",
			$path : "/path",
			aggregate : {},
			group : {},
			groupLevels : ["BillToParty"],
			hierarchyQualifier : "X"
		};
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, oAggregation);
		const sQueryOptions = JSON.stringify(oCache.mQueryOptions);

		this.mock(oCache).expects("getTypes").withExactArgs().returns("~Types~");
		const oNode = {};
		oCache.aElements[22] = {"@$ui5.node.level" : 0};
		oCache.aElements[23] = oNode;
		this.mock(_Helper).expects("getKeyFilter").withExactArgs(oNode, "/Foo", "~Types~")
			.returns("~Key~");
		this.mock(this.oRequestor).expects("buildQueryString")
			.withExactArgs(null, {$apply : "ancestors($root/path,X,NodeID,filter(~Key~),1)"})
			.returns("?~QueryString~");
		const oError = new Error();
		this.mock(this.oRequestor).expects("request")
			.withExactArgs("GET", "Foo?~QueryString~", "~oGroupLock~")
			.rejects(oError);

		// code under test
		const oPromise = oCache.fetchParentIndex(23, "~oGroupLock~");

		assert.strictEqual(_Helper.getPrivateAnnotation(oNode, "parentIndexPromise"), oPromise,
			"cached");
		assert.ok(oPromise instanceof SyncPromise);
		await assert.rejects(oPromise, oError);
		assert.strictEqual(JSON.stringify(oCache.mQueryOptions), sQueryOptions, "unchanged");
		assert.notOk(_Helper.hasPrivateAnnotation(oNode, "parentIndexPromise"), "gone");
	});

	//*********************************************************************************************
[false, true].forEach(function (bAsync) {
	QUnit.test("fetchValue: not $count; async = " + bAsync, function (assert) {
		var oAggregation = {
				aggregate : {},
				group : {},
				groupLevels : ["BillToParty"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, oAggregation),
			oCacheMock = this.mock(oCache),
			sPath = "~predicate~/~path~",
			oPromise = bAsync
				? Promise.resolve(function (resolve) {
					setTimeout(function () {
						resolve();
					}, 5);
				})
				: SyncPromise.resolve(),
			oResult;

		if (bAsync) {
			oCache.aElements.$byPredicate["~predicate~"] = oPromise;
		}
		oCacheMock.expects("registerChangeListener").never();
		oCacheMock.expects("drillDown").never();
		oPromise.then(function () { // must not be called too early!
			oCacheMock.expects("registerChangeListener").withExactArgs(sPath, "~oListener~");
			oCacheMock.expects("drillDown")
				.withExactArgs(sinon.match.same(oCache.aElements), sPath, "~oGroupLock~")
				.returns(SyncPromise.resolve("~result~"));
		});

		// code under test
		oResult = oCache.fetchValue("~oGroupLock~", sPath, "~fnDataRequested~", "~oListener~");

		assert.strictEqual(oResult.isPending(), bAsync);

		return oResult.then(function (vResult) {
			assert.strictEqual(vResult, "~result~");
		});
	});
});

	//*********************************************************************************************
	QUnit.test("fetchValue: no leaf $count available with recursive hierarchy", function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X"
			},
			oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, oAggregation);

		this.mock(oCache.oFirstLevel).expects("fetchValue").never();
		this.mock(oCache).expects("registerChangeListener").never();
		this.mock(oCache).expects("drillDown").never();
		this.oLogMock.expects("error")
			.withExactArgs("Failed to drill-down into $count, invalid segment: $count",
				oCache.toString(), "sap.ui.model.odata.v4.lib._Cache");

		assert.strictEqual(
			// code under test
			oCache.fetchValue("~oGroupLock~", "$count", "~fnDataRequested~", "~oListener~"),
			SyncPromise.resolve());
	});

	//*********************************************************************************************
	QUnit.test("fetchValue: no leaf $count available with visual grouping", function (assert) {
		var oAggregation = {
				aggregate : {},
				group : {},
				// Note: a single group level would define the leaf level (JIRA: CPOUI5ODATAV4-2755)
				groupLevels : ["a", "b"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, oAggregation);

		this.mock(oCache.oFirstLevel).expects("fetchValue").never();
		this.mock(oCache).expects("registerChangeListener").never();
		this.mock(oCache).expects("drillDown").never();
		this.oLogMock.expects("error")
			.withExactArgs("Failed to drill-down into $count, invalid segment: $count",
				oCache.toString(), "sap.ui.model.odata.v4.lib._Cache");

		assert.strictEqual(
			// code under test
			oCache.fetchValue("~oGroupLock~", "$count", "~fnDataRequested~", "~oListener~"),
			SyncPromise.resolve());
	});

	//*********************************************************************************************
	QUnit.test("fetchValue: leaf $count available without visual grouping", function (assert) {
		var oAggregation = {
				aggregate : {
					SalesNumber : {grandTotal : true}
				},
				group : {},
				groupLevels : [] // Note: added by _AggregationHelper.buildApply before
			},
			oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {$count : true},
				oAggregation);

		this.mock(oCache.oFirstLevel).expects("fetchValue")
			.withExactArgs("~oGroupLock~", "$count", "~fnDataRequested~", "~oListener~")
			.returns("~promise~");
		this.mock(oCache).expects("registerChangeListener").never();
		this.mock(oCache).expects("drillDown").never();

		assert.strictEqual(
			// code under test
			oCache.fetchValue("~oGroupLock~", "$count", "~fnDataRequested~", "~oListener~"),
			"~promise~");
	});

	//*********************************************************************************************
[{
	oPromise : SyncPromise.resolve("~result~"),
	vValue : "~result~"
}, {
	oPromise : new SyncPromise(function () {}), // not (yet) resolved
	vValue : undefined
}].forEach(function (oFixture, i) {
	QUnit.test("getValue: " + i, function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X"
			},
			oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, oAggregation);

		this.mock(oCache).expects("fetchValue")
			.withExactArgs(sinon.match.same(_GroupLock.$cached), "some/path")
			.returns(oFixture.oPromise);
		this.mock(oFixture.oPromise).expects("caught").withExactArgs().exactly(i);

		// code under test
		assert.strictEqual(oCache.getValue("some/path"), oFixture.vValue);
	});
});

	//*********************************************************************************************
	QUnit.test("getQueryOptions4Single: non-empty path", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		this.mock(_Cache.prototype).expects("getQueryOptions4Single").never();
		this.mock(_Helper).expects("clone").never();

		assert.throws(function () {
			// code under test
			oCache.getQueryOptions4Single("some/path");
		}, new Error("Unsupported path: some/path"));
	});

	//*********************************************************************************************
[false, true].forEach((bLate) => {
	[false, true].forEach((bFound) => {
		const sTitle = "getQueryOptions4Single: late query options = " + bLate
			+ ", node property found in $select = " + bFound;

	QUnit.test(sTitle, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X",
			$NodeProperty : "Some/NodeID"
		});
		if (bLate) {
			oCache.mLateQueryOptions = "~mLateQueryOptions~";
		}
		this.mock(_Cache.prototype).expects("getQueryOptions4Single").never();
		const mClone = {
			$select : bFound ? ["alpha", "Some/NodeID", "omega"] : ["alpha", "omega"]
		};
		this.mock(_Helper).expects("clone")
			.withExactArgs(bLate ? "~mLateQueryOptions~" : sinon.match.same(oCache.mQueryOptions))
			.returns(mClone);

		// code under test
		const mQueryOptions = oCache.getQueryOptions4Single("");

		assert.strictEqual(mQueryOptions, mClone);
		assert.deepEqual(mQueryOptions, {
			$select : ["alpha", "omega"]
		});
	});
	});
});

	//*********************************************************************************************
[{
	iIndex : 0,
	iLength : 3,
	bHasGrandTotal : false,
	iFirstLevelIndex : 0,
	iFirstLevelLength : 3
}, {
	iIndex : 0,
	iLength : 3,
	bHasGrandTotal : true,
	iFirstLevelIndex : 0,
	iFirstLevelLength : 2
}, {
	iIndex : 0,
	iLength : 3,
	bHasGrandTotal : true,
	grandTotalAtBottomOnly : false,
	iFirstLevelIndex : 0,
	iFirstLevelLength : 2
}, {
	iIndex : 0,
	iLength : 1,
	bHasGrandTotal : true,
	grandTotalAtBottomOnly : true,
	iFirstLevelIndex : 0,
	iFirstLevelLength : 1
}, {
	iIndex : 10,
	iLength : 3,
	bHasGrandTotal : false,
	iFirstLevelIndex : 10,
	iFirstLevelLength : 3
}, {
	iIndex : 10,
	iLength : 3,
	bHasGrandTotal : true,
	iFirstLevelIndex : 9,
	iFirstLevelLength : 3
}, {
	iIndex : 10,
	iLength : 3,
	bHasGrandTotal : true,
	grandTotalAtBottomOnly : false,
	iFirstLevelIndex : 9,
	iFirstLevelLength : 3
}, {
	iIndex : 10,
	iLength : 3,
	bHasGrandTotal : true,
	grandTotalAtBottomOnly : true,
	iFirstLevelIndex : 10,
	iFirstLevelLength : 3
}, {
	iIndex : 1,
	iLength : 41,
	bHasGrandTotal : true,
	iFirstLevelIndex : 0,
	iFirstLevelLength : 41
}].forEach(function (oFixture, i) {
	QUnit.test("read: 1st time, #" + i, function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {
					SalesNumber : {grandTotal : oFixture.bHasGrandTotal}
				},
				group : {},
				groupLevels : ["group"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			iIndex = oFixture.iIndex,
			iLength = oFixture.iLength,
			iPrefetchLength = 100,
			that = this;

		function checkResult(oResult) {
			assert.strictEqual(oResult.value.length, iLength);
			assert.strictEqual(oResult.value.$count, 42);
			for (let j = 0; j < iLength; j += 1) {
				assert.strictEqual(oResult.value[j], "element#" + (oFixture.iIndex + j));
			}
		}

		if ("grandTotalAtBottomOnly" in oFixture) {
			oAggregation.grandTotalAtBottomOnly = oFixture.grandTotalAtBottomOnly;
		}
		if (oFixture.bHasGrandTotal) {
			oCache.oGrandTotalPromise = new SyncPromise(function () {});
		}
		this.mock(oCache).expects("readCount").withExactArgs("~oGroupLock~");
		this.mock(oCache).expects("readFirst")
			.withExactArgs(oFixture.iFirstLevelIndex, oFixture.iFirstLevelLength, iPrefetchLength,
				"~oGroupLock~", "~fnDataRequested~")
			.callsFake(function () {
				return SyncPromise.resolve(Promise.resolve()).then(function () {
					oCache.aElements.$count = 42;
					for (i = 0; i < 42; i += 1) {
						oCache.aElements[i] = "element#" + i;
					}
				});
			});

		// code under test
		return oCache.read(iIndex, iLength, iPrefetchLength, "~oGroupLock~", "~fnDataRequested~")
			.then(function (oResult) {
				var oGroupLock = {
						unlock : function () {}
					};

				assert.strictEqual(oCache.iReadLength, iLength + iPrefetchLength);

				checkResult(oResult);

				that.mock(oGroupLock).expects("unlock").withExactArgs();

				// code under test
				return oCache
					.read(iIndex, iLength, iPrefetchLength, oGroupLock, "~fnDataRequested~")
					.then(checkResult);
			});
	});
});

	//*********************************************************************************************
	QUnit.test("read: 1st time, readCount fails", function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X"
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oError = new Error();

		this.mock(oCache).expects("readCount").withExactArgs("~oGroupLock~")
			.rejects(oError);
		this.mock(oCache).expects("readFirst"); // don't care about more details here

		// code under test
		return oCache.read(0, 10, 0, "~oGroupLock~").then(function () {
			assert.ok(false);
		}, function (oResult) {
			assert.strictEqual(oResult, oError);
		});
	});

	//*********************************************************************************************
[undefined, {}].forEach(function (oCountPromise, i) {
	QUnit.test("readCount: nothing to do #" + i, function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X"
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oGroupLock = {
				getUnlockedCopy : function () {}
			};

		oCache.oCountPromise = oCountPromise;
		this.mock(oGroupLock).expects("getUnlockedCopy").never();
		this.mock(this.oRequestor).expects("request").never();

		// code under test
		assert.strictEqual(oCache.readCount(oGroupLock), undefined);
	});
});

	//*********************************************************************************************
	QUnit.test("readCount: GET fails", function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X"
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oError = new Error(),
			oGroupLock = {
				getUnlockedCopy : function () {}
			};

		oCache.oCountPromise = {
			$resolve : true, // will not be called :-)
			$restore : sinon.spy()
		};
		this.mock(this.oRequestor).expects("buildQueryString").withExactArgs(null, {})
			.returns("?~query~");
		this.mock(oGroupLock).expects("getUnlockedCopy").withExactArgs()
			.returns("~oGroupLockCopy~");
		this.mock(this.oRequestor).expects("request")
			.withExactArgs("GET", "~/$count?~query~", "~oGroupLockCopy~").rejects(oError);

		// code under test
		return oCache.readCount(oGroupLock).then(function () {
			assert.ok(false);
		}, function (oResult) {
			assert.strictEqual(oResult, oError);
			assert.strictEqual(oCache.oCountPromise.$restore.callCount, 1);
		});
	});

	//*********************************************************************************************
[{
	mExpectedQueryOptions : {
		foo : "bar",
		"sap-client" : "123"
	}
}, {
	$filter : "Is_Manager",
	mExpectedQueryOptions : {
		$filter : "Is_Manager",
		foo : "bar",
		"sap-client" : "123"
	}
}, {
	search : "covfefe",
	mExpectedQueryOptions : {
		$search : "covfefe",
		foo : "bar",
		"sap-client" : "123"
	}
}, {
	$filter : "Is_Manager",
	search : "covfefe",
	mExpectedQueryOptions : {
		$filter : "Is_Manager",
		$search : "covfefe",
		foo : "bar",
		"sap-client" : "123"
	}
}].forEach(function (oFixture, i) {
	QUnit.test("readCount: #" + i, function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X",
				search : oFixture.search
			},
			oCache,
			oGroupLock = {
				getUnlockedCopy : function () {}
			},
			mQueryOptions = {
				$apply : "A.P.P.L.E",
				$count : true,
				$expand : {EMPLOYEE_2_TEAM : null},
				// $filter : oFixture.$filter,
				$orderby : "TEAM_ID desc",
				// Unsupported system query option: $search
				$select : ["Name"],
				foo : "bar",
				"sap-client" : "123"
			},
			fnResolve = sinon.spy(),
			oResult;

		if ("$filter" in oFixture) {
			mQueryOptions.$filter = oFixture.$filter;
		}
		oCache = _AggregationCache.create(this.oRequestor, "~", "", mQueryOptions, oAggregation);
		oCache.oCountPromise = {
			$resolve : fnResolve,
			$restore : mustBeMocked // must not be called
		};
		this.mock(this.oRequestor).expects("buildQueryString")
			.withExactArgs(null, oFixture.mExpectedQueryOptions).returns("?~query~");
		this.mock(oGroupLock).expects("getUnlockedCopy").withExactArgs()
			.returns("~oGroupLockCopy~");
		this.mock(this.oRequestor).expects("request")
			.withExactArgs("GET", "~/$count?~query~", "~oGroupLockCopy~").resolves(42);

		// code under test
		oResult = oCache.readCount(oGroupLock);

		assert.notOk(fnResolve.called, "not yet");
		assert.notOk("$resolve" in oCache.oCountPromise, "prevent 2nd GET");

		return oResult.then(function () {
			assert.strictEqual(fnResolve.args[0][0], 42);
		});
	});
});

	//*********************************************************************************************
[{
	bHasGrandTotal : false,
	iFirstLevelIndex : 0,
	iFirstLevelLength : 3,
	iExpectedStart : 0,
	iExpectedLength : 23
}, {
	bHasGrandTotal : true,
	iFirstLevelIndex : 0,
	iFirstLevelLength : 2,
	iExpectedStart : 0,
	iExpectedLength : 22
}, {
	bHasGrandTotal : true,
	grandTotalAtBottomOnly : false,
	iFirstLevelIndex : 0,
	iFirstLevelLength : 2,
	iExpectedStart : 0,
	iExpectedLength : 22
}, {
	bHasGrandTotal : true,
	grandTotalAtBottomOnly : true,
	iFirstLevelIndex : 0,
	iFirstLevelLength : 1,
	iExpectedStart : 0,
	iExpectedLength : 21
}, {
	bHasGrandTotal : false,
	iFirstLevelIndex : 10,
	iFirstLevelLength : 3,
	iExpectedStart : 0,
	iExpectedLength : 33
}, {
	bHasGrandTotal : false,
	iFirstLevelIndex : 20,
	iFirstLevelLength : 1,
	iExpectedStart : 0,
	iExpectedLength : 41
}, {
	bHasGrandTotal : false,
	iFirstLevelIndex : 21,
	iFirstLevelLength : 1,
	iExpectedStart : 1,
	iExpectedLength : 41
}, {
	bHasGrandTotal : true,
	iFirstLevelIndex : 9,
	iFirstLevelLength : 3,
	iExpectedStart : 0,
	iExpectedLength : 32
}, {
	bHasGrandTotal : true,
	grandTotalAtBottomOnly : false,
	iFirstLevelIndex : 9,
	iFirstLevelLength : 3,
	iExpectedStart : 0,
	iExpectedLength : 32
}, {
	bHasGrandTotal : true,
	grandTotalAtBottomOnly : true,
	iFirstLevelIndex : 10,
	iFirstLevelLength : 3,
	iExpectedStart : 0,
	iExpectedLength : 33
}, {
	bHasGrandTotal : true,
	iFirstLevelIndex : 0,
	iFirstLevelLength : 42,
	iExpectedStart : 0,
	iExpectedLength : 62
}, {
	iExpandTo : 2,
	iLevel : 0, // symbolic level for generic initial placeholders inside top pyramid
	iFirstLevelIndex : 10,
	iFirstLevelLength : 3,
	iExpectedStart : 0,
	iExpectedLength : 33
}, {
	bUnifiedCache : true,
	iLevel : 0, // symbolic level for generic initial placeholders inside top pyramid
	iFirstLevelIndex : 10,
	iFirstLevelLength : 3,
	iExpectedStart : 0,
	iExpectedLength : 33
}, { // prefetch wins; less than iStart
	iFirstLevelIndex : 25,
	iFirstLevelLength : 1,
	iOutOfPlaceCount : 5,
	iPrefetchLength : 10,
	iExpectedStart : 15,
	iExpectedLength : 21
}, { // out of place count wins; less than iStart
	iFirstLevelIndex : 25,
	iFirstLevelLength : 1,
	iOutOfPlaceCount : 10,
	iPrefetchLength : 5,
	iExpectedStart : 15,
	iExpectedLength : 16
}, { // prefetch wins; more than iStart
	iFirstLevelIndex : 2,
	iFirstLevelLength : 1,
	iOutOfPlaceCount : 3,
	iPrefetchLength : 5,
	iExpectedStart : 0,
	iExpectedLength : 8
}, { // out of place count wins; more than iStart
	iFirstLevelIndex : 2,
	iFirstLevelLength : 1,
	iOutOfPlaceCount : 5,
	iPrefetchLength : 1,
	iExpectedStart : 0,
	iExpectedLength : 4
}, { // oFirstLevel already requested data
	bSentRequest : true,
	iFirstLevelIndex : 0,
	iFirstLevelLength : 3,
	iExpectedStart : 0,
	iExpectedLength : 23
}, { // oFirstLevel already requested data and out-of-place nodes are present
	bSentRequest : true,
	iFirstLevelIndex : 0,
	iFirstLevelLength : 3,
	iOutOfPlaceCount : 1,
	iExpectedStart : 0,
	iExpectedLength : 23
}].forEach(function (oFixture, i) {
	QUnit.test("readFirst: #" + i, function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {
					SalesNumber : {grandTotal : oFixture.bHasGrandTotal}
				},
				group : {},
				groupLevels : ["group"]
			},
			oAggregationHelperMock = this.mock(_AggregationHelper),
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oCacheMock = this.mock(oCache),
			iExpectedLength = oFixture.iExpectedLength,
			iExpectedLevel = "iLevel" in oFixture ? oFixture.iLevel : 1, // cf. createPlaceholder
			iExpectedStart = oFixture.iExpectedStart,
			oGrandTotal = {},
			oGrandTotalCopy = {},
			iOffset = oFixture.bHasGrandTotal && oFixture.grandTotalAtBottomOnly !== true ? 1 : 0,
			oReadResult = {
				value : []
			},
			bSkipResponse = oFixture.bSentRequest && oFixture.iOutOfPlaceCount;

		if (oFixture.iExpandTo) { // unrealistic combination, but never mind
			oAggregation.expandTo = oFixture.iExpandTo;
		}
		if (oFixture.bUnifiedCache) {
			oCache.bUnifiedCache = true;
		}
		if ("grandTotalAtBottomOnly" in oFixture) {
			oAggregation.grandTotalAtBottomOnly = oFixture.grandTotalAtBottomOnly;
		}
		if (oFixture.bHasGrandTotal) {
			oCache.oGrandTotalPromise = SyncPromise.resolve(oGrandTotal);
			_Helper.setPrivateAnnotation(oGrandTotal, "copy", oGrandTotalCopy);
		}
		oCache.oFirstLevel.bSentRequest = oFixture.bSentRequest;
		for (let j = 0; j < Math.min(iExpectedLength, 42); j += 1) {
			oReadResult.value.push({});
		}
		oReadResult.value.$count = 42;
		this.mock(oCache.oTreeState).expects("getOutOfPlaceCount").withExactArgs()
			.returns(oFixture.iOutOfPlaceCount ?? 0);
		this.mock(oCache.oFirstLevel).expects("read")
			.withExactArgs(iExpectedStart, iExpectedLength, 0,
				bSkipResponse ? sinon.match.same(_GroupLock.$cached) : "~oGroupLock~",
				"~fnDataRequested~")
			.callsFake(function () {
				oCache.oFirstLevel.bSentRequest = true;
				return SyncPromise.resolve(Promise.resolve(oReadResult));
			});
		oCacheMock.expects("requestOutOfPlaceNodes")
			.exactly(oFixture.bSentRequest ? 0 : 1).withExactArgs("~oGroupLock~")
			.returns([Promise.resolve("~outOfPlaceResult0~"),
				Promise.resolve("~outOfPlaceResult1~"), Promise.resolve("~outOfPlaceResult2~")]);
		if (oFixture.bHasGrandTotal) {
			switch (oFixture.grandTotalAtBottomOnly) {
				case false: // top & bottom
					oCacheMock.expects("addElements")
						.withExactArgs(sinon.match.same(oGrandTotal), 0)
						.callsFake(addElements); // so that oCache.aElements is actually filled
					oCacheMock.expects("addElements")
						.withExactArgs(sinon.match.same(oGrandTotalCopy), 43)
						.callsFake(addElements); // so that oCache.aElements is actually filled
					break;

				case true: // bottom
					oCacheMock.expects("addElements")
						.withExactArgs(sinon.match.same(oGrandTotal), 42)
						.callsFake(addElements); // so that oCache.aElements is actually filled
					break;

				default: // top
					oCacheMock.expects("addElements")
						.withExactArgs(sinon.match.same(oGrandTotal), 0)
						.callsFake(addElements); // so that oCache.aElements is actually filled
			}
		}
		const oAddElementsExpectation = oCacheMock.expects("addElements")
			.exactly(bSkipResponse ? 0 : 1)
			.withExactArgs(sinon.match.same(oReadResult.value), iExpectedStart + iOffset,
				sinon.match.same(oCache.oFirstLevel), iExpectedStart)
			.callsFake(addElements); // so that oCache.aElements is actually filled
		// expect placeholders before and after real read results
		for (let j = 0; j < iExpectedStart; j += 1) {
			oAggregationHelperMock.expects("createPlaceholder")
				.withExactArgs(iExpectedLevel, j, sinon.match.same(oCache.oFirstLevel))
				.returns("~placeholder~" + j);
		}
		for (let j = iExpectedStart + iExpectedLength; j < 42; j += 1) {
			oAggregationHelperMock.expects("createPlaceholder").exactly(bSkipResponse ? 0 : 1)
				.withExactArgs(iExpectedLevel, j, sinon.match.same(oCache.oFirstLevel))
				.returns("~placeholder~" + j);
		}
		const oHandleOutOfPlaceNodesExpectation = oCacheMock.expects("handleOutOfPlaceNodes")
			.exactly(bSkipResponse ? 0 : 1)
			.withExactArgs(oFixture.bSentRequest
				? []
				: ["~outOfPlaceResult0~", "~outOfPlaceResult1~", "~outOfPlaceResult2~"]
			);

		// code under test
		return oCache.readFirst(oFixture.iFirstLevelIndex, oFixture.iFirstLevelLength,
				oFixture.iPrefetchLength ?? 20, "~oGroupLock~", "~fnDataRequested~")
			.then(function () {
				if (bSkipResponse) {
					assert.strictEqual(oCache.aElements.length, 0, "unchanged");
					assert.strictEqual(oCache.aElements.$count, undefined, "unchanged");
					return;
				}

				// check placeholders before and after real read results
				for (let j = 0; j < iExpectedStart; j += 1) {
					assert.strictEqual(oCache.aElements[iOffset + j], "~placeholder~" + j);
				}
				for (let j = iExpectedStart + iExpectedLength; j < 42; j += 1) {
					assert.strictEqual(oCache.aElements[iOffset + j], "~placeholder~" + j);
				}

				if (oFixture.bHasGrandTotal) {
					switch (oFixture.grandTotalAtBottomOnly) {
						case false: // top & bottom
							assert.strictEqual(oCache.aElements.length, 44);
							assert.strictEqual(oCache.aElements.$count, 44);
							break;

						case true: // bottom
						default: // top
							assert.strictEqual(oCache.aElements.length, 43);
							assert.strictEqual(oCache.aElements.$count, 43);
					}
				} else {
					assert.strictEqual(oCache.aElements.length, 42);
					assert.strictEqual(oCache.aElements.$count, 42);
				}

				sinon.assert.callOrder(oAddElementsExpectation, oHandleOutOfPlaceNodesExpectation);
			});
	});
});

	//*********************************************************************************************
[undefined, false, true].forEach((bGrandTotalAtBottomOnly) => {
	const sTitle = "readFirst: no data => no grand total; grandTotalAtBottomOnly="
		+ bGrandTotalAtBottomOnly;

	QUnit.test(sTitle, async function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, {
			aggregate : {
				SalesNumber : {grandTotal : true}
			},
			grandTotalAtBottomOnly : bGrandTotalAtBottomOnly,
			group : {},
			groupLevels : ["group"]
		});
		oCache.oGrandTotalPromise = SyncPromise.resolve({/*oGrandTotal*/});
		this.mock(oCache.oTreeState).expects("getOutOfPlaceCount").withExactArgs().returns(0);
		const oReadResult = {
			value : []
		};
		oReadResult.value.$count = 0; // no data
		this.mock(oCache.oFirstLevel).expects("read")
			.withExactArgs(0, 30, 0, "~oGroupLock~", "~fnDataRequested~")
			.returns(SyncPromise.resolve(Promise.resolve(oReadResult)));
		this.mock(oCache).expects("requestOutOfPlaceNodes").withExactArgs("~oGroupLock~")
			.returns([]);
		this.mock(oCache).expects("addElements")
			.withExactArgs(sinon.match.same(oReadResult.value), 0,
				sinon.match.same(oCache.oFirstLevel), 0);
		this.mock(_AggregationHelper).expects("createPlaceholder").never();
		this.mock(oCache).expects("handleOutOfPlaceNodes").withExactArgs([]);

		// code under test
		await oCache.readFirst(0, 10, 20, "~oGroupLock~", "~fnDataRequested~");

		assert.deepEqual(oCache.aElements, []);
		assert.strictEqual(oCache.aElements.length, 0);
		assert.strictEqual(oCache.aElements.$count, 0);
	});
});

	//*********************************************************************************************
	QUnit.test("read: from group level cache", function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["group"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oGroupLock0 = {
				getUnlockedCopy : function () {},
				unlock : function () {}
			},
			oGroupLock1 = {
				getUnlockedCopy : function () {},
				unlock : function () {}
			},
			oCacheMock = this.mock(oCache),
			aReadResult0 = [{}],
			aReadResult1 = [{}, {}],
			that = this;

		oCache.aElements = [
			{/* expanded node */},
			{/* first leaf */},
			_AggregationHelper.createPlaceholder(1, 1, "~oGroupLevelCache~"),
			_AggregationHelper.createPlaceholder(1, 2, "~oGroupLevelCache~"),
			_AggregationHelper.createPlaceholder(1, 3, "~oGroupLevelCache~"),
			{/* other node */}
		];
		oCache.aElements.$byPredicate = {};
		oCache.aElements.$count = 42;

		this.mock(oGroupLock0).expects("getUnlockedCopy").withExactArgs()
			.returns("~oGroupLockCopy0~");
		oCacheMock.expects("readGap")
			.withExactArgs("~oGroupLevelCache~", 2, 3, "~oGroupLockCopy0~", "~fnDataRequested~")
			.returns(addElementsLater(oCache, aReadResult0, 2));
		this.mock(oGroupLock0).expects("unlock").withExactArgs();

		// code under test
		return oCache.read(2, 1, 0, oGroupLock0, "~fnDataRequested~").then(function (oResult1) {
			assert.strictEqual(oResult1.value.length, 1);
			assert.strictEqual(oResult1.value[0], aReadResult0[0]);
			assert.strictEqual(oResult1.value.$count, 42);

			that.mock(oGroupLock1).expects("getUnlockedCopy").withExactArgs()
				.returns("~oGroupLockCopy1~");
			oCacheMock.expects("readGap")
				.withExactArgs("~oGroupLevelCache~", 3, 5, "~oGroupLockCopy1~", "~fnDataRequested~")
				.returns(addElementsLater(oCache, aReadResult1, 3));
			that.mock(oGroupLock1).expects("unlock").withExactArgs();

			// code under test
			return oCache.read(3, 3, 0, oGroupLock1, "~fnDataRequested~");
		}).then(function (oResult2) {
			assert.strictEqual(oResult2.value.length, 3);
			assert.strictEqual(oResult2.value[0], aReadResult1[0]);
			assert.strictEqual(oResult2.value[1], aReadResult1[1]);
			assert.strictEqual(oResult2.value[2], oCache.aElements[5]);
			assert.strictEqual(oResult2.value.$count, 42);
		});
	});

	//*********************************************************************************************
	QUnit.test("read: first level cache and group level cache", function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["group"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oCacheMock = this.mock(oCache),
			oFirstLeaf = {},
			oGroupLock = {
				getUnlockedCopy : function () {},
				unlock : function () {}
			},
			oGroupLockMock = this.mock(oGroupLock),
			aReadResult0 = [{}, {}],
			aReadResult1 = [{}, {}, {}, {}];

		oCache.aElements = [
			{/* expanded node */},
			oFirstLeaf,
			_AggregationHelper.createPlaceholder(1, 1, "~oGroupLevelCache~"),
			_AggregationHelper.createPlaceholder(1, 2, "~oGroupLevelCache~"),
			_AggregationHelper.createPlaceholder(0, 1, "~oFirstLevelCache~"),
			_AggregationHelper.createPlaceholder(0, 2, "~oFirstLevelCache~"),
			_AggregationHelper.createPlaceholder(0, 3, "~oFirstLevelCache~"),
			_AggregationHelper.createPlaceholder(0, 4, "~oFirstLevelCache~")
		];
		oCache.aElements.$byPredicate = {};
		oCache.aElements.$count = 7;

		const oReadRangeExpectation = this.mock(ODataUtils).expects("_getReadRange")
			.withExactArgs(sinon.match.same(oCache.aElements), 1, 4, 5, sinon.match.func)
			.returns({length : 9, start : 1}); // note: beyond $count
		oGroupLockMock.expects("getUnlockedCopy").withExactArgs().returns("~oGroupLockCopy0~");
		oGroupLockMock.expects("getUnlockedCopy").withExactArgs().returns("~oGroupLockCopy1~");
		oCacheMock.expects("readGap")
			.withExactArgs("~oGroupLevelCache~", 2, 4, "~oGroupLockCopy0~", "~fnDataRequested~")
			.returns(addElementsLater(oCache, aReadResult0, 2));
		oCacheMock.expects("readGap")
			.withExactArgs("~oFirstLevelCache~", 4, 8, "~oGroupLockCopy1~", "~fnDataRequested~")
			.returns(addElementsLater(oCache, aReadResult1, 4));
		oGroupLockMock.expects("unlock").withExactArgs();

		// code under test
		return oCache.read(1, 4, 5, oGroupLock, "~fnDataRequested~").then((oResult) => {
			assert.strictEqual(oResult.value.length, 4);
			assert.strictEqual(oResult.value[0], oFirstLeaf);
			assert.strictEqual(oResult.value[1], aReadResult0[0]);
			assert.strictEqual(oResult.value[2], aReadResult0[1]);
			assert.strictEqual(oResult.value[3], aReadResult1[0]);
			assert.strictEqual(oResult.value.$count, 7);

			assert.strictEqual(oCache.aElements[1], oFirstLeaf);
			assert.strictEqual(oCache.aElements[2], aReadResult0[0]);
			assert.strictEqual(oCache.aElements[3], aReadResult0[1]);
			assert.strictEqual(oCache.aElements[4], aReadResult1[0]);
			assert.strictEqual(oCache.aElements[5], aReadResult1[1]);
			assert.strictEqual(oCache.aElements[6], aReadResult1[2]);
			assert.strictEqual(oCache.aElements[7], aReadResult1[3]);

			const fnReadRangeCallback = oReadRangeExpectation.args[0][4];

			// code under test
			assert.notOk(fnReadRangeCallback({}));

			const oGroupLevelCache = {isMissing : mustBeMocked};
			this.mock(oGroupLevelCache).expects("isMissing").withExactArgs(0).returns("~");
			let oEntity = {
				"@$ui5._" : {
					parent : oGroupLevelCache,
					placeholder : true,
					rank : 0
				}
			};

			// code under test
			assert.strictEqual(fnReadRangeCallback(oEntity), "~");

			oEntity = {
				"@$ui5._" : {
					placeholder : 1,
					predicate : "('~')"
				}
			};
			oCache.aElements.$byPredicate["('~')"] = oEntity;

			// code under test
			assert.ok(fnReadRangeCallback(oEntity));

			oCache.aElements.$byPredicate["('~')"] = SyncPromise.resolve();

			// code under test
			assert.notOk(fnReadRangeCallback(oEntity));
		});
	});

	//*********************************************************************************************
[
	{iStart : 0, iLength : 1, iPrefetchLength : 0},
	{iStart : 0, iLength : 2, iPrefetchLength : 0},
	{iStart : 1, iLength : 1, iPrefetchLength : 1}
].forEach(function (oFixture) {
	QUnit.test("read: gap at start " + JSON.stringify(oFixture), function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["group"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oFirstLeaf = {},
			oGroupLock = {
				getUnlockedCopy : function () {},
				unlock : function () {}
			},
			aReadResult = [{}];

		oCache.aElements = [
			_AggregationHelper.createPlaceholder(0, 0, "~oFirstLevelCache~"),
			oFirstLeaf
		];
		oCache.aElements.$byPredicate = {};
		oCache.aElements.$count = 42;

		this.mock(ODataUtils).expects("_getReadRange")
			.withExactArgs(sinon.match.same(oCache.aElements), oFixture.iStart, oFixture.iLength,
				oFixture.iPrefetchLength, sinon.match.func)
			.returns({length : 2, start : 0});
		this.mock(oGroupLock).expects("getUnlockedCopy").withExactArgs()
			.returns("~oGroupLockCopy~");
		this.mock(oCache).expects("readGap")
			.withExactArgs("~oFirstLevelCache~", 0, 1, "~oGroupLockCopy~", "~fnDataRequested~")
			.returns(addElementsLater(oCache, aReadResult, 0));
		this.mock(oGroupLock).expects("unlock").withExactArgs();

		// code under test
		return oCache.read(oFixture.iStart, oFixture.iLength, oFixture.iPrefetchLength, oGroupLock,
				"~fnDataRequested~"
		).then(function (oResult) {
			assert.strictEqual(oResult.value.length, oFixture.iLength);
			assert.strictEqual(oResult.value[0], oFixture.iStart ? oFirstLeaf : aReadResult[0]);
			if (oFixture.iLength > 1) {
				assert.strictEqual(oResult.value[1], oFirstLeaf);
			}
			assert.strictEqual(oResult.value.$count, 42);

			assert.strictEqual(oCache.aElements[0], aReadResult[0]);
			assert.strictEqual(oCache.aElements[1], oFirstLeaf);
		});
	});
});

	//*********************************************************************************************
	QUnit.test("read: intersecting reads", function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["group"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oCacheMock = this.mock(oCache),
			oFirstLeaf = {},
			oGroupLock = {
				getUnlockedCopy : function () {},
				unlock : function () {}
			},
			oGroupLockMock = this.mock(oGroupLock),
			oReadSameNode = {},
			aReadResult0 = [{}, oReadSameNode, {}],
			aReadResult1 = [oReadSameNode];

		oCache.aElements = [
			{/* expanded node */},
			oFirstLeaf,
			_AggregationHelper.createPlaceholder(1, 1, "~oGroupLevelCache~"),
			_AggregationHelper.createPlaceholder(1, 2, "~oGroupLevelCache~"),
			_AggregationHelper.createPlaceholder(1, 3, "~oGroupLevelCache~"),
			_AggregationHelper.createPlaceholder(1, 4, "~oGroupLevelCache~"),
			_AggregationHelper.createPlaceholder(1, 5, "~oGroupLevelCache~"),
			_AggregationHelper.createPlaceholder(1, 6, "~oGroupLevelCache~")
		];
		oCache.aElements.$byPredicate = {};
		oCache.aElements.$count = 42;

		oGroupLockMock.expects("getUnlockedCopy").withExactArgs().returns("~oGroupLockCopy0~");
		oGroupLockMock.expects("getUnlockedCopy").withExactArgs().returns("~oGroupLockCopy1~");
		oGroupLockMock.expects("unlock").withExactArgs().twice();
		oCacheMock.expects("readGap")
			.withExactArgs("~oGroupLevelCache~", 2, 5, "~oGroupLockCopy0~", "~fnDataRequested~")
			.returns(addElementsLater(oCache, aReadResult0, 2));
		oCacheMock.expects("readGap")
			.withExactArgs("~oGroupLevelCache~", 3, 4, "~oGroupLockCopy1~", "~fnDataRequested~")
			.returns(addElementsLater(oCache, aReadResult1, 3));

		// code under test
		return Promise.all([
			oCache.read(1, 4, 0, oGroupLock, "~fnDataRequested~"),
			oCache.read(3, 1, 0, oGroupLock, "~fnDataRequested~")
		]).then(function (aResults) {
			assert.strictEqual(aResults[0].value.length, 4);
			assert.strictEqual(aResults[0].value[0], oFirstLeaf);
			assert.strictEqual(aResults[0].value[1], aReadResult0[0]);
			assert.strictEqual(aResults[0].value[2], oReadSameNode);
			assert.strictEqual(aResults[0].value[2], aReadResult0[1]);
			assert.strictEqual(aResults[0].value.$count, 42);
			assert.strictEqual(aResults[1].value.length, 1);
			assert.strictEqual(aResults[1].value[0], oReadSameNode);
			assert.strictEqual(aResults[1].value.$count, 42);

			assert.strictEqual(oCache.aElements[1], oFirstLeaf);
			assert.strictEqual(oCache.aElements[2], aReadResult0[0]);
			assert.strictEqual(oCache.aElements[3], oReadSameNode);
			assert.strictEqual(oCache.aElements[4], aReadResult0[2]);
			assert.strictEqual(_Helper.getPrivateAnnotation(oCache.aElements[5], "rank"), 4);
			assert.strictEqual(_Helper.getPrivateAnnotation(oCache.aElements[6], "rank"), 5);
			assert.strictEqual(_Helper.getPrivateAnnotation(oCache.aElements[7], "rank"), 6);
		});
	});

	//*********************************************************************************************
	QUnit.test("read: two different group level caches", function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["group"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oCacheMock = this.mock(oCache),
			oFirstLeaf0 = {},
			oFirstLeaf1 = {},
			oGroupLock = {
				getUnlockedCopy : function () {},
				unlock : function () {}
			},
			oGroupLockMock = this.mock(oGroupLock),
			oReadPromise,
			aReadResult0 = [{}, {}],
			aReadResult1 = [{}, {}],
			oUnlockExpectation;

		oCache.aElements = [
			{/* expanded node */},
			oFirstLeaf0,
			_AggregationHelper.createPlaceholder(1, 1, "~oGroupLevelCache0~"),
			_AggregationHelper.createPlaceholder(1, 2, "~oGroupLevelCache0~"),
			{/* expanded node */},
			oFirstLeaf1,
			_AggregationHelper.createPlaceholder(1, 1, "~oGroupLevelCache1~"),
			_AggregationHelper.createPlaceholder(1, 2, "~oGroupLevelCache1~")
		];
		oCache.aElements.$byPredicate = {};
		oCache.aElements.$count = 42;

		oGroupLockMock.expects("getUnlockedCopy").withExactArgs().returns("~oGroupLockCopy0~");
		oGroupLockMock.expects("getUnlockedCopy").withExactArgs().returns("~oGroupLockCopy1~");
		oUnlockExpectation = oGroupLockMock.expects("unlock").withExactArgs();
		oCacheMock.expects("readGap")
			.withExactArgs("~oGroupLevelCache0~", 2, 4, "~oGroupLockCopy0~", "~fnDataRequested~")
			.returns(addElementsLater(oCache, aReadResult0, 2));
		oCacheMock.expects("readGap")
			.withExactArgs("~oGroupLevelCache1~", 6, 8, "~oGroupLockCopy1~", "~fnDataRequested~")
			.returns(addElementsLater(oCache, aReadResult1, 6));

		// code under test
		oReadPromise = oCache.read(1, 7, 0, oGroupLock, "~fnDataRequested~")
			.then(function (oResult) {
				assert.strictEqual(oResult.value.length, 7);
				assert.strictEqual(oResult.value[0], oFirstLeaf0);
				assert.strictEqual(oResult.value[1], aReadResult0[0]);
				assert.strictEqual(oResult.value[2], aReadResult0[1]);

				assert.strictEqual(oResult.value[4], oFirstLeaf1);
				assert.strictEqual(oResult.value[5], aReadResult1[0]);
				assert.strictEqual(oResult.value[6], aReadResult1[1]);
				assert.strictEqual(oResult.value.$count, 42);

				assert.strictEqual(oCache.aElements[1], oFirstLeaf0);
				assert.strictEqual(oCache.aElements[2], aReadResult0[0]);
				assert.strictEqual(oCache.aElements[3], aReadResult0[1]);

				assert.strictEqual(oCache.aElements[5], oFirstLeaf1);
				assert.strictEqual(oCache.aElements[6], aReadResult1[0]);
				assert.strictEqual(oCache.aElements[7], aReadResult1[1]);
			});

		assert.ok(oUnlockExpectation.called);

		return oReadPromise;
	});

	//*********************************************************************************************
	QUnit.test("read: only placeholder", function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["group"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oElement = {"@$ui5._" : {parent : "~oFirstLevelCache~"}},
			oGroupLock = {
				getUnlockedCopy : function () {},
				unlock : function () {}
			},
			aReadResult = [{}, {}]; // "short read", e.g. due to server-driven paging

		oCache.aElements = [
			{},
			_AggregationHelper.createPlaceholder(1, 1, "~oFirstLevelCache~"),
			_AggregationHelper.createPlaceholder(1, 2, "~oFirstLevelCache~"),
			_AggregationHelper.createPlaceholder(1, 3, "~oFirstLevelCache~"),
			_AggregationHelper.createPlaceholder(1, 4, "~oFirstLevelCache~"),
			_AggregationHelper.createPlaceholder(1, 5, "~oFirstLevelCache~"),
			oElement, // do not confuse w/ a placeholder!
			_AggregationHelper.createPlaceholder(1, 7, "~oFirstLevelCache~")
		];
		oCache.aElements.$byPredicate = {};
		oCache.aElements.$count = 8;

		_Helper.setPrivateAnnotation(oCache.aElements[3], "predicate", "('A')");
		_Helper.setPrivateAnnotation(oCache.aElements[5], "predicate", "('B')");
		this.mock(oGroupLock).expects("getUnlockedCopy").withExactArgs()
			.returns("~oGroupLockCopy~");
		this.mock(oCache).expects("readGap")
			.withExactArgs("~oFirstLevelCache~", 3, 6, "~oGroupLockCopy~", "~fnDataRequested~")
			.returns(addElementsLater(oCache, aReadResult, 3));

		// code under test
		return oCache.read(3, 4, 0, oGroupLock, "~fnDataRequested~").then(function (oResult) {
			assert.strictEqual(oResult.value.length, 4);
			assert.strictEqual(oResult.value[0], aReadResult[0]);
			assert.strictEqual(oResult.value[1], aReadResult[1]);
			assert.strictEqual(oResult.value[2], undefined, "placeholder is hidden");
			assert.strictEqual(oResult.value[3], oElement);
			assert.strictEqual(oResult.value.$count, 8);
		});
	});

	//*********************************************************************************************
	QUnit.test("read: split gap", function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X"
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oCacheMock = this.mock(oCache),
			oGroupLock = {
				getUnlockedCopy : function () {},
				unlock : function () {}
			},
			oGroupLockMock = this.mock(oGroupLock);

		oCache.aElements = [
			"~Alpha~",
			_AggregationHelper.createPlaceholder(1, 1, "~oFirstLevelCache~"), // collapsed Beta
			_AggregationHelper.createPlaceholder(1, 3, "~oFirstLevelCache~") // Kappa
		];
		oCache.aElements.$count = 8;
		_Helper.setPrivateAnnotation(oCache.aElements[1], "predicate", "('1')");
		_Helper.setPrivateAnnotation(oCache.aElements[2], "predicate", "('2')");

		oGroupLockMock.expects("getUnlockedCopy").withExactArgs().returns("~oGroupLockCopy0~");
		oCacheMock.expects("readGap")
			.withExactArgs("~oFirstLevelCache~", 1, 2, "~oGroupLockCopy0~", "~fnDataRequested~")
			.returns(addElementsLater(oCache, ["~Beta~"], 1));
		oGroupLockMock.expects("getUnlockedCopy").withExactArgs().returns("~oGroupLockCopy1~");
		oCacheMock.expects("readGap")
			.withExactArgs("~oFirstLevelCache~", 2, 3, "~oGroupLockCopy1~", "~fnDataRequested~")
			.returns(addElementsLater(oCache, ["~Kappa~"], 2));
		this.mock(oGroupLock).expects("unlock").withExactArgs();

		// code under test
		return oCache.read(0, 3, 0, oGroupLock, "~fnDataRequested~").then(function (oResult) {
			assert.deepEqual(oResult.value, ["~Alpha~", "~Beta~", "~Kappa~"]);
			assert.strictEqual(oResult.value.$count, 8);
		});
	});

	//*********************************************************************************************
	QUnit.test("read: more elements than existing", function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["group"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oGroupLock = {
				getUnlockedCopy : function () {},
				unlock : function () {}
			},
			aReadResult = [{}];

		oCache.aElements = [
			{},
			_AggregationHelper.createPlaceholder(1, 1, "~oFirstLevelCache~")
		];
		oCache.aElements.$byPredicate = {};
		oCache.aElements.$count = 2;

		this.mock(oGroupLock).expects("getUnlockedCopy").withExactArgs()
			.returns("~oGroupLockCopy~");
		this.mock(oCache).expects("readGap")
			.withExactArgs("~oFirstLevelCache~", 1, 2, "~oGroupLockCopy~", "~fnDataRequested~")
			.returns(addElementsLater(oCache, aReadResult, 1));

		// code under test
		return oCache.read(0, 100, 0, oGroupLock, "~fnDataRequested~").then(function (oResult) {
			assert.strictEqual(oResult.value.length, 2);
			assert.strictEqual(oResult.value[0], oCache.aElements[0]);
			assert.strictEqual(oResult.value[1], aReadResult[0]);
			assert.strictEqual(oResult.value.$count, 2);
		});
	});

	//*********************************************************************************************
	QUnit.test("readGap: success", async function (assert) {
		var oCache
			= _AggregationCache.create(this.oRequestor, "~", "", {}, {hierarchyQualifier : "X"}),
			oGroupLevelCache = {
				getQueryOptions : function () {},
				read : function () {},
				setQueryOptions : function () {}
			},
			mQueryOptions = {
				$apply : "A.P.P.L.E.",
				$count : true, // dropped
				$expand : {expand : null},
				$orderby : "orderby",
				$search : "search",
				$select : ["Name"],
				foo : "bar",
				"sap-client" : "123"
			},
			sQueryOptions = JSON.stringify(mQueryOptions),
			aReadResult = [{}];

		oCache.aElements = [,, _AggregationHelper.createPlaceholder(1, 1, oGroupLevelCache)];

		this.mock(oGroupLevelCache).expects("getQueryOptions").withExactArgs()
			.returns(mQueryOptions);
		this.mock(oGroupLevelCache).expects("setQueryOptions").withExactArgs({
				$apply : "A.P.P.L.E.",
				$expand : {expand : null},
				$orderby : "orderby",
				$search : "search",
				$select : ["Name"],
				foo : "bar",
				"sap-client" : "123"
			}, true);
		this.mock(oGroupLevelCache).expects("read")
			.withExactArgs(1, 1, 0, "~oGroupLock~", "~fnDataRequested~", true)
			.returns(SyncPromise.resolve({value : aReadResult}));
		this.mock(oCache).expects("addElements")
			.withExactArgs(sinon.match.same(aReadResult), 2, sinon.match.same(oGroupLevelCache), 1);

		// code under test
		await oCache.readGap(oGroupLevelCache, 2, 3, "~oGroupLock~", "~fnDataRequested~");

		assert.strictEqual(JSON.stringify(mQueryOptions), sQueryOptions, "unchanged");
	});

	//*********************************************************************************************
	QUnit.test("readGap: created persisted", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, {
			hierarchyQualifier : "X",
			$NodeProperty : "path/to/NodeID"
		});
		oCache.aElements = [,, "~oStartElement~"];
		oCache.aElements.$byPredicate = {};
		const oHelperMock = this.mock(_Helper);
		oHelperMock.expects("getPrivateAnnotation")
			.withExactArgs("~oStartElement~", "rank").returns(undefined); // created
		oHelperMock.expects("getPrivateAnnotation")
			.withExactArgs("~oStartElement~", "predicate").returns("~sPredicate~");
		const oGroupLevelCache = {refreshSingle : mustBeMocked};
		this.mock(oGroupLevelCache).expects("refreshSingle")
			.withExactArgs("~oGroupLock~", "", -1, "~sPredicate~", true, false, "~fnDataRequested~")
			.returns(SyncPromise.resolve(Promise.resolve("~oElement~")));
		oHelperMock.expects("inheritPathValue")
			.withExactArgs(["path", "to", "NodeID"], "~oStartElement~", "~oElement~", true);
		this.mock(oCache).expects("addElements")
			.withExactArgs("~oElement~", 2, sinon.match.same(oGroupLevelCache));

		// code under test
		const oResult = oCache.readGap(oGroupLevelCache, 2, 3, "~oGroupLock~", "~fnDataRequested~");

		assert.strictEqual(oCache.aElements.$byPredicate["~sPredicate~"], oResult);

		return oResult.then(function (vResult) {
			assert.strictEqual(vResult, undefined, "without a defined result");
		});
	});

	//*********************************************************************************************
	QUnit.test("readGap: multiple created persisted", function (assert) {
		const oCache
			= _AggregationCache.create(this.oRequestor, "~", "", {}, {hierarchyQualifier : "X"});
		oCache.aElements = [,, "~oStartElement~"];
		this.mock(_Helper).expects("getPrivateAnnotation")
			.withExactArgs("~oStartElement~", "rank").returns(undefined); // created

		assert.throws(function () {
			// code under test
			oCache.readGap(/*oGroupLevelCache*/null, 2, 4, "~oGroupLock~", "~fnDataRequested~");
		}, new Error("Not just a single created persisted"));
	});

	//*********************************************************************************************
[
	"read: expand before read has finished",
	"read: aElements has changed while reading"
].forEach(function (sTitle, i) {
	QUnit.test(sTitle, function (assert) {
		var oCache
			= _AggregationCache.create(this.oRequestor, "~", "", {}, {hierarchyQualifier : "X"}),
			oGroupLevelCache = {
				getQueryOptions : function () { return {}; },
				read : function () {}
				// setQueryOptions : function () {}
			},
			oReadResultFirstNode = {},
			aReadResult = [oReadResultFirstNode, {}];

		oCache.aElements = [,,,
			_AggregationHelper.createPlaceholder(1, 1, oGroupLevelCache),
			_AggregationHelper.createPlaceholder(1, 2, oGroupLevelCache)];

		this.mock(oGroupLevelCache).expects("read")
			.withExactArgs(1, 2, 0, "~oGroupLock~", "~fnDataRequested~", true)
			.callsFake(function () {
				// while the read request is running - simulate an expand
				oCache.aElements.splice(1, 0, {/*oInsertedNode*/});
				if (i) {
					// ... and a concurrent read
					oCache.aElements[4] = oReadResultFirstNode;
				}

				return SyncPromise.resolve({value : aReadResult});
			});
		this.mock(oCache).expects("addElements")
			.withExactArgs(sinon.match.same(aReadResult), 4, sinon.match.same(oGroupLevelCache), 1);

		// code under test
		return oCache.readGap(oGroupLevelCache, 3, 5, "~oGroupLock~", "~fnDataRequested~")
			.then(function () {
				assert.ok(false, "Unexpected success");
			}, function (oError) {
				assert.strictEqual(oError.message, "Collapse or expand before read has finished");
				assert.strictEqual(oError.canceled, true);
			});
	});
});

	//*********************************************************************************************
	QUnit.test("read: collapse before read has finished", function (assert) {
		var oCache
			= _AggregationCache.create(this.oRequestor, "~", "", {}, {hierarchyQualifier : "X"}),
			oGroupLevelCache = {
				getQueryOptions : function () { return {}; },
				read : function () {}
				// setQueryOptions : function () {}
			};

		oCache.aElements = [,,,
			_AggregationHelper.createPlaceholder(1, 1, oGroupLevelCache),
			_AggregationHelper.createPlaceholder(1, 2, oGroupLevelCache)];

		this.mock(oGroupLevelCache).expects("read")
			.withExactArgs(1, 2, 0, "~oGroupLock~", "~fnDataRequested~", true)
			.callsFake(function () {
				return SyncPromise.resolve().then(function () {
					// while the read request is running - simulate a collapse
					oCache.aElements.splice(2, 3);
					return {value : [{}]};
				});
			});
		this.mock(oCache).expects("addElements").never();

		// code under test
		return oCache.readGap(oGroupLevelCache, 3, 5, "~oGroupLock~", "~fnDataRequested~")
			.then(function () {
				assert.ok(false, "Unexpected success");
			}, function (oError) {
				assert.strictEqual(oError.message, "Collapse before read has finished");
				assert.strictEqual(oError.canceled, true);
			});
	});

	//*********************************************************************************************
[false, true].forEach(function (bAsync) {
	QUnit.test("readGap: async=" + bAsync, function (assert) {
		var oCache
			= _AggregationCache.create(this.oRequestor, "~", "", {}, {hierarchyQualifier : "X"}),
			oGroupLevelCache = {
				getQueryOptions : function () { return {}; },
				read : function () {}
				// setQueryOptions : function () {}
			},
			oReadResult = {value : [{}, {}, {}]},
			oResult,
			oPromise = bAsync
				? SyncPromise.resolve(Promise.resolve(oReadResult))
				: SyncPromise.resolve(oReadResult);

		oCache.aElements = [,,,
			_AggregationHelper.createPlaceholder(1, 3, oGroupLevelCache),
			_AggregationHelper.createPlaceholder(1, 4, oGroupLevelCache),
			_AggregationHelper.createPlaceholder(1, 5, oGroupLevelCache)];
		oCache.aElements.$byPredicate = {};
		_Helper.setPrivateAnnotation(oCache.aElements[3], "predicate", "('A')");
		_Helper.setPrivateAnnotation(oCache.aElements[5], "predicate", "('B')");

		this.mock(oGroupLevelCache).expects("read")
			.withExactArgs(3, 3, 0, "~oGroupLock~", "~fnDataRequested~", true).returns(oPromise);
		this.mock(oCache).expects("addElements")
			.withExactArgs(sinon.match.same(oReadResult.value), 3,
				sinon.match.same(oGroupLevelCache), 3);

		// code under test
		oResult = oCache.readGap(oGroupLevelCache, 3, 6, "~oGroupLock~", "~fnDataRequested~");

		assert.deepEqual(oCache.aElements.$byPredicate, bAsync ? {
			"('A')" : SyncPromise.resolve(), // Note: not a strictEqual!
			"('B')" : SyncPromise.resolve()
		} : {});
		if (bAsync) {
			assert.strictEqual(oCache.aElements.$byPredicate["('A')"], oResult);
			assert.strictEqual(oCache.aElements.$byPredicate["('B')"], oResult);
		}

		return oResult;
	});
});

	//*********************************************************************************************
[false, true, "expanding"].forEach(function (vHasCache) {
	[undefined, false, true].forEach(function (bSubtotalsAtBottomOnly) {
		[false, true].forEach(function (bSubtotals) { // JIRA: CPOUI5ODATAV4-825
		var sTitle = "expand: read; has cache = " + vHasCache
				+ ", subtotalsAtBottomOnly = " + bSubtotalsAtBottomOnly
				+ ", subtotals = " + bSubtotals;

		if (vHasCache && bSubtotalsAtBottomOnly !== undefined) {
			return; // skip invalid combination
		}

	QUnit.test(sTitle, function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["group"]
			},
			oAggregationHelperMock = this.mock(_AggregationHelper),
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oCacheMock = this.mock(oCache),
			oCollapsed = {"@$ui5.node.isExpanded" : false},
			aElements = [{
				"@$ui5.node.isExpanded" : vHasCache === "expanding",
				// while 0 would be realistic, we want to test the general case here
				"@$ui5.node.level" : 23
			}, {}, {}],
			oExpanded = {"@$ui5.node.isExpanded" : true},
			oExpandResult = {
				value : [{}, {}, {}, {}, {}]
			},
			oGroupLevelCache = {
				read : function () {}
			},
			oGroupLock = {
				unlock : function () {} // needed for oCache.read() below
			},
			oGroupNode = aElements[0],
			vGroupNodeOrPath = vHasCache === "expanding" ? oGroupNode : "~path~",
			oHelperMock = this.mock(_Helper),
			oPromise,
			bSubtotalsAtBottom = bSubtotals && bSubtotalsAtBottomOnly !== undefined,
			oUpdateAllExpectation,
			that = this;

		if (bSubtotals) {
			oCollapsed.A = "10"; // placeholder for an aggregate with subtotals
		}
		oExpandResult.value.$count = 7;
		_Helper.setPrivateAnnotation(oGroupNode, "predicate", "(~predicate~)");
		if (vHasCache) {
			_Helper.setPrivateAnnotation(oGroupNode, "cache", oGroupLevelCache);
			// simulate that sometimes, this value is already known
			_Helper.setPrivateAnnotation(oGroupNode, "groupLevelCount", 7);
		}
		if (bSubtotalsAtBottomOnly !== undefined) {
			oAggregation.subtotalsAtBottomOnly = bSubtotalsAtBottomOnly;
		}

		// simulate a read
		oCache.iReadLength = 42;
		oCache.aElements = aElements.slice();
		oCache.aElements.$byPredicate = {};
		oCache.aElements.$count = 3;

		oCacheMock.expects("getValue").exactly(vHasCache === "expanding" ? 0 : 1)
			.withExactArgs("~path~").returns(oGroupNode);
		this.mock(_AggregationHelper).expects("getOrCreateExpandedObject")
			.exactly(vHasCache === "expanding" ? 0 : 1)
			.withExactArgs(sinon.match.same(oAggregation), sinon.match.same(oGroupNode))
			.returns(oExpanded);
		oUpdateAllExpectation = oHelperMock.expects("updateAll")
			.exactly(vHasCache === "expanding" ? 0 : 1)
			.withExactArgs(sinon.match.same(oCache.mChangeListeners), "~path~",
				sinon.match.same(oGroupNode), sinon.match.same(oExpanded))
			.callThrough(); // "@$ui5.node.isExpanded" is checked once read has finished
		this.mock(oCache.oTreeState).expects("expand").exactly(vHasCache === "expanding" ? 0 : 1)
			.withExactArgs(sinon.match.same(oGroupNode), "~iLevels~");
		oCacheMock.expects("createGroupLevelCache").exactly(vHasCache ? 0 : 1)
			.withExactArgs(sinon.match.same(oGroupNode)).returns(oGroupLevelCache);
		oHelperMock.expects("setPrivateAnnotation").exactly(vHasCache ? 0 : 1)
			.withExactArgs(sinon.match.same(oGroupNode), "cache",
				sinon.match.same(oGroupLevelCache));
		this.mock(oGroupLevelCache).expects("read")
			.withExactArgs(0, oCache.iReadLength, 0, sinon.match.same(oGroupLock),
				"~fnDataRequested~")
			.returns(SyncPromise.resolve(Promise.resolve(oExpandResult)));
		this.mock(_AggregationHelper).expects("getCollapsedObject")
			.withExactArgs(sinon.match.same(oGroupNode)).returns(oCollapsed);
		oHelperMock.expects("setPrivateAnnotation")
			.withExactArgs(sinon.match.same(oGroupNode), "groupLevelCount", 7);
		oHelperMock.expects("updateAll")
			.withExactArgs(sinon.match.same(oCache.mChangeListeners),
				sinon.match.same(vGroupNodeOrPath), sinon.match.same(oGroupNode),
				{"@$ui5.node.groupLevelCount" : 7});
		oCacheMock.expects("addElements")
			.withExactArgs(sinon.match.same(oExpandResult.value), 1,
				sinon.match.same(oGroupLevelCache), 0)
			.callsFake(addElements); // so that oCache.aElements is actually filled
		oAggregationHelperMock.expects("createPlaceholder")
			.withExactArgs(24, 5, sinon.match.same(oGroupLevelCache)).returns("~placeholder~1");
		oAggregationHelperMock.expects("createPlaceholder")
			.withExactArgs(24, 6, sinon.match.same(oGroupLevelCache)).returns("~placeholder~2");
		if (bSubtotalsAtBottom) {
			this.mock(Object).expects("assign").withExactArgs({}, sinon.match.same(oCollapsed))
				.returns("~oSubtotals~");
			oAggregationHelperMock.expects("getAllProperties")
				.withExactArgs(sinon.match.same(oAggregation)).returns("~aAllProperties~");
			oAggregationHelperMock.expects("setAnnotations")
				.withExactArgs("~oSubtotals~", undefined, true, 23, "~aAllProperties~");
			oHelperMock.expects("setPrivateAnnotation")
				.withExactArgs("~oSubtotals~", "predicate", "(~predicate~,$isTotal=true)");
			oCacheMock.expects("addElements").withExactArgs("~oSubtotals~", 8)
				.callsFake(addElements); // so that oCache.aElements is actually filled
		} else {
			oAggregationHelperMock.expects("getAllProperties").never();
			oAggregationHelperMock.expects("setAnnotations").never();
		}

		// code under test
		oPromise = oCache.expand(
			oGroupLock, vGroupNodeOrPath, "~iLevels~", "~fnDataRequested~"
		).then(function (iResult) {
			var iExpectedCount = bSubtotalsAtBottom ? 8 : 7;

			assert.strictEqual(iResult, iExpectedCount);

			assert.strictEqual(oCache.aElements.length, 3 + iExpectedCount, ".length");
			assert.strictEqual(oCache.aElements.$count, 3 + iExpectedCount, ".$count");
			// check parent node
			assert.strictEqual(oCache.aElements[0], oGroupNode);

			// check expanded nodes
			assert.strictEqual(oCache.aElements[1], oExpandResult.value[0]);
			assert.strictEqual(oCache.aElements[2], oExpandResult.value[1]);
			assert.strictEqual(oCache.aElements[3], oExpandResult.value[2]);
			assert.strictEqual(oCache.aElements[4], oExpandResult.value[3]);
			assert.strictEqual(oCache.aElements[5], oExpandResult.value[4]);

			// check placeholders
			assert.strictEqual(oCache.aElements[6], "~placeholder~1");
			assert.strictEqual(oCache.aElements[7], "~placeholder~2");

			// check moved nodes
			if (bSubtotalsAtBottom) {
				assert.strictEqual(oCache.aElements[9], aElements[1]);
				assert.strictEqual(oCache.aElements[10], aElements[2]);
			} else {
				assert.strictEqual(oCache.aElements[8], aElements[1]);
				assert.strictEqual(oCache.aElements[9], aElements[2]);
			}

			that.mock(oCache.oFirstLevel).expects("read").never();

			return oCache.read(1, 4, 0, oGroupLock).then(function (oResult) {
				assert.strictEqual(oResult.value.length, 4);
				assert.strictEqual(oResult.value.$count, 3 + iExpectedCount);
				oResult.value.forEach(function (oElement, i) {
					assert.strictEqual(oElement, oCache.aElements[i + 1], "index " + (i + 1));
				});
			});
		});

		oUpdateAllExpectation.verify();

		return oPromise;
	});
		});
	});
});

	//*********************************************************************************************
[false, true].forEach(function (bRecursiveHierarchy) {
	QUnit.test("expand: at end, hierarchy=" + bRecursiveHierarchy, function (assert) {
		var oAggregation = bRecursiveHierarchy
				? {expandTo : 5, hierarchyQualifier : "X"}
				: { // filled before by buildApply
					aggregate : {},
					group : {},
					groupLevels : ["group"]
				},
			oAggregationHelperMock = this.mock(_AggregationHelper),
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			aElements = [{}, {}, {
				"@$ui5.node.isExpanded" : false,
				"@$ui5.node.level" : 5
			}],
			oExpanded = {"@$ui5.node.isExpanded" : true},
			oExpandResult = {
				value : [{}, {}, {}, {}, {}]
			},
			oGroupLevelCache = {
				read : function () {}
			},
			oGroupLock = {
				unlock : function () {} // needed for oCache.read() below
			},
			oGroupNode = aElements[2],
			oHelperMock = this.mock(_Helper),
			oPromise,
			oUpdateAllExpectation;

		oExpandResult.value.$count = 7;

		// simulate a read
		oCache.iReadLength = 42;
		oCache.aElements = aElements.slice();
		oCache.aElements.$byPredicate = {};
		oCache.aElements.$count = 3;

		this.mock(oCache).expects("getValue").withExactArgs("~path~").returns(oGroupNode);
		this.mock(_AggregationHelper).expects("getOrCreateExpandedObject")
			.withExactArgs(sinon.match.same(oAggregation), sinon.match.same(oGroupNode))
			.returns(oExpanded);
		oUpdateAllExpectation = oHelperMock.expects("updateAll")
			.withExactArgs(sinon.match.same(oCache.mChangeListeners), "~path~",
				sinon.match.same(oGroupNode), sinon.match.same(oExpanded))
			.callThrough(); // "@$ui5.node.isExpanded" is checked once read has finished
		this.mock(oCache.oTreeState).expects("expand")
			.withExactArgs(sinon.match.same(oGroupNode), "~iLevels~");
		this.mock(oCache).expects("createGroupLevelCache")
			.withExactArgs(sinon.match.same(oGroupNode)).returns(oGroupLevelCache);
		this.mock(oGroupLevelCache).expects("read")
			.withExactArgs(0, oCache.iReadLength, 0, sinon.match.same(oGroupLock),
				"~fnDataRequested~")
			.returns(SyncPromise.resolve(Promise.resolve(oExpandResult)));
		oHelperMock.expects("updateAll")
			.withExactArgs(sinon.match.same(oCache.mChangeListeners), "~path~",
				sinon.match.same(oGroupNode), {"@$ui5.node.groupLevelCount" : 7});
		this.mock(oCache).expects("addElements")
			.withExactArgs(sinon.match.same(oExpandResult.value), 3,
				sinon.match.same(oGroupLevelCache), 0)
			.callsFake(addElements); // so that oCache.aElements is actually filled
		oAggregationHelperMock.expects("createPlaceholder")
			.withExactArgs(6, 5, sinon.match.same(oGroupLevelCache)).returns("~placeholder~1");
		oAggregationHelperMock.expects("createPlaceholder")
			.withExactArgs(6, 6, sinon.match.same(oGroupLevelCache)).returns("~placeholder~2");

		// code under test
		oPromise = oCache.expand(
			oGroupLock, "~path~", "~iLevels~", "~fnDataRequested~"
		).then(function (iResult) {
			assert.strictEqual(iResult, 7);

			assert.strictEqual(oCache.aElements.length, 3 + 7, ".length");
			assert.strictEqual(oCache.aElements.$count, 3 + 7, ".$count");
			assert.strictEqual(oCache.aElements[0], aElements[0]);
			assert.strictEqual(oCache.aElements[1], aElements[1]);

			// check parent node
			assert.strictEqual(oCache.aElements[2], oGroupNode);
			assert.strictEqual(_Helper.getPrivateAnnotation(oGroupNode, "cache"), oGroupLevelCache);

			// check expanded nodes
			assert.strictEqual(oCache.aElements[3], oExpandResult.value[0]);
			assert.strictEqual(oCache.aElements[4], oExpandResult.value[1]);
			assert.strictEqual(oCache.aElements[5], oExpandResult.value[2]);
			assert.strictEqual(oCache.aElements[6], oExpandResult.value[3]);
			assert.strictEqual(oCache.aElements[7], oExpandResult.value[4]);

			// check placeholders
			assert.strictEqual(oCache.aElements[8], "~placeholder~1");
			assert.strictEqual(oCache.aElements[9], "~placeholder~2");
		});

		oUpdateAllExpectation.verify();

		return oPromise;
	});
});

	//*********************************************************************************************
[false, true].forEach(function (bStale) {
	[false, true].forEach(function (bUnifiedCache) {
		const sTitle = "expand: after collapse (w/ 'spliced'); $stale : " + bStale
			+ ", bUnifiedCache : " + bUnifiedCache;
	QUnit.test(sTitle, function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["group"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oCacheMock = this.mock(oCache),
			aElements,
			oGroupLevelCache = {
				read : function () {}
			},
			oGroupLock = {},
			oGroupNode = {
				"@$ui5._" : {
					cache : oGroupLevelCache,
					groupLevelCount : 7,
					spliced : [{
						"@$ui5._" : {placeholder : true},
						"@$ui5.node.level" : 0
					}, {
						"@$ui5._" : {placeholder : true, predicate : "n/a", rank : 24},
						"@$ui5.node.level" : 11
					}, {
						"@$ui5._" : {
							expanding : true,
							parent : oCache.oFirstLevel, // unrealistic!
							predicate : "('C')",
							rank : 25
						},
						"@$ui5.node.level" : 12
					}, {
						"@$ui5._" : {
							parent : oCache.oFirstLevel, // unrealistic!
							predicate : "('created')",
							transientPredicate : "($uid=1-23)"
						},
						"@$ui5.node.level" : 12
					}, {
						"@$ui5._" : {
							parent : oCache.oFirstLevel, // unrealistic!
							predicate : "('A')",
							rank : 27
						},
						"@$ui5.node.level" : 10
					}, {
						"@$ui5._" : {
							predicate : "('selected')"
						},
						"@$ui5.node.level" : 12
					}],
					rank : 42
				},
				"@$ui5.node.isExpanded" : false,
				"@$ui5.node.level" : 5
			},
			oPromise,
			aSpliced,
			oUpdateAllExpectation;

		oCache.bUnifiedCache = bUnifiedCache; // works identically w/ and w/o unified cache
		oGroupNode["@$ui5._"].spliced[200000] = {
			"@$ui5._" : {predicate : "('D')", rank : 200023},
			"@$ui5.node.level" : 10
		};
		aSpliced = oGroupNode["@$ui5._"].spliced.slice();
		if (bStale) {
			oGroupNode["@$ui5._"].spliced.$stale = true;
		}
		oGroupNode["@$ui5._"].spliced.$level = 9;
		oGroupNode["@$ui5._"].spliced.$rank = 12;
		aElements = [{}, oGroupNode, {}, {}];
		oCache.aElements = aElements.slice();
		oCache.aElements.$byPredicate = {};
		oCache.aElements.$count = 4;
		oCacheMock.expects("getValue").withExactArgs("~path~").returns(oGroupNode);
		oUpdateAllExpectation = this.mock(_Helper).expects("updateAll")
			.withExactArgs(sinon.match.same(oCache.mChangeListeners), "~path~",
				sinon.match.same(oGroupNode), {"@$ui5.node.isExpanded" : true})
			.callThrough(); // "@$ui5.node.isExpanded" is checked once read has finished
		this.mock(oCache.oTreeState).expects("expand")
			.withExactArgs(sinon.match.same(oGroupNode), "~iLevels~");
		this.mock(_Helper).expects("copySelected")
			.withExactArgs(sinon.match.same(oCache.aElements),
				sinon.match((aElements0) => aElements0 === oCache.aElements));
		oCacheMock.expects("createGroupLevelCache").never();
		this.mock(oGroupLevelCache).expects("read").never();
		oCacheMock.expects("addElements").never();
		this.mock(_AggregationHelper).expects("createPlaceholder").never();
		oCacheMock.expects("expand")
			.withExactArgs(sinon.match.same(oGroupLock), "~path~", "~iLevels~")
			.callThrough(); // for code under test
		oCacheMock.expects("expand").exactly(bStale ? 0 : 1)
			.withExactArgs(sinon.match.same(_GroupLock.$cached), sinon.match.same(aSpliced[2]))
			.returns(SyncPromise.resolve(100));
		if (bStale) {
			oCacheMock.expects("isSelectionDifferent")
				.withExactArgs(sinon.match.same(aSpliced[2])).returns(false);
			oCacheMock.expects("turnIntoPlaceholder")
				.withExactArgs(sinon.match.same(aSpliced[2]), "('C')");
			oCacheMock.expects("isSelectionDifferent")
				.withExactArgs(sinon.match.same(aSpliced[3])).returns(false);
			oCacheMock.expects("turnIntoPlaceholder")
				.withExactArgs(sinon.match.same(aSpliced[3]), "('created')");
			oCacheMock.expects("isSelectionDifferent")
				.withExactArgs(sinon.match.same(aSpliced[4])).returns(false);
			oCacheMock.expects("turnIntoPlaceholder")
				.withExactArgs(sinon.match.same(aSpliced[4]), "('A')");
			oCacheMock.expects("isSelectionDifferent")
				.withExactArgs(sinon.match.same(aSpliced[5])).returns(true);
			oCacheMock.expects("isSelectionDifferent")
				.withExactArgs(sinon.match.same(aSpliced[200000])).returns(false);
			oCacheMock.expects("turnIntoPlaceholder")
				.withExactArgs(sinon.match.same(aSpliced[200000]), "('D')");
		} else {
			oCacheMock.expects("isSelectionDifferent").never();
			oCacheMock.expects("turnIntoPlaceholder").never();
		}

		// code under test
		oPromise = oCache.expand(oGroupLock, "~path~", "~iLevels~").then(function (iResult) {
			assert.strictEqual(iResult, (bStale ? 0 : 100) + 200001);

			assert.strictEqual(oCache.aElements.length, 200005, ".length");
			assert.strictEqual(oCache.aElements.$count, 200005, ".$count");
			assert.strictEqual(oCache.aElements[0], aElements[0]);
			// check parent node
			assert.strictEqual(oCache.aElements[1], oGroupNode);
			assert.strictEqual(_Helper.getPrivateAnnotation(oGroupNode, "cache"), oGroupLevelCache);
			assert.notOk(_Helper.hasPrivateAnnotation(oGroupNode, "spliced"));

			// check expanded nodes
			assert.deepEqual(Object.keys(oCache.aElements),
				["0", "1", "2", "3", "4", "5", "6", "7", "200002", "200003", "200004",
					"$byPredicate", "$count"]);
			assert.strictEqual(oCache.aElements[2], aSpliced[0]);
			assert.strictEqual(aSpliced[0]["@$ui5.node.level"], 0, "unchanged");
			assert.strictEqual(oCache.aElements[3], aSpliced[1]);
			assert.strictEqual(aSpliced[1]["@$ui5.node.level"], 7);
			assert.strictEqual(aSpliced[1]["@$ui5._"].rank, 24);
			assert.strictEqual(oCache.aElements[4], aSpliced[2]);
			assert.strictEqual(aSpliced[2]["@$ui5.node.level"], 8);
			assert.strictEqual(aSpliced[2]["@$ui5._"].rank, 55);
			assert.strictEqual(_Helper.hasPrivateAnnotation(aSpliced[2], "expanding"), bStale,
				"deleted only if not stale");
			assert.notOk("rank" in aSpliced[3]["@$ui5._"]);
			assert.strictEqual(aSpliced[4]["@$ui5.node.level"], 6);
			assert.strictEqual(aSpliced[4]["@$ui5._"].rank, 57);
			assert.strictEqual(oCache.aElements[200002], aSpliced[200000]);
			assert.strictEqual(aSpliced[200000]["@$ui5.node.level"], 6);
			assert.strictEqual(aSpliced[200000]["@$ui5._"].rank, 200023);

			// check moved nodes
			assert.strictEqual(oCache.aElements[200003], aElements[2]);
			assert.strictEqual(oCache.aElements[200004], aElements[3]);

			assert.deepEqual(oCache.aElements.$byPredicate, bStale ? {
				"('selected')" : aSpliced[5]
			} : {
				"('C')" : aSpliced[2],
				"('created')" : aSpliced[3],
				"($uid=1-23)" : aSpliced[3],
				"('A')" : aSpliced[4],
				"('selected')" : aSpliced[5],
				"('D')" : aSpliced[200000]
			});
		});

		oUpdateAllExpectation.verify();

		return oPromise;
	});
	});
});

	//*********************************************************************************************
	QUnit.test("expand: unified cache", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.bUnifiedCache = true;
		const oGroupNode = {};

		// ensure the collection cache cannot read data
		_Helper.setPrivateAnnotation(oGroupNode, "cache", "~oGroupLevelCache~");
		this.mock(oCache).expects("getValue").withExactArgs("~path~").returns(oGroupNode);
		this.mock(_Helper).expects("updateAll")
			.withExactArgs(sinon.match.same(oCache.mChangeListeners), "~path~",
				sinon.match.same(oGroupNode), {"@$ui5.node.isExpanded" : true});
		this.mock(oCache.oTreeState).expects("expand")
			.withExactArgs(sinon.match.same(oGroupNode), "~iLevels~");
		this.mock(oCache).expects("createGroupLevelCache").never();

		// code under test
		return oCache.expand(
			"~oGroupLock~", "~path~", "~iLevels~", "~fnDataRequested~")
		.then(function (iCount) {
			assert.strictEqual(iCount, -1);
		});
	});

	//*********************************************************************************************
[2, 42].forEach(function (iLevels) {
	QUnit.test("expand: refresh needed, iLevels=" + iLevels, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, {
			hierarchyQualifier : "X"
		});
		const oGroupNode = {};

		// ensure the collection cache cannot read data
		_Helper.setPrivateAnnotation(oGroupNode, "cache", "~oGroupLevelCache~");
		this.mock(oCache).expects("getValue").withExactArgs("~path~").returns(oGroupNode);
		this.mock(_Helper).expects("updateAll")
			.withExactArgs(sinon.match.same(oCache.mChangeListeners), "~path~",
				sinon.match.same(oGroupNode), {"@$ui5.node.isExpanded" : true});
		this.mock(oCache.oTreeState).expects("expand")
			.withExactArgs(sinon.match.same(oGroupNode), iLevels);
		this.mock(oCache).expects("createGroupLevelCache").never();

		// code under test
		return oCache.expand(
			"~oGroupLock~", "~path~", iLevels, "~fnDataRequested~")
		.then(function (iCount) {
			assert.strictEqual(iCount, -1);
		});
	});
});

	//*********************************************************************************************
	QUnit.test("expand: refresh needed, oFirstLevel without aSpliced", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, {
			expandTo : 5,
			hierarchyQualifier : "X"
		});
		const oGroupNode = {"@$ui5.node.level" : 4};

		// Note: no cache in private annotation "parent"
		this.mock(oCache).expects("getValue").withExactArgs("~path~").returns(oGroupNode);
		this.mock(_Helper).expects("updateAll")
			.withExactArgs(sinon.match.same(oCache.mChangeListeners), "~path~",
				sinon.match.same(oGroupNode), {"@$ui5.node.isExpanded" : true});
		this.mock(oCache.oTreeState).expects("expand")
			.withExactArgs(sinon.match.same(oGroupNode), 1);
		this.mock(_Helper).expects("getPrivateAnnotation")
			.withExactArgs(sinon.match.same(oGroupNode), "spliced").returns(undefined);
		this.mock(oCache).expects("createGroupLevelCache").never();

		assert.strictEqual(
			// code under test
			oCache.expand("~oGroupLock~", "~path~", 1, "~fnDataRequested~").getResult(),
			-1
		);
	});

	//*********************************************************************************************
[1E16, Number.MAX_SAFE_INTEGER].forEach(function (iLevels) {
	QUnit.test(`expand: all below node, iLevels=${iLevels}`, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, {
			hierarchyQualifier : "X"
		});
		this.mock(oCache).expects("getValue").withExactArgs("~path~").returns("~oGroupNode~");
		this.mock(_Helper).expects("getPrivateAnnotation")
			.withExactArgs("~oGroupNode~", "spliced").returns("~aSpliced~");
		this.mock(_Helper).expects("updateAll")
			.withExactArgs(sinon.match.same(oCache.mChangeListeners), "~path~", "~oGroupNode~",
				{"@$ui5.node.isExpanded" : true});
		this.mock(oCache.oTreeState).expects("expand")
			.withExactArgs("~oGroupNode~", iLevels);
		this.mock(oCache).expects("validateAndDeleteExpandInfo")
			.withExactArgs("~oGroupLock~", "~oGroupNode~")
			.resolves("n/a");
		this.mock(_Helper).expects("deletePrivateAnnotation").never();
		this.mock(oCache).expects("createGroupLevelCache").never();

		// code under test
		const oPromise = oCache.expand("~oGroupLock~", "~path~", iLevels, "~fnDataRequested~");

		assert.ok(oPromise instanceof SyncPromise);
		assert.ok(oPromise.isPending());

		return oPromise.then((iCount) => {
			assert.strictEqual(iCount, -1);
		});
	});
});

	//*********************************************************************************************
[false, true].forEach(function (bSelf) {
	[1, undefined].forEach(function (iLevels) {
	var sTitle = "expand: collapse " + (bSelf ? "self" : "parent") + " before expand has finished";

	QUnit.test(sTitle, function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["group"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			aElements = [{
				"@$ui5.node.isExpanded" : false,
				"@$ui5.node.level" : 0
			}, {}, {}],
			oExpandResult = {
				value : [{}, {}, {}, {}, {}]
			},
			oGroupLevelCache = {
				read : function () {}
			},
			oGroupLock = {},
			oGroupNode = aElements[0],
			oPromise,
			oUpdateAllExpectation;

		oExpandResult.value.$count = 7;

		// simulate a read
		oCache.iReadLength = 42;
		oCache.aElements = aElements.slice();
		oCache.aElements.$byPredicate = {};
		oCache.aElements.$count = 3;

		this.mock(oCache).expects("getValue").withExactArgs("~path~").returns(oGroupNode);
		oUpdateAllExpectation = this.mock(_Helper).expects("updateAll")
			.withExactArgs(sinon.match.same(oCache.mChangeListeners), "~path~",
				sinon.match.same(oGroupNode), {"@$ui5.node.isExpanded" : true})
			.callThrough(); // "@$ui5.node.isExpanded" is checked once read has finished
		this.mock(oCache.oTreeState).expects("expand")
			.withExactArgs(sinon.match.same(oGroupNode), iLevels);
		this.mock(oCache).expects("createGroupLevelCache")
			.withExactArgs(sinon.match.same(oGroupNode)).returns(oGroupLevelCache);
		this.mock(oGroupLevelCache).expects("read")
			.withExactArgs(0, oCache.iReadLength, 0, sinon.match.same(oGroupLock),
				"~fnDataRequested~")
			.returns(SyncPromise.resolve(Promise.resolve(oExpandResult)));
		this.mock(oCache).expects("addElements").never();
		this.mock(_AggregationHelper).expects("createPlaceholder").never();

		// code under test
		oPromise = oCache.expand(
			oGroupLock, "~path~", iLevels, "~fnDataRequested~"
		).then(function (iResult) {
			assert.strictEqual(iResult, 0);
			if (bSelf) {
				assert.notOk(_Helper.hasPrivateAnnotation(oGroupNode, "spliced"));
			} else {
				assert.strictEqual(_Helper.getPrivateAnnotation(oGroupNode, "expanding"), true);
			}
			assert.deepEqual(oCache.aElements, aElements);
			assert.strictEqual(oCache.aElements.$count, 3);
		});

		oUpdateAllExpectation.verify();

		// collapse before expand has finished
		if (bSelf) {
			oGroupNode["@$ui5.node.isExpanded"] = false;
			_Helper.setPrivateAnnotation(oGroupNode, "spliced", []);
		} else {
			oCache.aElements.shift(); // remove group node from flat list...
			aElements.shift(); // ...and from expectations :-)
		}

		return oPromise;
	});
	});
});

	//*********************************************************************************************
	QUnit.test("expand: read failure", function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["foo"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oCollapsed = {"@$ui5.node.isExpanded" : false},
			oError = new Error(),
			oGroupLevelCache = {
				read : function () {}
			},
			oGroupNode = {
				"@$ui5.node.isExpanded" : false
			},
			that = this;

		this.mock(oCache).expects("getValue").withExactArgs("~path~").returns(oGroupNode);
		this.mock(oCache).expects("createGroupLevelCache")
			.withExactArgs(sinon.match.same(oGroupNode)).returns(oGroupLevelCache);
		this.mock(oCache.oTreeState).expects("expand")
			.withExactArgs(sinon.match.same(oGroupNode), "~iLevels~");
		this.mock(oGroupLevelCache).expects("read")
			.withExactArgs(0, oCache.iReadLength, 0, "~oGroupLock~", "~fnDataRequested~")
			.returns(SyncPromise.resolve(Promise.resolve().then(function () {
				that.mock(_AggregationHelper).expects("getCollapsedObject")
					.withExactArgs(sinon.match.same(oGroupNode)).returns(oCollapsed);
				that.mock(_Helper).expects("updateAll")
					.withExactArgs(sinon.match.same(oCache.mChangeListeners), "~path~",
						sinon.match.same(oGroupNode), sinon.match.same(oCollapsed));
				that.mock(oCache.oTreeState).expects("collapse")
					.withExactArgs(sinon.match.same(oGroupNode));

				throw oError;
			})));

		// code under test
		return oCache.expand(
			"~oGroupLock~", "~path~", "~iLevels~", "~fnDataRequested~")
		.then(function () {
			assert.ok(false);
		}, function (oResult) {
			assert.strictEqual(oResult, oError);
		});
	});

	//*********************************************************************************************
	QUnit.test("expand: Unexpected structural change: groupLevelCount", function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["foo"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oGroupLevelCache = {
				read : function () {}
			},
			oGroupNode = {
				"@$ui5._" : {cache : oGroupLevelCache, groupLevelCount : 41},
				"@$ui5.node.isExpanded" : true
			};

		oCache.aElements = [oGroupNode];
		this.mock(oCache).expects("getValue").never();
		this.mock(_Helper).expects("updateAll").never();
		this.mock(oCache).expects("createGroupLevelCache").never();
		this.mock(oCache.oTreeState).expects("expand").never();
		this.mock(_AggregationHelper).expects("getCollapsedObject")
			.withExactArgs(sinon.match.same(oGroupNode)).returns({});
		this.mock(oGroupLevelCache).expects("read")
			.withExactArgs(0, oCache.iReadLength, 0, "~oGroupLock~", "~fnDataRequested~")
			.resolves({value : {$count : 42}}); // simplified ;-)

		// code under test
		return oCache.expand(
			"~oGroupLock~", oGroupNode, "~iLevels~", "~fnDataRequested~")
		.then(function () {
			assert.ok(false);
		}, function (oError) {
			assert.strictEqual(oError.message, "Unexpected structural change: groupLevelCount");
		});
	});

	//*********************************************************************************************
[false, true].forEach(function (bUntilEnd) { // whether the collapsed children span until the end
	[undefined, false, true].forEach(function (bSubtotalsAtBottomOnly) {
		const bSubtotalsAtBottom = bSubtotalsAtBottomOnly !== undefined;
		const sTitle = `collapse: until end = ${bUntilEnd},
			subtotalsAtBottomOnly = ${bSubtotalsAtBottomOnly}`;

	QUnit.test(sTitle, function (assert) {
		var oAggregation = { // filled before by buildApply
					aggregate : {},
					group : {},
					groupLevels : ["foo"]
				},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oCacheMock = this.mock(oCache),
			bCollapseBottom = bUntilEnd || bSubtotalsAtBottom, // whether bottom line is affected
			oCollapsed = {
				"@$ui5.node.isExpanded" : false,
				A : "10" // placeholder for an aggregate with subtotals
			},
			aElements = [{
				// "@$ui5._" : {predicate : "('0')"},
			}, {
				"@$ui5._" : {
					collapsed : oCollapsed,
					predicate : "('1')",
					rank : "~rank~"
				},
				"@$ui5.node.level" : "~level~"
			}, {
				"@$ui5._" : {predicate : "('2')", transientPredicate : "($uid=1-23)"}
			}, {
				"@$ui5._" : {predicate : "('3')"},
				"@$ui5.node.isExpanded" : true // must not lead into the recursion
			}, {
				// element kept in $byPredicate if recursive hierarchy & selection state differs
				"@$ui5._" : {predicate : "('4')", transientPredicate : "($uid=1-234)"}
			}, {
				"@$ui5._" : {predicate : "('5')"}
				// Note: for bSubtotalsAtBottom, this represents the extra row for subtotals
			}],
			aExpectedElements = [{
				// "@$ui5._" : {predicate : "('0')"},
			}, {
				"@$ui5._" : {
					collapsed : oCollapsed,
					predicate : "('1')",
					spliced : aElements.slice(2, 6),
					rank : "~rank~"
				},
				"@$ui5.node.isExpanded" : false,
				"@$ui5.node.level" : "~level~",
				A : "10" // placeholder for an aggregate with subtotals
			}, {
				"@$ui5._" : {predicate : "('5')"}
			}];

		if (bSubtotalsAtBottom) {
			oAggregation.subtotalsAtBottomOnly = bSubtotalsAtBottomOnly;
			if (bUntilEnd) {
				// simulate that no subtotals are actually being used (JIRA: CPOUI5ODATAV4-825)
				delete oCollapsed.A;
				delete aExpectedElements[1].A;
			}
		}
		oCache.aElements = aElements.slice(); // simulate a read
		oCache.aElements.$count = aElements.length;
		oCache.aElements.$byPredicate = {
			"('0')" : aElements[0],
			"('1')" : aElements[1],
			"('2')" : aElements[2],
			"($uid=1-23)" : aElements[2],
			"('3')" : aElements[3],
			"('4')" : aElements[4],
			"($uid=1-234)" : aElements[4],
			"('5')" : aElements[5]
		};
		oCacheMock.expects("getValue").withExactArgs("~path~").returns(aElements[1]);
		this.mock(_Helper).expects("updateAll")
			.withExactArgs(sinon.match.same(oCache.mChangeListeners), "~path~",
				sinon.match.same(aElements[1]), sinon.match.same(oCollapsed))
			.callThrough();
		this.mock(oCache.oTreeState).expects("collapse")
			.withExactArgs(sinon.match.same(aElements[1]), false, undefined);
		oCacheMock.expects("countDescendants")
			.withExactArgs(sinon.match.same(aElements[1]), 1).returns(bUntilEnd ? 4 : 3);

		oCacheMock.expects("isSelectionDifferent")
			.withExactArgs(sinon.match.same(aElements[2])).returns(false);
		oCacheMock.expects("isSelectionDifferent")
			.withExactArgs(sinon.match.same(aElements[3])).returns(false);
		oCacheMock.expects("isSelectionDifferent")
			.withExactArgs(sinon.match.same(aElements[4])).returns(true);
		oCacheMock.expects("isSelectionDifferent")
			.withExactArgs(sinon.match.same(aElements[5]))
			.exactly(bCollapseBottom ? 1 : 0)
			.returns(false);

		// code under test
		assert.strictEqual(oCache.collapse("~path~"), bCollapseBottom ? 4 : 3,
			"number of removed elements");

		if (bCollapseBottom) { // last element was also a child, not a sibling
			aExpectedElements.pop();
		} else {
			aExpectedElements[1]["@$ui5._"].spliced.pop();
		}
		assert.deepEqual(oCache.aElements, aExpectedElements);
		assert.strictEqual(oCache.aElements[0], aElements[0]);
		assert.strictEqual(oCache.aElements[1], aElements[1]);
		assert.strictEqual(oCache.aElements[2], bCollapseBottom ? undefined : aElements[5]);
		assert.strictEqual(oCache.aElements.$count, aExpectedElements.length);
		assert.deepEqual(oCache.aElements.$byPredicate, bCollapseBottom
			? {
				"('0')" : aElements[0],
				"('1')" : aElements[1],
				"('4')" : aElements[4],
				"($uid=1-234)" : aElements[4]
			} : {
				"('0')" : aElements[0],
				"('1')" : aElements[1],
				"('4')" : aElements[4],
				"($uid=1-234)" : aElements[4],
				"('5')" : aElements[5]
			});
		assert.strictEqual(aElements[1]["@$ui5._"].spliced.$level, "~level~");
		assert.strictEqual(aElements[1]["@$ui5._"].spliced.$rank, "~rank~");
	});
	});
});

	//*********************************************************************************************
[false, true].forEach(function (bUnifiedCache) {
	[1, 2].forEach(function (iExpandTo) {
		[false, true].forEach(function (bSilent) {
			[false, true].forEach(function (bNested) {
				const sTitle = "collapse all, bUnifiedCache=" + bUnifiedCache + ", expandTo="
					+ iExpandTo + ", bSilent=" + bSilent + ", bNested=" + bNested;

	QUnit.test(sTitle, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {},
			{expandTo : iExpandTo, hierarchyQualifier : "X"});
		const aElements = [{
			"@$ui5._" : {predicate : "('0')"}
		}, {
			"@$ui5._" : {
				predicate : "('1')",
				rank : "~rank~"
			},
			"@$ui5.node.level" : "1"
		}, {
			"@$ui5._" : {predicate : "('2')", transientPredicate : "($uid=1-23)"}
		}, {
			"@$ui5._" : {predicate : "('3')", transientPredicate : "($uid=1-24)"}
		}, {
			"@$ui5._" : {predicate : "('4')"},
			"@$ui5.node.isExpanded" : true
		}, {
			"@$ui5._" : {predicate : "('4.1')"}
		}, {
			"@$ui5._" : {predicate : "('4.2')"}
		}, {
			// No calls to #collapse and to #isSelectionDifferent for this element
			"@$ui5._" : {placeholder : "~truthy~", predicate : "('5')"},
			"@$ui5.node.isExpanded" : true
		}, {
			"@$ui5._" : {predicate : "('99')"}
		}];
		const aExpectedElements = [{
			"@$ui5._" : {predicate : "('0')"}
		}, {
			"@$ui5._" : {
				predicate : "('1')",
				spliced : [...aElements.slice(2, 5), aElements[7]],
				rank : "~rank~"
			},
			"@$ui5.node.level" : "1"
		}, {
			"@$ui5._" : {predicate : "('99')"}
		}];

		if (bUnifiedCache || iExpandTo === 2) {
			delete aExpectedElements[1]["@$ui5._"].spliced;
		}

		oCache.bUnifiedCache = bUnifiedCache;
		oCache.aElements = aElements.slice(); // simulate a read
		oCache.aElements.$count = aElements.length;
		oCache.aElements.$byPredicate = {
			"('0')" : aElements[0],
			"('1')" : aElements[1],
			"('2')" : aElements[2],
			"($uid=1-23)" : aElements[2],
			"('3')" : aElements[3],
			"($uid=1-24)" : aElements[3],
			"('4')" : aElements[4],
			// "('4.1')" : aElements[5], // would be deleted by the recursion
			// "('4.2')" : aElements[6], // would be deleted by the recursion
			// "('5')" : aElements[7], // is a placeholder
			"('99')" : aElements[8]
		};
		const oCacheMock = this.mock(oCache);
		oCacheMock.expects("collapse").withExactArgs("~path~", "~oGroupLock~", bSilent, bNested)
			.callThrough();
		oCacheMock.expects("getValue").withExactArgs("~path~").returns(aElements[1]);
		this.mock(_AggregationHelper).expects("getCollapsedObject")
			.withExactArgs(sinon.match.same(aElements[1])).returns("~collapsedObject~");
		this.mock(_Helper).expects("updateAll")
			.withExactArgs(
				bSilent ? {} : sinon.match.same(oCache.mChangeListeners), "~path~",
				sinon.match.same(aElements[1]), "~collapsedObject~");
		this.mock(oCache.oTreeState).expects("collapse")
			.withExactArgs(sinon.match.same(aElements[1]), true, bNested);
		oCacheMock.expects("countDescendants")
			.withExactArgs(sinon.match.same(aElements[1]), 1).returns(6);
		oCacheMock.expects("isSelectionDifferent")
			.withExactArgs(sinon.match.same(aElements[2])).returns(false);
		oCacheMock.expects("isSelectionDifferent")
			.withExactArgs(sinon.match.same(aElements[3])).returns(true);
		oCacheMock.expects("collapse").withExactArgs("('4')", "~oGroupLock~", bSilent, true)
			.callsFake(function () {
				oCache.aElements.splice(5, 2);
				oCache.aElements.$count -= 2;

				return 2;
			});
		oCacheMock.expects("isSelectionDifferent")
			.withExactArgs(sinon.match.same(aElements[4])).returns(false);
		oCacheMock.expects("validateAndDeleteExpandInfo").exactly(bNested ? 0 : 1)
			.withExactArgs("~oGroupLock~", sinon.match.same(aElements[1]));

		assert.strictEqual(
			// code under test
			oCache.collapse("~path~", "~oGroupLock~", bSilent, bNested),
			6);

		assert.deepEqual(oCache.aElements, aExpectedElements);
		assert.strictEqual(oCache.aElements.$count, aExpectedElements.length);
		assert.deepEqual(oCache.aElements.$byPredicate, {
			"('0')" : aExpectedElements[0],
			"('1')" : aExpectedElements[1],
			"('3')" : aElements[3], // because its selection is different
			"($uid=1-24)" : aElements[3],
			"('99')" : aElements[8]
		});
	});
			});
		});
	});
});

	//*********************************************************************************************
[false, true].forEach(function (bHierarchy) {
	const oAggregation = bHierarchy
		? {expandTo : 1, hierarchyQualifier : "X"}
		// Note: a single group level would define the leaf level (JIRA: CPOUI5ODATAV4-2755)
		: {aggregate : {}, group : {}, groupLevels : ["foo", "bar"]};

	QUnit.test(`countDescendants: until end, hierarchy=${bHierarchy}`, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation);
		// Note: the collapsed children span until the end
		oCache.aElements = [{
			// "@$ui5.node.level" : ignored
		}, {
			"@$ui5.node.level" : 5
		}, {
			"@$ui5.node.level" : 6 // child
		}, {
			"@$ui5.node.level" : 7 // grandchild
		}, {
			"@$ui5.node.level" : 6 // child
		}]; // simulate a read

		// code under test
		assert.strictEqual(oCache.countDescendants(oCache.aElements[1], 1), 3,
			"number of removed elements");
	});

	QUnit.test(`countDescendants: single level cache, hierarchy=${bHierarchy}`, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation);
		oCache.aElements = [{
			// "@$ui5.node.level" : ignored
		}, {
			"@$ui5.node.level" : 5
		}, {
			"@$ui5.node.level" : 6 // child
		}, {
			"@$ui5.node.level" : 7 // grandchild
		}, {
			"@$ui5.node.level" : 6 // child
		}, {
			"@$ui5.node.level" : 5 // sibling
		}]; // simulate a read

		// code under test
		assert.strictEqual(oCache.countDescendants(oCache.aElements[1], 1), 3,
			"number of removed elements");
	});

	QUnit.test("countDescendants: sibling on level 1, hierarchy=${bHierarchy}", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation);
		oCache.aElements = [{
			// "@$ui5.node.level" : ignored
		}, {
			"@$ui5.node.level" : 1
		}, {
			"@$ui5.node.level" : 2 // child
		}, {
			"@$ui5.node.level" : 3 // grandchild
		}, {
			"@$ui5.node.level" : 2 // child
		}, {
			// no rank
			"@$ui5.node.level" : 1 // sibling
		}]; // simulate a read

		// code under test
		assert.strictEqual(oCache.countDescendants(oCache.aElements[1], 1), 3,
			"number of removed elements");
	});
});

	//*********************************************************************************************
	QUnit.test("countDescendants: do not collapse grand total", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {},
			{aggregate : {}, group : {}, groupLevels : ["foo"]});
		oCache.aElements = [{
			// "@$ui5.node.level" : ignored
		}, {
			"@$ui5.node.level" : 5
		}, {
			"@$ui5.node.level" : 6 // child
		}, {
			"@$ui5.node.level" : 7 // grandchild
		}, {
			"@$ui5.node.level" : 6 // child
		}, {
			"@$ui5.node.level" : 0 // grand total
		}]; // simulate a read

		// code under test
		assert.strictEqual(oCache.countDescendants(oCache.aElements[1], 1), 3,
			"number of removed elements");
	});

	//*********************************************************************************************
	QUnit.test("countDescendants: level 0 placeholder as sibling", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {},
			{expandTo : 2, hierarchyQualifier : "X"});
		oCache.aElements = [{
			// "@$ui5.node.level" : ignored
		}, {
			"@$ui5._" : {
				descendants : 2
			},
			"@$ui5.node.level" : 1
		}, {
			// no rank
			"@$ui5.node.level" : 2 // created child, filtered out
		}, {
			"@$ui5._" : {
				placeholder : 1,
				rank : "~" // the actual rank does not matter
			},
			"@$ui5.node.level" : 0 // child
		}, {
			// rank does not matter at all
			"@$ui5.node.level" : 3 // grandchild
		}, {
			"@$ui5._" : {
				placeholder : true,
				rank : "~" // the actual rank does not matter
			},
			"@$ui5.node.level" : 0 // child
		}, {
			"@$ui5._" : {
				placeholder : true,
				rank : "~" // the actual rank does not matter
			},
			"@$ui5.node.level" : 0 // sibling
		}]; // simulate a read

		// code under test
		assert.strictEqual(oCache.countDescendants(oCache.aElements[1], 1), 4,
			"number of removed elements");
	});

	//*********************************************************************************************
[false, true].forEach(function (bUnifiedCache) {
	const sTitle = "countDescendants: skip descendants, unified cache: "
		+ bUnifiedCache;
	QUnit.test(sTitle, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, {
			expandTo : bUnifiedCache ? 1 : 3,
			hierarchyQualifier : "X"
		});
		oCache.bUnifiedCache = bUnifiedCache;
		oCache.aElements = [{
			"@$ui5._" : {
				descendants : 41,
				predicate : "('0')",
				rank : "~" // the actual rank does not matter
			},
			"@$ui5.node.isExpanded" : true,
			"@$ui5.node.level" : 1
		}, {
			"@$ui5._" : {
				descendants : 40,
				predicate : "('1')",
				rank : "~" // the actual rank does not matter
			},
			"@$ui5.node.isExpanded" : true,
			"@$ui5.node.level" : 2
		}, {
			"@$ui5._" : {
				predicate : "('2')"
				// no rank
			},
			"@$ui5.node.isExpanded" : true,
			"@$ui5.node.level" : 2
		}, {
			"@$ui5._" : {
				predicate : "('3')",
				rank : "~" // the actual rank does not matter
			},
			"@$ui5.node.level" : 1
		}]; // simulate a read
		for (let i = 0; i < 40; i += 1) { // add 40 placeholders for descendants of ('1')
			oCache.aElements.splice(2, 0, {
				"@$ui5._" : {
					rank : "~" // the actual rank does not matter
				},
				"@$ui5.node.level" : 3
			});
		}

		// code under test
		assert.strictEqual(oCache.countDescendants(oCache.aElements[0], 0), 42,
			"number of removed elements");
	});
});

	//*********************************************************************************************
[false, true].forEach(function (bUnifiedCache) {
	const sTitle = "countDescendants: no descendants at edge of top pyramid, unified cache: "
		+ bUnifiedCache;
	QUnit.test(sTitle, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, {
			expandTo : bUnifiedCache ? 1 : 2,
			hierarchyQualifier : "X"
		});
		oCache.bUnifiedCache = bUnifiedCache;
		oCache.aElements = [{
			"@$ui5._" : {
				descendants : 2,
				rank : "~" // the actual rank does not matter
			},
			"@$ui5.node.isExpanded" : true,
			"@$ui5.node.level" : 1
		}, {
			// no descendants at edge of top pyramid!
			"@$ui5._" : {
				rank : "~" // the actual rank does not matter
			},
			"@$ui5.node.isExpanded" : false,
			"@$ui5.node.level" : 2
		}, {
			// no descendants at edge of top pyramid!
			"@$ui5._" : {
				rank : "~" // the actual rank does not matter
			},
			"@$ui5.node.isExpanded" : false,
			"@$ui5.node.level" : 2
		}, {
			"@$ui5._" : {
				rank : "~" // the actual rank does not matter
			},
			"@$ui5.node.level" : 1
		}]; // simulate a read

		// code under test
		assert.strictEqual(oCache.countDescendants(oCache.aElements[0], 0), 2,
			"number of removed elements");
	});
});

	//*********************************************************************************************
	QUnit.test("countDescendants: nodes w/o rank", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, {
			expandTo : 2,
			hierarchyQualifier : "X"
		});
		oCache.aElements = [{
			"@$ui5._" : {
				// no descendants since it is 0
				rank : "~" // the actual rank does not matter
			},
			"@$ui5.node.level" : 1
		}, {
			"@$ui5.node.level" : 2
		}, {
			"@$ui5.node.level" : 2
		}, {
			"@$ui5._" : {rank : "~"}, // the actual rank does not matter
			"@$ui5.node.level" : 1
		}]; // simulate a read

		// code under test
		assert.strictEqual(oCache.countDescendants(oCache.aElements[0], 0), 2);
	});

	//*********************************************************************************************
	QUnit.test("addElements", function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["foo"],
				$NodeProperty : "SomeNodeID" // unrealistic mix, but never mind
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oPlaceholder42 = _AggregationHelper.createPlaceholder(NaN, 42, "~parent~"),
			oPlaceholder45 = _AggregationHelper.createPlaceholder(NaN, 45, "~parent~"),
			aElements = [{}, {}, oPlaceholder42,,, oPlaceholder45, {}, {}],
			aReadElements = [
				{"@$ui5._" : {predicate : "(1)"}},
				{"@$ui5._" : {predicate : "(2)", transientPredicate : "$uid=id-1-23"}},
				{"@$ui5._" : {predicate : "(3)"}},
				{"@$ui5._" : {predicate : "(4)"}},
				aElements[6]
			];

		oCache.aElements = aElements.slice();
		oCache.aElements.$byPredicate = {
			"(2)" : SyncPromise.resolve() // SyncPromise may safely be overwritten
		};
		const oAggregationHelperMock = this.mock(_AggregationHelper);
		oAggregationHelperMock.expects("beforeOverwritePlaceholder")
			.withExactArgs(sinon.match.same(oPlaceholder42), sinon.match.same(aReadElements[0]),
				"~parent~", 42, "SomeNodeID");
		oAggregationHelperMock.expects("beforeOverwritePlaceholder")
			.withExactArgs(sinon.match.same(oPlaceholder45), sinon.match.same(aReadElements[3]),
				"~parent~", 44, "SomeNodeID");
		this.mock(_Helper).expects("updateNonExisting").never();
		this.mock(oCache).expects("hasPendingChangesForPath").never();

		// code under test
		oCache.addElements(aReadElements, 2, "~parent~", 42);

		assert.strictEqual(oCache.aElements[0], aElements[0]);
		assert.strictEqual(oCache.aElements[1], aElements[1]);
		assert.strictEqual(oCache.aElements[2], aReadElements[0]);
		assert.strictEqual(oCache.aElements[3], aReadElements[1]);
		assert.strictEqual(oCache.aElements[4], aReadElements[2]);
		assert.strictEqual(oCache.aElements[5], aReadElements[3]);
		assert.strictEqual(oCache.aElements[6], aElements[6]);
		assert.strictEqual(oCache.aElements[7], aElements[7]);
		assert.deepEqual(oCache.aElements.$byPredicate, {
			"(1)" : aReadElements[0],
			"(2)" : aReadElements[1],
			"$uid=id-1-23" : aReadElements[1],
			"(3)" : aReadElements[2],
			"(4)" : aReadElements[3]
		});
		assert.deepEqual(oCache.aElements, [
			{},
			{},
			{"@$ui5._" : {parent : "~parent~", predicate : "(1)", rank : 42}},
			{"@$ui5._" // no rank!
				: {parent : "~parent~", predicate : "(2)", transientPredicate : "$uid=id-1-23"}},
			{"@$ui5._" : {parent : "~parent~", predicate : "(3)", rank : 43}},
			{"@$ui5._" : {parent : "~parent~", predicate : "(4)", rank : 44}},
			{},
			{}
		]);
	});

	//*********************************************************************************************
	QUnit.test("addElements: no rank for single created element", function (assert) {
		var oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, {
				hierarchyQualifier : "X",
				$NodeProperty : "SomeNodeID"
			}),
			oPlaceholder42 = _AggregationHelper.createPlaceholder(NaN, 42, "~parent~"),
			aElements = [{}, {}, oPlaceholder42, {}],
			oReadElement = {"@$ui5._" : {predicate : "(2)", transientPredicate : "$uid=id-1-23"}};

		oCache.aElements = aElements.slice();
		oCache.aElements.$byPredicate = {
			"(2)" : SyncPromise.resolve() // SyncPromise may safely be overwritten
		};
		const oAggregationHelperMock = this.mock(_AggregationHelper);
		oAggregationHelperMock.expects("beforeOverwritePlaceholder")
			.withExactArgs(sinon.match.same(oPlaceholder42), sinon.match.same(oReadElement),
				"~parent~", undefined, "SomeNodeID");
		this.mock(_Helper).expects("updateNonExisting").never();
		this.mock(oCache).expects("hasPendingChangesForPath").never();

		// code under test
		oCache.addElements(oReadElement, 2, "~parent~");

		assert.strictEqual(oCache.aElements[0], aElements[0]);
		assert.strictEqual(oCache.aElements[1], aElements[1]);
		assert.strictEqual(oCache.aElements[2], oReadElement);
		assert.strictEqual(oCache.aElements[3], aElements[3]);
		assert.deepEqual(oCache.aElements.$byPredicate, {
			"(2)" : oReadElement,
			"$uid=id-1-23" : oReadElement
		});
		assert.deepEqual(oCache.aElements, [
			{},
			{},
			{"@$ui5._" // no rank!
				: {parent : "~parent~", predicate : "(2)", transientPredicate : "$uid=id-1-23"}},
			{}
		]);
	});

	//*********************************************************************************************
[false, true].forEach(function (bWithParentCache) {
	var sTitle = "addElements: just a single one; w/ parent cache: " + bWithParentCache;

	QUnit.test(sTitle, function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["foo"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oGroupLevelCache = bWithParentCache ? {} : undefined,
			oPlaceholder = _AggregationHelper.createPlaceholder(NaN, 42, oGroupLevelCache),
			aElements = [{}, oPlaceholder, {}],
			oReadElement = {"@$ui5._" : {predicate : "(1)"}};

		oCache.aElements = aElements.slice();
		oCache.aElements.$byPredicate = {
			"(1)" : oReadElement // already there => no problem
		};
		this.mock(_AggregationHelper).expects("beforeOverwritePlaceholder")
			.withExactArgs(sinon.match.same(oPlaceholder), sinon.match.same(oReadElement),
				sinon.match.same(oGroupLevelCache), 42, undefined);
		this.mock(_Helper).expects("updateNonExisting").never();
		this.mock(oCache).expects("hasPendingChangesForPath").never();

		// code under test
		oCache.addElements(oReadElement, 1, oGroupLevelCache, 42);

		assert.strictEqual(oCache.aElements[0], aElements[0]);
		assert.strictEqual(oCache.aElements[1], oReadElement);
		assert.strictEqual(oCache.aElements[2], aElements[2]);
		assert.deepEqual(oCache.aElements.$byPredicate, {"(1)" : oReadElement});
		assert.deepEqual(oReadElement, {
			"@$ui5._" : bWithParentCache
			? {parent : oGroupLevelCache, predicate : "(1)", rank : 42}
			: {predicate : "(1)", rank : 42}
		});
	});
});

	//*********************************************************************************************
	QUnit.test("addElements: array index out of bounds", function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["foo"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oGroupLevelCache = {};

		this.mock(_Helper).expects("updateNonExisting").never();
		this.mock(oCache).expects("hasPendingChangesForPath").never();

		assert.throws(function () {
			// code under test
			oCache.addElements([], -1); // oCache/iStart does not matter here
		}, new Error("Illegal offset: -1"));

		oCache.aElements = [];

		assert.throws(function () {
			// code under test
			oCache.addElements([{}], 0); // oCache/iStart does not matter here
		}, new Error("Array index out of bounds: 0"));

		oCache.aElements = [
			{/* expanded node */},
			_AggregationHelper.createPlaceholder(NaN, 0, oGroupLevelCache)
		];
		oCache.aElements.$byPredicate = {};
		this.mock(_AggregationHelper).expects("beforeOverwritePlaceholder")
			.withExactArgs(sinon.match.same(oCache.aElements[1]), {},
				sinon.match.same(oGroupLevelCache), 0, undefined);

		assert.throws(function () {
			// code under test
			oCache.addElements([{}, {}], 1, oGroupLevelCache, 0);
		}, new Error("Array index out of bounds: 2"));
	});

	//*********************************************************************************************
	QUnit.test("addElements: duplicate key predicate (inside)", function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X"
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oElement = {},
			oGroupLevelCache = {fixDuplicatePredicate : mustBeMocked};

		oCache.aElements.length = 2; // avoid "Array index out of bounds: 1"
		oCache.aElements[0] = {/*unexpected element inside*/};
		oCache.aElements.$byPredicate["foo"] = oCache.aElements[0];
		_Helper.setPrivateAnnotation(oElement, "predicate", "foo");
		this.mock(oGroupLevelCache).expects("fixDuplicatePredicate")
			.withExactArgs(sinon.match.same(oElement), "foo").returns(undefined);
		this.mock(_Helper).expects("updateNonExisting").never();
		this.mock(oCache).expects("hasPendingChangesForPath").never();

		assert.throws(function () {
			// code under test
			oCache.addElements([oElement], 1, oGroupLevelCache); // iStart does not matter here
		}, new Error("Duplicate key predicate: foo"));
	});

	//*********************************************************************************************
	QUnit.test("addElements: fix duplicate key predicate", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, {
			groupLevels : ["foo"]
		});
		oCache.aElements.length = 2; // avoid "Array index out of bounds: 1"
		oCache.aElements[0] = "~any element~";
		oCache.aElements.$byPredicate["foo"] = oCache.aElements[0];
		const oElement = {};
		_Helper.setPrivateAnnotation(oElement, "predicate", "foo");
		this.mock(_AggregationHelper).expects("beforeOverwritePlaceholder").never();
		const oGroupLevelCache = {fixDuplicatePredicate : mustBeMocked};
		this.mock(oGroupLevelCache).expects("fixDuplicatePredicate")
			.withExactArgs(sinon.match.same(oElement), "foo").returns("bar");
		this.mock(_Helper).expects("updateNonExisting")
			.withExactArgs(sinon.match.same(oElement), sinon.match.same(oElement)); // no-op
		this.mock(oCache).expects("hasPendingChangesForPath").never();
		this.mock(_Helper).expects("copySelected").never();

		// code under test
		oCache.addElements([oElement], 1, oGroupLevelCache); // iStart does not matter here

		assert.deepEqual(oCache.aElements, ["~any element~", oElement]);
		assert.deepEqual(oCache.aElements.$byPredicate, {foo : "~any element~", bar : oElement});
	});

	//*********************************************************************************************
[false, true].forEach(function (bIgnore) {
	[false, true].forEach(function (bRecursiveHierarchy) {
		var sTitle = "addElements: known predicate -> kept element, ignore = " + bIgnore
				+ ", recursive hierarchy = " + bRecursiveHierarchy;

	QUnit.test(sTitle, function (assert) {
		var oAggregation = bRecursiveHierarchy ? {
				hierarchyQualifier : "X"
			} : { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["a"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, oAggregation),
			aElements = [{},, {}],
			oElement = {"@odata.etag" : "X"},
			oKeptElement = bIgnore ? {"@odata.etag" : "U"} : {};

		oCache.aElements = aElements.slice();
		oCache.aElements.$byPredicate = {"(1)" : oKeptElement};
		_Helper.setPrivateAnnotation(oElement, "predicate", "(1)");
		this.mock(_Helper).expects("updateNonExisting").exactly(bIgnore ? 0 : 1)
			.withExactArgs(sinon.match.same(oElement), sinon.match.same(oKeptElement));
		this.mock(oCache).expects("hasPendingChangesForPath").exactly(bIgnore ? 1 : 0)
			.withExactArgs("(1)").returns(false);
		this.mock(_Helper).expects("copySelected").exactly(bIgnore ? 1 : 0)
			.withExactArgs(sinon.match.same(oKeptElement), sinon.match.same(oElement));

		// code under test
		oCache.addElements(oElement, 1, "~parent~", 42);

		assert.strictEqual(oCache.aElements.length, 3);
		assert.strictEqual(oCache.aElements[0], aElements[0]);
		assert.strictEqual(oCache.aElements[1], oElement);
		assert.strictEqual(oCache.aElements[2], aElements[2]);
		assert.deepEqual(oCache.aElements.$byPredicate, {"(1)" : oElement}, "no others");
		assert.strictEqual(oCache.aElements.$byPredicate["(1)"], oElement, "right reference");
		assert.deepEqual(oElement, {
			"@odata.etag" : "X",
			"@$ui5._" : {parent : "~parent~", predicate : "(1)", rank : 42}
		});
	});
	});
});

	//*********************************************************************************************
	QUnit.test("addElements: Modified on client and on server", function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X"
			},
			oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, oAggregation),
			aElements = [{},, {}],
			oElement = {"@odata.etag" : "X"},
			oKeptElement = {"@odata.etag" : "U"};

		oCache.aElements = aElements.slice();
		oCache.aElements.$byPredicate = {"(1)" : oKeptElement};
		_Helper.setPrivateAnnotation(oElement, "predicate", "(1)");
		this.mock(_Helper).expects("updateNonExisting").never();
		this.mock(oCache).expects("hasPendingChangesForPath").withExactArgs("(1)").returns(true);

		assert.throws(function () {
			// code under test
			oCache.addElements(oElement, 1, "~parent~", 42);
		}, new Error("Modified on client and on server: Foo(1)"));

		assert.deepEqual(oCache.aElements, aElements);
		assert.strictEqual(oCache.aElements[0], aElements[0]);
		assert.strictEqual(oCache.aElements[2], aElements[2]);
		assert.deepEqual(oCache.aElements.$byPredicate, {"(1)" : oKeptElement}, "no others");
		assert.strictEqual(oCache.aElements.$byPredicate["(1)"], oKeptElement, "right reference");
		assert.deepEqual(oElement, {
			"@odata.etag" : "X",
			"@$ui5._" : {predicate : "(1)"}
		}, "unchanged");
	});

	//*********************************************************************************************
	QUnit.test("addElements: transientPredicate", function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X"
			},
			oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, oAggregation),
			aElements = [{},, {}],
			oElement = {"@$ui5._" : {predicate : "(1)", transientPredicate : "$uid=id-1-23"}};

		oCache.aElements = aElements.slice();
		oCache.aElements.$byPredicate = {};
		this.mock(_AggregationHelper).expects("beforeOverwritePlaceholder").never();
		this.mock(_Helper).expects("updateNonExisting").never();
		this.mock(oCache).expects("hasPendingChangesForPath").never();

		// code under test
		oCache.addElements(oElement, 1, "~parent~", 42);

		assert.strictEqual(oCache.aElements[0], aElements[0]);
		assert.strictEqual(oCache.aElements[1], oElement);
		assert.strictEqual(oCache.aElements[2], aElements[2]);
		assert.deepEqual(oCache.aElements.$byPredicate, {
			"$uid=id-1-23" : oElement,
			"(1)" : oElement
		});
		assert.deepEqual(oCache.aElements, [
			{},
			{"@$ui5._" : {
				parent : "~parent~",
				predicate : "(1)",
				transientPredicate : "$uid=id-1-23"
			}},
			{}
		]);
	});

	//*********************************************************************************************
	QUnit.test("refreshKeptElements", function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X"
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation);

		this.mock(oCache.oFirstLevel).expects("refreshKeptElements").on(oCache)
			.withExactArgs("~oGroupLock~", "~fnOnRemove~", "~bIgnorePendingChanges~",
				/*bDropApply*/true)
			.returns("~result~");

		assert.strictEqual(
			// code under test
			oCache.refreshKeptElements("~oGroupLock~", "~fnOnRemove~", "~bIgnorePendingChanges~",
				"~bDropApply~"),
			"~result~");
	});

	//*********************************************************************************************
	QUnit.test("refreshKeptElements: data aggregation", function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["foo"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation);

		this.mock(oCache.oFirstLevel).expects("refreshKeptElements").never();

		assert.strictEqual(
			// code under test
			oCache.refreshKeptElements("~oGroupLock~", "~fnOnRemove~"),
			undefined,
			"nothing happens");
	});

	//*********************************************************************************************
	QUnit.test("replaceElement", function () {
		const oCache
			= _AggregationCache.create(this.oRequestor, "~", "", {}, {hierarchyQualifier : "X"});
		this.mock(_Cache.prototype).expects("replaceElement").never();
		this.mock(_Helper).expects("buildPath").withExactArgs("/~", "some(42)/path")
			.returns("~buildPath~");
		this.mock(_Helper).expects("getMetaPath").withExactArgs("~buildPath~")
			.returns("~metaPath~");
		this.mock(oCache).expects("visitResponse")
			.withExactArgs("~oElement~", "~mTypeForMetaPath~", "~metaPath~", "some(42)/path(1)",
				undefined, "~bKeepReportedMessagesPath~");
		this.mock(_Helper).expects("updateAll")
			.withExactArgs({}, "", "~oOldElement~", "~oElement~");
		const aElements = [];
		aElements.$byPredicate = {
			"(1)" : "~oOldElement~"
		};

		// code under test
		oCache.replaceElement(aElements, NaN, "(1)", "~oElement~", "~mTypeForMetaPath~",
			"some(42)/path", "~bKeepReportedMessagesPath~");
	});

	//*********************************************************************************************
[false, true].forEach((bGroup) => {
	QUnit.test(`findIndex: ${bGroup ? "group" : "first"} level cache`, function (assert) {
		const oCache
			= _AggregationCache.create(this.oRequestor, "~", "", {}, {hierarchyQualifier : "X"});
		oCache.aElements = ["A", "B", "C", "n/a"];
		const oHelperMock = this.mock(_Helper);
		oHelperMock.expects("getPrivateAnnotation").withExactArgs("A", "rank").returns(0);
		// NO! oHelperMock.expects("getPrivateAnnotation").withExactArgs("A", "parent");
		oHelperMock.expects("getPrivateAnnotation").withExactArgs("B", "rank").returns(1);
		oHelperMock.expects("getPrivateAnnotation").withExactArgs("B", "parent").returns("n/a");
		oHelperMock.expects("getPrivateAnnotation").withExactArgs("C", "rank").returns(1);
		oHelperMock.expects("getPrivateAnnotation").withExactArgs("C", "parent")
			.returns(bGroup ? "~oCache~" : oCache.oFirstLevel);

		// code under test
		assert.strictEqual(oCache.findIndex(1, bGroup ? "~oCache~" : undefined), 2);
	});
});

	//*********************************************************************************************
	QUnit.test("getInsertIndex", function (assert) {
		const oCache
			= _AggregationCache.create(this.oRequestor, "~", "", {}, {hierarchyQualifier : "X"});
		oCache.aElements = [{
			"@$ui5._" : {predicate : "('42')", rank : 42} // out of place!
		}, {
			"@$ui5._" : {predicate : "('1')", rank : 1}
		}, {
			"@$ui5._" : {predicate : "('3')", rank : 3}
		}];
		const oTreeStateMock = this.mock(oCache.oTreeState);
		oTreeStateMock.expects("isOutOfPlace").thrice().withExactArgs("('42')").returns(true);
		oTreeStateMock.expects("isOutOfPlace").withExactArgs("('1')").returns(false);
		oTreeStateMock.expects("isOutOfPlace").withExactArgs("('3')").returns(false);

		// code under test
		assert.strictEqual(oCache.getInsertIndex(0), 1);

		// code under test
		assert.strictEqual(oCache.getInsertIndex(2), 2);

		// code under test
		assert.strictEqual(oCache.getInsertIndex(4), 3);
	});

	//*********************************************************************************************
	QUnit.test("getParentIndex", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {},
			{hierarchyQualifier : "X"});

		oCache.aElements[0] = {
			"@$ui5.node.level" : 0
		};
		oCache.aElements[1] = {
			"@$ui5.node.level" : 1
		};
		oCache.aElements[2] = {
			"@$ui5.node.level" : 2
		};
		oCache.aElements[3] = {
			"@$ui5.node.level" : 3
		};
		oCache.aElements[4] = {
			"@$ui5.node.level" : 2
		};

		this.mock(oCache).expects("isAncestorOf").never();

		// code under test
		assert.strictEqual(oCache.getParentIndex(0), -1);
		assert.strictEqual(oCache.getParentIndex(1), -1);
		assert.strictEqual(oCache.getParentIndex(2), 1);
		assert.strictEqual(oCache.getParentIndex(3), 2);
		assert.strictEqual(oCache.getParentIndex(4), 1);
	});

	//*********************************************************************************************
	QUnit.test("getParentIndex: with gaps", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {},
			{hierarchyQualifier : "X"});
		const oCacheMock = this.mock(oCache);

		oCache.aElements[0] = {
			"@$ui5.node.level" : 1
		};
		oCache.aElements[1] = {
			// parent of 3
			"@$ui5.node.level" : 2
		};
		oCache.aElements[2] = {
			"@$ui5.node.level" : 0
		};
		oCache.aElements[3] = {
			"@$ui5.node.level" : 3
		};
		oCache.aElements[4] = {
			"@$ui5.node.level" : 2
		};
		oCache.aElements[5] = {
			// parent of 6 not yet loaded
			"@$ui5.node.level" : 0
		};
		oCache.aElements[6] = {
			"@$ui5.node.level" : 3
		};
		oCache.aElements[7] = {
			// parent of 8 not yet loaded
			"@$ui5.node.level" : 0
		};
		oCache.aElements[8] = {
			"@$ui5.node.level" : 5
		};

		oCacheMock.expects("isAncestorOf").withExactArgs(1, 3).returns(true);

		// code under test
		assert.strictEqual(oCache.getParentIndex(3), 1);

		oCacheMock.expects("isAncestorOf").withExactArgs(0, 4).returns(true);

		// code under test
		assert.strictEqual(oCache.getParentIndex(4), 0);

		oCacheMock.expects("isAncestorOf").withExactArgs(4, 6).returns(false);

		// code under test
		assert.strictEqual(oCache.getParentIndex(6), undefined);

		// no addt'l call of #isAncestorOf

		// code under test
		assert.strictEqual(oCache.getParentIndex(8), undefined);
	});

	//*********************************************************************************************
[undefined, "~group~"].forEach(function (sGroupId) {
	[false, true].forEach(function (bHasGrandTotal) {
		var sTitle = "reset: sGroupId = " + sGroupId + ", has grand total = " + bHasGrandTotal;

	QUnit.test(sTitle, function (assert) {
		var oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, {
				hierarchyQualifier : "X"
			}),
			oFirstLevel = oCache.oFirstLevel,
			aKeptElementPredicates = ["foo", "bar"],
			oNewAggregation = {
				hierarchyQualifier : "Y"
			};

		oCache.aElements.$byPredicate = {
			bar : {
				"@$ui5._" : {a : 0, b : 1, predicate : "bar"},
				"@$ui5.node.isExpanded" : false,
				"@$ui5.node.isTotal" : "n/a",
				"@$ui5.node.level" : 1,
				name : "bar"
			},
			baz : {
				"@$ui5._" : {a : -1, b : 2, predicate : "baz"},
				"@$ui5.node.isExpanded" : true,
				"@$ui5.node.isTotal" : "n/a",
				"@$ui5.node.level" : 2,
				name : "baz"
			},
			foo : {
				"@$ui5._" : {a : -2, b : 3, predicate : "foo"},
				"@$ui5.node.isExpanded" : undefined,
				"@$ui5.node.isTotal" : "n/a",
				"@$ui5.node.level" : 3,
				name : "foo"
			}
		};
		oCache.oCountPromise = "~oCountPromise~";
		oCache.bUnifiedCache = "~bUnifiedCache~";
		oCache.oGrandTotalPromise = "~oGrandTotalPromise~";
		const oResetExpectation = this.mock(oCache.oFirstLevel).expects("reset").on(oCache)
			.withExactArgs(sinon.match.same(aKeptElementPredicates), sGroupId, "~mQueryOptions~")
			.callsFake(function () {
				oCache.oBackup = sGroupId ? {} : null;
			});
		const oTreeStateResetExpectation = this.mock(oCache.oTreeState).expects("reset")
			.exactly(sGroupId ? 0 : 1).withExactArgs();
		const oGetExpandLevelsExpectation = this.mock(oCache.oTreeState).expects("getExpandLevels")
			.withExactArgs().returns("~sExpandLevels~");
		this.mock(_AggregationHelper).expects("hasGrandTotal")
			.withExactArgs(sinon.match.same(oNewAggregation.aggregate)).returns(bHasGrandTotal);
		const oDoResetExpectation = this.mock(oCache).expects("doReset")
			.withExactArgs(sinon.match.same(oNewAggregation), bHasGrandTotal);

		// code under test
		oCache.reset(aKeptElementPredicates, sGroupId, "~mQueryOptions~", oNewAggregation);

		if (!sGroupId) {
			sinon.assert.callOrder(oTreeStateResetExpectation, oGetExpandLevelsExpectation);
		}
		sinon.assert.callOrder(oResetExpectation, oGetExpandLevelsExpectation, oDoResetExpectation);
		assert.strictEqual(oNewAggregation.$ExpandLevels, "~sExpandLevels~");
		assert.deepEqual(oCache.aElements.$byPredicate, {
			bar : {
				"@$ui5._" : {predicate : "bar"},
				"@$ui5.node.isTotal" : "n/a",
				name : "bar"
			},
			baz : {
				"@$ui5._" : {a : -1, b : 2, predicate : "baz"},
				"@$ui5.node.isExpanded" : true,
				"@$ui5.node.isTotal" : "n/a",
				"@$ui5.node.level" : 2,
				name : "baz"
			},
			foo : {
				"@$ui5._" : {predicate : "foo"},
				"@$ui5.node.isTotal" : "n/a",
				name : "foo"
			}
		});
		if (sGroupId) {
			assert.deepEqual(oCache.oBackup, {
				oCountPromise : "~oCountPromise~",
				oFirstLevel : oFirstLevel,
				oGrandTotalPromise : "~oGrandTotalPromise~",
				bUnifiedCache : "~bUnifiedCache~"
			});
			assert.strictEqual(oCache.oBackup.oFirstLevel, oFirstLevel);
			assert.strictEqual(oCache.bUnifiedCache, true);
		}
	});
	});
});

	//*********************************************************************************************
	QUnit.test("reset: placeholder", function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X"
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			sToString = oCache.sToString,
			oFirstLevel = oCache.oFirstLevel,
			aKeptElementPredicates = ["foo"];

		oCache.aElements.$byPredicate = {foo : {}};
		this.mock(_Helper).expects("hasPrivateAnnotation")
			.withExactArgs(sinon.match.same(oCache.aElements.$byPredicate.foo), "placeholder")
			.returns(true);
		this.mock(oCache.oFirstLevel).expects("reset").never();
		this.mock(oCache).expects("doReset").never();

		assert.throws(function () {
			// code under test
			oCache.reset(aKeptElementPredicates);
		}, new Error("Unexpected placeholder"));

		assert.strictEqual(oCache.oAggregation, oAggregation, "unchanged");
		assert.deepEqual(oCache.oAggregation, {hierarchyQualifier : "X"}, "unchanged");
		assert.strictEqual(oCache.sToString, sToString, "unchanged");
		assert.strictEqual(oCache.oFirstLevel, oFirstLevel, "unchanged");
	});

	//*********************************************************************************************
	QUnit.test("reset: Unsupported grouping via sorter", function (assert) {
		var oCache = _AggregationCache.create(this.oRequestor, "~", "", {},
				{hierarchyQualifier : "X"});

		this.mock(oCache.oFirstLevel).expects("reset").never();
		this.mock(oCache).expects("doReset").never();

		assert.throws(function () {
			// code under test
			oCache.reset([], "", {}, undefined, /*bIsGrouped*/true);
		}, new Error("Unsupported grouping via sorter"));
	});

	//*********************************************************************************************
[false, true].forEach(function (bReally) {
	QUnit.test("restore: bReally = " + bReally, function (assert) {
		var oCache = _AggregationCache.create(this.oRequestor, "~", "", {$count : true}, {
				hierarchyQualifier : "X"
			}),
			oNewFirstLevel = {
				restore : function () {}
			},
			oOldFirstLevel = oCache.oFirstLevel;

		oCache.bUnifiedCache = "~bOldUnifiedCache~";
		oCache.oBackup = bReally
			? {
				oCountPromise : "~oNewCountPromise~",
				oFirstLevel : oNewFirstLevel,
				oGrandTotalPromise : "~oNewGrandTotalPromise~",
				bUnifiedCache : "~bNewUnifiedCache~"
			}
			: null;
		oCache.oCountPromise = "~oOldCountPromise~";
		oCache.oGrandTotalPromise = "~oOldGrandTotalPromise~";
		this.mock(bReally ? oNewFirstLevel : oOldFirstLevel).expects("restore").on(oCache)
			.withExactArgs(bReally)
			.callsFake(function () {
				oCache.oBackup = null; // must not be used anymore after this call
			});

		// code under test
		oCache.restore(bReally);

		assert.strictEqual(oCache.oCountPromise,
			bReally ? "~oNewCountPromise~" : "~oOldCountPromise~");
		assert.strictEqual(oCache.oFirstLevel, bReally ? oNewFirstLevel : oOldFirstLevel);
		assert.strictEqual(oCache.oGrandTotalPromise,
			bReally ? "~oNewGrandTotalPromise~" : "~oOldGrandTotalPromise~");
		assert.strictEqual(oCache.bUnifiedCache,
			bReally ? "~bNewUnifiedCache~" : "~bOldUnifiedCache~");
	});
});

	//*********************************************************************************************
	QUnit.test("getDownloadQueryOptions", function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["a"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation);

		this.mock(_AggregationHelper).expects("filterOrderby")
			.withExactArgs("~mQueryOptions~", sinon.match.same(oAggregation))
			.returns("~mFilteredQueryOptions~");
		this.mock(_AggregationHelper).expects("buildApply")
			.withExactArgs(sinon.match.same(oAggregation), "~mFilteredQueryOptions~", 0, true)
			.returns("~result~");

		// code under test
		assert.strictEqual(oCache.getDownloadQueryOptions("~mQueryOptions~"), "~result~");
	});

	//*********************************************************************************************
[undefined, false, true].forEach(function (bCount) {
	QUnit.test("getDownloadQueryOptions: recursive hierarchy, bCount=" + bCount, function (assert) {
		var oAggregation = {hierarchyQualifier : "X"},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			mQueryOptions = {
				$expand : {EMPLOYEE_2_TEAM : null},
				$filter : "age gt 40",
				$orderby : "TEAM_ID desc",
				$search : "OR",
				$select : ["Name"],
				foo : "bar",
				"sap-client" : "123"
			},
			sQueryOptions;

		if (bCount !== undefined) {
			mQueryOptions.$count = bCount;
		}
		sQueryOptions = JSON.stringify(mQueryOptions);
		this.mock(_AggregationHelper).expects("filterOrderby").never();
		this.mock(_AggregationHelper).expects("buildApply")
			.withExactArgs(sinon.match.same(oAggregation), {
					$expand : {EMPLOYEE_2_TEAM : null},
					$filter : "age gt 40",
					$orderby : "TEAM_ID desc",
					$search : "OR",
					$select : ["Name"],
					foo : "bar",
					"sap-client" : "123"
				}, 0, true)
			.returns("~result~");

		// code under test
		assert.strictEqual(oCache.getDownloadQueryOptions(mQueryOptions), "~result~");

		assert.strictEqual(JSON.stringify(mQueryOptions), sQueryOptions, "unchanged");
	});
});

	//*********************************************************************************************
	QUnit.test("getCreatedElements", function (assert) {
		// code under test
		assert.deepEqual(_AggregationCache.prototype.getCreatedElements(), []);
	});

	//*********************************************************************************************
	QUnit.test("getElements: non-empty path is forbidden", function (assert) {
		assert.throws(function () {
			// code under test
			_AggregationCache.prototype.getElements("some/relative/path");
		}, new Error("Unsupported path: some/relative/path"));
	});

	//*********************************************************************************************
	QUnit.test("getElements", function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["a"]
			},
			aAllElements,
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oPlaceholder0 = {"@$ui5._" : {placeholder : true}}, // this is what counts ;-)
			oPlaceholder2 = _AggregationHelper.createPlaceholder(1, 2, {/*oParentCache*/});

		oCache.aElements.$count = 42;
		this.mock(oCache.aElements).expects("slice").withExactArgs("~iStart~", "~iEnd~")
			.returns([oPlaceholder0, "~oElement1~", oPlaceholder2, "~oElement3~"]);

		// code under test
		aAllElements = oCache.getElements("", "~iStart~", "~iEnd~");

		assert.deepEqual(aAllElements, [undefined, "~oElement1~", undefined, "~oElement3~"]);
		assert.strictEqual(aAllElements.$count, 42);
	});

	//*********************************************************************************************
	QUnit.test("beforeRequestSideEffects: Missing recursive hierarchy", function (assert) {
		var oAggregation = { // filled before by buildApply
				aggregate : {},
				group : {},
				groupLevels : ["a"]
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation);

		assert.throws(function () {
			// code under test
			oCache.beforeRequestSideEffects({});
		}, new Error("Missing recursive hierarchy"));
	});

	//*********************************************************************************************
[false, true].forEach(function (bIn) {
	QUnit.test("beforeRequestSideEffects: NodeProperty already in = " + bIn, function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X",
				$NodeProperty : "SomeNodeID"
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			mQueryOptions = {
				$apply : "A.P.P.L.E.", // dropped
				$count : true,
				$expand : {EMPLOYEE_2_TEAM : null},
				$filter : "age gt 40",
				$orderby : "TEAM_ID desc",
				$search : "OR",
				$select : bIn ? ["Name", "SomeNodeID", "XYZ"] : ["Name", "XYZ"],
				foo : "bar",
				"sap-client" : "123"
			};

		// code under test
		oCache.beforeRequestSideEffects(mQueryOptions);

		assert.deepEqual(mQueryOptions, {
			$count : true,
			$expand : {EMPLOYEE_2_TEAM : null},
			$filter : "age gt 40",
			$orderby : "TEAM_ID desc",
			$search : "OR",
			$select : bIn ? ["Name", "SomeNodeID", "XYZ"] : ["Name", "XYZ", "SomeNodeID"],
			foo : "bar",
			"sap-client" : "123"
		}, "only $apply is dropped");
	});
});

	//*********************************************************************************************
	QUnit.test("beforeUpdateSelected", function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X",
				$NodeProperty : "Some/NodeID"
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oError = new Error("Unexpected structural change: Some/NodeID from ... to ...");

		oCache.aElements.$byPredicate = {
			"('A')" : "~oPlaceholder~"
		};
		this.mock(_AggregationHelper).expects("checkNodeProperty")
			.withExactArgs("~oPlaceholder~", "~oNewValue~", "Some/NodeID", true)
			.throws(oError);

		assert.throws(function () {
			// code under test
			oCache.beforeUpdateSelected("('A')", "~oNewValue~");
		}, oError);
	});

	//*********************************************************************************************
	QUnit.test("turnIntoPlaceholder", function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X"
			},
			oAggregationHelperMock = this.mock(_AggregationHelper),
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oHelperMock = this.mock(_Helper),
			oParentCache = {
				drop : function () {}
			};

		oCache.aElements.$byPredicate = {
			"('A')" : "~a~",
			"('B')" : "~b~",
			"('C')" : "~c~"
		};

		oHelperMock.expects("hasPrivateAnnotation")
			.withExactArgs("~oElementB~", "placeholder").returns(false);
		oHelperMock.expects("setPrivateAnnotation").withExactArgs("~oElementB~", "placeholder", 1);
		oAggregationHelperMock.expects("markSplicedStale").withExactArgs("~oElementB~");
		oHelperMock.expects("getPrivateAnnotation").withExactArgs("~oElementB~", "rank")
			.returns(42);
		oHelperMock.expects("getPrivateAnnotation").withExactArgs("~oElementB~", "parent")
			.returns(oParentCache);
		this.mock(oParentCache).expects("drop").withExactArgs(42, "('B')", true);

		// code under test
		oCache.turnIntoPlaceholder("~oElementB~", "('B')");

		assert.deepEqual(oCache.aElements.$byPredicate, {
			"('A')" : "~a~",
			"('C')" : "~c~"
		});

		oHelperMock.expects("hasPrivateAnnotation")
			.withExactArgs("~oElementC~", "placeholder").returns(false);
		oHelperMock.expects("setPrivateAnnotation").withExactArgs("~oElementC~", "placeholder", 1);
		oAggregationHelperMock.expects("markSplicedStale").withExactArgs("~oElementC~");
		oHelperMock.expects("getPrivateAnnotation").withExactArgs("~oElementC~", "rank")
			.returns(undefined); // simulate a created element
		oHelperMock.expects("getPrivateAnnotation").withExactArgs("~oElementC~", "parent").never();
		// no drop!

		// code under test
		oCache.turnIntoPlaceholder("~oElementC~", "('C')");

		assert.deepEqual(oCache.aElements.$byPredicate, {
			"('A')" : "~a~"
		});

		oCache.aElements = null; // do not touch ;-)
		// no other method calls expected!
		oHelperMock.expects("hasPrivateAnnotation")
			.withExactArgs("~oElement~", "placeholder").returns(true);

		// code under test
		oCache.turnIntoPlaceholder("~oElement~", "n/a");
	});

	//*********************************************************************************************
	QUnit.test("isAncestorOf: simple cases", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, {
			hierarchyQualifier : "X"
		});
		this.mock(oCache).expects("countDescendants").never();

		// code under test
		assert.strictEqual(oCache.isAncestorOf(23, 23), true);

		// code under test
		assert.strictEqual(oCache.isAncestorOf(42, 23), false);

		oCache.aElements[17] = {"@$ui5.node.isExpanded" : false};

		// code under test
		assert.strictEqual(oCache.isAncestorOf(17, 18), false);

		oCache.aElements[18] = {
			"@$ui5.node.isExpanded" : true,
			"@$ui5.node.level" : 3
		};
		oCache.aElements[19] = {
			"@$ui5.node.level" : 3 // same level
		};

		// code under test
		assert.strictEqual(oCache.isAncestorOf(18, 19), false);

		oCache.aElements[20] = {
			"@$ui5.node.level" : 2 // lower level
		};

		// code under test
		assert.strictEqual(oCache.isAncestorOf(18, 20), false);
	});

	//*********************************************************************************************
[-1, 0, +1].forEach((iDelta, i) => {
	QUnit.test("isAncestorOf: countDescendants #" + i, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.aElements[23] = {
			"@$ui5.node.isExpanded" : true,
			"@$ui5.node.level" : 3
		};
		oCache.aElements[42] = {
			"@$ui5.node.level" : 4
		};
		this.mock(oCache).expects("countDescendants")
			.withExactArgs(sinon.match.same(oCache.aElements[23]), 23).returns(42 - 23 + iDelta);

		// code under test
		assert.strictEqual(oCache.isAncestorOf(23, 42), i > 0);
	});
});

	//*********************************************************************************************
[undefined, false, true].forEach((bElementSelected) => {
	[undefined, false, true].forEach((bCollectionSelected) => {
		const sTitle = `isSelectionDifferent: element selected = ${bElementSelected},
			collection selected = ${bCollectionSelected}`;

	QUnit.test(sTitle, function (assert) {
		const oCache = {
			aElements : []
		};
		oCache.aElements["@$ui5.context.isSelected"] = bCollectionSelected;
		const oElement = {"@$ui5.context.isSelected" : bElementSelected};

		assert.strictEqual(
			// code under test
			_AggregationCache.prototype.isSelectionDifferent.call(oCache, oElement),
			!!bElementSelected !== !!bCollectionSelected);
	});
	});
});

	//*********************************************************************************************
	QUnit.test("keepOnlyGivenElements: empty", function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X"
			},
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation);

		// code under test
		assert.deepEqual(oCache.keepOnlyGivenElements([]), []);
	});

	//*********************************************************************************************
	QUnit.test("keepOnlyGivenElements", function (assert) {
		var oAggregation = {
				hierarchyQualifier : "X"
			},
			oAggregationHelperMock = this.mock(_AggregationHelper),
			oCache = _AggregationCache.create(this.oRequestor, "~", "", {}, oAggregation),
			oElementA = {
				"@$ui5._" : {predicate : "('A')", transientPredicate : "($uid=4-56)"}
			},
			aElements = [],
			aResult;

		aElements.$byPredicate = {
			"('A')" : oElementA,
			"('B')" : {
				"@$ui5._" : {predicate : "('B')"}
			}, "('C')" : {
				"@$ui5._" : {predicate : "('C')"}
			}, "($uid=1-23)" : {
				"@$ui5._" : {transientPredicate : "($uid=1-23)"} // must be ignored
			}, "($uid=4-56)" : oElementA
		};

		oCache.aElements.$byPredicate = aElements.$byPredicate;
		oAggregationHelperMock.expects("markSplicedStale")
			.withExactArgs(sinon.match.same(aElements.$byPredicate["('A')"]));
		this.mock(oCache).expects("turnIntoPlaceholder")
			.withExactArgs(sinon.match.same(aElements.$byPredicate["('B')"]), "('B')");
		oAggregationHelperMock.expects("markSplicedStale")
			.withExactArgs(sinon.match.same(aElements.$byPredicate["('C')"]));

		// code under test
		aResult = oCache.keepOnlyGivenElements(["('A')", "('C')"]);

		assert.strictEqual(aResult.length, 2);
		assert.strictEqual(aResult[0], aElements.$byPredicate["('A')"]);
		assert.strictEqual(aResult[1], aElements.$byPredicate["('C')"]);
	});

	//*********************************************************************************************
	QUnit.test("move: PATCH failure", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "n/a", "", {}, {
				$ParentNavigationProperty : "myParent",
				expandTo : 1E16,
				hierarchyQualifier : "X"
			});
		assert.strictEqual(oCache.bUnifiedCache, true);
		oCache.aElements.$byPredicate["('23')"] = "~oChildNode~";
		oCache.aElements.$byPredicate["('42')"] = {"@$ui5.node.isExpanded" : true}; // parent
		const oTreeStateMock = this.mock(oCache.oTreeState);
		oTreeStateMock.expects("isOutOfPlace").withExactArgs("('23')").returns(false);
		oTreeStateMock.expects("isOutOfPlace").withExactArgs("('42')").returns(false);
		oTreeStateMock.expects("deleteOutOfPlace").never();
		oTreeStateMock.expects("expand").never();
		this.mock(_Helper).expects("hasPrivateAnnotation").never();
		const oError = new Error("This call intentionally failed");
		const oRequestExpectation = this.mock(this.oRequestor).expects("request")
			.withExactArgs("PATCH", "Foo('23')", "~oGroupLock~", {
					"If-Match" : "~oChildNode~",
					Prefer : "return=minimal"
				}, {"myParent@odata.bind" : "Foo('42')"},
				/*fnSubmit*/null, /*fnCancel*/sinon.match.func)
			.rejects(oError);
		this.mock(oCache).expects("requestRank")
			.withExactArgs("~oChildNode~", "~oGroupLock~", false)
			.rejects("n/a");

		const {promise : oSyncPromise, refresh : bRefresh}
			// code under test
			= oCache.move("~oGroupLock~", "Foo('23')", "Foo('42')");

		assert.strictEqual(oSyncPromise.isPending(), true);
		assert.strictEqual(bRefresh, false);

		// code under test (invoke fnCancel which does nothing)
		oRequestExpectation.args[0][6]();

		return oSyncPromise.then(function () {
				assert.ok(false, "unexpected success");
			}, function (oError0) {
				assert.strictEqual(oError0, oError);
			});
	});

[undefined, "~iRank~"].forEach((vRank, i) => {
	//* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
	async function test(self, assert, oCache, sParent = null, fnAssert = () => {}, bCopy = false) {
		const oChildNode = {
			"@$ui5.context.isTransient" : "n/a"
		};
		oCache.aElements.$byPredicate["('23')"] = oChildNode;
		const oGroupLock = {getUnlockedCopy : mustBeMocked};
		const oRequestorMock = self.mock(self.oRequestor);
		self.mock(oCache).expects("getTypes").exactly(bCopy ? 1 : 0).withExactArgs()
			.returns({"/~sMetaPath~" : "~oType~"});
		let mQueryOptions;
		self.mock(_Helper).expects("selectKeyProperties").exactly(bCopy ? 1 : 0)
			.withExactArgs({$select : []}, "~oType~").callsFake((mQueryOptions0) => {
				mQueryOptions = mQueryOptions0;
			});
		oRequestorMock.expects("buildQueryString").exactly(bCopy ? 1 : 0)
			.withExactArgs("/~sMetaPath~",
				sinon.match((mQueryOptions0) => mQueryOptions0 === mQueryOptions),
				false, true)
			.returns("?~sSelect~");
		self.mock(oGroupLock).expects("getUnlockedCopy").exactly(bCopy ? 1 : 0)
			.withExactArgs().returns("~oGroupLockCopy~");
		oRequestorMock.expects("request").exactly(bCopy ? 1 : 0)
			.withExactArgs("POST", "Foo('23')/copy.Action?~sSelect~", "~oGroupLockCopy~", {
					"If-Match" : sinon.match.same(oChildNode)
				}, {})
			.returns("E");
		oRequestorMock.expects("request")
			.withExactArgs("PATCH", bCopy ? "$-1" : "Foo('23')", sinon.match.same(oGroupLock), {
					"If-Match" : sinon.match.same(oChildNode),
					Prefer : "return=minimal"
				}, {"myParent@odata.bind" : sParent},
				/*fnSubmit*/null, /*fnCancel*/sinon.match.func)
			.returns("A");
		const oCacheMock = self.mock(oCache);
		oCacheMock.expects("requestRank")
			.withExactArgs(sinon.match.same(oChildNode), sinon.match.same(oGroupLock), true)
			.returns("C");
		self.mock(SyncPromise).expects("all")
			.withExactArgs(["A", undefined, "C", undefined, bCopy ? "E" : undefined])
			.returns(SyncPromise.resolve([,, vRank,, "~oCopy~"]));

		const {promise : oSyncPromise, refresh : bRefresh}
			// code under test
			= oCache.move(oGroupLock, "Foo('23')", sParent, undefined, "n/a", undefined, bCopy);

		const fnGetRank = oSyncPromise.getResult();
		assert.strictEqual(typeof fnGetRank, "function");
		assert.strictEqual(bRefresh, true, "refresh needed");

		oCacheMock.expects("requestRank").exactly(bCopy ? 1 : 0)
			.withExactArgs("~oCopy~", sinon.match.same(oGroupLock), true)
			.resolves("~limitedRank~");
		oCacheMock.expects("findIndex").exactly(vRank ? 1 : 0)
			.withExactArgs("~iRank~").returns("~findIndex~");

		// code under test
		const aResult = fnGetRank();
		assert.strictEqual(aResult.length, 3);
		assert.strictEqual(aResult[0], vRank ? "~findIndex~" : undefined);
		assert.strictEqual(aResult[1], undefined);

		if (bCopy) {
			oCacheMock.expects("findIndex").withExactArgs("~limitedRank~").returns("~copyIndex~");
			assert.ok(aResult[2] instanceof Promise);
			assert.strictEqual(await aResult[2], "~copyIndex~");
		} else {
			assert.strictEqual(aResult[2], undefined);
		}

		fnAssert(oChildNode);
	}

	//*********************************************************************************************
	QUnit.test(`move: refresh needed (copy) #${i}`, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "~sMetaPath~", "", {}, {
				$Actions : {CopyAction : "copy.Action"},
				$ParentNavigationProperty : "myParent",
				expandTo : Number.MAX_SAFE_INTEGER,
				hierarchyQualifier : "X"
			});
		assert.strictEqual(oCache.bUnifiedCache, true);
		const oTreeStateMock = this.mock(oCache.oTreeState);
		oTreeStateMock.expects("isOutOfPlace").withExactArgs(undefined).returns(false);
		oTreeStateMock.expects("deleteOutOfPlace").never();
		oTreeStateMock.expects("expand").never();
		this.mock(_Helper).expects("hasPrivateAnnotation").never();

		return test(this, assert, oCache, null, (oChildNode) => {
			assert.ok("@$ui5.context.isTransient" in oChildNode);
		}, true);
	});

	//*********************************************************************************************
	QUnit.test(`move: refresh needed (no unified cache yet) #${i}`, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "n/a", "", {}, {
				$ParentNavigationProperty : "myParent",
				expandTo : Number.MAX_SAFE_INTEGER - 1, // not quite enough ;-)
				hierarchyQualifier : "X"
			});
		assert.strictEqual(oCache.bUnifiedCache, false);
		const oTreeStateMock = this.mock(oCache.oTreeState);
		oTreeStateMock.expects("isOutOfPlace").never();
		oTreeStateMock.expects("isOutOfPlace").withExactArgs("('23')").returns(false);
		oTreeStateMock.expects("isOutOfPlace").withExactArgs(undefined).returns(false);
		oTreeStateMock.expects("deleteOutOfPlace").never();
		oTreeStateMock.expects("expand").never();
		this.mock(_Helper).expects("hasPrivateAnnotation").never();

		return test(this, assert, oCache);
	});

	//*********************************************************************************************
	QUnit.test(`move: refresh needed (child OOP) #${i}`, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "n/a", "", {}, {
				$ParentNavigationProperty : "myParent",
				expandTo : Number.MAX_SAFE_INTEGER,
				hierarchyQualifier : "X"
			});
		assert.strictEqual(oCache.bUnifiedCache, true);
		const oTreeStateMock = this.mock(oCache.oTreeState);
		oTreeStateMock.expects("isOutOfPlace").withExactArgs("('23')").returns(true);
		oTreeStateMock.expects("deleteOutOfPlace").withExactArgs("('23')");
		oTreeStateMock.expects("isOutOfPlace").withExactArgs(undefined).returns(false);
		oTreeStateMock.expects("expand").never();
		this.mock(_Helper).expects("hasPrivateAnnotation").never();

		return test(this, assert, oCache, null, (oChildNode) => {
			assert.notOk("@$ui5.context.isTransient" in oChildNode);
		});
	});

	//*********************************************************************************************
	QUnit.test(`move: refresh needed (new parent OOP) #${i}`, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "n/a", "", {}, {
				$ParentNavigationProperty : "myParent",
				expandTo : Number.MAX_SAFE_INTEGER,
				hierarchyQualifier : "X"
			});
		assert.strictEqual(oCache.bUnifiedCache, true);
		oCache.aElements.$byPredicate["('42')"] = {"@$ui5.node.isExpanded" : true}; // parent
		const oTreeStateMock = this.mock(oCache.oTreeState);
		oTreeStateMock.expects("isOutOfPlace").withExactArgs("('23')").returns(false);
		oTreeStateMock.expects("isOutOfPlace").withExactArgs("('42')").returns(true);
		oTreeStateMock.expects("deleteOutOfPlace").withExactArgs("('42')", true);
		oTreeStateMock.expects("expand").never();
		this.mock(_Helper).expects("hasPrivateAnnotation").never();

		return test(this, assert, oCache, "Foo('42')");
	});

	//*********************************************************************************************
	QUnit.test(`move: refresh needed (new parent collapsed) #${i}`, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "n/a", "", {}, {
				$ParentNavigationProperty : "myParent",
				expandTo : Number.MAX_SAFE_INTEGER,
				hierarchyQualifier : "X"
			});
		assert.strictEqual(oCache.bUnifiedCache, true);
		const oParentNode = {"@$ui5.node.isExpanded" : false};
		oCache.aElements.$byPredicate["('42')"] = oParentNode;
		const oTreeStateMock = this.mock(oCache.oTreeState);
		oTreeStateMock.expects("isOutOfPlace").withExactArgs("('23')").returns(false);
		oTreeStateMock.expects("isOutOfPlace").withExactArgs("('42')").returns(false);
		oTreeStateMock.expects("deleteOutOfPlace").never();
		this.mock(_Helper).expects("hasPrivateAnnotation")
			.withExactArgs(sinon.match.same(oParentNode), "spliced").returns(false);
		oTreeStateMock.expects("expand").withExactArgs(sinon.match.same(oParentNode));

		return test(this, assert, oCache, "Foo('42')");
	});

	//*********************************************************************************************
	[123, 124, 321].forEach((iLevel) => {
		const sTitle = `move: refresh needed (not a leaf anymore) #${i}, level=${iLevel}`;

		QUnit.test(sTitle, function (assert) {
			const oCache = _AggregationCache.create(this.oRequestor, "n/a", "", {}, {
					$ParentNavigationProperty : "myParent",
					expandTo : 123,
					hierarchyQualifier : "X"
				});
			oCache.bUnifiedCache = true; // simulate a previous side-effects refresh
			const oParentNode = {
				// no "@$ui5.node.isExpanded"
				"@$ui5.node.level" : iLevel

			};
			oCache.aElements.$byPredicate["('42')"] = oParentNode;
			const oTreeStateMock = this.mock(oCache.oTreeState);
			oTreeStateMock.expects("isOutOfPlace").withExactArgs("('23')").returns(false);
			oTreeStateMock.expects("isOutOfPlace").withExactArgs("('42')").returns(false);
			oTreeStateMock.expects("deleteOutOfPlace").never();
			this.mock(_Helper).expects("hasPrivateAnnotation")
				.withExactArgs(sinon.match.same(oParentNode), "spliced").returns(false);
			oTreeStateMock.expects("expand").withExactArgs(sinon.match.same(oParentNode));

			return test(this, assert, oCache, "Foo('42')");
		});
	});
	//* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
});

	//*********************************************************************************************
[undefined, "~iRank~"].forEach((vRank) => {
	[null, "Foo('43')"].forEach((sSiblingPath) => {
		[false, true].forEach((bRequestSiblingRank) => {
			const sTitle = `move: refresh needed (rank=${vRank}, sibling=${sSiblingPath}`
				+ `, request sibling rank=${bRequestSiblingRank})`;

			if (bRequestSiblingRank && !sSiblingPath) {
				return;
			}

	QUnit.test(sTitle, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "n/a", "", {}, {
				$Actions : {ChangeNextSiblingAction : "changeNextSibling"},
				$ParentNavigationProperty : "myParent",
				$fetchMetadata : mustBeMocked,
				expandTo : Number.MAX_SAFE_INTEGER,
				hierarchyQualifier : "X"
			});
		oCache.aElements.$byPredicate["('23')"] = "~oChildNode~";
		oCache.aElements.$byPredicate["('42')"] = {"@$ui5.node.isExpanded" : true}; // parent
		const oSiblingNode = {foo : "A", bar : "B", baz : "C"};
		oCache.aElements.$byPredicate["('43')"] = oSiblingNode;
		const oTreeStateMock = this.mock(oCache.oTreeState);
		oTreeStateMock.expects("isOutOfPlace").withExactArgs("('23')").returns(false);
		oTreeStateMock.expects("isOutOfPlace").withExactArgs("('42')").returns(false);
		const oGroupLock = {getUnlockedCopy : mustBeMocked};
		const oRequestorMock = this.mock(this.oRequestor);
		oRequestorMock.expects("request")
			.withExactArgs("PATCH", "Foo('23')", sinon.match.same(oGroupLock), {
					"If-Match" : "~oChildNode~",
					Prefer : "return=minimal"
				}, {"myParent@odata.bind" : "Foo('42')"},
				/*fnSubmit*/null, /*fnCancel*/sinon.match.func)
			.returns("A");
		oTreeStateMock.expects("deleteOutOfPlace").exactly(sSiblingPath ? 1 : 0)
			.withExactArgs("('43')");
		this.mock(_Helper).expects("getMetaPath").exactly(sSiblingPath ? 1 : 0)
			.withExactArgs("/non/canonical/changeNextSibling/NextSibling/")
			.returns("~metaPath~");
		this.mock(oCache.oAggregation).expects("$fetchMetadata").exactly(sSiblingPath ? 1 : 0)
			.withExactArgs("~metaPath~")
			.returns(SyncPromise.resolve({foo : "n/a", $bar : "n/a", baz : "n/a"}));
		this.mock(oGroupLock).expects("getUnlockedCopy").withExactArgs().returns("~groupLockCopy~");
		oRequestorMock.expects("request")
			.withExactArgs("POST", "non/canonical/changeNextSibling", "~groupLockCopy~", {
					"If-Match" : "~oChildNode~",
					Prefer : "return=minimal"
				}, {NextSibling : sSiblingPath ? {foo : "A", baz : "C"} : null})
			.returns("B");
		const oCacheMock = this.mock(oCache);
		oCacheMock.expects("requestRank")
			.withExactArgs("~oChildNode~", sinon.match.same(oGroupLock), true)
			.returns("C");
		oCacheMock.expects("requestRank").exactly(bRequestSiblingRank ? 1 : 0)
			.withExactArgs(sinon.match.same(oSiblingNode), sinon.match.same(oGroupLock), true)
			.returns("D");
		this.mock(SyncPromise).expects("all")
			.withExactArgs(["A", "B", "C", bRequestSiblingRank && "D", undefined])
			.returns(SyncPromise.resolve([,, vRank, "~iSiblingRank~"]));

		const {promise : oSyncPromise, refresh : bRefresh}
			// code under test
			= oCache.move(oGroupLock, "Foo('23')", "Foo('42')", sSiblingPath, "non/canonical",
				bRequestSiblingRank);

		const fnGetRank = oSyncPromise.getResult();
		assert.strictEqual(typeof fnGetRank, "function");
		assert.strictEqual(bRefresh, true, "refresh needed");

		oCacheMock.expects("findIndex").exactly(vRank ? 1 : 0)
			.withExactArgs("~iRank~").returns("~findIndex~child~");
		oCacheMock.expects("findIndex").exactly(bRequestSiblingRank ? 1 : 0)
			.withExactArgs("~iSiblingRank~").returns("~findIndex~sibling~");

		// code under test
		assert.deepEqual(fnGetRank(), [
			vRank ? "~findIndex~child~" : undefined,
			bRequestSiblingRank && "~findIndex~sibling~",
			undefined
		]);
	});
		});
	});
});

	//*********************************************************************************************
[undefined, false, true].forEach((bNewParentExpanded) => {
	[false, true].forEach((bMakeRoot) => {
		[undefined, false, true].forEach((bChildExpanded) => {
			const sTitle = "move: unified cache, no refresh needed"
				+ ", new parent's @$ui5.node.isExpanded = " + bNewParentExpanded
				+ ", make root = " + bMakeRoot
				+ ", child's @$ui5.node.isExpanded = " + bChildExpanded;
			if (bMakeRoot && bNewParentExpanded !== undefined) {
				return;
			}

	QUnit.test(sTitle, async function (assert) {
		var oUpdateExistingExpectation;

		const oCache = _AggregationCache.create(this.oRequestor, "n/a", "", {}, {
				$ParentNavigationProperty : "myParent",
				expandTo : bNewParentExpanded === undefined ? 10 : 9,
				hierarchyQualifier : "X"
			});
		oCache.bUnifiedCache = true; // simulate a previous side-effects refresh
		const oChildNode = {
			"@$ui5.node.isExpanded" : bChildExpanded,
			Name : "(child) node" // makes deepEqual more useful ;-)
		};
		const oParentNode = bMakeRoot ? undefined : {
			"@$ui5.node.isExpanded" : bNewParentExpanded,
			"@$ui5.node.level" : 9
		};
		// Note: oParentNode's index in aElements MUST not matter!
		oCache.aElements
			= ["a", "b", oChildNode, "d", "e", "f", "g", "h", "i"];
		oCache.aElements.$byPredicate = {
			"('23')" : oChildNode,
			"('42')" : oParentNode
		};
		const oTreeStateMock = this.mock(oCache.oTreeState);
		oTreeStateMock.expects("isOutOfPlace").withExactArgs("('23')").returns(false);
		oTreeStateMock.expects("isOutOfPlace").withExactArgs(bMakeRoot ? undefined : "('42')")
			.returns(false);
		oTreeStateMock.expects("deleteOutOfPlace").never();
		const oHelperMock = this.mock(_Helper);
		oHelperMock.expects("hasPrivateAnnotation").exactly(bNewParentExpanded === false ? 1 : 0)
			.withExactArgs(sinon.match.same(oParentNode), "spliced").returns(true); // avoid refresh
		oTreeStateMock.expects("expand").exactly(bNewParentExpanded === false ? 1 : 0)
			.withExactArgs(sinon.match.same(oParentNode));
		const oCacheMock = this.mock(oCache);
		oCacheMock.expects("requestRank")
			.withExactArgs(sinon.match.same(oChildNode), "~oGroupLock~", false).resolves(17);
		this.mock(this.oRequestor).expects("request")
			.withExactArgs("PATCH", "Foo('23')", "~oGroupLock~", {
					"If-Match" : sinon.match.same(oChildNode),
					Prefer : "return=minimal"
				}, {"myParent@odata.bind" : bMakeRoot ? null : "Foo('42')"},
				/*fnSubmit*/null, /*fnCancel*/sinon.match.func)
			.resolves({"@odata.etag" : "etag"});
		const oCollapseExpectation = oCacheMock.expects("collapse").exactly(bChildExpanded ? 1 : 0)
			.withExactArgs("('23')").returns("~collapseCount~");
		oCacheMock.expects("expand").exactly(bNewParentExpanded === false ? 1 : 0)
			.withExactArgs(sinon.match.same(_GroupLock.$cached), "('42')")
			.returns(SyncPromise.resolve(47));
		oHelperMock.expects("updateAll")
			.exactly(oParentNode && bNewParentExpanded === undefined ? 1 : 0)
			.withExactArgs(sinon.match.same(oCache.mChangeListeners), "('42')",
				sinon.match.same(oParentNode), {"@$ui5.node.isExpanded" : true});
		oHelperMock.expects("getPrivateAnnotation")
			.withExactArgs(sinon.match.same(oChildNode), "descendants", 0).returns(4);
		oCacheMock.expects("adjustDescendantCount")
			.withExactArgs(sinon.match.same(oChildNode), 2, -(4 + 1))
			.callsFake(function () {
				assert.notOk(oUpdateExistingExpectation.called, "old level needed!");
				assert.deepEqual(oCache.aElements,
					["a", "b", oChildNode, "d", "e", "f", "g", "h", "i"],
					"not spliced yet");
				assert.strictEqual(oCollapseExpectation.called, !!bChildExpanded,
					"collapse before splice");
			});
		oHelperMock.expects("getPrivateAnnotation")
			.withExactArgs(sinon.match.same(oChildNode), "rank").returns("~rank~");
		const oShiftRankForMoveExpectation = oCacheMock.expects("shiftRankForMove")
			.withExactArgs("~rank~", 4 + 1, 17);
		this.mock(oCache.oFirstLevel).expects("move").withExactArgs("~rank~", 17, 4 + 1);
		oUpdateExistingExpectation = oHelperMock.expects("updateExisting")
			.withExactArgs(sinon.match.same(oCache.mChangeListeners), "('23')",
				sinon.match.same(oChildNode), {
					"@odata.etag" : "etag",
					"@$ui5.node.level" : bMakeRoot ? 1 : 10,
					"@$ui5.context.isTransient" : undefined
				});
		const oDeleteRankExpectation = oHelperMock.expects("deletePrivateAnnotation")
			.withExactArgs(sinon.match.same(oChildNode), "rank");
		const oGetInsertIndexExpectation = oCacheMock.expects("getInsertIndex")
			.withExactArgs(17).returns(7);
		const oAdjustDescendantCountExpectation = oCacheMock.expects("adjustDescendantCount")
			.withExactArgs(sinon.match.same(oChildNode), 7, +(4 + 1))
			.callsFake(function () {
				assert.deepEqual(oCache.aElements,
					["a", "b", "d", "e", "f", "g", "h", oChildNode, "i"],
					"already moved");
			});
		const oSetRankExpectation = oHelperMock.expects("setPrivateAnnotation")
			.withExactArgs(sinon.match.same(oChildNode), "rank", 17);

		// code under test
		const {promise : oSyncPromise, refresh : bRefresh}
			= oCache.move("~oGroupLock~", "Foo('23')", bMakeRoot ? null : "Foo('42')");

		assert.strictEqual(oSyncPromise.isPending(), true);
		assert.strictEqual(bRefresh, false);
		assert.notOk(oCollapseExpectation.called, "avoid early collapse");

		assert.deepEqual(await oSyncPromise, [
			bNewParentExpanded === false ? 47 + 1 : 1, // iResult
			7, // iNewIndex
			bChildExpanded === true ? "~collapseCount~" : undefined
		]);
		assert.deepEqual(oCache.aElements,
			["a", "b", "d", "e", "f", "g", "h", oChildNode, "i"]);
		sinon.assert.callOrder(oShiftRankForMoveExpectation, oGetInsertIndexExpectation);
		sinon.assert.callOrder(oDeleteRankExpectation, oAdjustDescendantCountExpectation,
			oSetRankExpectation);
	});
		});
	});
});

	//*********************************************************************************************
[false, true].forEach(function (bHasGroupLevelCache) {
	[1, 2, 25].forEach(function (iExpandTo) {
		[undefined, true].forEach(function (bParentExpanded) {
			[false, true].forEach(function (bCreateRoot) {
				[undefined, "~iRank~"].forEach(function (iRank) {
					var sTitle = "create: already has group level cache: " + bHasGroupLevelCache
							+ ", expandTo: " + iExpandTo
							+ ", parent's @$ui5.node.isExpanded: " + bParentExpanded
							+ ", create root node: " + bCreateRoot
							+ ", rank : " + iRank;

					const bInFirstLevel = bCreateRoot || iExpandTo > 24;
					if (bHasGroupLevelCache && bInFirstLevel || bParentExpanded && bCreateRoot
							|| !bInFirstLevel && !iRank) {
						return;
					}

	QUnit.test(sTitle, function (assert) {
		var fnCancelCallback,
			that = this;

		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
				$ParentNavigationProperty : "myParent",
				expandTo : iExpandTo,
				hierarchyQualifier : "X"
			});
		assert.strictEqual(oCache.bUnifiedCache, false);
		const oGroupLevelCache = {
				create : mustBeMocked,
				setEmpty : mustBeMocked
			};
		const oParentNode = bCreateRoot ? "2" : {
				"@$ui5._" : {cache : bHasGroupLevelCache ? oGroupLevelCache : undefined},
				"@$ui5.node.level" : 23
			};
		if (bParentExpanded !== undefined) {
			oParentNode["@$ui5.node.isExpanded"] = bParentExpanded;
		}
		oCache.aElements = ["0", "1", oParentNode, "3", "4"];
		oCache.aElements.$byPredicate = {"('42')" : oParentNode};
		oCache.aElements.$count = 5;
		const oCacheMock = this.mock(oCache);
		oCacheMock.expects("createGroupLevelCache")
			.exactly(bHasGroupLevelCache || bInFirstLevel ? 0 : 1)
			.withExactArgs(sinon.match.same(oParentNode)).returns(oGroupLevelCache);
		this.mock(oGroupLevelCache).expects("setEmpty")
			.exactly(bHasGroupLevelCache || bInFirstLevel ? 0 : 1)
			.withExactArgs();
		const oHelperMock = this.mock(_Helper);
		oHelperMock.expects("updateAll")
			.exactly(bParentExpanded || bCreateRoot ? 0 : 1)
			.withExactArgs(sinon.match.same(oCache.mChangeListeners), "('42')",
				sinon.match.same(oParentNode), {"@$ui5.node.isExpanded" : true});
		this.mock(oCache.oTreeState).expects("expand")
			.exactly(bParentExpanded || bCreateRoot || iExpandTo > 23 ? 0 : 1)
			.withExactArgs(sinon.match.same(oParentNode));
		const oEntityData = {
				"@$ui5.node.parent" : (bCreateRoot ? undefined : "Foo('42')"),
				bar : "~bar~",
				foo : "~foo~"
			};
		oHelperMock.expects("addByPath")
			.withExactArgs(sinon.match.same(oCache.mPostRequests), "~sTransientPredicate~",
				sinon.match.same(oEntityData));
		const oPostBody = {};
		const oCollectionCache = bInFirstLevel ? oCache.oFirstLevel : oGroupLevelCache;
		let bNodePropertyCompleted = false;
		this.mock(oCollectionCache).expects("create")
			.withExactArgs("~oGroupLock~", "~oPostPathPromise~", "~sPath~",
				"~sTransientPredicate~", {bar : "~bar~", foo : "~foo~"}, false, "~fnErrorCallback~",
				"~fnSubmitCallback~", sinon.match.func)
			.callsFake(function () {
				fnCancelCallback = arguments[8];
				if (!bCreateRoot) {
					assert.strictEqual(_Helper.getPrivateAnnotation(oParentNode, "cache"),
						bInFirstLevel ? undefined : oGroupLevelCache);
				}
				_Helper.setPrivateAnnotation(oEntityData, "postBody", oPostBody);
				return new SyncPromise(function (resolve) {
					setTimeout(function () {
						var oNodeExpectation;

						_Helper.setPrivateAnnotation(oEntityData, "predicate", "('ABC')");
						if (bInFirstLevel) {
							// Note: #calculateKeyPredicateRH doesn't know better :-(
							oEntityData["@$ui5.node.level"] = 1;
						}
						oHelperMock.expects("removeByPath")
							.withExactArgs(sinon.match.same(oCache.mPostRequests),
								"~sTransientPredicate~", sinon.match.same(oEntityData));
						that.mock(oCache.oTreeState).expects("setOutOfPlace")
							.withExactArgs(sinon.match.same(oEntityData),
								bCreateRoot ? undefined : sinon.match.same(oParentNode));
						const iCallCount = bInFirstLevel && iExpandTo > 1 ? 1 : 0;
						const iRankCallCount = iCallCount && iRank ? 1 : 0;
						const oRankExpectation = that.mock(oCache).expects("requestRank")
							.exactly(iCallCount)
							.withExactArgs(sinon.match.same(oEntityData), "~oGroupLock~")
							.callsFake(function () {
								Promise.resolve().then(function () {
									assert.ok(oRankExpectation.called, "both called in sync");
									assert.ok(oRankExpectation
										.calledImmediatelyBefore(oNodeExpectation));
								});
								return Promise.resolve(iRank);
							});
						oNodeExpectation = that.mock(oCache).expects("requestNodeProperty")
							.withExactArgs(sinon.match.same(oEntityData), "~oGroupLock~", true)
							.returns(new Promise(function (resolve0) {
								setTimeout(function () {
									bNodePropertyCompleted = true;
									resolve0();
								});
							}));
						const oRemoveElementExpectation
							= that.mock(oCache.oFirstLevel).expects("removeElement")
							.exactly(iCallCount).withExactArgs(0);
						if (iCallCount) {
							// always done by #addElements, but needs to be undone in this case only
							oCache.aElements.$byPredicate["~sTransientPredicate~"] = "n/a";
						}
						const oDeleteTransientPredicateExpectation
							= oHelperMock.expects("deletePrivateAnnotation").exactly(iCallCount)
							.withExactArgs(sinon.match.same(oEntityData), "transientPredicate");
						oCacheMock.expects("adjustDescendantCount").exactly(iRankCallCount)
							.withExactArgs(sinon.match.same(oEntityData), bCreateRoot ? 0 : 3, +1);
						const oSetRankExpectation = oHelperMock.expects("setPrivateAnnotation")
							.exactly(iRankCallCount)
							.withExactArgs(sinon.match.same(oEntityData), "rank", iRank);
						that.mock(oCache.oFirstLevel).expects("restoreElement")
							.exactly(iRankCallCount)
							.withExactArgs(iRank, sinon.match.same(oEntityData))
							.callsFake(function () {
								assert.ok(oRemoveElementExpectation.called);
								assert.ok(oDeleteTransientPredicateExpectation.called);
							});
						that.mock(oCache).expects("shiftRank").exactly(iRankCallCount)
							.withExactArgs(bCreateRoot ? 0 : 3, +1)
							.callsFake(function () {
								assert.ok(oSetRankExpectation.called);
							});
						resolve();
					});
				});
			});
		oHelperMock.expects("makeRelativeUrl").exactly(bCreateRoot ? 0 : 1)
			.withExactArgs("/Foo('42')", "/Foo").returns("~relativeUrl~");
		oCacheMock.expects("addElements")
			.withExactArgs(sinon.match.same(oEntityData), bCreateRoot ? 0 : 3,
				sinon.match.same(oCollectionCache), undefined)
			.callsFake(function () {
				assert.deepEqual(oCache.aElements, bCreateRoot
					? [null, "0", "1", "2", "3", "4"]
					: ["0", "1", oParentNode, null, "3", "4"]);
			});
		oCacheMock.expects("adjustDescendantCount").never();

		// code under test
		const oResult = oCache.create("~oGroupLock~", "~oPostPathPromise~", "~sPath~",
			"~sTransientPredicate~", oEntityData, /*bAtEndOfCreated*/false, "~fnErrorCallback~",
			"~fnSubmitCallback~");

		assert.deepEqual(oPostBody, bCreateRoot ? {} : {"myParent@odata.bind" : "~relativeUrl~"});
		assert.deepEqual(oEntityData, {
			"@$ui5._" : {postBody : oPostBody},
			"@$ui5.node.level" : bCreateRoot ? 1 : 24,
			bar : "~bar~",
			foo : "~foo~"
		});
		assert.strictEqual(oCache.aElements.$count, 6);
		assert.strictEqual(oResult.isPending(), true);

		return oResult.then(function (oEntityData0) {
			assert.strictEqual(oEntityData0, oEntityData);
			assert.deepEqual(oEntityData, {
				"@$ui5._" : {postBody : oPostBody, predicate : "('ABC')"},
				"@$ui5.node.level" : bCreateRoot ? 1 : 24,
				bar : "~bar~",
				foo : "~foo~"
			});
			assert.deepEqual(oCache.aElements.$byPredicate, {
				"('42')" : oParentNode,
				"('ABC')" : oEntityData
			});
			assert.strictEqual(oCache.aElements.$count, 6);
			assert.ok(bNodePropertyCompleted, "await #requestNodeProperty");

			oCache.aElements[bCreateRoot ? 0 : 3] = oEntityData;
			oCache.aElements.$byPredicate["~sTransientPredicate~"] = "n/a";
			oHelperMock.expects("removeByPath")
				.withExactArgs(sinon.match.same(oCache.mPostRequests),
					"~sTransientPredicate~", sinon.match.same(oEntityData));

			// code under test
			fnCancelCallback();

			assert.strictEqual(oCache.aElements.$count, 5);
			assert.deepEqual(oCache.aElements.$byPredicate, {
				"('42')" : oParentNode,
				"('ABC')" : oEntityData
			});
			assert.deepEqual(oCache.aElements, ["0", "1", oParentNode, "3", "4"]);
		});
	});
				});
			});
		});
	});
});

	//*********************************************************************************************
[undefined, 2].forEach(function (iRank) {
	[2, 25].forEach(function (iExpandTo) {
		[undefined, true].forEach(function (bParentExpanded) {
			[false, true].forEach(function (bCreateRoot) {
				const sTitle = "create: createInPlace, rank: " + iRank
					+ ", expandTo: " + iExpandTo
					+ ", parent's @$ui5.node.isExpanded: " + bParentExpanded
					+ ", create root node: " + bCreateRoot;

				if (bParentExpanded && bCreateRoot) {
					return;
				}

	QUnit.test(sTitle, function (assert) {
		var that = this;

		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
				$ParentNavigationProperty : "myParent",
				createInPlace : true,
				expandTo : iExpandTo,
				hierarchyQualifier : "X"
			});
		assert.strictEqual(oCache.bUnifiedCache, true, "activated by createInPlace");
		const oParentNode = bCreateRoot ? "1" : {"@$ui5.node.level" : 23};
		if (bParentExpanded !== undefined) {
			oParentNode["@$ui5.node.isExpanded"] = bParentExpanded;
		}
		oCache.aElements = ["0", oParentNode, "2"];
		oCache.aElements.$byPredicate = {"('42')" : oParentNode};
		oCache.aElements.$count = 3;
		this.mock(oCache).expects("createGroupLevelCache").never();
		this.mock(oCache.oTreeState).expects("setOutOfPlace").never();
		const oEntityData = {
			"@$ui5.node.parent" : (bCreateRoot ? undefined : "Foo('42')"),
			bar : "~bar~",
			foo : "~foo~"
		};
		const oHelperMock = this.mock(_Helper);
		oHelperMock.expects("addByPath")
			.withExactArgs(sinon.match.same(oCache.mPostRequests), "~sTransientPredicate~",
				sinon.match.same(oEntityData));
		const oPostBody = {};
		const bExpandTreeState = !bParentExpanded && !bCreateRoot && iExpandTo < 23;
		let fnCancelCallback;
		this.mock(oCache.oFirstLevel).expects("create")
			.withExactArgs("~oGroupLock~", "~oPostPathPromise~", "~sPath~",
				"~sTransientPredicate~", {bar : "~bar~", foo : "~foo~"}, false, "~fnErrorCallback~",
				"~fnSubmitCallback~", sinon.match.func)
			.callsFake(function () {
				fnCancelCallback = arguments[8];
				_Helper.setPrivateAnnotation(oEntityData, "postBody", oPostBody);
				return new SyncPromise(function (resolve) {
					setTimeout(function () {
						_Helper.setPrivateAnnotation(oEntityData, "predicate", "('ABC')");
						oEntityData["@$ui5.context.isTransient"] = "~isTransient~";
						oHelperMock.expects("removeByPath")
							.withExactArgs(sinon.match.same(oCache.mPostRequests),
								"~sTransientPredicate~", sinon.match.same(oEntityData));
						const oRequestRankExpectation = that.mock(oCache).expects("requestRank")
							.withExactArgs(sinon.match.same(oEntityData), "~oGroupLock~")
							.resolves(iRank);
						that.mock(oCache).expects("requestNodeProperty")
							.withExactArgs(sinon.match.same(oEntityData), "~oGroupLock~");
						oHelperMock.expects("updateAll")
							.exactly(bParentExpanded || bCreateRoot || !iRank || bExpandTreeState
								? 0 : 1)
							.withExactArgs(sinon.match.same(oCache.mChangeListeners), "('42')",
								sinon.match.same(oParentNode), {"@$ui5.node.isExpanded" : true})
							.callsFake(function () {
								assert.ok(oRequestRankExpectation.called);
							});
						that.mock(oCache).expects("addElements")
							.exactly(iRank && !bExpandTreeState ? 1 : 0)
							.withExactArgs(sinon.match.same(oEntityData), iRank,
								sinon.match.same(oCache.oFirstLevel), iRank)
							.callsFake(function () {
								assert.deepEqual(oCache.aElements, ["0", oParentNode, null, "2"]);
							});
						that.mock(oCache).expects("adjustDescendantCount")
							.exactly(iRank && !bExpandTreeState ? 1 : 0)
							.withExactArgs(sinon.match.same(oEntityData), iRank, 1);
						that.mock(oCache.oFirstLevel).expects("removeElement")
							.exactly(bExpandTreeState ? 0 : 1)
							.withExactArgs(0);
						oHelperMock.expects("deletePrivateAnnotation")
							.exactly(iRank && !bExpandTreeState ? 1 : 0)
							.withExactArgs(sinon.match.same(oEntityData), "transientPredicate");
						that.mock(oCache.oFirstLevel).expects("restoreElement")
							.exactly(iRank && !bExpandTreeState ? 1 : 0)
							.withExactArgs(iRank, sinon.match.same(oEntityData));
						that.mock(oCache).expects("shiftRank")
							.exactly(iRank && !bExpandTreeState ? 1 : 0)
							.withExactArgs(iRank, +1);
						resolve();
					});
				});
			});
		oHelperMock.expects("makeRelativeUrl").exactly(bCreateRoot ? 0 : 1)
			.withExactArgs("/Foo('42')", "/Foo").returns("~relativeUrl~");
		const oExpandExpectation = this.mock(oCache.oTreeState).expects("expand")
			.exactly(bExpandTreeState ? 1 : 0)
			.withExactArgs(oParentNode);

		// code under test
		const oResult = oCache.create("~oGroupLock~", "~oPostPathPromise~", "~sPath~",
			"~sTransientPredicate~", oEntityData, /*bAtEndOfCreated*/false, "~fnErrorCallback~",
			"~fnSubmitCallback~");

		assert.strictEqual(oExpandExpectation.called, bExpandTreeState, "called synchronously");
		assert.deepEqual(oPostBody, bCreateRoot ? {} : {"myParent@odata.bind" : "~relativeUrl~"});
		const oExpectedEntity = {
			"@$ui5._" : {postBody : oPostBody},
			bar : "~bar~",
			foo : "~foo~"
		};
		assert.deepEqual(oEntityData, oExpectedEntity);
		assert.strictEqual(oCache.aElements.$count, 3);
		assert.deepEqual(oCache.aElements.$byPredicate, {"('42')" : oParentNode});
		assert.deepEqual(oCache.aElements, ["0", oParentNode, "2"]);
		assert.strictEqual(oResult.isPending(), true);

		return oResult.then(function (oEntityData0) {
			assert.strictEqual(oEntityData0, oEntityData);

			oExpectedEntity["@$ui5._"].predicate = "('ABC')";
			if (bExpandTreeState) {
				oExpectedEntity["@$ui5._"].rank = iRank;
			} else if (iRank) {
				oExpectedEntity["@$ui5._"].rank = iRank;
				oExpectedEntity["@$ui5.node.level"] = bCreateRoot ? 1 : 24;
			}
			assert.deepEqual(oEntityData, oExpectedEntity);
			const iExpectedCount = iRank && !bExpandTreeState ? 4 : 3;
			assert.strictEqual(oCache.aElements.$count, iExpectedCount);
			const aExpectedElements = iRank && !bExpandTreeState
				? ["0", oParentNode, null, "2"] : ["0", oParentNode, "2"];
			assert.deepEqual(oCache.aElements, aExpectedElements);

			oHelperMock.expects("removeByPath")
				.withExactArgs(sinon.match.same(oCache.mPostRequests),
					"~sTransientPredicate~", sinon.match.same(oEntityData));

			// code under test
			fnCancelCallback();

			assert.deepEqual(oCache.aElements, aExpectedElements, "unchanged");
			assert.strictEqual(oCache.aElements.$count, iExpectedCount, "unchanged");
		});
	});
			});
		});
	});
});

	//*********************************************************************************************
	QUnit.test("create: bAtEndOfCreated, collapsed parent", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
				hierarchyQualifier : "X"
			});
		this.mock(oCache).expects("createGroupLevelCache").never();
		this.mock(_Helper).expects("updateAll").never();
		this.mock(oCache).expects("addElements").never();

		assert.throws(function () {
			oCache.create(null, null, "", "", {}, /*bAtEndOfCreated*/true);
		}, new Error("Unsupported bAtEndOfCreated"));

		oCache.aElements.$byPredicate["('42')"] = {"@$ui5.node.isExpanded" : false};

		assert.throws(function () {
			oCache.create(null, null, "", "", {"@$ui5.node.parent" : "Foo('42')"});
		}, new Error("Unsupported collapsed parent: Foo('42')"));
	});

	//*********************************************************************************************
[false, true].forEach(function (bBreak) {
	QUnit.test(`shiftRank: group level cache, break = ${bBreak}`, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
				hierarchyQualifier : "X"
			});
		const oNode = {
				"@$ui5._" : {parent : "~oGroupLevelCache~", rank : 2},
				"@$ui5.node.level" : 24,
				ID : "node"
			};
		const oElementSkip = {
				"@$ui5._" : {parent : "not oGroupLevelCache", rank : -3},
				"@$ui5.node.level" : 25,
				ID : "skip"
			};
		const oElementNoBreak = {
				"@$ui5.node.level" : 24,
				ID : "no break"
			};
		const oElementChange = {
				"@$ui5._" : {parent : "~oGroupLevelCache~", rank : 4},
				"@$ui5.node.level" : 24,
				ID : "change"
			};
		const oElementCreated = {
				"@$ui5._" : {parent : "~oGroupLevelCache~"},
				"@$ui5.node.level" : 24,
				ID : "created"
			};
		const oElementBreak = {
				"@$ui5.node.level" : bBreak
					? 23 // looks like sibling of oNode's parent
					: 24, // no break here (check that for-loop does not "overshoot")
				ID : "break"
			};
		const oElementTrap = { // this is unrealistic and acts as a trap to prove that loop ends
				"@$ui5._" : {parent : "~oGroupLevelCache~", placeholder : true, rank : 7},
				"@$ui5.node.level" : 0, // must be ignored
				ID : "trap"
			};
		oCache.aElements = ["0", "1", oNode, oElementSkip, oElementNoBreak, oElementChange,
			oElementCreated, oElementBreak, oElementTrap];

		// code under test
		oCache.shiftRank(2, 47);

		assert.deepEqual(oCache.aElements, ["0", "1", {
			"@$ui5._" : {parent : "~oGroupLevelCache~", rank : 2},
			"@$ui5.node.level" : 24,
			ID : "node"
		}, {
			"@$ui5._" : {parent : "not oGroupLevelCache", rank : -3},
			"@$ui5.node.level" : 25,
			ID : "skip"
		}, {
			"@$ui5.node.level" : 24,
			ID : "no break"
		}, {
			"@$ui5._" : {parent : "~oGroupLevelCache~", rank : 4 + 47},
			"@$ui5.node.level" : 24,
			ID : "change"
		}, {
			"@$ui5._" : {parent : "~oGroupLevelCache~"},
			"@$ui5.node.level" : 24,
			ID : "created"
		}, {
			"@$ui5.node.level" : bBreak ? 23 : 24,
			ID : "break"
		}, {
			"@$ui5._" : {
				parent : "~oGroupLevelCache~",
				placeholder : true,
				rank : bBreak ? /*unchanged!*/7 : 7 + 47
			},
			"@$ui5.node.level" : 0,
			ID : "trap"
		}]);
	});
});

	//*********************************************************************************************
[2, 3, 4, 5].forEach((iMinRank) => {
	QUnit.test(`shiftRank: oFirstLevel, iMinRank = ${iMinRank}`, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.aElements = [{
			"@$ui5._" : {parent : oCache.oFirstLevel, rank : 6}
		}, {
			"@$ui5._" : {parent : oCache.oFirstLevel, rank : 0}
		}, {
			"@$ui5._" : {parent : oCache.oFirstLevel, rank : 1}
		}, {
			"@$ui5._" : {parent : oCache.oFirstLevel, rank : iMinRank}
		}, {
			"@$ui5._" : {parent : oCache.oFirstLevel, rank : 3}
		}, {
			"@$ui5._" : {parent : oCache.oFirstLevel/*, rank : undefined*/}
		}, {
			"@$ui5._" : {parent : "~oGroupLevelCache~", rank : 0}
		}, {
			"@$ui5._" : {parent : "~oGroupLevelCache~", rank : 1}
		}, {
			"@$ui5._" : {parent : oCache.oFirstLevel, rank : 4}
		}, {
			"@$ui5._" : {parent : oCache.oFirstLevel, rank : 5}
		}];

		function check() {
			let aExpectedRanks;
			switch (iMinRank) {
				case 2:
				case 3:
					aExpectedRanks
						= [6 + 23, 0, 1, iMinRank, 3 + 23, undefined, 0, 1, 4 + 23, 5 + 23];
					break;

				case 4:
					aExpectedRanks = [6 + 23, 0, 1, iMinRank, 3, undefined, 0, 1, 4 + 23, 5 + 23];
					break;

				case 5:
					aExpectedRanks = [6 + 23, 0, 1, iMinRank, 3, undefined, 0, 1, 4, 5 + 23];
					break;
				// no default
			}

			assert.deepEqual(oCache.aElements.map((oElement) => oElement["@$ui5._"].rank),
				aExpectedRanks);
		}

		// code under test
		oCache.shiftRank(3, 23);

		check();

		// code under test ("nothing is shifted")
		oCache.shiftRank(5, -23);

		check(); // unchanged
	});
});

	//*********************************************************************************************
	QUnit.test("shiftRankForMove", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});

		function setup(aRanks) {
			return aRanks.map(function (iRank) {
				return {"@$ui5._" : {rank : iRank}};
			});
		}

		// Note: order does not really matter
		// "The subtree itself is unaffected and may, but need not be present."
		// 2: subtree's root node, 3: missing, 4: part of subtree
		oCache.aElements = setup([0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11]);

		function expect(aExpectedRanks) {
			assert.deepEqual(
				oCache.aElements.map((oElement) => oElement["@$ui5._"].rank),
				aExpectedRanks
			);
		}

		// code under test
		oCache.shiftRankForMove(2, 3, 2);

		expect([0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11]);

		// code under test
		oCache.shiftRankForMove(2, 3, 7);

		expect([0, 1, 2, 4, 5 - 3, 6 - 3, 7 - 3, 8 - 3, 9 - 3, 10, 11]);

		// 7: subtree's root node, 8: missing, 9: part of subtree
		oCache.aElements = setup([0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11]);

		// code under test
		oCache.shiftRankForMove(7, 3, 2);

		expect([0, 1, 2 + 3, 3 + 3, 4 + 3, 5 + 3, 6 + 3, 7, 9, 10, 11]);
	});

	//*********************************************************************************************
[true, false].forEach((bInheritResult) => {
	[true, false].forEach((bDropFilter) => {
		[true, false].forEach((bRefreshNeeded) => {
			[true, false].forEach((bEntityFound) => {
				const sTitle = "requestProperties: bInheritResult = " + bInheritResult
					+ ", bDropFilter = " + bDropFilter + ", bRefreshNeeded = " + bRefreshNeeded
					+ ", entity was found: " + bEntityFound;

	QUnit.test(sTitle, async function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X",
			$ExpandLevels : "~ExpandLevels~",
			$LimitedRank : "~LimitedRank~"
		});
		// restore _AggregationHelper.buildApply4Hierarchy of beforeEach to allow mocking it again
		_AggregationHelper.buildApply4Hierarchy.restore();
		const oParentCache = {
			$parentFilter : "~parentFilter~",
			getQueryOptions : mustBeMocked
		};
		const aSelect = ["path/to/property0", "path/to/property1"];
		const mQueryOptions = {
			// Note: buildApply4Hierarchy has already removed $$filterBeforeAggregate, $filter,
			// and $orderby and integrated these into $apply!
			$apply : "A.P.P.L.E.",
			$count : "n/a",
			$expand : "n/a",
			$select : ["n/a"],
			foo : "bar",
			"sap-client" : "123"
		};
		this.mock(oCache.oTreeState).expects("getExpandLevels").exactly(bRefreshNeeded ? 1 : 0)
			.withExactArgs()
			.returns("~UpToDateExpandLevels~");
		this.mock(_AggregationHelper).expects("buildApply4Hierarchy")
			.exactly(bRefreshNeeded ? 1 : 0)
			.withExactArgs({
					hierarchyQualifier : "X",
					$ExpandLevels : "~UpToDateExpandLevels~",
					$LimitedRank : "~LimitedRank~"
				}, sinon.match.same(oCache.mQueryOptions))
			.returns(mQueryOptions);
		const oHelperMock = this.mock(_Helper);
		oHelperMock.expects("getPrivateAnnotation").exactly(bRefreshNeeded ? 0 : 1)
			.withExactArgs("~oElement~", "parent", sinon.match.same(oCache.oFirstLevel))
			.returns(oParentCache);
		this.mock(oParentCache).expects("getQueryOptions")
			.exactly(bDropFilter || bRefreshNeeded ? 0 : 1)
			.withExactArgs()
			.returns(mQueryOptions);
		this.mock(oCache).expects("getTypes").withExactArgs().returns("~getTypes~");
		this.mock(_AggregationHelper).expects("dropFilter")
			.exactly(bDropFilter && !bRefreshNeeded ? 1 : 0)
			.withExactArgs(sinon.match.same(oCache.oAggregation),
				sinon.match.same(oCache.mQueryOptions), "~parentFilter~")
			.returns({
				$apply : "A.P.P.L.E.",
				foo : "bar",
				"sap-client" : "123"
			});
		oHelperMock.expects("getKeyFilter")
			.withExactArgs("~oElement~", "/Foo", "~getTypes~").returns("~filter~");
		this.mock(oCache.oRequestor).expects("buildQueryString")
			.withExactArgs("/Foo", {
				$apply : "A.P.P.L.E.",
				$filter : "~filter~",
				foo : "bar",
				"sap-client" : "123"
			}, false, true)
			.returns("?~queryString~");
		const oGroupLock = {getUnlockedCopy : mustBeMocked};
		this.mock(oGroupLock).expects("getUnlockedCopy").withExactArgs()
			.returns("~oGroupLockCopy~");
		this.mock(oCache.oRequestor).expects("request")
			.withExactArgs("GET", "Foo?~queryString~", "~oGroupLockCopy~", undefined, undefined,
				undefined, undefined, "/Foo", undefined, false, {$select : aSelect},
				sinon.match.same(oCache))
			.resolves({
				"@odata.context" : "n/a",
				"@odata.metadataEtag" : "W/...",
				value : bEntityFound ? ["~oResult~"] : []
			});

		oHelperMock.expects("inheritPathValue").exactly(bInheritResult && bEntityFound ? 1 : 0)
			.withExactArgs(["path", "to", "property0"], "~oResult~", "~oElement~", true);
		oHelperMock.expects("inheritPathValue").exactly(bInheritResult && bEntityFound ? 1 : 0)
			.withExactArgs(["path", "to", "property1"], "~oResult~", "~oElement~", true);

		assert.strictEqual(
			// code under test
			await oCache.requestProperties("~oElement~", aSelect, oGroupLock, bInheritResult,
				bDropFilter, bRefreshNeeded),
			bInheritResult || !bEntityFound ? undefined : "~oResult~");

		assert.strictEqual(oCache.oAggregation.$ExpandLevels, "~ExpandLevels~", "not overwritten");
	});
			});
		});
	});
});

	//*********************************************************************************************
	QUnit.test("requestRank", async function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X",
			$LimitedRank : "~LimitedRank~"
		});
		this.mock(oCache).expects("requestProperties")
			.withExactArgs("~oElement~", ["~LimitedRank~"], "~oGroupLock~", false, false,
				"~bRefreshNeeded~")
			.resolves("~oResult~");
		this.mock(_Helper).expects("drillDown").withExactArgs("~oResult~", "~LimitedRank~")
			.returns("42");

		assert.strictEqual(
			// code under test
			await oCache.requestRank("~oElement~", "~oGroupLock~", "~bRefreshNeeded~"),
			42);
	});

	//*********************************************************************************************
	QUnit.test("requestRank: undefined", async function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X",
			$LimitedRank : "~LimitedRank~"
		});
		this.mock(oCache).expects("requestProperties")
			.withExactArgs("~oElement~", ["~LimitedRank~"], "~oGroupLock~", false, false,
				"~bRefreshNeeded~")
			.resolves(undefined);
		this.mock(_Helper).expects("drillDown").never();

		assert.strictEqual(
			// code under test
			await oCache.requestRank("~oElement~", "~oGroupLock~", "~bRefreshNeeded~"),
			undefined);
	});

	//*********************************************************************************************
	QUnit.test("requestNodeProperty", async function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X",
			$NodeProperty : "path/to/NodeID"
		});
		this.mock(_Helper).expects("drillDown").withExactArgs("~oElement~", "path/to/NodeID")
			.returns(undefined);
		this.mock(oCache).expects("requestProperties")
			.withExactArgs("~oElement~", ["path/to/NodeID"], "~oGroupLock~", true, "~bDropFilter~")
			.resolves(undefined);

		assert.strictEqual(
			// code under test
			await oCache.requestNodeProperty("~oElement~", "~oGroupLock~", "~bDropFilter~"),
			undefined, "without a defined result");
	});

	//*********************************************************************************************
	QUnit.test("requestNodeProperty: already available", async function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X",
			$NodeProperty : "path/to/NodeID"
		});
		this.mock(_Helper).expects("drillDown").withExactArgs("~oElement~", "path/to/NodeID")
			.returns(""); // edge case :-)
		this.mock(oCache).expects("requestProperties").never();
		this.mock(_Helper).expects("inheritPathValue").never();

		assert.strictEqual(
			// code under test
			await oCache.requestNodeProperty("~oElement~", "~oGroupLock~", "n/a"),
			undefined, "without a defined result");
	});

	//*********************************************************************************************
[
	{firstLevel : true},
	{firstLevel : false, parentLeaf : false},
	{firstLevel : false, parentLeaf : true}
].forEach(function (oFixture) {
	[false, true].forEach((bCreated) => {
		[false, true].forEach((bCount) => {
			const sTitle = `_delete: ${JSON.stringify(oFixture)}, created=${bCreated}`
				+ `, count=${bCount}`;

	QUnit.test(sTitle, function (assert) {
		var oCountExpectation, oRemoveExpectation;

		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.aElements.$count = "~$count~";
		if (bCount) {
			oCache.oCountPromise = "~oCountPromise~";
		}
		const fnCallback = sinon.spy();
		const oParentCache = {
			getValue : mustBeMocked,
			removeElement : mustBeMocked
		};

		const oElement = oCache.aElements[2] = {};
		if (bCreated) { // simulate a created persisted element
			oElement["@$ui5.context.isTransient"] = false;
		}
		oCache.aElements[3] = "~oParent~";
		if (oFixture.firstLevel) {
			oCache.oFirstLevel = oParentCache;
		}
		const oHelperMock = this.mock(_Helper);
		oHelperMock.expects("getPrivateAnnotation")
			.withExactArgs(sinon.match.same(oElement), "parent")
			.returns(oParentCache);
		oHelperMock.expects("getPrivateAnnotation")
			.withExactArgs(sinon.match.same(oElement), "predicate")
			.returns("~predicate~");
		this.mock(oCache).expects("createCountPromise").exactly(bCount ? 1 : 0).withExactArgs();
		this.mock(this.oRequestor).expects("request")
			.withExactArgs("DELETE", "~editUrl~", "~oGroupLock~", {
				"If-Match" : sinon.match.same(oElement)
			})
			.callsFake(() => {
				this.mock(oCache.oTreeState).expects("delete")
					.withExactArgs(sinon.match.same(oElement));
				this.mock(_Cache).expects("getElementIndex")
					.withExactArgs(sinon.match.same(oCache.aElements), "~predicate~", 2)
					.returns(4);
				oHelperMock.expects("getPrivateAnnotation")
					.withExactArgs(sinon.match.same(oElement), "rank", 0).returns("~rank~");
				const oParentCacheMock = this.mock(oParentCache);
				oRemoveExpectation = oParentCacheMock.expects("removeElement")
					.withExactArgs("~rank~", "~predicate~").returns("~iIndexInParentCache~");
				oHelperMock.expects("getPrivateAnnotation")
					.withExactArgs(sinon.match.same(oElement), "descendants", 0)
					.returns(oFixture.firstLevel ? 3 : 0);
				oParentCacheMock.expects("removeElement").exactly(oFixture.firstLevel ? 3 : 0)
					.withExactArgs("~iIndexInParentCache~");
				this.mock(oCache).expects("adjustDescendantCount")
					.exactly(oFixture.firstLevel ? 1 : 0)
					.withExactArgs(sinon.match.same(oElement), 4, oFixture.firstLevel ? -4 : -1);
				oCountExpectation = this.mock(oParentCache).expects("getValue")
					.exactly(oFixture.firstLevel ? 0 : 1)
					.withExactArgs("$count").returns(oFixture.parentLeaf ? 0 : 5);
				this.mock(oCache).expects("makeLeaf").exactly(oFixture.parentLeaf ? 1 : 0)
					.withExactArgs("~oParent~");
				this.mock(oCache).expects("shiftRank")
					.withExactArgs(4, oFixture.firstLevel ? -4 : -1);
				this.mock(oCache).expects("removeElement")
					.withExactArgs(4, "~predicate~");

				return Promise.resolve();
			});
		this.mock(oCache).expects("readCount").withExactArgs("~oGroupLock~").resolves("n/a");

		// code under test
		const oDeletePromise = oCache._delete("~oGroupLock~", "~editUrl~", "2", "n/a", fnCallback);

		assert.ok(oDeletePromise.isPending(), "a SyncPromise");

		return oDeletePromise.then(function () {
			assert.strictEqual(fnCallback.callCount, 1);
			assert.deepEqual(fnCallback.args[0], [4, -1]);
			if (!oFixture.firstLevel) {
				sinon.assert.callOrder(oRemoveExpectation, oCountExpectation);
			}
		});
	});
		});
	});
});

	//*********************************************************************************************
[false, true].forEach((bCount) => {
	QUnit.test("_delete: during side-effects refresh, bCount=" + bCount, function () {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.aElements[2] = "~oElement~";
		// oCache.aElements.$count === undefined => side-effects refresh in progress
		oCache.oCountPromise = bCount ? "~oCountPromise~" : undefined;
		const fnCallback = mustBeMocked; // must not be called

		this.mock(_Cache).expects("getElementIndex").never();
		this.mock(oCache).expects("adjustDescendantCount").never();
		this.mock(oCache).expects("makeLeaf").never();
		this.mock(oCache).expects("shiftRank").never();
		this.mock(oCache).expects("removeElement").never();
		const oHelperMock = this.mock(_Helper);
		oHelperMock.expects("getPrivateAnnotation").withExactArgs("~oElement~", "predicate")
			.returns("~sPredicate~");
		oHelperMock.expects("getPrivateAnnotation").withExactArgs("~oElement~", "parent")
			.returns("~oParentCache~");
		this.mock(oCache).expects("createCountPromise").exactly(bCount ? 1 : 0).withExactArgs();
		this.mock(this.oRequestor).expects("request")
			.withExactArgs("DELETE", "~editUrl~", "~oGroupLock~", {
				"If-Match" : "~oElement~"
			})
			.callsFake(() => {
				this.mock(oCache.oTreeState).expects("delete").withExactArgs("~oElement~");

				return Promise.resolve();
			});
		this.mock(oCache).expects("readCount").withExactArgs("~oGroupLock~").resolves("n/a");

		// code under test
		return oCache._delete("~oGroupLock~", "~editUrl~", "2", "n/a", fnCallback);
	});
});

	//*********************************************************************************************
	QUnit.test("_delete: request fails", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		const fnCallback = sinon.spy();
		const oElement = {};

		oCache.aElements[2] = oElement;
		this.mock(this.oRequestor).expects("request")
			.withExactArgs("DELETE", "~editUrl~", "~oGroupLock~",
				{"If-Match" : sinon.match.same(oElement)})
			.returns(Promise.reject("~error~"));
		this.mock(oCache).expects("readCount").withExactArgs("~oGroupLock~");

		// code under test
		const oDeletePromise = oCache._delete("~oGroupLock~", "~editUrl~", "2", "n/a", fnCallback);

		assert.ok(oDeletePromise.isPending(), "a SyncPromise");

		return oDeletePromise.then(function () {
			assert.ok(false);
		}, function (oError) {
			assert.strictEqual(oError, "~error~");
			assert.strictEqual(fnCallback.callCount, 0);
		});
	});

	//*********************************************************************************************
	QUnit.test("_delete: transient node", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		const oElement = {
			"@$ui5.context.isTransient" : true
		};
		const oParentCache = {
			_delete : mustBeMocked
		};

		oCache.aElements[2] = oElement;
		const oHelperMock = this.mock(_Helper);
		oHelperMock.expects("getPrivateAnnotation")
			.withExactArgs(sinon.match.same(oElement), "predicate").returns("n/a");
		oHelperMock.expects("getPrivateAnnotation")
			.withExactArgs(sinon.match.same(oElement), "parent")
			.returns(oParentCache);
		oHelperMock.expects("getPrivateAnnotation")
			.withExactArgs(sinon.match.same(oElement), "transientPredicate")
			.returns("~transientPredicate~");
		this.mock(oParentCache).expects("_delete")
			.withExactArgs("~oGroupLock~", "~editUrl~", "~transientPredicate~")
			.returns("~promise~");
		this.mock(oCache).expects("readCount").never();

		assert.strictEqual(
			// code under test
			oCache._delete("~oGroupLock~", "~editUrl~", "2"),
			"~promise~"
		);
	});

	//*********************************************************************************************
	QUnit.test("_delete: expanded node", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
				hierarchyQualifier : "X"
			});
		const oElement = {
			"@$ui5.node.isExpanded" : true
		};
		oCache.aElements[2] = oElement;

		this.mock(_Helper).expects("getPrivateAnnotation")
			.withExactArgs(sinon.match.same(oElement), "predicate").returns("(42)");
		this.mock(this.oRequestor).expects("request").never();
		this.mock(oCache).expects("removeElement").never();
		this.mock(_Helper).expects("updateAll").never();
		this.mock(oCache).expects("readCount").never();

		assert.throws(function () {
			oCache._delete("~oGroupLock~", "edit/url", "2");
		}, new Error("Unsupported expanded node: Foo(42)"));
	});

	//*********************************************************************************************
	QUnit.test("_delete: kept-alive not in collection", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
				hierarchyQualifier : "X"
			});
		this.mock(oCache).expects("removeElement").never();
		this.mock(_Helper).expects("updateAll").never();
		this.mock(oCache).expects("readCount").never();

		assert.throws(function () {
			oCache._delete("~oGroupLock~", "~sEditUrl~", "('1')");
		}, new Error("Unsupported kept-alive entity: Foo('1')"));
	});

	//*********************************************************************************************
	// in: array of arrays with level, descendants
	// isAncestorOf gives the expected calls of the function and its results
	// leaf: index of a node becoming a leaf
	// nonLeaf: index of a node becoming not a leaf anymore
	// out: array of descendants values
[{
	// Placeholder at 3 must be ignored, 2 and 1 are ancestors, 0 must never be looked at
	// Note: level -1 is unrealistic, but enforces that the loop stops at level 1
	in : [[-1, 0], [1, 30], [2, 29], [0, undefined], [3, 0], [3, 1]],
	isAncestorOf : [[2, 5, true]],
	out : [0, 7, 6, undefined, 0, 1]
}, { // Placeholder at 2 must be ignored, but 1 is no ancestor
	in : [[1, 30], [2, 0], [0, undefined], [3, 1]],
	isAncestorOf : [[1, 3, false], [0, 3, true]],
	out : [7, 0, undefined, 1]
}, { // nothing to do, no visible ancestor
	in : [[1, 8]],
	out : [8]
}, { // root becomes leaf
	in : [[1, 23], [2, 0]],
	leaf : 0,
	out : [0, 0]
}, { // 1 becomes leaf
	in : [[1, 24], [2, 23], [3, 0]],
	leaf : 1,
	out : [1, 0, 0]
}, { // parent not a leaf anymore (in real life, iOffset would be positive here!)
	in : [[1, undefined], [2, 17]],
	nonLeaf : 0,
	out : [-23, 17]
}].forEach(function (oFixture, i) {
	QUnit.test("adjustDescendantCount #" + i, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.aElements = oFixture.in.map(([iLevel, iDescendants]) => ({
			"@$ui5._" : {descendants : iDescendants, predicate : iLevel + "," + iDescendants},
			"@$ui5.node.level" : iLevel
		}));

		const oCacheMock = this.mock(oCache);
		if (oFixture.isAncestorOf) {
			oFixture.isAncestorOf.forEach(([iIndex0, iIndex1, bResult]) => {
				oCacheMock.expects("isAncestorOf").withExactArgs(iIndex0, iIndex1).returns(bResult);
			});
		} else {
			oCacheMock.expects("isAncestorOf").never();
		}
		oCacheMock.expects("makeLeaf").exactly("leaf" in oFixture ? 1 : 0)
			.withExactArgs(sinon.match.same(oCache.aElements[oFixture.leaf]));
		this.mock(_Helper).expects("updateAll").exactly("nonLeaf" in oFixture ? 1 : 0)
			.withExactArgs(sinon.match.same(oCache.mChangeListeners),
				oCache.aElements[oFixture.nonLeaf]?.["@$ui5._"].predicate,
				sinon.match.same(oCache.aElements[oFixture.nonLeaf]),
				{"@$ui5.node.isExpanded" : true});

		const iIndex = oFixture.in.length - 1;
		// code under test
		oCache.adjustDescendantCount(oCache.aElements[iIndex], iIndex, -23);

		assert.deepEqual(
			oCache.aElements.map((oElement) => oElement["@$ui5._"].descendants),
			oFixture.out);
	});
});

	//*********************************************************************************************
	QUnit.test("makeLeaf", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
				hierarchyQualifier : "X"
			});
		const oElement = {"@$ui5.node.isExpanded" : true};

		this.mock(_Helper).expects("getPrivateAnnotation")
			.withExactArgs(sinon.match.same(oElement), "predicate")
			.returns("~predicate~");
		this.mock(_Helper).expects("updateAll")
			.withExactArgs(sinon.match.same(oCache.mChangeListeners), "~predicate~",
				sinon.match.same(oElement), {"@$ui5.node.isExpanded" : undefined});
		this.mock(_Helper).expects("deletePrivateAnnotation")
			.withExactArgs(sinon.match.same(oElement), "descendants");

		// code under test
		oCache.makeLeaf(oElement);

		assert.notOk("@$ui5.node.isExpanded" in oElement);
	});

	//*********************************************************************************************
	QUnit.test("requestOutOfPlaceNodes", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.bUnifiedCache = true;
		const oGroupLock = {getUnlockedCopy : mustBeMocked};

		const aOutOfPlaceByParent = ["~outOfPlace1~", "~outOfPlace2~"];
		this.mock(oCache.oTreeState).expects("getOutOfPlaceGroupedByParent").withExactArgs()
			.returns(aOutOfPlaceByParent);
		this.mock(oCache.oFirstLevel).expects("getQueryOptions").withExactArgs()
			.returns("~firstLevelQueryOptions~");
		const oAggregationHelperMock = this.mock(_AggregationHelper);
		oAggregationHelperMock.expects("getQueryOptionsForOutOfPlaceNodesRank")
			.withExactArgs(sinon.match.same(aOutOfPlaceByParent),
				sinon.match.same(oCache.oAggregation), "~firstLevelQueryOptions~")
			.returns("~queryOptions0~");
		const oRequestorMock = this.mock(oCache.oRequestor);
		oRequestorMock.expects("buildQueryString")
			.withExactArgs("/Foo", "~queryOptions0~", false, true).returns("?~query0~");
		const oGroupLockMock = this.mock(oGroupLock);
		oGroupLockMock.expects("getUnlockedCopy").withExactArgs().returns("~oGroupLock0~");
		oRequestorMock.expects("request").withExactArgs("GET", "Foo?~query0~", "~oGroupLock0~")
			.returns("~request0~");
		// outOfPlace1
		oAggregationHelperMock.expects("getQueryOptionsForOutOfPlaceNodesData")
			.withExactArgs("~outOfPlace1~", sinon.match.same(oCache.oAggregation),
				sinon.match.same(oCache.mQueryOptions))
			.returns("~queryOptions1~");
		oRequestorMock.expects("buildQueryString")
			.withExactArgs("/Foo", "~queryOptions1~", false, true).returns("?~query1~");
		oGroupLockMock.expects("getUnlockedCopy").withExactArgs().returns("~oGroupLock1~");
		oRequestorMock.expects("request").withExactArgs("GET", "Foo?~query1~", "~oGroupLock1~")
			.returns("~request1~");
		// outOfPlace2
		oAggregationHelperMock.expects("getQueryOptionsForOutOfPlaceNodesData")
			.withExactArgs("~outOfPlace2~", sinon.match.same(oCache.oAggregation),
				sinon.match.same(oCache.mQueryOptions))
			.returns("~queryOptions2~");
		oRequestorMock.expects("buildQueryString")
			.withExactArgs("/Foo", "~queryOptions2~", false, true).returns("?~query2~");
		oGroupLockMock.expects("getUnlockedCopy").withExactArgs().returns("~oGroupLock2~");
		oRequestorMock.expects("request").withExactArgs("GET", "Foo?~query2~", "~oGroupLock2~")
			.returns("~request2~");

		// code under test
		assert.deepEqual(oCache.requestOutOfPlaceNodes(oGroupLock),
			["~request0~", "~request1~", "~request2~"]);
	});

	//*********************************************************************************************
	QUnit.test("requestOutOfPlaceNodes: no out of place handling needed", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});

		this.mock(oCache.oTreeState).expects("getOutOfPlaceGroupedByParent")
			.withExactArgs().returns([]);

		// code under test
		assert.deepEqual(oCache.requestOutOfPlaceNodes("~oGroupLock~"), []);
	});

	//*********************************************************************************************
	QUnit.test("handleOutOfPlaceNodes", function () {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X",
			$DrillState : "~DrillState~",
			$LimitedRank : "~LimitedRank~"
		});
		oCache.aElements.$byPredicate = {"~predicate2~" : "~node2~"};
		const oRankResult = {
			value : ["~parent1RankResult~", "~node2RankResult~", "~node3RankResult~",
				"~node1RankResult~", "~parent2RankResult~"]
		};
		const oOutOfPlaceNodeResult1 = {
			value : ["~node1Data~", "~node2Data~"]
		};
		const oOutOfPlaceNodeResult2 = {
			value : ["~node3Data~"]
		};
		const oOutOfPlaceNodeResult3 = {
			value : ["~node4Data~"]
		};
		const oOutOfPlaceNodeResult4 = {
			value : ["~node5Data~"]
		};
		const oCacheMock = this.mock(oCache);
		const oFirstLevelMock = this.mock(oCache.oFirstLevel);
		const oHelperMock = this.mock(_Helper);
		const oTreeStateMock = this.mock(oCache.oTreeState);

		oCacheMock.expects("getTypes").atLeast(1).withExactArgs().returns("~types~");
		// oRankResult
		oHelperMock.expects("getKeyPredicate")
			.withExactArgs("~parent1RankResult~", "/Foo", "~types~")
			.returns("~parent1Predicate~");
		oHelperMock.expects("getKeyPredicate")
			.withExactArgs("~node2RankResult~", "/Foo", "~types~")
			.returns("~predicate2~");
		oHelperMock.expects("getKeyPredicate")
			.withExactArgs("~node3RankResult~", "/Foo", "~types~")
			.returns("~predicate3~");
		oHelperMock.expects("getKeyPredicate")
			.withExactArgs("~node1RankResult~", "/Foo", "~types~")
			.returns("~predicate1~");
		oHelperMock.expects("getKeyPredicate")
			.withExactArgs("~parent2RankResult~", "/Foo", "~types~")
			.returns("~parent2Predicate~");

		oTreeStateMock.expects("getOutOfPlacePredicates").withExactArgs()
			.returns(["~predicate1~", "~predicate2~", "~predicate3~", "~predicate4~",
				"~predicate5~", "~predicate6NowInPlace~", "~predicate7NowInPlace~"]);

		// parent1
		//   node1
		//   node2
		// node3
		// parent2 (collapsed)
		//   node4 (no rank)
		//     node5 (no rank)

		// "~node1Data~"
		oHelperMock.expects("getKeyPredicate").withExactArgs("~node1Data~", "/Foo", "~types~")
			.returns("~predicate1~");
		oTreeStateMock.expects("getOutOfPlace").withExactArgs("~predicate1~")
			.returns({parentPredicate : "~parent1Predicate~"});
		oHelperMock.expects("drillDown").withExactArgs("~parent1RankResult~", "~DrillState~")
			.returns("expanded");
		oHelperMock.expects("merge").withExactArgs("~node1Data~", "~node1RankResult~");
		oHelperMock.expects("drillDown").withExactArgs("~node1Data~", "~LimitedRank~").returns("4");
		oFirstLevelMock.expects("calculateKeyPredicate")
			.withExactArgs("~node1Data~", "~types~", "/Foo");
		oHelperMock.expects("deleteProperty").withExactArgs("~node1Data~", "~LimitedRank~");
		oCacheMock.expects("insertNode").withExactArgs("~node1Data~", 4)
			.callsFake(function () {
				oCache.aElements.$byPredicate["~predicate1~"] = "~node1Data~";
			});
		// "~node2Data~": already in $byPredicate
		oHelperMock.expects("getKeyPredicate").withExactArgs("~node2Data~", "/Foo", "~types~")
			.returns("~predicate2~");
		// "~node3Data~"
		oHelperMock.expects("getKeyPredicate").withExactArgs("~node3Data~", "/Foo", "~types~")
			.returns("~predicate3~");
		oTreeStateMock.expects("getOutOfPlace").withExactArgs("~predicate3~")
			.returns({/*no parentPredicate*/});
		oHelperMock.expects("merge").withExactArgs("~node3Data~", "~node3RankResult~");
		oHelperMock.expects("drillDown").withExactArgs("~node3Data~", "~LimitedRank~").returns("5");
		oFirstLevelMock.expects("calculateKeyPredicate")
			.withExactArgs("~node3Data~", "~types~", "/Foo");
		oHelperMock.expects("deleteProperty").withExactArgs("~node3Data~", "~LimitedRank~");
		oCacheMock.expects("insertNode").withExactArgs("~node3Data~", 5)
			.callsFake(function () {
				oCache.aElements.$byPredicate["~predicate3~"] = "~node3Data~";
			});
		// "~node4Data~": parent is collapsed
		oHelperMock.expects("getKeyPredicate").withExactArgs("~node4Data~", "/Foo", "~types~")
			.returns("~predicate4~");
		oTreeStateMock.expects("getOutOfPlace").withExactArgs("~predicate4~")
			.returns({parentPredicate : "~parent2Predicate~"});
		oHelperMock.expects("drillDown").withExactArgs("~parent2RankResult~", "~DrillState~")
			.returns("collapsed");
		// "~node5Data~": below node4 (no rank)
		oHelperMock.expects("getKeyPredicate").withExactArgs("~node5Data~", "/Foo", "~types~")
			.returns("~predicate5~");
		oTreeStateMock.expects("getOutOfPlace").withExactArgs("~predicate5~")
			.returns({parentPredicate : "~predicate4~"});

		const oDeleteOutOfPlace6Expectation = oTreeStateMock.expects("deleteOutOfPlace")
			.withExactArgs("~predicate6NowInPlace~");
		const oDeleteOutOfPlace7Expectation = oTreeStateMock.expects("deleteOutOfPlace")
			.withExactArgs("~predicate7NowInPlace~");

		// move nodes
		const oOutOfPlaceGroupedByParentExpectation = oTreeStateMock
			.expects("getOutOfPlaceGroupedByParent").withExactArgs()
			.returns([{
				nodePredicates : "~parent1NodePredicates~",
				parentPredicate : "~parent1Predicate~"
			}, {
				nodePredicates : "~parent2NodePredicates~",
				parentPredicate : "~parent2Predicate~"
			}, {
				nodePredicates : "~rootNodePredicates~"
			}]);
		oHelperMock.expects("drillDown").withExactArgs("~parent1RankResult~", "~LimitedRank~")
			.returns("42"); // doesn't really matter, but must be a number
		oCacheMock.expects("moveOutOfPlaceNodes").withExactArgs(42, "~parent1NodePredicates~");
		oHelperMock.expects("drillDown").withExactArgs("~parent2RankResult~", "~LimitedRank~")
			.returns("23"); // doesn't really matter, but must be a number
		oCacheMock.expects("moveOutOfPlaceNodes").withExactArgs(23, "~parent2NodePredicates~");
		oCacheMock.expects("moveOutOfPlaceNodes").withExactArgs(undefined, "~rootNodePredicates~");

		// code under test
		oCache.handleOutOfPlaceNodes([oRankResult, oOutOfPlaceNodeResult1, oOutOfPlaceNodeResult2,
			oOutOfPlaceNodeResult3, oOutOfPlaceNodeResult4]);

		sinon.assert.callOrder(oDeleteOutOfPlace6Expectation, oDeleteOutOfPlace7Expectation,
			oOutOfPlaceGroupedByParentExpectation);
	});

	//*********************************************************************************************
	QUnit.test("handleOutOfPlaceNodes: no out of place handling", function () {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});

		this.mock(oCache.oFirstLevel).expects("calculateKeyPredicate").never();
		this.mock(oCache).expects("insertNode").never();

		// code under test
		oCache.handleOutOfPlaceNodes([]);
	});

	//*********************************************************************************************
	QUnit.test("insertNode: defaulting", function () {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		this.mock(oCache).expects("addElements")
			.withExactArgs("~oNode~", "~iRank~", sinon.match.same(oCache.oFirstLevel), "~iRank~");
		this.mock(oCache.oFirstLevel).expects("removeElement").withExactArgs("~iRank~");
		this.mock(oCache.oFirstLevel).expects("restoreElement").withExactArgs("~iRank~", "~oNode~");

		// code under test
		oCache.insertNode("~oNode~", "~iRank~");
	});

	//*********************************************************************************************
	QUnit.test("insertNode: index != rank", function () {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		this.mock(oCache).expects("addElements")
			.withExactArgs("~oNode~", "~iInsertIndex~", sinon.match.same(oCache.oFirstLevel),
				"~iRank~");
		this.mock(oCache.oFirstLevel).expects("removeElement").withExactArgs("~iRank~");
		this.mock(oCache.oFirstLevel).expects("restoreElement").withExactArgs("~iRank~", "~oNode~");

		// code under test
		oCache.insertNode("~oNode~", "~iRank~", "~iInsertIndex~");
	});

	//*********************************************************************************************
	QUnit.test("getSiblingIndex: group level", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			// expandTo : 1, // @see _AggregationHelper.buildApply4Hierarchy
			hierarchyQualifier : "X"
		});
		const oCacheMock = this.mock(oCache);
		const oGroupLevel = {};
		oCache.aElements = [/*first level*/, /*first level*/, {
			"@$ui5._" : {
				parent : oGroupLevel,
				rank : 0
			},
			"@$ui5.node.level" : 2
		}, /*third level*/, {
			"@$ui5._" : {
				parent : oGroupLevel,
				rank : 1
			},
			"@$ui5.node.level" : 2
		}, {
			"@$ui5._" : {
				parent : oGroupLevel,
				placeholder : true,
				rank : 2
			},
			"@$ui5.node.level" : 2
		}];
		oGroupLevel.aElements = [oCache.aElements[2], oCache.aElements[4]];
		oGroupLevel.aElements.$count = 3;
		this.mock(_AggregationHelper).expects("findPreviousSiblingIndex").never();

		oCacheMock.expects("findIndex").never();

		// code under test
		assert.strictEqual(oCache.getSiblingIndex(2, -1), -1);

		// code under test
		assert.strictEqual(oCache.getSiblingIndex(5, +1), -1);

		oCacheMock.expects("findIndex").withExactArgs(1, sinon.match.same(oGroupLevel))
			.returns("A");
		oCache.aElements.A = {"@$ui5._" : {parent : oGroupLevel}};

		// code under test
		assert.strictEqual(oCache.getSiblingIndex(2, +1), "A");

		oCacheMock.expects("findIndex").withExactArgs(0, sinon.match.same(oGroupLevel))
			.returns("B");
		oCache.aElements.B = {"@$ui5._" : {parent : oGroupLevel}};

		// code under test
		assert.strictEqual(oCache.getSiblingIndex(4, -1), "B");

		oCacheMock.expects("findIndex").twice()
			.withExactArgs(2, sinon.match.same(oGroupLevel)).returns("C");
		oCache.aElements.C = {"@$ui5._" : {parent : oGroupLevel, placeholder : true}};

		// code under test
		assert.strictEqual(oCache.getSiblingIndex(4, +1), undefined, "placeholder not allowed");
		assert.strictEqual(oCache.getSiblingIndex(4, +1, true), "C");

		oCacheMock.expects("findIndex").withExactArgs(1, sinon.match.same(oGroupLevel))
			.returns("D");
		oCache.aElements.D = {"@$ui5._" : {parent : oGroupLevel}};

		// code under test
		assert.strictEqual(oCache.getSiblingIndex(5, -1), "D");

		oCacheMock.expects("findIndex").withExactArgs(1, sinon.match.same(oGroupLevel))
			.returns("E");
		oCache.aElements.E = {
			"@$ui5._" : {parent : oGroupLevel},
			"@$ui5.context.isTransient" : false // OOP
		};
		oCacheMock.expects("getSiblingIndex").withExactArgs(2, +1, "~bAllowPlaceholder~")
			.callThrough(); // c.u.t.
		oCacheMock.expects("getSiblingIndex").withExactArgs("E", +1, "~bAllowPlaceholder~")
			.returns("E++");

		// code under test ("sibling is out of place, skip it!")
		assert.strictEqual(oCache.getSiblingIndex(2, +1, "~bAllowPlaceholder~"), "E++");

		oCacheMock.expects("findIndex").withExactArgs(0, sinon.match.same(oGroupLevel))
			.returns("F");
		oCache.aElements.F = {
			"@$ui5._" : {parent : oGroupLevel},
			"@$ui5.context.isTransient" : false // OOP
		};
		oCacheMock.expects("getSiblingIndex").withExactArgs(4, -1, "~bAllowPlaceholder~")
			.callThrough(); // c.u.t.
		oCacheMock.expects("getSiblingIndex").withExactArgs("F", -1, "~bAllowPlaceholder~")
			.returns("F--");

		// code under test ("sibling is out of place, skip it!")
		assert.strictEqual(oCache.getSiblingIndex(4, -1, "~bAllowPlaceholder~"), "F--");
	});

	//*********************************************************************************************
	QUnit.test("getSiblingIndex: group level, index not found", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			// expandTo : 1, // @see _AggregationHelper.buildApply4Hierarchy
			hierarchyQualifier : "X"
		});
		const oCacheMock = this.mock(oCache);
		const oGroupLevel = {};
		oCache.aElements = [/*first level*/, {
			"@$ui5._" : {
				parent : oGroupLevel,
				rank : undefined // OOP
			},
			"@$ui5.node.level" : 2
		}, {
			"@$ui5._" : {
				parent : oGroupLevel,
				rank : 0
			},
			"@$ui5.node.level" : 2
		}];
		oGroupLevel.aElements = [oCache.aElements[1], oCache.aElements[2]];
		oGroupLevel.aElements.$count = 2;
		oCacheMock.expects("findIndex").withExactArgs(1, sinon.match.same(oGroupLevel))
			.returns(-1);

		// code under test
		assert.strictEqual(oCache.getSiblingIndex(2, +1), -1);
	});

	//*********************************************************************************************
	QUnit.test("getSiblingIndex: 1st level, expandTo : 1", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			expandTo : 1, // @see _AggregationHelper.buildApply4Hierarchy
			hierarchyQualifier : "X"
		});
		const oCacheMock = this.mock(oCache);
		const oFirstLevel = {};
		oCache.aElements = [{
			"@$ui5._" : {
				parent : oFirstLevel,
				placeholder : true, // unrealistic, but more illustrative
				rank : 0
			},
			"@$ui5.node.level" : 1
		}, {
			"@$ui5._" : {
				parent : oFirstLevel,
				placeholder : true, // unrealistic, but more illustrative
				rank : 1
			},
			"@$ui5.node.level" : 1
		}];
		oFirstLevel.aElements = [oCache.aElements[0]];
		oFirstLevel.aElements.$count = oCache.aElements.length;
		oCache.oFirstLevel = oFirstLevel;
		this.mock(_AggregationHelper).expects("findPreviousSiblingIndex").never();

		oCacheMock.expects("findIndex").never();

		// code under test
		assert.strictEqual(oCache.getSiblingIndex(0, -1), -1);

		oCacheMock.expects("findIndex").twice()
			.withExactArgs(1, sinon.match.same(oFirstLevel)).returns(1);

		// code under test
		assert.strictEqual(oCache.getSiblingIndex(0, +1), undefined, "placeholder not allowed");
		assert.strictEqual(oCache.getSiblingIndex(0, +1, true), 1);

		oCacheMock.expects("findIndex").twice()
			.withExactArgs(0, sinon.match.same(oFirstLevel)).returns(0);

		// code under test
		assert.strictEqual(oCache.getSiblingIndex(1, -1), undefined, "placeholder not allowed");
		assert.strictEqual(oCache.getSiblingIndex(1, -1, true), 0);
	});

	//*********************************************************************************************
[false, true].forEach((bHasExpandLevels) => {
	const sTitle = "getSiblingIndex: 1st level, not a single level, next, has $ExpandLevels: "
		+ bHasExpandLevels;

	QUnit.test(sTitle, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			$ExpandLevels : bHasExpandLevels ? "..." : undefined,
			expandTo : bHasExpandLevels ? 1 : 2,
			hierarchyQualifier : "X"
		});
		const oCacheMock = this.mock(oCache);
		const oFirstLevel = {};
		oCache.aElements = [{
			"@$ui5._" : {
				parent : oFirstLevel,
				rank : 0
			},
			"@$ui5.node.level" : 1
		}, {
			"@$ui5._" : {
				descendants : 1,
				parent : oFirstLevel,
				rank : 1
			},
			"@$ui5.node.level" : 1
		}, {
			"@$ui5._" : {
				parent : oFirstLevel,
				rank : 2
			},
			"@$ui5.node.level" : 2
		}, {
			"@$ui5._" : {
				parent : oFirstLevel,
				rank : 3
			},
			"@$ui5.node.level" : 1
		}];
		oFirstLevel.aElements = oCache.aElements.slice(); // two arrays, but same elements!
		oFirstLevel.aElements.$count = oFirstLevel.aElements.length;
		oCache.oFirstLevel = oFirstLevel;
		this.mock(_AggregationHelper).expects("findPreviousSiblingIndex").never();

		oCacheMock.expects("findIndex").never();

		// code under test
		assert.strictEqual(oCache.getSiblingIndex(2, +1), -1);

		// code under test
		assert.strictEqual(oCache.getSiblingIndex(3, +1), -1);

		oCacheMock.expects("findIndex").withExactArgs(1, sinon.match.same(oFirstLevel))
			.returns("A");
		oCache.aElements.A = {"@$ui5._" : {parent : oFirstLevel}};

		// code under test
		assert.strictEqual(oCache.getSiblingIndex(0, +1), "A");

		oCacheMock.expects("findIndex").withExactArgs(3, sinon.match.same(oFirstLevel))
			.returns("B");
		oCache.aElements.B = {"@$ui5._" : {parent : oFirstLevel}};

		// code under test
		assert.strictEqual(oCache.getSiblingIndex(1, +1), "B");

		oCacheMock.expects("findIndex").withExactArgs(3, sinon.match.same(oFirstLevel))
			.returns("C");
		oCache.aElements.C = {"@$ui5._" : {parent : oFirstLevel, placeholder : true}};

		// code under test
		assert.strictEqual(oCache.getSiblingIndex(1, +1), undefined, "placeholder => cannot tell");
	});
});

	//*********************************************************************************************
[undefined, -1, 0, 1, 12].forEach((iResult) => {
	QUnit.test(`getSiblingIndex: findPreviousSiblingIndex=${iResult}`, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			expandTo : 2,
			hierarchyQualifier : "X"
		});
		oCache.aElements[42] = { // oNode
			"@$ui5._" : {
				parent : oCache.oFirstLevel,
				rank : 23
			}
		};
		this.mock(_AggregationHelper).expects("findPreviousSiblingIndex")
			.withExactArgs(sinon.match.same(oCache.oFirstLevel.aElements), 23)
			.returns(iResult);
		this.mock(oCache).expects("findIndex").exactly(iResult >= 0 ? 1 : 0)
			.withExactArgs(iResult, sinon.match.same(oCache.oFirstLevel))
			.returns(17);
		oCache.aElements[17] = {}; // not a placeholder

		assert.strictEqual(
			// code under test
			oCache.getSiblingIndex(42, -1),
			iResult >= 0 ? 17 : iResult
		);
	});
});

	//*********************************************************************************************
	QUnit.test("getSiblingIndex: no request for last", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			// Note: expandTo > 1, but not really used here
			hierarchyQualifier : "X"
		});
		const oFirstLevel = {};
		// 0 Alpha (not loaded)
		//   1 Beta
		//     2 Gamma (not loaded)
		oCache.aElements = [{
			"@$ui5._" : {
				parent : oFirstLevel,
				placeholder : true,
				rank : 0
			},
			"@$ui5.node.level" : 0
		}, { // oNode: 1 (Beta)
			"@$ui5._" : {
				descendants : 1,
				parent : oFirstLevel,
				rank : 1
			},
			"@$ui5.node.level" : 2
		}, {
			"@$ui5._" : {
				parent : oFirstLevel,
				placeholder : true,
				rank : 2
			},
			"@$ui5.node.level" : 0
		}];
		oFirstLevel.aElements = [, oCache.aElements[1]];
		oFirstLevel.aElements.$count = oCache.aElements.length;
		// oCache.oFirstLevel = oFirstLevel; // does not matter here

		this.mock(oCache).expects("findIndex").never();

		// code under test
		assert.strictEqual(oCache.getSiblingIndex(1, +1), -1);
	});

	//*********************************************************************************************
[-1, 0, 1, 42].forEach((iSiblingIndex) => {
	QUnit.test(`requestSiblingIndex: no request for ${iSiblingIndex}`, async function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			// Note: expandTo not really used here
			hierarchyQualifier : "X"
		});

		this.mock(oCache).expects("getSiblingIndex").withExactArgs("~iIndex~", "~iOffset~", true)
			.returns(iSiblingIndex);

		assert.strictEqual(
			// code under test
			await oCache.requestSiblingIndex("~iIndex~", "~iOffset~", "~oGroupLock~"),
			iSiblingIndex);
	});
});

	//*********************************************************************************************
[-1, +1].forEach((iOffset) => {
	[false, true].forEach((bWrongLevel) => {
		[false, true].forEach((bAlreadyIn) => {
			const sTitle = `requestSiblingIndex: request via 1st level, offset ${iOffset}`
				+ `, wrong level: ${bWrongLevel}, already inside collection: ${bAlreadyIn}`;

	QUnit.test(sTitle, async function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo('42')", "", {}, {
			$DistanceFromRoot : "DistFromRoot",
			$LimitedRank : "Ltd_Rank",
			// Note: expandTo > 1, but not really used here
			hierarchyQualifier : "X"
		});
		const oFirstLevel = {
			calculateKeyPredicate : mustBeMocked,
			mQueryOptions : {
				foo : "~foo~",
				bar : "~bar~",
				$apply : "A.P.P.L.E.",
				$count : true,
				$select : ["a", "b", "c"]
			}
		};
		oCache.aElements = [{/*unused*/}, {/*unused*/}, { // oNode
			"@$ui5._" : {
				parent : oFirstLevel,
				rank : 2
			},
			"@$ui5.node.level" : 7 // unrealistic, but more illustrative
		}];
		oCache.aElements[42] = {};
		if (!bAlreadyIn) {
			oCache.aElements[42]["@$ui5._"] = {
				placeholder : true
			};
		}
		oCache.oFirstLevel = oFirstLevel;
		this.mock(oCache).expects("getSiblingIndex").withExactArgs(2, iOffset, true)
			.returns(undefined);
		const mExpectedQueryOptions = {
			foo : "~foo~",
			bar : "~bar~",
			$apply : "A.P.P.L.E.",
			$filter : iOffset < 0
				? "Ltd_Rank lt 2 and DistFromRoot lt 7"
				: "Ltd_Rank gt 2 and DistFromRoot lt 7",
			$select : ["a", "b", "c", "Ltd_Rank"],
			$top : 1
		};
		if (iOffset < 0) {
			mExpectedQueryOptions.$orderby = "Ltd_Rank desc";
		}
		this.mock(this.oRequestor).expects("buildQueryString")
			.withExactArgs("", mExpectedQueryOptions, false, true, true).returns("?~sQuery~");
		const oSibling = {
			// Note: actually set by calculateKeyPredicate from DistanceFromRoot, but never mind
			"@$ui5.node.level" : bWrongLevel ? 8 : 7
		};
		this.mock(this.oRequestor).expects("request")
			.withExactArgs("GET", "Foo('42')?~sQuery~", "~oGroupLock~")
			.resolves({
				value : [oSibling, "n/a"]
			});
		this.mock(oCache).expects("getTypes").withExactArgs().returns("~Types~");
		this.mock(oFirstLevel).expects("calculateKeyPredicate")
			.withExactArgs(sinon.match.same(oSibling), "~Types~", "/Foo");
		this.mock(_Helper).expects("drillDown")
			.withExactArgs(sinon.match.same(oSibling), "Ltd_Rank").returns("42");
		this.mock(_Helper).expects("deleteProperty")
			.withExactArgs(sinon.match.same(oSibling), "Ltd_Rank");
		this.mock(oCache).expects("insertNode").exactly(bAlreadyIn ? 0 : 1)
			.withExactArgs(sinon.match.same(oSibling), 42);

		assert.strictEqual(
			// code under test
			await oCache.requestSiblingIndex(2, iOffset, "~oGroupLock~"),
			bWrongLevel ? -1 : 42);
	});
		});
	});
});

	//*********************************************************************************************
	QUnit.test("moveOutOfPlaceNodes: below parent", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		const oNode3 = {"@$ui5.node.isExpanded" : true};
		oCache.aElements
			= ["~foo~", "~parent~", "~node2~", "~bar~", "~node1~", oNode3, "~node4~"];
		oCache.aElements.$byPredicate = {
			"~predicate1~" : "~node1~",
			"~predicate2~" : "~node2~",
			"~predicate3~" : oNode3
		};

		this.mock(oCache).expects("findIndex").withExactArgs("~iParentRank~").returns(1);
		const oTreeStateMock = this.mock(oCache.oTreeState);
		oTreeStateMock.expects("stillOutOfPlace")
			.withExactArgs("~node2~", "~predicate2~");
		oTreeStateMock.expects("stillOutOfPlace")
			.withExactArgs(sinon.match.same(oNode3), "~predicate3~");
		oTreeStateMock.expects("stillOutOfPlace")
			.withExactArgs("~node1~", "~predicate1~");
		this.mock(oCache).expects("collapse").withExactArgs("~predicate3~")
			.callsFake(function () {
				assert.strictEqual(oCache.aElements.indexOf(oNode3), 5, "not yet moved");
			});
		this.mock(oCache).expects("expand")
			.withExactArgs(sinon.match.same(_GroupLock.$cached), "~predicate3~")
			.callsFake(function () {
				assert.strictEqual(oCache.aElements.indexOf(oNode3), 2,
					"moved immediately behind parent (snapshot)");
			});

		// code under test
		oCache.moveOutOfPlaceNodes("~iParentRank~",
			// the order is important: node2 is not moved, moving node3 shifts the location of
			// node1 which must be searched again (aElements.indexOf(...))
			// node4 has changed its parent
			["~predicate2~", "~predicate3~", "~predicate4~", "~predicate1~"]);

		assert.deepEqual(oCache.aElements,
			["~foo~", "~parent~", "~node1~", oNode3, "~node2~", "~bar~", "~node4~"]);
	});

	//*********************************************************************************************
	QUnit.test("moveOutOfPlaceNodes: root nodes", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.aElements = ["~foo~", "~node2~", "~bar~", "~node1~", "~baz~"];
		oCache.aElements.$byPredicate = {
			"~predicate1~" : "~node1~",
			"~predicate2~" : "~node2~"
		};

		this.mock(oCache).expects("findIndex").never();
		const oTreeStateMock = this.mock(oCache.oTreeState);
		oTreeStateMock.expects("stillOutOfPlace").withExactArgs("~node1~", "~predicate1~");
		oTreeStateMock.expects("stillOutOfPlace").withExactArgs("~node2~", "~predicate2~");
		this.mock(oCache).expects("collapse").never();
		this.mock(oCache).expects("expand").never();

		// code under test
		oCache.moveOutOfPlaceNodes(undefined, ["~predicate1~", "~predicate2~"]);

		assert.deepEqual(oCache.aElements, ["~node2~", "~node1~", "~foo~", "~bar~", "~baz~"]);
	});

	//*********************************************************************************************
	QUnit.test("resetOutOfPlace", function () {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});

		this.mock(oCache.oTreeState).expects("resetOutOfPlace").withExactArgs();

		// code under test
		oCache.resetOutOfPlace();
	});

	//*********************************************************************************************
	QUnit.test("get1stInPlaceChildIndex: no first in-place root", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.aElements = [{
			"@$ui5.context.isTransient" : false, // OOP
			"@$ui5.node.level" : 1
		}];

		// code under test
		assert.deepEqual(oCache.get1stInPlaceChildIndex(-1), [-1]);
	});

	//*********************************************************************************************
	QUnit.test("get1stInPlaceChildIndex: first in-place root", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.aElements = [{
			"@$ui5.context.isTransient" : false, // OOP root
			"@$ui5.node.level" : 1
		}, {
			"@$ui5.context.isTransient" : false, // OOP child
			"@$ui5.node.level" : 2
		}, { // first in-place root
			"@$ui5.node.level" : 1
		}];

		// code under test
		assert.deepEqual(oCache.get1stInPlaceChildIndex(-1), [2, false, 1]);
	});

	//*********************************************************************************************
[false, true].forEach((bPlaceholder) => {
	const sTitle = "get1stInPlaceChildIndex: first in-place child, placeholder: " + bPlaceholder;

	QUnit.test(sTitle, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.aElements = [{ // avoid this trap!
			"@$ui5.node.level" : 2
		}, { // parent
			"@$ui5.node.level" : 1
		}, {
			"@$ui5.context.isTransient" : false, // OOP child
			"@$ui5.node.level" : 2
		}, {
			"@$ui5.context.isTransient" : false, // OOP grandchild
			"@$ui5.node.level" : 3
		}, { // first in-place child (might even be a level 0 placeholder)
			"@$ui5._" : bPlaceholder ? {placeholder : true} : undefined,
			"@$ui5.node.level" : bPlaceholder ? 0 : 2
		}];

		// code under test
		assert.deepEqual(oCache.get1stInPlaceChildIndex(1), [4, bPlaceholder, 2]);
	});
});

	//*********************************************************************************************
	QUnit.test("get1stInPlaceChildIndex: no first in-place child, but sibling", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.aElements = [{ // avoid this trap!
			"@$ui5.node.level" : 2
		}, { // parent
			"@$ui5.node.level" : 1
		}, {
			"@$ui5.context.isTransient" : false, // OOP
			"@$ui5.node.level" : 2
		}, { // sibling (may even be a placeholder w/ known level)
			"@$ui5._" : {placeholder : true},
			"@$ui5.node.level" : 1
		}];

		// code under test
		assert.deepEqual(oCache.get1stInPlaceChildIndex(1), [-1]);
	});

	//*********************************************************************************************
	QUnit.test("get1stInPlaceChildIndex: no first in-place child", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.aElements = [{ // avoid this trap!
			"@$ui5.node.level" : 2
		}, { // parent
			"@$ui5.node.level" : 1
		}, {
			"@$ui5.context.isTransient" : false, // OOP
			"@$ui5.node.level" : 2
		}];

		// code under test
		assert.deepEqual(oCache.get1stInPlaceChildIndex(1), [-1]);
	});

	//*********************************************************************************************
[false, true].forEach(function (bCreateInPlace) {
	[undefined, false, true].forEach(function (bIsExpanded) {
		[2, 3, 4].forEach(function (iLevel) {
			const sTitle = "isRefreshNeededAfterCreate: createInPlace=" + bCreateInPlace
				+ ", isExpanded=" + bIsExpanded + ", level=" + iLevel;

	QUnit.test(sTitle, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			createInPlace : bCreateInPlace,
			expandTo : 3,
			hierarchyQualifier : "X"
		});
		oCache.aElements[42] = {
			"@$ui5.node.isExpanded" : bIsExpanded,
			"@$ui5.node.level" : iLevel
		};

		// code under test
		assert.strictEqual(oCache.isRefreshNeededAfterCreate(42),
			bCreateInPlace && bIsExpanded === undefined && iLevel >= 3);
	});
		});
	});
});

	//*********************************************************************************************
	QUnit.test("validateAndDeleteExpandInfo: no filters", function () {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		this.mock(oCache.oTreeState).expects("getExpandFilters")
			.withExactArgs(sinon.match.func)
			.returns([]);
		this.mock(this.oRequestor).expects("request").never();

		// code under test
		return oCache.validateAndDeleteExpandInfo();
	});

	//*********************************************************************************************
	QUnit.test("validateAndDeleteExpandInfo", async function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo(42)/toBars", "", {}, {
			hierarchyQualifier : "X"
		});
		// restore _AggregationHelper.buildApply4Hierarchy of beforeEach to allow mocking it again
		_AggregationHelper.buildApply4Hierarchy.restore();
		oCache.mQueryOptions = {
			$count : true,
			$expand : {},
			$filter : "~filter~",
			$select : ["n/a"],
			$orderby : "n/a",
			foo : "bar"
		};
		const sQueryOptions = JSON.stringify(oCache.mQueryOptions);
		const oTreeStateMock = this.mock(oCache.oTreeState);
		oTreeStateMock.expects("getExpandFilters")
			.withExactArgs(sinon.match.func)
			.callsFake(function (fnFilter) {
				oCache.aElements.$byPredicate = {
					"~predicate1~" : "~in~",
					"~predicate2~" : "~out~"
				};
				oCache.aElements[0] = "~in~";

				assert.strictEqual(fnFilter("~predicate1~"), false);
				assert.strictEqual(fnFilter("~predicate2~"), true, "not in the flat list");

				return ["~filter2~", "~filter1~"]; // intentionally reversed order
			});
		const mTypes = {"/Foo/toBars" : "~Type~"};
		const oCacheMock = this.mock(oCache);
		oCacheMock.expects("getTypes").withExactArgs().returns(mTypes);
		this.mock(_Helper).expects("getKeyFilter")
			.withExactArgs("~oGroupNode~", "/Foo/toBars", sinon.match.same(mTypes))
			.returns("~filterBeforeAggregate~");
		this.mock(_AggregationHelper).expects("buildApply4Hierarchy")
			.withExactArgs(sinon.match.same(oCache.oAggregation), {
				$$filterBeforeAggregate : "~filterBeforeAggregate~",
				// no $count, $expand, $orderby anymore
				$filter : "~filter~",
				$select : ["n/a"],
				foo : "bar"
			}, true)
			.returns({
				// Note: buildApply4Hierarchy moves $$filterBeforeAggregate and $filter into $apply!
				$apply : "A.P.P.L.E.",
				$select : ["n/a"],
				foo : "bar"
			});
		this.mock(_Helper).expects("selectKeyProperties")
			.withExactArgs({
				$apply : "A.P.P.L.E.",
				$filter : "~filter1~ or ~filter2~",
				$select : [],
				foo : "bar"
			}, "~Type~")
			.callsFake((mQueryOptions) => {
				mQueryOptions.$select.push("~key~");
			});
		this.mock(this.oRequestor).expects("buildQueryString")
			.withExactArgs("/Foo/toBars", {
				$apply : "A.P.P.L.E.",
				$filter : "~filter1~ or ~filter2~",
				$select : ["~key~"],
				$top : 2,
				foo : "bar"
			}, false, true, true)
			.returns("?~query~");
		this.mock(this.oRequestor).expects("getUnlockedAutoCopy").withExactArgs("~oGroupLock~")
			.returns("~oUnlockedAutoCopy~");
		this.mock(this.oRequestor).expects("request")
			.withExactArgs("GET", "Foo(42)/toBars?~query~", "~oUnlockedAutoCopy~")
			.resolves({value : ["~oResult0~", "~oResult1~"]});

		const aExpectations = [
			oCacheMock.expects("calculateKeyPredicate")
				.withExactArgs("~oResult0~", sinon.match.same(mTypes), "/Foo/toBars"),
			oTreeStateMock.expects("deleteExpandInfo").withExactArgs("~oResult0~"),
			oCacheMock.expects("calculateKeyPredicate")
				.withExactArgs("~oResult1~", sinon.match.same(mTypes), "/Foo/toBars"),
			oTreeStateMock.expects("deleteExpandInfo").withExactArgs("~oResult1~")
		];

		// code under test
		await oCache.validateAndDeleteExpandInfo("~oGroupLock~", "~oGroupNode~");

		assert.strictEqual(JSON.stringify(oCache.mQueryOptions), sQueryOptions, "unchanged");
		sinon.assert.callOrder(...aExpectations);
	});

	//*********************************************************************************************
[
	{predicate : "(foo='')", newPredicate : "(foo='',$duplicate=id-1-23)"},
	{predicate : "('')", newPredicate : "('',$duplicate=id-1-23)"},
	{predicate : "(foo='bar')", newPredicate : undefined},
	{predicate : "('bar')", newPredicate : undefined}
].forEach(function (oFixture) {
	[false, true].forEach(function (bUpdateByPredicate) {
		const sTitle = "fixDuplicatePredicate: " + JSON.stringify(oFixture)
			+ ", bUpdateByPredicate=" + bUpdateByPredicate;

	QUnit.test(sTitle, function (assert) {
		const oCache = {
			aElements : [],
			toString : () => "~toString~"
		};
		oCache.aElements.$byPredicate = {};
		const bFix = oFixture.newPredicate !== undefined;
		const mExpectedByPredicate = {};
		if (!bFix || bUpdateByPredicate) {
			oCache.aElements.$byPredicate[oFixture.predicate] = "~oElement~";
			mExpectedByPredicate[bFix ? oFixture.newPredicate : oFixture.predicate] = "~oElement~";
		}
		this.oLogMock.expects("warning").exactly(bFix ? 1 : 0)
			.withExactArgs("Duplicate key predicate: " + oFixture.predicate, "~toString~",
				"sap.ui.model.odata.v4.lib._AggregationCache");
		this.mock(_Helper).expects("uid").exactly(bFix ? 1 : 0).withExactArgs().returns("id-1-23");
		this.mock(_Helper).expects("setPrivateAnnotation").exactly(bFix ? 1 : 0)
			.withExactArgs("~oElement~", "predicate", oFixture.newPredicate);

		// code under test
		assert.strictEqual(
			_AggregationCache.fixDuplicatePredicate.call(oCache, "~oElement~", oFixture.predicate),
			oFixture.newPredicate);

		assert.deepEqual(oCache.aElements.$byPredicate, mExpectedByPredicate);
	});
	});
});

	//*********************************************************************************************
[undefined, false].forEach((bMinimal) => {
	QUnit.test("requestFilteredOrderedPredicates: bMinimal = " + bMinimal, function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});

		return assert.rejects(
			// code under test
			oCache.requestFilteredOrderedPredicates(["~predicate1~"], "~oGroupLock~", bMinimal),
			new Error("Not implemented"));
	});
});

	//*********************************************************************************************
[false, true].forEach((bSuccess) => {
	QUnit.test("requestFilteredOrderedPredicates: success=" + bSuccess, async function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.mQueryOptions = {
			$count : true,
			$expand : "~expand~",
			$orderby : "~orderby~",
			foo : "bar"
		};
		oCache.aElements.$byPredicate = {
			"~predicate1~" : "~oElement1~",
			"~predicate2~" : "~oElement2~",
			"~predicate3~" : "~oElement3~"
		};
		const mHierarchyQueryOptions = {
			$select : ["a", "b"]
		};
		// restore _AggregationHelper.buildApply4Hierarchy of beforeEach to allow mocking it again
		_AggregationHelper.buildApply4Hierarchy.restore();
		this.mock(_AggregationHelper).expects("buildApply4Hierarchy")
			.withExactArgs(sinon.match.same(oCache.oAggregation), {foo : "bar"}, true)
			.returns(mHierarchyQueryOptions);
		const mTypeForMetaPath = {"/Foo" : "~Type~"};
		const oCacheMock = this.mock(oCache);
		oCacheMock.expects("getTypes").withExactArgs().returns(mTypeForMetaPath);
		const oHelperMock = this.mock(_Helper);
		oHelperMock.expects("selectKeyProperties")
			.withExactArgs(sinon.match.same(mHierarchyQueryOptions), "~Type~")
			.callsFake((mQueryOptions0) => {
				mQueryOptions0.$select.push("~key~");
			});
		oHelperMock.expects("getKeyFilter")
			.withExactArgs("~oElement1~", "/Foo", sinon.match.same(mTypeForMetaPath))
			.returns("~filterForPredicate1~");
		oHelperMock.expects("getKeyFilter")
			.withExactArgs("~oElement2~", "/Foo", sinon.match.same(mTypeForMetaPath))
			.returns("~filterForPredicate2~");
		oHelperMock.expects("getKeyFilter")
			.withExactArgs("~oElement3~", "/Foo", sinon.match.same(mTypeForMetaPath))
			.returns("~filterForPredicate3~");
		this.mock(oCache.oRequestor).expects("buildQueryString")
			.withExactArgs("/Foo", {
					$filter : "~filterForPredicate1~ or ~filterForPredicate2~ or"
					+ " ~filterForPredicate3~",
					$select : ["~key~"],
					$top : 3
				}, false, true, true)
			.returns("?~query~");
		this.mock(oCache.oRequestor).expects("request")
			.withExactArgs("GET", "Foo?~query~", "~oGroupLock~")
			.callsFake(() => {
				return bSuccess
					? Promise.resolve({
						value : ["~oElement1Keys~", "~oElement3Keys~"]
					})
					: Promise.reject(new Error("Request failed intentionally"));
			});
		oCacheMock.expects("calculateKeyPredicate")
			.exactly(bSuccess ? 1 : 0)
			.withExactArgs("~oElement1Keys~", sinon.match.same(mTypeForMetaPath), "/Foo");
		oHelperMock.expects("getPrivateAnnotation")
			.exactly(bSuccess ? 1 : 0)
			.withExactArgs("~oElement1Keys~", "predicate")
			.returns("~predicate1~");
		oCacheMock.expects("calculateKeyPredicate")
			.exactly(bSuccess ? 1 : 0)
			.withExactArgs("~oElement3Keys~", sinon.match.same(mTypeForMetaPath), "/Foo");
		oHelperMock.expects("getPrivateAnnotation")
			.exactly(bSuccess ? 1 : 0)
			.withExactArgs("~oElement3Keys~", "predicate")
			.returns("~predicate3~");

		try {
			// code under test
			const aPredicatesOut = await oCache.requestFilteredOrderedPredicates(
				["~predicate1~", "~predicate2~", "~predicate3~"], "~oGroupLock~", true);

			assert.ok(bSuccess);
			assert.deepEqual(aPredicatesOut, ["~predicate1~", "~predicate3~"]);
		} catch (oError) {
			assert.ok(!bSuccess);
			assert.strictEqual(oError.message, "Request failed intentionally");
		}

		assert.deepEqual(oCache.mQueryOptions, {
			$count : true,
			$expand : "~expand~",
			$orderby : "~orderby~",
			foo : "bar"
		}, "unchanged");
	});
});

	//*********************************************************************************************
	QUnit.test("createCountPromise", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});

		assert.strictEqual(oCache.oCountPromise, undefined);

		// code under test
		oCache.createCountPromise();

		assert.strictEqual(oCache.oCountPromise.isPending(), true);

		// code under test
		oCache.oCountPromise.$resolve("foo");

		assert.strictEqual(oCache.oCountPromise.getResult(), "foo");

		// code under test: $restore has no effect on a resolved promise
		oCache.oCountPromise.$restore();

		assert.strictEqual(oCache.oCountPromise.getResult(), "foo");
	});

	//*********************************************************************************************
	QUnit.test("createCountPromise: $restore initial value", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.createCountPromise();

		assert.strictEqual(oCache.oCountPromise.isPending(), true);

		// code under test
		oCache.oCountPromise.$restore();

		assert.strictEqual(oCache.oCountPromise.getResult(), undefined);
	});

	//*********************************************************************************************
	QUnit.test("createCountPromise: $restore previous value", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.oCountPromise = SyncPromise.resolve("foo");
		oCache.createCountPromise();

		assert.strictEqual(oCache.oCountPromise.isPending(), true);

		// code under test
		oCache.oCountPromise.$restore();

		assert.strictEqual(oCache.oCountPromise.getResult(), "foo");
	});

	//*********************************************************************************************
	QUnit.test("createCountPromise: $restore, don't overwrite pending promise", function (assert) {
		const oCache = _AggregationCache.create(this.oRequestor, "Foo", "", {}, {
			hierarchyQualifier : "X"
		});
		oCache.oCountPromise = SyncPromise.resolve("foo");
		oCache.createCountPromise();
		const oPendingPromise = oCache.oCountPromise;

		// code under test: don't overwrite pending promise
		oCache.createCountPromise();

		assert.strictEqual(oCache.oCountPromise, oPendingPromise);
		assert.strictEqual(oCache.oCountPromise.isPending(), true);

		// code under test
		oCache.oCountPromise.$restore();

		assert.strictEqual(oCache.oCountPromise.getResult(), "foo");
	});
});
