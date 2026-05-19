// LinkSnap Configuration
// Динамическая настройка base URL в зависимости от окружения

const config = {
    // API base URL: относительный путь работает для любого хоста (localhost, IP, домен)
    apiBaseUrl: '',

    // Полный base URL (используется редко, например для генерации абсолютных ссылок)
    get baseUrl() {
        return `${window.location.protocol}//${window.location.host}`;
    },

    // Среда выполнения
    get env() {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return 'development';
        }
        return 'production';
    },

    // Помощник для формирования API URL
    apiUrl(path) {
        if (path.startsWith('/')) return path;
        return `/api/${path}`;
    }
};

// Для использования в других скриптах:
// fetch(config.apiUrl('user')) вместо fetch('/api/user')
// или просто fetch('/api/user') — относительные пути работают всегда

if (typeof module !== 'undefined' && module.exports) {
    module.exports = config;
}
