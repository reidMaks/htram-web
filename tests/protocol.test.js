import { test, expect, describe } from 'bun:test';
import {
  FRAME_START,
  FRAME_END,
  crc16,
  buildFrame,
  frameIsValid,
  frameOpcode,
  expectedResponseOpcode,
  bytesToHex,
  hexToBytes,
  buildRealtimeRequest,
  buildHeartbeatRequest,
  buildSoundGetRequest,
  buildSoundSetRequest,
  buildSettingsGetRequest,
  buildSettingsSetRequest,
  buildTempUnitGetRequest,
  buildTempUnitSetRequest,
  buildSerialRequest,
  buildSkuRequest,
  buildFirmwareRequest,
  buildLinkStatusRequest,
  buildRadioModeRequest,
  buildTimeSyncRequest,
  parseRealtime,
  parseSettings,
  parseSound,
  parseTempUnit,
  parseSku,
  parseFirmware,
  parseLinkStatus,
  FrameAccumulator,
} from '../js/protocol.js';

describe('HTRAM Protocol Codec', () => {
  const KNOWN_FRAMES = [
    { name: 'realtime', built: buildRealtimeRequest(), expected: '7b41000740440200fc3e7d' },
    { name: 'heartbeat', built: buildHeartbeatRequest(), expected: '7b41000624010178227d' },
    { name: 'sound_status', built: buildSoundGetRequest(), expected: '7b4100072623010009c07d' },
    { name: 'sound off', built: buildSoundSetRequest(false), expected: '7b410009264301000000ab637d' },
    { name: 'sound on', built: buildSoundSetRequest(true), expected: '7b4100092643010000012b667d' },
    { name: 'temperature_unit', built: buildTempUnitGetRequest(), expected: '7b410007206e02067e307d' },
    { name: 'unit celsius', built: buildTempUnitSetRequest(true), expected: '7b4100082232020600a9e37d' },
    { name: 'unit fahrenheit', built: buildTempUnitSetRequest(false), expected: '7b410008223202060129e67d' },
    { name: 'serial_number', built: buildSerialRequest(), expected: '7b410006202003be7e7d' },
    { name: 'sku', built: buildSkuRequest(), expected: '7b410006202101b8727d' },
    { name: 'firmware_version', built: buildFirmwareRequest(), expected: '7b41000620230134717d' },
    { name: 'link_status', built: buildLinkStatusRequest(), expected: '7b410006740002fa6b7d' },
    { name: 'radio ble', built: buildRadioModeRequest(false), expected: '7b4100087458010100ab5d7d' },
    { name: 'radio wifi', built: buildRadioModeRequest(true), expected: '7b41000874580101012b587d' },
    { name: 'settings', built: buildSettingsGetRequest(), expected: '7b410009404304006006bf117d' },
  ];

  test.each(KNOWN_FRAMES)('matches known frame: $name', ({ built, expected }) => {
    expect(bytesToHex(built)).toBe(expected);
    expect(frameIsValid(built)).toBe(true);
  });

  test('CRC-16 validation against corruption', () => {
    const frame = new Uint8Array(buildRealtimeRequest());
    frame[6] ^= 0xFF;
    expect(frameIsValid(frame)).toBe(false);
  });

  test('expected response opcode is request + 0x0100', () => {
    expect(expectedResponseOpcode([0x40, 0x44])).toBe(0x4144);
    expect(expectedResponseOpcode([0x26, 0x23])).toBe(0x2723);
    expect(expectedResponseOpcode([0x20, 0x21])).toBe(0x2121);
    expect(expectedResponseOpcode([0x74, 0x60])).toBe(0x7560);
  });

  test('time sync frame construction', () => {
    const testDate = new Date(Date.UTC(2026, 8, 1, 22, 15, 30)); // 2026-09-01 22:15:30 UTC
    const frame = buildTimeSyncRequest(testDate, true);
    expect(frameIsValid(frame)).toBe(true);
    expect(frame[4]).toBe(0x22);
    expect(frame[5]).toBe(0x42);
    // Body: 01 YY MM DD HH MM SS
    expect(Array.from(frame.subarray(6, 13))).toEqual([1, 26, 9, 1, 22, 15, 30]);
  });

  test('settings set frame construction', () => {
    const frame = buildSettingsSetRequest(800, 1000, 15);
    expect(frameIsValid(frame)).toBe(true);
    expect(frame[4]).toBe(0x42);
    expect(frame[5]).toBe(0x43);
    expect(Array.from(frame.subarray(6, 10))).toEqual([0x04, 0x00, 0x40, 0x06]);
    // Low: 800 = 0x0320, High: 1000 = 0x03e8, Screen: 15 = 0x000f
    expect(Array.from(frame.subarray(10, 16))).toEqual([0x03, 0x20, 0x03, 0xe8, 0x00, 0x0f]);
  });
});

