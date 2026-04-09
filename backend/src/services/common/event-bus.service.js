import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export function publishEvent(eventName, payload) {
	emitter.emit(eventName, payload);
}

export function subscribeEvent(eventName, handler) {
	emitter.on(eventName, handler);
	return () => emitter.off(eventName, handler);
}

export function subscribeOnce(eventName, handler) {
	emitter.once(eventName, handler);
	return () => emitter.off(eventName, handler);
}

export function unsubscribeEvent(eventName, handler) {
	emitter.off(eventName, handler);
}

export function getEventBus() {
	return emitter;
}
