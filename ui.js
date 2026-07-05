(function (global) {
  function checkReadyToStart() {
    if (!gameStatus || !gameStatus.state) return;

    const playerIds = Object.keys(players);
    const isAPlayer = !!players[me.uid];

    if (gameStatus.state === 'waiting') {
      wordInputPhase.style.display = 'none';
      if (isHost) {
        const hasEnoughPlayers = playerIds.length >= GAME_CONFIG.MIN_PLAYERS;
        if (hasEnoughPlayers) {
          gamePhaseInfo.textContent = '人数がそろいました。お題を入力して開始してください。';
        } else {
          gamePhaseInfo.textContent = `参加待ち (${playerIds.length}/${GAME_CONFIG.MIN_PLAYERS}人)... 揃わなくても開始できます。`;
        }
        startGameBtn.style.display = 'block';
        document.getElementById('themeInputArea').style.display = 'block';
        startBtn.textContent = 'お題を決定して次へ';
      } else {
        gamePhaseInfo.textContent = 'ホストがお題を入力するのを待っています...';
        startGameBtn.style.display = 'none';
      }
    } else if (gameStatus.state === 'wordInput') {
      document.getElementById('themeInputArea').style.display = 'none';

      if (!isAPlayer) {
        gamePhaseInfo.textContent = '観戦中：プレイヤーのお題入力を待っています...';
        wordInputPhase.style.display = 'none';
        startGameBtn.style.display = 'none';
        return;
      }
      const meReady = wordInputState[me.uid] && wordInputState[me.uid].ready;
      const readyCount = playerIds.filter(id => wordInputState[id]?.ready).length;

      if (readyCount === playerIds.length && playerIds.length >= GAME_CONFIG.MIN_PLAYERS) {
        gamePhaseInfo.textContent = isHost ? '全員完了！バトルを開始してください' : 'ホストがバトルを開始するのを待っています...';
        if (isHost) {
          startGameBtn.style.display = 'block';
          startBtn.textContent = 'バトル開始！';
        }
        wordInputPhase.style.display = 'none';
      } else {
        startGameBtn.style.display = 'none';
        wordInputPhase.style.display = meReady ? 'none' : 'block';

        if (playerIds.length < GAME_CONFIG.MIN_PLAYERS) {
          gamePhaseInfo.textContent = `他のプレイヤーを待っています (${playerIds.length}/${GAME_CONFIG.MIN_PLAYERS}人)`;
        } else {
          gamePhaseInfo.textContent = meReady ? '他のプレイヤーの入力を待っています…' : 'あなたの単語を入力してください';
        }
      }

      wordInputPhase.style.display = 'block';
      submitWord.textContent = meReady ? '単語を変更する' : 'OK';
      if (meReady && !wordInput.value && wordInputState[me.uid].word) {
        wordInput.value = wordInputState[me.uid].word;
      }
    } else if (gameStatus.state === 'playing') {
      const currentPlayerName = getDisplayName(gameStatus.currentTurnPlayerId);
      const prefix = isAPlayer ? '' : '【観戦中】';
      gamePhaseInfo.textContent = `${prefix}${currentPlayerName}が文字を選択中…`;
      startGameBtn.style.display = 'none';
    } else if (gameStatus.state === 'ended') {
      gamePhaseInfo.textContent = 'バトル終了！';
    }
  }

  function renderBoards(b) {
    boardArea.innerHTML = '';
    for (const pid in players) {
      const board = b[pid] || { chars: [], revealed: [] };
      const wrap = document.createElement('div');
      const isMyBoard = pid === me.uid;
      const isCurrentTurn = pid === gameStatus.currentTurnPlayerId;
      const isDefeated = players[pid]?.defeated;
      wrap.className = `player ${isMyBoard ? 'my-board' : ''} ${isCurrentTurn ? 'active-turn' : ''} ${isDefeated ? 'defeated' : ''}`;

      const nameWithAttributes = escapeHtml(getDisplayName(pid));
      const headerHTML = `<div class="player-header"><strong class="player-name">${nameWithAttributes}</strong>${getPlayerBadges(pid)}</div>`;
      wrap.innerHTML = headerHTML;
      const boardDiv = document.createElement('div');
      boardDiv.className = 'board';

      const chars = board.chars || [];
      const revealed = board.revealed || [];

      if (chars.length === 0) {
        const msg = document.createElement('div');
        msg.style.fontSize = '12px';
        msg.style.marginTop = '10px';
        if (gameStatus.state === 'playing') {
          msg.textContent = '（未参加）';
        } else if (gameStatus.state === 'waiting') {
          msg.textContent = '（お題入力待ち）';
        } else if (gameStatus.state === 'wordInput') {
          const ready = wordInputState[pid] && wordInputState[pid].ready;
          msg.textContent = ready ? '✓ 準備完了' : '入力中…';
        } else if (isDefeated) {
          msg.textContent = '（脱落）';
        } else if (isCurrentTurn && gameStatus.state === 'playing') {
          msg.textContent = '⚔️ 攻撃中';
        }
        boardDiv.appendChild(msg);
      }

      for (let i = 0; i < chars.length; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        if (chars[i] === 'x' || chars[i] === undefined) {
          if (isMyBoard || isDefeated) {
            cell.textContent = '×';
            cell.classList.add('cross');
          }
        } else {
          if (isMyBoard) {
            cell.textContent = chars[i];
            cell.classList.add(revealed[i] ? 'revealed' : 'my-hidden');
          } else {
            cell.textContent = revealed[i] ? chars[i] : '';
            if (revealed[i]) cell.classList.add('revealed');
          }
        }
        boardDiv.appendChild(cell);
      }
      wrap.appendChild(boardDiv);
      boardArea.appendChild(wrap);
    }
  }

  function renderGame(g) {
    if (!g || Object.keys(g).length === 0) return;
    const isAPlayer = !!players[me.uid];

    leaveBtn.style.display = (g.state === 'playing') ? 'none' : 'inline-block';

    if (g.state === 'waiting') {
      wordInputPhase.style.display = 'none';
      controls.style.display = 'none';
      resetGameBtn.style.display = 'none';
      themeArea.style.display = 'none';
      turnInfo.innerHTML = '';
      wordInput.value = '';
      stopTurnTimer();
      document.getElementById('themeInputArea').style.display = 'block';
    }

    if (g.state === 'wordInput') {
      themeArea.style.display = g.theme ? 'block' : 'none';
      themeDisplay.textContent = g.theme || '';
      controls.style.display = 'none';
      charSelector.style.display = 'none';
      resetGameBtn.style.display = 'none';
      turnInfo.innerHTML = '';
      updateKanaButtons(g.usedChars || {}, false, false);
      stopTurnTimer();
    } else if (g.state === 'playing') {
      themeArea.style.display = g.theme ? 'block' : 'none';
      themeDisplay.textContent = g.theme || '';
      wordInputPhase.style.display = 'none';
      controls.style.display = 'block';
      charSelector.style.display = 'block';
      renderBoards(boards);

      const isMyTurn = g.currentTurnPlayerId === me.uid;
      const isMeDefeated = players[me.uid] && players[me.uid].defeated;
      charSelector.classList.toggle('not-my-turn', !isMyTurn);

      const charMsg = charSelector.querySelector('p');
      if (charMsg) charMsg.style.visibility = (isMyTurn && !isMeDefeated) ? 'visible' : 'hidden';

      resetGameBtn.style.display = 'none';
      updateKanaButtons(g.usedChars, isMyTurn, isMeDefeated);

      if (isMeDefeated) {
        turnInfo.innerHTML = '<div class="loser-msg">GAME OVER</div>';
        turnInfo.innerHTML += '<div style="margin-top:8px;">あなたは脱落しました。他のプレイヤーの対戦を見守りましょう。</div>';
      } else {
        const playerName = getDisplayName(g.currentTurnPlayerId);
        const myTurnText = isMyTurn ? 'あなたの番' : `${playerName}の番`;
        turnInfo.textContent = `${myTurnText} (攻撃回数: ${g.attackCount || 0}/2)`;
      }
      startTurnTimer(g.turnStartedAt);
    } else if (g.state === 'ended') {
      wordInputPhase.style.display = 'none';
      controls.style.display = 'block';
      charSelector.style.display = 'block';
      charSelector.classList.add('not-my-turn');
      const charMsg = charSelector.querySelector('p');
      if (charMsg) charMsg.style.visibility = 'hidden';
      updateKanaButtons(g.usedChars, false, true);
      stopTurnTimer();

      if (g.winner === me.uid) {
        turnInfo.innerHTML = '<div class="winner-msg">You win</div>';
      } else {
        turnInfo.innerHTML = '<div class="loser-msg">You lose</div>';
      }
      const winnerName = getDisplayName(g.winner);
      turnInfo.innerHTML += `<div class="result-subtext">勝者: ${winnerName}</div>`;
      resetGameBtn.style.display = isHost ? 'inline-block' : 'none';
    }
  }

  function showHitEffect(char, type) {
    const container = document.getElementById('charSelector');
    if (!container) return;

    const effect = document.createElement('div');
    effect.className = `hit-effect-char ${type}`;
    effect.textContent = char;

    container.appendChild(effect);
    setTimeout(() => effect.remove(), 1000);
  }

  function updateKanaButtons(usedChars = {}, isMyTurn = false, isMeDefeated = false) {
    const buttons = kanaButtons.querySelectorAll('button');
    buttons.forEach(btn => {
      const char = btn.textContent;
      if (char === '') return;
      const isUsed = !!usedChars[char];
      btn.classList.toggle('used', isUsed);
      btn.disabled = isUsed || !isMyTurn || isMeDefeated;
    });
  }

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

  function startTurnTimer(startTime) {
    clearInterval(timerInterval);
    if (!startTime) return;

    const updateTimer = () => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTime) / 1000);
      const remaining = Math.max(0, GAME_CONFIG.TURN_TIME_LIMIT - elapsed);

      timerDisplay.textContent = `残り時間: ${remaining}秒`;
      timerDisplay.classList.toggle('timer-warning', remaining <= GAME_CONFIG.TIMER_WARNING_THRESHOLD);

      if (remaining <= 0) {
        clearInterval(timerInterval);
        if (gameStatus.currentTurnPlayerId === me.uid) {
          handleTimeout();
        }
      }
    };

    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
  }

  function stopTurnTimer() {
    clearInterval(timerInterval);
    timerDisplay.textContent = '';
    timerDisplay.classList.remove('timer-warning');
  }

  function log(msg) {
    const t = new Date().toLocaleTimeString();
    logDiv.textContent = `[${t}] ${msg}\n` + logDiv.textContent;
  }

  global.aiueoUi = {
    checkReadyToStart,
    renderBoards,
    renderGame,
    showHitEffect,
    updateKanaButtons,
    generateKanaButtons,
    startTurnTimer,
    stopTurnTimer,
    log
  };
})(window);
