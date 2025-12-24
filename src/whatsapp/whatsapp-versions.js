/**
 * Diferentes versões do WhatsApp que você pode testar
 * Se uma não funcionar, tente a próxima
 *
 * Copie e teste cada uma no seu createClient.js
 */

// ✅ VERSÃO 1 - Recomendada (Dezembro 2024)
const VERSION_LATEST = {
  isLatest: true,
  version: [2, 3000, 1020885143],
  binary: "PQ",
};

// ✅ VERSÃO 2 - Alternativa 1
const VERSION_ALT_1 = {
  isLatest: true,
  version: [2, 2400, 1010000],
  binary: "PQ",
};

// ✅ VERSÃO 3 - Alternativa 2
const VERSION_ALT_2 = {
  isLatest: true,
  version: [2, 2300, 9090909],
  binary: "PQ",
};

// ✅ VERSÃO 4 - Mais Antiga (se outras falharem)
const VERSION_ALT_3 = {
  isLatest: true,
  version: [2, 2100, 5000000],
  binary: "PQ",
};

/**
 * COMO USAR:
 *
 * 1. Abra seu createClient.js
 * 2. Procure por esta linha:
 *    let version = await fetchLatestBaileysVersion();
 *
 * 3. Substitua por (teste uma versão de cada vez):
 *    let version = VERSION_LATEST;
 *
 * 4. Se não funcionar, tente:
 *    let version = VERSION_ALT_1;
 *    let version = VERSION_ALT_2;
 *    let version = VERSION_ALT_3;
 *
 * 5. Para cada versão testada:
 *    - Delete a pasta sessions/
 *    - Restart o servidor
 *    - Gere um novo QR code
 *    - Escaneie com o celular
 *    - Aguarde a resposta
 */

module.exports = {
  VERSION_LATEST,
  VERSION_ALT_1,
  VERSION_ALT_2,
  VERSION_ALT_3,
};
