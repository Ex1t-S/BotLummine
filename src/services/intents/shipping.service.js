export async function handleShippingIntent() {
  return {
    handled: true,
    forcedReply:
      'Hacemos envíos a todo el país 😊 Si querés, decime de dónde sos y te oriento mejor. El tiempo estimado informado es de hasta 8 días hábiles desde la confirmación del pago.',
    liveOrderContext: null
  };
}