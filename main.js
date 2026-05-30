// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

// --- ユーティリティ：日本語正規化（濁点除去・小文字→大文字・長音統一） ---
const smallToLarge = {
  "ぁ":"あ","ぃ":"い","ぅ":"う","ぇ":"え","ぉ":"お",
  "ゃ":"や","ゅ":"ゆ","ょ":"よ","っ":"つ"
};
const dakutenMap = {
  "が":"か","ぎ":"き","ぐ":"く","げ":"け","ご":"こ",
  "ざ":"さ","じ":"し","ず":"す","ぜ":"せ","ぞ":"そ",
  "だ":"た","ぢ":"ち","づ":"つ","で":"て","ど":"と",
  "ば":"は","び":"ひ","ぶ":"ふ","べ":"へ","ぼ":"ほ",
  "ぱ":"は","ぴ":"ひ","ぷ":"ふ","ぺ":"へ","ぽ":"ほ"
};

function normalizeJapanese(s){
  if(!s) return "";
  s = s.normalize('NFKC').toLowerCase();
  let out = "";
  for(const ch of s){
    if(smallToLarge[ch]) out += smallToLarge[ch];
    else if(dakutenMap[ch]) out += dakutenMap[ch];
    else if(ch === "ー" || ch === "ｰ") out += "ー";
    else if(ch.match(/[ぁ-んァ-ン一-龥a-zA-Z]/)) out += ch;
  }
  return out;
}

// --- グローバル状態 ---
let me = { uid: null, name: null };
let currentRoom = null;
let roomRef = null;
let isHost = false;
let wordInputState = {};
let gameStatus = {};
let players = {};
let boards = {};
const kanaTable = [
  'わ','ら','や','ま','は','な','た','さ','か','あ',
  'を','り','','み','ひ','に','ち','し','き','い',
  'ん','る','ゆ','む','ふ','ぬ','つ','す','く','う',
  'ー','れ','','め','へ','ね','て','せ','け','え',
  '','ろ','よ','も','ほ','の','と','そ','こ','お'
];

