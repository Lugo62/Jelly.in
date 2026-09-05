const ADJECTIVES = [
  'Hyper', 'Cyber', 'Neon', 'Cosmic', 'Solar', 'Atomic', 'Glitchy', 'Turbo', 
  'Phantom', 'Vivid', 'Pixel', 'Silly', 'Sonic', 'Astral', 'Midnight'
];

const ANIMALS = [
  'Badger', 'Panda', 'Otter', 'Falcon', 'Lynx', 'Bunny', 'Fox', 'Wolf', 
  'Viper', 'Koala', 'Kitten', 'Dino', 'Hawk', 'Raven', 'Tiger'
];

export const NEON_PALETTE = [
  '#00f0ff', '#39ff14', '#ff007f', '#ffe600', '#b026ff', '#ff5e00', '#00d4ff', '#ff2a85'
];

export function getUserNeonColor(alias) {
  if (!alias) return NEON_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < alias.length; i++) {
    hash = alias.charCodeAt(i) + ((hash << 5) - hash);
  }
  return NEON_PALETTE[Math.abs(hash) % NEON_PALETTE.length];
}

export function getDeviceId() {
  let id = localStorage.getItem('anon_device_id');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    localStorage.setItem('anon_device_id', id);
  }
  return id;
}

export function generateRandomName() {
  const randAdj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const randAnimal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const alias = `${randAdj} ${randAnimal}`;
  return {
    alias,
    avatarChar: randAnimal[0],
    neonColor: getUserNeonColor(alias),
  };
}

export function generate6DigitCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}