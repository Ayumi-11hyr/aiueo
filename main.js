// ================== Firebase 初期化 ==================
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

// ================== 日本語正規化ユーティリティ ==================
// 入力された日本語を統一形式に変換：濁点・半濁点を無視、小文字→大文字に統一
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

// 日本語テキストを正規化：小文字→大文字、濁点・半濁点→清音、ひらがなのみを抽出
function normalizeJapanese(s){
  if(!s) return "";
  s = s.normalize('NFKC');
  let out = "";
  for(const ch of s){
    if(smallToLarge[ch]) out += smallToLarge[ch];
    else if(dakutenMap[ch]) out += dakutenMap[ch];
    else if(ch === "ー" || ch === "ｰ") out += "ー";
    else if(ch.match(/[ぁ-ん]/)) out += ch;
  }
  return out;
}

// ================== グローバル状態管理 ==================
// ゲームの全体的な状態をグローバル変数で保持（各リスナーで即座に参照可能）
let me = { uid: null, name: null };
let currentRoom = null;
let roomRef = null;
let isHost = false;
let wordInputState = {};
let gameStatus = {};
let players = {};
let boards = {};
let timerInterval = null; // ターンの制限時間用タイマー
const kanaTable = [
  'わ','ら','や','ま','は','な','た','さ','か','あ',
  'を','り','','み','ひ','に','ち','し','き','い',
  'ん','る','ゆ','む','ふ','ぬ','つ','す','く','う',
  'ー','れ','','め','へ','ね','て','せ','け','え',
  '','ろ','よ','も','ほ','の','と','そ','こ','お'
];

