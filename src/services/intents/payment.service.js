export async function handlePaymentIntent() {
  const alias = process.env.TRANSFER_ALIAS;
  const cbu = process.env.TRANSFER_CBU;
  const holder = process.env.TRANSFER_HOLDER;
  const bank = process.env.TRANSFER_BANK;
  const extra = process.env.TRANSFER_EXTRA;

  if (!alias && !cbu) {
    return {
      handled: false,
      forcedReply: null
    };
  }

  const lines = [
    'Sí, claro 😊 Te paso los datos para transferencia:'
  ];

  if (alias) lines.push(`Alias: ${alias}`);
  if (cbu) lines.push(`CBU: ${cbu}`);
  if (holder) lines.push(`Titular: ${holder}`);
  if (bank) lines.push(`Banco: ${bank}`);
  if (extra) lines.push(extra);

  return {
    handled: true,
    forcedReply: lines.join('\n'),
    liveOrderContext: null
  };
}