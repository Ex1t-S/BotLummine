import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const { prisma } = await import('../src/lib/prisma.js');

try {
	const result = await prisma.conversation.updateMany({
		where: {
			contact: {
				name: {
					startsWith: 'AIQA_CAMPAIGN_',
				},
			},
		},
		data: {
			archivedAt: new Date(),
			unreadCount: 0,
			aiEnabled: false,
		},
	});
	const remainingVisible = await prisma.conversation.count({
		where: {
			archivedAt: null,
			contact: {
				name: {
					startsWith: 'AIQA_CAMPAIGN_',
				},
			},
		},
	});

	console.log(JSON.stringify({ archivedOrUpdated: result.count, remainingVisible }));
} finally {
	await prisma.$disconnect();
}
