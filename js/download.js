/* global nodes, edges, network, options */
// Download the current map as a self-contained, interactive HTML file.

function downloadMap() {
  // Bail if there's nothing to export
  if (!nodes || nodes.length === 0) {
    alert('Nothing to download — build a map first!');
    return;
  }

  // Snapshot all nodes with their current canvas positions
  const positions = network.getPositions();
  const allNodes = nodes.get().map(n => {
    const pos = positions[n.id] || { x: 0, y: 0 };
    return {
      id: n.id,
      label: n.label,
      value: n.value,
      level: n.level,
      color: n.color,
      parent: n.parent,
      shape: n.shape || 'dot',
      borderWidth: n.borderWidth || undefined,
      shadow: n.shadow || undefined,
      isBridge: n.isBridge || undefined,
      rootId: n.rootId,
      rootColor: n.rootColor,
      x: pos.x,
      y: pos.y,
    };
  });

  const allEdges = edges.get().map(e => ({
    from: e.from,
    to: e.to,
    color: e.color,
    level: e.level,
    width: e.width || undefined,
    selectionWidth: 2,
    hoverWidth: 0,
  }));

  const startpages = window.startpages || [];

  // Build a title from the start pages
  const mapTitle = startpages.length
    ? 'Wikipedia Map — ' + startpages.map(sp => {
        const nd = nodes.get(sp);
        return nd ? nd.label.replace(/\n/g, ' ') : sp;
      }).join(', ')
    : 'Wikipedia Map';

  const dataPayload = JSON.stringify({ nodes: allNodes, edges: allEdges, startpages });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${mapTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/vis/4.16.1/vis.css">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #0f172a; color: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  #container { width: 100vw; height: 100vh; }
  #title-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 10;
    background: rgba(15,23,42,0.85); backdrop-filter: blur(20px);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    padding: 10px 20px; font-size: 15px; color: rgba(255,255,255,0.7);
    display: flex; align-items: center; gap: 12px; }
  #title-bar h1 { font-size: 16px; font-weight: 600; color: #f8fafc; margin: 0; }
  #title-bar .badge { font-size: 12px; background: rgba(56,189,248,0.15); color: #38bdf8;
    padding: 3px 10px; border-radius: 20px; border: 1px solid rgba(56,189,248,0.3); }
  #search-box { position: fixed; bottom: 20px; left: 20px; z-index: 10;
    background: rgba(15,23,42,0.85); backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
    padding: 5px; display: flex; align-items: center; gap: 5px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
  #search-box .search-icon { margin-left: 5px; opacity: 0.6; font-size: 16px; }
  #search-box input { background: transparent; border: none; color: #f8fafc; outline: none;
    padding: 5px; width: 150px; font-size: 14px; }
  #search-box input::placeholder { color: rgba(255,255,255,0.35); }
  #search-box button { background: rgba(255,255,255,0.1); border: none; color: #f8fafc;
    border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 13px;
    font-weight: bold; transition: 0.3s; }
  #search-box button:hover { background: rgba(255,255,255,0.2); }
  #stats { position: fixed; bottom: 12px; right: 12px; z-index: 10;
    background: rgba(15,23,42,0.85); backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
    padding: 8px 14px; font-size: 12px; color: rgba(255,255,255,0.5); }
  #node-menu { display: none; position: absolute; z-index: 1000;
    background: rgba(15,23,42,0.92); backdrop-filter: saturate(180%) blur(20px);
    border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);
    padding: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); min-width: 160px; }
  #node-menu-title { color: #f8fafc; margin-bottom: 10px; font-weight: bold;
    text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1);
    padding-bottom: 5px; font-size: 14px; }
  #node-menu-open { display: block; width: 100%;
    background: rgba(56,189,248,0.15); color: #38bdf8;
    border: 1px solid rgba(56,189,248,0.4); border-radius: 4px;
    padding: 6px; cursor: pointer; transition: 0.2s; font-size: 13px; }
  #node-menu-open:hover { background: rgba(56,189,248,0.3); }
