(function (global) {
  const firebaseConfig = {
    apiKey: "AIzaSyBeMMbLeOP7lcOBBLq0Xaea-ARBsT3X2Yw",
    authDomain: "aiueo-7fcc5.firebaseapp.com",
    databaseURL: "https://aiueo-7fcc5-default-rtdb.firebaseio.com",
    projectId: "aiueo-7fcc5",
    storageBucket: "aiueo-7fcc5.firebasestorage.app",
    messagingSenderId: "676162956272",
    appId: "1:676162956272:web:928dc9f2af9359cf06cb35",
    measurementId: "G-5LWV6K3TWQ"
  };

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  const auth = firebase.auth();
  const db = firebase.database();

  function initializeAuth() {
    auth.signInAnonymously()
      .catch(err => {
        console.error('認証エラー:', err);
        alert('認証に失敗しました。ページを再読み込みしてください。');
      });

    auth.onAuthStateChanged(user => {
      if (user) {
        me.uid = user.uid;
        global.aiueoUi?.log(`認証完了: ${user.uid.substring(0, 8)}...`);
      } else {
        console.warn('ユーザー認証が失敗しました');
      }
    });
  }

  async function createRoom() {
    try {
      if (!me.uid) {
        alert('認証中です。少々お待ちください。');
        return;
      }

      const name = nameInput.value.trim();
      if (!name) {
        alert('表示名を入力してください');
        nameInput.focus();
        return;
      }
      me.name = name;

      const roomId = Math.random().toString(36).slice(2, 9);
      const r = db.ref(`rooms/${roomId}`);

      await r.set({
        hostId: me.uid,
        createdAt: Date.now(),
        game: {
          state: 'waiting',
          hostId: me.uid
        },
        players: {
          [me.uid]: {
            displayName: me.name,
            joinedAt: Date.now()
          }
        }
      });

      showRoom(roomId);
      global.aiueoUi?.log(`ルーム作成完了: ${roomId}`);
    } catch (err) {
      console.error('ルーム作成エラー:', err);
      alert('ルーム作成に失敗しました。もう一度お試しください。');
    }
  }

  async function joinRoom() {
    try {
      const name = nameInput.value.trim();
      if (!name) {
        alert('表示名を入力してください');
        nameInput.focus();
        return;
      }
      me.name = name;

      const id = joinRoomId.value.trim();
      if (!id) {
        alert('ルームIDを入力してください');
        return;
      }

      const r = db.ref(`rooms/${id}`);
      const snap = await r.once('value');
      if (!snap.exists()) {
        alert('ルームが見つかりません。ルームIDを確認してください。');
        return;
      }

      const data = snap.val();
      const gameState = (data.game && data.game.state) || 'waiting';

      if (gameState === 'playing' || gameState === 'ended') {
        global.aiueoUi?.log('ゲームが進行中のため、観戦モードで参加しました');
      } else {
        await r.child(`players/${me.uid}`).set({
          displayName: me.name,
          joinedAt: Date.now()
        });
        global.aiueoUi?.log(`ルーム ${id} に参加しました`);
      }

      showRoom(id);
    } catch (err) {
      console.error('ルーム参加エラー:', err);
      alert('ルーム参加に失敗しました。もう一度お試しください。');
    }
  }

  async function leaveRoom() {
    if (!currentRoom || !roomRef) return;
    if (!confirm('ルームを退室しますか？')) return;

    try {
      const snap = await roomRef.once('value');
      const data = snap.val();
      if (!data) return;

      const updates = {};
      updates[`players/${me.uid}`] = null;
      updates[`wordInputState/${me.uid}`] = null;
      updates[`boards/${me.uid}`] = null;

      const otherIds = Object.keys(data.players || {}).filter(id => id !== me.uid);
      if (data.game?.hostId === me.uid && otherIds.length > 0) {
        const nextHostId = otherIds[0];
        updates.hostId = nextHostId;
        updates['game/hostId'] = nextHostId;
      }

      roomRef.child(`players/${me.uid}`).onDisconnect().cancel();
      await roomRef.update(updates);

      roomRef.off();
      currentRoom = null;
      roomRef = null;
      isHost = false;

      game.style.display = 'none';
      lobby.style.display = 'block';
      roomInfo.style.display = 'none';
      logDiv.textContent = '';

      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.pushState({}, '', url);
      global.aiueoUi?.log('ルームを退室しました');
    } catch (err) {
      console.error('退室エラー:', err);
    }
  }

  function showRoom(roomId) {
    currentRoom = roomId;
    lobby.style.display = 'none';
    game.style.display = 'block';
    roomLink.textContent = `招待リンク: ${location.origin + location.pathname}?room=${roomId}`;
    roomInfo.style.display = 'block';
    roomNumber.textContent = roomId;
    roomRef = db.ref(`rooms/${roomId}`);
    global.aiueoUi?.generateKanaButtons();
    listenRoom(roomRef);
  }

  function listenRoom(rRef) {
    rRef.on('value', snap => {
      const data = snap.val() || {};

      players = data.players || {};
      boards = data.boards || {};
      wordInputState = data.wordInputState || {};
      gameStatus = data.game || {};

      isHost = (data.hostId === me.uid || (data.game && data.game.hostId === me.uid));

      if (gameStatus.lastHit && gameStatus.lastHit.ts > lastEffectTs) {
        const lastHit = gameStatus.lastHit;
        lastEffectTs = lastHit.ts;

        const victimList = Array.isArray(lastHit.victimIds) ? lastHit.victimIds : Object.values(lastHit.victimIds || {});
        const isMeVictim = me.uid && victimList.includes(me.uid);

        if (isMeVictim) {
          global.aiueoUi?.showHitEffect(lastHit.char, 'damage');
        } else if (victimList.length > 0) {
          global.aiueoUi?.showHitEffect(lastHit.char, 'success');
        } else {
          global.aiueoUi?.showHitEffect(lastHit.char, 'miss');
        }
      }

      global.aiueoUi?.renderBoards(boards);
      global.aiueoUi?.renderGame(gameStatus);
      global.aiueoUi?.checkReadyToStart();
      checkGameEnd();
    });

    setupOnDisconnect(rRef);
  }

  function setupOnDisconnect(rRef) {
    if (!me.uid) return;
  }

  global.aiueoFirebase = {
    auth,
    db,
    initializeAuth,
    createRoom,
    joinRoom,
    leaveRoom,
    showRoom,
    listenRoom,
    setupOnDisconnect
  };
})(window);
