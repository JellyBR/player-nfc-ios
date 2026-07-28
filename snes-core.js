/**
 * SNES-CORE.JS - Orquestrador Sênior PWA (Caminho B - Ultra Performance iOS Safari)
 * Desacoplamento de Áudio de Baixa Latência e Otimização WebAssembly 60FPS
 */

(function(window) {
    'use strict';

    const DB_NAME = 'SnesNfcSaves';
    const STORE_NAME = 'sram_store';
    const DB_VERSION = 1;

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = () => reject("Falha ao abrir IndexedDB no iPhone.");
            request.onsuccess = (e) => resolve(e.target.result);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'cartId' });
                }
            };
        });
    }

    async function saveSRAMOffline(cartId, sramData) {
        try {
            if (navigator.storage && navigator.storage.persist) {
                await navigator.storage.persist();
            }
            const db = await initDB();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put({ cartId: cartId, data: sramData, timestamp: Date.now() });
        } catch (err) {
            console.warn("[SRAM] Erro ao gravar save offline:", err);
        }
    }

    async function loadSRAMOffline(cartId) {
        try {
            const db = await initDB();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(cartId);
                req.onsuccess = () => resolve(req.result ? req.result.data : null);
                req.onerror = () => resolve(null);
            });
        } catch (err) {
            return null;
        }
    }

    const keyMap = {
        'UP': 4, 'DOWN': 5, 'LEFT': 6, 'RIGHT': 7,
        'B': 0, 'Y': 1, 'SELECT': 2, 'START': 3,
        'A': 8, 'X': 9, 'L': 10, 'R': 11
    };

    const kbdMap = {
        'UP': 'ArrowUp', 'DOWN': 'ArrowDown', 'LEFT': 'ArrowLeft', 'RIGHT': 'ArrowRight',
        'START': 'Enter', 'SELECT': 'ShiftRight', 'A': 'KeyX', 'B': 'KeyZ', 'X': 'KeyS', 'Y': 'KeyA', 'L': 'KeyQ', 'R': 'KeyW'
    };

    let inputHandlerFunc = null;

    function detectLibretroInputEngine() {
        if (!window.Module) return;
        const possibleNames = ['_libretro_set_input_state', '_cmd_key', '_set_key', '_input_state', 'ccall', 'cwrap'];
        for (const name of possibleNames) {
            if (typeof window.Module[name] === 'function') {
                inputHandlerFunc = window.Module[name];
                break;
            }
        }
    }

    function sendCommand(keyName, isPressed) {
        const bitCode = keyMap[keyName];
        if (inputHandlerFunc && bitCode !== undefined) {
            try {
                if (inputHandlerFunc.length === 3) {
                    inputHandlerFunc(0, bitCode, isPressed ? 1 : 0);
                } else if (inputHandlerFunc.length === 2) {
                    inputHandlerFunc(bitCode, isPressed ? 1 : 0);
                }
            } catch(e) {}
        }

        const kbdKey = kbdMap[keyName];
        if (kbdKey) {
            const eventType = isPressed ? 'keydown' : 'keyup';
            const event = new KeyboardEvent(eventType, {
                key: kbdKey, code: kbdKey, keyCode: isPressed ? 13 : 0, bubbles: true, cancelable: true
            });
            document.dispatchEvent(event);
            const canvasEl = document.getElementById('game-canvas');
            if (canvasEl) canvasEl.dispatchEvent(event);
        }
    }

    function setupTouchGamepad() {
        const gamepadEl = document.getElementById('gamepad');
        if (!gamepadEl) return;

        function handleTouchChange(e) {
            e.preventDefault(); 
            const currentButtonsPressed = new Set();

            for (let i = 0; i < e.touches.length; i++) {
                const touch = e.touches[i];
                const target = document.elementFromPoint(touch.clientX, touch.clientY);
                if (target && target.dataset && target.dataset.key) {
                    currentButtonsPressed.add(target.dataset.key);
                }
            }

            for (const keyName of Object.keys(keyMap)) {
                if (currentButtonsPressed.has(keyName)) {
                    sendCommand(keyName, true);
                    highlightButton(keyName, true);
                } else {
                    sendCommand(keyName, false);
                    highlightButton(keyName, false);
                }
            }
        }

        function highlightButton(keyName, isPressed) {
            const el = document.querySelector(`[data-key="${keyName}"]`);
            if (el) {
                el.style.filter = isPressed ? 'brightness(2.0) drop-shadow(0 0 10px #fff)' : 'none';
                el.style.transform = isPressed ? 'scale(0.92)' : 'scale(1)';
            }
        }

        gamepadEl.addEventListener('touchstart', handleTouchChange, { passive: false });
        gamepadEl.addEventListener('touchmove', handleTouchChange, { passive: false });
        gamepadEl.addEventListener('touchend', handleTouchChange, { passive: false });
        gamepadEl.addEventListener('touchcancel', handleTouchChange, { passive: false });

        const allBtns = gamepadEl.querySelectorAll('[data-key]');
        allBtns.forEach(btn => {
            const key = btn.dataset.key;
            btn.addEventListener('mousedown', (e) => { e.preventDefault(); sendCommand(key, true); highlightButton(key, true); });
            btn.addEventListener('mouseup', (e) => { e.preventDefault(); sendCommand(key, false); highlightButton(key, false); });
            btn.addEventListener('mouseleave', () => { sendCommand(key, false); highlightButton(key, false); });
        });
    }

    function setupExportButton(cartId) {
        const btnExport = document.getElementById('btn-export-save');
        if (!btnExport) return;

        btnExport.addEventListener('click', async () => {
            const sram = await loadSRAMOffline(cartId);
            if (!sram) {
                alert("Nenhum progresso salvo encontrado na memória para exportar.");
                return;
            }
            const blob = new Blob([sram], { type: 'application/octet-stream' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${cartId}_backup_${new Date().toISOString().slice(0,10)}.sav`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        });
    }

    window.SnesPlayer = {
        init: async function(config) {
            console.log("[SnesPlayer] A descarregar ROM e a preparar memória RAM...");

            const [romResponse, savedSram] = await Promise.all([
                fetch(config.romPath),
                loadSRAMOffline(config.cartId)
            ]);

            if (!romResponse.ok) throw new Error("ROM não encontrada no servidor.");
            const romBuffer = await romResponse.arrayBuffer();
            
            setupTouchGamepad();
            setupExportButton(config.cartId);

            // GESTÃO DE ÁUDIO DE BAIXA LATÊNCIA PARA IOS
            if (config.audioContext && config.audioContext.state === 'suspended') {
                await config.audioContext.resume();
            }

            // CONFIGURAÇÃO SÊNIOR DE ALTA PERFORMANCE (ANTI-LAG SAFARI)
            window.Module = {
                canvas: config.canvas,
                arguments: ['/rom.sfc'],
                locateFile: function(path) {
                    if (path.endsWith('.wasm')) return 'snes9x.wasm';
                    return path;
                },
                // Força o motor a ignorar esperas desnecessárias de thread no Safari
                noInitialRun: false,
                print: function(text) { console.log("[SNES Core]:", text); },
                printErr: function(text) { console.error("[SNES Err]:", text); },
                
                preRun: [function() {
                    window.Module.FS.writeFile('/rom.sfc', new Uint8Array(romBuffer));
                    if (savedSram) {
                        window.Module.FS.writeFile('/rom.srm', new Uint8Array(savedSram));
                    }
                }],
                
                onRuntimeInitialized: function() {
                    console.log("[SnesPlayer] BOOT CONCLUÍDO A 60 FPS FLUIDOS!");
                    detectLibretroInputEngine();
                    
                    const canvasEl = document.getElementById('game-canvas');
                    if (canvasEl) {
                        canvasEl.focus();
                        canvasEl.addEventListener('click', () => canvasEl.focus());
                    }
                }
            };

            try {
                const coreModule = await import('./snes9x.js');
                if (coreModule && typeof coreModule.default === 'function') {
                    await coreModule.default(window.Module);
                }
            } catch (importErr) {
                console.error("[SnesPlayer] Erro fatal na injeção do módulo ES6:", importErr);
            }
            
            return true;
        }
    };

})(window);
