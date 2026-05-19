// LinkSnap Service Worker v2
const CACHE_NAME = 'linksnap-v2';
const STATIC_ASSETS = [
    '/style.css',
    '/dark-theme.css',
    '/manifest.json',
    '/js/utils.js'
];

// Установка SW и кэширование статики
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            try {
                await cache.addAll(STATIC_ASSETS);
                console.log('✅ Статические файлы закэшированы');
            } catch (err) {
                console.error('❌ Ошибка кэширования:', err);
            }
        })
    );
    self.skipWaiting();
});

// Активация - очистка старых кэшей
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => {
                        console.log('🗑️ Удаляем старый кэш:', key);
                        return caches.delete(key);
                    })
            );
        })
    );
    self.clients.claim();
});

// Перехват запросов
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    
    // API запросы не кэшируем (всегда из сети)
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(fetch(event.request));
        return;
    }
    
    // HTML страницы не кэшируем (всегда из сети)
    if (url.pathname === '/' || 
        url.pathname.endsWith('.html') ||
        url.pathname === '/index.html') {
        event.respondWith(fetch(event.request));
        return;
    }
    
    // Статические ресурсы: сначала кэш, потом сеть
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) {
                return cachedResponse;
            }
            
            return fetch(event.request).then(response => {
                // Не кэшируем ответы с ошибками
                if (!response || response.status !== 200) {
                    return response;
                }
                
                // Кэшируем только статические ресурсы
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseToCache);
                });
                
                return response;
            }).catch(() => {
                // Если нет сети и нет кэша, возвращаем fallback
                if (url.pathname.startsWith('/image-editor')) {
                    return new Response('Вы оффлайн. Редактор изображений будет доступен при подключении к интернету.', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain' }
                    });
                }
                return new Response('Вы оффлайн. Некоторые функции могут быть недоступны.', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain' }
                });
            });
        })
    );
});

// Обработка push уведомлений (для будущих обновлений)
self.addEventListener('push', event => {
    const data = event.data.json();
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-72.png',
            data: data.url
        })
    );
});

// Обработка клика по уведомлению
self.addEventListener('notificationclick', event => {
    event.notification.close();
    if (event.notification.data) {
        event.waitUntil(
            clients.openWindow(event.notification.data)
        );
    }
});