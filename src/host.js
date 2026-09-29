export class SillyTavernHost {
    constructor(windowObject = globalThis.window) {
        this.window = windowObject;
        this.subscriptions = [];
        this.generationActive = false;
        this.finalizeScheduled = false;
        this.generationStartSignature = null;
    }

    getContext() {
        const context = this.window?.SillyTavern?.getContext?.();
        if (!context) throw new Error('SillyTavern public context API is unavailable.');
        return context;
    }

    assertAvailable() {
        const context = this.getContext();
        if (!context.eventSource || !context.eventTypes || !Array.isArray(context.chat)) {
            throw new Error('Required SillyTavern event/chat APIs are unavailable.');
        }
        return true;
    }

    getExtensionSettings() {
        const context = this.getContext();
        if (!context.extensionSettings || typeof context.extensionSettings !== 'object') {
            throw new Error('SillyTavern extension settings API is unavailable.');
        }
        return context.extensionSettings;
    }

    saveSettingsDebounced() {
        this.getContext().saveSettingsDebounced?.();
    }

    getChatId() {
        return String(this.getContext().chatId ?? '');
    }

    getMessage(index) {
        const context = this.getContext();
        const message = context.chat?.[Number(index)];
        return message ? this.toCandidate(Number(index), message, context) : null;
    }

    getLatestAssistantMessage() {
        const context = this.getContext();
        for (let index = context.chat.length - 1; index >= 0; index--) {
            const message = context.chat[index];
            if (this.isNarratableAssistant(message)) return this.toCandidate(index, message, context);
        }
        return null;
    }

    isNarratableAssistant(message) {
        return Boolean(message
            && !message.is_user
            && !message.is_system
            && typeof message.mes === 'string'
            && message.mes.trim());
    }

    toCandidate(index, message, context = this.getContext()) {
        if (!this.isNarratableAssistant(message)) return null;
        return {
            chatId: String(context.chatId ?? ''),
            index,
            name: String(message.name ?? ''),
            swipeId: message.swipe_id ?? message.swipeId ?? null,
            text: message.mes,
        };
    }

    subscribe({ onAssistantFinalized, onMutation, onChatChanged, onMessageRendered, onMessagesLoaded }) {
        this.disposeSubscriptions();
        const { eventSource, eventTypes } = this.getContext();
        const on = (event, handler) => {
            if (!event) return;
            eventSource.on(event, handler);
            this.subscriptions.push(() => eventSource.removeListener(event, handler));
        };

        const signature = candidate => candidate
            ? `${candidate.chatId}:${candidate.index}:${candidate.swipeId ?? ''}:${candidate.text}`
            : '';
        const scheduleFinal = ({ requireGenerationChange = false } = {}) => {
            if (this.generationActive || this.finalizeScheduled) return;
            this.finalizeScheduled = true;
            queueMicrotask(() => {
                this.finalizeScheduled = false;
                if (this.generationActive) return;
                const candidate = this.getLatestAssistantMessage();
                if (requireGenerationChange && signature(candidate) === this.generationStartSignature) return;
                onAssistantFinalized?.(candidate);
            });
        };

        on(eventTypes.GENERATION_STARTED, () => {
            this.generationActive = true;
            this.generationStartSignature = signature(this.getLatestAssistantMessage());
        });
        on(eventTypes.GENERATION_ENDED, () => { this.generationActive = false; scheduleFinal({ requireGenerationChange: true }); });
        on(eventTypes.GENERATION_STOPPED, () => { this.generationActive = false; scheduleFinal({ requireGenerationChange: true }); });
        on(eventTypes.MESSAGE_RECEIVED, () => scheduleFinal());
        on(eventTypes.CHARACTER_MESSAGE_RENDERED, messageId => onMessageRendered?.(messageId));
        on(eventTypes.MORE_MESSAGES_LOADED, () => onMessagesLoaded?.());

        const mutationEvents = [
            ['edited', eventTypes.MESSAGE_EDITED],
            ['updated', eventTypes.MESSAGE_UPDATED],
            ['swiped', eventTypes.MESSAGE_SWIPED],
            ['deleted', eventTypes.MESSAGE_DELETED],
        ];
        for (const [kind, event] of mutationEvents) on(event, (...args) => onMutation?.(kind, args));
        on(eventTypes.CHAT_CHANGED, (...args) => onChatChanged?.(args));

        return () => this.disposeSubscriptions();
    }

    disposeSubscriptions() {
        for (const unsubscribe of this.subscriptions.splice(0)) {
            try { unsubscribe(); } catch {}
        }
    }
}
