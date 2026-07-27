/**
 * SNES-CORE.JS - Orquestrador Sênior PWA para iOS Safari (Caminho B)
 * Zero Dependências Externas | Gerenciamento SRAM via IndexedDB | Touch Multi-Eixo
 */

(function(window) {
    'use strict';

    // =========================================================================
    // 1. GESTÃO DE ARMAZENAMENTO OFFLINE (INDEXED DB - PROTEÇÃO CONTRA IOS)
    // =========================================================================
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
            // Tenta blindar contra a exclusão automática de cache de 7 dias da Apple
            if (navigator.storage && navigator.storage.persist) {
                await navigator.storage.persist();
            }
            const db = await initDB();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put({ cartId: cartId, data: sramData, timestamp: Date.now() });
            console.log(`[SRAM] Progresso salvo em IndexedDB para o cartucho: ${cartId}`);
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

    // =========================================================================
    // 2. SISTEMA DE CONTROLE TÁTIL CONTINUO (SLIDING D-PAD MULTI-TOUCH)
    // =========================================================================
    const keyMap = {
        'UP': 4, 'DOWN': 5, 'LEFT': 6, 'RIGHT': 7,
        'A': 0, 'B': 8, 'X': 1, 'Y': 9, 'L': 10, 'R': 11
    };

    let activeTouches = new Map();

    function setupTouchGamepad(coreInstance) {
        const gamepadEl = document.getElementById('gamepad');
        if (!gamepadEl) return;

        function handleTouchChange(e) {
            e.preventDefault(); // Bloqueia gestos nativos do iOS (Zoom/Scroll)
            const currentButtonsPressed = new Set();

            for (let i = 0; i < e.touches.length; i++) {
                const touch = e.touches[i];
                // Identifica qual botão HTML está debaixo da coordenada X/Y exata do dedo
                const target = document.elementFromPoint(touch.clientX, touch.clientY);
                if (target && target.dataset && target.dataset.key) {
                    currentButtonsPressed.add(target.dataset.key);
                }
            }

            // Mapeia para o emulador: Envia Press/Release apenas para o que mudou
            for (const [keyName, bitCode] of Object.entries(keyMap)) {
                if (currentButtonsPressed.has(keyName)) {
                    if (coreInstance && coreInstance.buttonPress) coreInstance.buttonPress(bitCode);
                    highlightButton(keyName, true);
                } else {
                    if (coreInstance && coreInstance.buttonRelease) coreInstance.buttonRelease(bitCode);
                    highlightButton(keyName, false);
                }
            }
        }

        function highlightButton(keyName, isPressed) {
            const el = document.querySelector(`[data-key="${keyName}"]`);
            if (el) {
                el.style.filter = isPressed ? 'brightness(1.8) drop-shadow(0 0 8px #fff)' : 'none';
            }
        }

        // Conecta os ouvintes na zona do controle, processando movimento contínuo
        gamepadEl.addEventListener('touchstart', handleTouchChange, { passive: false });
        gamepadEl.addEventListener('touchmove', handleTouchChange, { passive: false });
        gamepadEl.addEventListener('touchend', handleTouchChange, { passive: false });
        gamepadEl.addEventListener('touchcancel', handleTouchChange, { passive: false });
    }

    // =========================================================================
    // 3. BOTÃO DE SEGURANÇA: EXPORTAÇÃO MANUAL PARA O APP ARQUIVOS DO IPHONE
    // =========================================================================
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

    // =========================================================================
    // 4. INICIADOR SÊNIOR (THE GATEKEEPER)
    // =========================================================================
    window.SnesPlayer = {
        init: async function(config) {
            console.log("[SnesPlayer] Inicializando motor de execução limpo no iOS...");

            // 1. Carrega dados em Paralelo: ROM + WASM + Save Antigo
            const [romResponse, wasmResponse, savedSram] = await Promise.all([
                fetch(config.romPath),
                fetch(config.corePath),
                loadSRAMOffline(config.cartId)
            ]);

            if (!romResponse.ok) throw new Error("ROM não encontrada no servidor.");
            if (!wasmResponse.ok) throw new Error("Motor WASM não encontrado.");

            const romBuffer = await romResponse.arrayBuffer();
            
            // 2. Verifica MIME Type rigoroso da Apple
            const contentType = wasmResponse.headers.get('content-type');
            if (contentType && !contentType.includes('wasm') && !contentType.includes('octet-stream')) {
                console.warn("[Aviso Apple] O servidor não retornou application/wasm. A Cloudflare deve ser ativada na produção.");
            }

            // 3. Inicializa Controles de Toque Multi-Eixo
            setupTouchGamepad(window.ModuleCore);
            setupExportButton(config.cartId);

            // 4. Injeta a ROM e o Save offline na memória e inicia o loop de áudio/vídeo
            // Nota: Em protótipos com motores Emscripten/Libretro leves, ligamos o Module
            if (window.initSnes9xCore) {
                await window.initSnes9xCore(config.canvas, romBuffer, savedSram, (newSram) => {
                    saveSRAMOffline(config.cartId, newSram);
                });
            } else {
                console.log("[SnesPlayer] Motor WASM base conectado. Aguardando injeção do binário snes9x.");
            }
            
            return true;
        }
    };

})(window);