</style>
</head>
<body>
<div id="title-bar">
  <h1>${mapTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h1>
  <span class="badge">Exported snapshot</span>
</div>
<div id="search-box">
  <span class="search-icon">&#128269;</span>
  <input type="text" id="search-input" list="nodes-list" placeholder="Search map...">
  <datalist id="nodes-list"></datalist>
  <button id="search-go">Find</button>
</div>
<div id="node-menu">
  <div id="node-menu-title">Node Name</div>
  <button id="node-menu-open">Open Wikipedia</button>
</div>
<div id="container"></div>
<div id="stats"></div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/vis/4.16.1/vis-network.min.js"><\/script>
<script>
(function() {
  var payload = ${dataPayload};

  var nodesDS = new vis.DataSet(payload.nodes);
  var edgesDS = new vis.DataSet(payload.edges);

  var container = document.getElementById('container');
  var options = ${JSON.stringify({
    nodes: options.nodes,
    edges: { ...options.edges, color: { inherit: 'from' }, smooth: false },
    layout: options.layout,
    physics: options.physics,
    interaction: { hover: true, hoverConnectedEdges: false, selectConnectedEdges: true },
  })};

  // Start with physics on so it settles, then auto-disable after stabilization
  options.physics.stabilization = { iterations: 200 };

  var network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, options);

  network.once('stabilized', function() {
    network.setOptions({ physics: { enabled: false } });
  });

  // Stats
  document.getElementById('stats').textContent =
    payload.nodes.length + ' nodes \\u00b7 ' + payload.edges.length + ' edges';

  // --- Search functionality ---
  var searchInput = document.getElementById('search-input');
  var searchGo = document.getElementById('search-go');
  var datalist = document.getElementById('nodes-list');

  // Populate datalist with all node labels
  var allLabels = [];
  payload.nodes.forEach(function(n) {
    var label = n.label.replace(/\\n/g, ' ');
    if (allLabels.indexOf(label) === -1) allLabels.push(label);
  });
  allLabels.sort();
  allLabels.forEach(function(label) {
    var opt = document.createElement('option');
    opt.value = label;
    datalist.appendChild(opt);
  });

  function doSearch() {
    var query = searchInput.value.trim().toLowerCase();
    if (!query) return;
    var allNodes = nodesDS.get();
    var matches = allNodes.filter(function(n) {
      return n.label.replace(/\\n/g, ' ').toLowerCase().indexOf(query) !== -1;
    });
    if (matches.length > 0) {
      network.focus(matches[0].id, {
        scale: 1.2,
        animation: { duration: 1000, easingFunction: 'easeInOutQuad' }
      });
      network.selectNodes([matches[0].id]);
      setTimeout(function() { network.unselectAll(); }, 2000);
    } else {
      alert('Node not found in current map!');
    }
  }

  searchGo.addEventListener('click', doSearch);
  searchInput.addEventListener('keyup', function(e) {
    if (e.keyCode === 13) doSearch();
  });

  // Hover traceback
  var startpages = payload.startpages || [];
  var tracenodes = [];
  var traceedges = [];
  var isReset = true;

  function hexToRGB(hex) {
    if (hex.startsWith('#')) hex = hex.slice(1);
    return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
  }
  function rgbToHex(rgb) {
    return '#' + rgb.map(function(x){ var h = Math.round(x).toString(16); return h.length===1?'0'+h:h; }).join('');
  }
  function darkenHex(hex, pct) {
    return rgbToHex(hexToRGB(hex).map(function(x){ return x - (Math.min(pct,100)/100)*x; }));
  }
  function getYellowColor(level) { return darkenHex('#f59e0b', 8*level); }

  function getEdgeConnecting(a, b) {
    var found = edgesDS.get({ filter: function(e){ return e.from===a && e.to===b; } });
    return found.length ? found[0].id : null;
  }

  function getTraceBackNodes(nodeId) {
    var path = []; var current = nodeId; var iter = 0;
    while (iter < 200) {
      path.push(current);
      if (startpages.indexOf(current) !== -1) break;
      var nd = nodesDS.get(current);
      if (!nd || !nd.parent || nd.parent === current) break;
      current = nd.parent;
      iter++;
    }
    return path;
  }
  function getTraceBackEdges(tbn) {
    var rev = tbn.slice().reverse(); var path = [];
    for (var i=0; i<rev.length-1; i++) {
      var eid = getEdgeConnecting(rev[i], rev[i+1]);
      if (eid) path.push(eid);
    }
    return path;
  }

  function resetHighlight() {
    if (!isReset) {
      var modn = tracenodes.map(function(id){
        var n = nodesDS.get(id);
        return { id: id, color: n._origColor || n.color };
      });
      nodesDS.update(modn);
      var mode = traceedges.map(function(id){
        return { id: id, width: 1 };
      });
      edgesDS.update(mode);
      tracenodes = []; traceedges = []; isReset = true;
    }
  }

  function traceBack(nodeId) {
    resetHighlight();
    tracenodes = getTraceBackNodes(nodeId);
    traceedges = getTraceBackEdges(tracenodes);
    var modn = tracenodes.map(function(id){
      var n = nodesDS.get(id);
      if (!n._origColor) nodesDS.update({ id: id, _origColor: n.color });
      return { id: id, color: getYellowColor(n.level || 0) };
    });
    nodesDS.update(modn);
    var mode = traceedges.map(function(id){ return { id: id, width: 5 }; });
    edgesDS.update(mode);
    isReset = false;
  }

  network.on('hoverNode', function(p){ traceBack(p.node); });
  network.on('blurNode', function(){ resetHighlight(); });

  // Node context menu
  var menu = document.getElementById('node-menu');
  var menuTitle = document.getElementById('node-menu-title');
  var menuOpen = document.getElementById('node-menu-open');
  var activeNodeId = null;

  network.on('click', function(p) {
    if (p.nodes.length) {
      var nodeId = p.nodes[0];
      var nd = nodesDS.get(nodeId);
      var label = nd.label.replace(/\\n/g, ' ');
      activeNodeId = nodeId;
      menuTitle.textContent = label;
      var pointer = p.pointer.DOM;
      menu.style.display = 'block';
      menu.style.left = (pointer.x + 15) + 'px';
      menu.style.top = (pointer.y + 15) + 'px';
      traceBack(nodeId);
    } else {
      menu.style.display = 'none';
      activeNodeId = null;
      resetHighlight();
    }
  });

  menuOpen.addEventListener('click', function() {
    if (activeNodeId) {
      var nd = nodesDS.get(activeNodeId);
      var label = nd.label.replace(/\\n/g, ' ');
      window.open('https://en.wikipedia.org/wiki/' + encodeURIComponent(label), '_blank');
    }
    menu.style.display = 'none';
  });
})();
<\/script>
</body>
</html>`;

  // Trigger download
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Build a filename from start pages
  const filename = startpages.length
    ? 'wikipedia-map_' + startpages.slice(0, 3).join('_').replace(/[^a-z0-9_]/gi, '') + '.html'
    : 'wikipedia-map.html';
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
