/* Datos públicos de los planes (nombres y precios para mostrar). Los links de pago NO están acá:
   se piden a /api/checkout, que exige haber ingresado con Google. */
window.NS_PLANES={
  pos:{nombre:'Sistema POS',precio:35000,promo:24500,alta:false,desc:'Ventas, cierre de caja, stock y ganancia. Sin alta.'},
  'pos-bot':{nombre:'Sistema + Bot',precio:60000,promo:42000,alta:true,desc:'Todo el sistema y el bot de WhatsApp. Alta del bot: $ 70.000.'},
  bot:{nombre:'Solo el bot',precio:35000,promo:24500,alta:true,desc:'Turnos, precios y pedidos por WhatsApp. Alta: $ 70.000.'},
  emprendedor:{nombre:'Emprendedor',precio:18000,promo:12600,alta:false,desc:'Turnos, agenda, señas y el bot de WhatsApp en el celular (Android). Sin alta.'}
};
