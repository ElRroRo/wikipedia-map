/* global nodes, network */
/* global expandNode, traceBack, resetProperties, go, goRandom, clearNetwork, unwrap */

const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

function clickNodeEvent(params) {
  const menu = document.getElementById('node-menu');
  if (params.nodes.length) {
    const nodeId = params.nodes[0];
    const nodeData = nodes.get(nodeId);
    const pointer = params.pointer.DOM;
    menu.style.display = 'block';
    menu.style.left = (pointer.x + 15) + 'px';
    menu.style.top = (pointer.y + 15) + 'px';
    document.getElementById('node-menu-title').innerText = unwrap(nodeData.label);
    menu.dataset.nodeId = nodeId;
    if (isTouchDevice) traceBack(nodeId);
  } else {
    menu.style.display = 'none';
    resetProperties();
  }
}

function bindNetwork() {
  if (isTouchDevice) {
    network.on('hold', clickNodeEvent);
    network.on('click', clickNodeEvent);
  } else {
    network.on('click', clickNodeEvent);
    network.on('hoverNode', params => traceBack(params.node));
    network.on('blurNode', resetProperties);
  }
}

function bind() {
  console.log('bind() called');
  document.addEventListener('touchmove', e => e.preventDefault());
  
  const submitButton = document.getElementById('submit');
  submitButton.addEventListener('click', go);

  const randomButton = document.getElementById('random');
  randomButton.addEventListener('click', goRandom);

  const clearButton = document.getElementById('clear');
  clearButton.addEventListener('click', clearNetwork);

  const helpButton = document.getElementById('help');
  helpButton.addEventListener('click', () => {
    const info = document.getElementById('info');
    info.style.opacity = '1';
    info.style.pointerEvents = 'all';
  });

  const ghbutton = document.getElementById('github');
  ghbutton.addEventListener('click', () => window.open('https://github.com/controversial/wikipedia-map', '_blank'));

  const aboutButton = document.getElementById('about');
  aboutButton.addEventListener('click', () => window.open('https://github.com/controversial/wikipedia-map/blob/master/README.md#usage', '_blank'));

  const downloadButton = document.getElementById('download');
  downloadButton.addEventListener('click', downloadMap);

  const llmExportButton = document.getElementById('llm-export');
  if (llmExportButton) llmExportButton.addEventListener('click', goLLMExport);

  const menuOpen = document.getElementById('node-menu-open');
  const menuExpand = document.getElementById('node-menu-expand');
  const menu = document.getElementById('node-menu');
  
  menuOpen.addEventListener('click', () => {
    const nodeid = menu.dataset.nodeId;
    const page = encodeURIComponent(unwrap(nodes.get(nodeid).label));
    window.open('https://en.wikipedia.org/wiki/' + page, '_blank');
    menu.style.display = 'none';
  });

  menuExpand.addEventListener('click', () => {
    const nodeid = menu.dataset.nodeId;
    const additionalLevels = parseInt(document.getElementById('node-menu-depth').value, 10) || 1;
    const nodeData = nodes.get(nodeid);
    expandNode(nodeid, nodeData.level + additionalLevels);
    menu.style.display = 'none';
  });

  // --- NEW FEATURE BINDINGS ---
  const localSearchInput = document.getElementById('local-search-input');
  const localSearchGo = document.getElementById('local-search-go');
  const toggleConnections = document.getElementById('toggle-connections');
  const closeConnections = document.getElementById('close-connections');

  localSearchInput.addEventListener('keyup', (e) => {
    if (e.keyCode === 13) mapSearch(localSearchInput.value);
  });
  localSearchGo.addEventListener('click', () => {
    mapSearch(localSearchInput.value);
  });
}
