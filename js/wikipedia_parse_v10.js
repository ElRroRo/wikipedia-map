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
  
  return fetch(url).then(response => {
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
 * Get a DOM object for the HTML of a Wikipedia page.
 * Also returns information about any redirects that were followed.
 */
function getPageHtml(pageName) {
  console.log('[v10] getPageHtml called for:', pageName, '(NO section:0 — full article)');
  return queryApi({ action: 'parse', page: pageName, prop: 'text', redirects: 1 })
    .then(res => {
      const html = res.parse.text['*'];
      console.log('[v10] Received HTML length:', html.length, 'chars for', pageName);
      return {
        document: domParser.parseFromString(html, 'text/html'),
        redirectedTo: res.parse.redirects[0] ? res.parse.redirects[0].to : pageName,
      };
    });
}
/**
 * Get the name of each Wikipedia article linked.
 * @param {HtmlElement} element - An HTML element as returned by `getPageHtml`
 */
function getWikiLinks(element) {
  if (!element) {
    console.warn('[v10] getWikiLinks: element is null!');
    return [];
  }
  const allAnchors = Array.from(element.querySelectorAll('a'));
  console.log('[v10] Total <a> tags found in element:', allAnchors.length);
  const links = allAnchors
    .map(link => link.getAttribute('href'))
    .filter(href => href && href.startsWith('/wiki/'))
    .map(getPageTitleQuickly)
    .filter(isArticle)
    .map(title => title.replace(/_/g, ' '));
  console.log('[v10] After filtering wiki links:', links.length);
  // Remove duplicates after normalizing
  const ids = links.map(getNormalizedId);
  const isUnique = ids.map((n, i) => ids.indexOf(n) === i);
  const uniqueLinks = links.filter((n, i) => isUnique[i]);
  console.log('[v10] Unique links:', uniqueLinks.length);
  
  // Uniformly sample up to 100 links across the entire article
  const MAX_LINKS = 100;
  if (uniqueLinks.length <= MAX_LINKS) {
    console.log('[v10] Returning all', uniqueLinks.length, 'links (under cap)');
    return uniqueLinks;
  }
  const step = uniqueLinks.length / MAX_LINKS;
  const sampled = Array.from({ length: MAX_LINKS }, (_, i) => uniqueLinks[Math.floor(i * step)]);
  console.log('[v10] Sampled', sampled.length, 'links from', uniqueLinks.length, 'total');
  return sampled;
}

/**
 * Given a page title, get the first paragraph links, as well as the name of the page it redirected
 * to.
 */
function getSubPages(pageName) {
  return getPageHtml(pageName).then(({ document: doc, redirectedTo }) => ({
    redirectedTo,
    links: getWikiLinks(doc.querySelector('.mw-parser-output')),
  }));
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
