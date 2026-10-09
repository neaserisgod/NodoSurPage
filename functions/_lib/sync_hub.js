// Durable Object de la sync: uno por cuenta. Mantiene los WebSockets de los dispositivos de esa cuenta y, cuando
// alguien sube un lote, les avisa a los demás con el número de orden (`{"seq":N}`) para que bajen. No guarda
// datos ni lleva contenido: es solo la campanita.
//
// Cuánto cuesta (Cloudflare, WebSocket Hibernation): conectar es 1 pedido; un socket quieto no consume tiempo de
// cómputo (la clase hiberna); los mensajes salientes y los pings del protocolo no se cobran. Por eso el cliente
// no manda nada por el socket: solo escucha. (Sin `extends DurableObject`: la forma clásica no necesita importar
// `cloudflare:workers`, y se puede probar en Node.)
// Etiqueta de los sockets del bot de WhatsApp. No choca con un id de dispositivo: esos no llevan ":".
const TAG_BOT = 'tipo:bot';

export class SyncHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/avisar') {
      let datos;
      try { datos = await request.json(); } catch { return new Response(null, { status: 400 }); }
      // `mp`: aviso de Mercado Pago de una orden de cobro (`/api/mp/webhook`). Va a TODOS los equipos de la sucursal y
      // solo lleva el id de la orden: cada uno consulta el estado real antes de dar nada por cobrado.
      // `mp.aviso`: cobro, contracargo o reclamo (etapa D); lleva lo mismo que guarda `mp_avisos`, nada de quien pagó.
      // `bot` (`_lib/bot.js`): lo del bot de WhatsApp. `para: 'bots'` (configuración, catálogo, pedido resuelto) va solo a los
      // equipos tipo bot; `para: 'equipos'` (un pedido nuevo) a todos menos los bots. Así un aviso que es del bot no le hace bajar
      // datos de más a la app, que trata como "bajá" lo que no entiende.
      if (datos && datos.bot && ['bots', 'equipos'].includes(datos.bot.para)) {
        const bot = datos.bot.para === 'bots';
        this.enviar(JSON.stringify({ bot: datos.bot.aviso ?? {} }), null, (ws) => this.state.getTags(ws).includes(TAG_BOT) === bot);
      } else if (datos && datos.mp && datos.mp.aviso) this.enviar(JSON.stringify({ mp: { aviso: datos.mp.aviso } }), null, this.noBot);
      else if (datos && datos.mp) this.enviar(JSON.stringify({ mp: { orden: String(datos.mp.orden || ''), accion: String(datos.mp.accion || '') } }), null, this.noBot);
      else this.difundir(datos.seq, datos.de);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/escuchar' && request.headers.get('Upgrade') === 'websocket') return this.aceptar(request);
    return new Response(null, { status: 404 });
  }

  // El Worker ya autenticó al dispositivo; acá solo se anota su id como etiqueta para no avisarle de sus propios lotes, y si es el
  // bot de WhatsApp, para mandarle solo lo suyo.
  aceptar(request) {
    const par = new WebSocketPair();
    const tags = [request.headers.get('X-Dispositivo') || 'desconocido'];
    if (request.headers.get('X-Tipo') === 'bot') tags.push(TAG_BOT);
    this.state.acceptWebSocket(par[1], tags);
    return new Response(null, { status: 101, webSocket: par[0] });
  }

  // Los lotes de la sync y los avisos de Mercado Pago son de la app: el bot no baja lotes.
  noBot = (ws) => !this.state.getTags(ws).includes(TAG_BOT);
  difundir(seq, de) { return this.enviar(JSON.stringify({ seq }), de, this.noBot); }

  enviar(mensaje, de, filtro = null) {
    let enviados = 0;
    for (const ws of this.state.getWebSockets()) {
      if (de && this.state.getTags(ws).includes(de)) continue;
      if (filtro && !filtro(ws)) continue;
      try { ws.send(mensaje); enviados++; } catch { /* socket ya cerrado: se limpia solo */ }
    }
    return enviados;
  }

  // El cliente no manda mensajes. Si llegara uno, se ignora (no vale la pena despertar nada más).
  webSocketMessage() {}
  webSocketClose(ws, code) { try { ws.close(code && code !== 1005 && code !== 1006 ? code : 1000, 'cierre'); } catch { /* ya cerrado */ } }
  webSocketError(ws) { try { ws.close(1011, 'error'); } catch { /* ya cerrado */ } }
}
