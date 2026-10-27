import numpy as np, math, sys
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

W, H = 1920, 1080
rng = np.random.default_rng(7)
VX, VY = 960, 410          # точка схода
EYE, CEIL, HALF = 330.0, 980.0, 1500.0

def fbm(h, w, octaves=((8, 1.0), (20, .5), (50, .25), (120, .12))):
    out = np.zeros((h, w), np.float32)
    for n, a in octaves:
        g = rng.random((max(2, int(n * h / w)), n)).astype(np.float32)
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += a * np.asarray(im, np.float32) / 255
    out -= out.min(); out /= out.max()
    return out

def P(z):  # проекция глубины
    return 1.0 / z

img = np.zeros((H, W, 3), np.float32)

# ---------- небо/дальняя стена ----------
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
base = np.zeros((H, W, 3), np.float32)
t = np.clip(yy / H, 0, 1)
base[..., 0] = 2 + 6 * (1 - t)
base[..., 1] = 5 + 16 * (1 - t)
base[..., 2] = 14 + 40 * (1 - t)
img += base

# ---------- пол ----------
floor_y0 = VY + EYE * P(3.2)
fy = np.clip((yy - floor_y0) / (H - floor_y0), 0, 1)
floor = np.zeros((H, W, 3), np.float32)
f = (yy > floor_y0)
depth = (yy - VY) / np.maximum(EYE, 1)          # ~ 1/z на уровне пола
depth = np.where(f, np.clip(depth, 0.02, 4), 0.0)
z = np.where(f, 1.0 / np.maximum(depth, 0.02), 1)
u = (xx - VX) * z / 1000.0                       # мировая x
v = z                                            # мировая z
tile = (np.abs(((u * 1.2) % 1) - .5) < .012) | (np.abs(((v * 2.0) % 1) - .5) < .012)
sheen = np.exp(-((xx - VX) / 520.0) ** 2) * (0.35 + 0.65 * np.clip(1.4 - fy * 1.6, 0, 1))
fl = np.zeros((H, W, 3), np.float32)
fl[..., 0] = 6 + 18 * sheen; fl[..., 1] = 16 + 52 * sheen; fl[..., 2] = 40 + 120 * sheen
fl *= (0.35 + 0.65 * np.exp(-fy * 1.8))[..., None]
fl[tile & f] += np.array([8, 22, 42], np.float32) * (0.4 + sheen[tile & f, None])
img = np.where(f[..., None], fl, img)

# ---------- колонны, арки (RGBA слои) ----------
scene = Image.new('RGBA', (W, H), (0, 0, 0, 0))
refl = Image.new('RGBA', (W, H), (0, 0, 0, 0))

def pillar(side, z):
    s = P(z)
    cx = VX + side * HALF * s
    w = 250 * s
    top = VY - CEIL * s
    bot = VY + EYE * s
    d = ImageDraw.Draw(scene)
    x0, x1 = int(cx - w / 2), int(cx + w / 2)
    for x in range(x0, x1 + 1):
        k = (x - x0) / max(1, (x1 - x0))
        inner = k if side < 0 else 1 - k          # 1 = край, смотрящий в центр
        flute = 0.78 + 0.22 * math.cos((x - x0) / max(1, (x1 - x0)) * math.pi * 2 * 5)
        lit = inner ** 3.2
        r = (6 + 50 * lit * flute) * (0.7 + 0.3 * inner)
        g = (16 + 125 * lit * flute) * (0.7 + 0.3 * inner)
        b = (40 + 235 * lit * flute) * (0.7 + 0.3 * inner)
        fog = min(1, (z - 1.4) / 9.0)
        r = r * (1 - fog) + 8 * fog; g = g * (1 - fog) + 28 * fog; b = b * (1 - fog) + 78 * fog
        d.line([(x, top), (x, bot)], fill=(int(r), int(g), int(b), 255))
    # база и капитель
    for yb, hh, ex in ((bot - 46 * s * 1.6, 46 * s * 1.6, 0.20), (top, 40 * s * 1.6, 0.18)):
        d.rectangle([x0 - w * ex, yb, x1 + w * ex, yb + hh], fill=(14, 34, 78, 255))
        d.line([(x0 - w * ex, yb), (x1 + w * ex, yb)], fill=(150, 205, 255, 255), width=max(1, int(3 * s * 1.6)))
    # отражение
    hh = int((bot - top) * 0.55); bi = int(bot)
    src = scene.crop((x0, bi - hh, x1 + 1, bi)).transpose(Image.FLIP_TOP_BOTTOM)
    a = np.linspace(0.55, 0.0, hh)[:, None] * np.ones((1, x1 - x0 + 1))
    arr = np.asarray(src, np.float32).copy(); arr[..., 3] *= a
    refl.alpha_composite(Image.fromarray(arr.astype(np.uint8), 'RGBA'), (x0, bi))

