const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;
const server = http.createServer();
const wss = new WebSocket.Server({ server });

const clients = new Map();

console.log('🚀 Signal server starting...');

function broadcastUserList() {
    const users = Array.from(clients.keys());
    const message = JSON.stringify({ type: 'userList', users });
    clients.forEach(ws => {
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
    const ip = req.socket.remoteAddress || 'unknown';
    console.log(`🔗 New connection from ${ip}`);
    
    let nickname = null;
    
    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            console.log(`📥 [${nickname || '?'}] ${msg.type}`, msg.to ? `→ ${msg.to}` : '');
            
            if (msg.type === 'login') {
                nickname = msg.myName;
                clients.set(nickname, ws);
                ws.nickname = nickname;
                console.log(`✅ "${nickname}" logged in`);
                ws.send(JSON.stringify({ type: 'welcome', myName: nickname }));
                broadcastUserList();
                return;
            }
            
            // Чат
            if (msg.type === 'message') {
                if (!msg.to) return console.log('⚠️ Message without "to"');
                const payload = JSON.stringify({ type: 'message', from: nickname, data: msg.data });
                console.log(`📤 Forwarding message to ${msg.to}`);
                const ok = sendToUser(msg.to, payload);
                if (!ok) ws.send(JSON.stringify({ type: 'error', data: `Пользователь "${msg.to}" не в сети` }));
                return;
            }
            
            // WebRTC сигналы
            if (['offer', 'answer', 'candidate', 'reject'].includes(msg.type)) {
                if (!msg.to) return console.log(`⚠️ ${msg.type} without "to"`);
                
                // Важно: передаём только нужные поля, чтобы не сломать RTC-объекты
                const forward = {
                    type: msg.type,
                    from: nickname,
                    to: msg.to
                };
                
                if (msg.type === 'candidate') {
                    forward.data = msg.data;  // ICE candidate
                } else {
                    // offer/answer: передаём sdp-объект как есть
                    forward.sdp = msg.sdp || msg.data;
                }
                
                const payload = JSON.stringify(forward);
                console.log(`📤 Forwarding ${msg.type} to ${msg.to}`);
                const ok = sendToUser(msg.to, payload);
                if (!ok) ws.send(JSON.stringify({ type: 'error', data: `Пользователь "${msg.to}" не в сети` }));
                return;
            }
            
        } catch (e) {
            console.error('❌ Parse error:', e.message);
        }
    });
    
    ws.on('close', () => {
        if (nickname) {
            console.log(`❌ "${nickname}" disconnected`);
            clients.delete(nickname);
            broadcastUserList();
        }
    });
    
    ws.on('error', (e) => console.error(`❌ WS error:`, e.message));
});

server.listen(PORT, () => {
    console.log(`✅ Server listening on port ${PORT}`);
});

// Keep-alive
setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
    });
}, 30000);