describe('HTRAM Response Parsers', () => {
  test('parseRealtime valid values', () => {
    // 0x4144 response with body: 02, CO2=550 (0x0226), T=23, H=58, Bat=4, Chg=1
    const frame = buildFrame([0x41, 0x44], [0x02, 0x02, 0x26, 23, 58, 4, 1]);
    const reading = parseRealtime(frame);
    expect(reading).toEqual({
      co2: 550,
      temperature: 23,
      humidity: 58,
      battery: 100,
      batteryBars: 4,
      charging: true,
    });
  });

  test('parseRealtime handles warm-up sentinels', () => {
    const frame = buildFrame([0x41, 0x44], [0x02, 0xFF, 0xFE, 0x81, 0xFE, 0, 0]);
    const reading = parseRealtime(frame);
    expect(reading).toEqual({
      co2: null,
      temperature: null,
      humidity: null,
      battery: 0,
      batteryBars: 0,
      charging: false,
    });
  });

  test('parseRealtime handles negative temperatures', () => {
    // 251 as uint8 = -5 signed
    const frame = buildFrame([0x41, 0x44], [0x02, 0x01, 0x90, 251, 40, 2, 0]);
    const reading = parseRealtime(frame);
    expect(reading?.temperature).toBe(-5);
    expect(reading?.battery).toBe(50);
  });

  test('parseSettings parses thresholds and screen timer', () => {
    // low 1234 (0x04D2), high 1500 (0x05DC), screen 30 (0x001E)
    const frame = buildFrame([0x41, 0x43], [0x04, 0x04, 0xD2, 0x05, 0xDC, 0x00, 0x1E]);
    const settings = parseSettings(frame);
    expect(settings).toEqual({
      alarmLow: 1234,
      alarmHigh: 1500,
      screenOff: 30,
    });
  });

  test('parseSound decodes buzzer status', () => {
    const onFrame = buildFrame([0x27, 0x23], [0x01, 0x00, 0x00, 0x01]);
    const offFrame = buildFrame([0x27, 0x23], [0x01, 0x00, 0x00, 0x00]);
    expect(parseSound(onFrame)).toBe(true);
    expect(parseSound(offFrame)).toBe(false);
  });

  test('parseTempUnit decodes Celsius / Fahrenheit', () => {
    const cFrame = buildFrame([0x21, 0x6E], [0x02, 0x06, 0x00, 0x00]);
    const fFrame = buildFrame([0x21, 0x6E], [0x02, 0x06, 0x00, 0x01]);
    expect(parseTempUnit(cFrame)).toBe(true);
    expect(parseTempUnit(fFrame)).toBe(false);
  });

  test('parseSku decodes hex as decimal string', () => {
    const frame = buildFrame([0x21, 0x21], [0x01, 0x06, 0x51]);
    expect(parseSku(frame)).toBe('1617');
  });

  test('parseFirmware decodes ASCII string', () => {
    const frame = buildFrame([0x21, 0x23], [0x01, ...new TextEncoder().encode('V1.00 ')]);
    expect(parseFirmware(frame)).toBe('V1.00');
  });
});

describe('FrameAccumulator', () => {
  test('reassembles split frames across notifications', () => {
    const whole = hexToBytes('7b410007750002007d647d');
    const part1 = whole.subarray(0, 5);
    const part2 = whole.subarray(5);

    const acc = new FrameAccumulator();
    const frames1 = acc.feed(part1);
    expect(frames1.length).toBe(0);

    const frames2 = acc.feed(part2);
    expect(frames2.length).toBe(1);
    expect(bytesToHex(frames2[0])).toBe('7b410007750002007d647d');
  });

  test('splits concatenated frames received in single notification', () => {
    const frame1 = hexToBytes('7b410006250101f8357d');
    const frame2 = hexToBytes('7b410007750002007d647d');
    const combined = new Uint8Array([...frame1, ...frame2]);

    const acc = new FrameAccumulator();
    const frames = acc.feed(combined);
    expect(frames.length).toBe(2);
    expect(bytesToHex(frames[0])).toBe('7b410006250101f8357d');
    expect(bytesToHex(frames[1])).toBe('7b410007750002007d647d');
  });

  test('recovers from leading garbage', () => {
    const valid = hexToBytes('7b410006250101f8357d');
    const noisy = new Uint8Array([0x00, 0xFF, 0x12, ...valid]);

    const acc = new FrameAccumulator();
    const frames = acc.feed(noisy);
    expect(frames.length).toBe(1);
    expect(bytesToHex(frames[0])).toBe('7b410006250101f8357d');
  });
});
