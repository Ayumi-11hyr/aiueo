(function (global) {
  function getNextActivePlayerId(activePlayerIds, currentTurnPlayerId) {
    if (!Array.isArray(activePlayerIds) || activePlayerIds.length === 0) {
      return null;
    }

    if (!currentTurnPlayerId) {
      return activePlayerIds[0];
    }

    const currentIdx = activePlayerIds.indexOf(currentTurnPlayerId);
    if (currentIdx === -1) {
      return activePlayerIds[0];
    }

    return activePlayerIds[(currentIdx + 1) % activePlayerIds.length];
  }

  const api = {
    getNextActivePlayerId
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  global.AiueoGameLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
