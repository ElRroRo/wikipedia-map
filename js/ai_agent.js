/* global getItems, addItem, fetchPageTitle, getSubPages, getNormalizedId, noInputDetected */
// ─── AI Agent: Analyze LLM exports with Ollama + Tavily ───

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────
  let panelOpen = false;
  let isStreaming = false;
  let conversationHistory = []; // { role, content }
  let currentGraphData = null;  // The raw graph text being analyzed
  let abortController = null;

  // ── DOM refs ─────────────────────────────────────────────
  let overlay, panel, messagesContainer, inputField, sendBtn, statusDot, statusLabel;

  // ── Simple Markdown → HTML renderer ──────────────────────
  function renderMarkdown(text) {
    let html = text
      // Code blocks (```...```)
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // H3
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      // H2
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      // Blockquote
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      // Unordered list items
      .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
      // Numbered list items
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      // Wrap consecutive <li> in <ul>
      .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
      // Paragraphs
      .replace(/\n\n/g, '</p><p>')
      // Line breaks
      .replace(/\n/g, '<br>');

    // Wrap in paragraph if not already starting with a block element
    if (!html.startsWith('<h') && !html.startsWith('<pre') && !html.startsWith('<ul') && !html.startsWith('<blockquote')) {
      html = '<p>' + html + '</p>';
    }

    return html;
  }

  // ── Build the UI ─────────────────────────────────────────
  function ensureUI() {
    if (document.getElementById('ai-overlay')) {
      overlay = document.getElementById('ai-overlay');
      panel = document.getElementById('ai-panel');
      messagesContainer = overlay.querySelector('.ai-messages');
      inputField = overlay.querySelector('.ai-input-field');
      sendBtn = overlay.querySelector('.ai-send-btn');
      statusDot = overlay.querySelector('.ai-status-dot');
      statusLabel = overlay.querySelector('.ai-status-label');
      return;
    }

    overlay = document.createElement('div');
    overlay.id = 'ai-overlay';
    overlay.innerHTML = `
      <div style="flex:1" id="ai-overlay-backdrop"></div>
      <div id="ai-panel">
        <div class="ai-header">
          <div class="ai-header-title">
            <div class="ai-logo">🧠</div>
            <span class="ai-title-text">Graph Analyst</span>
          </div>
          <button class="ai-close-btn" id="ai-close-btn">✕</button>
        </div>
        <div class="ai-status-bar">
          <span class="ai-status-dot" id="ai-status-dot"></span>
          <span class="ai-status-label" id="ai-status-label">Checking connection…</span>
        </div>
        <div class="ai-messages" id="ai-messages"></div>
        <div class="ai-input-area">
          <div class="ai-input-wrap">
            <textarea class="ai-input-field" id="ai-input-field" placeholder="Ask a follow-up question…" rows="1"></textarea>
          </div>
          <button class="ai-send-btn" id="ai-send-btn" disabled>➤</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    panel = document.getElementById('ai-panel');
    messagesContainer = document.getElementById('ai-messages');
    inputField = document.getElementById('ai-input-field');
    sendBtn = document.getElementById('ai-send-btn');
    statusDot = document.getElementById('ai-status-dot');
    statusLabel = document.getElementById('ai-status-label');

    // Close handlers
    document.getElementById('ai-close-btn').addEventListener('click', closePanel);
    document.getElementById('ai-overlay-backdrop').addEventListener('click', closePanel);

    // Send on click
    sendBtn.addEventListener('click', sendFollowUp);

    // Send on Enter (Shift+Enter = newline)
    inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendFollowUp();
      }
    });

    // Auto-resize textarea
    inputField.addEventListener('input', () => {
      inputField.style.height = 'auto';
      inputField.style.height = Math.min(inputField.scrollHeight, 120) + 'px';
    });

    checkHealth();
  }

  // ── Health check ────────────────────────────────────────
  async function checkHealth() {
    statusDot.className = 'ai-status-dot connecting';
    statusLabel.textContent = 'Connecting to Ollama…';

    try {
      const res = await fetch('/api/health');
      const data = await res.json();

      if (data.ollama) {
        statusDot.className = 'ai-status-dot connected';
        const tavilyStatus = data.tavily ? ' · Tavily ✓' : ' · Tavily ✗';
        statusLabel.textContent = `${data.model}${tavilyStatus}`;
        sendBtn.disabled = false;
      } else {
        statusDot.className = 'ai-status-dot';
        statusLabel.textContent = 'Ollama not reachable — is it running?';
      }
    } catch (err) {
      statusDot.className = 'ai-status-dot';
      statusLabel.textContent = 'Server not reachable — start with npm start';
    }
  }

  // ── Panel open/close ────────────────────────────────────
  function openPanel() {
    ensureUI();
    overlay.classList.add('active');
    panelOpen = true;
  }

  function closePanel() {
    overlay.classList.remove('active');
    panelOpen = false;
    if (abortController) abortController.abort();
  }

  // ── Message helpers ─────────────────────────────────────
  function addMessage(role, content, isHtml) {
    const msg = document.createElement('div');
    msg.className = `ai-msg ${role}`;
    if (isHtml) {
      msg.innerHTML = content;
    } else if (role === 'assistant') {
      msg.innerHTML = renderMarkdown(content);
    } else {
      msg.textContent = content;
    }
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return msg;
  }

  function addTypingIndicator() {
    const msg = document.createElement('div');
    msg.className = 'ai-msg assistant';
    msg.id = 'ai-typing-msg';
    msg.innerHTML = '<div class="ai-typing"><div class="ai-typing-dot"></div><div class="ai-typing-dot"></div><div class="ai-typing-dot"></div></div>';
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return msg;
  }

  function removeTypingIndicator() {
    const el = document.getElementById('ai-typing-msg');
    if (el) el.remove();
  }

  // ── Tavily web research ─────────────────────────────────
  async function doTavilyResearch(rootTopics) {
    const researchMsg = addMessage('system',
      `<span class="ai-research-badge"><span class="spinner"></span> Researching topics via Tavily…</span>`, true);

    const results = [];

    for (const topic of rootTopics.slice(0, 5)) {
      try {
        const res = await fetch('/api/tavily-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: `${topic} Wikipedia overview connections significance`, maxResults: 3 }),
        });

        if (res.ok) {
          const data = await res.json();
          let summary = `**${topic}**`;
          if (data.answer) summary += `: ${data.answer}`;
          if (data.results && data.results.length > 0) {
            const snippets = data.results.map(r => `- ${r.title}: ${r.content?.substring(0, 200) || ''}`).join('\n');
            summary += '\n' + snippets;
          }
          results.push(summary);
        }
      } catch (err) {
        console.warn(`[AI Agent] Tavily search failed for "${topic}":`, err.message);
      }
    }

    // Update the research message
    if (results.length > 0) {
      researchMsg.innerHTML = `<span class="ai-research-badge">🔍 Web research completed — ${results.length} topic(s)</span>`;
    } else {
      researchMsg.innerHTML = `<span class="ai-research-badge">⚠️ Web research skipped (no Tavily key or error)</span>`;
    }

    return results.length > 0 ? results.join('\n\n') : null;
  }

  // ── Stream from SSE endpoint ────────────────────────────
  async function streamResponse(url, body, msgElement) {
    isStreaming = true;
    sendBtn.disabled = true;
    abortController = new AbortController();

    let fullContent = '';
    let currentSystemMsg = null;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);

          if (payload === '[DONE]') break;

          try {
            const parsed = JSON.parse(payload);
            
            // Handle phase updates
            if (parsed.phase) {
              if (parsed.phase === 'researching') {
                addMessage('system', `<span class="ai-research-badge"><span class="spinner"></span> <strong>Discovery:</strong> ${parsed.message}</span>`, true);
              } else if (parsed.phase === 'scanning' || parsed.phase === 'synthesizing') {
                addMessage('system', `✨ ${parsed.message}`);
              } else if (parsed.phase === 'done') {
                // done signal from server
              }
              continue;
            }

            if (parsed.error) {
              msgElement.className = 'ai-msg error';
              msgElement.textContent = parsed.error;
              return fullContent;
            }
            if (parsed.token) {
              removeTypingIndicator(); // Ensure indicator is gone once tokens start
              fullContent += parsed.token;
              msgElement.innerHTML = renderMarkdown(fullContent);
              messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
          } catch (_) { /* skip */ }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        msgElement.className = 'ai-msg error';
        msgElement.textContent = `Stream error: ${err.message}`;
      }
    } finally {
      isStreaming = false;
      sendBtn.disabled = false;
      abortController = null;
    }

    return fullContent;
  }

  // ── Main analysis flow ──────────────────────────────────
  async function analyzeGraph(graphData) {
    currentGraphData = graphData;
    conversationHistory = [];

    openPanel();

    // Clear old messages
    messagesContainer.innerHTML = '';

    addMessage('system', '🕵️ Initializing Curiosity Agent Discovery Flow...');

    // Start streaming analysis (includes phases now)
    addTypingIndicator();

    // Create assistant message element (will be filled later during synthesis)
    const assistantMsg = document.createElement('div');
    assistantMsg.className = 'ai-msg assistant';
    // We don't append it yet, let the streamResponse manage its first token
    let assistantMsgAppended = false;

    const fullContent = await streamResponse('/api/analyze', {
      graphData,
    }, {
      get innerHTML() { return assistantMsg.innerHTML; },
      set innerHTML(val) { 
        if (!assistantMsgAppended) {
          messagesContainer.appendChild(assistantMsg);
          assistantMsgAppended = true;
        }
        assistantMsg.innerHTML = val; 
      },
      set className(val) { assistantMsg.className = val; },
      set textContent(val) { assistantMsg.textContent = val; }
    });

    if (fullContent) {
      conversationHistory.push({ role: 'user', content: `Analyze this Wikipedia graph focus on abnormalities:\n\n${graphData}` });
      conversationHistory.push({ role: 'assistant', content: fullContent });
    }
  }

  // ── Follow-up questions ─────────────────────────────────
  async function sendFollowUp() {
    if (isStreaming) return;
    const text = inputField.value.trim();
    if (!text) return;

    inputField.value = '';
    inputField.style.height = 'auto';

    addMessage('user', text);
    conversationHistory.push({ role: 'user', content: text });

    const typingMsg = addTypingIndicator();
    removeTypingIndicator();
    const assistantMsg = addMessage('assistant', '');

    const fullContent = await streamResponse('/api/chat', {
      messages: conversationHistory,
    }, assistantMsg);

    if (fullContent) {
      conversationHistory.push({ role: 'assistant', content: fullContent });
    }
  }

  // ── Integration with LLM export ─────────────────────────
  // Monkey-patch the serialize function to capture graph data
  const origGoLLMExport = window.goLLMExport;

  async function goLLMExportWithAnalysis() {
    // Run original LLM export
    if (origGoLLMExport) {
      await origGoLLMExport();
    }
  }

  // Wait for the LLM export to finish and add the Analyze button
  function patchLLMExportUI() {
    const observer = new MutationObserver(() => {
      const btnDone = document.getElementById('llm-btn-done');
      if (btnDone && btnDone.style.display !== 'none') {
        // Check if Analyze button already exists
        if (!document.getElementById('llm-btn-analyze')) {
          const analyzeBtn = document.createElement('button');
          analyzeBtn.id = 'llm-btn-analyze';
          analyzeBtn.className = 'llm-btn llm-btn-analyze';
          analyzeBtn.textContent = '🧠 Analyze with AI';
          analyzeBtn.addEventListener('click', () => {
            // Grab the last generated graph data from the serialize output
            if (window._lastLLMGraphData) {
              const llmOverlay = document.getElementById('llm-overlay');
              if (llmOverlay) llmOverlay.classList.remove('active');
              analyzeGraph(window._lastLLMGraphData);
            } else {
              alert('No graph data found. Please run the LLM export first.');
            }
          });
          btnDone.parentElement.insertBefore(analyzeBtn, btnDone);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  }

  // ── Also allow analyzing from a standalone button ───────
  function createAnalyzeButton() {
    // Add an Analyze button to the bottom-right button group
    const buttonContainer = document.getElementById('buttons');
    if (!buttonContainer) return;

    const btn = document.createElement('button');
    btn.id = 'ai-analyze-btn';
    btn.type = 'button';
    btn.title = 'Analyze map with AI';
    btn.innerHTML = '🧠';
    btn.style.fontSize = '18px';
    btn.addEventListener('click', () => {
      // If we have graph data from a previous export, use it
      if (window._lastLLMGraphData) {
        analyzeGraph(window._lastLLMGraphData);
      } else {
        // Build graph data from the current vis.js network
        if (typeof nodes !== 'undefined' && nodes.length > 0) {
          const graphData = buildGraphFromNetwork();
          if (graphData) {
            analyzeGraph(graphData);
          } else {
            openPanel();
            messagesContainer.innerHTML = '';
            addMessage('system', '⚠️ No graph data available. Use "LLM Export" first or expand some nodes on the map.');
          }
        } else {
          openPanel();
          messagesContainer.innerHTML = '';
          addMessage('system', '⚠️ No graph data available. Use "LLM Export" first or expand some nodes on the map.');
        }
      }
    });

    buttonContainer.insertBefore(btn, buttonContainer.firstChild);
  }

  // ── Build graph text from current vis.js network ────────
  function buildGraphFromNetwork() {
    if (typeof nodes === 'undefined' || typeof edges === 'undefined') return null;

    const allNodes = nodes.get();
    const allEdges = edges.get();
    if (allNodes.length === 0) return null;

    const now = new Date().toISOString().slice(0, 10);
    const out = [];

    out.push('WIKIPEDIA_MAP');
    out.push('This file is a directed graph of Wikipedia article links.');
    out.push(`date:${now}`);
    out.push(`nodes:${allNodes.length}`);
    out.push(`edges:${allEdges.length}`);
    out.push('');

    // Roots
    const roots = allNodes.filter(n => n.level === 0);
    out.push('ROOTS (search terms that seeded this graph)');
    roots.forEach(r => {
      const label = (r.label || r.id).replace(/\n/g, ' ');
      const descendants = allNodes.filter(n => n.rootId === r.id && n.level > 0).length;
      out.push(`${label} (${descendants} descendants)`);
    });
    out.push('');

    // Build adjacency from edges
    const adjacency = new Map();
    allEdges.forEach(e => {
      if (!adjacency.has(e.from)) adjacency.set(e.from, []);
      const toNode = allNodes.find(n => n.id === e.to);
      if (toNode) adjacency.get(e.from).push((toNode.label || toNode.id).replace(/\n/g, ' '));
    });

    out.push('GRAPH');
    // Sort by level
    const parentNodes = [...adjacency.keys()]
      .map(id => allNodes.find(n => n.id === id))
      .filter(Boolean)
      .sort((a, b) => (a.level || 0) - (b.level || 0));

    parentNodes.forEach(pNode => {
      const children = adjacency.get(pNode.id);
      if (children && children.length > 0) {
        const isBridge = pNode.isBridge ? ' *' : '';
        const label = (pNode.label || pNode.id).replace(/\n/g, ' ');
        out.push(`[${pNode.level || 0}]${isBridge} ${label} -> ${children.join(', ')}`);
      }
    });
    out.push('');

    return out.join('\n');
  }

  // ── Init on page load ───────────────────────────────────
  function init() {
    patchLLMExportUI();
    createAnalyzeButton();
  }

  // Run after DOM is ready (this script loads at end of body)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for global use
  window.analyzeGraph = analyzeGraph;
  window.openAIPanel = openPanel;
})();
