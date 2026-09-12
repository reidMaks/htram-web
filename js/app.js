/**
 * HTRAM Web Configurator & Monitor
 * Main Application Logic
 */

import { BleClient, BLE_STATES } from './ble.js';

// DOM Elements: Header & Alerts
const unsupportedAlert = document.getElementById('unsupportedAlert');
const btnCloseHelpAlert = document.getElementById('btnCloseHelpAlert');
const btnToggleHelp = document.getElementById('btnToggleHelp');

// DOM Elements: Connection Status
const statusDot = document.getElementById('statusDot');
const statusTitle = document.getElementById('statusTitle');
const statusSubtitle = document.getElementById('statusSubtitle');
const deviceMetaArea = document.getElementById('deviceMetaArea');
const badgeSku = document.getElementById('badgeSku');
const badgeFw = document.getElementById('badgeFw');
const badgeBattery = document.getElementById('badgeBattery');

const btnConnect = document.getElementById('btnConnect');
const btnDisconnect = document.getElementById('btnDisconnect');
const chkAcceptAll = document.getElementById('chkAcceptAll');

// DOM Elements: Buzzer Control
const cardBuzzer = document.getElementById('cardBuzzer');
const buzzerIcon = document.getElementById('buzzerIcon');
const buzzerText = document.getElementById('buzzerText');
const buzzerSubtext = document.getElementById('buzzerSubtext');
const btnToggleBuzzer = document.getElementById('btnToggleBuzzer');

// DOM Elements: Live Telemetry
const telemetryUpdateBadge = document.getElementById('telemetryUpdateBadge');
const cardCo2 = document.getElementById('cardCo2');
const valCo2 = document.getElementById('valCo2');
const barCo2 = document.getElementById('barCo2');
const co2StatusBadge = document.getElementById('co2StatusBadge');
const co2FooterLegend = document.getElementById('co2FooterLegend');

const valTemp = document.getElementById('valTemp');
const valTempUnit = document.getElementById('valTempUnit');
const tempComfortStatus = document.getElementById('tempComfortStatus');

const valHumidity = document.getElementById('valHumidity');
const humidityComfortStatus = document.getElementById('humidityComfortStatus');

const valBatteryPercent = document.getElementById('valBatteryPercent');
const batterySegments = document.getElementById('batterySegments').children;
const chargingBadge = document.getElementById('chargingBadge');
const batteryStatusText = document.getElementById('batteryStatusText');

// DOM Elements: Telemetry History & Export
const btnExportCsv = document.getElementById('btnExportCsv');
const btnClearHistory = document.getElementById('btnClearHistory');
const historyChart = document.getElementById('historyChart');
const chartPlaceholder = document.getElementById('chartPlaceholder');
const statMinCo2 = document.getElementById('statMinCo2');
const statAvgCo2 = document.getElementById('statAvgCo2');
const statMaxCo2 = document.getElementById('statMaxCo2');
const statCount = document.getElementById('statCount');
const statDuration = document.getElementById('statDuration');

// DOM Elements: Settings
const inputAlarmLow = document.getElementById('inputAlarmLow');
const inputAlarmHigh = document.getElementById('inputAlarmHigh');
const selectScreenOff = document.getElementById('selectScreenOff');
const selectDeviceTempUnit = document.getElementById('selectDeviceTempUnit');
const btnSyncTime = document.getElementById('btnSyncTime');
const btnSaveSettings = document.getElementById('btnSaveSettings');

// DOM Elements: Console Drawer & Modal
const consoleToggle = document.getElementById('consoleToggle');
const consoleToggleIcon = document.getElementById('consoleToggleIcon');
const consoleLog = document.getElementById('consoleLog');

const donateModal = document.getElementById('donateModal');
const btnOpenDonate = document.getElementById('btnOpenDonate');
const btnCloseDonate = document.getElementById('btnCloseDonate');
const toastContainer = document.getElementById('toastContainer');

// State
const ble = new BleClient();
let lastRawTemperature = null;
let hasShownMuteDonatePrompt = false;

// History state
const telemetryHistory = [];
let sessionStartTime = null;
let sessionDurationInterval = null;

// ------------------------------------------------------------- Initialization

