/* global nodes, network, unwrap */

/**
 * Search the current map for a node by title and zoom to it.
 */
function mapSearch(query) {
  if (!query || query.trim().length === 0) return;
  
  const normalizedQuery = query.toLowerCase().trim();
  const allNodes = nodes.get();
  
  // Find nodes that contain the query string
  const matches = allNodes.filter(n => 
    unwrap(n.label).toLowerCase().includes(normalizedQuery)
  );
  
  if (matches.length > 0) {
    // Zoom to the first match
    network.focus(matches[0].id, {
      scale: 1.2,
      animation: {
        duration: 1000,
        easingFunction: 'easeInOutQuad'
      }
    });
    // Flash the node
    network.selectNodes([matches[0].id]);
    setTimeout(() => network.unselectAll(), 2000);
  } else {
    alert('Node not found in current map!');
  }
}

/**
 * Update the datalist for the local search bar with all current node labels.
 */
function updateSearchDatalist() {
  const datalist = document.getElementById('map-nodes-list');
  if (!datalist) return;
  
  const allNodes = nodes.get();
  const labels = [...new Set(allNodes.map(n => unwrap(n.label)))].sort();
  
  // Clear and rebuild
  datalist.innerHTML = '';
  labels.forEach(label => {
    const option = document.createElement('option');
    option.value = label;
    datalist.appendChild(option);
  });
}
