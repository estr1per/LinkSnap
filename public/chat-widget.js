// Виджет чата поддержки LinkSnap - с непрозрачным фоном
(function() {
    let chatId = null;
    let isClosed = false;
    let pollInterval = null;
    let existingMessageIds = new Set();
    let isInitialized = false;

    // Создаём контейнер с инлайн-стилями для гарантии непрозрачности
    const container = document.createElement('div');
    container.className = 'chat-widget-container';
    container.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 10000;';
    
    container.innerHTML = `
        <div class="chat-window" id="chatWindow" style="position: absolute; bottom: 80px; right: 0; width: 380px; max-width: calc(100vw - 40px); height: 500px; max-height: calc(100vh - 100px); background: #ffffff !important; background-color: #ffffff !important; border-radius: 16px; box-shadow: 0 20px 40px rgba(0,0,0,0.2); display: none; flex-direction: column; overflow: hidden; border: 1px solid #e2e8f0;">
            <div class="chat-header" style="background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); color: white; padding: 16px 20px; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">💬 Поддержка</h3>
                <button class="chat-close" onclick="window.toggleChat()" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">×</button>
            </div>
            <div id="chatStatus" class="chat-status" style="display: none; padding: 8px 16px; text-align: center; font-size: 0.85rem; border-bottom: 1px solid #e2e8f0; background: #f8fafc;"></div>
            <div class="chat-body" id="chatBody" style="flex: 1; overflow-y: auto; padding: 16px; background: #f8fafc; background-color: #f8fafc;">
                <div class="chat-messages" id="chatMessages" style="display: flex; flex-direction: column; gap: 12px;">
                    <div class="chat-message system" id="initialMessage" style="align-self: center; background: #f1f5f9; color: #64748b; font-size: 0.85rem; text-align: center; padding: 8px 16px; border-radius: 20px;">
                        👋 Здравствуйте! Напишите нам, и мы ответим в ближайшее время.
                    </div>
                </div>
            </div>
            <div class="chat-input-area" id="chatInputArea" style="display: none; padding: 16px; background: #ffffff; border-top: 1px solid #e2e8f0;">
                <div class="chat-input-wrapper" style="display: flex; gap: 8px;">
                    <textarea class="chat-input" id="chatInput" placeholder="Введите сообщение..." rows="1" style="flex: 1; padding: 12px; border: 1px solid #cbd5e1; border-radius: 12px; resize: none; font-family: inherit; font-size: 0.95rem; background: #ffffff; color: #1e293b; max-height: 100px;" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();window.sendMessage();}"></textarea>
                    <button class="chat-send" id="chatSend" onclick="window.sendMessage()" style="width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); border: none; color: white; cursor: pointer; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">📤</button>
                </div>
            </div>
        </div>
        <button class="chat-button" id="chatButton" onclick="window.toggleChat()" title="Чат поддержки" style="width: 60px; height: 60px; border-radius: 50%; background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; color: white; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
            💬
        </button>
    `;

    document.body.appendChild(container);

    // Подключаем стили (как резерв)
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/chat-widget.css?v=5';
    document.head.appendChild(link);

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
                <div class="chat-message system" style="align-self: center; background: #f1f5f9; color: #64748b; font-size: 0.85rem; text-align: center; padding: 8px 16px; border-radius: 20px;">
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
                statusEl.style.cssText = 'padding: 8px 16px; text-align: center; font-size: 0.85rem; border-bottom: 1px solid #e2e8f0; background: #fee2e2; color: #dc2626;';
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
        
        if (type === 'user') {
            msgDiv.style.cssText = 'align-self: flex-end; background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); color: white; border-bottom-right-radius: 4px; max-width: 85%; padding: 12px 16px; border-radius: 12px; font-size: 0.95rem; line-height: 1.4;';
        } else if (type === 'support') {
            msgDiv.style.cssText = 'align-self: flex-start; background: #ffffff; color: #1e293b; border: 1px solid #e2e8f0; border-bottom-left-radius: 4px; max-width: 85%; padding: 12px 16px; border-radius: 12px; font-size: 0.95rem; line-height: 1.4;';
        } else {
            msgDiv.style.cssText = 'align-self: center; background: #f1f5f9; color: #64748b; font-size: 0.85rem; text-align: center; padding: 8px 16px; border-radius: 20px;';
        }
        
        msgDiv.innerHTML = `
            <div class="message-text" style="word-wrap: break-word;">${escapedText}</div>
            ${timeStr ? `<div class="message-time" style="font-size: 0.7rem; opacity: 0.7; margin-top: 4px;">${timeStr}</div>` : ''}
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

        const sendBtn = document.getElementById('chatSend');
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.style.opacity = '0.5';
        }
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
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.style.opacity = '1';
            }
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

    window.toggleChat = function() {
        const chatWindow = document.getElementById('chatWindow');
        const chatButton = document.getElementById('chatButton');
        
        if (chatWindow) chatWindow.classList.toggle('open');
        
        if (chatWindow && chatWindow.classList.contains('open')) {
            if (chatButton) chatButton.style.display = 'none';
            setTimeout(() => {
                const input = document.getElementById('chatInput');
                if (input && input.offsetParent !== null && !isClosed) {
                    input.focus();
                }
            }, 300);
        } else {
            if (chatButton) chatButton.style.display = 'flex';
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

    window.addEventListener('beforeunload', () => {
        if (pollInterval) clearInterval(pollInterval);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initChat);
    } else {
        initChat();
    }
})();