const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        res.end('OK');
        return;
    }
    res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
    res.end('WebSocket server');
});

const wss = new WebSocket.Server({ 
    server,
    clientTracking: true,
    perMessageDeflate: false
});

const clients = new Map();

console.log('🚀 Server starting...');

function broadcastUserList() {
    const users = Array.from(clients.keys());
    const msg = JSON.stringify({ type: 'userList', users });
    clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
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
    console.log(`🔗 Connect from ${ip}`);
    
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
            
            if (msg.type === 'message') {
                if (!msg.to || !msg.data) return;
                // ✅ Важно: добавляем from
                const payload = JSON.stringify({ 
                    type: 'message', 
                    from: nickname, 
                     msg.data 
                });
                const ok = sendToUser(msg.to, payload);
                if (!ok) ws.send(JSON.stringify({ type: 'error',  `User "${msg.to}" offline` }));
                return;
            }
            
            if (['offer', 'answer', 'candidate', 'reject'].includes(msg.type)) {
                if (!msg.to) return;
                const forward = { type: msg.type, from: nickname, to: msg.to };
                if (msg.type === 'candidate') {
                    forward.data = msg.data;
                } else {
                    forward.sdp = msg.sdp || msg.data;
                }
                const ok = sendToUser(msg.to, JSON.stringify(forward));
                if (!ok) ws.send(JSON.stringify({ type: 'error',  `User "${msg.to}" offline` }));
                return;
            }
            
        } catch (e) {
            console.error('❌ Parse:', e.message);
        }
    });
    
    ws.on('close', () => {
        if (nickname) {
            console.log(`❌ "${nickname}" disconnected`);
            clients.delete(nickname);
            broadcastUserList();
        }
    });
    
    ws.on('error', e => console.error(`❌ WS error:`, e.message));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Listening on port ${PORT}`);
});

setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
    });
}, 30000);
