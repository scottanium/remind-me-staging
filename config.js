/* Remind Me environment flag.
 * Live and staging use the same files. The only difference is STAGING:
 *   true  -> test site (banner, separate saves, separate cache)
 *   false -> live site
 * VERSION and APP_SLUG build the service-worker cache name
 * (remind-me-staging-v5 vs remind-me-v5). Bump VERSION when cached files change.
 * Safe in both the page and the service worker (no document access required).
 * Pattern copied from /workspace/pwa-shared-snippets/ (copy, not a runtime import).
 */
var RemindMeConfig = {
  STAGING: true,
  VERSION: "v5",
  APP_SLUG: "remind-me"
};

RemindMeConfig.CACHE_NAME = RemindMeConfig.STAGING
  ? RemindMeConfig.APP_SLUG + "-staging-" + RemindMeConfig.VERSION
  : RemindMeConfig.APP_SLUG + "-" + RemindMeConfig.VERSION;

(function () {
  if (typeof document === "undefined") return;
  function applyStagingBanner() {
    if (!RemindMeConfig.STAGING) return;
    var banner = document.getElementById("stagingBanner");
    if (banner) banner.classList.remove("hidden");
    if (document.body) document.body.classList.add("is-staging");
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyStagingBanner);
  } else {
    applyStagingBanner();
  }
})();
