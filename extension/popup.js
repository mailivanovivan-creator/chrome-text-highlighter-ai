document.addEventListener('DOMContentLoaded', () => {
    const toggleSwitch = document.getElementById('toggleSwitch');
    const status = document.getElementById('status');
    const panelBtn = document.getElementById('panelBtn');

    // По умолчанию гарантируем выключенный режим при первом запуске
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0].id;
        chrome.storage.local.get([`highlighter_active_${tabId}`], (result) => {
            const isActive = result.hasOwnProperty(`highlighter_active_${tabId}`) ? result[`highlighter_active_${tabId}`] : false;
            // если ключа нет — создаём со значением false
            if (!result.hasOwnProperty(`highlighter_active_${tabId}`)) {
                chrome.storage.local.set({ [`highlighter_active_${tabId}`]: false });
            }
            updateSwitch(isActive);
        });
    });

    // Переключение режима через свитчер
    toggleSwitch.addEventListener('change', () => {
        const checked = toggleSwitch.checked;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs[0].id;
            chrome.storage.local.set({ [`highlighter_active_${tabId}`]: checked });
            chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_HIGHLIGHTER', active: checked });
            updateSwitch(checked);
        });
    });

    function updateSwitch(isActive) {
        toggleSwitch.checked = !!isActive;
        status.textContent = isActive ? 'Режим: ВКЛ' : 'Режим: ВЫКЛ';
    }

    // Панель (показ/скрыть) — отправляем сообщение content.js
    panelBtn.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs[0].id;
            chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_PANEL' });
        });
    });

    function escapeHtml(s) {
        return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": "&#39;" })[c]);
    }

    // При открытии попапа запросим выделения
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0].id;
        requestHighlights(tabId);
    });
});