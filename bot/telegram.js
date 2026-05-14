export function createTelegram(token) {
  const base = `https://api.telegram.org/bot${token}`;
  let offset = 0;
  let running = false;

  async function call(method, params = {}) {
    const res = await fetch(`${base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!data.ok) {
      const err = new Error(`Telegram ${method} failed: ${data.error_code} ${data.description}`);
      err.telegram = data;
      throw err;
    }
    return data.result;
  }

  return {
    call,
    sendMessage(chatId, text, extra = {}) {
      return call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
    },
    editMessageText(chatId, messageId, text, extra = {}) {
      return call('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', ...extra });
    },
    answerCallbackQuery(id, text, extra = {}) {
      return call('answerCallbackQuery', { callback_query_id: id, text, ...extra });
    },
    async getMe() {
      return call('getMe');
    },

    async startPolling(handler) {
      running = true;
      while (running) {
        let updates = [];
        try {
          updates = await call('getUpdates', { timeout: 30, offset });
        } catch (e) {
          console.error('getUpdates error:', e.message);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        for (const u of updates) {
          offset = u.update_id + 1;
          try {
            await handler(u);
          } catch (e) {
            console.error('handler error:', e.stack || e.message);
          }
        }
      }
    },
    stop() {
      running = false;
    },
  };
}