// ================== DOM要素の取得 ==================
const nameInput = document.getElementById('nameInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const joinRoomId = document.getElementById('joinRoomId');
const roomLink = document.getElementById('roomLink');
const roomInfo = document.getElementById('roomInfo');
const copyRoomIdBtn = document.getElementById('copyRoomIdBtn');
const roomNumber = document.getElementById('roomNumber');
const lobby = document.getElementById('lobby');
const game = document.getElementById('game');
const gamePhaseInfo = document.getElementById('gamePhaseInfo');
const playersDiv = document.getElementById('players');
const boardArea = document.getElementById('boardArea');
const wordInput = document.getElementById('wordInput');
const submitWord = document.getElementById('submitWord');
const turnInfo = document.getElementById('turnInfo');
const timerDisplay = document.getElementById('timerDisplay');
const themeArea = document.getElementById('themeArea');
const themeDisplay = document.getElementById('themeDisplay');
const themeInput = document.getElementById('themeInput');
const logDiv = document.getElementById('log');
const wordInputPhase = document.getElementById('wordInputPhase');
const startGameBtn = document.getElementById('startGameBtn');
const startBtn = document.getElementById('startBtn');
const controls = document.getElementById('controls');
const resetGameBtn = document.getElementById('resetGameBtn');
const charSelector = document.getElementById('charSelector');
const kanaButtons = document.getElementById('kanaButtons');

// ================== ヘルパー関数 ==================
// プレイヤーIDを非公開にし、表示名を整形して返す（自分やホストの情報を付加）
function getDisplayName(pid) {
  if (!pid || !players[pid]) return '不明';
  const name = players[pid].displayName || '名無し';
  let displayName = pid === me.uid ? `★${name}（あなた）` : name;
  if (gameStatus && pid === gameStatus.hostId) {
    displayName += ' [ホスト]';
  }
  return displayName;
}

// ひらがなと長音記号のみを受け付ける
wordInput.oninput = () => {
  wordInput.value = wordInput.value.replace(/[^ぁ-んー]/g, '');
};

// ルームIDをクリップボードにコピー
copyRoomIdBtn.onclick = () => {
  navigator.clipboard.writeText(roomNumber.textContent);
  alert("ルームIDをコピーしました");
};

// ================== Firebase 認証 ==================
// 匿名認証を行う（プレイヤーはID不要で参加可能）
auth.signInAnonymously().catch(console.error);
auth.onAuthStateChanged(user => {
  if(user){
    me.uid = user.uid;
    log(`認証完了`);
  }
});

// ================== ルーム管理 ==================
// 【ルーム作成】新規ルームを生成し、自身をホストとして登録
createBtn.onclick = async () => {
  if (!me.uid) return alert("認証中です。少々お待ちください。");
  const name = nameInput.value.trim();
  if (!name) return alert("表示名を入力してください");
  me.name = name;

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

// 【ルーム参加】既存ルームに自身をプレイヤーとして参加
joinBtn.onclick = async () => {
  const name = nameInput.value.trim();
  if (!name) return alert("表示名を入力してください");
  me.name = name;

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

// 【ルーム入室】ゲーム画面を表示し、Firebase リスナーを開始
function showRoom(roomId){
  currentRoom = roomId;
  lobby.style.display = 'none';
  game.style.display = 'block';
  roomLink.textContent = `招待リンク: ${location.origin + location.pathname}?room=${roomId}`;
  roomInfo.style.display = 'block';
  roomNumber.textContent = roomId;
  roomRef = db.ref(`rooms/${roomId}`);
  generateKanaButtons();
  listenRoom(roomRef); // リアルタイム監視を開始
}

// ================== Firebase リアルタイム監視 ==================
// 【ルーム監視】Firebaseのリスナーを設定し、ゲーム状態の変更をリアルタイムで反映
function listenRoom(rRef){
  // プレイヤー情報の監視：参加/脱落時に画面を更新
  rRef.child('players').on('value', snap => {
    players = snap.val() || {};
    // ホスト判定を毎回確認（ホスト変更の可能性に対応）
    rRef.child('game/hostId').once('value', hSnap => {
      isHost = hSnap.val() === me.uid;
      checkReadyToStart();
    });
    renderGame(gameStatus);
    renderPlayers(players);
    checkReadyToStart();
    checkGameEnd(); // 脱落者が出た瞬間にゲーム終了判定を実行
  });
  
  // ボード情報の監視：文字公開時に画面を更新
  rRef.child('boards').on('value', snap => {
    boards = snap.val() || {};
    renderBoards(boards);
  });
  
  // ゲーム状態の監視：ターン交代・状態遷移時に画面を更新
  rRef.child('game').on('value', snap => {
    gameStatus = snap.val() || {};
    renderGame(gameStatus);
    checkReadyToStart();
    checkGameEnd();
  });
  
  // 単語入力準備状況の監視：各プレイヤーの準備完了をリアルタイム表示
  rRef.child('wordInputState').on('value', snap => {
    wordInputState = snap.val() || {};
    renderPlayers(players);
    checkReadyToStart();
  });
}

// ================== ゲーム状態遷移制御 ==================
// 【準備状況判定】現在のゲーム段階に応じて、開始ボタン表示と情報メッセージを制御
function checkReadyToStart(){
  const playerIds = Object.keys(players);
  
  if (gameStatus.state === 'waiting') {
    if (isHost) {
      gamePhaseInfo.textContent = playerIds.length >= 2 ? '人数がそろいました。お題を入力して開始してください。' : `参加待ち (${playerIds.length}人)...`;
      startGameBtn.style.display = 'block';
    } else {
      gamePhaseInfo.textContent = 'ホストがお題を入力するのを待っています…';
      startGameBtn.style.display = 'none';
    }
  } else if (gameStatus.state === 'wordInput') {
    const meReady = wordInputState[me.uid] && wordInputState[me.uid].ready;
    const readyCount = playerIds.filter(id => wordInputState[id] && wordInputState[id].ready).length;
    
    startGameBtn.style.display = 'none';

    if (readyCount === playerIds.length && playerIds.length >= 2) {
      gamePhaseInfo.textContent = isHost ? '全員の単語が決まりました！' : 'ホストがバトルを開始するのを待っています...';
      if (isHost) startGameBtn.style.display = 'block';
    } else {
      gamePhaseInfo.textContent = meReady ? '他のプレイヤーの単語入力を待っています…' : '単語入力を待っています…';
    }
  } else if (gameStatus.state === 'playing') {
    gamePhaseInfo.textContent = `${getDisplayName(gameStatus.currentTurnPlayerId)}が文字を選択中…`;
    startGameBtn.style.display = 'none';
  }
}

// ================== UI描画関数 ==================
// 【プレイヤー表示】プレイヤーリストと準備状況を画面に描画
function renderPlayers(p){
  playersDiv.innerHTML = '';
  for(const pid in p){
    const pl = p[pid];
    const el = document.createElement('div');
    el.className = 'player';
    const ready = wordInputState[pid] && wordInputState[pid].ready;
    const status = ready ? '✓準備完了' : '準備中...';
    el.innerHTML = `<strong>${getDisplayName(pid)}</strong><div>${status}</div>`;
    playersDiv.appendChild(el);
  }
}

// 【ボード表示】各プレイヤーの単語ボードを描画（×は自分のボードのみ表示）
function renderBoards(b){
  boardArea.innerHTML = '';
  for(const pid in b){
    const board = b[pid];
    const wrap = document.createElement('div');
    const isMyBoard = pid === me.uid;
    const isCurrentTurn = pid === gameStatus.currentTurnPlayerId;
    wrap.className = `player ${isMyBoard ? 'my-board' : ''} ${isCurrentTurn ? 'active-turn' : ''}`;

    let headerText = isMyBoard ? '★ あなたの単語' : getDisplayName(pid);
    if (isCurrentTurn && gameStatus.state === 'playing') headerText += ' ⚔️攻撃中';
    wrap.innerHTML = `<div><strong>${headerText}</strong></div>`;
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

// 【ゲーム状態表示】ゲーム段階（待機→単語入力→バトル→終了）に応じて表示内容を切り替え
function renderGame(g){
  if(!g || Object.keys(g).length === 0) return;
  
  if(g.state === 'waiting') {
    wordInputPhase.style.display = 'none';
    controls.style.display = 'none';
    resetGameBtn.style.display = 'none';
    themeArea.style.display = 'none';
    turnInfo.innerHTML = ''; // メッセージをクリア
    stopTurnTimer();
    document.getElementById('themeInputArea').style.display = 'block';
  }

  if(g.state === 'wordInput') {
    themeArea.style.display = g.theme ? 'block' : 'none';
    themeDisplay.textContent = g.theme || '';
    wordInputPhase.style.display = 'block';
    controls.style.display = 'none';
    charSelector.style.display = 'none';
    resetGameBtn.style.display = 'none';
    turnInfo.innerHTML = ''; // メッセージをクリア
    updateKanaButtons(g.usedChars || {}, false, false);
    stopTurnTimer();
  } else if(g.state === 'playing') {
    themeArea.style.display = g.theme ? 'block' : 'none';
    themeDisplay.textContent = g.theme || '';
    wordInputPhase.style.display = 'none';
    controls.style.display = 'block';
    charSelector.style.display = 'block'; // 五十音表は常に表示
    renderBoards(boards);

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
      const playerName = getDisplayName(g.currentTurnPlayerId);
      const myTurnText = isMyTurn ? 'あなたの番' : `${playerName}の番`;
      turnInfo.textContent = `${myTurnText} (攻撃回数: ${g.attackCount || 0}/2)`;
    }
    startTurnTimer(g.turnStartedAt);
  } else if(g.state === 'ended') {
    wordInputPhase.style.display = 'none';
    controls.style.display = 'block';
    charSelector.style.display = 'block'; // 終了後も使用済み文字を確認できる
    charSelector.classList.add('not-my-turn');
    const charMsg = charSelector.querySelector('p');
    if (charMsg) charMsg.style.visibility = 'hidden';
    updateKanaButtons(g.usedChars, false, true); // 全ボタンを無効化
    stopTurnTimer();

    if (g.winner === me.uid) {
      turnInfo.innerHTML = '<div class="winner-msg">YOU WIN!</div>';
    } else {
      turnInfo.innerHTML = '<div class="loser-msg">GAME OVER</div>';
    }
    const winnerName = getDisplayName(g.winner);
    turnInfo.innerHTML += `<div style="margin-top:8px;">勝者: ${winnerName}</div>`;
    
    // ホストのみリセットボタンを表示
    resetGameBtn.style.display = isHost ? 'inline-block' : 'none';
  }
}

// 【文字ボタン状態制御】使用済み文字を非表示、自分の番でない時は操作不可
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

// ================== ゲームアクション ==================
// 【単語登録】ひらがなテキストを正規化・パディングしてボードを作成
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

// 【ゲーム開始・段階遷移】待機→単語入力→バトルの各段階を進める
startBtn.onclick = async () => {
  if (gameStatus.state === 'waiting') {
    // お題のチェック
    const theme = themeInput.value.trim();
    if (!theme) return alert("今回のお題を入力してください");

    // 待機中から単語入力フェーズへ遷移
    await roomRef.child('game').update({ state: 'wordInput', theme: theme });
    themeInput.value = '';
    document.getElementById('themeInputArea').style.display = 'none';
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
      turnStartedAt: Date.now(),
      winner: null,
      usedChars: {}
    });
    
    log(`ゲーム開始！最初の親: ${getDisplayName(firstPlayerId)}`);
  }
};

// 【ゲームリセット】終了したゲームをリセットし、新規ゲームの準備状態に戻す（ホストのみ）
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

// ================== ゲームメカニクス ==================
// 【かなボタン生成】五十音表（10×5）をボタンとして配置
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

// ================== タイマー制御 ==================
// 【タイマー開始】Firebaseの開始時刻を基に残りの時間を表示・監視
function startTurnTimer(startTime) {
  clearInterval(timerInterval);
  if (!startTime) return;

  const updateTimer = () => {
    const now = Date.now();
    const elapsed = Math.floor((now - startTime) / 1000);
    const remaining = Math.max(0, 30 - elapsed);

    timerDisplay.textContent = `残り時間: ${remaining}秒`;
    timerDisplay.classList.toggle('timer-warning', remaining <= 5);

    if (remaining <= 0) {
      clearInterval(timerInterval);
      // 自分のターンの時のみ、タイムアウト処理（ターン交代）をキックする
      if (gameStatus.currentTurnPlayerId === me.uid) {
        handleTimeout();
      }
    }
  };
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

// 【タイマー停止】
function stopTurnTimer() {
  clearInterval(timerInterval);
  timerDisplay.textContent = '';
  timerDisplay.classList.remove('timer-warning');
}

// 【タイムアウト処理】時間切れ時に強制的に次のプレイヤーへ交代
async function handleTimeout() {
  if (gameStatus.state !== 'playing') return;
  log("時間切れ！次のプレイヤーに交代します");
  
  const latestPlayersSnap = await roomRef.child('players').once('value');
  const latestPlayers = latestPlayersSnap.val() || {};
  const activePlayerIds = Object.keys(latestPlayers).filter(id => !latestPlayers[id].defeated);
  const attackerIdxInActive = activePlayerIds.indexOf(gameStatus.currentTurnPlayerId);
  const nextIdx = attackerIdxInActive === -1 ? 0 : (attackerIdxInActive + 1) % activePlayerIds.length;
  const nextId = activePlayerIds[nextIdx];

  await roomRef.child('game').update({
    state: 'playing',
    currentTurnPlayerId: nextId,
    attackCount: 0,
    turnStartedAt: Date.now()
  });
}

// 【文字指定・攻撃処理】プレイヤーが指定した文字をすべてのプレイヤーのボードで公開
// 処理フロー：1)使用済み登録 2)各ボードで文字検索・公開 3)脱落判定 4)ターン交代or連続攻撃判定
async function attackWithChar(char) {
  // 権限チェック：使用済みでない、かつ自分の番であることを確認
  const gameSnap = await roomRef.child('game').once('value');
  const currentGame = gameSnap.val() || {};
  if(currentGame.usedChars && currentGame.usedChars[char]) return;
  if(currentGame.currentTurnPlayerId !== me.uid) {
    alert('あなたの番ではありません');
    return;
  }
  await roomRef.child(`game/usedChars/${char}`).set(true); // 使用済み文字として登録

  let anyHit = false;
  const currentPlayersSnap = await roomRef.child('players').once('value');
  const currentPlayers = currentPlayersSnap.val() || {};

  // 各プレイヤーのボードで指定文字を検索・公開
  let otherHit = false; // 自分以外への命中判定（連続攻撃可否を決定）
  
  for(const pid in boards) {
    if(currentPlayers[pid].defeated) continue;

    const board = boards[pid];
    const chars = board.chars || [];
    const revealed = board.revealed || [];
    let hitOnThisBoard = false;

    for(let i = 0; i < chars.length; i++) {
      if(chars[i] === char && !revealed[i]) {
        revealed[i] = true;  // 文字を公開状態にマーク
        hitOnThisBoard = true;
        if (pid !== me.uid) otherHit = true;  // 他プレイヤーへのヒット判定
        anyHit = true;
      }
    }

    // ボードを更新し、脱落判定を実行
    if (hitOnThisBoard) {
      await roomRef.child(`boards/${pid}`).set({ chars, revealed });
      if (pid === me.uid) {
        log(`自爆！自分の「${char}」を公開しました`);
      } else {
        log(`${getDisplayName(pid)}の「${char}」を公開！`);
      }
      // 脱落条件：すべての文字が公開された（×はカウント外）
      const isDefeated = revealed.every((r, idx) => r || chars[idx] === 'x');
      if(isDefeated) {
        log(`${getDisplayName(pid)}が脱落しました`);
        await roomRef.child(`players/${pid}/defeated`).set(true);
      }
    }
  }
  // 重要：他プレイヤーへのヒットがない場合は連続攻撃不可（自爆のみ時）
  anyHit = otherHit;

  // 勝者判定：生き残ったプレイヤーが1人以下なら即座にゲーム終了
  const latestPlayersSnapForEnd = await roomRef.child('players').once('value');
  const latestPlayersForEnd = latestPlayersSnapForEnd.val() || {};
  const activePlayerIdsForEnd = Object.keys(latestPlayersForEnd).filter(id => !latestPlayersForEnd[id].defeated);
  if (activePlayerIdsForEnd.length <= 1) {
    const winnerId = activePlayerIdsForEnd[0] || me.uid;
    await roomRef.child('game').update({ state: 'ended', winner: winnerId });
    return; // ここで処理終了、ターン交代は行わない
  }

  // ターン判定：連続攻撃可否を判定
  const attackCountSnap = await roomRef.child('game/attackCount').once('value');
  const attackCount = attackCountSnap.exists() ? attackCountSnap.val() : 0;
  const myStatusSnap = await roomRef.child(`players/${me.uid}/defeated`).once('value');
  const isMeDefeated = myStatusSnap.val() === true;

  // ターン終了条件：他プレイヤーへのヒットなし、2回攻撃済み、自分が脱落
  if(!anyHit || attackCount >= 1 || isMeDefeated) {
    // 脱落状態を反映した最新プレイヤー情報を取得してから次プレイヤーを決定
    const latestPlayersSnap = await roomRef.child('players').once('value');
    const latestPlayers = latestPlayersSnap.val() || {};
    const activePlayerIds = Object.keys(latestPlayers).filter(id => !latestPlayers[id].defeated);
    const attackerIdxInActive = activePlayerIds.indexOf(me.uid);
    // 自分が脱落していたら-1が返るため、その場合は先頭プレイヤーから開始
    const nextIdx = attackerIdxInActive === -1 ? 0 : (attackerIdxInActive + 1) % activePlayerIds.length;
    const nextId = activePlayerIds[nextIdx];
    await roomRef.child('game').update({
      state: 'playing',
      currentTurnPlayerId: nextId,
      attackCount: 0,
      turnStartedAt: Date.now()
    });
    charSelector.style.display = 'none';
  } else {
    // 他プレイヤーへのヒットあり＆まだ攻撃回数が残っている：連続攻撃
    await roomRef.child('game').update({ 
      attackCount: attackCount + 1,
      turnStartedAt: Date.now()
    });
    log(`連続攻撃！もう1回指定できます`);
    charSelector.style.display = 'block';
    return;
  }
}

// ================== ゲーム終了処理 ==================
// 【終了判定】生き残ったプレイヤーが1人になったことをリスナーから確認し、勝敗を確定
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
    log(`${getDisplayName(winnerId)}の勝利です！`);
  }
}

// ================== ゲームログ ==================
// 【ログ出力】タイムスタンプ付きのメッセージをログパネルに追加
function log(msg){
  const t = new Date().toLocaleTimeString();
  logDiv.textContent = `[${t}] ${msg}\n` + logDiv.textContent;
}

// ================== 起動処理 ==================
// 【URL自動参加】招待リンク（?room=XXX）をクリックしてアクセスした場合、ルームIDを自動入力
window.addEventListener('load', () => {
  const params = new URLSearchParams(location.search);
  const r = params.get('room');
  if(r) joinRoomId.value = r;
});
