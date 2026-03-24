const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map();

app.get('/', (req, res) => {
    res.send('✅ WebSocket сервер работает!');
});

wss.on('connection', (ws) => {
    console.log('Новое подключение');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Получено:', data.type);
            
            switch (data.type) {
                case 'register':
                    clients.set(ws, {
                        userId: data.userId,
                        userName: data.userName
                    });
                    console.log(`Зарегистрирован: ${data.userName} (${data.userId})`);
                    break;
                    
                case 'call':
                    const targetClient = findClientByUserId(data.targetUserId);
                    if (targetClient && targetClient.readyState === WebSocket.OPEN) {
                        targetClient.send(JSON.stringify({
                            type: 'incoming_call',
                            fromUserId: data.fromUserId,
                            fromUserName: data.fromUserName,
                            callType: data.callType
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'call_failed',
                            reason: 'user_offline'
                        }));
                    }
                    break;
                    
                case 'call_accepted':
                case 'call_rejected':
                case 'offer':
                case 'answer':
                case 'ice_candidate':
                case 'end_call':
                    const peerClient = findClientByUserId(data.targetUserId);
                    if (peerClient && peerClient.readyState === WebSocket.OPEN) {
                        peerClient.send(JSON.stringify({
                            type: data.type,
                            fromUserId: data.fromUserId,
                            data: data.data
                        }));
                    }
                    break;
            }
        } catch (err) {
            console.error('Ошибка:', err);
        }
    });
    
    ws.on('close', () => {
        clients.delete(ws);
        console.log('Пользователь отключился');
    });
});

function findClientByUserId(userId) {
    for (let [ws, info] of clients) {
        if (info.userId === userId) {
            return ws;
        }
    }
    return null;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
