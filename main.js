// ================== ゲーム設定定数 ==================
// ゲームバランスに関する定数
const GAME_CONFIG = {
  MIN_WORD_LENGTH: 2,           // 単語の最小文字数
  MAX_WORD_LENGTH: 7,           // 単語の最大文字数
  BOARD_PADDING_CHAR: 'x',      // パディング文字（表示されない）
  TURN_TIME_LIMIT: 30,          // ターンの制限時間（秒）
  MAX_ATTACKS_PER_TURN: 2,      // 1ターンの最大攻撃回数
  MIN_PLAYERS: 2,               // ゲーム開始に必要な最小プレイヤー数
  TIMER_WARNING_THRESHOLD: 5    // タイマー警告が出る秒数
};

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
const leaveBtn = document.getElementById('leaveBtn');
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

// ルームIDをクリップボードにコピー
// async処理により、コピー完了を待機してから通知を表示
copyRoomIdBtn.onclick = async () => {
  try {
    await navigator.clipboard.writeText(roomNumber.textContent);
    alert("ルームIDをコピーしました");
  } catch (err) {
    console.error('クリップボードコピーエラー:', err);
    alert('コピーに失敗しました。手動でコピーしてください。');
  }
};

// 【ルーム退室】自身のデータを削除し、自身がホストなら次の人に権限を譲渡
leaveBtn.onclick = async () => {
  if (!currentRoom || !roomRef) return;
  if (!confirm("ルームを退室しますか？")) return;

  try {
    // 最新のルームデータを取得して、引き継ぎ先を決定
    const snap = await roomRef.once('value');
    const data = snap.val();
    if (!data) return;

    const updates = {};
    updates[`players/${me.uid}`] = null;
    updates[`wordInputState/${me.uid}`] = null;
    updates[`boards/${me.uid}`] = null;

    // 自分がホストかつ他にもプレイヤーがいる場合、最初の人に引き継ぐ
    const otherIds = Object.keys(data.players || {}).filter(id => id !== me.uid);
    if (data.game?.hostId === me.uid && otherIds.length > 0) {
      const nextHostId = otherIds[0];
      updates['hostId'] = nextHostId;
      updates['game/hostId'] = nextHostId;
    }

    // サーバー側の切断時処理をキャンセルして即時実行
    roomRef.child(`players/${me.uid}`).onDisconnect().cancel();
    await roomRef.update(updates);
    
    // クライアント側の状態リセット
    roomRef.off();
    currentRoom = null;
    roomRef = null;
    isHost = false;

    // UIを初期状態に戻す
    game.style.display = 'none';
    lobby.style.display = 'block';
    roomInfo.style.display = 'none';
    logDiv.textContent = '';
    
    // URLからルームパラメータを削除
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.pushState({}, '', url);
    log(`ルームを退室しました`);
  } catch (err) {
    console.error('退室エラー:', err);
  }
};

// ================== Firebase 認証 ==================
// 匿名認証を行う（プレイヤーはID不要で参加可能）
// エラーが発生した場合はコンソールに出力し、ユーザーに通知
auth.signInAnonymously()
  .catch(err => {
    console.error('認証エラー:', err);
    alert('認証に失敗しました。ページを再読み込みしてください。');
  });

// ユーザー認証状態の変化を監視
auth.onAuthStateChanged(user => {
  if (user) {
    me.uid = user.uid;
    log(`認証完了: ${user.uid.substring(0, 8)}...`);
  } else {
    console.warn('ユーザー認証が失敗しました');
  }
});