def arch(z):
    s = P(z)
    top = VY - CEIL * s
    L, R = VX - HALF * s, VX + HALF * s
    d = ImageDraw.Draw(scene)
    span = R - L
    rise = span * 0.62
    cxL, cxR = L + span * 0.0 + span * 0.5 * 0.0, R
    pts = []
    n = 70
    # стрельчатая арка: две дуги радиуса span
    for i in range(n + 1):
        a = i / n * math.radians(60)
        pts.append((L + span * (1 - math.cos(a)) * 0 + (span * math.sin(a)), top - span * (math.cos(a) - 0.5) * 0.0 - span * (1 - math.cos(a)) * 1.0))
    # левая дуга с центром в правой опоре
    left = [(R - span * math.cos(math.radians(a)), top - span * math.sin(math.radians(a))) for a in np.linspace(0, 60, n)]
    right = [(L + span * math.cos(math.radians(a)), top - span * math.sin(math.radians(a))) for a in np.linspace(0, 60, n)]
    wd = max(2, int(24 * s * 1.6))
    fogk = min(1, (z - 1.4) / 9.0)
    c = (int(40 + 100 * (1 - fogk)), int(100 + 110 * (1 - fogk)), 235, 255)
    d.line(left, fill=(12, 30, 72, 255), width=wd * 2)
    d.line(right, fill=(12, 30, 72, 255), width=wd * 2)
    d.line(left, fill=c, width=max(1, wd // 3))
    d.line(right, fill=c, width=max(1, wd // 3))

zs = [9.5, 6.4, 4.4, 3.0, 2.1, 1.5]
for z in zs:           # от дальних к ближним
    arch(z)
    pillar(-1, z); pillar(1, z)

# ---------- дальний портал ----------
zp = 4.6
s = P(zp)
pw = HALF * s * 0.92
pt = VY - CEIL * s * 0.95
pb = VY + EYE * s
portal = Image.new('RGBA', (W, H), (0, 0, 0, 0))
pd = ImageDraw.Draw(portal)
hw = HALF * s * 0.50
apex = VY - CEIL * s * 1.05
spring = apex + hw * 1.35
poly = [(VX - hw, pb), (VX - hw, spring)]
for t_ in np.linspace(0, 1, 40):
    ang = math.radians(60) * t_
    poly.append((VX + hw * 2 * math.cos(math.radians(60) - ang) * 0 + (VX - hw) + (2 * hw) * 0 + (hw * 2) * (1 - math.cos(ang)) * 0 + (hw * 2 * (math.cos(ang) - 1)) * -1 - hw * 0 if False else (VX - hw) + 2 * hw * (1 - math.cos(math.radians(60) * (1 - t_))) / (1 - math.cos(math.radians(60))) * 0.0, 0))
poly = [(VX - hw, pb), (VX - hw, spring)]
Rr = 2 * hw
for a_ in np.linspace(0, 60, 40):
    poly.append((VX + hw - Rr * math.cos(math.radians(a_)), spring - Rr * math.sin(math.radians(a_))))
for a_ in np.linspace(60, 0, 40):
    poly.append((VX - hw + Rr * math.cos(math.radians(a_)), spring - Rr * math.sin(math.radians(a_))))
poly += [(VX + hw, spring), (VX + hw, pb)]
pd.polygon(poly, fill=(46, 92, 175, 255))
pd.line(poly + [poly[0]], fill=(200, 228, 255, 255), width=5)
scene.alpha_composite(portal)

# собираем слои
layer = np.asarray(scene, np.float32); a = layer[..., 3:4] / 255
rl = np.asarray(refl, np.float32); ra = rl[..., 3:4] / 255 * (yy[..., None] > floor_y0 - 40)
img = img * (1 - ra * 0.9) + rl[..., :3] * ra * 0.9
img = img * (1 - a) + layer[..., :3] * a

# ---------- свечение портала + лучи ----------
dx, dy = xx - VX, yy - (VY - 40)
r = np.sqrt(dx * dx + dy * dy)
glow = np.exp(-(r / 330.0) ** 1.4)
img[..., 0] += 22 * glow; img[..., 1] += 52 * glow; img[..., 2] += 105 * glow

theta = np.arctan2(dy, dx)
ray1d = ndi.gaussian_filter1d(rng.random(1440).astype(np.float32), 2.0, mode='wrap')
ray1d = (ray1d - ray1d.min()) / (ray1d.max() - ray1d.min())
ray1d = np.clip((ray1d - .45) * 2.4, 0, 1) ** 1.5
idx = ((theta + math.pi) / (2 * math.pi) * 1439).astype(int)
rays = ray1d[idx] * np.exp(-r / 880.0) * np.clip(r / 120, 0, 1)
img[..., 0] += 10 * rays; img[..., 1] += 26 * rays; img[..., 2] += 55 * rays

# вертикальные световые столбы сверху
for cx, wd, gain in ((VX - 330, 120, .5), (VX + 300, 90, .4), (VX, 260, .45)):
    col = np.exp(-((xx - cx) / wd) ** 2) * np.clip(1 - yy / 760, 0, 1) ** 1.6
    img[..., 0] += 14 * gain * col; img[..., 1] += 34 * gain * col; img[..., 2] += 70 * gain * col

# ---------- туман ----------
fog = fbm(H, W)
fog2 = fbm(H, W, ((4, 1.0), (12, .6), (30, .3)))
fmask = (0.25 + 0.75 * np.exp(-((yy - 640) / 190.0) ** 2)) * (0.4 + 0.9 * fog) * (0.5 + 0.7 * fog2)
img[..., 0] += 10 * fmask; img[..., 1] += 26 * fmask; img[..., 2] += 54 * fmask

# ---------- блум ----------
lum = img.max(axis=2)
bright = np.clip(img - 175, 0, None)
small = np.stack([ndi.zoom(bright[..., c], .25, order=1) for c in range(3)], -1)
for sg, gain in ((6, .6), (18, .6), (46, .6)):
    bl = np.stack([ndi.gaussian_filter(small[..., c], sg / 4) for c in range(3)], -1)
    bl = np.stack([ndi.zoom(bl[..., c], 4, order=1)[:H, :W] for c in range(3)], -1)
    img += bl * gain

# ---------- цветокор, виньетка, зерно ----------
img = np.clip(img, 0, 255) / 255.0
img = img ** 0.95
vig = 1 - 0.78 * (((xx - W / 2) / (W / 1.35)) ** 2 + ((yy - H / 2) / (H / 1.15)) ** 2)
img *= np.clip(vig, 0.15, 1)[..., None]
img += (rng.normal(0, 0.012, (H, W, 1))).astype(np.float32)
img = np.clip(img, 0, 1)
out = Image.fromarray((img * 255).astype(np.uint8))
out.save(sys.argv[1], quality=88, optimize=True)
print('saved', sys.argv[1])
