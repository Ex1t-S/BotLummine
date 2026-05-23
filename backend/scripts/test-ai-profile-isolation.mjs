import assert from 'node:assert/strict';

const {
	AI_PROFILES,
	getAiVerticalProfile,
	resolveAiProfile,
} = await import('../src/services/ai/vertical-profile.service.js');
const {
	inferCommercialFamily,
	scoreProductAgainstCommercialProfile,
} = await import('../src/data/catalog-commercial-map.js');
const {
	DEFAULT_WHATSAPP_MENU_CONFIG,
	INSURANCE_WHATSAPP_MENU_CONFIG,
	LUMMINE_WHATSAPP_MENU_CONFIG,
} = await import('../src/services/whatsapp/whatsapp-menu.service.js');

function menuText(config) {
	return JSON.stringify(config).toLowerCase();
}

assert.equal(
	resolveAiProfile({ workspaceId: 'workspace_lummine', businessName: 'Lummine' }),
	AI_PROFILES.LUMMINE_BODYWEAR
);
assert.equal(
	resolveAiProfile({ workspaceId: 'workspace_ruchi', businessName: 'Ruchi Argentina' }),
	AI_PROFILES.GENERIC_ECOMMERCE
);
assert.equal(
	resolveAiProfile({ workspaceId: 'cmpevb0oq0000pd0pgp66xq6k', businessName: 'DKV Vecindario' }),
	AI_PROFILES.DKV_INSURANCE
);

assert.equal(
	inferCommercialFamily('Quiero ver bodys modeladores', { aiProfile: AI_PROFILES.GENERIC_ECOMMERCE }),
	null
);
assert.equal(
	inferCommercialFamily('Quiero ver bodys modeladores', { aiProfile: AI_PROFILES.LUMMINE_BODYWEAR }),
	'body_modelador'
);
assert.equal(
	scoreProductAgainstCommercialProfile({ name: '3x1 Body modelador' }, 'body_modelador', {
		aiProfile: AI_PROFILES.GENERIC_ECOMMERCE,
	}),
	0
);
assert.ok(
	scoreProductAgainstCommercialProfile({ name: '3x1 Body modelador' }, 'body_modelador', {
		aiProfile: AI_PROFILES.LUMMINE_BODYWEAR,
	}) > 0
);

const genericProfileText = getAiVerticalProfile(AI_PROFILES.GENERIC_ECOMMERCE).basePolicy.toLowerCase();
assert.ok(!/\blummine\b|bodys|calzas/.test(genericProfileText));

const genericMenuText = menuText(DEFAULT_WHATSAPP_MENU_CONFIG);
assert.ok(!/bodys|calzas|talles/.test(genericMenuText));
assert.ok(/catalogo|productos/.test(genericMenuText));

const lummineMenuText = menuText(LUMMINE_WHATSAPP_MENU_CONFIG);
assert.ok(/bodys|calzas|talles/.test(lummineMenuText));

const insuranceMenuText = menuText(INSURANCE_WHATSAPP_MENU_CONFIG);
assert.ok(/seguros|oficina|asesor/.test(insuranceMenuText));
assert.ok(!/bodys|calzas|talles|carrito|checkout/.test(insuranceMenuText));

console.log('AI profile isolation checks passed.');
