const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

// HTTP-сервер для health-check (нужен для Render)
const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*' 
        });
        res.end('OK');
        return;
    }
    res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
    res.end('WebSocket server running');
});

// WebSocket-сервер
const wss = new WebSocket.Server({ 
    server,
    clientTracking: true,
    perMessageDeflate: false
});

const clients = new Map(); // nickname -> WebSocket

console.log('🚀 Signal server starting...');

// Рассылка списка пользователей всем
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
            
            // === LOGIN ===
            if (msg.type === 'login') {
                nickname = msg.myName;
                clients.set(nickname, ws);
                ws.nickname = nickname;
                console.log(`✅ User "${nickname}" logged in`);
                
                ws.send(JSON.stringify({ type: 'welcome', myName: nickname }));
                broadcastUserList();
                return;
            }
            
            // === CHAT MESSAGE ===
            if (msg.type === 'message') {
                if (!msg.to || !msg.data) return;
                
                // ✅ ИСПРАВЛЕНО: явные ключи (data: msg.data)
                const payload = JSON.stringify({ 
                    type: 'message', 
                    from: nickname, 
                    data: msg.data 
                });
                
                const delivered = sendToUser(msg.to, payload);
                if (!delivered) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        data: `User "${msg.to}" offline` 
                    }));
                }
                return;
            }
            
            // === WEBRTC SIGNALS ===
            if (['offer', 'answer', 'candidate', 'reject'].includes(msg.type)) {
                if (!msg.to) return;
                
                const forward = {
                    type: msg.type,
                    from: nickname,
                    to: msg.to
                };
                
                if (msg.type === 'candidate') {
                    // ✅ ICE candidate: ключ "data"
                    forward.data = msg.data;
                } else {
                    // ✅ offer/answer: ключ "sdp"
                    forward.sdp = msg.sdp || msg.data;
                }
                
                const delivered = sendToUser(msg.to, JSON.stringify(forward));
                if (!delivered) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        data: `User "${msg.to}" offline` 
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
        console.error(`❌ WebSocket error:`, error.message);
    });
});

wss.on('listening', () => {
    console.log(`✅ WebSocket server ready`);
});

wss.on('error', (error) => {
    console.error('❌ WSS error:', error.message);
});

// Запуск сервера
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server listening on port ${PORT}`);
});

// Keep-alive ping каждые 30 секунд
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    });
}, 30000);
