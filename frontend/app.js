const API_URL = window.location.origin;
let currentUser = null;
let currentFriendId = null;
let ws = null;

// ===== Инициализация =====
window.onload = () => {
    const token = localStorage.getItem('access_token');
    if (token) {
        checkAuth();
    }
};

async function checkAuth() {
    try {
        const response = await fetch(`${API_URL}/me`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
        });
        if (response.ok) {
            currentUser = await response.json();
            showMainScreen();
        } else {
            localStorage.removeItem('access_token');
        }
    } catch (e) {
        console.error(e);
    }
}

// ===== Auth functions =====
function showRegister() {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
}

function showLogin() {
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
}

async function register() {
    const username = document.getElementById('reg-username').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;

    try {
        const response = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });

        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('access_token', data.access_token);
            currentUser = { id: data.user_id, username: data.username };
            showMainScreen();
        } else {
            const error = await response.json();
            alert(error.detail);
        }
    } catch (e) {
        alert('Ошибка регистрации');
    }
}

async function login() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    const formData = new FormData();
    formData.append('username', username);
    formData.append('password', password);

    try {
        const response = await fetch(`${API_URL}/token`, {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('access_token', data.access_token);
            currentUser = { id: data.user_id, username: data.username };
            showMainScreen();
        } else {
            alert('Неверный логин или пароль');
        }
    } catch (e) {
        alert('Ошибка входа');
    }
}

function logout() {
    localStorage.removeItem('access_token');
    if (ws) ws.close();
    location.reload();
}

// ===== Main screen =====
function showMainScreen() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
    document.getElementById('current-username').textContent = currentUser.username;
    
    connectWebSocket();
    loadFriends();
    loadFriendRequests();
}

function connectWebSocket() {
    ws = new WebSocket(`ws://${window.location.host}/ws/${currentUser.id}`);
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
    
    ws.onclose = () => {
        setTimeout(connectWebSocket, 3000);
    };
}

function handleWebSocketMessage(data) {
    switch(data.type) {
        case 'new_message':
            if (data.sender_id === currentFriendId) {
                displayMessage(data, false);
            }
            break;
        case 'call_offer':
            showIncomingCall(data);
            break;
        case 'call_answer':
            handleCallAnswer(data);
            break;
        case 'ice_candidate':
            handleIceCandidate(data);
            break;
        case 'call_reject':
            alert('Звонок отклонён');
            endCallUI();
            break;
        case 'call_end':
            endCallUI();
            break;
        case 'user_joined_call':
            handleUserJoinedGroupCall(data);
            break;
        case 'user_left_call':
            handleUserLeftGroupCall(data);
            break;
        case 'group_call_offer':
            handleGroupCallOffer(data);
            break;
        case 'group_call_answer':
            handleGroupCallAnswer(data);
            break;
        case 'group_ice_candidate':
            handleGroupIceCandidate(data);
            break;
    }
}

// ===== Tabs =====
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    event.target.classList.add('active');
    document.getElementById(`${tabName}-tab`).classList.add('active');
}

// ===== Friends =====
async function loadFriends() {
    const response = await fetch(`${API_URL}/friends`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
    });
    const friends = await response.json();
    
    const listEl = document.getElementById('friends-list');
    listEl.innerHTML = '';
    
    friends.forEach(friend => {
        const div = document.createElement('div');
        div.className = 'friend-item';
        div.onclick = () => openChat(friend.id, friend.username);
        div.innerHTML = `
            <span>${friend.username}</span>
            ${friend.is_online ? '<span class="online-dot"></span>' : ''}
        `;
        listEl.appendChild(div);
    });
}

async function loadFriendRequests() {
    const response = await fetch(`${API_URL}/friends/requests`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
    });
    const requests = await response.json();
    
    const listEl = document.getElementById('requests-list');
    listEl.innerHTML = '';
    
    requests.forEach(req => {
        const div = document.createElement('div');
        div.className = 'request-item';
        div.innerHTML = `
            <span>${req.from_username}</span>
            <button onclick="acceptFriendRequest(${req.id})">✅</button>
        `;
        listEl.appendChild(div);
    });
}

async function sendFriendRequest() {
    const username = document.getElementById('add-friend-username').value;
    
    try {
        const response = await fetch(`${API_URL}/friends/request`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('access_token')}`
            },
            body: JSON.stringify({ to_username: username })
        });
        
        if (response.ok) {
            alert('Заявка отправлена!');
            document.getElementById('add-friend-username').value = '';
        } else {
            const error = await response.json();
            alert(error.detail);
        }
    } catch (e) {
        alert('Ошибка отправки заявки');
    }
}

async function acceptFriendRequest(requestId) {
    const response = await fetch(`${API_URL}/friends/accept/${requestId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
    });
    
    if (response.ok) {
        loadFriends();
        loadFriendRequests();
    }
}

// ===== Chat =====
async function openChat(friendId, friendUsername) {
    currentFriendId = friendId;
    document.getElementById('no-chat-selected').classList.add('hidden');
    document.getElementById('chat-container').classList.remove('hidden');
    document.getElementById('chat-friend-name').textContent = friendUsername;
    
    await loadMessages(friendId);
}

async function loadMessages(friendId) {
    const response = await fetch(`${API_URL}/messages/${friendId}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
    });
    const messages = await response.json();
    
    const container = document.getElementById('messages-container');
    container.innerHTML = '';
    
    messages.forEach(msg => {
        displayMessage(msg, msg.sender_id === currentUser.id);
    });
}

function displayMessage(msg, isOwn) {
    const container = document.getElementById('messages-container');
    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : 'other'}`;
    
    if (msg.message_type === 'image') {
        div.innerHTML = `<img src="${msg.file_url}" alt="image">`;
    } else {
        div.textContent = msg.content;
    }
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    
    if (!content || !currentFriendId) return;
    
    ws.send(JSON.stringify({
        type: 'chat_message',
        receiver_id: currentFriendId,
        content: content,
        message_type: 'text'
    }));
    
    displayMessage({ content, sender_id: currentUser.id, message_type: 'text' }, true);
    input.value = '';
}

async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file || !currentFriendId) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch(`${API_URL}/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` },
            body: formData
        });
        
        const data = await response.json();
        
        ws.send(JSON.stringify({
            type: 'chat_message',
            receiver_id: currentFriendId,
            content: file.name,
            message_type: 'image',
            file_url: data.file_url
        }));
        
        displayMessage({ 
            file_url: data.file_url, 
            sender_id: currentUser.id, 
            message_type: 'image' 
        }, true);
    } catch (e) {
        alert('Ошибка загрузки файла');
    }
}