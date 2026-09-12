/**
 * HTRAM Web Configurator & Monitor
 * Web Bluetooth API Manager & GATT Client
 */

import {
  SERVICE_UUID,
  WRITE_UUID,
  NOTIFY_UUID,
  FrameAccumulator,
  frameOpcode,
  frameIsValid,
  bytesToHex,
  buildRealtimeRequest,
  buildHeartbeatRequest,
  buildSoundGetRequest,
  buildSoundSetRequest,
  buildSettingsGetRequest,
  buildSettingsSetRequest,
  buildTempUnitGetRequest,
  buildTempUnitSetRequest,
  buildSkuRequest,
  buildFirmwareRequest,
  buildRadioModeRequest,
  buildTimeSyncRequest,
  buildDataLogRequest,
  parseDataLogResponse,
  parseRealtime,
  parseSettings,
  parseSound,
  parseTempUnit,
  parseSku,
  parseFirmware,
} from './protocol.js';

export const BLE_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTING: 'disconnecting',
};

export class BleClient extends EventTarget {
  constructor() {
    super();
    this.state = BLE_STATES.DISCONNECTED;
    this.device = null;
    this.server = null;
    this.service = null;
    this.writeChar = null;
    this.notifyChar = null;

    this.accumulator = new FrameAccumulator();
    this._writeQueue = Promise.resolve();
    this._pendingResolvers = new Map(); // opcode -> [{ resolve, reject, timeoutId }]

    this._heartbeatInterval = null;
    this._pollingInterval = null;
    this.isFetchingHistory = false;

    // Cached device properties
    this.info = {
      name: null,
      sku: null,
      firmware: null,
      buzzerEnabled: null,
      tempUnitCelsius: true,
      alarmLow: 800,
      alarmHigh: 1000,
      screenOff: 0,
      lastReading: null,
    };
  }

