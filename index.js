import { SillyTavernHost } from './src/host.js';
import { SettingsStore, CheckpointStore } from './src/settings.js';
import { createAudioSlotFactory, installMediaSession } from './src/media.js';
import { NarratorController } from './src/narrator.js';
import { NarratorUI } from './src/ui.js';

let app = null;

export async function init() {
    if (app) return;

    const host = new SillyTavernHost();
    host.assertAvailable();
    const settingsStore = new SettingsStore(host);
    settingsStore.load();
    const controller = new NarratorController({
        host,
        settingsStore,
        checkpointStore: new CheckpointStore(),
        mediaFactory: createAudioSlotFactory(),
    });
    const ui = new NarratorUI({ host, settingsStore, controller });
    ui.mount();

    const unsubscribeHost = host.subscribe({
        onAssistantFinalized: candidate => controller.handleAssistantFinalized(candidate),
        onMutation: kind => controller.handleHostMutation(kind),
        onMessageRendered: index => ui.syncMessageButton(index),
        onMessagesLoaded: () => ui.syncMessageButtons(),
        onChatChanged: () => {
            controller.handleChatChanged();
            queueMicrotask(() => ui.syncMessageButtons());
        },
    });
    const uninstallMediaSession = installMediaSession(controller);
    const onVisibility = () => controller.onVisibilityChange(document.visibilityState);
    document.addEventListener('visibilitychange', onVisibility);

    app = {
        host,
        controller,
        ui,
        dispose: async () => {
            unsubscribeHost?.();
            host.disposeSubscriptions();
            uninstallMediaSession?.();
            document.removeEventListener('visibilitychange', onVisibility);
            ui.dispose();
            await controller.dispose();
        },
    };

    await controller.tryRestoreCheckpoint();
}

export async function dispose() {
    if (!app) return;
    const current = app;
    app = null;
    await current.dispose();
}
