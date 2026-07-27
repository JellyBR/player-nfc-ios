/**
 * SNES-CORE.JS - Orquestrador Sênior PWA para iOS Safari (Caminho B - ES6 Modular)
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

            for (const [keyName, bitCode] of Object.entries(keyMap)) {
                if (currentButtonsPressed.has(keyName)) {
                    if (window.Module && window.Module._libretro_set_input_state) {
                        window.Module._libretro_set_input_state(0, bitCode, 1);
                    }
                    highlightButton(keyName, true);
                } else {
                    if (window.Module && window.Module._libretro_set_input_state) {
                        window.Module._libretro_set_input_state(0, bitCode, 0);
                    }
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

        gamepadEl.addEventListener('touchstart', handleTouchChange, { passive: false });
        gamepadEl.addEventListener('touchmove', handleTouchChange, { passive: false });
        gamepadEl.addEventListener('touchend', handleTouchChange, { passive: false });
        gamepadEl.addEventListener('touchcancel', handleTouchChange, { passive: false });
    }

    // =========================================================================
    // 3. BOTÃO DE SEGURANÇA: EXPORTAÇÃO MANUAL PARA O APP ARQUIVOS
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
    // 4. INICIADOR SÊNIOR ES6 MODULE E PONTE EMSCRIPTEN (THE GATEKEEPER)
    // =========================================================================
    window.SnesPlayer = {
        init: async function(config) {
            console.log("[SnesPlayer] Baixando ROM e preparando memória RAM...");

            const [romResponse, savedSram] = await Promise.all([
                fetch(config.romPath),
                loadSRAMOffline(config.cartId)
            ]);

            if (!romResponse.ok) throw new Error("ROM não encontrada no servidor.");
            const romBuffer = await romResponse.arrayBuffer();
            
            setupTouchGamepad();
            setupExportButton(config.cartId);

            console.log("[SnesPlayer] ROM baixada com sucesso (" + (romBuffer.byteLength / 1024 / 1024).toFixed(2) + " MB). Configurando ponte Libretro ES6...");

            // 1. A PONTE MÁGICA: Configuração global do Emscripten
            window.Module = {
                canvas: config.canvas,
                arguments: ['/rom.sfc'],
                locateFile: function(path) {
                    if (path.endsWith('.wasm')) return 'snes9x.wasm';
                    return path;
                },
                print: function(text) { console.log("[SNES Core]:", text); },
                printErr: function(text) { console.error("[SNES Err]:", text); },
                
                preRun: [function() {
                    console.log("[SnesPlayer] Injetando SuperMarioWorld.smc no Sistema de Arquivos Virtual (FS)...");
                    window.Module.FS.writeFile('/rom.sfc', new Uint8Array(romBuffer));
                    
                    if (savedSram) {
                        console.log("[SnesPlayer] Save anterior encontrado! Injetando arquivo .srm...");
                        window.Module.FS.writeFile('/rom.srm', new Uint8Array(savedSram));
                    }
                }],
                
                onRuntimeInitialized: function() {
                    console.log("[SnesPlayer] BOOT CONCLUÍDO COM SUCESSO! O motor Super Nintendo está rodando!");
                }
            };

            // 2. INJEÇÃO ES6 MODULAR (Elimina o erro do import.meta):
            try {
                console.log("[SnesPlayer] Importando módulo ES6 nativo do Snes9x...");
                // A importação dinâmica avisa ao navegador que o arquivo PODE usar 'import.meta'
                const coreModule = await import('./snes9x.js');
                
                // Se o compilador gerou uma função fábrica de módulo (Padrão Emscripten MODULARIZE=1)
                if (coreModule && typeof coreModule.default === 'function') {
                    console.log("[SnesPlayer] Executando Factory Function do Emscripten...");
                    await coreModule.default(window.Module);
                } else {
                    console.log("[SnesPlayer] Módulo ES6 global acionado com sucesso.");
                }
            } catch (importErr) {
                console.error("[SnesPlayer] Erro fatal na injeção do módulo ES6:", importErr);
                alert("Erro de arquitetura no navegador. Verifique os logs de módulo.");
            }
            
            return true;
        }
    };

})(window);