async function init() {
  await checkBluetoothSupport();
  setupEventListeners();
  window.addEventListener('resize', () => renderHistoryChart());
}

async function checkBluetoothSupport() {
  const isSupported = BleClient.isSupported();

  const currentOriginSnippet = document.getElementById('currentOriginSnippet');
  if (currentOriginSnippet) {
    currentOriginSnippet.textContent = window.location.origin;
  }

  // Detect Brave
  try {
    const isBrave = (navigator.brave && typeof navigator.brave.isBrave === 'function' && await navigator.brave.isBrave())
      || navigator.userAgent.includes('Brave');

    if (isBrave) {
      const guideBrave = document.getElementById('guideBrave');
      if (guideBrave) {
        guideBrave.style.borderColor = 'rgba(245, 158, 11, 0.6)';
        guideBrave.style.background = 'rgba(245, 158, 11, 0.18)';
        guideBrave.querySelector('h4').textContent += ' (Виявлено ваш браузер!)';
      }
    }
  } catch {
    // Ignore detection errors
  }

  if (!isSupported) {
    unsupportedAlert.style.display = 'flex';
    btnConnect.disabled = true;
    showToast('⚠️ Web Bluetooth API вимкнено або не підтримується. Перегляньте інструкцію вище.', 8000);
  }
}

