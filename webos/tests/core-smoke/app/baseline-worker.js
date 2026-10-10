// Worker da linha de base do smoke: sobe e responde, sem carregar o core.
self.onmessage = function (e) {
    if (e.data && e.data.baselinePing) self.postMessage({ baselinePong: true });
};
