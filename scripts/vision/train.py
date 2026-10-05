"""Trains the 13-class square classifier on synthetic renders and exports weights for
the TypeScript inference in src/lib/vision/local/net.ts.

  python train.py [--holdout set1,set2] [--steps N] [--seed S] [--out squares.bin]
"""
import argparse
import json
import random
import struct
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, IterableDataset

import gen

ap = argparse.ArgumentParser()
ap.add_argument("--holdout", default="")
ap.add_argument("--steps", type=int, default=12000)
ap.add_argument("--batch", type=int, default=256)
ap.add_argument("--out", default="squares.bin")
ap.add_argument("--workers", type=int, default=6)
ap.add_argument("--seed", type=int, default=1)
args = ap.parse_args()
HOLD = [s for s in args.holdout.split(",") if s]


class Boards(IterableDataset):
    def __init__(self, exclude, seed):
        self.exclude, self.seed = exclude, seed

    def __iter__(self):
        info = torch.utils.data.get_worker_info()
        wid = info.id if info else 0
        rng = random.Random(self.seed * 1000 + wid)
        np.random.seed((self.seed * 1000 + wid) % (1 << 31))
        sets = gen.load_sets(self.exclude)
        tex = gen.load_textures()
        while True:
            g = gen.random_grid(rng)
            img, S = gen.render_board(g, sets, tex, rng)
            img = gen.degrade(img, rng)
            crops = gen.squares(img, S, rng)
            order = list(range(64))
            rng.shuffle(order)
            for k in order:
                yield torch.from_numpy(np.ascontiguousarray(crops[k])).permute(2, 0, 1), g[k // 8][k % 8]


class Net(nn.Module):
    # conv3x3 → BN → ReLU blocks; must match net.ts
    CH = [(3, 20), "pool", (20, 40), (40, 40), "pool", (40, 80), "pool"]

    def __init__(self):
        super().__init__()
        layers = []
        for c in self.CH:
            if c == "pool":
                layers.append(nn.MaxPool2d(2))
            else:
                layers += [nn.Conv2d(c[0], c[1], 3, padding=1, bias=False), nn.BatchNorm2d(c[1]), nn.ReLU(inplace=True)]
        self.features = nn.Sequential(*layers)
        self.fc1 = nn.Linear(80 * 4 * 4, 128)
        self.fc2 = nn.Linear(128, 13)
        self.drop = nn.Dropout(0.25)

    def embed(self, x):
        x = self.features(x)
        return F.relu(self.fc1(torch.flatten(x, 1)))

    def forward(self, x):
        return self.fc2(self.drop(self.embed(x)))


def prep(x):
    return x.float() / 255.0


def evaluate(model, X, y, dev):
    model.eval()
    correct = 0
    with torch.no_grad():
        for i in range(0, len(X), 1024):
            xb = prep(torch.from_numpy(X[i : i + 1024]).permute(0, 3, 1, 2)).to(dev)
            correct += (model(xb).argmax(1).cpu().numpy() == y[i : i + 1024]).sum()
    model.train()
    return correct / len(X)


def export(model, path):
    """Folds BN into the convs and writes float16 weights: [magic, n_tensors, then per tensor: ndim, dims..., data]."""
    model.eval()
    tensors = []
    convs = [m for m in model.features if isinstance(m, nn.Conv2d)]
    bns = [m for m in model.features if isinstance(m, nn.BatchNorm2d)]
    for conv, bn in zip(convs, bns):
        w = conv.weight.detach().cpu()
        scale = bn.weight.detach().cpu() / torch.sqrt(bn.running_var.cpu() + bn.eps)
        tensors.append((w * scale[:, None, None, None]).numpy())
        tensors.append((bn.bias.detach().cpu() - bn.running_mean.cpu() * scale).numpy())
    for fc in (model.fc1, model.fc2):
        tensors.append(fc.weight.detach().cpu().numpy())
        tensors.append(fc.bias.detach().cpu().numpy())
    with open(path, "wb") as f:
        f.write(b"WTPS")
        f.write(struct.pack("<I", len(tensors)))
        for t in tensors:
            f.write(struct.pack("<I", t.ndim))
            for d in t.shape:
                f.write(struct.pack("<I", d))
            f.write(t.astype(np.float16).tobytes())
    print("wrote", path, sum(t.size for t in tensors), "params")


def main():
    dev = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    torch.manual_seed(args.seed)
    model = Net().to(dev)
    # validation: unseen boards; if holdout sets are given, only those sets
    if HOLD:
        allsets = gen.load_sets()
        val_exclude = [s for s in allsets if s not in HOLD]
    else:
        val_exclude = []
    Xv, yv = gen.make(120, seed=999, exclude=val_exclude)
    loader = DataLoader(Boards(HOLD, seed=args.seed), batch_size=args.batch, num_workers=args.workers, persistent_workers=True)
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=args.steps, pct_start=0.15)
    t0 = time.time()
    step = 0
    for xb, yb in loader:
        xb, yb = prep(xb).to(dev), yb.to(dev)
        loss = F.cross_entropy(model(xb), yb, label_smoothing=0.05)
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        step += 1
        if step % 1000 == 0 or step == args.steps:
            acc = evaluate(model, Xv, yv, dev)
            print(f"step {step} loss {loss.item():.3f} val {acc:.4f} ({time.time() - t0:.0f}s)", flush=True)
        if step >= args.steps:
            break
    model.cpu()
    torch.save(model.state_dict(), args.out.replace(".bin", ".pt"))
    export(model, args.out)
    json.dump({"classes": gen.CLASSES, "input": 32, "holdout": HOLD}, open(args.out.replace(".bin", ".json"), "w"))


if __name__ == "__main__":
    main()
