/**
 * The no-redirect universal tracking script served at /track.js.
 * Placed on any external landing page:
 *   <script src="https://track.example.com/track.js" data-kcmp="my-campaign"></script>
 * It registers the visit server-side (so Google Ads sees the real landing page URL),
 * stores the clickid in a first-party cookie and rewires outbound offer links
 * through /go.
 */
export function trackScript(baseUrl) {
  return `/* KAP Tracker - universal no-redirect tracking script */
(function (w, d) {
  'use strict';
  var BASE = ${JSON.stringify(baseUrl)};
  var COOKIE = 'kap_clickid';
  var SUBS = ['sub1','sub2','sub3','sub4','sub5','sub6','sub7','sub8','sub9','sub10'];
  var IDS = ['gclid','fbclid','ttclid'];

  function qs(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(w.location.search);
    return m ? decodeURIComponent(m[1].replace(/\\+/g, ' ')) : '';
  }
  function getCookie(name) {
    var m = d.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function setCookie(name, value, days) {
    var e = new Date(Date.now() + days * 864e5).toUTCString();
    d.cookie = name + '=' + encodeURIComponent(value) + ';expires=' + e + ';path=/;SameSite=Lax';
  }

  function currentScript() {
    if (d.currentScript) return d.currentScript;
    var all = d.getElementsByTagName('script');
    for (var i = all.length - 1; i >= 0; i--) {
      if ((all[i].src || '').indexOf('/track.js') > -1) return all[i];
    }
    return null;
  }

  var el = currentScript();
  var campaign = (el && (el.getAttribute('data-kcmp') || el.getAttribute('data-campaign'))) ||
                 w.KAP_CAMPAIGN || qs('kcmp');

  var payload = { kcmp: campaign, url: w.location.href, referrer: d.referrer || '' };
  var i;
  for (i = 0; i < SUBS.length; i++) { var s = qs(SUBS[i]); if (s) payload[SUBS[i]] = s; }
  for (i = 0; i < IDS.length; i++) { var g = qs(IDS[i]); if (g) payload[IDS[i]] = g; }
  var cost = qs('cost'); if (cost) payload.cost = cost;

  function decorate(clickid) {
    var links = d.querySelectorAll('a[data-kap-go], a[href^="' + BASE + '/go"]');
    for (var j = 0; j < links.length; j++) {
      var a = links[j];
      var off = a.getAttribute('data-kap-offer') || '';
      var href = a.getAttribute('href') || '';
      var url;
      if (href.indexOf(BASE + '/go') === 0) {
        url = href + (href.indexOf('?') > -1 ? '&' : '?') + 'clickid=' + encodeURIComponent(clickid);
      } else {
        url = BASE + '/go?clickid=' + encodeURIComponent(clickid) + (off ? '&off=' + encodeURIComponent(off) : '');
      }
      a.setAttribute('href', url);
    }
  }

  function ready(fn) {
    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  var existing = getCookie(COOKIE);

  function finish(clickid) {
    if (!clickid) return;
    w.KAP_CLICKID = clickid;
    setCookie(COOKIE, clickid, 90);
    ready(function () { decorate(clickid); });
  }

  if (!campaign) {
    if (existing) finish(existing);
    if (w.console && w.console.warn) w.console.warn('[KAP] no campaign slug (data-kcmp) provided');
    return;
  }

  try {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', BASE + '/api/v1/track/pageview', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.withCredentials = true;
    xhr.onload = function () {
      try {
        var res = JSON.parse(xhr.responseText || '{}');
        finish(res.clickid || existing);
      } catch (e) { finish(existing); }
    };
    xhr.onerror = function () { finish(existing); };
    xhr.send(JSON.stringify(payload));
  } catch (e) {
    finish(existing);
  }
})(window, document);
`;
}

export default trackScript;