function setupEventListeners() {
  // Help Toggle
  if (btnToggleHelp) {
    btnToggleHelp.addEventListener('click', () => {
      const isVisible = unsupportedAlert.style.display !== 'none' && unsupportedAlert.style.display !== '';
      unsupportedAlert.style.display = isVisible ? 'none' : 'flex';
      btnToggleHelp.querySelector('span').textContent = isVisible ? '❓ Інструкція з Bluetooth' : '✖ Приховати інструкцію';
      if (!isVisible) {
        unsupportedAlert.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  if (btnCloseHelpAlert) {
    btnCloseHelpAlert.addEventListener('click', () => {
      unsupportedAlert.style.display = 'none';
      if (btnToggleHelp) {
        btnToggleHelp.querySelector('span').textContent = '❓ Інструкція з Bluetooth';
      }
    });
  }

  // Connect / Disconnect
  btnConnect.addEventListener('click', async () => {
    try {
      await ble.connect(chkAcceptAll.checked);
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        showToast(`Помилка підключення: ${err.message}`, 5000);
      }
    }
  });

  btnDisconnect.addEventListener('click', async () => {
    await ble.disconnect();
  });

  // BLE Events
  ble.addEventListener('statechange', (e) => updateConnectionState(e.detail.state));
  ble.addEventListener('realtime', (e) => updateTelemetryUI(e.detail));
  ble.addEventListener('sound', (e) => updateBuzzerUI(e.detail.enabled));
  ble.addEventListener('settings', (e) => updateSettingsUI(e.detail));
  ble.addEventListener('tempunit', (e) => updateDeviceTempUnitUI(e.detail.celsius));
  ble.addEventListener('deviceinfo', (e) => updateDeviceInfoUI(e.detail));
  ble.addEventListener('log', (e) => appendLog(e.detail));

  // Buzzer Toggle Action
  btnToggleBuzzer.addEventListener('click', async () => {
    const currentState = ble.info.buzzerEnabled;
    const targetState = !currentState;
    btnToggleBuzzer.disabled = true;

    try {
      await ble.setBuzzer(targetState);
      if (!targetState) {
        showToast('🎉 Зумер вимкнено! Більше жодного набридливого пищання.');
        if (!hasShownMuteDonatePrompt) {
          hasShownMuteDonatePrompt = true;
          setTimeout(() => openDonateModal(), 1200);
        }
      } else {
        showToast('🔊 Зумер увімкнено.');
      }
    } catch (err) {
      showToast(`Не вдалося змінити стан зумера: ${err.message}`, 5000);
    } finally {
      btnToggleBuzzer.disabled = false;
    }
  });

  // Time Sync Action
  btnSyncTime.addEventListener('click', async () => {
    btnSyncTime.disabled = true;
    try {
      await ble.syncTime(new Date(), false);
      showToast('⏱ Точний час успішно передано у прилад!');
    } catch (err) {
      showToast(`Помилка синхронізації часу: ${err.message}`, 5000);
    } finally {
      btnSyncTime.disabled = false;
    }
  });

  // Save Settings Action
  btnSaveSettings.addEventListener('click', async () => {
    const low = parseInt(inputAlarmLow.value, 10);
    const high = parseInt(inputAlarmHigh.value, 10);
    const screen = parseInt(selectScreenOff.value, 10);
    const isCelsius = selectDeviceTempUnit.value === 'C';

    if (isNaN(low) || isNaN(high) || low >= high) {
      showToast('⚠️ Поріг Low має бути меншим за High!');
      return;
    }

    btnSaveSettings.disabled = true;
    try {
      await ble.setSettings(low, high, screen);
      if (ble.info.tempUnitCelsius !== isCelsius) {
        await ble.setTempUnit(isCelsius);
      }
      showToast('💾 Налаштування успішно збережено у пам\'ять пристрою!');
      if (ble.info.lastReading) {
        updateTelemetryUI(ble.info.lastReading);
      }
      renderHistoryChart();
    } catch (err) {
      showToast(`Помилка збереження налаштувань: ${err.message}`, 5000);
    } finally {
      btnSaveSettings.disabled = false;
    }
  });

  // Dynamic threshold inputs reaction
  inputAlarmLow.addEventListener('input', () => {
    if (ble.info.lastReading) updateTelemetryUI(ble.info.lastReading);
    renderHistoryChart();
  });
  inputAlarmHigh.addEventListener('input', () => {
    if (ble.info.lastReading) updateTelemetryUI(ble.info.lastReading);
    renderHistoryChart();
  });

  // Temperature unit selection change
  selectDeviceTempUnit.addEventListener('change', () => {
    ble.info.tempUnitCelsius = selectDeviceTempUnit.value === 'C';
    if (lastRawTemperature !== null) {
      renderTemperature(lastRawTemperature);
    }
  });

  // History Actions
  btnExportCsv.addEventListener('click', () => exportTelemetryCsv());
  btnClearHistory.addEventListener('click', () => {
    if (confirm('Очистити накопичені точки історії вимірювань поточної сесії?')) {
      clearTelemetryHistory();
    }
  });

  // Console Drawer toggle
  consoleToggle.addEventListener('click', () => {
    const isHidden = consoleLog.style.display === 'none';
    consoleLog.style.display = isHidden ? 'flex' : 'none';
    consoleToggleIcon.textContent = isHidden ? '▲' : '▼';
  });

  // Donate Modal
  btnOpenDonate.addEventListener('click', () => openDonateModal());
  btnCloseDonate.addEventListener('click', () => closeDonateModal());
  donateModal.addEventListener('click', (e) => {
    if (e.target === donateModal) closeDonateModal();
  });
}

// ------------------------------------------------------------- Helpers & State

function getActiveThresholds() {
  const low = parseInt(inputAlarmLow.value, 10) || ble.info.alarmLow || 800;
  const high = parseInt(inputAlarmHigh.value, 10) || ble.info.alarmHigh || 1000;
  return { low, high };
}

function updateConnectionState(state) {
  statusDot.className = 'status-dot';

  switch (state) {
    case BLE_STATES.CONNECTED:
      statusDot.classList.add('connected');
      statusTitle.textContent = `Підключено: ${ble.info.name || 'HTRAM'}`;
      statusSubtitle.textContent = 'Зв\'язок активний, отримання даних у реальному часі';
      btnConnect.style.display = 'none';
      btnDisconnect.style.display = 'inline-flex';
      deviceMetaArea.style.display = 'flex';
      setControlsEnabled(true);

      // Start session duration timer
      if (!sessionStartTime) {
        sessionStartTime = new Date();
        startDurationTimer();
      }
      break;

    case BLE_STATES.CONNECTING:
      statusDot.classList.add('connecting');
      statusTitle.textContent = 'Підключення...';
      statusSubtitle.textContent = 'Встановлення GATT сесії з Honeywell HTRAM';
      btnConnect.disabled = true;
      break;

    case BLE_STATES.DISCONNECTED:
    default:
      statusTitle.textContent = 'Пристрій не підключено';
      statusSubtitle.textContent = 'Увімкніть Bluetooth та двічі натисніть кнопку на HTRAM';
      btnConnect.style.display = 'inline-flex';
      btnConnect.disabled = false;
      btnDisconnect.style.display = 'none';
      deviceMetaArea.style.display = 'none';
      setControlsEnabled(false);
      resetTelemetryUI();
      stopDurationTimer();
      break;
  }
}

function setControlsEnabled(enabled) {
  btnToggleBuzzer.disabled = !enabled;
  btnSyncTime.disabled = !enabled;
  btnSaveSettings.disabled = !enabled;
  inputAlarmLow.disabled = !enabled;
  inputAlarmHigh.disabled = !enabled;
  selectScreenOff.disabled = !enabled;
  selectDeviceTempUnit.disabled = !enabled;
}

function updateBuzzerUI(enabled) {
  cardBuzzer.className = 'card card-buzzer';

  if (enabled) {
    cardBuzzer.classList.add('buzzer-active');
    buzzerIcon.textContent = '🔊';
    buzzerText.textContent = 'Звук увімкнено';
    buzzerSubtext.textContent = 'Зумер подає звуковий сигнал при перевищенні порогів CO₂';
    btnToggleBuzzer.className = 'btn btn-danger btn-buzzer-toggle';
    btnToggleBuzzer.innerHTML = '<span>🔕 Вимкнути зумер</span>';
  } else {
    cardBuzzer.classList.add('buzzer-muted');
    buzzerIcon.textContent = '🔕';
    buzzerText.textContent = 'Зумер вимкнено (тихий режим)';
    buzzerSubtext.textContent = 'Звуковий сигнал вимкнено. Прилад повністю безшумний!';
    btnToggleBuzzer.className = 'btn btn-outline btn-buzzer-toggle';
    btnToggleBuzzer.innerHTML = '<span>🔔 Увімкнути зумер</span>';
  }
}

// ------------------------------------------------------------- Telemetry & History

function updateTelemetryUI(data) {
  telemetryUpdateBadge.textContent = `Оновлено: ${data.timestamp.toLocaleTimeString()}`;
  const { low, high } = getActiveThresholds();

  // Dynamic footer legend
  if (co2FooterLegend) {
    co2FooterLegend.textContent = `< ${low} свіже • ${low}–${high} увага • > ${high} тривога`;
  }

  // 1. CO2
  if (data.co2 === null) {
    valCo2.textContent = 'Прогрів';
    co2StatusBadge.textContent = 'Ініціалізація NDIR...';
    cardCo2.className = 'telemetry-card telemetry-card-co2';
    barCo2.style.width = '0%';
  } else {
    valCo2.textContent = data.co2;
    const maxCo2 = Math.max(2000, high + 500);
    const percent = Math.min(100, Math.max(0, ((data.co2 - 400) / (maxCo2 - 400)) * 100));
    barCo2.style.width = `${percent}%`;

    cardCo2.className = 'telemetry-card telemetry-card-co2';
    if (data.co2 < low) {
      cardCo2.classList.add('co2-good');
      barCo2.style.backgroundColor = 'var(--accent-emerald)';
      co2StatusBadge.textContent = '🟢 Свіже повітря';
      co2StatusBadge.style.color = 'var(--accent-emerald)';
    } else if (data.co2 <= high) {
      cardCo2.classList.add('co2-warning');
      barCo2.style.backgroundColor = 'var(--accent-amber)';
      co2StatusBadge.textContent = '🟡 Увага (провітріть)';
      co2StatusBadge.style.color = 'var(--accent-amber)';
    } else {
      cardCo2.classList.add('co2-danger');
      barCo2.style.backgroundColor = 'var(--accent-rose)';
      co2StatusBadge.textContent = '🔴 Високий CO₂!';
      co2StatusBadge.style.color = 'var(--accent-rose)';
    }
  }

  // 2. Temperature
  lastRawTemperature = data.temperature;
  renderTemperature(data.temperature);

  // 3. Humidity
  if (data.humidity === null) {
    valHumidity.textContent = '--';
    humidityComfortStatus.textContent = 'Датчик вологості';
  } else {
    valHumidity.textContent = data.humidity;
    if (data.humidity >= 40 && data.humidity <= 60) {
      humidityComfortStatus.textContent = 'Оптимальна (40-60%)';
      humidityComfortStatus.style.color = 'var(--accent-emerald)';
    } else if (data.humidity < 40) {
      humidityComfortStatus.textContent = 'Сухе повітря (<40%)';
      humidityComfortStatus.style.color = 'var(--accent-amber)';
    } else {
      humidityComfortStatus.textContent = 'Підвищена (>60%)';
      humidityComfortStatus.style.color = 'var(--accent-blue)';
    }
  }

  // 4. Battery & Power
  badgeBattery.textContent = `🔋 ${data.battery}%`;
  valBatteryPercent.textContent = `${data.battery}%`;
  chargingBadge.style.display = data.charging ? 'inline' : 'none';
  batteryStatusText.textContent = data.charging ? '⚡ Підключено живлення' : 'Автономна робота від АКБ';

  for (let i = 0; i < batterySegments.length; i++) {
    batterySegments[i].className = 'battery-bar-segment';
    if (i < data.batteryBars) {
      batterySegments[i].classList.add('active');
      if (data.batteryBars === 1) {
        batterySegments[i].style.backgroundColor = 'var(--accent-rose)';
      } else if (data.batteryBars === 2) {
        batterySegments[i].style.backgroundColor = 'var(--accent-amber)';
      } else {
        batterySegments[i].style.backgroundColor = 'var(--accent-emerald)';
      }
    } else {
      batterySegments[i].style.backgroundColor = '';
    }
  }

  // 5. Append point to session history
  if (data.co2 !== null) {
    telemetryHistory.push({
      time: data.timestamp,
      co2: data.co2,
      temperature: data.temperature,
      humidity: data.humidity,
      battery: data.battery,
      charging: data.charging,
    });

    if (telemetryHistory.length > 2000) {
      telemetryHistory.shift();
    }

    updateHistoryStats();
    renderHistoryChart();
    btnExportCsv.disabled = false;
  }
}

function renderTemperature(tempC) {
  const isCelsius = ble.info.tempUnitCelsius !== false;
  valTempUnit.textContent = isCelsius ? '°C' : '°F';

  if (tempC === null || tempC === undefined) {
    valTemp.textContent = '--.-';
    tempComfortStatus.textContent = 'Датчик температури';
    return;
  }

  const displayVal = isCelsius ? tempC : (tempC * 9) / 5 + 32;
  valTemp.textContent = displayVal.toFixed(1);

  if (tempC >= 19 && tempC <= 25) {
    tempComfortStatus.textContent = 'Комфортна температура';
    tempComfortStatus.style.color = 'var(--accent-emerald)';
  } else if (tempC < 19) {
    tempComfortStatus.textContent = 'Прохолодно';
    tempComfortStatus.style.color = 'var(--accent-blue)';
  } else {
    tempComfortStatus.textContent = 'Тепло / спекотно';
    tempComfortStatus.style.color = 'var(--accent-amber)';
  }
}

function resetTelemetryUI() {
  valCo2.textContent = '---';
  co2StatusBadge.textContent = '--';
  barCo2.style.width = '0%';
  cardCo2.className = 'telemetry-card telemetry-card-co2';

  valTemp.textContent = '--.-';
  valHumidity.textContent = '--';
  valBatteryPercent.textContent = '--%';
  telemetryUpdateBadge.textContent = 'Очікування даних...';
  chargingBadge.style.display = 'none';
  batteryStatusText.textContent = 'Статус акумулятора';

  for (let i = 0; i < batterySegments.length; i++) {
    batterySegments[i].className = 'battery-bar-segment';
    batterySegments[i].style.backgroundColor = '';
  }

  buzzerIcon.textContent = '🔊';
  buzzerText.textContent = 'Статус зумера: невідомо';
  buzzerSubtext.textContent = 'Підключіть прилад для зчитування стану';
}

function updateSettingsUI(settings) {
  inputAlarmLow.value = settings.alarmLow;
  inputAlarmHigh.value = settings.alarmHigh;

  // Firmware strictly supports 0 (Always on) and 120 (2 min timeout)
  selectScreenOff.value = (settings.screenOff === 0) ? '0' : '120';

  if (co2FooterLegend) {
    co2FooterLegend.textContent = `< ${settings.alarmLow} свіже • ${settings.alarmLow}–${settings.alarmHigh} увага • > ${settings.alarmHigh} тривога`;
  }
}

function updateDeviceTempUnitUI(celsius) {
  selectDeviceTempUnit.value = celsius ? 'C' : 'F';
  if (lastRawTemperature !== null) {
    renderTemperature(lastRawTemperature);
  }
}

function updateDeviceInfoUI(info) {
  if (info.sku) badgeSku.textContent = `SKU: ${info.sku}`;
  if (info.firmware) badgeFw.textContent = `FW: ${info.firmware}`;
}

// ------------------------------------------------------------- History, Chart & CSV

function startDurationTimer() {
  stopDurationTimer();
  sessionDurationInterval = setInterval(() => {
    if (!sessionStartTime) return;
    const diffSec = Math.floor((new Date() - sessionStartTime) / 1000);
    const m = Math.floor(diffSec / 60);
    const s = diffSec % 60;
    statDuration.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, 1000);
}

function stopDurationTimer() {
  if (sessionDurationInterval) {
    clearInterval(sessionDurationInterval);
    sessionDurationInterval = null;
  }
}

function updateHistoryStats() {
  if (!telemetryHistory.length) {
    statMinCo2.textContent = '---';
    statAvgCo2.textContent = '---';
    statMaxCo2.textContent = '---';
    statCount.textContent = '0';
    return;
  }

  const vals = telemetryHistory.map((d) => d.co2).filter((v) => typeof v === 'number');
  if (!vals.length) return;

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);

  statMinCo2.textContent = `${min} ppm`;
  statAvgCo2.textContent = `${avg} ppm`;
  statMaxCo2.textContent = `${max} ppm`;
  statCount.textContent = vals.length.toString();
}

function clearTelemetryHistory() {
  telemetryHistory.length = 0;
  sessionStartTime = new Date();
  btnExportCsv.disabled = true;
  updateHistoryStats();
  renderHistoryChart();
  showToast('Історію вимірювань сесії очищено.');
}

function renderHistoryChart() {
  if (!historyChart) return;
  const ctx = historyChart.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = historyChart.getBoundingClientRect();
  const width = rect.width || 800;
  const height = rect.height || 180;

  historyChart.width = width * dpr;
  historyChart.height = height * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);

  if (telemetryHistory.length < 2) {
    chartPlaceholder.style.display = 'flex';
    return;
  }
  chartPlaceholder.style.display = 'none';

  const padding = { top: 22, right: 24, bottom: 26, left: 45 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const { low, high } = getActiveThresholds();
  const co2Values = telemetryHistory.map((d) => d.co2);
  const minVal = Math.min(400, ...co2Values);
  const maxVal = Math.max(1200, high + 200, ...co2Values);

  const getX = (i) => padding.left + (i / (telemetryHistory.length - 1)) * chartW;
  const getY = (val) => padding.top + chartH - ((val - minVal) / (maxVal - minVal)) * chartH;

  // 1. Threshold background guide lines
  if (low >= minVal && low <= maxVal) {
    const yLow = getY(low);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, yLow);
    ctx.lineTo(padding.left + chartW, yLow);
    ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText(`${low}`, padding.left - 32, yLow + 3);
  }

  if (high >= minVal && high <= maxVal) {
    const yHigh = getY(high);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, yHigh);
    ctx.lineTo(padding.left + chartW, yHigh);
    ctx.stroke();
    ctx.fillStyle = '#f87171';
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText(`${high}`, padding.left - 32, yHigh + 3);
  }
  ctx.setLineDash([]);

  // 2. Area gradient fill under the curve
  const lastCo2 = co2Values[co2Values.length - 1];
  let areaColor = 'rgba(16, 185, 129, 0.18)';
  let strokeColor = '#10b981';
  if (lastCo2 > high) {
    areaColor = 'rgba(239, 68, 68, 0.22)';
    strokeColor = '#f43f5e';
  } else if (lastCo2 >= low) {
    areaColor = 'rgba(245, 158, 11, 0.22)';
    strokeColor = '#f59e0b';
  }

  ctx.beginPath();
  ctx.moveTo(getX(0), getY(co2Values[0]));
  for (let i = 1; i < telemetryHistory.length; i++) {
    ctx.lineTo(getX(i), getY(co2Values[i]));
  }
  ctx.lineTo(getX(telemetryHistory.length - 1), padding.top + chartH);
  ctx.lineTo(getX(0), padding.top + chartH);
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
  gradient.addColorStop(0, areaColor);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fill();

  // 3. Line stroke
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(co2Values[0]));
  for (let i = 1; i < telemetryHistory.length; i++) {
    ctx.lineTo(getX(i), getY(co2Values[i]));
  }
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // 4. Latest point dot
  const lastIdx = telemetryHistory.length - 1;
  const curX = getX(lastIdx);
  const curY = getY(co2Values[lastIdx]);
  ctx.fillStyle = strokeColor;
  ctx.beginPath();
  ctx.arc(curX, curY, 4, 0, Math.PI * 2);
  ctx.fill();

  // Time labels on horizontal axis
  ctx.fillStyle = '#64748b';
  ctx.font = '10px Inter, sans-serif';
  const startTimeStr = telemetryHistory[0].time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const endTimeStr = telemetryHistory[lastIdx].time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  ctx.fillText(startTimeStr, padding.left, height - 8);
  ctx.textAlign = 'right';
  ctx.fillText(endTimeStr, padding.left + chartW, height - 8);
  ctx.textAlign = 'left';
}

