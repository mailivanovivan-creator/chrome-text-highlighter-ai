(function () {
    const HIGHLIGHT_CLASS = 'chrome-highlighter-mark';
    const HIGHLIGHT_COLOR = 'yellow';
    const ACTIVE_CLASS = 'chrome-highlighter-active';

    let isActive = false;

    // Добавляем стили
    function addStyles() {
        const style = document.createElement('style');
        style.id = 'chrome-highlighter-styles';
        style.textContent = `
      .${HIGHLIGHT_CLASS} {
        background-color: ${HIGHLIGHT_COLOR} !important;
        cursor: cell;
        line-height: 1.2;
    transition: background-color 0.6s ease;
      }

      body.${ACTIVE_CLASS} * {
        cursor: cell !important;
      }

      ::selection {
        background-color: rgba(255, 255, 0, 0.4);
      }
    `;
        document.head.appendChild(style);
    }

    function flashHighlightElement(el) {
        if (!el) return;
        const orig = el.style.backgroundColor;
        el.style.transition = 'background-color 0.6s ease';
        el.style.backgroundColor = 'orange';
        setTimeout(() => {
            el.style.backgroundColor = '';
        }, 600);
    }

    // Генерация XPath для узла
    function getXPath(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const parent = node.parentNode;
            const children = parent.childNodes;
            let index = 0;
            for (let i = 0; i < children.length; i++) {
                if (children[i] === node) break;
                if (children[i].nodeType === Node.TEXT_NODE) index++;
            }
            return getXPath(parent) + `/text()[${index + 1}]`;
        }
        if (node === document.body) return '/html/body';
        const index = Array.prototype.indexOf.call(node.parentNode.children, node) + 1;
        return getXPath(node.parentNode) + '/' + node.tagName.toLowerCase() + `[${index}]`;
    }

    // Восстановление выделений
    function restoreHighlights() {
        const pageKey = location.href;
        const saved = localStorage.getItem('chromeHighlighter_' + pageKey);
        if (!saved) return;

        const ranges = JSON.parse(saved);
        ranges.forEach(rangeData => {
            const node = document.evaluate(
                rangeData.xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;

            if (node && node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                const before = text.slice(0, rangeData.startOffset);
                const highlight = text.slice(rangeData.startOffset, rangeData.endOffset);
                const after = text.slice(rangeData.endOffset);

                node.textContent = before;

                const span = document.createElement('span');
                span.className = HIGHLIGHT_CLASS;
                span.textContent = highlight;

                node.parentNode.insertBefore(span, node.nextSibling);
                node.parentNode.insertBefore(document.createTextNode(after), span.nextSibling);
            }
        });
    }

    // Сохранение выделений: группируем сегменты по highlightId
    function saveHighlights() {
        const pageKey = location.href;
        const spans = Array.from(document.getElementsByClassName(HIGHLIGHT_CLASS));
        const groups = {};
        spans.forEach(sp => {
            const id = sp.dataset.highlightId || sp.getAttribute('data-highlight-id') || null;
            const textNode = sp.childNodes[0];
            if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;
            const xpath = getXPath(textNode);
            const seg = {
                xpath,
                startOffset: 0,
                endOffset: textNode.textContent.length,
                text: textNode.textContent
            };
            if (!id) {
                // если нет id — присвоим
                const newId = 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
                sp.dataset.highlightId = newId;
                groups[newId] = groups[newId] || { id: newId, segments: [] };
                groups[newId].segments.push(seg);
            } else {
                groups[id] = groups[id] || { id, segments: [] };
                groups[id].segments.push(seg);
            }
        });

        const highlights = Object.keys(groups).map(k => groups[k]);

        try {
            const data = {};
            data['chromeHighlighter_' + pageKey] = highlights;
            chrome.storage.local.set(data);
        } catch (e) {
            localStorage.setItem('chromeHighlighter_' + pageKey, JSON.stringify(highlights));
        }
    }

    // Обработка выделения
    function handleMouseUp() {
        if (!isActive) return;

        const selection = window.getSelection();
        if (selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const text = selection.toString().trim();
        if (text === '') {
            selection.removeAllRanges();
            return;
        }

        // Проверка, не выделено ли уже (если commonAncestorContainer — элемент)
        try {
            const anc = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
                ? range.commonAncestorContainer
                : range.commonAncestorContainer.parentElement;
            if (anc && anc.closest && anc.closest('.' + HIGHLIGHT_CLASS)) {
                selection.removeAllRanges();
                return;
            }
        } catch (e) {
            // если что-то пошло не так — продолжим
        }

        // Создадим многосегментное выделение: обработаем все текстовые узлы внутри range
        const nodes = getTextNodesInRange(range);
        if (nodes.length === 0) {
            selection.removeAllRanges();
            return;
        }

        const highlightId = 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        nodes.forEach(node => {
            const start = (node === range.startContainer) ? range.startOffset : 0;
            const end = (node === range.endContainer) ? range.endOffset : node.length;
            if (start >= end) return;

            // splitText: сначала отделим хвост, затем середину
            const after = node.splitText(end);
            const middle = node.splitText(start);

            const span = document.createElement('span');
            span.className = HIGHLIGHT_CLASS;
            span.dataset.highlightId = highlightId;
            span.textContent = middle.textContent;

            middle.parentNode.replaceChild(span, middle);
        });

        selection.removeAllRanges();
        saveHighlights();
        renderFloatingList();
    }

    // Получить все текстовые узлы, пересекающиеся с range
    function getTextNodesInRange(range) {
        const root = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement || document.body;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        });
        const nodes = [];
        let node = walker.nextNode();
        while (node) {
            nodes.push(node);
            node = walker.nextNode();
        }
        return nodes;
    }

    // Активация/деактивация
    function activate() {
        isActive = true;
        document.body.classList.add(ACTIVE_CLASS);
        createFloatingPanel();
        renderFloatingList();
        createCursorMarker();
    }

    function deactivate() {
        isActive = false;
        document.body.classList.remove(ACTIVE_CLASS);
        removeFloatingPanel();
        removeCursorMarker();
    }

    function createCursorMarker() {
        if (cursorMarker) return;
        cursorMarker = document.createElement('div');
        cursorMarker.id = 'ch_cursor_marker';
        cursorMarker.style.position = 'fixed';
        cursorMarker.style.width = '10px';
        cursorMarker.style.height = '10px';
        cursorMarker.style.borderRadius = '50%';
        cursorMarker.style.background = 'rgba(255, 200, 0, 0.95)';
        cursorMarker.style.border = '1px solid #b88600';
        cursorMarker.style.pointerEvents = 'none';
        cursorMarker.style.zIndex = 2147483647;
        cursorMarker.style.transform = 'translate(-50%, -50%)';
        document.body.appendChild(cursorMarker);

        mouseMoveHandler = (e) => {
            cursorMarker.style.left = e.clientX + 'px';
            cursorMarker.style.top = e.clientY + 'px';
        };
        document.addEventListener('mousemove', mouseMoveHandler);
    }

    function removeCursorMarker() {
        if (mouseMoveHandler) {
            document.removeEventListener('mousemove', mouseMoveHandler);
            mouseMoveHandler = null;
        }
        if (cursorMarker) {
            cursorMarker.remove();
            cursorMarker = null;
        }
    }

    function copyAllFragments() {
        const pageKey = location.href;
        chrome.storage.local.get(['chromeHighlighter_' + pageKey], (result) => {
            const highlights = result['chromeHighlighter_' + pageKey] || [];
            const texts = [];
            highlights.forEach(h => {
                if (h.segments && h.segments.length) {
                    h.segments.forEach(s => texts.push(s.text));
                }
            });
            // Собираем все фрагменты и добавляем источник (title + URL страницы) сверху
            const body = texts.join('\n\n');
            const title = document.title || '';
            const all = `Источник: ${title}\nURL: ${location.href}\n\n${body}`;
            // копируем в буфер обмена
            copyTextToClipboard(all);
            const msg = document.getElementById('ch_copy_msg');
            if (msg) {
                msg.textContent = texts.length ? 'Скопировано в буфер' : '(пусто)';
                setTimeout(() => { msg.textContent = ''; }, 2000);
            }
        });
    }

    function copyTextToClipboard(text) {
        if (!text) return;
        try {
            navigator.clipboard.writeText(text);
        } catch (e) {
            // fallback
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
    }

    // ---------------- Floating panel ----------------
    let floatingPanel = null;
    let cursorMarker = null;
    let mouseMoveHandler = null;

    function createFloatingPanel() {
        if (floatingPanel) return;
        floatingPanel = document.createElement('div');
        floatingPanel.id = 'chrome-highlighter-panel';
        floatingPanel.style.position = 'fixed';
        floatingPanel.style.right = '12px';
        floatingPanel.style.bottom = '12px';
        floatingPanel.style.width = '260px';
        floatingPanel.style.maxHeight = '60vh';
        floatingPanel.style.overflow = 'auto';
        floatingPanel.style.background = 'rgba(255,255,255,0.95)';
        floatingPanel.style.border = '1px solid #ddd';
        floatingPanel.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
        floatingPanel.style.zIndex = 2147483647;
        floatingPanel.style.padding = '8px';
        floatingPanel.style.fontSize = '13px';
        floatingPanel.style.color = '#222';
        floatingPanel.style.borderRadius = '6px';

        floatingPanel.innerHTML = `
            <div id="ch_panel_head" style="cursor:move; font-weight:600; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                <span>Выделения</span>
                <div style="display:flex; gap:6px; align-items:center;">
                    <button class="ch-copy" title="Скопировать все фрагменты" style="font-size:12px;">📋</button>
                    <button id="ch_close_btn" style="margin-left:8px">✕</button>
                </div>
            </div>
            <div id="ch_copy_msg" style="color:green; font-size:12px; height:16px; margin-bottom:6px;"></div>
            <div id="ch_list" style="max-height:40vh; overflow:auto;"></div>
        `;

        document.body.appendChild(floatingPanel);

        // drag
        const head = floatingPanel.querySelector('#ch_panel_head');
        let isDragging = false, startX = 0, startY = 0, startRight = 12, startBottom = 12;
        head.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = floatingPanel.getBoundingClientRect();
            startRight = window.innerWidth - rect.right;
            startBottom = window.innerHeight - rect.bottom;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            floatingPanel.style.right = (startRight - dx) + 'px';
            floatingPanel.style.bottom = (startBottom - dy) + 'px';
        });
        document.addEventListener('mouseup', () => { isDragging = false; });

        floatingPanel.querySelector('#ch_close_btn').addEventListener('click', () => {
            deactivate();
        });

        // click handlers delegated
        floatingPanel.addEventListener('click', (e) => {
            const target = e.target;
            if (target.matches('.ch-scroll')) {
                const id = target.dataset.id;
                scrollToHighlight(id);
            }
            if (target.matches('.ch-delete')) {
                const id = target.dataset.id;
                removeHighlightById(id);
            }
            if (target.matches('.ch-copy')) {
                copyAllFragments();
            }
        });
    }

    function removeFloatingPanel() {
        if (!floatingPanel) return;
        floatingPanel.remove();
        floatingPanel = null;
    }

    function renderFloatingList() {
        if (!floatingPanel) return;
        const container = floatingPanel.querySelector('#ch_list');
        container.innerHTML = '';
        const pageKey = location.href;
        chrome.storage.local.get(['chromeHighlighter_' + pageKey], (result) => {
            const highlights = result['chromeHighlighter_' + pageKey] || [];
            if (!highlights.length) {
                container.innerHTML = '<div style="color:#666;">(нет выделений)</div>';
                return;
            }
            highlights.forEach(h => {
                const div = document.createElement('div');
                div.style.display = 'flex';
                div.style.justifyContent = 'space-between';
                div.style.alignItems = 'center';
                div.style.padding = '6px 4px';
                div.style.borderBottom = '1px solid #f0f0f0';

                const text = (h.segments && h.segments.length) ? h.segments.map(s => s.text).join(' … ') : '(пусто)';
                const title = document.createElement('div');
                title.style.flex = '1';
                title.style.marginRight = '8px';
                title.style.overflow = 'hidden';
                title.style.textOverflow = 'ellipsis';
                title.style.whiteSpace = 'nowrap';
                title.textContent = text;

                const actions = document.createElement('div');
                actions.innerHTML = `
                    <button class="ch-scroll" data-id="${h.id}" style="margin-right:6px">→</button>
                    <button class="ch-delete" data-id="${h.id}">🗑</button>
                `;

                div.appendChild(title);
                div.appendChild(actions);
                container.appendChild(div);
            });
        });
    }

    function scrollToHighlight(id) {
        const el = document.querySelector('[data-highlight-id="' + id + '"]');
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // анимированная подсветка
            flashHighlightElement(el);
        }
    }

    function removeHighlightById(id) {
        const spans = Array.from(document.querySelectorAll('[data-highlight-id="' + id + '"]'));
        spans.forEach(s => {
            const text = s.textContent;
            const textNode = document.createTextNode(text);
            s.parentNode.replaceChild(textNode, s);
        });
        saveHighlights();
        renderFloatingList();
    }

    // Инициализация
    function init() {
        addStyles();
        restoreHighlights();

        document.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('beforeunload', saveHighlights);

        // Слушаем сообщения из popup
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            if (msg.type === 'TOGGLE_HIGHLIGHTER') {
                if (msg.active) activate();
                else deactivate();
            }
            if (msg.type === 'GET_HIGHLIGHTS') {
                const pageKey = location.href;
                chrome.storage.local.get(['chromeHighlighter_' + pageKey], (result) => {
                    const marks = result['chromeHighlighter_' + pageKey] || [];
                    sendResponse({ highlights: marks });
                });
                // Вернём true, чтобы указать, что ответ будет асинхронным
                return true;
            }
            if (msg.type === 'SCROLL_TO_HIGHLIGHT') {
                scrollToHighlight(msg.id);
            }
            if (msg.type === 'REMOVE_HIGHLIGHT') {
                removeHighlightById(msg.id);
            }
            if (msg.type === 'TOGGLE_PANEL') {
                if (floatingPanel) removeFloatingPanel();
                else createFloatingPanel();
                renderFloatingList();
            }
        });
    }

    // Запуск
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();