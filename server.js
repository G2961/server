const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

// Создаём HTTP-сервер для обработки запросов (включая health-check от Render)
const server = http.createServer((req, res) => {
    // Health check endpoint для Render
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }
    
    // Для всех остальных запросов
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('WebSocket server running');
});

// WebSocket-сервер, привязанный к HTTP-серверу
const wss = new WebSocket.Server({ 
    server,
    clientTracking: true,
    perMessageDeflate: false
});

const clients = new Map(); // nickname -> WebSocket

console.log('🚀 Signal server starting...');

// Рассылка списка пользователей всем подключенным
function broadcastUserList() {
    const users = Array.from(clients.keys());
    const message = JSON.stringify({ type: 'userList', users });
    
    clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
}

// Отправка сообщения конкретному пользователю
function sendToUser(nickname, message) {
    const ws = clients.get(nickname);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
        return true;
    }
    return false;
}

wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    console.log(`🔗 New connection from ${ip}`);
    
    let nickname = null;
    
    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            
            // Вход пользователя
            if (msg.type === 'login') {
                nickname = msg.myName;
                clients.set(nickname, ws);
                ws.nickname = nickname;
                
                console.log(`✅ User "${nickname}" logged in`);
                
                // Приветствие
                ws.send(JSON.stringify({ 
                    type: 'welcome', 
                    myName: nickname 
                }));
                
                // Обновить список онлайн у всех
                broadcastUserList();
                return;
            }
            
            // Текстовые сообщения (чат)
            if (msg.type === 'message') {
                if (!msg.to || !msg.data) return;
                
                const payload = JSON.stringify({ 
                    type: 'message', 
                    from: nickname, 
                     msg.data 
                });
                
                const delivered = sendToUser(msg.to, payload);
                if (!delivered) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                         `Пользователь "${msg.to}" не в сети` 
                    }));
                }
                return;
            }
            
            // WebRTC сигналы: offer, answer, candidate, reject
            if (['offer', 'answer', 'candidate', 'reject'].includes(msg.type)) {
                if (!msg.to) return;
                
                // Формируем правильный формат для пересылки
                const forward = {
                    type: msg.type,
                    from: nickname,
                    to: msg.to
                };
                
                if (msg.type === 'candidate') {
                    forward.data = msg.data;
                } else {
                    // offer/answer: передаём SDP
                    forward.sdp = msg.sdp || msg.data;
                }
                
                const delivered = sendToUser(msg.to, JSON.stringify(forward));
                if (!delivered) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                         `Пользователь "${msg.to}" не в сети` 
                    }));
                }
                return;
            }
            
        } catch (error) {
            console.error('❌ Parse error:', error.message);
        }
    });
    
    ws.on('close', () => {
        if (nickname) {
            console.log(`❌ User "${nickname}" disconnected`);
            clients.delete(nickname);
            broadcastUserList();
        }
    });
    
    ws.on('error', (error) => {
        console.error(`❌ WebSocket error for ${nickname || 'unknown'}:`, error.message);
    });
    
    ws.on('pong', () => {
        // Keep-alive ответ
    });
});

wss.on('listening', () => {
    console.log(`✅ WebSocket server ready`);
});

wss.on('error', (error) => {
    console.error('❌ WSS error:', error.message);
});

// Запускаем HTTP + WebSocket сервер
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server listening on port ${PORT}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});

// Keep-alive ping каждые 30 секунд (для предотвращения разрыва)
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    });
}, 30000);
