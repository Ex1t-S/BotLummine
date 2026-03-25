export async function handleSizeHelpIntent() {
  return {
    handled: true,
    forcedReply:
      'Te ayudo con eso 😊 Decime qué producto viste y, si querés, qué talle usás normalmente así te oriento mejor.',
    liveOrderContext: null
  };
}