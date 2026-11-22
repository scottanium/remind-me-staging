/* Remind Me environment flag.
 * Live and staging use the same files. The only difference is this flag:
 *   STAGING: true  -> test site (banner, separate saves, separate cache)
 *   STAGING: false -> live site
 * Safe in both the page and the service worker (no document access required).
 */
var RemindMeConfig = { STAGING: true };

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
