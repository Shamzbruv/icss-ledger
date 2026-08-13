/**
 * ICSS Currency Geo-Switcher (Silent / Auto-detect only)
 * -------------------------------------------------------
 * Detects visitor location via IP geolocation.
 * If the visitor is NOT in Jamaica, all JMD prices on the page
 * are silently converted to USD equivalents. No visible UI.
 */

(function () {
  'use strict';

  var JMD_TO_USD_FALLBACK = 157;
  var CACHE_KEY = 'icss_visitor_geo';
  var RATE_CACHE_KEY = 'icss_jmd_usd_rate';
  var CACHE_TTL = 24 * 60 * 60 * 1000;

  // ─── Cache Helpers ─────────────────────────────────────────────────

  function getCached(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (Date.now() - data.ts > CACHE_TTL) {
        localStorage.removeItem(key);
        return null;
      }
      return data.value;
    } catch (_) { return null; }
  }

  function setCache(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify({ value: value, ts: Date.now() }));
    } catch (_) { }
  }

  // ─── Geo Detection ─────────────────────────────────────────────────

  function detectCountry() {
    return new Promise(function (resolve) {
      var cached = getCached(CACHE_KEY);
      if (cached) return resolve(cached);

      fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(4000) })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var country = (data.country_code || '').toUpperCase();
          if (country) {
            setCache(CACHE_KEY, country);
            return resolve(country);
          }
          throw new Error('No country');
        })
        .catch(function () {
          try {
            var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
            if (tz.indexOf('Jamaica') !== -1 || tz === 'America/Jamaica') {
              setCache(CACHE_KEY, 'JM');
              return resolve('JM');
            }
          } catch (_) { }
          setCache(CACHE_KEY, 'UNKNOWN');
          resolve('UNKNOWN');
        });
    });
  }

  // ─── Exchange Rate ─────────────────────────────────────────────────

  function getJmdToUsdRate() {
    return new Promise(function (resolve) {
      var cached = getCached(RATE_CACHE_KEY);
      if (cached) return resolve(cached);

      fetch('https://open.er-api.com/v6/latest/JMD', { signal: AbortSignal.timeout(4000) })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.rates && data.rates.USD) {
            setCache(RATE_CACHE_KEY, data.rates.USD);
            resolve(data.rates.USD);
          } else {
            resolve(1 / JMD_TO_USD_FALLBACK);
          }
        })
        .catch(function () {
          resolve(1 / JMD_TO_USD_FALLBACK);
        });
    });
  }

  // ─── Convert Static Prices (data-jmd / data-usd attributes) ───────

  function convertStaticPrices() {
    var priceDivs = document.querySelectorAll('[data-jmd][data-usd]');
    priceDivs.forEach(function (div) {
      div.textContent = div.getAttribute('data-usd');
    });
  }

  // ─── Convert Estimator Results (dynamic) ───────────────────────────

  function observeEstimatorResults(jmdToUsdRate) {
    var resultContainer = document.getElementById('estimate-result');
    if (!resultContainer) return;

    var observer = new MutationObserver(function () {
      var valueEls = resultContainer.querySelectorAll('.text-2xl.font-bold');
      valueEls.forEach(function (el) {
        var text = el.textContent.trim();
        var match = text.match(/^\$([0-9,]+)\s*JMD$/);
        if (match) {
          var jmdAmount = parseFloat(match[1].replace(/,/g, ''));
          var usdAmount = Math.round(jmdAmount * jmdToUsdRate);
          el.textContent = '$' + usdAmount.toLocaleString('en-US') + ' USD';
        }
      });
    });

    observer.observe(resultContainer, { childList: true, subtree: true });
  }

  // ─── Main ─────────────────────────────────────────────────────────

  function init() {
    detectCountry().then(function (country) {
      // Only convert if the visitor is NOT in Jamaica
      if (country === 'JM') return;

      getJmdToUsdRate().then(function (rate) {
        convertStaticPrices();
        window._icssCurrencyMode = 'USD';
        window._icssJmdToUsdRate = rate;
        observeEstimatorResults(rate);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
