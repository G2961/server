const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

const clients = new Map();

console.log('🚀 Signal server starting...');

function broadcastUserList() {
    const users = Array.from(clients.keys());
    const message = JSON.stringify({ type: 'userList', users });
    
    console.log('📤 Broadcasting userList:', users);
    
    clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
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
    const clientIp = req.socket.remoteAddress || 'unknown';
    console.log(`🔗 New connection from ${clientIp}`);
    
    let nickname = null;
    
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            console.log(`📥 Received: ${msg.type} from ${msg.myName || msg.from || 'unknown'}`);
            
            if (msg.type === 'login') {
                nickname = msg.myName;
                clients.set(nickname, ws);
                ws.nickname = nickname;
                
                console.log(`✅ User "${nickname}" logged in`);
                
                ws.send(JSON.stringify({ 
                    type: 'welcome', 
                    myName: nickname
                }));
                
                broadcastUserList();
                return;
            }
            
            if (msg.type === 'message') {
                if (!msg.to) return;
                
                const success = sendToUser(msg.to, data);
                if (!success) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        data: `Пользователь "${msg.to}" не в сети` 
                    }));
                }
                return;
            }
            
            if (['offer', 'answer', 'candidate', 'reject'].includes(msg.type)) {
                if (!msg.to) return;
                
                const success = sendToUser(msg.to, JSON.stringify({
                    ...msg,
                    from: nickname
                }));
                
                if (!success) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        data: `Пользователь "${msg.to}" не в сети` 
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
    console.log(`✅ Server listening on port ${PORT}`);
});

// Keep-alive ping
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    });
}, 30000);
