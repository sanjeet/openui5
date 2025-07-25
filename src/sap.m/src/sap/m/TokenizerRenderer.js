/*!
 * ${copyright}
 */
sap.ui.define(['sap/ui/Device', 'sap/ui/core/InvisibleText'],
	function(Device, InvisibleText) {
	"use strict";


	/**
	 * Tokenizer renderer.
	 * @namespace
	 */
	var TokenizerRenderer = {
		apiVersion: 2
	};


	/**
	 * Renders the HTML for the given control, using the provided {@link sap.ui.core.RenderManager}.
	 *
	 * @param {sap.ui.core.RenderManager} oRm the RenderManager that can be used for writing to the render output buffer
	 * @param {sap.m.Tokenizer} oControl an object representation of the control that should be rendered
	 */
	TokenizerRenderer.render = function(oRm, oControl) {
		this.renderOpenTag(oRm, oControl);
		this.renderInnerContent(oRm, oControl);
	};

	/**
	 * Renders the inner content of the Tokenizer control.
	 *
	 * @protected
	 * @param {sap.ui.core.RenderManager} oRm The RenderManager that can be used for writing to the render output buffer.
	 * @param {sap.m.Tokenizer} oControl An object representation of the control that should be rendered.
	 */
	TokenizerRenderer.renderInnerContent = function(oRm, oControl) {
		var aTokens = oControl.getTokens();

		oRm.class("sapMTokenizer");

		if (!oControl.getEditable()) {
			oRm.class("sapMTokenizerReadonly");
		}

		if (!oControl.getEnabled()) {
			oRm.class("sapMTokenizerDisabled");

		}

		if (!aTokens.length) {
			oRm.class("sapMTokenizerEmpty");
			oRm.attr("aria-hidden", "true");
		}

		this.addWidthStyles(oRm, oControl);

		var oAccAttributes = {
			role: "listbox"
		}; // additional accessibility attributes

		//ARIA attributes
		oAccAttributes.labelledby = {
			value: InvisibleText.getStaticId("sap.m", "TOKENIZER_ARIA_LABEL"),
			append: true
		};

		// aria-readonly is not valid for the current role of the tokenizer.
		oRm.accessibilityState(oControl, oAccAttributes);
		oRm.openEnd(); // div element
		oRm.renderControl(oControl.getAggregation("_tokensInfo"));

		oControl._bCopyToClipboardSupport = false;

		if ((Device.system.desktop || Device.system.combi) && aTokens.length) {
			oRm.openStart("div", oControl.getId() + "-clip").class("sapMTokenizerClip");
			if (window.clipboardData) { //IE
				oRm.attr("contenteditable", "true");
				oRm.attr("tabindex", "-1");
			}
			oRm.openEnd();
			oRm.unsafeHtml("&nbsp");
			oRm.close("div");

			oControl._bCopyToClipboardSupport = true;
		}

		oRm.openStart("div", oControl.getId() + "-scrollContainer");
		oRm.class("sapMTokenizerScrollContainer");

		if (oControl.getHiddenTokensCount() === oControl.getTokens().length) {
			oRm.class("sapMTokenizerScrollContainerNoVisibleTokens");
		}

		oRm.openEnd();
		this._renderTokens(oRm, oControl);

		oRm.close("div");
		this._renderIndicator(oRm, oControl);
		oRm.close("div");
	};

	TokenizerRenderer.renderOpenTag = function(oRm, oControl) {
		oRm.openStart("div", oControl);
	};

	TokenizerRenderer.addWidthStyles = function(oRm, oControl) {
		oRm.style("max-width", oControl.getMaxWidth());

		var sPixelWdth = oControl.getWidth();
		if (sPixelWdth) {
			oRm.style("width", sPixelWdth);
		}
	};

	/**
	 * renders the tokens
	 *
	 * @param {sap.ui.core.RenderManager} oRm the RenderManager that can be used for writing to the render output buffer
	 * @param {sap.m.Tokenizer} oControl an object representation of the control that should be rendered
	 */
	TokenizerRenderer._renderTokens = function(oRm, oControl){
		var i = 0,
			tokens = oControl.getTokens(),
			length = tokens.length;

		for (i = 0; i < length; i++) {
			oRm.renderControl(tokens[i]);
		}
	};

	/**
	 * Renders the N-more indicator
	 *
	 * @param {sap.ui.core.RenderManager} oRm the RenderManager that can be used for writing to the render output buffer
	 * @param {sap.m.Tokenizer} oControl an object representation of the control that should be rendered
	 */
	TokenizerRenderer._renderIndicator = function(oRm, oControl){
		var bExpanded = oControl._oPopup?.isOpen();
		var sPopoverId = oControl._oPopup?.getDomRef() && oControl._oPopup?._oControl.getId();

		oRm.openStart("span");
		oRm.class("sapMTokenizerIndicator");

		this._renderIndicatorTabIndex(oRm, oControl);

		if (oControl.getHiddenTokensCount() === 0) {
			oRm.class("sapUiHidden");
		}

		oRm.attr("role", "button")
			.attr("aria-haspopup", "dialog")
			.attr("aria-expanded", bExpanded);

		if (sPopoverId) {
			oRm.attr("aria-controls", sPopoverId);
		}

		oRm.openEnd().close("span");
	};

	/**
	 * Callback for specific rendering of Tokenizer N-more indicator tabindex attribute.
	 *
	 * @param {sap.ui.core.RenderManager}
	 *            oRm the RenderManager currently rendering this control
	 * @param {sap.m.Tokenizer}
	 *            oControl the Tokenizer that should be rendered
	 * @private
	 *
	 * @ui5-restricted sap.ui.mdc.field.TokenizerDisplayRenderer
	 */
	TokenizerRenderer._renderIndicatorTabIndex = function(oRm, oControl) {
	};

	return TokenizerRenderer;

}, /* bExport= */ true);
