// Виджет чата поддержки LinkSnap (Real-time)

(function() {
    let chatId = null;
    let isClosed = false;
    let lastMessageTime = null;
    let pollInterval = null;
    let isConnected = false;
    let existingMessageIds = new Set(); // IDs уже показанных сообщений

    // Создаём контейнер
    const container = document.createElement('div');
    container.className = 'chat-widget-container';
    container.innerHTML = `
        <div class="chat-window" id="chatWindow">
            <div class="chat-header">
                <h3>💬 Поддержка</h3>
                <button class="chat-close" onclick="window.toggleChat()">×</button>
            </div>
            <div id="chatStatus" class="chat-status" style="display: none;"></div>
            <div class="chat-body" id="chatBody">
                <div class="chat-messages" id="chatMessages">
                    <div class="loading">
                        <div class="loading-spinner"></div>
                        <span>Подключение...</span>
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
                        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();window.sendMessage();}"
                    ></textarea>
                    <button class="chat-send" id="chatSend" onclick="window.sendMessage()">📤</button>
                </div>
            </div>
            <div class="chat-new-chat" id="chatNewChat" style="display: none;">
                <div class="chat-message system">
                    👋 Здравствуйте! Напишите нам, и мы ответим в ближайшее время.
                </div>
            </div>
        </div>
        <button class="chat-button" id="chatButton" onclick="window.toggleChat()" title="Чат поддержки">
            💬
        </button>
    `;

    document.body.appendChild(container);

    // Подключаем стили
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/chat-widget.css?v=2';
    document.head.appendChild(link);

    // Инициализация
    initChat();

    async function initChat() {
        console.log('[Chat] Инициализация...');
        
        try {
            const res = await fetch('/api/support/chat');
            
            if (!res.ok) {
                // Не авторизован
                showNotAuthorized();
                return;
            }
            
            const data = await res.json();
            console.log('[Chat] Чат:', data);
            
            if (data.success && data.chat) {
                chatId = data.chat.id;
                isClosed = data.chat.is_closed === 1;
                
                showChatInterface();
                loadMessages();
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
        document.getElementById('chatMessages').innerHTML = `
            <div class="chat-message system">
                🔐 Для общения с поддержкой необходимо <a href="/login" style="color: var(--primary);">войти</a> или <a href="/register" style="color: var(--primary);">зарегистрироваться</a>.
            </div>
        `;
    }

    function showNewChat() {
        document.getElementById('chatNewChat').style.display = 'block';
        document.getElementById('chatInputArea').style.display = 'none';
        document.getElementById('chatStatus').style.display = 'none';
    }

    function showChatInterface() {
        document.getElementById('chatNewChat').style.display = 'none';
        document.getElementById('chatInputArea').style.display = 'block';
        updateChatInputState();
    }

    function updateChatInputState() {
        const inputArea = document.getElementById('chatInputArea');
        const statusEl = document.getElementById('chatStatus');
        
        if (isClosed) {
            statusEl.style.display = 'block';
            statusEl.className = 'chat-status closed';
            statusEl.textContent = '✅ Чат закрыт';
            inputArea.style.display = 'none';
        } else {
            statusEl.style.display = 'none';
            inputArea.style.display = 'block';
        }
    }

    async function loadMessages() {
        if (!chatId) return;

        try {
            const url = lastMessageTime 
                ? `/api/support/chat/${chatId}/messages?since=${encodeURIComponent(lastMessageTime)}`
                : `/api/support/chat/${chatId}/messages`;
            
            const res = await fetch(url);
            const data = await res.json();

            if (data.success) {
                const messagesContainer = document.getElementById('chatMessages');
                
                // Если это первая загрузка - показываем все сообщения
                if (!lastMessageTime && data.messages.length > 0) {
                    messagesContainer.innerHTML = '';
                    existingMessageIds.clear();
                }
                
                // Добавляем только новые сообщения
                const newMessages = (data.messages || []).filter(msg => {
                    const msgId = `msg-${msg.id}`;
                    if (existingMessageIds.has(msgId)) return false;
                    existingMessageIds.add(msgId);
                    return true;
                });

                newMessages.forEach(msg => {
                    addMessage(msg.message, msg.sender_type, msg.created_at, msg.id);
                    lastMessageTime = msg.created_at;
                });

                // Прокрутка вниз только для новых сообщений
                if (newMessages.length > 0) {
                    scrollToBottom();
                }
                
                if (data.isClosed !== undefined) {
                    isClosed = data.isClosed;
                    updateChatInputState();
                }
                
                isConnected = true;
            }
        } catch(e) {
            console.error('[Chat] Ошибка загрузки сообщений:', e);
        }
    }

    function addMessage(text, type, timestamp, id) {
        const messagesContainer = document.getElementById('chatMessages');
        
        const msgId = `msg-${id}`;
        // Проверяем, нет ли уже такого сообщения
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
            chatBody.scrollTop = chatBody.scrollHeight;
        }, 50);
    }

    async function sendMessage() {
        const input = document.getElementById('chatInput');
        const message = input.value.trim();
        
        if (!message || !chatId || isClosed) return;

        const sendBtn = document.getElementById('chatSend');
        sendBtn.disabled = true;
        input.value = '';

        try {
            const res = await fetch(`/api/support/chat/${chatId}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });

            const data = await res.json();

            if (data.success) {
                // Сообщение добавится через polling
                input.value = '';
            } else {
                alert('Ошибка: ' + data.error);
                input.value = message;
            }
        } catch(e) {
            console.error('[Chat] Ошибка отправки:', e);
            alert('Ошибка отправки сообщения');
            input.value = message;
        } finally {
            sendBtn.disabled = false;
            input.focus();
        }
    }

    function startPolling() {
        if (pollInterval) clearInterval(pollInterval);
        
        // Первый запрос сразу
        loadMessages();
        
        // Затем опрос каждые 2 секунды
        pollInterval = setInterval(() => {
            loadMessages();
        }, 2000);
        
        console.log('[Chat] Polling запущен (2с)');
    }

    window.toggleChat = function() {
        const chatWindow = document.getElementById('chatWindow');
        const chatButton = document.getElementById('chatButton');
        
        chatWindow.classList.toggle('open');
        
        if (chatWindow.classList.contains('open')) {
            chatButton.style.display = 'none';
            setTimeout(() => {
                const input = document.getElementById('chatInput');
                if (input && input.offsetParent !== null && !isClosed) {
                    input.focus();
                }
            }, 300);
        } else {
            chatButton.style.display = 'flex';
        }
    };

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

    // Очистка при закрытии страницы
    window.addEventListener('beforeunload', () => {
        if (pollInterval) clearInterval(pollInterval);
    });
})();
