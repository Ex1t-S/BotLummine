import { getOrderByNumber } from './orders.service.js';

export async function getTiendanubeOrderByNumber(number, options = {}) {
	return getOrderByNumber(number, options);
}
