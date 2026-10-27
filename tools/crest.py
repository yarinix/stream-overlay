import numpy as np, math, sys
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

S = 640           # рабочий размер, затем уменьшим
SS = 2
N = S * SS
im = Image.new('L', (N, N), 0)
d = ImageDraw.Draw(im)
k = N / 100.0

def poly(pts, fill=255):
    d.polygon([(x * k, y * k) for x, y in pts], fill=fill)

def bez(p0, p1, p2, p3, n=30):
    out = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t * t * p2[0] + t ** 3 * p3[0]
        y = (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t * t * p2[1] + t ** 3 * p3[1]
        out.append((x, y))
    return out

# центральный клинок
poly([(50, 2), (62, 27), (50, 98), (38, 27)])
# крылья (левое, правое зеркально)
def wing(sign):
    def X(x): return 50 + sign * (x - 50)
    top = bez((X(36), 33), (X(24), 30), (X(12), 34), (X(1), 12))
    bot = bez((X(1), 12), (X(4), 44), (X(20), 62), (X(38), 69))
    poly([(X(36), 33)] + top + bot[1:] + [(X(38), 66)])
    # нижние перья
    f = bez((X(41), 71), (X(31), 77), (X(19), 75), (X(9), 66)) + bez((X(9), 66), (X(18), 84), (X(31), 91), (X(45), 87))
    poly(f)
    # средние перья (вырезы)
    for off in (0, 1):
        pass
wing(1); wing(-1)
mask = np.asarray(im, np.float32) / 255.0
mask = ndi.gaussian_filter(mask, 1.2)

# высотная карта: расстояние до края -> фаска
inside = mask > 0.5
dist = ndi.distance_transform_edt(inside).astype(np.float32)
bevel = np.clip(dist / (3.2 * k), 0, 1)
hmap = np.sin(bevel * math.pi / 2) ** 0.8 * 12.0
# центральный гребень клинка
xs = np.arange(N, dtype=np.float32)[None, :]
ridge = np.exp(-((xs - N / 2) / (4.2 * k)) ** 2)
hmap += ridge * 6.0 * (np.arange(N)[:, None] < 98 * k)
hmap += np.clip(dist / (16 * k), 0, 1) ** 0.6 * 34.0
hmap = ndi.gaussian_filter(hmap, 1.4)

gy, gx = np.gradient(hmap)
nz = 1.0
norm = np.sqrt(gx * gx + gy * gy + nz * nz)
nx, ny, nzn = -gx / norm, -gy / norm, nz / norm

# «окружение» металла: вертикальный градиент + два ярких софтбокса
def env(vx, vy, vz):
    t = np.clip(vy * 0.5 + 0.5, 0, 1)                # низ=0, верх=1
    base = 0.06 + 0.95 * t ** 2.2
    box1 = np.exp(-((vx + 0.55) ** 2 + (vy - 0.55) ** 2) / 0.05)
    box2 = np.exp(-((vx - 0.6) ** 2 + (vy + 0.2) ** 2) / 0.04) * 0.6
    return base + 1.3 * box1 + box2

L = np.array([-0.45, -0.55, 0.7]); L /= np.linalg.norm(L)
diff = np.clip(nx * L[0] + ny * L[1] + nzn * L[2], 0, 1)
rx, ry, rz = 2 * nzn * nx, 2 * nzn * ny, 2 * nzn * nzn - 1
refl = env(rx, -ry, rz)
spec = np.clip(nx * L[0] + ny * L[1] + nzn * L[2], 0, 1) ** 30
m = 0.25 * diff + 0.85 * refl + 0.9 * spec

# синевато-серебристая тонировка
r = np.clip(m * 0.82 + 0.03, 0, 1.2)
g = np.clip(m * 0.90 + 0.05, 0, 1.2)
b = np.clip(m * 1.02 + 0.10, 0, 1.2)
# внутренняя вставка клинка — тёмно-синяя эмаль со свечением
inner = Image.new('L', (N, N), 0)
di = ImageDraw.Draw(inner)
di.polygon([(50 * k, 16 * k), (55 * k, 31 * k), (50 * k, 76 * k), (45 * k, 31 * k)], fill=255)
inner = ndi.gaussian_filter(np.asarray(inner, np.float32) / 255, 1.5)
r = r * (1 - inner * .82) + inner * 0.05
g = g * (1 - inner * .82) + inner * 0.22
b = b * (1 - inner * .82) + inner * 0.55
# камень в центре
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
rr = np.sqrt((xx - 50 * k) ** 2 + (yy - 44 * k) ** 2) / k
gem = np.clip(1 - rr / 5.0, 0, 1)
gl = np.clip(1 - rr / 12.0, 0, 1) ** 2
r = r + gl * .12 + gem * .5; g = g + gl * .35 + gem * .8; b = b + gl * .6 + gem * 1.0
# контур-ободок
rim = (mask > 0.02) & (dist < 1.6 * k)
r = np.where(rim, np.maximum(r, 0.75), r); g = np.where(rim, np.maximum(g, .85), g); b = np.where(rim, np.maximum(b, 1.0), b)

rgb = np.stack([r, g, b], -1)
rgb = np.clip(rgb, 0, 1) ** 0.9
alpha = np.clip(mask * 1.0, 0, 1)
out = np.dstack([(rgb * 255).astype(np.uint8), (alpha * 255).astype(np.uint8)])
img = Image.fromarray(out, 'RGBA').resize((S, S), Image.LANCZOS)
img.save(sys.argv[1], optimize=True)
print('ok', img.size)
