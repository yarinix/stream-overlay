import numpy as np, math, sys
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

W, H = 1920, 1080
rng = np.random.default_rng(21)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

def fbm(h, w, octaves=((6, 1.0), (14, .55), (36, .3), (90, .15))):
    out = np.zeros((h, w), np.float32)
    for n, a in octaves:
        g = rng.random((max(2, int(n * h / w)), n)).astype(np.float32)
        out += a * np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), np.float32) / 255
    out -= out.min(); out /= out.max()
    return out

# ---------- небо ----------
t = np.clip(yy / 700, 0, 1)
img = np.zeros((H, W, 3), np.float32)
img[..., 0] = 4 + 22 * t ** 1.5
img[..., 1] = 8 + 40 * t ** 1.5
img[..., 2] = 22 + 84 * t ** 1.3
cl = fbm(H, W, ((4, 1.0), (9, .6), (22, .35), (60, .18)))
cl2 = fbm(H, W, ((3, 1.0), (8, .5), (20, .3)))
clouds = np.clip((cl - .35) * 2.0, 0, 1) * (0.45 + 0.55 * cl2)
sky_mask = np.clip(1 - yy / 760, 0, 1)
img += clouds[..., None] * sky_mask[..., None] * np.array([30, 62, 120], np.float32)
# свечение за башнями
dx, dy = xx - 960, yy - 560
r = np.sqrt(dx * dx + dy * dy)
img += np.exp(-(r / 420) ** 1.3)[..., None] * np.array([55, 105, 190], np.float32)

# ---------- башни ----------
towers = Image.new('L', (W, H), 0)
td = ImageDraw.Draw(towers)
def tower(cx, base_w, top_w, top_y, base_y=780, step=0):
    pts = [(cx - base_w / 2, base_y), (cx - top_w / 2, top_y + 60), (cx - top_w / 2 * .7, top_y + 30), (cx, top_y), (cx + top_w / 2 * .7, top_y + 30), (cx + top_w / 2, top_y + 60), (cx + base_w / 2, base_y)]
    td.polygon(pts, fill=255)
    # уступы
    for k in range(1, 5):
        yk = top_y + 60 + (base_y - top_y - 60) * k / 5
        w = top_w + (base_w - top_w) * k / 5
        td.rectangle([cx - w / 2 - 14, yk - 6, cx + w / 2 + 14, yk + 6], fill=255)
tower(960, 330, 120, -60)
tower(690, 230, 80, 140)
tower(1230, 230, 80, 140)
tower(470, 210, 70, 260)
tower(1450, 210, 70, 260)
tower(300, 180, 60, 360)
tower(1620, 180, 60, 360)
tm = np.asarray(towers, np.float32) / 255
tm = ndi.gaussian_filter(tm, 0.9)
# оттенок башен: тёмные с рим-светом на кромках, обращённых к центру
dist_in = ndi.distance_transform_edt(tm > 0.5).astype(np.float32)
rim = np.exp(-dist_in / 5.0) * (tm > 0.5)
facing = np.clip(1 - np.abs(xx - 960) / 960, 0, 1)
col = np.zeros((H, W, 3), np.float32)
col += np.array([3, 7, 16], np.float32)
col += rim[..., None] * (np.array([40, 95, 190], np.float32) * (0.3 + 0.9 * facing[..., None]))
# окна-щели
wins = np.zeros((H, W), np.float32)
for _ in range(55):
    x = int(rng.normal(960, 330)); y = int(rng.uniform(0, 700))
    if 0 <= x < W - 6 and 0 <= y < H - 30 and tm[y, x] > .9 and rng.random() < .8:
        wins[y:y + int(rng.integers(14, 40)), x:x + 4] = rng.uniform(.25, .7)
col += wins[..., None] * np.array([90, 170, 255], np.float32)
img = img * (1 - tm[..., None]) + col * tm[..., None]

# ---------- ступени ----------
y_top, y_bot = 770, H
stairs = np.zeros((H, W, 3), np.float32)
n_steps = 11
ys = [y_top + (y_bot - y_top) * (i / n_steps) ** 1.55 for i in range(n_steps + 1)]
base_floor = np.zeros((H, W, 3), np.float32)
for i in range(n_steps):
    ya, yb = int(ys[i]), int(ys[i + 1])
    p = (ya - y_top) / (y_bot - y_top)
    half = 330 + 1250 * p
    x0, x1 = int(960 - half), int(960 + half)
    # подступёнок (тёмный) и проступь (светлее, блик от центра)
    face = yb - max(2, int((yb - ya) * .34))
    sheen = np.exp(-((xx[0, :] - 960) / (420 + 700 * p)) ** 2)
    tread = np.stack([10 + 38 * sheen, 20 + 62 * sheen, 40 + 120 * sheen], -1) * (0.5 + .5 * (1 - p))
    riser = np.stack([3 + 8 * sheen, 7 + 18 * sheen, 16 + 40 * sheen], -1)
    base_floor[ya:face, :, :] = tread[None]
    base_floor[face:yb, :, :] = riser[None]
    # золотая кромка
    e = max(1, int(1 + 2.2 * p))
    base_floor[ya:ya + e, :, :] = np.array([235, 200, 130], np.float32) * (0.55 + 0.45 * np.exp(-((xx[0, :] - 960) / 900) ** 2))[None, :, None]
