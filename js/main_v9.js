/* global vis, bindNetwork, getNormalizedId, wordwrap, getColor, noInputDetected, getItems, addItem, clearItems, unlockAll, fetchPageTitle, getRandomArticle, networkFromJson */ // eslint-disable-line max-len
// This script contains the code that creates the central network, as well as
// a function for resetting it to a brand new page.


let nodes;
let edges;
let network; // Global variables

window.startpages = [];
// Tracks whether the network needs to be reset. Used to prevent deleting nodes
// when multiple nodes need to be created, because AJAX requests are async.

const container = document.getElementById('container');
// Global options
const options = {
  nodes: {
    shape: 'dot',
    scaling: {
      min: 15,
      max: 60,
      label: { min: 14, max: 30, drawThreshold: 9, maxVisible: 20 },
    },
    font: { size: 14, face: getComputedStyle(document.body).fontFamily, color: '#f8fafc' },
  },
  edges: {
    color: { inherit: 'from' },
    smooth: false, // Disabling curves drastically improves render time
  },
  layout: {
    improvedLayout: false, // Disabling this stops the browser freezing during initial network calculation
  },
  physics: {
    solver: 'forceAtlas2Based',
    forceAtlas2Based: {
      gravitationalConstant: -50,
      centralGravity: 0.01,
      springConstant: 0.08,
      springLength: 100,
      damping: 0.6,
      avoidOverlap: 0
    },
    maxVelocity: 50,
    minVelocity: 0.1,
    stabilization: false // Spawns nodes without the long freezing stabilization phase
  },
  interaction: {
    hover: true,
    hoverConnectedEdges: false,
    selectConnectedEdges: true,
  },
};

nodes = new vis.DataSet();
edges = new vis.DataSet();
let data = { nodes, edges };
let initialized = false;


// Set up the network
function makeNetwork() {
  if (initialized) throw new Error('Network is already initialized');
  network = new vis.Network(container, data, options);
  bindNetwork();

  window.startpages = [];
  window.tracenodes = [];
  window.traceedges = [];
  nodes = new vis.DataSet();
  edges = new vis.DataSet();
  data = { nodes, edges };
  network.setData(data);

  initialized = true;
}

// Get the object to represent a "start node" for a given page name
const getStartNode = (pageName, index) => {
  const rootColor = getRootColor(index);
  const rootId = getNormalizedId(pageName);
  return {
    id: rootId,
    label: wordwrap(decodeURIComponent(pageName), 20),
    shape: 'star',
    value: 10, // Significantly larger for roots
    level: 0,
    color: {
      background: rootColor,
      border: '#ffffff',
      highlight: { background: rootColor, border: '#ffffff' },
      hover: { background: rootColor, border: '#ffffff' }
    },
    borderWidth: 6,
    shadow: { enabled: true, color: rootColor, size: 30, x: 0, y: 0 },
    x: 0,
    y: 0,
    parent: rootId,
    rootColor: rootColor,
    rootId: rootId
  };
};

// Reset everything to its initial state
function clearNetwork() {
  window.startpages = [];
  window.tracenodes = [];
  window.traceedges = [];
  nodes = new vis.DataSet();
  edges = new vis.DataSet();
  data = { nodes, edges };
  network.setData(data);

  const cf = document.getElementById('input');
  unlockAll(cf);
  if (typeof updateSearchDatalist === 'function') updateSearchDatalist();
}

// Add and remove "start nodes" to make the list of start nodes match the list passed
function setStartPages(starts) {
  const newStartPages = starts.map(getNormalizedId);
  if (!initialized) makeNetwork();
  const toRemove = window.startpages.filter(id => !newStartPages.includes(id));
  const toAdd = starts.filter((pageName, i) => !window.startpages.includes(newStartPages[i]));

  nodes.remove(toRemove);
  nodes.add(toAdd.map((pageName, i) => getStartNode(pageName, window.startpages.length + i)));
  window.startpages = newStartPages;

  toAdd.map(getNormalizedId).forEach(id => {
    const depthInput = document.getElementById('depth-input');
    const targetDepth = depthInput ? parseInt(depthInput.value, 10) : 3;
    if (targetDepth > 0) {
      expandNode(id);
    }
  });
  
  if (typeof updateSearchDatalist === 'function') updateSearchDatalist();
}


// Reset the network with the content from the input box.
function go() {
  console.log('Go function called');
  const cf = document.getElementById('input');
  if (!cf) {
    console.error('Could not find element with id "input"');
    return;
  }
  const inputEl = cf.querySelector('input');
  if (!inputEl) {
    console.error('Could not find input inside #input');
    // It might be because commafield.js hasn't transformed it yet or failed.
    // Let's check the innerHTML.
    console.log('#input innerHTML:', cf.innerHTML);
    return;
  }
  
  const rawText = inputEl.value.trim();
  console.log('Raw text input:', rawText);
  
  if (rawText.length > 0) {
    addItem(cf, rawText);
    inputEl.value = '';
  }
  
  const inputs = getItems(cf);
  console.log('Processed inputs for search:', inputs);
  
  if (inputs.length === 0) {
    console.warn('No inputs detected, triggering shake');
    noInputDetected();
    return;
  }

  // Visual loading feedback
  const submitButton = document.getElementById('submit');
  const orgText = submitButton.innerHTML;
  submitButton.innerHTML = 'Loading...';
  submitButton.style.opacity = '0.5';
  submitButton.style.pointerEvents = 'none';

  console.log('Starting fetch for inputs...');
  Promise.all(inputs.map(fetchPageTitle))
    .then((pageTitles) => {
      console.log('Page titles fetched successfully:', pageTitles);
      pageTitles.forEach((pageTitle, i) => {
        const item = cf.getElementsByClassName('item')[i];
        if (item) {
          item.dataset.nodeId = getNormalizedId(pageTitle);
        } else {
          console.warn(`No .item found at index ${i} for title ${pageTitle}`);
        }
      });
      setStartPages(pageTitles);
      document.getElementById('clear').style.display = '';
    })
    .catch((err) => {
      console.error('Failed to construct network:', err);
      alert('Error fetching from Wikipedia API! Check console for: ' + err.message);
    })
    .finally(() => {
      submitButton.innerHTML = orgText;
      submitButton.style.opacity = '1';
      submitButton.style.pointerEvents = 'auto';
    });
}


// Reset the network with one or more random pages.
function goRandom() {
  const cf = document.getElementsByClassName('commafield')[0];
  getRandomArticle().then((ra) => {
    addItem(cf, decodeURIComponent(ra));
    go();
  });
}

// Reset the network with content from a JSON string
function resetNetworkFromJson(j) {
  if (!initialized) makeNetwork();
  clearNetwork();
  const obj = networkFromJson(j);
  nodes = obj.nodes;
  edges = obj.edges;
  window.startpages = obj.startpages;
  // Fill the network
  network.setData({ nodes, edges });
  // Populate the top bar
  const cf = document.getElementById('input');
  clearItems(cf);
  window.startpages.forEach((sp) => {
    console.log(sp, nodes.get(sp));
    addItem(cf, nodes.get(sp).label.replace(/\s+/g, ' '));
    // TODO: set node IDs on commafield items
    // TODO: lock commafield items that have been expanded
  });
}
