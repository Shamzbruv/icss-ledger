/**
 * ICSS Currency Geo-Switcher
 * ---------------------------
 * Detects visitor location via IP geolocation.
 * If the visitor is NOT in Jamaica, all JMD prices on the page
 * are converted to USD equivalents automatically.
 *
 * Covers:
 *  - Static pricing cards (via data-jmd / data-usd attributes)
 *  - Dynamic Project Estimator output (via MutationObserver)
 *  - Clickable badge to manually toggle currency
 */

(function () {
  'use strict';

  // ─── Configuration ──────────────────────────────────────────────────
  var JMD_TO_USD_FALLBACK = 157;          // Fallback: 1 USD ≈ 157 JMD
  var CACHE_KEY = 'icss_visitor_geo';
  var RATE_CACHE_KEY = 'icss_jmd_usd_rate';
  var OVERRIDE_KEY = 'icss_currency_override';
  var CACHE_TTL = 24 * 60 * 60 * 1000;    // 24 hours

  // ─── Helpers ────────────────────────────────────────────────────────

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
    } catch (_) {
      return null;
    }
  }

  function setCache(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify({ value: value, ts: Date.now() }));
    } catch (_) { /* quota exceeded – graceful fail */ }
  }

  // ─── Geo Detection ─────────────────────────────────────────────────

  function detectCountry() {
    return new Promise(function (resolve) {
      // 1. Check cache
      var cached = getCached(CACHE_KEY);
      if (cached) return resolve(cached);

      // 2. Try ipapi.co (free tier, no key, ~1000 req/day)
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
          // 3. Fallback: timezone heuristic
          try {
            var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
            if (tz.indexOf('Jamaica') !== -1 || tz === 'America/Jamaica') {
              setCache(CACHE_KEY, 'JM');
              return resolve('JM');
            }
          } catch (_) { }
          // Default: assume international visitor
          setCache(CACHE_KEY, 'UNKNOWN');
          resolve('UNKNOWN');
        });
    });
  }

  // ─── Live Exchange Rate ────────────────────────────────────────────

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

  // ─── Currency Badge ────────────────────────────────────────────────

  function createCurrencyBadge(showingJMD) {
    // Remove existing badge if any
    var existing = document.getElementById('currency-badge');
    if (existing) existing.remove();

    var badge = document.createElement('div');
    badge.id = 'currency-badge';
    badge.setAttribute('role', 'button');
    badge.setAttribute('aria-label', 'Toggle currency between JMD and USD');
    badge.setAttribute('tabindex', '0');

    badge.style.cssText =
      'position:fixed;bottom:80px;right:20px;z-index:9999;' +
      'background:linear-gradient(135deg,#0A1A3A 0%,#142850 100%);' +
      'color:#fff;padding:10px 16px;border-radius:50px;font-size:13px;' +
      'font-family:Inter,system-ui,sans-serif;font-weight:600;cursor:pointer;' +
      'box-shadow:0 4px 20px rgba(0,0,0,0.35);display:flex;align-items:center;gap:8px;' +
      'transition:all 0.3s cubic-bezier(0.4,0,0.2,1);' +
      'border:1px solid rgba(0,245,255,0.25);' +
      'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);' +
      'user-select:none;-webkit-user-select:none;';

    var flag = showingJMD ? '🇯🇲' : '🌍';
    var currency = showingJMD ? 'JMD' : 'USD';

    badge.innerHTML =
      '<span style="font-size:18px;line-height:1">' + flag + '</span>' +
      '<span>Prices in <strong style="color:#00F5FF">' + currency + '</strong></span>' +
      '<svg width="10" height="10" viewBox="0 0 10 10" style="opacity:0.5;margin-left:2px">' +
      '<path d="M2 4L5 7L8 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>' +
      '</svg>';

    badge.addEventListener('mouseenter', function () {
      badge.style.transform = 'translateY(-2px) scale(1.02)';
      badge.style.boxShadow = '0 8px 25px rgba(0,245,255,0.15)';
      badge.style.borderColor = 'rgba(0,245,255,0.5)';
    });
    badge.addEventListener('mouseleave', function () {
      badge.style.transform = 'translateY(0) scale(1)';
      badge.style.boxShadow = '0 4px 20px rgba(0,0,0,0.35)';
      badge.style.borderColor = 'rgba(0,245,255,0.25)';
    });

    function toggle() {
      var current = localStorage.getItem(OVERRIDE_KEY);
      if (showingJMD) {
        localStorage.setItem(OVERRIDE_KEY, 'USD');
      } else {
        localStorage.setItem(OVERRIDE_KEY, 'JMD');
      }
      location.reload();
    }

    badge.addEventListener('click', toggle);
    badge.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });

    badge.title = 'Click to switch to ' + (showingJMD ? 'USD' : 'JMD');
    document.body.appendChild(badge);

    // Animate in
    badge.style.opacity = '0';
    badge.style.transform = 'translateY(10px)';
    requestAnimationFrame(function () {
      badge.style.opacity = '1';
      badge.style.transform = 'translateY(0)';
    });
  }

  // ─── Convert Static Prices ─────────────────────────────────────────

  function convertStaticPrices(toUSD) {
    // Use data attributes for reliable switching
    var priceDivs = document.querySelectorAll('[data-jmd][data-usd]');
    priceDivs.forEach(function (div) {
      if (toUSD) {
        div.textContent = div.getAttribute('data-usd');
      } else {
        div.textContent = div.getAttribute('data-jmd');
      }
    });
  }

  // ─── Patch the Project Estimator ──────────────────────────────────

  function patchEstimator(jmdToUsdRate) {
    // Expose the currency mode globally so the estimator result can be converted
    window._icssCurrencyMode = 'USD';
    window._icssJmdToUsdRate = jmdToUsdRate;
  }

  // ─── Observe Estimator Results (converts dynamically generated prices)

  function observeEstimatorResults(jmdToUsdRate) {
    var resultContainer = document.getElementById('estimate-result');
    if (!resultContainer) return;

    var observer = new MutationObserver(function () {
      if (window._icssCurrencyMode !== 'USD') return;

      // Find all currency values rendered by the estimator
      var valueEls = resultContainer.querySelectorAll('.text-2xl.font-bold');
      valueEls.forEach(function (el) {
        var text = el.textContent.trim();
        // Match "$123,456 JMD" pattern
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
      var isJamaica = (country === 'JM');

      // Check manual override
      var override = localStorage.getItem(OVERRIDE_KEY);
      var showUSD;
      if (override === 'USD') {
        showUSD = true;
      } else if (override === 'JMD') {
        showUSD = false;
      } else {
        showUSD = !isJamaica;
      }

      // Create the toggle badge
      createCurrencyBadge(!showUSD); // badge shows what we're displaying

      if (showUSD) {
        getJmdToUsdRate().then(function (rate) {
          convertStaticPrices(true);
          patchEstimator(rate);
          observeEstimatorResults(rate);
        });
      }
    });
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