// ================== ルーム管理 ==================
// 【ルーム作成】新規ルームを生成し、自身をホストとして登録
// エラー時はアラートを表示して処理を中止
createBtn.onclick = async () => {
  try {
    if (!me.uid) {
      alert("認証中です。少々お待ちください。");
      return;
    }
    
    const name = nameInput.value.trim();
    if (!name) {
      alert("表示名を入力してください");
      nameInput.focus();
      return;
    }
    me.name = name;

    const roomId = Math.random().toString(36).slice(2, 9);
    const r = db.ref(`rooms/${roomId}`);
    
    // 初期ルームデータを一括設定
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
    log(`ルーム作成完了: ${roomId}`);
  } catch (err) {
    console.error('ルーム作成エラー:', err);
    alert('ルーム作成に失敗しました。もう一度お試しください。');
  }
};

// 【ルーム参加】既存ルームに自身をプレイヤーとして参加
// ルームが存在しない、または通信エラーの場合はアラート
joinBtn.onclick = async () => {
  try {
    const name = nameInput.value.trim();
    if (!name) {
      alert("表示名を入力してください");
      nameInput.focus();
      return;
    }
    me.name = name;

    const id = joinRoomId.value.trim();
    if (!id) {
      alert("ルームIDを入力してください");
      return;
    }
    
    const r = db.ref(`rooms/${id}`);
    const snap = await r.once('value');
    if (!snap.exists()) {
      alert("ルームが見つかりません。ルームIDを確認してください。");
      return;
    }
    
    const data = snap.val();
    const gameState = (data.game && data.game.state) || 'waiting';

    // バトル開始後（playing または ended）にアクセスした場合はプレイヤー登録をせず観戦モードとする
    if (gameState === 'playing' || gameState === 'ended') {
      log(`ゲームが進行中のため、観戦モードで参加しました`);
    } else {
      await r.child(`players/${me.uid}`).set({
        displayName: me.name,
        joinedAt: Date.now()
      });
      log(`ルーム ${id} に参加しました`);
    }
    
    showRoom(id);
  } catch (err) {
    console.error('ルーム参加エラー:', err);
    alert('ルーム参加に失敗しました。もう一度お試しください。');
  }
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
// 複数のパスを監視し、状態変化に応じてUI更新を実行
function listenRoom(rRef){
  // プレイヤー情報の監視：参加/脱落時に画面を更新
  rRef.child('players').on('value', snap => {
    players = snap.val() || {};
    renderPlayers(players);
    checkGameEnd(); // 脱落者が出た瞬間にゲーム終了判定を実行
    checkReadyToStart();
  });
  
  // ボード情報の監視：文字公開時に画面を更新
  rRef.child('boards').on('value', snap => {
    boards = snap.val() || {};
    renderBoards(boards);
  });
  
  // ゲーム状態の監視：ターン交代・状態遷移時に画面を更新
  // ホスト判定もここで更新（状態変化時のみ）
  rRef.child('game').on('value', snap => {
    gameStatus = snap.val() || {};
    // ホスト判定を更新
    isHost = gameStatus && gameStatus.hostId === me.uid;
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

  // 切断時の自動削除を設定
  setupOnDisconnect(rRef);
}

// ================== ゲーム状態遷移制御 ==================
// 【準備状況判定】現在のゲーム段階に応じて、開始ボタン表示と情報メッセージを制御
// 各フェーズで必要な条件をチェックし、UIを更新
function checkReadyToStart(){
  const playerIds = Object.keys(players);
  const isAPlayer = !!players[me.uid]; // 自分がプレイヤーリストに含まれているか
  
  // フェーズ1: 待機中（ホスト：お題入力待ち、プレイヤー：ホスト待ち）
  if (gameStatus.state === 'waiting') {
    if (isHost) {
      const hasEnoughPlayers = playerIds.length >= GAME_CONFIG.MIN_PLAYERS;
      if (hasEnoughPlayers) {
        gamePhaseInfo.textContent = '人数がそろいました。お題を入力して開始してください。';
      } else {
        gamePhaseInfo.textContent = `参加待ち (${playerIds.length}/${GAME_CONFIG.MIN_PLAYERS}人)...`;
      }
      startGameBtn.style.display = 'block';
    } else {
      gamePhaseInfo.textContent = 'ホストがお題を入力するのを待っています...';
      startGameBtn.style.display = 'none';
    }
  } 
  // フェーズ2: 単語入力中（全プレイヤー：単語入力、ホスト：全員完了待ち）
  else if (gameStatus.state === 'wordInput') {
    if (!isAPlayer) {
      gamePhaseInfo.textContent = '観戦中：プレイヤーの単語入力を待っています...';
      wordInputPhase.style.display = 'none';
      startGameBtn.style.display = 'none';
      return;
    }

    const meReady = wordInputState[me.uid] && wordInputState[me.uid].ready;
    
    // 自分が入力済みならフォームを隠す（モバイルでの視認性向上）
    wordInputPhase.style.display = meReady ? 'none' : 'block';
    
    const readyCount = playerIds.filter(id => wordInputState[id]?.ready).length;
    
    if (playerIds.length < GAME_CONFIG.MIN_PLAYERS) {
      gamePhaseInfo.textContent = `他のプレイヤーを待っています (${playerIds.length}/${GAME_CONFIG.MIN_PLAYERS}人)`;
      startGameBtn.style.display = 'none';
    } else if (readyCount === playerIds.length) {
      // 全員の単語が決まった
      gamePhaseInfo.textContent = isHost ? '全員完了！バトルを開始してください' : 'ホストがバトルを開始するのを待っています...';
      if (isHost) {
        startGameBtn.style.display = 'block';
        document.getElementById('themeInputArea').style.display = 'none'; // お題入力は済んでいるので隠す
      }
    } else {
      startGameBtn.style.display = 'none';
      gamePhaseInfo.textContent = meReady ? '他のプレイヤーの単語入力を待っています…' : '単語入力を待っています…';
    }
  } 
  // フェーズ3: バトル中
  else if (gameStatus.state === 'playing') {
    const currentPlayerName = getDisplayName(gameStatus.currentTurnPlayerId);
    const prefix = isAPlayer ? '' : '【観戦中】';
    gamePhaseInfo.textContent = `${prefix}${currentPlayerName}が文字を選択中…`;
    startGameBtn.style.display = 'none';
  } 
  // フェーズ4: バトル終了
  else if (gameStatus.state === 'ended') {
    gamePhaseInfo.textContent = 'バトル終了！';
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
    let status = ready ? '✓準備完了' : '準備中...';
    if (gameStatus && gameStatus.state === 'wordInput' && !ready) {
      status = '単語入力中...';
    }
    el.innerHTML = `<strong>${getDisplayName(pid)}</strong><div>${status}</div>`;
    playersDiv.appendChild(el);
  }
}

// 【ボード表示】各プレイヤーの単語ボードを描画（×は自分のボードのみ表示）
function renderBoards(b){
  boardArea.innerHTML = '';
  // boards（データがある人）ではなく players（全員）を基準にループ
  for(const pid in players){
    const board = b[pid] || { chars: [], revealed: [] };
    const wrap = document.createElement('div');
    const isMyBoard = pid === me.uid;
    const isCurrentTurn = pid === gameStatus.currentTurnPlayerId;
    const isDefeated = players[pid]?.defeated;
    wrap.className = `player ${isMyBoard ? 'my-board' : ''} ${isCurrentTurn ? 'active-turn' : ''} ${isDefeated ? 'defeated' : ''}`;

    let headerText = isMyBoard ? '★ あなた' : getDisplayName(pid);
    if (isCurrentTurn && gameStatus.state === 'playing') headerText += ' ⚔️攻撃中';
    wrap.innerHTML = `<div><strong>${headerText}</strong></div>`;
    const boardDiv = document.createElement('div');
    boardDiv.className = 'board';
    
    const chars = board.chars || [];
    const revealed = board.revealed || [];

    // 単語が未入力の場合の表示
    if (chars.length === 0) {
      const msg = document.createElement('div');
      msg.style.fontSize = '12px';
      msg.style.marginTop = '10px';
      msg.textContent = (gameStatus.state === 'playing') ? '（未参加）' : '入力中...';
      boardDiv.appendChild(msg);
    }
    
    for(let i = 0; i < chars.length; i++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      if(chars[i] === 'x' || chars[i] === undefined) {
        // 「×」は自分のボード、またはその人が脱落した時に表示
        if(isMyBoard || isDefeated) {
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
  const isAPlayer = !!players[me.uid];
  
  // バトル中(playing)は退室不可、それ以外は表示
  leaveBtn.style.display = (g.state === 'playing') ? 'none' : 'inline-block';

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

// 【切断時処理】プレイヤーが通信終了した際にデータを自動クリーンアップ
function setupOnDisconnect(rRef) {
  if (!me.uid) return;
  // 自分が切断したとき、各ノードから自分のデータを削除するように予約
  rRef.child(`players/${me.uid}`).onDisconnect().remove();
  rRef.child(`wordInputState/${me.uid}`).onDisconnect().remove();
  rRef.child(`boards/${me.uid}`).onDisconnect().remove();
}

// 【ヒット演出】指定した文字を五十音表の上に大きく表示
function showHitEffect(char) {
  const container = document.getElementById('charSelector');
  if (!container) return;

  const effect = document.createElement('div');
  effect.className = 'hit-effect-char';
  effect.textContent = char;
  
  container.appendChild(effect);
  // アニメーション終了後に要素を削除
  setTimeout(() => effect.remove(), 800);
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
// 2～7文字の制限をチェックし、不正な長さの場合は登録を拒否
submitWord.onclick = async () => {
  try {
    const raw = wordInput.value.trim();

    if (!raw) {
      alert("単語を入力してください");
      return;
    }

    // ひらがな・長音以外（漢字・英数字・記号など）が含まれていないかチェック
    if (/[^ぁ-んー]/.test(raw)) {
      alert("ひらがなのみ（濁点・半濁点・長音含む）で入力してください。漢字、英数字、記号は使用できません。");
      return;
    }

    const norm = normalizeJapanese(raw);
    
    // 入力値の検証
    if (norm.length < GAME_CONFIG.MIN_WORD_LENGTH || norm.length > GAME_CONFIG.MAX_WORD_LENGTH) {
      alert(`${GAME_CONFIG.MIN_WORD_LENGTH}～${GAME_CONFIG.MAX_WORD_LENGTH}文字で入力してください`);
      return;
    }
    
    // ボードデータを作成（不足分は×でパディング）
    const chars = norm.split('');
    while (chars.length < GAME_CONFIG.MAX_WORD_LENGTH) {
      chars.push(GAME_CONFIG.BOARD_PADDING_CHAR);
    }
    const revealed = new Array(chars.length).fill(false);
    
    // Firebaseに登録
    await roomRef.child(`boards/${me.uid}`).set({ chars, revealed });
    await roomRef.child(`wordInputState/${me.uid}`).set({ ready: true, word: norm });
    
    wordInput.value = '';
    log(`単語登録: ${norm} (${norm.length}文字)`);
  } catch (err) {
    console.error('単語登録エラー:', err);
    alert('単語登録に失敗しました。もう一度お試しください。');
  }
};

// 【ゲーム開始・段階遷移】待機→単語入力→バトルの各段階を進める
// 不正な状態遷移を防ぐため、現在の状態をチェック
startBtn.onclick = async () => {
  try {
    // 状態1：待機中 → 単語入力フェーズへ
    if (gameStatus.state === 'waiting') {
      const theme = themeInput.value.trim();
      if (!theme) {
        alert("今回のお題を入力してください");
        themeInput.focus();
        return;
      }

      await roomRef.child('game').update({ 
        state: 'wordInput', 
        theme: theme 
      });
      themeInput.value = '';
      document.getElementById('themeInputArea').style.display = 'none';
      log(`お題を設定しました: ${theme}`);
      return;
    }

    // 状態2：単語入力完了 → バトル開始
    if (gameStatus.state === 'wordInput') {
      const playerIds = Object.keys(players);
      
      // プレイヤー数チェック
      if (playerIds.length < GAME_CONFIG.MIN_PLAYERS) {
        alert(`${GAME_CONFIG.MIN_PLAYERS}人以上が必要です`);
        return;
      }
      
      // ランダムに最初のプレイヤーを選択
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
  } catch (err) {
    console.error('ゲーム開始エラー:', err);
    alert('ゲーム開始に失敗しました。もう一度お試しください。');
  }
};

// 【ゲームリセット】終了したゲームをリセットし、新規ゲームの準備状態に戻す（ホストのみ）
// ホスト権限チェックにより、不正なリセットを防止
resetGameBtn.onclick = async () => {
  try {
    // ホスト権限チェック
    if (!isHost) {
      alert('ホストのみリセット可能です');
      return;
    }
    
    // 確認ダイアログ
    if (!confirm('ゲームをリセットしてもよろしいですか？')) {
      return;
    }
    
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
  } catch (err) {
    console.error('ゲームリセットエラー:', err);
    alert('リセットに失敗しました。もう一度お試しください。');
  }
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
// タイムアウト時は自動的にターン交代を実行
function startTurnTimer(startTime) {
  clearInterval(timerInterval);
  if (!startTime) return;

  const updateTimer = () => {
    const now = Date.now();
    const elapsed = Math.floor((now - startTime) / 1000);
    const remaining = Math.max(0, GAME_CONFIG.TURN_TIME_LIMIT - elapsed);

    // タイマー表示を更新
    timerDisplay.textContent = `残り時間: ${remaining}秒`;
    
    // 警告表示（残り5秒以下）
    timerDisplay.classList.toggle(
      'timer-warning', 
      remaining <= GAME_CONFIG.TIMER_WARNING_THRESHOLD
    );

    // タイムアウト処理
    if (remaining <= 0) {
      clearInterval(timerInterval);
      // 自分のターンの時のみ、タイムアウト処理を実行
      // これにより、複数プレイヤーによる重複処理を防止
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
// ゲーム状態を再確認し、安全にターン交代を実行
async function handleTimeout() {
  try {
    // 現在のゲーム状態を再確認
    if (gameStatus.state !== 'playing') {
      return;
    }
    
    log("時間切れ！次のプレイヤーに交代します");
    
    // 最新のプレイヤー情報を取得（脱落状態を確認）
    const latestPlayersSnap = await roomRef.child('players').once('value');
    const latestPlayers = latestPlayersSnap.val() || {};
    
    // 脱落していないプレイヤーをフィルタリング
    const activePlayerIds = Object.keys(latestPlayers)
      .filter(id => !latestPlayers[id].defeated);
    
    if (activePlayerIds.length === 0) {
      console.warn('アクティブプレイヤーがいません');
      return;
    }
    
    // 次のプレイヤーを決定
    const currentIdx = activePlayerIds.indexOf(gameStatus.currentTurnPlayerId);
    const nextIdx = (currentIdx + 1) % activePlayerIds.length;
    const nextId = activePlayerIds[nextIdx];

    // ターン交代を実行
    await roomRef.child('game').update({
      state: 'playing',
      currentTurnPlayerId: nextId,
      attackCount: 0,
      turnStartedAt: Date.now()
    });
  } catch (err) {
    console.error('タイムアウト処理エラー:', err);
  }
}

// 【文字指定・攻撃処理】プレイヤーが指定した文字をすべてのプレイヤーのボードで公開
// 処理フロー：1)権限チェック 2)使用済み登録 3)各ボードで文字検索・公開 4)脱落判定 5)ターン交代or連続攻撃判定
async function attackWithChar(char) {
  try {
    // ========== ステップ1: 権限・状態チェック ==========
    if (!roomRef) {
      console.warn('ルーム未設定');
      return;
    }
    
    // 最新のゲーム状態を取得
    const gameSnap = await roomRef.child('game').once('value');
    const currentGame = gameSnap.val() || {};
    
    // 状態チェック
    if (currentGame.state !== 'playing') {
      console.warn('ゲームが進行中ではありません');
      return;
    }
    
    // ターンチェック（自分の番か確認）
    if (currentGame.currentTurnPlayerId !== me.uid) {
      alert('あなたの番ではありません');
      return;
    }
    
    // 使用済みチェック
    if (currentGame.usedChars && currentGame.usedChars[char]) {
      alert('その文字はすでに使用済みです');
      return;
    }
    
    // 脱落チェック
    const myStatusSnap = await roomRef.child(`players/${me.uid}/defeated`).once('value');
    if (myStatusSnap.val() === true) {
      alert('脱落しているため、攻撃できません');
      return;
    }
    
    // ========== ステップ2: 使用済み文字を登録 ==========
    await roomRef.child(`game/usedChars/${char}`).set(true);
    
    // ========== ステップ3: 各ボードで文字を検索・公開 ==========
    let otherHit = false; // 他プレイヤーへのヒット判定
    const currentPlayersSnap = await roomRef.child('players').once('value');
    const currentPlayers = currentPlayersSnap.val() || {};
    
    for (const pid in boards) {
      // 脱落プレイヤーをスキップ
      if (currentPlayers[pid] && currentPlayers[pid].defeated) {
        continue;
      }

      const board = boards[pid];
      const chars = board.chars || [];
      const revealed = board.revealed || [];
      let hitOnThisBoard = false;

      // ========== ステップ4: 文字を検索して公開 ==========
      for (let i = 0; i < chars.length; i++) {
        if (chars[i] === char && !revealed[i]) {
          revealed[i] = true;
          hitOnThisBoard = true;
          if (pid !== me.uid) {
            otherHit = true; // 他プレイヤーへのヒット
          }
        }
      }

      // ボードを更新
      if (hitOnThisBoard) {
        await roomRef.child(`boards/${pid}`).set({ chars, revealed });
        
        if (pid === me.uid) {
          log(`自爆！自分の「${char}」を公開しました`);
        } else {
          log(`${getDisplayName(pid)}の「${char}」を公開！`);
        }
        
        // ========== ステップ5: 脱落判定 ==========
        // 脱落条件：すべての文字が公開（×はカウント外）
        const isDefeated = revealed.every((r, idx) => r || chars[idx] === GAME_CONFIG.BOARD_PADDING_CHAR);
        if (isDefeated) {
          log(`${getDisplayName(pid)}が脱落しました`);
          await roomRef.child(`players/${pid}/defeated`).set(true);
        }
      }
    }
    
    // 攻撃成功のビジュアル表示
    if (otherHit) {
      log(`🎯 攻撃成功！「${char}」を公開させました！`);
      showHitEffect(char);
    }

    // ========== ステップ6: 勝者判定 ==========
    const latestPlayersSnapForEnd = await roomRef.child('players').once('value');
    const latestPlayersForEnd = latestPlayersSnapForEnd.val() || {};
    const activePlayerIdsForEnd = Object.keys(latestPlayersForEnd)
      .filter(id => !latestPlayersForEnd[id].defeated);
    
    if (activePlayerIdsForEnd.length <= 1) {
      const winnerId = activePlayerIdsForEnd[0] || me.uid;
      // 勝者のボードをすべて公開
      const winnerBoard = boards[winnerId];
      if (winnerBoard) {
        const allRevealed = new Array(winnerBoard.chars.length).fill(true);
        await roomRef.child(`boards/${winnerId}/revealed`).set(allRevealed);
      }
      await roomRef.child('game').update({ 
        state: 'ended', 
        winner: winnerId 
      });
      return;
    }

    // ========== ステップ7: ターン判定 ==========
    const attackCountSnap = await roomRef.child('game/attackCount').once('value');
    const attackCount = attackCountSnap.exists() ? attackCountSnap.val() : 0;
    
    // ターン終了条件：
    // 1) 他プレイヤーへのヒットなし
    // 2) 既に2回攻撃済み
    // 3) 自分が脱落
    if (!otherHit || attackCount >= (GAME_CONFIG.MAX_ATTACKS_PER_TURN - 1) || myStatusSnap.val() === true) {
      // ターン交代
      const latestPlayersSnap = await roomRef.child('players').once('value');
      const latestPlayers = latestPlayersSnap.val() || {};
      const activePlayerIds = Object.keys(latestPlayers)
        .filter(id => !latestPlayers[id].defeated);
      
      if (activePlayerIds.length === 0) {
        console.warn('アクティブプレイヤーがいません');
        return;
      }
      
      const attackerIdxInActive = activePlayerIds.indexOf(me.uid);
      const nextIdx = attackerIdxInActive === -1 ? 0 : (attackerIdxInActive + 1) % activePlayerIds.length;
      const nextId = activePlayerIds[nextIdx];
      
      await roomRef.child('game').update({
        state: 'playing',
        currentTurnPlayerId: nextId,
        attackCount: 0,
        turnStartedAt: Date.now()
      });
    } else {
      // 連続攻撃
      await roomRef.child('game').update({ 
        attackCount: attackCount + 1,
        turnStartedAt: Date.now()
      });
      log(`連続攻撃！もう1回指定できます（${attackCount + 1}/${GAME_CONFIG.MAX_ATTACKS_PER_TURN}）`);
    }
  } catch (err) {
    console.error('攻撃処理エラー:', err);
    log(`エラー: ${err.message}`);
  }
}

// ================== ゲーム終了処理 ==================
// 【終了判定】生き残ったプレイヤーが1人になったことをリスナーから確認し、勝敗を確定
// アクティブプレイヤーが1人以下になったら自動的にゲーム終了
async function checkGameEnd() {
  try {
    // 現在のゲーム状態をチェック
    if (gameStatus.state !== 'playing' && gameStatus.state !== 'ended') {
      return;
    }
    
    const playerIds = Object.keys(players);
    if (playerIds.length < GAME_CONFIG.MIN_PLAYERS) {
      return;
    }

    // アクティブプレイヤー（脱落していない）を取得
    const activePlayerIds = playerIds.filter(id => !players[id].defeated);
    
    // 生き残ったプレイヤーが1人のみ = 勝者確定
    if (activePlayerIds.length === 1) {
      const winnerId = activePlayerIds[0];
      
      // 勝者のボードをすべて公開（既に終了している場合もあるので確認）
      if (gameStatus.state === 'playing') {
        const winnerBoard = boards[winnerId];
        if (winnerBoard) {
          const allRevealed = new Array(winnerBoard.chars.length).fill(true);
          await roomRef.child(`boards/${winnerId}/revealed`).set(allRevealed);
        }
        
        await roomRef.child('game').update({
          state: 'ended',
          winner: winnerId
        });
      }
      
      log(`${getDisplayName(winnerId)}の勝利です！`);
    }
  } catch (err) {
    console.error('ゲーム終了判定エラー:', err);
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
  try {
    const params = new URLSearchParams(location.search);
    const roomId = params.get('room');
    if (roomId && /^[a-z0-9]{7}$/.test(roomId)) {
      // ルームIDの形式チェック（7文字の英数字）
      joinRoomId.value = roomId;
      log(`招待リンクからルームID: ${roomId}`);
    }
  } catch (err) {
    console.error('URL解析エラー:', err);
  }
});
