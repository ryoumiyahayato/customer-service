export type InviteQrStyle = {
  backgroundColor: string;
  accentColor: string;
  topText: string;
  bottomText: string;
};

const VERSION = 5;
const SIZE = 17 + VERSION * 4;
const DATA_CODEWORDS = 108;
const ECC_CODEWORDS = 26;
const MAX_BYTES = 106;

const gfExp = new Uint8Array(512);
const gfLog = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < gfExp.length; i += 1) gfExp[i] = gfExp[i - 255];
}

function gfMultiply(a: number, b: number) {
  if (!a || !b) return 0;
  return gfExp[gfLog[a] + gfLog[b]];
}

function reedSolomonGenerator(degree: number) {
  let result = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(result.length + 1).fill(0);
    for (let j = 0; j < result.length; j += 1) {
      next[j] ^= result[j];
      next[j + 1] ^= gfMultiply(result[j], gfExp[i]);
    }
    result = next;
  }
  return result;
}

const RS_GENERATOR = reedSolomonGenerator(ECC_CODEWORDS);

function reedSolomonRemainder(data: number[]) {
  const result = new Array(ECC_CODEWORDS).fill(0);
  for (const value of data) {
    const factor = value ^ result[0];
    result.shift();
    result.push(0);
    for (let i = 0; i < result.length; i += 1) {
      result[i] ^= gfMultiply(RS_GENERATOR[i + 1], factor);
    }
  }
  return result;
}

function appendBits(out: number[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i -= 1) out.push((value >>> i) & 1);
}

function encodeData(text: string) {
  const bytes = Array.from(new TextEncoder().encode(text));
  if (bytes.length > MAX_BYTES) throw new Error(`二维码链接过长（最多 ${MAX_BYTES} 字节）`);
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const value of bytes) appendBits(bits, value, 8);
  const capacity = DATA_CODEWORDS * 8;
  appendBits(bits, 0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    data.push(value);
  }
  for (let pad = 0; data.length < DATA_CODEWORDS; pad += 1) {
    data.push(pad % 2 === 0 ? 0xec : 0x11);
  }
  return [...data, ...reedSolomonRemainder(data)];
}

function formatBits(mask: number) {
  const data = (1 << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) * 0x537);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

export function buildQrMatrix(text: string) {
  const codewords = encodeData(text);
  const modules: boolean[][] = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  const isFunction: boolean[][] = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  const setFunction = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };
  const drawFinder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(cx + dx, cy + dy, dist !== 2 && dist !== 4);
      }
    }
  };
  const drawAlignment = (cx: number, cy: number) => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };

  drawFinder(3, 3);
  drawFinder(SIZE - 4, 3);
  drawFinder(3, SIZE - 4);
  for (let i = 8; i < SIZE - 8; i += 1) {
    if (!isFunction[6][i]) setFunction(i, 6, i % 2 === 0);
    if (!isFunction[i][6]) setFunction(6, i, i % 2 === 0);
  }
  drawAlignment(30, 30);

  const firstFormat: [number, number][] = [];
  for (let i = 0; i <= 5; i += 1) firstFormat.push([8, i]);
  firstFormat.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i += 1) firstFormat.push([14 - i, 8]);
  const secondFormat: [number, number][] = [];
  for (let i = 0; i < 8; i += 1) secondFormat.push([SIZE - 1 - i, 8]);
  for (let i = 8; i < 15; i += 1) secondFormat.push([8, SIZE - 15 + i]);
  for (const [x, y] of [...firstFormat, ...secondFormat]) setFunction(x, y, false);
  setFunction(8, SIZE - 8, true);

  const dataBits: number[] = [];
  for (const value of codewords) appendBits(dataBits, value, 8);
  let bitIndex = 0;
  let upward = true;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let offset = 0; offset < SIZE; offset += 1) {
      const y = upward ? SIZE - 1 - offset : offset;
      for (let dx = 0; dx < 2; dx += 1) {
        const x = right - dx;
        if (isFunction[y][x]) continue;
        const bit = bitIndex < dataBits.length ? dataBits[bitIndex] === 1 : false;
        bitIndex += 1;
        modules[y][x] = bit !== ((x + y) % 2 === 0);
      }
    }
    upward = !upward;
  }

  const fmt = formatBits(0);
  firstFormat.forEach(([x, y], i) => { modules[y][x] = ((fmt >>> i) & 1) !== 0; });
  secondFormat.forEach(([x, y], i) => { modules[y][x] = ((fmt >>> i) & 1) !== 0; });
  modules[SIZE - 8][8] = true;
  return modules;
}

