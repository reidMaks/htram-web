/**
 * HTRAM Web Configurator & Monitor
 * Wire protocol implementation for Honeywell Transmission Risk Air Monitor (HTRAM-V1-W).
 * 
 * Frame Format:
 *   7B 41 00 <len> <cmd_be_u16> <body...> <crc16_be_u16> 7D
 * 
 * Length byte = 2 (cmd) + len(body) + 3 (crc16 + 0x7D). Total frame = 4 + len.
 * CRC-16: polynomial 0x8005, initial 0x0000, MSB-first.
 */

export const FRAME_START = 0x7B;
export const FRAME_END = 0x7D;
export const FRAME_TYPE = 0x41;

export const CRC_POLY = 0x8005;

export const SERVICE_UUID = 'fc247940-6e08-11e4-80fc-0002a5d5c51b';
export const WRITE_UUID = '3d115840-6e0b-11e4-b24f-0002a5d5c51b';
export const NOTIFY_UUID = 'f833d6c0-6e0b-11e4-9136-0002a5d5c51b';

// Sentinels during sensor warm-up
export const CO2_INVALID = 0xFFFE;
export const TEMP_INVALID = 0x81;
export const HUM_INVALID = 0xFE;

// Protocol command opcodes (Big-Endian uint16)
export const CMD_REALTIME = [0x40, 0x44];
export const CMD_HEARTBEAT = [0x24, 0x01];
export const CMD_SOUND_GET = [0x26, 0x23];
export const CMD_SOUND_SET = [0x26, 0x43];
export const CMD_SETTINGS_GET = [0x40, 0x43];
export const CMD_SETTINGS_SET = [0x42, 0x43];
export const CMD_TEMP_UNIT_GET = [0x20, 0x6E];
export const CMD_TEMP_UNIT_SET = [0x22, 0x32];
export const CMD_SERIAL = [0x20, 0x20];
export const CMD_SKU = [0x20, 0x21];
export const CMD_FIRMWARE = [0x20, 0x23];
export const CMD_LINK_STATUS = [0x74, 0x00];
export const CMD_RADIO_MODE = [0x74, 0x58];
export const CMD_TIME_SYNC = [0x22, 0x42];

// Precompute CRC-16 table (0x8005, MSB-first)
function buildCrc16Table(poly = CRC_POLY) {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? (((crc << 1) ^ poly) & 0xFFFF) : ((crc << 1) & 0xFFFF);
    }
    table[i] = crc;
  }
  return table;
}

export const CRC16_TABLE = buildCrc16Table();

/**
 * Calculate CRC-16 (poly 0x8005, init 0, MSB-first)
 * @param {Uint8Array|Array<number>} data
 * @returns {number} uint16
 */
export function crc16(data) {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ data[i]) & 0xFF]) & 0xFFFF;
  }
  return crc;
}

/**
 * Build a full vendor frame: 7B 41 00 <len> <cmd> <body> <crc16 BE> 7D
 * @param {Array<number>|Uint8Array} cmd 2 bytes
 * @param {Array<number>|Uint8Array} [body=[]]
 * @returns {Uint8Array}
 */
export function buildFrame(cmd, body = []) {
  const cmdArr = Array.from(cmd);
  const bodyArr = Array.from(body);
  const length = 2 + bodyArr.length + 3;
  if (length > 0xFF) {
    throw new Error(`Body length too large: ${bodyArr.length}`);
  }

  const preCrc = new Uint8Array(4 + 2 + bodyArr.length);
  preCrc[0] = FRAME_START;
  preCrc[1] = FRAME_TYPE;
  preCrc[2] = 0x00;
  preCrc[3] = length;
  preCrc[4] = cmdArr[0];
  preCrc[5] = cmdArr[1];
  for (let i = 0; i < bodyArr.length; i++) {
    preCrc[6 + i] = bodyArr[i];
  }

  const crc = crc16(preCrc);
  const frame = new Uint8Array(preCrc.length + 3);
  frame.set(preCrc, 0);
  frame[frame.length - 3] = (crc >> 8) & 0xFF;
  frame[frame.length - 2] = crc & 0xFF;
  frame[frame.length - 1] = FRAME_END;
  return frame;
}

/**
 * Verify frame start, end delimiters and CRC-16
 * @param {Uint8Array} frame
 * @returns {boolean}
 */