function exportTelemetryCsv() {
  if (!telemetryHistory.length) {
    showToast('⚠️ Немає накопичених даних для експорту.');
    return;
  }

  const isCelsius = ble.info.tempUnitCelsius !== false;
  const tempHeader = isCelsius ? 'Температура (°C)' : 'Температура (°F)';

  const headers = ['Дата', 'Час', 'CO2 (ppm)', tempHeader, 'Вологість (%)', 'Батарея (%)', 'Живлення'];
  const rows = [headers.join(',')];

  for (const d of telemetryHistory) {
    const dateStr = d.time.toLocaleDateString('uk-UA');
    const timeStr = d.time.toLocaleTimeString('uk-UA');
    const co2 = d.co2 !== null ? d.co2 : '';
    let temp = '';
    if (d.temperature !== null) {
      temp = isCelsius ? d.temperature : ((d.temperature * 9) / 5 + 32).toFixed(1);
    }
    const hum = d.humidity !== null ? d.humidity : '';
    const bat = d.battery !== null ? d.battery : '';
    const charge = d.charging ? 'Заряджання' : 'Автономно';

    rows.push(`"${dateStr}","${timeStr}",${co2},${temp},${hum},${bat},"${charge}"`);
  }

  // UTF-8 BOM (\uFEFF) ensures Excel opens Ukrainian headers correctly
  const csvString = '\uFEFF' + rows.join('\r\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const now = new Date();
  const filename = `htram_telemetry_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}.csv`;

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast(`📥 Успішно експортовано ${telemetryHistory.length} зрізів у ${filename}`);
}

// ------------------------------------------------------------- Console & Toast

function appendLog({ direction, text, hex, time }) {
  const timeStr = time ? time.toTimeString().split(' ')[0] : new Date().toTimeString().split(' ')[0];
  const row = document.createElement('div');
  row.className = `console-entry console-${direction}`;

  const dirArrow = direction === 'in' ? '◀' : direction === 'out' ? '▶' : 'ℹ';
  row.innerHTML = `<span class="console-time">[${timeStr}]</span> <span>${dirArrow} ${text} ${hex ? `<code>${hex}</code>` : ''}</span>`;

  consoleLog.appendChild(row);

  // Keep last 100 entries
  while (consoleLog.children.length > 100) {
    consoleLog.removeChild(consoleLog.firstChild);
  }

  consoleLog.scrollTop = consoleLog.scrollHeight;
}

function showToast(message, durationMs = 3500) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, durationMs);
}

function openDonateModal() {
  donateModal.classList.add('active');
}

function closeDonateModal() {
  donateModal.classList.remove('active');
}

// Start application
window.addEventListener('DOMContentLoaded', init);