function normalizeColor(value: string, fallback: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function drawCenteredText(ctx: CanvasRenderingContext2D, text: string, y: number, width: number, color: string) {
  const value = text.trim();
  if (!value) return;
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  const maxWidth = width - 56;
  let shown = value;
  while (shown.length > 1 && ctx.measureText(shown).width > maxWidth) shown = shown.slice(0, -1);
  if (shown !== value) shown = `${shown.slice(0, Math.max(1, shown.length - 1))}…`;
  ctx.fillText(shown, width / 2, y);
}

function textColorForBackground(hex: string) {
  const value = normalizeColor(hex, '#ffffff').slice(1);
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.58 ? '#111827' : '#ffffff';
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function validMatrix(matrix: boolean[][] | null | undefined) {
  return Boolean(matrix?.length && matrix.every(row => Array.isArray(row) && row.length === matrix.length));
}

export function renderInviteQr(
  canvas: HTMLCanvasElement,
  url: string,
  style: InviteQrStyle,
  matrixOverride?: boolean[][] | null,
) {
  const matrix = validMatrix(matrixOverride) ? matrixOverride! : url ? buildQrMatrix(url) : null;
  const quiet = 4;
  const modulePx = 8;
  const matrixSize = matrix?.length || SIZE;
  const qrPx = (matrixSize + quiet * 2) * modulePx;
  const topHeight = 78;
  const bottomHeight = 72;
  const width = Math.max(400, qrPx + 56);
  const height = topHeight + qrPx + bottomHeight;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持二维码画布');

  const background = normalizeColor(style.backgroundColor, '#ffffff');
  const accent = normalizeColor(style.accentColor, '#18b868');
  const cardInset = 5;
  const borderWidth = 8;
  const radius = 28;
  const bandTop = topHeight + qrPx;

  ctx.clearRect(0, 0, width, height);
  roundedRectPath(ctx, cardInset, cardInset, width - cardInset * 2, height - cardInset * 2, radius);
  ctx.fillStyle = background;
  ctx.fill();

  ctx.save();
  roundedRectPath(ctx, cardInset, cardInset, width - cardInset * 2, height - cardInset * 2, radius);
  ctx.clip();
  ctx.fillStyle = accent;
  ctx.fillRect(cardInset, bandTop, width - cardInset * 2, height - bandTop - cardInset);
  ctx.restore();

  roundedRectPath(ctx, cardInset, cardInset, width - cardInset * 2, height - cardInset * 2, radius);
  ctx.lineWidth = borderWidth;
  ctx.strokeStyle = accent;
  ctx.stroke();

  drawCenteredText(ctx, style.topText, topHeight / 2 + 4, width, textColorForBackground(background));

  if (matrix) {
    const startX = Math.floor((width - qrPx) / 2) + quiet * modulePx;
    const startY = topHeight + quiet * modulePx;
    ctx.fillStyle = '#000000';
    for (let y = 0; y < matrix.length; y += 1) {
      for (let x = 0; x < matrix.length; x += 1) {
        if (matrix[y][x]) ctx.fillRect(startX + x * modulePx, startY + y * modulePx, modulePx, modulePx);
      }
    }
  } else {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 18px system-ui, sans-serif';
    ctx.fillText('生成邀请后在这里显示二维码', width / 2, topHeight + qrPx / 2);
  }

  drawCenteredText(ctx, style.bottomText, bandTop + bottomHeight / 2 - 1, width, textColorForBackground(accent));
}
