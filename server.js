require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8000;

// ── Config ───────────────────────────────────────────────
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemini-3-flash-preview';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

// ── Middleware ────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// ── Health check ─────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const status = { ollama: false, tavily: !!TAVILY_API_KEY, model: OLLAMA_MODEL };
  try {
    const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (ollamaRes.ok) {
      const data = await ollamaRes.json();
      status.ollama = true;
      status.availableModels = (data.models || []).map(m => m.name);
    }
  } catch (_) { /* Ollama not reachable */ }
  res.json(status);
});

// ── Tavily search ────────────────────────────────────────
app.post('/api/tavily-search', async (req, res) => {
  if (!TAVILY_API_KEY || TAVILY_API_KEY === 'your_tavily_api_key_here') {
    return res.status(400).json({ error: 'Tavily API key not configured. Add it to .env' });
  }

  const { query, maxResults = 5 } = req.body;
  if (!query) return res.status(400).json({ error: 'Missing query' });

  try {
    const tavilyRes = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: true,
      }),
    });

    if (!tavilyRes.ok) {
      const errText = await tavilyRes.text();
      return res.status(tavilyRes.status).json({ error: `Tavily error: ${errText}` });
    }

    const data = await tavilyRes.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: `Tavily request failed: ${err.message}` });
  }
});

// ── AI Analyze (Multi-pass Curiosity Flow) ────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { graphData, userPrompt } = req.body;
  if (!graphData) return res.status(400).json({ error: 'Missing graphData' });

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendSSE = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    // ── PASS 1: ANOMALY DETECTION (SCANNER) ──
    sendSSE({ phase: 'scanning', message: 'Scanning graph for non-obvious patterns...' });
    
    const scannerPrompt = `You are a "Pattern Hunter". Review this Wikipedia connection graph.
Identify 2-3 "Interesting Connections". Look for:
1. "Abnormal Connections": Logic jumps between logically distant domains.
2. "Unorthodox & Subtle Echoes": Symbolic, thematic, or branding links (e.g., how fiction influences tech naming, or philosophical undercurrents in science).

Respond ONLY with a JSON array of objects: [{ "topicA": "...", "topicB": "...", "reason": "Why this is surprising/unorthodox" }]
Graph: 
${graphData.substring(0, 8000)}`;

    const scannerRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: scannerPrompt }],
        format: 'json',
        stream: false,
      }),
    });

    let anomalies = [];
    if (scannerRes.ok) {
      const data = await scannerRes.json();
      try {
        anomalies = JSON.parse(data.message.content);
        if (!Array.isArray(anomalies)) anomalies = [];
      } catch (_) { /* fallback to empty */ }
    }

    // ── PASS 2: TARGETED RESEARCH (INVESTIGATOR) ──
    let researchContext = '';
    if (anomalies.length > 0 && TAVILY_API_KEY && TAVILY_API_KEY !== 'your_tavily_api_key_here') {
      for (const anomaly of anomalies.slice(0, 2)) {
        const query = `What is the deeper, unorthodox, or symbolic connection between ${anomaly.topicA} and ${anomaly.topicB}? Are there naming influences, thematic echoes, or hidden historical ties?`;
        sendSSE({ phase: 'researching', message: `Investigating subtle link: ${anomaly.topicA} ⟷ ${anomaly.topicB}`, topicA: anomaly.topicA, topicB: anomaly.topicB });
        
        try {
          const tavRes = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: TAVILY_API_KEY,
              query,
              search_depth: 'advanced',
              include_answer: true,
            }),
          });
          if (tavRes.ok) {
            const tavData = await tavRes.json();
            researchContext += `\n### Link: ${anomaly.topicA} ⟷ ${anomaly.topicB}\n`;
            researchContext += `Research Insight: ${tavData.answer || 'No direct summary found.'}\n`;
            if (tavData.results) {
              researchContext += tavData.results.slice(0, 2).map(r => `- ${r.content}`).join('\n') + '\n';
            }
          }
        } catch (err) {
          console.error('Tavily research failed:', err);
        }
      }
    }

    // ── PASS 3: FINAL SYNTHESIS ──
    sendSSE({ phase: 'synthesizing', message: 'Synthesizing high-value discovery report...' });

    const synthesisSystemPrompt = `You are a "Knowledge Detective" and "Curiosity Agent". 
Your goal is to offer High-Value Knowledge that is extremely hard to see without this map.
Look for the "unorthodox" and "subtle". Think like a philosopher-hacker: find where fiction leaks into reality, where branding hides intent, or where ancient patterns repeat in tech.

Structure your report:
## 🎭 Unorthodox & Symbolic Echoes
Focus on the subtle, symbolic, or name-based connections. Explain why a connection might be name-borrowing, a thematic tribute, or a conceptual "leak" between domains.
## 💎 Hidden Gems (Surprising connections explained)
Focus on the abnormal bridges found. Explain the "Why" using the research provided.
## 🌐 Paradigm Intersections
How these different domains of knowledge Influence each other.
## 🗺️ Shadow Paths
A narrative summary of the knowledge web.

Use "Insight Cards" format using blockquotes and bolding for the gems.`;

    let synthesisUserMsg = `Here is the Graph Data:\n${graphData}\n\n`;
    if (researchContext) {
      synthesisUserMsg += `\nTargeted Research Insights for strange connections:\n${researchContext}\n\n`;
    }
    if (userPrompt) {
      synthesisUserMsg += `\nUser's specific interest: ${userPrompt}\n`;
    }

    const ollamaStream = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: synthesisSystemPrompt },
          { role: 'user', content: synthesisUserMsg },
        ],
        stream: true,
      }),
    });

    if (!ollamaStream.ok) {
      const errText = await ollamaStream.text();
      sendSSE({ error: `Ollama error: ${errText}` });
      res.end();
      return;
    }

    const reader = ollamaStream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.message && parsed.message.content) {
            sendSSE({ token: parsed.message.content });
          }
          if (parsed.done) {
            sendSSE({ done: true });
          }
        } catch (_) { /* ignore */ }
      }
    }
    
    sendSSE({ phase: 'done', message: '[DONE]' });
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    sendSSE({ error: `Discovery flow failed: ${err.message}` });
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ── Follow-up question (streaming) ──────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !messages.length) return res.status(400).json({ error: 'Missing messages' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: true,
      }),
    });

    if (!ollamaRes.ok) {
      const errText = await ollamaRes.text();
      res.write(`data: ${JSON.stringify({ error: `Ollama error (${ollamaRes.status}): ${errText}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const reader = ollamaRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.message && parsed.message.content) {
            res.write(`data: ${JSON.stringify({ token: parsed.message.content })}\n\n`);
          }
          if (parsed.done) {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          }
        } catch (_) { /* skip */ }
      }
    }

    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer);
        if (parsed.message && parsed.message.content) {
          res.write(`data: ${JSON.stringify({ token: parsed.message.content })}\n\n`);
        }
      } catch (_) { /* skip */ }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: `Connection failed: ${err.message}` })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ── Start ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  🗺️  Wikipedia Map Server`);
  console.log(`  ──────────────────────────`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Ollama:  ${OLLAMA_BASE_URL} (model: ${OLLAMA_MODEL})`);
  console.log(`  Tavily:  ${TAVILY_API_KEY && TAVILY_API_KEY !== 'your_tavily_api_key_here' ? '✓ configured' : '✗ not configured'}`);
  console.log();
});
