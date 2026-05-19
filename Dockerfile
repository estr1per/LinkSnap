FROM node:18-alpine

WORKDIR /app

# Создаём непривилегированного пользователя
RUN addgroup -g 2000 -S app && adduser -u 2000 -S app -G app

# Копируем package.json
COPY package*.json ./

# Устанавливаем зависимости (НЕ используем npm ci!)
RUN npm install --omit=dev

# Копируем весь проект
COPY . .

# Создаём нужные папки и даём права
RUN mkdir -p data uploads && chown -R app:app data uploads

# Переключаемся на непривилегированного пользователя
USER app

EXPOSE 3000

CMD ["node", "server.js"]