export function frameIsValid(frame) {
  if (!frame || frame.length < 8) return false;
  if (frame[0] !== FRAME_START || frame[frame.length - 1] !== FRAME_END) return false;
  const expectedCrc = (frame[frame.length - 3] << 8) | frame[frame.length - 2];
  const actualCrc = crc16(frame.subarray(0, frame.length - 3));
  return expectedCrc === actualCrc;
}

/**
 * Get opcode of a frame as uint16
 * @param {Uint8Array} frame
 * @returns {number|null}
 */
export function frameOpcode(frame) {
  if (!frame || frame.length < 6) return null;
  return (frame[4] << 8) | frame[5];
}

/**
 * Calculate expected response opcode for a given command opcode (cmd + 0x0100)
 * @param {number|Array<number>} cmd
 * @returns {number} uint16
 */
export function expectedResponseOpcode(cmd) {
  const opcode = Array.isArray(cmd) ? ((cmd[0] << 8) | cmd[1]) : cmd;
  return (opcode + 0x0100) & 0xFFFF;
}

/**
 * Convert bytes to hex string
 * @param {Uint8Array|Array<number>} bytes
 * @returns {string}
 */
export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
  const cleanHex = hex.replace(/\s+/g, '');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
  }
  return bytes;
}

// ------------------------------------------------------------- Command Builders

export function buildRealtimeRequest() {
  return buildFrame(CMD_REALTIME, [0x02, 0x00]);
}

export function buildHeartbeatRequest() {
  return buildFrame(CMD_HEARTBEAT, [0x01]);
}

export function buildSoundGetRequest() {
  return buildFrame(CMD_SOUND_GET, [0x01, 0x00]);
}

export function buildSoundSetRequest(enabled) {
  return buildFrame(CMD_SOUND_SET, [0x01, 0x00, 0x00, enabled ? 0x01 : 0x00]);
}

export function buildSettingsGetRequest() {
  return buildFrame(CMD_SETTINGS_GET, [0x04, 0x00, 0x60, 0x06]);
}

export function buildSettingsSetRequest(low, high, screenOff) {
  return buildFrame(CMD_SETTINGS_SET, [
    0x04, 0x00, 0x40, 0x06,
    (low >> 8) & 0xFF, low & 0xFF,
    (high >> 8) & 0xFF, high & 0xFF,
    (screenOff >> 8) & 0xFF, screenOff & 0xFF,
  ]);
}

export function buildScreenOffSetRequest(minutes) {
  return buildFrame(CMD_SETTINGS_SET, [
    0x04, 0x00, 0x20, 0x00,
    (minutes >> 8) & 0xFF, minutes & 0xFF,
  ]);
}

export function buildTempUnitGetRequest() {
  return buildFrame(CMD_TEMP_UNIT_GET, [0x02, 0x06]);
}

export function buildTempUnitSetRequest(celsius) {
  return buildFrame(CMD_TEMP_UNIT_SET, [0x02, 0x06, celsius ? 0x00 : 0x01]);
}

export function buildSerialRequest() {
  return buildFrame(CMD_SERIAL, [0x03]);
}

export function buildSkuRequest() {
  return buildFrame(CMD_SKU, [0x01]);
}

export function buildFirmwareRequest() {
  return buildFrame(CMD_FIRMWARE, [0x01]);
}

export function buildLinkStatusRequest() {
  return buildFrame(CMD_LINK_STATUS, [0x02]);
}

export function buildRadioModeRequest(wifi) {
  return buildFrame(CMD_RADIO_MODE, [0x01, 0x01, wifi ? 0x01 : 0x00]);
}

/**
 * Sync device clock to a given Date (defaults to local time so desk clock matches)
 * Format: 01 YY MM DD HH MM SS as plain decimal integers
 * @param {Date} [date=new Date()]
 * @param {boolean} [useUtc=false]
 * @returns {Uint8Array}
 */
export function buildTimeSyncRequest(date = new Date(), useUtc = false) {
  const year = (useUtc ? date.getUTCFullYear() : date.getFullYear()) % 100;
  const month = (useUtc ? date.getUTCMonth() : date.getMonth()) + 1;
  const day = useUtc ? date.getUTCDate() : date.getDate();
  const hour = useUtc ? date.getUTCHours() : date.getHours();
  const minute = useUtc ? date.getUTCMinutes() : date.getMinutes();
  const second = useUtc ? date.getUTCSeconds() : date.getSeconds();

  return buildFrame(CMD_TIME_SYNC, [0x01, year, month, day, hour, minute, second]);
}

// ------------------------------------------------------------- Response Parsers

