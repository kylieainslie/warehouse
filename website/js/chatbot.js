// chatbot.js
// Claude-powered chatbot for package recommendations

let chatHistory = [];
let isChatOpen = false;
let isChatLoading = false;

// Initialize chatbot on page load
document.addEventListener('DOMContentLoaded', function() {
  createChatbotUI();
});

// Create the chatbot UI elements
function createChatbotUI() {
  const chatbotHtml = `
    <!-- Chat Toggle Button -->
    <button id="chat-toggle" class="chat-toggle" onclick="toggleChat()" aria-label="Open package assistant">
      <i class="bi bi-chat-dots-fill"></i>
      <span class="chat-toggle-text">Ask AI</span>
    </button>

    <!-- Chat Window -->
    <div id="chat-window" class="chat-window" style="display: none;">
      <div class="chat-header">
        <div class="chat-header-info">
          <i class="bi bi-robot"></i>
          <span>Package Assistant</span>
        </div>
        <button class="chat-close" onclick="toggleChat()" aria-label="Close chat">&times;</button>
      </div>

      <div id="chat-messages" class="chat-messages">
        <div class="chat-message assistant">
          <div class="message-content">
            <p>Hi! I'm your R package assistant. I can help you find the right packages for your data science tasks.</p>
            <p>Try asking things like:</p>
            <ul>
              <li>"What's the best package for machine learning?"</li>
              <li>"I need to create interactive visualizations"</li>
              <li>"Compare dplyr and data.table for data wrangling"</li>
            </ul>
          </div>
        </div>
      </div>

      <div id="chat-loading" class="chat-loading" style="display: none;">
        <div class="typing-indicator">
          <span></span><span></span><span></span>
        </div>
      </div>

      <form id="chat-form" class="chat-input-form" onsubmit="sendChatMessage(event)">
        <input type="text" id="chat-input" class="chat-input"
               placeholder="Ask about R packages..."
               autocomplete="off">
        <button type="submit" class="chat-send" aria-label="Send message">
          <i class="bi bi-send-fill"></i>
        </button>
      </form>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', chatbotHtml);
}

// Toggle chat window visibility
function toggleChat() {
  const chatWindow = document.getElementById('chat-window');
  const chatToggle = document.getElementById('chat-toggle');

  isChatOpen = !isChatOpen;

  if (isChatOpen) {
    chatWindow.style.display = 'flex';
    chatToggle.classList.add('chat-open');
    document.getElementById('chat-input').focus();
  } else {
    chatWindow.style.display = 'none';
    chatToggle.classList.remove('chat-open');
  }
}

// Send chat message
async function sendChatMessage(event) {
  event.preventDefault();

  const input = document.getElementById('chat-input');
  const message = input.value.trim();

  if (!message || isChatLoading) return;

  // Clear input
  input.value = '';

  // Add user message to UI
  addMessageToUI('user', message);

  // Add to history
  chatHistory.push({ role: 'user', content: message });

  // Show loading
  setLoading(true);

  try {
    // Call the Netlify function
    const response = await fetch('/.netlify/functions/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: message,
        history: chatHistory.slice(-10)  // Send last 10 messages for context
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    // Add assistant response to UI and history
    addMessageToUI('assistant', data.response);
    chatHistory.push({ role: 'assistant', content: data.response });

  } catch (error) {
    console.error('Chat error:', error);

    let errorMessage = 'Sorry, I encountered an error. ';

    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      errorMessage += 'The chat service might not be configured yet. Please check that the Netlify function is deployed.';
    } else {
      errorMessage += 'Please try again or use the search bar above.';
    }

    addMessageToUI('assistant', errorMessage, true);
  } finally {
    setLoading(false);
  }
}

// Add message to chat UI
function addMessageToUI(role, content, isError = false) {
  const messagesContainer = document.getElementById('chat-messages');

  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${role}${isError ? ' error' : ''}`;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  // Parse markdown-like content (basic)
  contentDiv.innerHTML = formatChatMessage(content);

  messageDiv.appendChild(contentDiv);
  messagesContainer.appendChild(messageDiv);

  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Format chat message with basic markdown support
function formatChatMessage(content) {
  if (!content) return '';

  // Escape HTML first
  let formatted = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Convert markdown-like formatting
  formatted = formatted
    // Code blocks
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Links (basic URL detection)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    // Line breaks
    .replace(/\n/g, '<br>');

  return formatted;
}

// Set loading state
function setLoading(loading) {
  isChatLoading = loading;

  const loadingEl = document.getElementById('chat-loading');
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.querySelector('.chat-send');

  if (loading) {
    loadingEl.style.display = 'flex';
    inputEl.disabled = true;
    sendBtn.disabled = true;
  } else {
    loadingEl.style.display = 'none';
    inputEl.disabled = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

// Clear chat history
function clearChat() {
  chatHistory = [];
  const messagesContainer = document.getElementById('chat-messages');

  // Keep only the welcome message
  messagesContainer.innerHTML = `
    <div class="chat-message assistant">
      <div class="message-content">
        <p>Hi! I'm your R package assistant. How can I help you with your data science tasks?</p>
      </div>
    </div>
  `;
}

// Pre-fill chat input with a message (used by search comparison feature)
function prefillChat(message, autoSend = false) {
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.value = message;
    chatInput.focus();

    if (autoSend) {
      // Trigger send after short delay
      setTimeout(() => {
        const form = document.getElementById('chat-form');
        if (form) {
          form.dispatchEvent(new Event('submit'));
        }
      }, 200);
    }
  }
}

// Export functions for global use
window.toggleChat = toggleChat;
window.sendChatMessage = sendChatMessage;
window.clearChat = clearChat;
window.prefillChat = prefillChat;
window.isChatOpen = () => isChatOpen;
