import { createSocket } from 'node:dgram';

// RFC 8489 Binding responder for same-machine tests. It only reports the source
// address of the requesting UDP socket; it cannot relay media or accept TURN.
export async function startStun() {
  const socket = createSocket('udp4');
  socket.on('message', (message, remote) => {
    if (message.length < 20 || message.length > 1024 || message.readUInt16BE(0) !== 1 || message.readUInt32BE(4) !== 0x2112a442) return;
    const response = Buffer.alloc(32);
    response.writeUInt16BE(0x0101, 0);
    response.writeUInt16BE(12, 2);
    message.copy(response, 4, 4, 20);
    response.writeUInt16BE(0x0020, 20);
    response.writeUInt16BE(8, 22);
    response[25] = 1;
    response.writeUInt16BE(remote.port ^ 0x2112, 26);
    remote.address.split('.').forEach((octet, i) => { response[28 + i] = Number(octet) ^ response[4 + i]; });
    socket.send(response, remote.port, remote.address);
  });
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.bind(0, '127.0.0.1', resolve); });
  return {
    url: `stun:127.0.0.1:${socket.address().port}`,
    close: () => new Promise(resolve => socket.close(resolve)),
  };
}
