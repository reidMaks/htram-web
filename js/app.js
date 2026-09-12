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

// DOM Elements: On-Device History & Chart Export
const historySourceBadge = document.getElementById('historySourceBadge');
const btnFetchHistory = document.getElementById('btnFetchHistory');
const btnAbortHistory = document.getElementById('btnAbortHistory');
const chkSyncTimeFirst = document.getElementById('chkSyncTimeFirst');
const historyProgressWrap = document.getElementById('historyProgressWrap');
const historyProgressStatus = document.getElementById('historyProgressStatus');
const historyProgressCount = document.getElementById('historyProgressCount');
const historyProgressBar = document.getElementById('historyProgressBar');

const btnExportCsv = document.getElementById('btnExportCsv');
const btnClearHistory = document.getElementById('btnClearHistory');
const historyChart = document.getElementById('historyChart');
const chartPlaceholder = document.getElementById('chartPlaceholder');
const statDateStart = document.getElementById('statDateStart');
const statDateEnd = document.getElementById('statDateEnd');
const statCount = document.getElementById('statCount');
const statMinCo2 = document.getElementById('statMinCo2');
const statAvgCo2 = document.getElementById('statAvgCo2');
const statMaxCo2 = document.getElementById('statMaxCo2');

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
let deviceHistoryRecords = []; // Historical records retrieved from on-device Flash memory
const telemetryHistory = [];   // Live session telemetry points
let historyAbortController = null;

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

  // On-Device Flash History Actions
  btnFetchHistory.addEventListener('click', async () => {
    await fetchDeviceHistoryHandler();
  });

  btnAbortHistory.addEventListener('click', () => {
    if (historyAbortController) {
      historyAbortController.abort();
      showToast('Зупинка зчитування історії...', 2000);
    }
  });

  btnExportCsv.addEventListener('click', () => exportHistoryCsv());
  btnClearHistory.addEventListener('click', () => {
    if (confirm('Очистити відображення графіка та завантажену історію?')) {
      clearAllHistory();
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
  btnFetchHistory.disabled = ble.isFetchingHistory;
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

    if (deviceHistoryRecords.length === 0) {
      updateHistoryStats();
      renderHistoryChart();
      btnExportCsv.disabled = false;
    }
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

async function fetchDeviceHistoryHandler() {
  if (ble.isFetchingHistory) return;

  // Auto-connect if device is not connected yet
  if (ble.state !== BLE_STATES.CONNECTED) {
    try {
      showToast('📡 Оберіть ваш HTRAM у списку Bluetooth для зчитування історії...', 4000);
      await ble.connect(chkAcceptAll.checked);
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        showToast(`Помилка підключення: ${err.message}`, 5000);
      }
      return;
    }
  }

  btnFetchHistory.disabled = true;
  btnAbortHistory.style.display = 'inline-flex';
  historyProgressWrap.style.display = 'block';
  historyProgressStatus.textContent = '⚡ Ініціалізація зв\'язку з приладом...';
  historyProgressCount.textContent = '0 записів';

  historyAbortController = new AbortController();

  try {
    const records = await ble.fetchDeviceHistory({
      syncTimeFirst: chkSyncTimeFirst.checked,
      signal: historyAbortController.signal,
      onProgress: ({ count, blockCount, blockAddress, isComplete }) => {
        historyProgressStatus.textContent = `Зчитування блоку 0x${blockAddress} (#${blockCount})...`;
        historyProgressCount.textContent = `${count.toLocaleString('uk-UA')} записів`;
      },
    });

    if (records && records.length > 0) {
      records.sort((a, b) => a.time - b.time);
      deviceHistoryRecords = records;

      historySourceBadge.style.display = 'inline-block';
      historySourceBadge.textContent = `Flash-пам'ять (${records.length.toLocaleString('uk-UA')} точок)`;

      updateHistoryStats();
      renderHistoryChart();
      btnExportCsv.disabled = false;

      showToast(`📥 Успішно завантажено ${records.length.toLocaleString('uk-UA')} вимірювань з пам'яті приладу!`, 5000);
    } else {
      showToast('Вбудована пам\'ять приладу порожня або не містить записів.');
    }
  } catch (err) {
    if (historyAbortController && historyAbortController.signal.aborted) {
      showToast('Зчитування історії скасовано користувачем.');
      if (deviceHistoryRecords.length === 0 && telemetryHistory.length > 0) {
        renderHistoryChart();
      }
    } else {
      showToast(`Помилка зчитування пам'яті: ${err.message}`, 6000);
    }
  } finally {
    btnFetchHistory.disabled = false;
    btnAbortHistory.style.display = 'none';
    historyProgressWrap.style.display = 'none';
    historyAbortController = null;
  }
}

function updateHistoryStats() {
  const activeDataset = (deviceHistoryRecords.length > 0) ? deviceHistoryRecords : telemetryHistory;

  if (!activeDataset.length) {
    statDateStart.textContent = '---';
    statDateEnd.textContent = '---';
    statMinCo2.textContent = '---';
    statAvgCo2.textContent = '---';
    statMaxCo2.textContent = '---';
    statCount.textContent = '0';
    return;
  }

  const firstDate = activeDataset[0].time;
  const lastDate = activeDataset[activeDataset.length - 1].time;

  const formatDate = (d) => {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '---';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}.${month}.${year} ${hours}:${minutes}`;
  };

  statDateStart.textContent = formatDate(firstDate);
  statDateEnd.textContent = formatDate(lastDate);

  const vals = activeDataset.map((d) => d.co2).filter((v) => typeof v === 'number');
  statCount.textContent = activeDataset.length.toLocaleString('uk-UA');

  if (!vals.length) {
    statMinCo2.textContent = '---';
    statAvgCo2.textContent = '---';
    statMaxCo2.textContent = '---';
    return;
  }

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);

  statMinCo2.textContent = `${min} ppm`;
  statAvgCo2.textContent = `${avg} ppm`;
  statMaxCo2.textContent = `${max} ppm`;
}

function clearAllHistory() {
  deviceHistoryRecords = [];
  telemetryHistory.length = 0;
  historySourceBadge.style.display = 'none';
  btnExportCsv.disabled = true;
  updateHistoryStats();
  renderHistoryChart();
  showToast('Графік та історію вимірювань очищено.');
}

function renderHistoryChart() {
  if (!historyChart) return;
  const ctx = historyChart.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = historyChart.getBoundingClientRect();
  const width = rect.width || 800;
  const height = rect.height || 200;

  historyChart.width = width * dpr;
  historyChart.height = height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const activeDataset = (deviceHistoryRecords.length > 0) ? deviceHistoryRecords : telemetryHistory;

  if (activeDataset.length < 2) {
    chartPlaceholder.style.display = 'flex';
    chartPlaceholder.querySelector('span').textContent = (deviceHistoryRecords.length === 0)
      ? 'Підключіть прилад та натисніть «Зчитати історію з приладу» для побудови графіка...'
      : 'Недостатньо точок для побудови графіка...';
    return;
  }
  chartPlaceholder.style.display = 'none';

  // Decimate points if dataset is huge for butter-smooth Canvas performance
  let pointsToRender = activeDataset;
  if (activeDataset.length > 2500) {
    const step = Math.ceil(activeDataset.length / 2000);
    pointsToRender = [];
    for (let i = 0; i < activeDataset.length; i += step) {
      pointsToRender.push(activeDataset[i]);
    }
    const lastPt = activeDataset[activeDataset.length - 1];
    if (pointsToRender[pointsToRender.length - 1] !== lastPt) {
      pointsToRender.push(lastPt);
    }
  }

  const padding = { top: 22, right: 24, bottom: 26, left: 45 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const { low, high } = getActiveThresholds();
  const co2Values = pointsToRender.map((d) => d.co2).filter((v) => v !== null);
  if (co2Values.length < 2) return;

  const minVal = Math.min(400, ...co2Values);
  const maxVal = Math.max(1200, high + 200, ...co2Values);

  const getX = (i) => padding.left + (i / (pointsToRender.length - 1)) * chartW;
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
  ctx.moveTo(getX(0), getY(pointsToRender[0].co2 || minVal));
  for (let i = 1; i < pointsToRender.length; i++) {
    const val = pointsToRender[i].co2 !== null ? pointsToRender[i].co2 : minVal;
    ctx.lineTo(getX(i), getY(val));
  }
  ctx.lineTo(getX(pointsToRender.length - 1), padding.top + chartH);
  ctx.lineTo(getX(0), padding.top + chartH);
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
  gradient.addColorStop(0, areaColor);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fill();

  // 3. Line stroke
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(pointsToRender[0].co2 || minVal));
  for (let i = 1; i < pointsToRender.length; i++) {
    const val = pointsToRender[i].co2 !== null ? pointsToRender[i].co2 : minVal;
    ctx.lineTo(getX(i), getY(val));
  }
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2.0;
  ctx.stroke();

  // 4. Dot at the latest point if small dataset
  if (pointsToRender.length < 500) {
    const lastIdx = pointsToRender.length - 1;
    const curX = getX(lastIdx);
    const curY = getY(pointsToRender[lastIdx].co2 || minVal);
    ctx.fillStyle = strokeColor;
    ctx.beginPath();
    ctx.arc(curX, curY, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5. Time labels on horizontal axis
  ctx.fillStyle = '#64748b';
  ctx.font = '10px Inter, sans-serif';

  const startTime = pointsToRender[0].time;
  const endTime = pointsToRender[pointsToRender.length - 1].time;
  const isMultiDay = (endTime - startTime) > 24 * 3600 * 1000;

  const formatXLabel = (d) => {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
    if (isMultiDay) {
      return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  ctx.fillText(formatXLabel(startTime), padding.left, height - 8);
  ctx.textAlign = 'right';
  ctx.fillText(formatXLabel(endTime), padding.left + chartW, height - 8);
  ctx.textAlign = 'left';
}

function exportHistoryCsv() {
  const isDeviceData = deviceHistoryRecords.length > 0;
  const dataToExport = isDeviceData ? deviceHistoryRecords : telemetryHistory;

  if (!dataToExport.length) {
    showToast('⚠️ Немає даних для експорту.');
    return;
  }

  const isCelsius = ble.info.tempUnitCelsius !== false;
  const tempHeader = isCelsius ? 'Температура (°C)' : 'Температура (°F)';

  const headers = [
    'Дата та час (локальний)',
    'Дата та час (UTC)',
    'UNIX Timestamp',
    'CO2 (ppm)',
    tempHeader,
    'Вологість (%)',
    'Джерело',
  ];
  const rows = [headers.join(',')];

  for (const d of dataToExport) {
    const locStr = d.time instanceof Date ? d.time.toLocaleString('uk-UA') : '';
    const utcStr = d.time instanceof Date ? d.time.toISOString() : '';
    const ts = d.timestamp || (d.time instanceof Date ? Math.floor(d.time.getTime() / 1000) : '');
    const co2 = d.co2 !== null && d.co2 !== undefined ? d.co2 : '';
    let temp = '';
    if (d.temperature !== null && d.temperature !== undefined) {
      temp = isCelsius ? d.temperature : ((d.temperature * 9) / 5 + 32).toFixed(1);
    }
    const hum = d.humidity !== null && d.humidity !== undefined ? d.humidity : '';
    const source = isDeviceData ? 'Flash пам\'ять приладу' : 'Сесія моніторингу';

    rows.push(`"${locStr}","${utcStr}",${ts},${co2},${temp},${hum},"${source}"`);
  }

  // UTF-8 BOM (\uFEFF) ensures Excel opens Ukrainian headers correctly
  const csvString = '\uFEFF' + rows.join('\r\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const now = new Date();
  const dateTag = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const prefix = isDeviceData ? 'htram_flash_log' : 'htram_session';
  const filename = `${prefix}_${dateTag}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}.csv`;

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast(`📥 Успішно експортовано ${dataToExport.length.toLocaleString('uk-UA')} записів у ${filename}`);
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
