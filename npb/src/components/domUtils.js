(function (global) {
  "use strict";

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  global.NPB = global.NPB || {};
  global.NPB.domUtils = { escapeHtml };
})(window);
