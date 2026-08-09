window.mindCanvas = (() => {
    let dotnet;
    let activeDrag;
    let activePan;
    let activeRangeSelection;
    let activeResize;
    let activeTabDrag;
    let suppressDraggedTabClick = false;
    const shortcut = event => {
        if (!dotnet) return;
        // IME変換中のキーを通常の1文字ショートカットとして確定しない。
        if (event.isComposing || event.key === 'Process' || event.keyCode === 229) return;
        const newMapTab = event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 't';
        const undo = event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z';
        const ctrlCheckbox = event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'l';
        const copyNodes = event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'c';
        const target = event.target;
        const keyboardCapture = target?.classList?.contains('keyboard-capture') === true;
        if (!newMapTab && !keyboardCapture && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable)) return;
        const altArrow = event.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key);
        const ctrlPriority = event.ctrlKey && !event.altKey && ['1', '2', '3', '4', '5', '6'].includes(event.key);
        const typing = !event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1;
        // 新規セルの透明入力欄では、文字キーをブラウザーとIMEへそのまま渡す。
        if (keyboardCapture && typing) return;
        if (!newMapTab && !undo && !ctrlCheckbox && !copyNodes && !altArrow && !ctrlPriority && !typing && !['F2', 'Enter', 'Tab', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const shortcutKey = newMapTab ? 'NewMapTab' : undo ? 'Undo' : ctrlCheckbox ? 'CtrlL' : copyNodes ? 'CopyNodes' : altArrow ? `Alt${event.key}` : ctrlPriority ? `Ctrl${event.key}` : typing ? `Type:${event.key}` : event.key;
        if (copyNodes) {
            dotnet.invokeMethodAsync('CopyNodesToClipboardText')
                .then(text => text ? navigator.clipboard?.writeText?.(text) : undefined)
                .catch(() => {});
            return;
        }
        const invocation = dotnet.invokeMethodAsync('HandleShortcut', shortcutKey);
    };

    const readAsDataUrl = file => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error ?? new Error('画像を読み取れませんでした'));
        reader.readAsDataURL(file);
    });

    const loadImage = source => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('画像を展開できませんでした'));
        image.src = source;
    });

    const prepareImage = async file => {
        // FileReaderはWindowsの切り取り領域から渡されるPNG Blobにも安定して対応する。
        const original = await readAsDataUrl(file);
        try {
            const image = await loadImage(original);
            const max = 1400;
            const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            const context = canvas.getContext('2d');
            if (!context) return original;
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/jpeg', .88);
        } catch {
            // 圧縮に対応しないブラウザでも、元のPNGをそのまま貼り付ける。
            return original;
        }
    };

    const extractUrl = text => {
        if (!text) return null;
        const match = text.match(/https?:\/\/[^\s<>"']+/i);
        return match?.[0]?.replace(/[),.;]+$/, '') ?? null;
    };

    const clipboardUrl = clipboardData => {
        const plain = clipboardData?.getData('text/plain') ?? '';
        const uriList = clipboardData?.getData('text/uri-list') ?? '';
        const html = clipboardData?.getData('text/html') ?? '';
        const fromText = extractUrl(`${plain}\n${uriList}`);
        if (fromText) return fromText;
        if (!html) return null;
        const documentFragment = new DOMParser().parseFromString(html, 'text/html');
        return [...documentFragment.querySelectorAll('a[href]')]
            .map(anchor => extractUrl(anchor.href)).find(Boolean) ?? null;
    };

    const paste = async event => {
        if (!dotnet) return;
        try {
            const target = event.target;
            const isNodeEditor = target instanceof HTMLTextAreaElement && target.classList.contains('node-editor');
            if (isNodeEditor) return;
            const items = Array.from(event.clipboardData?.items ?? []);
            const item = items.find(x => x.kind === 'file' && x.type.startsWith('image/'));
            if (!item) {
                const linkUrl = clipboardUrl(event.clipboardData);
                if (linkUrl) {
                    event.preventDefault();
                    await dotnet.invokeMethodAsync('PasteLink', linkUrl);
                    return;
                }
                event.preventDefault();
                if (await dotnet.invokeMethodAsync('PasteCopiedNodes')) return;
                await dotnet.invokeMethodAsync('PasteMessage', 'クリップボードに画像またはURLが見つかりません');
                return;
            }
            event.preventDefault();
            const file = item.getAsFile();
            if (!file) throw new Error('クリップボード画像を取得できませんでした');
            await dotnet.invokeMethodAsync('PasteImage', await prepareImage(file));
        } catch (error) {
            await dotnet.invokeMethodAsync('PasteMessage', `画像の貼り付けに失敗しました: ${error?.message ?? error}`);
        }
    };

    const readClipboard = async () => {
        if (!dotnet) throw new Error('貼り付け機能が初期化されていません');
        if (!navigator.clipboard?.read) {
            await dotnet.invokeMethodAsync('PasteMessage', 'このブラウザはクリップボード画像の直接読込に対応していません。Ctrl+Vを使用してください');
            return;
        }
        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const clipboardItem of clipboardItems) {
                const imageType = clipboardItem.types.find(type => type.startsWith('image/'));
                if (!imageType) continue;
                const blob = await clipboardItem.getType(imageType);
                await dotnet.invokeMethodAsync('PasteImage', await prepareImage(blob));
                return;
            }
            await dotnet.invokeMethodAsync('PasteMessage', 'クリップボードに画像が見つかりません');
        } catch (error) {
            await dotnet.invokeMethodAsync('PasteMessage', `クリップボードを読めません: ${error?.message ?? error}`);
        }
    };

    const readYoutubeLink = async () => {
        if (!dotnet) throw new Error('貼り付け機能が初期化されていません');
        if (!navigator.clipboard?.readText) {
            await dotnet.invokeMethodAsync('PasteMessage', 'このブラウザはクリップボードの文字読込に対応していません。Ctrl+Vを使用してください');
            return;
        }
        try {
            const url = extractUrl(await navigator.clipboard.readText());
            if (!url) {
                await dotnet.invokeMethodAsync('PasteMessage', 'クリップボードにURLが見つかりません');
                return;
            }
            await dotnet.invokeMethodAsync('PasteLink', url);
        } catch (error) {
            await dotnet.invokeMethodAsync('PasteMessage', `URLを読めません: ${error?.message ?? error}`);
        }
    };

    const svgPoint = (svg, clientX, clientY) => {
        const point = svg.createSVGPoint();
        point.x = clientX;
        point.y = clientY;
        return point.matrixTransform(svg.getScreenCTM().inverse());
    };

    const moveDrag = event => {
        if (!activeDrag || !dotnet) return;
        // ブラウザー外でマウスを離すとpointerupが届かない場合がある。
        // 次の移動通知で左ボタンが押されていなければドラッグを終了する。
        if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
            endDrag();
            return;
        }
        event.preventDefault();
        const point = svgPoint(activeDrag.svg, event.clientX, event.clientY);
        dotnet.invokeMethodAsync('MoveDraggedNode', activeDrag.id,
            point.x - activeDrag.offsetX, point.y - activeDrag.offsetY);
    };

    const cancelNodeDrag = () => {
        if (!activeDrag) return;
        activeDrag = null;
        window.removeEventListener('pointermove', moveDrag, true);
        window.removeEventListener('pointerup', endDrag, true);
        window.removeEventListener('pointercancel', endDrag, true);
        window.removeEventListener('blur', endDrag, true);
        window.removeEventListener('pagehide', endDrag, true);
        document.removeEventListener('visibilitychange', endDragWhenHidden, true);
    };

    const endDrag = () => {
        if (!activeDrag) return;
        cancelNodeDrag();
        dotnet?.invokeMethodAsync('EndNodeDrag');
    };

    const endDragWhenHidden = () => {
        if (document.hidden) endDrag();
    };

    const movePan = event => {
        if (!activePan || !dotnet) return;
        event.preventDefault();
        const rect = activePan.svg.getBoundingClientRect();
        const dx = (event.clientX - activePan.clientX) * activePan.viewWidth / rect.width;
        const dy = (event.clientY - activePan.clientY) * activePan.viewHeight / rect.height;
        dotnet.invokeMethodAsync('SetCanvasView', activePan.viewX - dx, activePan.viewY - dy);
    };

    const endPan = () => {
        if (!activePan) return;
        activePan = null;
        window.removeEventListener('pointermove', movePan, true);
        window.removeEventListener('pointerup', endPan, true);
        window.removeEventListener('pointercancel', endPan, true);
    };

    const startCanvasPan = (svg, clientX, clientY, viewX, viewY, viewWidth, viewHeight) => {
        endPan();
        activePan = { svg, clientX, clientY, viewX, viewY, viewWidth, viewHeight };
        window.addEventListener('pointermove', movePan, { capture: true, passive: false });
        window.addEventListener('pointerup', endPan, true);
        window.addEventListener('pointercancel', endPan, true);
    };

    const moveRangeSelection = event => {
        if (!activeRangeSelection || !dotnet) return;
        event.preventDefault();
        const point = svgPoint(activeRangeSelection.svg, event.clientX, event.clientY);
        dotnet.invokeMethodAsync('UpdateRangeSelection', point.x, point.y);
    };

    const endRangeSelection = () => {
        if (!activeRangeSelection) return;
        activeRangeSelection = null;
        window.removeEventListener('pointermove', moveRangeSelection, true);
        window.removeEventListener('pointerup', endRangeSelection, true);
        window.removeEventListener('pointercancel', endRangeSelection, true);
        dotnet?.invokeMethodAsync('EndRangeSelection');
    };

    const startRangeSelection = (svg, clientX, clientY) => {
        endPan();
        endRangeSelection();
        const point = svgPoint(svg, clientX, clientY);
        activeRangeSelection = { svg };
        dotnet?.invokeMethodAsync('BeginRangeSelection', point.x, point.y);
        window.addEventListener('pointermove', moveRangeSelection, { capture: true, passive: false });
        window.addEventListener('pointerup', endRangeSelection, true);
        window.addEventListener('pointercancel', endRangeSelection, true);
    };

    const moveResize = event => {
        if (!activeResize || !dotnet) return;
        event.preventDefault();
        const point = svgPoint(activeResize.svg, event.clientX, event.clientY);
        const dx = point.x - activeResize.startX;
        const dy = point.y - activeResize.startY;
        let { x, y, width, height } = activeResize;
        if (activeResize.corner.includes('e')) width += dx;
        if (activeResize.corner.includes('s')) height += dy;
        if (activeResize.corner.includes('w')) { x += dx; width -= dx; }
        if (activeResize.corner.includes('n')) { y += dy; height -= dy; }
        if (width < 160) { if (activeResize.corner.includes('w')) x -= 160 - width; width = 160; }
        if (height < 180) { if (activeResize.corner.includes('n')) y -= 180 - height; height = 180; }
        dotnet.invokeMethodAsync('ResizeImageNode', activeResize.id, x, y, width, height);
    };

    const endResize = () => {
        if (!activeResize) return;
        activeResize = null;
        window.removeEventListener('pointermove', moveResize, true);
        window.removeEventListener('pointerup', endResize, true);
        window.removeEventListener('pointercancel', endResize, true);
        dotnet?.invokeMethodAsync('EndImageResize');
    };

    const startImageResize = (id, svg, clientX, clientY, x, y, width, height, corner) => {
        endResize();
        const point = svgPoint(svg, clientX, clientY);
        activeResize = { id, svg, startX: point.x, startY: point.y, x, y, width, height, corner };
        window.addEventListener('pointermove', moveResize, { capture: true, passive: false });
        window.addEventListener('pointerup', endResize, true);
        window.addEventListener('pointercancel', endResize, true);
    };

    const startNodeDrag = (id, svg, clientX, clientY, nodeX, nodeY) => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        // 古いドラッグ監視だけを破棄する。ここで.NET側の終了処理を呼ぶと、
        // 今から開始する新しいドラッグ状態まで解除される競合が起きる。
        cancelNodeDrag();
        const point = svgPoint(svg, clientX, clientY);
        activeDrag = { id, svg, offsetX: point.x - nodeX, offsetY: point.y - nodeY };
        window.addEventListener('pointermove', moveDrag, { capture: true, passive: false });
        window.addEventListener('pointerup', endDrag, true);
        window.addEventListener('pointercancel', endDrag, true);
        window.addEventListener('blur', endDrag, true);
        window.addEventListener('pagehide', endDrag, true);
        document.addEventListener('visibilitychange', endDragWhenHidden, true);
    };
    const showEditor = (svg, editor, x, y, width, height, fontSize, textAlign, selectText) => {
        const matrix = svg.getScreenCTM();
        const workspace = svg.parentElement.getBoundingClientRect();
        const titleY = height > 100 ? y + height - 48 : y + 28;
        const p1 = new DOMPoint(x + 8, titleY).matrixTransform(matrix);
        const p2 = new DOMPoint(x + width - 8, titleY + 42).matrixTransform(matrix);
        editor.style.left = `${p1.x - workspace.left}px`;
        editor.style.top = `${p1.y - workspace.top}px`;
        editor.style.width = `${Math.max(100, p2.x - p1.x)}px`;
        editor.style.height = `${Math.max(48, p2.y - p1.y)}px`;
        editor.style.fontSize = `${fontSize}px`;
        editor.style.textAlign = textAlign;
        editor.focus();
        if (selectText) editor.select();
        else editor.setSelectionRange(editor.value.length, editor.value.length);
    };

    const tabButtonAt = (clientX, clientY) =>
        document.elementFromPoint(clientX, clientY)?.closest?.('.map-tab[data-map-tab-id]') ?? null;

    const cancelTabPointerDrag = () => {
        if (!activeTabDrag) return;
        activeTabDrag = null;
        window.removeEventListener('pointermove', moveTabPointerDrag, true);
        window.removeEventListener('pointerup', endTabPointerDrag, true);
        window.removeEventListener('pointercancel', endTabPointerDrag, true);
    };

    const moveTabPointerDrag = event => {
        const drag = activeTabDrag;
        if (!drag || !dotnet) return;
        if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
            endTabPointerDrag(event);
            return;
        }

        const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (!drag.started && distance < 5) return;
        event.preventDefault();
        if (!drag.started) {
            drag.started = true;
            drag.button.classList.add('dragging');
            drag.beginPromise = dotnet.invokeMethodAsync('BeginTabPointerDrag', drag.tabId);
        }

        const target = tabButtonAt(event.clientX, event.clientY);
        const targetId = target?.dataset?.mapTabId;
        const nextTargetId = targetId && targetId !== drag.tabId ? targetId : null;
        if (nextTargetId === drag.targetId) return;
        drag.targetId = nextTargetId;
        drag.beginPromise.then(() => dotnet?.invokeMethodAsync('SetTabPointerDropTarget', nextTargetId));
    };

    const endTabPointerDrag = event => {
        const drag = activeTabDrag;
        if (!drag) return;
        const wasStarted = drag.started;
        const targetId = event?.type === 'pointercancel' ? null : drag.targetId;
        cancelTabPointerDrag();
        if (!wasStarted) return;
        event?.preventDefault?.();
        suppressDraggedTabClick = true;
        setTimeout(() => { suppressDraggedTabClick = false; }, 250);
        drag.beginPromise
            .then(() => dotnet?.invokeMethodAsync('CompleteTabPointerDrag', targetId ?? null))
            .catch(() => {});
    };

    const beginTabPointerDrag = event => {
        if (!dotnet || event.button !== 0) return;
        const button = event.target?.closest?.('.map-tab[data-map-tab-id]');
        if (!button) return;
        cancelTabPointerDrag();
        activeTabDrag = {
            tabId: button.dataset.mapTabId,
            button,
            startX: event.clientX,
            startY: event.clientY,
            started: false,
            targetId: null,
            beginPromise: Promise.resolve()
        };
        window.addEventListener('pointermove', moveTabPointerDrag, { capture: true, passive: false });
        window.addEventListener('pointerup', endTabPointerDrag, true);
        window.addEventListener('pointercancel', endTabPointerDrag, true);
    };

    const blockDraggedTabClick = event => {
        if (!suppressDraggedTabClick || !event.target?.closest?.('.map-tab[data-map-tab-id]')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressDraggedTabClick = false;
    };

    return {
        initialize: reference => {
            dotnet = reference;
            window.addEventListener('paste', paste, true);
            window.addEventListener('keydown', shortcut, true);
            document.addEventListener('pointerdown', beginTabPointerDrag, true);
            document.addEventListener('click', blockDraggedTabClick, true);
            dotnet.invokeMethodAsync('SetPasteReady');
        },
        dispose: () => {
            window.removeEventListener('paste', paste, true);
            window.removeEventListener('keydown', shortcut, true);
            document.removeEventListener('pointerdown', beginTabPointerDrag, true);
            document.removeEventListener('click', blockDraggedTabClick, true);
            cancelTabPointerDrag();
            dotnet = null;
            endDrag();
            endPan();
            endRangeSelection();
            endResize();
        },
        readClipboard,
        readYoutubeLink,
        startNodeDrag,
        cancelNodeDrag,
        startCanvasPan,
        startRangeSelection,
        startImageResize,
        showEditor,
        openLink: url => window.open(url, '_blank', 'noopener,noreferrer'),
        saveLocal: json => localStorage.setItem('mind-canvas-document', json),
        loadLocal: () => localStorage.getItem('mind-canvas-document'),
        download: (name, text, mimeType = 'application/octet-stream') => {
            const blob = new Blob([text], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = name; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    };
})();
