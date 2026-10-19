/* Datos públicos de los planes (nombres y precios para mostrar). Los links de pago NO están acá:
   se piden a /api/checkout, que exige haber ingresado con Google. */
window.NS_PLANES={
  emprendedor:{nombre:'Nodo Estudio',precio:18000,alta:false,desc:'Para uñas, peluquería, barbería y estética: agenda, señas, cobro, ganancia y el bot de WhatsApp. Sin alta.'},
  /* sin plan en Mercado Pago todavía: «probar» lleva al WhatsApp (ver functions/_lib/plans.js) */
  gastro:{nombre:'Nodo Gastro',precio:18000,alta:false,wa:true,desc:'Para rotiserías y comida para llevar: pedidos por WhatsApp con tu carta, envío o retiro y pago. Sin alta.'},
  pos:{nombre:'Nodo Gestión',precio:35000,alta:false,desc:'Para kioscos y almacenes: caja, stock, proveedores, ganancia y el bot de WhatsApp. Sin alta.'}
  /* «Solo el bot» y «Nodo Gestión + Bot» ya no se ofrecen (2026-10-19): el bot viene incluido en todos los planes. Las
     suscripciones que existen siguen andando. */
};
