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

  /**
   * data-kap-links:
   *   auto   (default) every outbound link is rewired through /go
   *   tagged           only links marked data-kap-go
   *   stay             nothing navigates - the click is recorded in the
   *                    background and the visitor stays on the page
   */
  var MODE = (el && el.getAttribute('data-kap-links')) || 'auto';
  var AUTO = MODE !== 'tagged';
  var STAY = MODE === 'stay';

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

  /* ------------------------------------------------------------ stay mode */

  /** A CTA can be an <a>, a <button>, or anything the page tagged by hand. */
  function isCta(node) {
    if (!node.getAttribute) return false;
    if (node.getAttribute('data-kap-stay') !== null) return true;
    if (node.getAttribute('data-kap-go') !== null) return true;
    return node.tagName === 'A' && AUTO && isOutbound(node);
  }

  function ctaFrom(node) {
    while (node && node !== d) {
      if (isCta(node)) return node;
      node = node.parentNode;
    }
    return null;
  }

  /** Record the lander click-through without navigating: /go answers 204 here. */
  function beacon(clickid, off) {
    var url = BASE + '/go?beacon=1&clickid=' + encodeURIComponent(clickid) + (off ? '&off=' + encodeURIComponent(off) : '');
    try {
      if (w.fetch) {
        w.fetch(url, { mode: 'cors', credentials: 'include', keepalive: true })['catch'](function () {});
        return;
      }
    } catch (e) { /* fall through to the image beacon */ }
    var img = new Image();
    img.src = url;
  }

  /** Lets the page react - reveal a form, show a thank-you, open a modal. */
  function fire(node, clickid) {
    var ev;
    try {
      ev = new CustomEvent('kap:click', { bubbles: true, detail: { clickid: clickid } });
    } catch (e) {
      ev = d.createEvent('CustomEvent');
      ev.initCustomEvent('kap:click', true, false, { clickid: clickid });
    }
    node.dispatchEvent(ev);
  }

  function stayHandler(clickid) {
    d.addEventListener(
      'click',
      function (ev) {
        var cta = ctaFrom(ev.target);
        if (!cta) return;
        ev.preventDefault();
        beacon(clickid, cta.getAttribute('data-kap-offer') || '');
        fire(cta, clickid);
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
    if (STAY) {
      stayHandler(clickid);
    } else {
      delegate(clickid);
      ready(function () { decorate(clickid); });
    }
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
