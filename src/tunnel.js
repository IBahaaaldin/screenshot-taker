// src/tunnel.js
import localtunnel from 'localtunnel';

export async function startTunnel(port, localtunnelImpl = localtunnel) {
  const tunnel = await localtunnelImpl({ port });
  return {
    url: tunnel.url,
    close: () => tunnel.close(),
  };
}
