class LocalNotifications {
  constructor(database, onNotification, { interval = 500, onError = error => console.error('[local-notifications]', error.message) } = {}) {
    this.database = database;
    this.onNotification = onNotification;
    this.interval = interval;
    this.onError = onError;
  }

  async poll() {
    if (this.polling) return this.polling;
    this.polling = (async () => {
      let batch;
      do {
        batch = await this.database.takeLocal();
        for (const item of batch) this.onNotification(item);
      } while (batch.length === 100 && !this.stopped);
    })().finally(() => { this.polling = null; });
    return this.polling;
  }

  async start() {
    this.stopped = false;
    await this.poll();
    if (this.stopped) return;
    this.timer = setInterval(() => { void this.poll().catch(this.onError); }, this.interval);
    this.timer.unref?.();
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.polling;
  }
}

module.exports = LocalNotifications;
