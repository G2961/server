const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }
    res.writeHead(404);
    res.end('Server running');
});

const wss = new WebSocket.Server({ server });
const clients = new Map();

console.log('🚀 Server starting...');

wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress || 'unknown';
    console.log(`[WS] Connect from ${ip}`);
    
    let nickname = null;
    
    ws.on('message', (raw) => {
        console.log(`[WS] Raw message: ${raw.toString().substring(0, 200)}`);
        
        try {
            const msg = JSON.parse(raw);
            console.log(`[WS] Parsed: type=${msg.type}, from=${msg.myName || msg.from}, to=${msg.to}`);
            
            // LOGIN
            if (msg.type === 'login') {
                nickname = msg.myName;
                clients.set(nickname, ws);
                ws.nickname = nickname;
                console.log(`[✓] User "${nickname}" logged in. Total users: ${clients.size}`);
                
                ws.send(JSON.stringify({ type: 'welcome', myName: nickname }));
                broadcastUserList();
                return;
            }
            
            // MESSAGE - САМОЕ ВАЖНОЕ
            if (msg.type === 'message') {
                console.log(`[MSG] Received from "${nickname}": data="${msg.data}", to="${msg.to}"`);
                
                if (!msg.to) {
                    console.log(`[✗] Message has no "to" field`);
                    return;
                }
                if (!msg.data) {
                    console.log(`[✗] Message has no "data" field`);
                    return;
                }
                
                // Формируем ответ с ЯВНЫМИ ключами
                const response = {
                    type: 'message',
                    from: nickname,
                    data: msg.data
                };
                console.log(`[MSG] Forwarding payload:`, JSON.stringify(response));
                
                const target = clients.get(msg.to);
                if (target && target.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify(response));
                    console.log(`[✓] Message delivered to "${msg.to}"`);
                } else {
                    console.log(`[✗] User "${msg.to}" not found or offline`);
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        data: `User "${msg.to}" is offline` 
                    }));
                }
                return;
            }
            
            // userList запрос
            if (msg.type === 'getUserList') {
                broadcastUserList();
                return;
            }
            
        } catch (e) {
            console.error(`[✗] Parse error:`, e.message);
        }
    });
    
    ws.on('close', () => {
        if (nickname) {
            console.log(`[✗] User "${nickname}" disconnected`);
            clients.delete(nickname);
            broadcastUserList();
        }
    });
    
    ws.on('error', (e) => console.error(`[✗] WS error:`, e.message));
});

function broadcastUserList() {
    const users = Array.from(clients.keys());
    const msg = JSON.stringify({ type: 'userList', users });
    clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
    console.log(`[LIST] Broadcast: ${users.join(', ')}`);
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server listening on port ${PORT}`);
});
