// public/js/utils.js
// Общие функции для всех страниц LinkSnap

function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

async function checkAuth() {
    try {
        const res = await fetch('/api/user');
        if (res.status === 401) {
            window.location.href = '/login';
            return false;
        }
        const user = await res.json();
        return user;
    } catch(e) {
        console.error('Ошибка авторизации:', e);
        window.location.href = '/login';
        return false;
    }
}

async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
    } catch(e) {
        console.error('Ошибка выхода:', e);
    }
    window.location.href = '/login';
}

function formatDate(dateString) {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('ru-RU');
}

function formatDateTime(dateString) {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString('ru-RU');
}

function showToast(message, type = 'success', duration = 3000) {
    // Удаляем существующий тост
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) existingToast.remove();
    
    // Создаем новый тост
    const toast = document.createElement('div');
    toast.className = `alert alert-${type} toast-notification`;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9999;
        min-width: 250px;
        max-width: 350px;
        animation: slideInRight 0.3s ease-out;
        box-shadow: var(--shadow-lg);
        cursor: pointer;
    `;
    toast.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
            <span style="flex: 1;">${escapeHtml(message)}</span>
            <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; font-size: 1.2rem; cursor: pointer; padding: 0 5px;">✖</button>
        </div>
    `;
    
    document.body.appendChild(toast);
    
    // Автоматическое удаление через duration мс
    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, duration);
    
    // Клик для закрытия
    toast.addEventListener('click', () => toast.remove());
}

function copyToClipboard(text) {
    if (!text) return false;
    
    try {
        navigator.clipboard.writeText(text);
        showToast('Скопировано в буфер обмена!', 'success');
        return true;
    } catch(e) {
        // Fallback для старых браузеров
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('Скопировано в буфер обмена!', 'success');
        return true;
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Добавляем стили для анимации тоста
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    .toast-notification {
        cursor: pointer;
    }
    .toast-notification:hover {
        transform: translateY(-2px);
    }
`;
document.head.appendChild(style);

// Инициализация темы для всех страниц
(function initTheme() {
    const savedTheme = localStorage.getItem('linksnap-theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) themeToggle.checked = true;
    }
    
    // Слушатель для переключения темы
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('change', function() {
            if (this.checked) {
                document.body.classList.add('dark-theme');
                localStorage.setItem('linksnap-theme', 'dark');
            } else {
                document.body.classList.remove('dark-theme');
                localStorage.setItem('linksnap-theme', 'light');
            }
            // Перерисовываем графики если есть
            if (window.location.pathname.includes('dashboard.html') && typeof loadDashboardData === 'function') {
                setTimeout(() => loadDashboardData(), 50);
            }
        });
    }
})();