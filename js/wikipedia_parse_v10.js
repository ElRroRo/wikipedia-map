/* global getNormalizedId */
const base = 'https://en.wikipedia.org/w/api.php';

const domParser = new DOMParser();

let rateLimitShown = false;

function showRateLimitPopup() {
  const popup = document.createElement('div');
  popup.className = 'transparent-blur';
  popup.style.position = 'fixed';
  popup.style.top = '20px';
  popup.style.left = '50%';
  popup.style.transform = 'translateX(-50%)';
  popup.style.zIndex = '999999';
  popup.style.background = 'rgba(220, 38, 38, 0.2)';
  popup.style.border = '1px solid rgba(220, 38, 38, 0.5)';
  popup.style.color = '#fecaca';
  popup.style.padding = '15px 30px';
  popup.style.borderRadius = '8px';
  popup.style.boxShadow = '0 4px 15px rgba(0,0,0,0.5)';
  popup.style.textAlign = 'center';
  popup.style.transition = 'opacity 0.5s ease-in-out';
  popup.innerHTML = `
    <h3 style="margin: 0 0 5px 0; color: #f87171;">Rate Limit Reached 🐢</h3>
    <p style="margin: 0; font-size: 14px;">Wikipedia requires us to slow down. Please wait a moment.</p>
  `;
  document.body.appendChild(popup);
  
  setTimeout(() => {
    popup.style.opacity = '0';
    setTimeout(() => popup.remove(), 500);
  }, 4500);
}

/* Make a request to the Wikipedia API */
function queryApi(query) {
  const url = new URL(base);
  const params = { format: 'json', origin: '*', ...query };
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
  
  // Build headers — identify ourselves to get better rate limits
  const headers = {};
  if (typeof CONFIG !== 'undefined' && CONFIG.contactEmail) {
    headers['Api-User-Agent'] = `${CONFIG.appName || 'WikipediaMap'}/1.0 (${CONFIG.contactEmail})`;
  }

  return fetch(url, { headers }).then(response => {
    if (response.status === 429) {
      if (!rateLimitShown) {
        rateLimitShown = true;
        showRateLimitPopup();
        setTimeout(() => { rateLimitShown = false; }, 5000); 
      }
      throw new Error('Wikipedia API Rate Limit Exceeded (429)');
    }
    return response.json();
  }).then(data => {
    console.log('Data parsed correctly');
    return data;
  });
}

/**
 * Get the title of a page from a URL quickly, but inaccurately (no redirects)
 */
const getPageTitleQuickly = url => url.split('/').filter(el => el).pop().split('#')[0];

/**
 * Get the name of a Wikipedia page accurately by following redirects (slow)
 */
function fetchPageTitle(page) {
  return queryApi({ action: 'query', titles: page, redirects: 1 })
    .then(res => Object.values(res.query.pages)[0].title);
}

/**
 * Decide whether the name of a wikipedia page is an article, or belongs to another namespace.
 * See https://en.wikipedia.org/wiki/Wikipedia:Namespace
 */
// Pages outside of main namespace have colons in the middle, e.g. 'WP:UA'
// Remove any trailing colons and return true if the result still contains a colon
const isArticle = name => !(name.endsWith(':') ? name.slice(0, -1) : name).includes(':');


// --- MAIN FUNCTIONS ---

/**
 * Get all outgoing article links for a page using the lightweight JSON links API.
 * Uses action=query&prop=links instead of parsing full HTML — much faster and lighter.
 * Handles pagination (plcontinue) for articles with 500+ links.
 */
function getSubPages(pageName) {
  const allLinks = [];

  function fetchBatch(plcontinue) {
    const query = {
      action: 'query',
      titles: pageName,
      prop: 'links',
      pllimit: 'max',       // Up to 500 per request
      plnamespace: 0,        // Only article namespace
      redirects: 1,
    };
    if (plcontinue) query.plcontinue = plcontinue;

    return queryApi(query).then(res => {
      // Resolve redirects — get the final page title
      const pages = res.query.pages;
      const page = Object.values(pages)[0];
      const redirectedTo = res.query.redirects
        ? res.query.redirects[res.query.redirects.length - 1].to
        : pageName;

      // Collect link titles from this batch
      if (page.links) {
        page.links.forEach(link => allLinks.push(link.title));
      }

      // If there's more pages of results, keep fetching
      if (res.continue && res.continue.plcontinue) {
        return fetchBatch(res.continue.plcontinue).then(() => redirectedTo);
      }

      return redirectedTo;
    });
  }

  return fetchBatch().then(redirectedTo => {
    // Deduplicate after normalizing
    const ids = allLinks.map(getNormalizedId);
    const isUnique = ids.map((n, i) => ids.indexOf(n) === i);
    const uniqueLinks = allLinks.filter((n, i) => isUnique[i]);

    // Uniformly sample up to 100 links across the entire article
    const MAX_LINKS = 100;
    let links;
    if (uniqueLinks.length <= MAX_LINKS) {
      links = uniqueLinks;
    } else {
      const step = uniqueLinks.length / MAX_LINKS;
      links = Array.from({ length: MAX_LINKS }, (_, i) => uniqueLinks[Math.floor(i * step)]);
    }

    console.log(`[v10] getSubPages("${pageName}"): ${allLinks.length} raw → ${uniqueLinks.length} unique → ${links.length} sampled`);
    return { redirectedTo, links };
  });
}

/**
 * Get the name of a random Wikipedia article
 */
function getRandomArticle() {
  return queryApi({
    action: 'query',
    list: 'random',
    rnlimit: 1,
    rnnamespace: 0, // Limits results to articles
  }).then(res => res.query.random[0].title);
}

/**
 * Get completion suggestions for a query
 */
function getSuggestions(search) {
  return queryApi({
    action: 'opensearch',
    search,
    limit: 10,
    namespace: 0, // Limits results to articles
  })
    .then(res => res[1]);
}
