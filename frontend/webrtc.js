let localStream = null;
let peerConnection = null;
let currentCallTarget = null;
let isVideoCall = false;
let groupCallPeers = {};
let currentRoomId = null;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// ===== Обычный звонок 1-на-1 =====
async function startCall(type) {
    isVideoCall = type === 'video';
    currentCallTarget = currentFriendId;
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: isVideoCall
        });
        
        document.getElementById('local-video').srcObject = localStream;
        showCallScreen();
        
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        peerConnection.ontrack = (event) => {
            const remoteVideo = document.createElement('video');
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            remoteVideo.srcObject = event.streams[0];
            document.getElementById('remote-videos').appendChild(remoteVideo);
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                ws.send(JSON.stringify({
                    type: 'ice_candidate',
                    target_id: currentCallTarget,
                    candidate: event.candidate
                }));
            }
        };
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        ws.send(JSON.stringify({
            type: 'call_offer',
            target_id: currentCallTarget,
            offer: offer,
            call_type: type
        }));
        
        document.getElementById('call-status').textContent = 'Звонок...';
    } catch (e) {
        alert('Ошибка доступа к камере/микрофону');
        console.error(e);
    }
}

function showIncomingCall(data) {
    currentCallTarget = data.from_id;
    isVideoCall = data.call_type === 'video';
    
    document.getElementById('incoming-call-text').textContent = `Входящий звонок...`;
    document.getElementById('incoming-call-modal').classList.remove('hidden');
    
    window.pendingOffer = data.offer;
}

async function acceptCall() {
    document.getElementById('incoming-call-modal').classList.add('hidden');
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: isVideoCall
        });
        
        document.getElementById('local-video').srcObject = localStream;
        showCallScreen();
        
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        peerConnection.ontrack = (event) => {
            const remoteVideo = document.createElement('video');
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            remoteVideo.srcObject = event.streams[0];
            document.getElementById('remote-videos').appendChild(remoteVideo);
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                ws.send(JSON.stringify({
                    type: 'ice_candidate',
                    target_id: currentCallTarget,
                    candidate: event.candidate
                }));
            }
        };
        
        await peerConnection.setRemoteDescription(window.pendingOffer);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        ws.send(JSON.stringify({
            type: 'call_answer',
            target_id: currentCallTarget,
            answer: answer
        }));
        
        document.getElementById('call-status').textContent = 'Разговор';
    } catch (e) {
        console.error(e);
    }
}

function rejectCall() {
    document.getElementById('incoming-call-modal').classList.add('hidden');
    ws.send(JSON.stringify({
        type: 'call_reject',
        target_id: currentCallTarget
    }));
    currentCallTarget = null;
}

async function handleCallAnswer(data) {
    await peerConnection.setRemoteDescription(data.answer);
    document.getElementById('call-status').textContent = 'Разговор';
}

async function handleIceCandidate(data) {
    if (peerConnection) {
        await peerConnection.addIceCandidate(data.candidate);
    }
}

function endCall() {
    ws.send(JSON.stringify({
        type: 'call_end',
        target_id: currentCallTarget
    }));
    endCallUI();
}

function endCallUI() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    document.getElementById('remote-videos').innerHTML = '';
    document.getElementById('call-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
    
    currentCallTarget = null;
}

function showCallScreen() {
    document.getElementById('main-screen').classList.remove('active');
    document.getElementById('call-screen').classList.add('active');
}

function toggleMute() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        audioTrack.enabled = !audioTrack.enabled;
    }
}

function toggleVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) videoTrack.enabled = !videoTrack.enabled;
    }
}

// ===== Групповые звонки =====
function createGroupCall() {
    currentRoomId = 'room_' + Math.random().toString(36).substr(2, 9);
    alert(`ID вашей комнаты: ${currentRoomId}\nОтправьте его друзьям!`);
    joinGroupCall(currentRoomId);
}

function joinGroupCallById() {
    const roomId = document.getElementById('join-room-id').value;
    if (roomId) {
        currentRoomId = roomId;
        joinGroupCall(roomId);
    }
}

async function joinGroupCall(roomId) {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: true
        });
        
        document.getElementById('local-video').srcObject = localStream;
        showCallScreen();
        
        ws.send(JSON.stringify({
            type: 'join_group_call',
            room_id: roomId
        }));
        
        document.getElementById('call-status').textContent = `Групповой звонок: ${roomId}`;
    } catch (e) {
        alert('Ошибка доступа к камере/микрофону');
    }
}

async function handleUserJoinedGroupCall(data) {
    const targetId = data.user_id;
    
    const pc = new RTCPeerConnection(rtcConfig);
    groupCallPeers[targetId] = pc;
    
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    
    pc.ontrack = (event) => {
        addRemoteVideoGroup(targetId, event.streams[0]);
    };
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: 'group_ice_candidate',
                target_id: targetId,
                candidate: event.candidate
            }));
        }
    };
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    ws.send(JSON.stringify({
        type: 'group_call_offer',
        target_id: targetId,
        offer: offer,
        room_id: currentRoomId
    }));
}

async function handleGroupCallOffer(data) {
    const fromId = data.from_id;
    
    const pc = new RTCPeerConnection(rtcConfig);
    groupCallPeers[fromId] = pc;
    
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    
    pc.ontrack = (event) => {
        addRemoteVideoGroup(fromId, event.streams[0]);
    };
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: 'group_ice_candidate',
                target_id: fromId,
                candidate: event.candidate
            }));
        }
    };
    
    await pc.setRemoteDescription(data.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    ws.send(JSON.stringify({
        type: 'group_call_answer',
        target_id: fromId,
        answer: answer
    }));
}

async function handleGroupCallAnswer(data) {
    const pc = groupCallPeers[data.from_id];
    if (pc) {
        await pc.setRemoteDescription(data.answer);
    }
}

async function handleGroupIceCandidate(data) {
    const pc = groupCallPeers[data.from_id];
    if (pc) {
        await pc.addIceCandidate(data.candidate);
    }
}

function addRemoteVideoGroup(userId, stream) {
    let video = document.getElementById(`remote-video-${userId}`);
    if (!video) {
        video = document.createElement('video');
        video.id = `remote-video-${userId}`;
        video.autoplay = true;
        video.playsInline = true;
        document.getElementById('remote-videos').appendChild(video);
    }
    video.srcObject = stream;
}

function handleUserLeftGroupCall(data) {
    const userId = data.user_id;
    const video = document.getElementById(`remote-video-${userId}`);
    if (video) video.remove();
    
    if (groupCallPeers[userId]) {
        groupCallPeers[userId].close();
        delete groupCallPeers[userId];
    }
}