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

  // Every outbound link is rewired by default; data-kap-links="tagged" narrows
  // it to links the page marked with data-kap-go.
  var AUTO = !el || (el.getAttribute('data-kap-links') || 'auto') !== 'tagged';

  var payload = { kcmp: campaign, url: w.location.href, referrer: d.referrer || '' };
  var i;
  for (i = 0; i < SUBS.length; i++) { var s = qs(SUBS[i]); if (s) payload[SUBS[i]] = s; }
  for (i = 0; i < IDS.length; i++) { var g = qs(IDS[i]); if (g) payload[IDS[i]] = g; }
  var cost = qs('cost'); if (cost) payload.cost = cost;

  /**
   * Is this an outbound CTA? Anything pointing at another host counts, which is
   * what a money link on a landing page looks like. Same-host links (privacy,
   * terms, anchors), mailto:/tel: and the tracker's own URLs are left alone, and
   * data-kap-ignore opts a link out by hand.
   */
  function isOutbound(a) {
    if (a.getAttribute('data-kap-ignore') !== null) return false;
    var href = a.getAttribute('href') || '';
    if (!/^https?:\\/\\//i.test(href)) return false;
    if (href.indexOf(BASE) === 0) return false;
    var probe = d.createElement('a');
    probe.href = href;
    return probe.host !== w.location.host;
  }

  function goUrl(a, clickid) {
    var off = a.getAttribute('data-kap-offer') || '';
    var href = a.getAttribute('href') || '';
    if (href.indexOf(BASE + '/go') === 0) {
      return href.indexOf('clickid=') > -1
        ? href
        : href + (href.indexOf('?') > -1 ? '&' : '?') + 'clickid=' + encodeURIComponent(clickid);
    }
    return BASE + '/go?clickid=' + encodeURIComponent(clickid) + (off ? '&off=' + encodeURIComponent(off) : '');
  }

  function shouldRewrite(a) {
    if (a.getAttribute('data-kap-go') !== null) return true;
    if ((a.getAttribute('href') || '').indexOf(BASE + '/go') === 0) return true;
    return AUTO && isOutbound(a);
  }

  function decorate(clickid) {
    var all = d.getElementsByTagName('a');
    for (var j = 0; j < all.length; j++) {
      if (shouldRewrite(all[j])) all[j].setAttribute('href', goUrl(all[j], clickid));
    }
  }

  /**
   * Links injected after load - popups, sliders, anything rendered by the page's
   * own scripts - never went through decorate(), so catch them at click time too.
   */
  function delegate(clickid) {
    d.addEventListener(
      'click',
      function (ev) {
        var a = ev.target;
        while (a && a.tagName !== 'A') a = a.parentNode;
        if (!a || !a.getAttribute) return;
        if ((a.getAttribute('href') || '').indexOf(BASE + '/go') === 0) return;
        if (shouldRewrite(a)) a.setAttribute('href', goUrl(a, clickid));
      },
      true
    );
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
    delegate(clickid);
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
