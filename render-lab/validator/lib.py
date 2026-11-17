# validator/lib.py -- shared helpers + Box registry for the ballroom suite.
# A Box is one element/type slice of the scene (scene_room, furniture,
# scurve, clock, lighting): its run(ctx) contributes checks, its keep list
# drives targeted isolation renders, its shot is the default debug camera.
import math

import bpy
import mathutils

BOXES = {}


class Box:
    def __init__(self, name, shot, keep, run):
        self.name = name
        self.shot = shot            # default SHOTS preset for targeted render
        self.keep = keep            # name globs kept visible when isolating
        self.run = run              # run(ctx) -> None, uses ctx.chk


def register(box):
    BOXES[box.name] = box


class Ctx:
    """Check collector opened against one blend."""

    def __init__(self, box_name):
        self.box = box_name
        self.fails = []
        self.passed = 0

    def chk(self, cond, msg):
        print("[%s] %s %s" % (self.box, "OK  " if cond else "FAIL", msg))
        if cond:
            self.passed += 1
        else:
            self.fails.append("[%s] %s" % (self.box, msg))


def bbox(o):
    """World-axis (lo, hi) lists of an object's bound box."""
    ws = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    lo = [min(v[i] for v in ws) for i in range(3)]
    hi = [max(v[i] for v in ws) for i in range(3)]
    return lo, hi


def dims(o):
    lo, hi = bbox(o)
    return [hi[i] - lo[i] for i in range(3)]


def center(o):
    lo, hi = bbox(o)
    return [(lo[i] + hi[i]) / 2 for i in range(3)]


def image_names(mat):
    if not mat or not mat.node_tree:
        return []
    return [n.image.name for n in mat.node_tree.nodes
            if n.type == "TEX_IMAGE" and n.image]


def principled(mat):
    if not mat or not mat.node_tree:
        return None
    return next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"),
                None)
