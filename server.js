const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

// HTTP-сервер для health-check (нужен для Render)
const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('WebSocket server running');
});

// WebSocket-сервер
const wss = new WebSocket.Server({ 
    server,
    clientTracking: true,
    perMessageDeflate: false
});

const clients = new Map();

console.log('🚀 Signal server starting...');

function broadcastUserList() {
    const users = Array.from(clients.keys());
    const message = JSON.stringify({ type: 'userList', users });
    clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(message);
    });
}

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
            
            // Login
            if (msg.type === 'login') {
                nickname = msg.myName;
                clients.set(nickname, ws);
                ws.nickname = nickname;
                console.log(`✅ User "${nickname}" logged in`);
                ws.send(JSON.stringify({ type: 'welcome', myName: nickname }));
                broadcastUserList();
                return;
            }
            
            // Чат
            if (msg.type === 'message') {
                if (!msg.to || !msg.data) return;
                const payload = JSON.stringify({ 
                    type: 'message', 
                    from: nickname, 
                    data: msg.data  // ✅ ИСПРАВЛЕНО: ключ: значение
                });
                const ok = sendToUser(msg.to, payload);
                if (!ok) {
                    ws.send(JSON.stringify({ type: 'error', data: `User "${msg.to}" offline` }));
                }
                return;
            }
            
            // WebRTC сигналы
            if (['offer', 'answer', 'candidate', 'reject'].includes(msg.type)) {
                if (!msg.to) return;
                
                const forward = {
                    type: msg.type,
                    from: nickname,
                    to: msg.to
                };
                
                if (msg.type === 'candidate') {
                    forward.data = msg.data;  // ✅ ICE candidate
                } else {
                    forward.sdp = msg.sdp || msg.data;  // ✅ SDP для offer/answer
                }
                
                const ok = sendToUser(msg.to, JSON.stringify(forward));
                if (!ok) {
                    ws.send(JSON.stringify({ type: 'error', data: `User "${msg.to}" offline` }));
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
    
    ws.on('error', (err) => {
        console.error(`❌ WS error:`, err.message);
    });
});

// Запуск сервера
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server listening on port ${PORT}`);
});

// Keep-alive
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
    });
}, 30000);