// --- DOM ---
const nameInput = document.getElementById('nameInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const joinRoomId = document.getElementById('joinRoomId');
const roomLink = document.getElementById('roomLink');
const roomInfo = document.getElementById('roomInfo');
const roomNumber = document.getElementById('roomNumber');
const lobby = document.getElementById('lobby');
const game = document.getElementById('game');
const gamePhaseInfo = document.getElementById('gamePhaseInfo');
const playersDiv = document.getElementById('players');
const boardArea = document.getElementById('boardArea');
const wordInput = document.getElementById('wordInput');
const submitWord = document.getElementById('submitWord');
const turnInfo = document.getElementById('turnInfo');
const logDiv = document.getElementById('log');
const wordInputPhase = document.getElementById('wordInputPhase');
const startGameBtn = document.getElementById('startGameBtn');
const startBtn = document.getElementById('startBtn');
const controls = document.getElementById('controls');
const resetGameBtn = document.getElementById('resetGameBtn');
const charSelector = document.getElementById('charSelector');
const kanaButtons = document.getElementById('kanaButtons');

// --- 認証（匿名） ---
auth.signInAnonymously().catch(console.error);
auth.onAuthStateChanged(user => {
  if(user){
    me.uid = user.uid;
    log(`認証完了`);
  }
});

// --- ルーム作成・参加 ---
createBtn.onclick = async () => {
  if (!me.uid) return alert("認証中です。少々お待ちください。");
  me.name = nameInput.value.trim() || "名無し";
  const roomId = Math.random().toString(36).slice(2, 9);
  const r = db.ref(`rooms/${roomId}`);
  await r.set({
    hostId: me.uid,
    createdAt: Date.now()
  });
  await r.child(`players/${me.uid}`).set({
    displayName: me.name,
    joinedAt: Date.now()
  });
  await r.child('game').set({
    state: 'waiting',
    hostId: me.uid
  });
  showRoom(roomId);
};

joinBtn.onclick = async () => {
  me.name = nameInput.value.trim() || "名無し";
  const id = joinRoomId.value.trim();
  if(!id) return alert("ルームIDを入力してください");
  const r = db.ref(`rooms/${id}`);
  const snap = await r.once('value');
  if(!snap.exists()) {
    return alert("ルームが見つかりません");
  }
  await r.child(`players/${me.uid}`).set({
    displayName: me.name,
    joinedAt: Date.now()
  });
  showRoom(id);
  log(`ルーム ${id} に参加しました`);
};

function showRoom(roomId){
  currentRoom = roomId;
  lobby.style.display = 'none';
  game.style.display = 'block';
  roomLink.textContent = `招待リンク: ${location.origin + location.pathname}?room=${roomId}`;
  roomInfo.style.display = 'block';
  roomNumber.textContent = roomId;
  roomRef = db.ref(`rooms/${roomId}`);
  generateKanaButtons();
  listenRoom(roomRef);
}

// --- ルーム監視 ---
function listenRoom(rRef){
  rRef.child('players').on('value', snap => {
    players = snap.val() || {};
    // ホスト判定の更新
    rRef.child('game/hostId').once('value', hSnap => {
      isHost = hSnap.val() === me.uid;
      checkReadyToStart();
    });
    renderGame(gameStatus); // プレイヤーの状態（脱落など）が変更された際にもゲーム表示を更新
    renderPlayers(players);
    checkReadyToStart();
    checkGameEnd(); // 脱落者が出た瞬間に勝敗判定を行う
  });
  
  rRef.child('boards').on('value', snap => {
    boards = snap.val() || {};
    renderBoards(boards);
  });
  
  rRef.child('game').on('value', snap => {
    gameStatus = snap.val() || {};
    renderGame(gameStatus);
    checkGameEnd();
  });
  
  rRef.child('wordInputState').on('value', snap => {
    wordInputState = snap.val() || {};
    renderPlayers(players);
    checkReadyToStart();
  });
}

// ゲーム開始準備チェック
function checkReadyToStart(){
  const playerIds = Object.keys(players);
  
  if (gameStatus.state === 'waiting') {
    if(playerIds.length >= 2 && isHost) {
      gamePhaseInfo.textContent = '人数がそろいました。ホストは開始ボタンを押してください。';
      startGameBtn.style.display = 'block';
      startBtn.textContent = '単語入力フェーズへ';
    } else {
      gamePhaseInfo.textContent = `参加待ち (${playerIds.length}人)...`;
      startGameBtn.style.display = 'none';
    }
  } else if (gameStatus.state === 'wordInput') {
    const readyCount = playerIds.filter(id => wordInputState[id] && wordInputState[id].ready).length;
    gamePhaseInfo.textContent = `単語入力中... (${readyCount}/${playerIds.length})`;
    startGameBtn.style.display = 'none';

    // 全員準備完了したらホストが対戦開始
    if (readyCount === playerIds.length && playerIds.length >= 2) {
      if (isHost) {
        gamePhaseInfo.textContent = '全員の単語が決まりました！';
        startGameBtn.style.display = 'block';
        startBtn.textContent = 'バトル開始！';
      } else {
        gamePhaseInfo.textContent = 'ホストがバトルを開始するのを待っています...';
      }
    }
  } else if (gameStatus.state === 'playing') {
    gamePhaseInfo.textContent = 'バトル進行中！';
    startGameBtn.style.display = 'none';
  }
}

// --- UI 描画 ---
function renderPlayers(p){
  playersDiv.innerHTML = '';
  for(const pid in p){
    const pl = p[pid];
    const el = document.createElement('div');
    el.className = 'player';
    const ready = wordInputState[pid] && wordInputState[pid].ready;
    const status = ready ? '✓準備完了' : '準備中...';
    el.innerHTML = `<strong>${pl.displayName}</strong><div>${pid === me.uid ? 'あなた' : pid.slice(0,5)}</div><div>${status}</div>`;
    playersDiv.appendChild(el);
  }
}

function renderBoards(b){
  boardArea.innerHTML = '';
  for(const pid in b){
    const board = b[pid];
    const wrap = document.createElement('div');
    const isMyBoard = pid === me.uid;
    wrap.className = `player ${isMyBoard ? 'my-board' : ''}`;
    wrap.innerHTML = `<div><strong>${isMyBoard ? '★ あなたの単語' : players[pid]?.displayName || pid.slice(0,5)}</strong></div>`;
    const boardDiv = document.createElement('div');
    boardDiv.className = 'board';
    
    const chars = board.chars || [];
    const revealed = board.revealed || [];
    
    for(let i = 0; i < chars.length; i++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      // 脱落したプレイヤーのボードは半透明にするなどの演出も可能
      if (players[pid] && players[pid].defeated) cell.style.opacity = '0.5';

      if(chars[i] === 'x' || chars[i] === undefined) {
        // 「×」は自分のボードのみ表示
        if(isMyBoard) {
          cell.textContent = '×';
          cell.classList.add('cross');
        }
        // 相手ボードの「×」は何も表示しない
      } else {
        if (isMyBoard) {
          // 自分のボードは常に文字を表示
          cell.textContent = chars[i];
          cell.classList.add(revealed[i] ? 'revealed' : 'my-hidden');
        } else {
          // 相手のボードは公開された時のみ表示
          cell.textContent = revealed[i] ? chars[i] : '';
          if(revealed[i]) cell.classList.add('revealed');
        }
      }
      boardDiv.appendChild(cell);
    }
    wrap.appendChild(boardDiv);
    boardArea.appendChild(wrap);
  }
}

function renderGame(g){
  if(!g || Object.keys(g).length === 0) return;
  
  if(g.state === 'waiting') {
    wordInputPhase.style.display = 'none';
    controls.style.display = 'none';
    resetGameBtn.style.display = 'none';
    turnInfo.innerHTML = ''; // メッセージをクリア
  }

  if(g.state === 'wordInput') {
    wordInputPhase.style.display = 'block';
    controls.style.display = 'none';
    resetGameBtn.style.display = 'none';
    turnInfo.innerHTML = ''; // メッセージをクリア
  } else if(g.state === 'playing') {
    wordInputPhase.style.display = 'none';
    controls.style.display = 'block';
    charSelector.style.display = 'block'; // 五十音表は常に表示

    const isMyTurn = g.currentTurnPlayerId === me.uid;
    const isMeDefeated = players[me.uid] && players[me.uid].defeated;
    charSelector.classList.toggle('not-my-turn', !isMyTurn);

    // 指示テキストの制御：自分の番かつ脱落していない場合のみ表示
    const charMsg = charSelector.querySelector('p');
    if (charMsg) charMsg.style.visibility = (isMyTurn && !isMeDefeated) ? 'visible' : 'hidden';

    resetGameBtn.style.display = 'none';
    
    updateKanaButtons(g.usedChars, isMyTurn, isMeDefeated);

    if (isMeDefeated) {
      turnInfo.innerHTML = '<div class="loser-msg">GAME OVER</div>';
      turnInfo.innerHTML += `<div style="margin-top:8px;">あなたは脱落しました。他のプレイヤーの対戦を見守りましょう。</div>`;
    } else {
      const playerName = players[g.currentTurnPlayerId] ? players[g.currentTurnPlayerId].displayName : '不明';
      const myTurnText = isMyTurn ? 'あなたの番' : `${playerName}の番`;
      turnInfo.textContent = `${myTurnText} (攻撃回数: ${g.attackCount || 0}/2)`;
    }
  } else if(g.state === 'ended') {
    wordInputPhase.style.display = 'none';
    controls.style.display = 'block';
    charSelector.style.display = 'block'; // 終了後も使用済み文字を確認できる
    charSelector.classList.add('not-my-turn');
    const charMsg = charSelector.querySelector('p');
    if (charMsg) charMsg.style.visibility = 'hidden';
    updateKanaButtons(g.usedChars, false, true); // 全ボタンを無効化

    if (g.winner === me.uid) {
      turnInfo.innerHTML = '<div class="winner-msg">YOU WIN!</div>';
    } else {
      turnInfo.innerHTML = '<div class="loser-msg">GAME OVER</div>';
    }
    const winnerName = players[g.winner] ? players[g.winner].displayName : '不明';
    turnInfo.innerHTML += `<div style="margin-top:8px;">勝者: ${winnerName}</div>`;
    
    // ホストのみリセットボタンを表示
    resetGameBtn.style.display = isHost ? 'inline-block' : 'none';
  }
}

function updateKanaButtons(usedChars = {}, isMyTurn = false, isMeDefeated = false) {
  const buttons = kanaButtons.querySelectorAll('button');
  buttons.forEach(btn => {
    const char = btn.textContent;
    if (char === '') return;
    const isUsed = !!usedChars[char];
    btn.classList.toggle('used', isUsed);
    
    // 使用済み、または自分の番でない、または脱落している場合はクリック不可
    btn.disabled = isUsed || !isMyTurn || isMeDefeated;
  });
}

// --- 単語登録 ---
submitWord.onclick = async () => {
  const raw = wordInput.value.trim();
  const norm = normalizeJapanese(raw);
  if(norm.length < 2 || norm.length > 7) return alert('2〜7文字で入力してください');
  
  const chars = norm.split('');
  while(chars.length < 7) chars.push('x');
  const revealed = new Array(chars.length).fill(false);
  
  await roomRef.child(`boards/${me.uid}`).set({ chars, revealed });
  await roomRef.child(`wordInputState/${me.uid}`).set({ ready: true, word: norm });
  
  wordInput.value = '';
  log(`単語登録: ${norm}`);
};

// --- ゲーム開始 ---
startBtn.onclick = async () => {
  if (gameStatus.state === 'waiting') {
    // 待機中から単語入力フェーズへ遷移
    await roomRef.child('game/state').set('wordInput');
    return;
  }

  if (gameStatus.state === 'wordInput') {
    // 単語入力完了後、実際のバトルを開始
    const playerIds = Object.keys(players);
    const hostIdx = Math.floor(Math.random() * playerIds.length);
    const firstPlayerId = playerIds[hostIdx];
    
    await roomRef.child('game').update({
      state: 'playing',
      currentTurnPlayerId: firstPlayerId,
      attackCount: 0,
      winner: null,
      usedChars: {}
    });
    
    log(`ゲーム開始！最初の親: ${players[firstPlayerId].displayName}`);
  }
};

// --- ゲームリセット（もう一度遊ぶ） ---
resetGameBtn.onclick = async () => {
  if (!isHost) return;
  
  const updates = {};
  updates['game'] = {
    state: 'waiting',
    hostId: me.uid
  };
  updates['boards'] = null;
  updates['wordInputState'] = null;
  
  // 全プレイヤーの脱落フラグをリセット
  for (const pid in players) {
    updates[`players/${pid}/defeated`] = null;
  }
  
  await roomRef.update(updates);
  log("ゲームをリセットしました。");
};

// --- 文字指定（攻撃） ---
function generateKanaButtons() {
  kanaButtons.innerHTML = '';
  kanaTable.forEach(ch => {
    const btn = document.createElement('button');
    btn.textContent = ch;
    if (ch === '') {
      btn.style.visibility = 'hidden';
    } else {
      btn.onclick = () => attackWithChar(ch);
    }
    kanaButtons.appendChild(btn);
  });
}

async function attackWithChar(char) {
  // 最新のgameStatusを取得
  const gameSnap = await roomRef.child('game').once('value');
  const currentGame = gameSnap.val() || {};
  
  if(currentGame.usedChars && currentGame.usedChars[char]) return;
  if(currentGame.currentTurnPlayerId !== me.uid) {
    alert('あなたの番ではありません');
    return;
  }

  // 使用済み文字として登録
  await roomRef.child(`game/usedChars/${char}`).set(true);

  let anyHit = false;
  const currentPlayersSnap = await roomRef.child('players').once('value');
  const currentPlayers = currentPlayersSnap.val() || {};

  // 各プレイヤーの文字をチェック
  let otherHit = false; // 自分以外のプレイヤーへのヒット
  
  for(const pid in boards) {
    if(currentPlayers[pid].defeated) continue;

    const board = boards[pid];
    const chars = board.chars || [];
    const revealed = board.revealed || [];
    let hitOnThisBoard = false;

    for(let i = 0; i < chars.length; i++) {
      if(chars[i] === char && !revealed[i]) {
        revealed[i] = true;
        hitOnThisBoard = true;
        if (pid !== me.uid) otherHit = true;
        anyHit = true;
      }
    }

    if (hitOnThisBoard) {
      await roomRef.child(`boards/${pid}`).set({ chars, revealed });
      if (pid === me.uid) {
        log(`自爆！自分の「${char}」を公開しました`);
      } else {
        log(`${players[pid].displayName}の「${char}」を公開！`);
      }

      // 脱落判定：×以外のすべての文字がオープンになったか
      const isDefeated = revealed.every((r, idx) => r || chars[idx] === 'x');
      if(isDefeated) {
        log(`${players[pid].displayName}が脱落しました`);
        await roomRef.child(`players/${pid}/defeated`).set(true);
      }
    }
  }
  
  // 自爆のみの場合は連続攻撃不可
  anyHit = otherHit;

  // 勝敗判定を最初に行う
  const latestPlayersSnapForEnd = await roomRef.child('players').once('value');
  const latestPlayersForEnd = latestPlayersSnapForEnd.val() || {};
  const activePlayerIdsForEnd = Object.keys(latestPlayersForEnd).filter(id => !latestPlayersForEnd[id].defeated);

  if (activePlayerIdsForEnd.length <= 1) {
    // 勝者が決まった場合はターン交代処理を行わずに終了
    const winnerId = activePlayerIdsForEnd[0] || me.uid; // 万が一全員脱落した場合は最後の攻撃者を仮の勝者とする
    await roomRef.child('game').update({ state: 'ended', winner: winnerId });
    return;
  }

  // 最新のattackCountを取得
  const attackCountSnap = await roomRef.child('game/attackCount').once('value');
  const attackCount = attackCountSnap.exists() ? attackCountSnap.val() : 0;
  
  // 自分が脱落したか確認
  const myStatusSnap = await roomRef.child(`players/${me.uid}/defeated`).once('value');
  const isMeDefeated = myStatusSnap.val() === true;

  // ターン判定：他プレイヤーへのヒットがない場合は連続攻撃不可
  if(!anyHit || attackCount >= 1 || isMeDefeated) {
    // 脱落判定後に最新のプレイヤー情報を取得（重要：脱落状態が反映されるため）
    const latestPlayersSnap = await roomRef.child('players').once('value');
    const latestPlayers = latestPlayersSnap.val() || {};
    const activePlayerIds = Object.keys(latestPlayers).filter(id => !latestPlayers[id].defeated);
    // 攻撃者が脱落している可能性を考慮してインデックスを探す
    const attackerIdxInActive = activePlayerIds.indexOf(me.uid);
    
    // 次のプレイヤーを決定（自分が脱落した場合はインデックスが-1になるので注意）
    const nextIdx = attackerIdxInActive === -1 ? 0 : (attackerIdxInActive + 1) % activePlayerIds.length;
    const nextId = activePlayerIds[nextIdx];

    await roomRef.child('game').update({
      state: 'playing',
      currentTurnPlayerId: nextId,
      attackCount: 0
    });
    charSelector.style.display = 'none';
  } else {
    // 他プレイヤーへのヒットがあれば連続攻撃可能
    await roomRef.child('game/attackCount').set(attackCount + 1);
    log(`連続攻撃！もう1回指定できます`);
    charSelector.style.display = 'block';
    return;
  }
}

// --- ゲーム終了判定 ---
async function checkGameEnd() {
  if(gameStatus.state !== 'playing' && gameStatus.state !== 'ended') return;
  
  const playerIds = Object.keys(players);
  if (playerIds.length < 2) return;

  const activePlayerIds = playerIds.filter(id => !players[id].defeated);
  
  // 生き残ったプレイヤーが1人のみ = 勝者確定
  if(activePlayerIds.length === 1) {
    const winnerId = activePlayerIds[0];
    await roomRef.child('game').update({
      state: 'ended',
      winner: winnerId
    });
    log(`${players[winnerId].displayName}の勝利です！`);
  }
}

// --- ログ表示 ---
function log(msg){
  const t = new Date().toLocaleTimeString();
  logDiv.textContent = `[${t}] ${msg}\n` + logDiv.textContent;
}

// --- URL自動参加 ---
window.addEventListener('load', () => {
  const params = new URLSearchParams(location.search);
  const r = params.get('room');
  if(r) joinRoomId.value = r;
});
