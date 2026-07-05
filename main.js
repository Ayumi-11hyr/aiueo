// ================== ゲーム設定定数 ==================
// ゲームバランスに関する定数
const GAME_CONFIG = {
  MIN_WORD_LENGTH: 2,           // 単語の最小文字数
  MAX_WORD_LENGTH: 10,          // 単語の最大文字数（2～10文字に対応）
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
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const auth = window.aiueoFirebase?.auth || firebase.auth();
const db = window.aiueoFirebase?.db || firebase.database();

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
let lastEffectTs = Date.now(); // 起動時以降の演出のみ表示
let lastTimeoutKey = null;
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
const { getNextActivePlayerId } = window.AiueoGameLogic || {};

// ================== ヘルパー関数 ==================
// プレイヤーIDを非公開にし、表示名を整形して返す
function getDisplayName(pid) {
  if (!pid || !players[pid]) return '不明';
  return players[pid].displayName || '名無し';
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getPlayerBadges(pid) {
  if (!pid || !players[pid]) return '';

  const badges = [];
  if (pid === me.uid) {
    badges.push('<span class="player-badge you-badge">あなた</span>');
  }
  if (gameStatus && pid === gameStatus.hostId) {
    badges.push('<span class="player-badge host-badge">ホスト</span>');
  }

  return badges.length ? `<div class="player-badges">${badges.join('')}</div>` : '';
}

function getActivePlayerIds(playerState = players) {
  return Object.keys(playerState || {}).filter(id => !playerState[id]?.defeated);
}

async function advanceTurn() {
  if (!roomRef) return false;

  const latestPlayersSnap = await roomRef.child('players').once('value');
  const latestPlayers = latestPlayersSnap.val() || {};
  const activePlayerIds = getActivePlayerIds(latestPlayers);
  if (activePlayerIds.length === 0) return false;

  const gameSnap = await roomRef.child('game').once('value');
  const currentGame = gameSnap.val() || {};
  const expectedTurnVersion = currentGame.turnVersion || 0;
  const currentTurnPlayerId = currentGame.currentTurnPlayerId || activePlayerIds[0];
  const nextPlayerId = getNextActivePlayerId(activePlayerIds, currentTurnPlayerId);

  if (!nextPlayerId) return false;

  const result = await roomRef.child('game').transaction(currentGameData => {
    if (!currentGameData || currentGameData.state !== 'playing') {
      return currentGameData;
    }

    if ((currentGameData.turnVersion || 0) !== expectedTurnVersion) {
      return currentGameData;
    }

    return {
      ...currentGameData,
      state: 'playing',
      currentTurnPlayerId: nextPlayerId,
      attackCount: 0,
      turnStartedAt: Date.now(),
      turnVersion: (currentGameData.turnVersion || 0) + 1
    };
  });

  return result.committed;
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
  await window.aiueoFirebase?.leaveRoom?.();
};

// ================== Firebase 認証 ==================
window.aiueoFirebase?.initializeAuth?.();

// ================== ルーム管理 ==================
createBtn.onclick = async () => {
  await window.aiueoFirebase?.createRoom?.();
};

joinBtn.onclick = async () => {
  await window.aiueoFirebase?.joinRoom?.();
};

leaveBtn.onclick = async () => {
  await window.aiueoFirebase?.leaveRoom?.();
};

function showRoom(roomId) {
  return window.aiueoFirebase?.showRoom?.(roomId);
}

function listenRoom(rRef) {
  return window.aiueoFirebase?.listenRoom?.(rRef);
}

// ================== ゲーム状態遷移制御 ==================
function checkReadyToStart() {
  return window.aiueoUi?.checkReadyToStart?.();
}

// ================== UI描画関数 ==================
function renderPlayers(p) {
  // 廃止：renderBoardsに統合
}

function renderBoards(b) {
  return window.aiueoUi?.renderBoards?.(b);
}

function renderGame(g) {
  return window.aiueoUi?.renderGame?.(g);
}

function setupOnDisconnect(rRef) {
  return window.aiueoFirebase?.setupOnDisconnect?.(rRef);
}

function showHitEffect(char, type) {
  return window.aiueoUi?.showHitEffect?.(char, type);
}

function updateKanaButtons(usedChars = {}, isMyTurn = false, isMeDefeated = false) {
  return window.aiueoUi?.updateKanaButtons?.(usedChars, isMyTurn, isMeDefeated);
}

// ================== ゲームアクション ==================
// 【単語登録】ひらがなテキストを正規化・パディングしてボードを作成
// 2～10文字の制限をチェックし、不正な長さの場合は登録を拒否
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
    // wordInput.value = ''; // 変更しやすくするため、入力値は残しておく
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
        turnVersion: 0,
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
function generateKanaButtons() {
  return window.aiueoUi?.generateKanaButtons?.();
}

// ================== タイマー制御 ==================
function startTurnTimer(startTime) {
  return window.aiueoUi?.startTurnTimer?.(startTime);
}

function stopTurnTimer() {
  return window.aiueoUi?.stopTurnTimer?.();
}

// 【タイムアウト処理】時間切れ時に強制的に次のプレイヤーへ交代
// ゲーム状態を再確認し、安全にターン交代を実行
async function handleTimeout() {
  try {
    if (gameStatus.state !== 'playing') {
      return;
    }

    const timeoutKey = `${gameStatus.currentTurnPlayerId || ''}:${gameStatus.turnStartedAt || 0}:${gameStatus.turnVersion || 0}`;
    if (timeoutKey === lastTimeoutKey) {
      return;
    }
    lastTimeoutKey = timeoutKey;

    log("時間切れ！次のプレイヤーに交代します");

    await advanceTurn();
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
    let victimIds = [];
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
          if (!victimIds.includes(pid)) victimIds.push(pid);
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
    
    // 演出用データをFirebaseに更新（全プレイヤーで同期）
    await roomRef.child('game/lastHit').set({
      char: char,
      attackerId: me.uid,
      victimIds: victimIds,
      ts: Date.now()
    });

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
      await advanceTurn();
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
function log(msg) {
  return window.aiueoUi?.log?.(msg);
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
