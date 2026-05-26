// Виджет чата поддержки LinkSnap - УПРОЩЁННАЯ ВЕРСИЯ
(function() {
    let chatId = null;
    let isClosed = false;
    let pollInterval = null;
    let existingMessageIds = new Set();
    let isInitialized = false;

    // Создаём контейнер
    const container = document.createElement('div');
    container.className = 'chat-widget-container';
    container.innerHTML = `
        <div class="chat-window" id="chatWindow">
            <div class="chat-header">
                <h3>💬 Поддержка</h3>
                <button class="chat-close" id="chatCloseBtn">×</button>
            </div>
            <div id="chatStatus" class="chat-status" style="display: none;"></div>
            <div class="chat-body" id="chatBody">
                <div class="chat-messages" id="chatMessages">
                    <div class="chat-message system" id="initialMessage">
                        👋 Здравствуйте! Напишите нам, и мы ответим в ближайшее время.
                    </div>
                </div>
            </div>
            <div class="chat-input-area" id="chatInputArea" style="display: none;">
                <div class="chat-input-wrapper">
                    <textarea 
                        class="chat-input" 
                        id="chatInput" 
                        placeholder="Введите сообщение..."
                        rows="1"
                    ></textarea>
                    <button class="chat-send" id="chatSendBtn">📤</button>
                </div>
            </div>
        </div>
        <button class="chat-button" id="chatOpenBtn" title="Чат поддержки">
            💬
        </button>
    `;

    document.body.appendChild(container);

    // Подключаем стили
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/chat-widget.css?v=7';
    document.head.appendChild(link);

    // Получаем элементы
    const chatWindow = document.getElementById('chatWindow');
    const openBtn = document.getElementById('chatOpenBtn');
    const closeBtn = document.getElementById('chatCloseBtn');

    // Открыть чат
    function openChat() {
        if (chatWindow) {
            chatWindow.classList.add('open');
            if (openBtn) openBtn.style.display = 'none';
        }
        setTimeout(() => {
            const input = document.getElementById('chatInput');
            if (input && !isClosed) input.focus();
        }, 100);
    }

    // Закрыть чат
    function closeChat() {
        if (chatWindow) {
            chatWindow.classList.remove('open');
            if (openBtn) openBtn.style.display = 'flex';
        }
    }

    // Обработчики
    if (openBtn) openBtn.onclick = openChat;
    if (closeBtn) closeBtn.onclick = closeChat;

    async function initChat() {
        if (isInitialized) return;
        isInitialized = true;
        
        console.log('[Chat] Инициализация...');
        
        try {
            const res = await fetch('/api/support/chat');
            
            if (!res.ok) {
                showNotAuthorized();
                return;
            }
            
            const data = await res.json();
            console.log('[Chat] Чат:', data);
            
            if (data.success && data.chat) {
                chatId = data.chat.id;
                isClosed = data.chat.is_closed === 1;
                
                showChatInterface();
                await loadMessages();
                startPolling();
            } else {
                showNewChat();
            }
        } catch(e) {
            console.error('[Chat] Ошибка инициализации:', e);
            showNotAuthorized();
        }
    }

    function showNotAuthorized() {
        const messagesContainer = document.getElementById('chatMessages');
        if (messagesContainer) {
            messagesContainer.innerHTML = `
                <div class="chat-message system">
                    🔐 Для общения с поддержкой необходимо <a href="/login" style="color: #6366f1;">войти</a> или <a href="/register" style="color: #6366f1;">зарегистрироваться</a>.
                </div>
            `;
        }
        const initialMsg = document.getElementById('initialMessage');
        if (initialMsg) initialMsg.remove();
    }

    function showNewChat() {
        const initialMsg = document.getElementById('initialMessage');
        if (initialMsg) initialMsg.remove();
        const inputArea = document.getElementById('chatInputArea');
        if (inputArea) inputArea.style.display = 'none';
        const statusEl = document.getElementById('chatStatus');
        if (statusEl) statusEl.style.display = 'none';
    }

    function showChatInterface() {
        const initialMsg = document.getElementById('initialMessage');
        if (initialMsg) initialMsg.remove();
        const inputArea = document.getElementById('chatInputArea');
        if (inputArea) inputArea.style.display = 'block';
        updateChatInputState();
    }

    function updateChatInputState() {
        const inputArea = document.getElementById('chatInputArea');
        const statusEl = document.getElementById('chatStatus');
        
        if (isClosed) {
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.className = 'chat-status closed';
                statusEl.textContent = '✅ Чат закрыт';
            }
            if (inputArea) inputArea.style.display = 'none';
        } else {
            if (statusEl) statusEl.style.display = 'none';
            if (inputArea) inputArea.style.display = 'block';
        }
    }

    async function loadMessages() {
        if (!chatId) return;

        try {
            const res = await fetch(`/api/support/chat/${chatId}/messages`);
            const data = await res.json();

            if (data.success) {
                const messagesContainer = document.getElementById('chatMessages');
                if (!messagesContainer) return;
                
                const loadingMsg = messagesContainer.querySelector('.loading');
                if (loadingMsg) loadingMsg.remove();
                
                const newMessages = (data.messages || []).filter(msg => {
                    const msgId = `msg-${msg.id}`;
                    if (existingMessageIds.has(msgId)) return false;
                    existingMessageIds.add(msgId);
                    return true;
                });

                newMessages.forEach(msg => {
                    addMessage(msg.message, msg.sender_type, msg.created_at, msg.id);
                });

                if (newMessages.length > 0) {
                    scrollToBottom();
                }
                
                if (data.isClosed !== undefined) {
                    isClosed = data.isClosed;
                    updateChatInputState();
                }
            }
        } catch(e) {
            console.error('[Chat] Ошибка загрузки сообщений:', e);
        }
    }

    function addMessage(text, type, timestamp, id) {
        const messagesContainer = document.getElementById('chatMessages');
        if (!messagesContainer) return;
        
        const msgId = `msg-${id}`;
        if (document.getElementById(msgId)) return;
        
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${type}`;
        msgDiv.id = msgId;
        
        const escapedText = escapeHtml(text);
        const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'}) : '';
        
        msgDiv.innerHTML = `
            <div class="message-text">${escapedText}</div>
            ${timeStr ? `<div class="message-time">${timeStr}</div>` : ''}
        `;
        messagesContainer.appendChild(msgDiv);
        scrollToBottom();
    }

    function scrollToBottom() {
        const chatBody = document.getElementById('chatBody');
        setTimeout(() => {
            if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;
        }, 50);
    }

    async function sendMessage() {
        const input = document.getElementById('chatInput');
        const message = input ? input.value.trim() : '';
        
        if (!message || !chatId || isClosed) return;

        const sendBtn = document.getElementById('chatSendBtn');
        if (sendBtn) sendBtn.disabled = true;
        if (input) input.value = '';

        try {
            const res = await fetch(`/api/support/chat/${chatId}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });

            const data = await res.json();

            if (data.success) {
                if (input) input.value = '';
                await loadMessages();
            } else {
                alert('Ошибка: ' + (data.error || 'Неизвестная ошибка'));
                if (input) input.value = message;
            }
        } catch(e) {
            console.error('[Chat] Ошибка отправки:', e);
            alert('Ошибка отправки сообщения');
            if (input) input.value = message;
        } finally {
            if (sendBtn) sendBtn.disabled = false;
            if (input) input.focus();
        }
    }

    function startPolling() {
        if (pollInterval) clearInterval(pollInterval);
        
        pollInterval = setInterval(() => {
            if (chatId) loadMessages();
        }, 5000);
        
        console.log('[Chat] Polling запущен (5с)');
    }

    // Обработка Enter
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            const input = document.getElementById('chatInput');
            if (input && document.activeElement === input) {
                e.preventDefault();
                sendMessage();
            }
        }
    });

    window.sendMessage = sendMessage;

    function escapeHtml(text) {
        if (!text) return '';
        return String(text).replace(/[&<>"']/g, m => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m]));
    }

    window.addEventListener('beforeunload', () => {
        if (pollInterval) clearInterval(pollInterval);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initChat);
    } else {
        initChat();
    }
})();