/**
 * Parse 0x4144 realtime response
 * @param {Uint8Array} frame
 * @returns {{co2: number|null, temperature: number|null, humidity: number|null, battery: number, batteryBars: number, charging: boolean}|null}
 */
export function parseRealtime(frame) {
  if (!frame || frame.length < 13) return null;
  const co2Raw = (frame[7] << 8) | frame[8];
  const tempRaw = frame[9];
  const temp = tempRaw > 128 ? tempRaw - 256 : tempRaw;
  const humidity = frame[10];
  const batteryBars = frame[11];
  const charging = frame[12] === 1;

  return {
    co2: co2Raw === CO2_INVALID ? null : co2Raw,
    temperature: tempRaw === TEMP_INVALID ? null : temp,
    humidity: humidity === HUM_INVALID ? null : humidity,
    battery: Math.min(batteryBars * 25, 100),
    batteryBars: batteryBars,
    charging: charging,
  };
}

/**
 * Parse 0x4143 settings response
 * @param {Uint8Array} frame
 * @returns {{alarmLow: number, alarmHigh: number, screenOff: number}|null}
 */
export function parseSettings(frame) {
  if (!frame || frame.length < 13) return null;
  const alarmLow = (frame[7] << 8) | frame[8];
  const alarmHigh = (frame[9] << 8) | frame[10];
  const screenOff = (frame[11] << 8) | frame[12];
  return { alarmLow, alarmHigh, screenOff };
}

/**
 * Parse 0x2723 sound status response
 * @param {Uint8Array} frame
 * @returns {boolean|null} true = sound enabled, false = sound muted
 */
export function parseSound(frame) {
  if (!frame || frame.length < 10) return null;
  return frame[9] !== 0;
}

/**
 * Parse 0x216E temperature unit response
 * @param {Uint8Array} frame
 * @returns {boolean|null} true = Celsius, false = Fahrenheit
 */
export function parseTempUnit(frame) {
  if (!frame || frame.length < 10) return null;
  return frame[9] === 0;
}

/**
 * Parse 0x2121 SKU response
 * @param {Uint8Array} frame
 * @returns {string|null}
 */
export function parseSku(frame) {
  if (!frame || frame.length < 9) return null;
  const hex = ((frame[7] << 8) | frame[8]).toString(16).padStart(4, '0');
  return parseInt(hex, 16).toString();
}

/**
 * Parse 0x2123 Firmware version response
 * @param {Uint8Array} frame
 * @returns {string|null}
 */
export function parseFirmware(frame) {
  if (!frame || frame.length < 13) return null;
  try {
    const text = new TextDecoder('ascii')
      .decode(frame.subarray(7, 13))
      .replace(/\0/g, '')
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Parse 0x7500 Link status response
 * @param {Uint8Array} frame
 * @returns {number|null}
 */
export function parseLinkStatus(frame) {
  if (!frame || frame.length < 8) return null;
  return frame[7];
}

// ------------------------------------------------------------- Frame Reassembly

/**
 * FrameAccumulator collects incoming notification chunks, handles packet
 * fragmentation, coalescing, and synchronization.
 */
export class FrameAccumulator {
  constructor() {
    this._buffer = [];
  }

  /**
   * Feed new raw bytes into accumulator
   * @param {Uint8Array|Array<number>} data
   * @returns {Array<Uint8Array>} Array of complete, valid frames extracted
   */
  feed(data) {
    for (let i = 0; i < data.length; i++) {
      this._buffer.push(data[i]);
    }

    const frames = [];
    while (true) {
      const startIdx = this._buffer.indexOf(FRAME_START);
      if (startIdx < 0) {
        this._buffer = [];
        break;
      }

      if (startIdx > 0) {
        this._buffer.splice(0, startIdx);
      }

      if (this._buffer.length < 4) {
        break;
      }

      const lengthByte = this._buffer[3];
      const totalLen = 4 + lengthByte;

      if (this._buffer.length < totalLen) {
        break;
      }

      const candidate = new Uint8Array(this._buffer.slice(0, totalLen));
      this._buffer.splice(0, totalLen);

      if (candidate[candidate.length - 1] === FRAME_END) {
        if (frameIsValid(candidate)) {
          frames.push(candidate);
        }
      } else {
        // Corrupted length byte: drop frame start and resync
        this._buffer.unshift(...candidate.subarray(1));
      }
    }

    return frames;
  }

  /**
   * Reset buffer
   */
  reset() {
    this._buffer = [];
  }
}
