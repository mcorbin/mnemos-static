(function () {
  const ERROR_MESSAGES = {
    invalid_request: 'Paramètres invalides.',
    invalid_input_message: 'Message invalide.',
    conversation_not_found: 'La conversation est introuvable.',
    rate_limited: 'Trop de requêtes. Veuillez patienter avant de réessayer.',
    conversation_message_limit_exceeded: 'Le nombre maximum de messages de cette conversation a été atteint. Cliquez sur "Nouveau" pour démarrer une nouvelle conversation.',
    agent_daily_token_limit_exceeded: "La limite d'utilisation quotidienne de l'assistant a été atteinte. Réessayez demain.",
    agent_owner_daily_token_limit_exceeded: "La limite d'utilisation quotidienne de l'assistant a été atteinte. Réessayez demain.",
    api_error: 'Une erreur interne s\'est produite. Veuillez réessayer.',
  };

  function errorMessage(type) {
    return ERROR_MESSAGES[type] || 'Une erreur est survenue.';
  }

  const toggle = document.getElementById('chatbot-toggle');
  const close = document.getElementById('chatbot-close');
  const newBtn = document.getElementById('chatbot-new');
  const panel = document.getElementById('chatbot-panel');
  const form = document.getElementById('chatbot-form');
  const input = document.getElementById('chatbot-input');
  const messages = document.getElementById('chatbot-messages');
  const counter = document.getElementById('chatbot-counter');
  const maxMessages = parseInt(panel.dataset.maxMessages || '0', 10);

  let conversationId = null;
  let userMessageCount = 0;

  function updateCounter() {
    if (maxMessages > 0 && userMessageCount >= maxMessages - 3) {
      counter.textContent = userMessageCount + '/' + maxMessages;
      counter.classList.remove('hidden');
      counter.style.color = userMessageCount >= maxMessages ? '#b5451b' : '';
    } else {
      counter.classList.add('hidden');
    }
  }

  toggle.addEventListener('click', function () {
    var willOpen = !panel.classList.contains('open');
    panel.classList.toggle('open', willOpen);
    if (window.innerWidth < 640) {
      document.body.style.overflow = willOpen ? 'hidden' : '';
    }
    if (willOpen && window.innerWidth >= 640) input.focus();
  });

  close.addEventListener('click', function () {
    panel.classList.remove('open');
    document.body.style.overflow = '';
  });

  newBtn.addEventListener('click', function () {
    conversationId = null;
    messages.innerHTML = '';
    input.disabled = false;
    userMessageCount = 0;
    updateCounter();
    input.focus();
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || input.disabled) return;

    input.value = '';
    input.disabled = true;

    appendBubble('user', text);
    userMessageCount++;
    updateCounter();

    try {
      await ensureConversation();

      const bubble = appendBubble('assistant', '');
      let pendingToolRequests = await streamTurn(
        [{ content: { type: 'text', text: text } }],
        bubble
      );

      while (pendingToolRequests.length > 0) {
        const approvals = pendingToolRequests.map(function (req) {
          return { content: { type: 'tool_approval', tool_call_id: req.tool_call_id, approved: true } };
        });
        pendingToolRequests = await streamTurn(approvals, bubble);
      }
    } catch (err) {
      appendBubble('error', err.message || 'Une erreur est survenue.');
    }

    input.disabled = false;
    input.focus();
  });

  async function ensureConversation() {
    if (conversationId) return;
    let res = await fetch('/api/public/v1/conversation/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Chat' }),
    });
    if (res.status === 401) {
      await fetch('/api/public/v1/session/', { method: 'POST' });
      res = await fetch('/api/public/v1/conversation/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Chat' }),
      });
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(errorMessage(data?.error?.type));
    }
    const data = await res.json();
    conversationId = data.id;
  }

  async function streamTurn(msgs, bubble) {
    const response = await fetch('/api/public/v1/conversation/' + conversationId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: msgs }),
    });

    if (response.status === 401) {
      conversationId = null;
      await ensureConversation();
      return streamTurn(msgs, bubble);
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(errorMessage(data?.error?.type));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';
    const toolRequests = [];

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ') && line.length > 6) {
          let data;
          try { data = JSON.parse(line.slice(6)); } catch { continue; }

          if (currentEvent === 'text') {
            if (!bubble._started) {
              bubble._started = true;
              bubble.innerHTML = '';
            }
            bubble._md = (bubble._md || '') + data.text;
            bubble.innerHTML = marked.parse(bubble._md);
            messages.scrollTop = messages.scrollHeight;
          } else if (currentEvent === 'tool_requests') {
            toolRequests.push.apply(toolRequests, data.requests);
          } else if (currentEvent === 'error') {
            bubble._started = true;
            bubble.innerHTML = errorMessage(data.type);
          }
        }
      }
    }

    return toolRequests;
  }

  function appendBubble(role, text) {
    const row = document.createElement('div');
    const bubble = document.createElement('span');
    bubble.textContent = text;

    if (role === 'user') {
      row.className = 'flex justify-end';
      bubble.className = 'inline-block px-3 py-2 rounded-2xl rounded-tr-sm text-sm max-w-[78%] break-words';
      bubble.style.cssText = 'background-color:#b5451b;color:#fff';
    } else if (role === 'assistant') {
      row.className = 'flex justify-start';
      bubble.className = 'inline-block px-3 py-2 rounded-2xl rounded-tl-sm text-sm max-w-[78%] break-words prose prose-sm prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-headings:my-1';
      bubble.style.cssText = 'background-color:#f5f0e8;color:#1a1209;border:1px solid #e8e0d5';
      if (!text) {
        bubble.innerHTML = '<span style="display:inline-flex;gap:4px;align-items:center;height:1.25rem"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>';
      }
    } else {
      row.className = 'flex justify-start';
      bubble.className = 'inline-block bg-red-50 text-red-600 px-3 py-2 rounded-2xl text-sm max-w-[78%]';
    }

    row.appendChild(bubble);
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }
})();