  /**
   * Check if browser supports Web Bluetooth
   * @returns {boolean}
   */
  static isSupported() {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  _setState(newState) {
    if (this.state === newState) return;
    this.state = newState;
    this.dispatchEvent(new CustomEvent('statechange', { detail: { state: newState } }));
  }

  _log(direction, text, hex = '') {
    this.dispatchEvent(new CustomEvent('log', { detail: { direction, text, hex, time: new Date() } }));
  }

  /**
   * Request Bluetooth device and connect
   * @param {boolean} [acceptAllDevices=false]
   */
  async connect(acceptAllDevices = false) {
    if (!BleClient.isSupported()) {
      throw new Error('Web Bluetooth API не підтримується цим браузером. Використовуйте Chrome або Edge.');
    }

    if (this.state === BLE_STATES.CONNECTED || this.state === BLE_STATES.CONNECTING) {
      return;
    }

    this._setState(BLE_STATES.CONNECTING);
    this._log('info', 'Початок пошуку пристрою HTRAM...');

    try {
      const options = acceptAllDevices
        ? {
            acceptAllDevices: true,
            optionalServices: [SERVICE_UUID],
          }
        : {
            filters: [
              { services: [SERVICE_UUID] },
              { namePrefix: 'HTRAM' },
              { namePrefix: 'Honeywell' },
            ],
            optionalServices: [SERVICE_UUID],
          };

      this.device = await navigator.bluetooth.requestDevice(options);
      this.info.name = this.device.name || 'HTRAM Device';
      this._log('info', `Обрано пристрій: ${this.info.name} (${this.device.id})`);

      this.device.addEventListener('gattserverdisconnected', () => this._onDisconnected());

      this.server = await this.device.gatt.connect();
      this._log('info', 'Підключено до GATT сервера, пошук сервісу...');

      this.service = await this.server.getPrimaryService(SERVICE_UUID);
      this._log('info', 'Сервіс HTRAM знайдено, отримання характеристик...');

      this.writeChar = await this.service.getCharacteristic(WRITE_UUID);
      this.notifyChar = await this.service.getCharacteristic(NOTIFY_UUID);

      await this.notifyChar.startNotifications();
      this.notifyChar.addEventListener('characteristicvaluechanged', (e) => this._onNotification(e));
      this._log('info', 'Підписку на нотифікації активовано');

      this._setState(BLE_STATES.CONNECTED);

      // Initialize device link
      await this._initDevice();
    } catch (err) {
      this._log('error', `Помилка підключення: ${err.message}`);
      this._cleanup();
      this._setState(BLE_STATES.DISCONNECTED);
      throw err;
    }
  }

  async _initDevice() {
    try {
      // 1. Send radio mode frame (BLE mode: 74 58 01 01 00)
      this._log('out', 'Ініціалізація зв\'язку (BLE mode)');
      const modePacket = buildRadioModeRequest(false);
      await this._writeRaw(modePacket);

      // Brief delay for device to stabilize
      await new Promise((res) => setTimeout(res, 200));

      // 2. Query SKU and Firmware
      this._log('out', 'Запит SKU та прошивки');
      this.sendCommand(buildSkuRequest(), 0x2121, 2000).catch(() => {});
      this.sendCommand(buildFirmwareRequest(), 0x2123, 2000).catch(() => {});

      // 3. Query buzzer status
      this._log('out', 'Запит статусу зумера');
      await this.sendCommand(buildSoundGetRequest(), 0x2723, 2000).catch(() => {});

      // 4. Query hardware settings (thresholds, screen timer)
      this._log('out', 'Запит налаштувань порогів CO2');
      await this.sendCommand(buildSettingsGetRequest(), 0x4143, 2000).catch(() => {});

      // 5. Query temperature unit
      this._log('out', 'Запит одиниці температури');
      await this.sendCommand(buildTempUnitGetRequest(), 0x216E, 2000).catch(() => {});

      // 6. Query initial telemetry
      this._log('out', 'Запит поточних показників датчиків');
      await this.sendCommand(buildRealtimeRequest(), 0x4144, 2000).catch(() => {});

      // 7. Start periodic heartbeat and polling
      this._startTimers();
    } catch (err) {
      this._log('error', `Помилка ініціалізації пристрою: ${err.message}`);
    }
  }

  _startTimers() {
    this._stopTimers();

    // Heartbeat every 15s to keep connection alive
    this._heartbeatInterval = setInterval(async () => {
      if (this.state === BLE_STATES.CONNECTED) {
        try {
          await this._writeRaw(buildHeartbeatRequest());
        } catch {
          // Keepalive silent catch
        }
      }
    }, 15000);

    // Poll telemetry every 5s
    this._pollingInterval = setInterval(async () => {
      if (this.state === BLE_STATES.CONNECTED) {
        try {
          await this.sendCommand(buildRealtimeRequest(), 0x4144, 3000);
        } catch {
          // Polling retry on next tick
        }
      }
    }, 5000);
  }

  _stopTimers() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = null;
    }
  }

  _onNotification(event) {
    const value = event.target.value;
    const rawBytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const frames = this.accumulator.feed(rawBytes);

    for (const frame of frames) {
      const opcode = frameOpcode(frame);
      const hex = bytesToHex(frame);

      // Heartbeat ACK (0x2501) can be quietly ignored or logged
      if (opcode === 0x2501) {
        this._log('in', 'Heartbeat ACK', hex);
        continue;
      }

      this._log('in', `Отримано кадр [0x${opcode?.toString(16).padStart(4, '0')}]`, hex);

      // Resolve pending command promise if waiting for this opcode
      if (opcode && this._pendingResolvers.has(opcode)) {
        const queue = this._pendingResolvers.get(opcode);
        const item = queue.shift();
        if (queue.length === 0) {
          this._pendingResolvers.delete(opcode);
        }
        if (item) {
          clearTimeout(item.timeoutId);
          item.resolve(frame);
        }
      }

      // Parse payload by opcode
      this._dispatchFrame(opcode, frame);
    }
  }

  _dispatchFrame(opcode, frame) {
    switch (opcode) {
      case 0x4144: {
        const telemetry = parseRealtime(frame);
        if (telemetry) {
          this.info.lastReading = { ...telemetry, timestamp: new Date() };
          this.dispatchEvent(new CustomEvent('realtime', { detail: this.info.lastReading }));
        }
        break;
      }
      case 0x4143: {
        const settings = parseSettings(frame);
        if (settings) {
          this.info.alarmLow = settings.alarmLow;
          this.info.alarmHigh = settings.alarmHigh;
          this.info.screenOff = settings.screenOff;
          this.dispatchEvent(new CustomEvent('settings', { detail: settings }));
        }
        break;
      }
      case 0x2723: {
        const sound = parseSound(frame);
        if (sound !== null) {
          this.info.buzzerEnabled = sound;
          this.dispatchEvent(new CustomEvent('sound', { detail: { enabled: sound } }));
        }
        break;
      }
      case 0x216E: {
        const unit = parseTempUnit(frame);
        if (unit !== null) {
          this.info.tempUnitCelsius = unit;
          this.dispatchEvent(new CustomEvent('tempunit', { detail: { celsius: unit } }));
        }
        break;
      }
      case 0x2121: {
        const sku = parseSku(frame);
        if (sku) {
          this.info.sku = sku;
          this.dispatchEvent(new CustomEvent('deviceinfo', { detail: { sku } }));
        }
        break;
      }
      case 0x2123: {
        const fw = parseFirmware(frame);
        if (fw) {
          this.info.firmware = fw;
          this.dispatchEvent(new CustomEvent('deviceinfo', { detail: { firmware: fw } }));
        }
        break;
      }
    }
  }

  /**
   * Internal serialized write to BLE GATT characteristic
   */
  _writeRaw(packet) {
    this._writeQueue = this._writeQueue
      .then(async () => {
        if (!this.writeChar) throw new Error('Write characteristic unavailable');
        // Web Bluetooth writeValueWithResponse ensures reliability
        if ('writeValueWithResponse' in this.writeChar) {
          await this.writeChar.writeValueWithResponse(packet);
        } else {
          await this.writeChar.writeValue(packet);
        }
      })
      .catch((err) => {
        this._log('error', `Помилка запису в BLE: ${err.message}`);
        throw err;
      });

    return this._writeQueue;
  }

  /**
   * Send a command and optionally wait for matching response opcode
   * @param {Uint8Array} packet
   * @param {number|null} [expectedOpcode=null]
   * @param {number} [timeoutMs=3000]
   * @returns {Promise<Uint8Array|null>}
   */
  async sendCommand(packet, expectedOpcode = null, timeoutMs = 3000) {
    if (this.state !== BLE_STATES.CONNECTED) {
      throw new Error('Пристрій не підключено');
    }

    if (!expectedOpcode) {
      await this._writeRaw(packet);
      return null;
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this._pendingResolvers.has(expectedOpcode)) {
          const q = this._pendingResolvers.get(expectedOpcode);
          const idx = q.findIndex((item) => item.timeoutId === timeoutId);
          if (idx !== -1) {
            q.splice(idx, 1);
            if (q.length === 0) this._pendingResolvers.delete(expectedOpcode);
          }
        }
        reject(new Error(`Таймаут очікування відповіді 0x${expectedOpcode.toString(16)}`));
      }, timeoutMs);

      if (!this._pendingResolvers.has(expectedOpcode)) {
        this._pendingResolvers.set(expectedOpcode, []);
      }
      this._pendingResolvers.get(expectedOpcode).push({ resolve, reject, timeoutId });

      this._writeRaw(packet).catch((err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
    });
  }

  // ----------------------------------------------------------- High Level Actions

  /**
   * Toggle buzzer state (Killer feature)
   * @param {boolean} enable
   */
  async setBuzzer(enable) {
    this._log('out', `${enable ? 'Увімкнення' : 'Вимкнення'} зумера...`);
    const packet = buildSoundSetRequest(enable);
    await this.sendCommand(packet, 0x2743, 3000);
    this.info.buzzerEnabled = enable;
    this.dispatchEvent(new CustomEvent('sound', { detail: { enabled: enable } }));
    return enable;
  }

  /**
   * Sync device clock
   * @param {Date} [date=new Date()]
   * @param {boolean} [useUtc=false]
   */
  async syncTime(date = new Date(), useUtc = false) {
    this._log('out', `Синхронізація часу з ${useUtc ? 'UTC' : 'локальним'}: ${date.toLocaleString()}`);
    const packet = buildTimeSyncRequest(date, useUtc);
    await this.sendCommand(packet, 0x2342, 3000);
    this._log('info', 'Час успішно синхронізовано');
  }

  /**
   * Update alarm thresholds & screen timeout
   * @param {number} low CO2 ppm low alarm
   * @param {number} high CO2 ppm high alarm
   * @param {number} screenOff seconds (0 = always on, 120 = 2 min)
   */
  async setSettings(low, high, screenOff) {
    this._log('out', `Збереження налаштувань: Low=${low}, High=${high}, Screen=${screenOff}s`);
    const packet = buildSettingsSetRequest(low, high, screenOff);
    await this.sendCommand(packet, 0x4343, 3000);
    this.info.alarmLow = low;
    this.info.alarmHigh = high;
    this.info.screenOff = screenOff;
    this.dispatchEvent(new CustomEvent('settings', { detail: { alarmLow: low, alarmHigh: high, screenOff } }));
  }

  /**
   * Switch temperature unit on device screen
   * @param {boolean} celsius true for °C, false for °F
   */
  async setTempUnit(celsius) {
    this._log('out', `Перемикання одиниць температури на ${celsius ? '°C' : '°F'}`);
    const packet = buildTempUnitSetRequest(celsius);
    await this.sendCommand(packet, 0x2332, 3000);
    this.info.tempUnitCelsius = celsius;
    this.dispatchEvent(new CustomEvent('tempunit', { detail: { celsius } }));
  }

  /**
   * Fetch complete historical datalog (~90 days) from device SPI flash memory.
   * Pauses background telemetry polling during fetch to prevent GATT collision.
   * 
   * @param {Object} [options={}]
   * @param {boolean} [options.syncTimeFirst=true] Synchronize time before downloading
   * @param {Function} [options.onProgress] Callback ({ count, blockCount, blockAddress, isComplete, records })
   * @param {AbortSignal} [options.signal] AbortSignal for user cancellation
   * @returns {Promise<Array<{timestamp: number, time: Date, co2: number|null, temperature: number|null, humidity: number|null}>>}
   */
  async fetchDeviceHistory(options = {}) {
    const { syncTimeFirst = true, onProgress = null, signal = null } = options;

    if (this.state !== BLE_STATES.CONNECTED) {
      throw new Error('Пристрій не підключено');
    }

    if (this.isFetchingHistory) {
      throw new Error('Зчитування історії вже виконується');
    }

    this.isFetchingHistory = true;
    this._stopTimers();
    this._log('info', 'Початок зчитування архіву вимірювань з флеш-пам\'яті приладу...');

    try {
      if (syncTimeFirst) {
        try {
          this._log('info', 'Попередня синхронізація часу приладу...');
          await this.syncTime(new Date(), false);
          await new Promise((r) => setTimeout(r, 400));
        } catch (syncErr) {
          this._log('error', `Попередню синхронізацію часу пропущено: ${syncErr.message}`);
        }
      }

      let currentAddress = [0xFF, 0xFF, 0xFF, 0xFF];
      const allRecords = [];
      let blockCount = 0;

      while (true) {
        if (signal && signal.aborted) {
          this._log('info', 'Зчитування історії перервано користувачем');
          break;
        }

        const addrHex = bytesToHex(currentAddress);
        this._log('out', `Запит блоку історії: 0x${addrHex}`);

        const requestPacket = buildDataLogRequest(currentAddress);
        // Expect response opcode 0x2193 with 6-second timeout per block
        const responseFrame = await this.sendCommand(requestPacket, 0x2193, 6000);

        if (!responseFrame) {
          throw new Error(`Не вдалося отримати блок історії 0x${addrHex}`);
        }

        const parsed = parseDataLogResponse(responseFrame);
        if (!parsed) {
          throw new Error(`Помилка розбору блоку історії 0x${addrHex}`);
        }

        blockCount++;
        for (const rec of parsed.records) {
          allRecords.push(rec);
        }

        if (onProgress) {
          onProgress({
            count: allRecords.length,
            blockCount,
            blockAddress: addrHex,
            isComplete: parsed.isComplete,
            records: parsed.records,
          });
        }

        if (parsed.isComplete) {
          this._log('info', `Зчитування історії завершено! Всього блоків: ${blockCount}, записів: ${allRecords.length}`);
          break;
        }

        currentAddress = parsed.nextAddress;

        // Brief delay between blocks (200ms) to ensure GD32 MCU flash read & BLE stability
        await new Promise((r) => setTimeout(r, 200));
      }

      return allRecords;
    } finally {
      this.isFetchingHistory = false;
      if (this.state === BLE_STATES.CONNECTED) {
        this._startTimers();
      }
    }
  }

  /**
   * Disconnect from device
   */
  async disconnect() {
    this._setState(BLE_STATES.DISCONNECTING);
    this._log('info', 'Відключення...');
    this._cleanup();
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
    this._setState(BLE_STATES.DISCONNECTED);
  }

  _cleanup() {
    this.isFetchingHistory = false;
    this._stopTimers();
    this.accumulator.reset();
    for (const [, queue] of this._pendingResolvers) {
      for (const item of queue) {
        clearTimeout(item.timeoutId);
        item.reject(new Error('Пристрій відключено'));
      }
    }
    this._pendingResolvers.clear();
  }

  _onDisconnected() {
    this._log('info', 'Пристрій від\'єднано');
    this._cleanup();
    this._setState(BLE_STATES.DISCONNECTED);
  }
}
