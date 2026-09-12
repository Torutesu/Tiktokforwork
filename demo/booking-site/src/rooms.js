// Hotel Sakura's rooms, rates before tax, per night.
export const ROOMS = [
  { id: 'garden', name: 'Garden Twin', rate: 18000, guests: 2 },
  { id: 'river', name: 'River View Double', rate: 24000, guests: 2 },
  { id: 'suite', name: 'Sakura Suite', rate: 52000, guests: 4 },
];

export function nights(checkIn, checkOut) {
  const ms = new Date(checkOut) - new Date(checkIn);
  return Math.max(0, Math.round(ms / 86400000));
}

export function quote(roomId, checkIn, checkOut) {
  const room = ROOMS.find((r) => r.id === roomId);
  if (!room) throw new Error(`unknown room ${roomId}`);
  const n = nights(checkIn, checkOut);
  return { room, nights: n, subtotal: room.rate * n };
}
