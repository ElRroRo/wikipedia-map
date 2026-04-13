/* global getItems, addItem, fetchPageTitle, getSubPages, getNormalizedId, noInputDetected */
// ─── LLM Export: headless crawl → compact adjacency-list text file ───

(function () {
  'use strict';

  // ── Concurrency helper ──────────────────────────────────
  function asyncPool(limit, items, iteratorFn) {
    const results = [];
    let i = 0;
    let cancelled = false;

    function next() {
      if (cancelled) return Promise.resolve();
      const idx = i++;
      if (idx >= items.length) return Promise.resolve();
      const p = iteratorFn(items[idx], idx).then(r => { results[idx] = r; });
      return p.then(() => next());
    }

    return {
      run() {
        const workers = Array.from({ length: Math.min(limit, items.length) }, () => next());
        return Promise.all(workers).then(() => results);
      },
      cancel() { cancelled = true; }
    };
  }

  // ── State ────────────────────────────────────────────────
  let cancelRequested = false;
  let activePool = null;

  // ── DOM refs (created once) ──────────────────────────────
  let overlay, progressFill, statDepth, statNodes, statEdges, statQueue;
  let statusText, btnCancel, btnDone;

  function ensureUI() {
    if (document.getElementById('llm-overlay')) {
      overlay      = document.getElementById('llm-overlay');
      progressFill = overlay.querySelector('.llm-progress-fill');
      statDepth    = document.getElementById('llm-stat-depth');
      statNodes    = document.getElementById('llm-stat-nodes');
      statEdges    = document.getElementById('llm-stat-edges');
      statQueue    = document.getElementById('llm-stat-queue');
      statusText   = document.getElementById('llm-status');
      btnCancel    = document.getElementById('llm-btn-cancel');
      btnDone      = document.getElementById('llm-btn-done');
      return;
    }

    const html = `
      <div id="llm-card">
        <h2><span class="llm-icon">🤖</span> LLM Export</h2>
        <div class="llm-subtitle">Crawling Wikipedia — no visualization</div>
        <div class="llm-progress-track"><div class="llm-progress-fill indeterminate"></div></div>
        <div class="llm-stats">
          <div class="llm-stat"><span class="llm-stat-label">Depth</span><span class="llm-stat-value highlight" id="llm-stat-depth">0</span></div>
          <div class="llm-stat"><span class="llm-stat-label">Nodes</span><span class="llm-stat-value" id="llm-stat-nodes">0</span></div>
          <div class="llm-stat"><span class="llm-stat-label">Edges</span><span class="llm-stat-value" id="llm-stat-edges">0</span></div>
          <div class="llm-stat"><span class="llm-stat-label">Queue</span><span class="llm-stat-value" id="llm-stat-queue">0</span></div>
        </div>
        <div class="llm-status" id="llm-status">Resolving page titles…</div>
        <div class="llm-buttons">
          <button class="llm-btn llm-btn-cancel" id="llm-btn-cancel">Cancel</button>
          <button class="llm-btn llm-btn-done"   id="llm-btn-done">Close</button>
        </div>
      </div>`;

    overlay = document.createElement('div');
    overlay.id = 'llm-overlay';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    progressFill = overlay.querySelector('.llm-progress-fill');
    statDepth    = document.getElementById('llm-stat-depth');
    statNodes    = document.getElementById('llm-stat-nodes');
    statEdges    = document.getElementById('llm-stat-edges');
    statQueue    = document.getElementById('llm-stat-queue');
    statusText   = document.getElementById('llm-status');
    btnCancel    = document.getElementById('llm-btn-cancel');
    btnDone      = document.getElementById('llm-btn-done');

    btnCancel.addEventListener('click', () => {
      cancelRequested = true;
      if (activePool) activePool.cancel();
      hideModal();
    });

    btnDone.addEventListener('click', hideModal);
  }

  function showModal() {
    ensureUI();
    cancelRequested = false;
    progressFill.classList.add('indeterminate');
    progressFill.style.width = '0%';
    statDepth.textContent = '0';
    statNodes.textContent = '0';
    statEdges.textContent = '0';
    statQueue.textContent = '0';
    statusText.textContent = 'Resolving page titles…';
    btnCancel.style.display = '';
    btnDone.style.display = 'none';
    overlay.classList.add('active');
  }

  function hideModal() {
    overlay.classList.remove('active');
  }

  function updateStats(depth, nodeCount, edgeCount, queueSize, status) {
    statDepth.textContent  = depth;
    statNodes.textContent  = nodeCount;
    statEdges.textContent  = edgeCount;
    statQueue.textContent  = queueSize;
    if (status) statusText.textContent = status;
  }

  function setProgress(pct) {
    progressFill.classList.remove('indeterminate');
    progressFill.style.width = Math.min(100, Math.round(pct)) + '%';
  }

  function showDone(msg) {
    statusText.textContent = msg;
    setProgress(100);
    btnCancel.style.display = 'none';
    btnDone.style.display = '';
  }

  // ── BFS Crawl ────────────────────────────────────────────
  async function bfsCrawl(rootTopics, maxDepth) {
    // nodeMap: id → { title, depth, parentId, rootTopic }
    const nodeMap = new Map();
    // edgeSet: "from|to"
    const edgeList = [];
    const edgeSet = new Set();
    // adjacency: parentId → [childTitle, ...]  (ordered)
    const adjacency = new Map();

    // Seed root nodes
    const queue = []; // { id, title, depth, rootTopic }
    rootTopics.forEach(title => {
      const id = getNormalizedId(title);
      nodeMap.set(id, { title, depth: 0, parentId: id, rootTopic: title });
      if (maxDepth > 0) {
        queue.push({ id, title, depth: 0, rootTopic: title });
      }
    });

    let currentDepth = 0;

    while (queue.length > 0 && !cancelRequested) {
      const batch = [];
      while (queue.length > 0 && queue[0].depth === currentDepth) {
        batch.push(queue.shift());
      }

      if (batch.length === 0) {
        currentDepth++;
        continue;
      }

      const childDepth = currentDepth + 1;
      const totalInBatch = batch.length;
      let processed = 0;

      updateStats(currentDepth, nodeMap.size, edgeList.length, batch.length + queue.length,
        `Depth ${currentDepth}: expanding ${batch.length} node${batch.length > 1 ? 's' : ''}…`);

      const pool = asyncPool(5, batch, async (item) => {
        if (cancelRequested) return;

        let result;
        try {
          result = await getSubPages(item.title);
        } catch (err) {
          console.warn(`[LLM Export] Failed to fetch "${item.title}":`, err.message);
          await new Promise(r => setTimeout(r, 1500));
          try {
            result = await getSubPages(item.title);
          } catch (err2) {
            console.warn(`[LLM Export] Retry failed for "${item.title}":`, err2.message);
            return;
          }
        }

        if (cancelRequested) return;

        const { redirectedTo, links } = result;

        // Handle redirect
        const newId = getNormalizedId(redirectedTo);
        if (newId !== item.id) {
          const existing = nodeMap.get(item.id);
          if (existing && !nodeMap.has(newId)) {
            nodeMap.delete(item.id);
            nodeMap.set(newId, { ...existing, title: redirectedTo });
          }
          edgeList.forEach(e => {
            if (e.from === item.id) e.from = newId;
            if (e.to === item.id) e.to = newId;
          });
          // Migrate adjacency key
          if (adjacency.has(item.id)) {
            adjacency.set(newId, adjacency.get(item.id));
            adjacency.delete(item.id);
          }
          item.id = newId;
          item.title = redirectedTo;
        }

        // Build adjacency list for this parent
        const children = [];

        for (const linkTitle of links) {
          const childId = getNormalizedId(linkTitle);

          const edgeKey = item.id + '|' + childId;
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            edgeList.push({ from: item.id, to: childId });
          }

          if (!nodeMap.has(childId)) {
            nodeMap.set(childId, {
              title: linkTitle,
              depth: childDepth,
              parentId: item.id,
              rootTopic: item.rootTopic,
            });
            if (childDepth < maxDepth) {
              queue.push({ id: childId, title: linkTitle, depth: childDepth, rootTopic: item.rootTopic });
            }
          }

          children.push(nodeMap.get(childId).title);
        }

        // Store adjacency
        adjacency.set(item.id, children);

        processed++;
        const pct = (processed / totalInBatch) * 100;
        setProgress(pct);
        updateStats(currentDepth, nodeMap.size, edgeList.length, queue.length,
          `Depth ${currentDepth}: ${processed}/${totalInBatch} — fetched "${item.title}"`);
      });

      activePool = pool;
      await pool.run();
      activePool = null;

      currentDepth++;
    }

    return { nodeMap, edgeList, adjacency, rootTopics };
  }

  // ── Bridge detection ─────────────────────────────────────
  function detectBridgeNodes(nodeMap, edgeList, rootTopics) {
    if (rootTopics.length < 2) return [];

    const incomingRoots = new Map();

    edgeList.forEach(({ from, to }) => {
      const fromNode = nodeMap.get(from);
      if (!fromNode) return;
      if (!incomingRoots.has(to)) incomingRoots.set(to, new Set());
      incomingRoots.get(to).add(fromNode.rootTopic);

      const toNode = nodeMap.get(to);
      if (toNode) {
        incomingRoots.get(to).add(toNode.rootTopic);
      }
    });

    const bridges = [];
    incomingRoots.forEach((roots, id) => {
      if (roots.size > 1) {
        const node = nodeMap.get(id);
        bridges.push({
          id,
          title: node ? node.title : id,
          connectingTopics: [...roots],
        });
      }
    });

    return bridges;
  }

  // ── Compact adjacency-list serialization ─────────────────
  // Optimized for LLM token efficiency and comprehension.
  // Format:
  //   HEADER (metadata + format legend for the receiving LLM)
  //   ROOTS (one per line with descendant count)
  //   GRAPH ([depth] adjacency list, sorted by depth, * = bridge node)
  function serialize(nodeMap, edgeList, adjacency, rootTopics, bridges, maxDepth) {
    const now = new Date().toISOString().slice(0, 10);
    const totalNodes = nodeMap.size;
    const totalEdges = edgeList.length;
    let actualMaxDepth = 0;
    nodeMap.forEach(d => { if (d.depth > actualMaxDepth) actualMaxDepth = d.depth; });

    // Count descendants per root
    const rootCounts = {};
    rootTopics.forEach(t => { rootCounts[t] = 0; });
    nodeMap.forEach(data => {
      if (data.depth > 0 && rootCounts[data.rootTopic] !== undefined) {
        rootCounts[data.rootTopic]++;
      }
    });

    // Build bridge ID set for inline marking
    const bridgeIds = new Set(bridges.map(b => b.id));

    const out = [];

    // ── HEADER ──
    out.push('WIKIPEDIA_MAP');
    out.push('This file is a directed graph of Wikipedia article links.');
    out.push('Each line in GRAPH is: [depth] Title -> linked articles from that page.');
    out.push('Nodes marked with * are bridge nodes: articles reachable from multiple root topics.');
    out.push('Lines are sorted by depth (BFS order). depth 0 = root search term.');
    out.push(`date:${now}`);
    out.push(`depth:${maxDepth}`);
    out.push(`nodes:${totalNodes}`);
    out.push(`edges:${totalEdges}`);
    out.push(`bridges:${bridges.length}`);
    out.push('');

    // ── ROOTS ──
    out.push('ROOTS (search terms that seeded this graph, with descendant count)');
    rootTopics.forEach(t => {
      out.push(`${t} (${rootCounts[t]} descendants)`);
    });
    out.push('');

    // ── GRAPH (adjacency list, sorted by depth) ──
    // Collect all adjacency entries with their depth
    const graphLines = [];
    adjacency.forEach((children, parentId) => {
      const parentNode = nodeMap.get(parentId);
      if (!parentNode || children.length === 0) return;
      const isBridge = bridgeIds.has(parentId);
      const prefix = isBridge ? `[${parentNode.depth}] *` : `[${parentNode.depth}]`;
      graphLines.push({
        depth: parentNode.depth,
        line: `${prefix} ${parentNode.title} -> ${children.join(', ')}`,
      });
    });

    // Sort by depth ascending for natural BFS reading order
    graphLines.sort((a, b) => a.depth - b.depth);

    out.push('GRAPH');
    graphLines.forEach(g => out.push(g.line));
    out.push('');

    return out.join('\n');
  }

  // ── File download trigger ────────────────────────────────
  function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Main entry point ─────────────────────────────────────
  async function goLLMExport() {
    const cf = document.getElementById('input');
    if (!cf) return;

    const inputEl = cf.querySelector('input');
    if (!inputEl) return;

    const rawText = inputEl.value.trim();
    if (rawText.length > 0) {
      addItem(cf, rawText);
      inputEl.value = '';
    }

    const inputs = getItems(cf);
    if (inputs.length === 0) {
      noInputDetected();
      return;
    }

    const depthInput = document.getElementById('depth-input');
    const maxDepth = depthInput ? parseInt(depthInput.value, 10) : 1;

    showModal();

    try {
      const pageTitles = await Promise.all(inputs.map(fetchPageTitle));
      if (cancelRequested) return;

      updateStats(0, pageTitles.length, 0, 0, 'Starting BFS crawl…');

      const { nodeMap, edgeList, adjacency, rootTopics } = await bfsCrawl(pageTitles, maxDepth);
      if (cancelRequested) return;

      const bridges = detectBridgeNodes(nodeMap, edgeList, rootTopics);

      const output = serialize(nodeMap, edgeList, adjacency, rootTopics, bridges, maxDepth);

      // Store for AI agent analysis
      window._lastLLMGraphData = output;

      const slug = rootTopics
        .slice(0, 3)
        .map(t => t.replace(/[^a-z0-9]/gi, '_').substring(0, 30))
        .join('_');
      const filename = `wikimap_${slug}_d${maxDepth}.txt`;

      downloadFile(output, filename);

      showDone(`✓ Done — ${nodeMap.size} nodes, ${edgeList.length} edges exported.`);
    } catch (err) {
      console.error('[LLM Export] Error:', err);
      showDone(`✗ Error: ${err.message}`);
    }
  }

  window.goLLMExport = goLLMExport;
})();