stair_mask = np.zeros((H, W), np.float32)
for i in range(n_steps):
    ya, yb = int(ys[i]), int(ys[i + 1])
    p = (ya - y_top) / (y_bot - y_top)
    half = 330 + 1250 * p
    stair_mask[ya:yb, max(0, int(960 - half)):min(W, int(960 + half))] = 1
stair_mask = ndi.gaussian_filter(stair_mask, 0.8)
# бока площади — тёмный глянцевый камень
side = np.zeros((H, W, 3), np.float32) + np.array([4, 9, 22], np.float32)
img[y_top:] = (side[y_top:] * (1 - stair_mask[y_top:, :, None]) + base_floor[y_top:] * stair_mask[y_top:, :, None])
# горизонт — полоска света
img += np.exp(-((yy - y_top + 4) / 7.0) ** 2)[..., None] * np.exp(-((xx - 960) / 700) ** 2)[..., None] * np.array([210, 190, 150], np.float32) * .6

# ---------- портьеры ----------
def drape(x0, x1, mirror):
    xs = np.arange(x0, x1)
    u = (xs - x0) / (x1 - x0)
    if mirror: u = 1 - u
    fold = 0.5 + 0.5 * np.sin(u * 38 + np.sin(u * 7) * 2)
    fold2 = 0.5 + 0.5 * np.sin(u * 91)
    inner = u ** 2.2                                    # светлее к центру
    vv = np.clip(1 - yy[:, :1] / 1000, 0, 1)
    b = (0.18 + 0.82 * fold * (0.5 + 0.5 * fold2)) * (0.15 + 0.9 * inner)
    a = np.clip((u * 3.2), 0, 1) ** 0.7 if False else np.clip(1.0 - (1 - u) * 0.0, 0, 1)
    block = np.zeros((H, len(xs), 3), np.float32)
    block[..., 0] = (4 + 26 * b[None, :]) * vv
    block[..., 1] = (10 + 70 * b[None, :]) * vv
    block[..., 2] = (30 + 190 * b[None, :]) * vv
    alpha = np.clip((1 - u) * 5.0, 0, 1) if not mirror else np.clip(u * 5.0, 0, 1)
    alpha = np.minimum(alpha, 1.0)
    # нижний край драпировки уходит в пол
    low = np.clip((880 - yy[:, :1]) / 120, 0, 1)
    al = alpha[None, :] * low
    img[:, x0:x1] = img[:, x0:x1] * (1 - al[..., None]) + block * al[..., None]
drape(0, 330, False)
drape(1590, 1920, True)
# золотые карнизы
for x0, x1 in ((0, 330), (1590, 1920)):
    img[60:70, x0:x1] = np.array([170, 140, 80], np.float32) * 0.55

# ---------- свет, туман, блум ----------
glow_c = np.exp(-(((xx - 960) / 520) ** 2 + ((yy - 790) / 120) ** 2))
img += glow_c[..., None] * np.array([26, 56, 104], np.float32)
fog = fbm(H, W)
fm = np.exp(-((yy - 760) / 150) ** 2) * (0.35 + 0.9 * fog)
img += fm[..., None] * np.array([22, 52, 100], np.float32)
bright = np.clip(img - 170, 0, None)
sm = np.stack([ndi.zoom(bright[..., c], .25, order=1) for c in range(3)], -1)
for sg, gn in ((6, .7), (20, .7), (50, .6)):
    bl = np.stack([ndi.gaussian_filter(sm[..., c], sg / 4) for c in range(3)], -1)
    img += np.stack([ndi.zoom(bl[..., c], 4, order=1)[:H, :W] for c in range(3)], -1) * gn

img = np.clip(img, 0, 255) / 255.0
vig = 1 - 0.8 * (((xx - W / 2) / (W / 1.3)) ** 2 + ((yy - H / 2) / (H / 1.1)) ** 2)
img *= np.clip(vig, 0.12, 1)[..., None]
img += rng.normal(0, 0.012, (H, W, 1)).astype(np.float32)
Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(sys.argv[1], quality=88, optimize=True)
print('saved')
