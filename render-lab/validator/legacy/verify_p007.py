import bpy, mathutils, sys

def bb(o):
    pts=[o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    xs=[p.x for p in pts]; ys=[p.y for p in pts]; zs=[p.z for p in pts]
    return (min(xs),min(ys),min(zs)),(max(xs),max(ys),max(zs))

ok=True
def chk(cond,msg):
    global ok
    print("P7|", "OK " if cond else "FAIL", msg)
    if not cond: ok=False

# clock
c=bpy.data.objects.get("stage_clock")
chk(c is not None,"stage_clock exists")
if c:
    lo,hi=bb(c)
    d=[hi[i]-lo[i] for i in range(3)]
    ctr=[(lo[i]+hi[i])/2 for i in range(3)]
    chk(abs(d[0]-2.4)<0.05 and abs(d[2]-2.4)<0.05,"clock dia 2.4m (got %.2f x %.2f)"%(d[0],d[2]))
    chk(abs(ctr[0])<0.02 and abs(ctr[2]-3.9)<0.02,"clock centered (0,3.9) got (%.2f,%.2f)"%(ctr[0],ctr[2]))
    chk(hi[1]<-4.7 and lo[1]>-5.163,"clock on panel y=(%.3f..%.3f)"%(lo[1],hi[1]))
# panels
chk("stage_panel_wood" in bpy.data.objects,"wood panel exists")
chk("stage_panel_marble" in bpy.data.objects,"marble inset exists")
# floor marble
fm=bpy.data.materials.get("floor")
imgs=[n.image.name for n in fm.node_tree.nodes if n.type=='TEX_IMAGE' and n.image]
chk(any("marble" in i for i in imgs),"floor has marble texture (%s)"%imgs)
# paintings
for i in range(4):
    p=bpy.data.objects.get("painting_%d"%i)
    chk(p is not None,"painting_%d exists"%i)
    if p:
        m=p.data.materials[0]
        ti=[n.image.name for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image]
        chk(len(ti)==1,"painting_%d has image"%i)
        lo,hi=bb(p)
        chk(lo[0]>-9.2 and hi[0]<9.2 and abs(hi[2]-lo[2])>1.4,"painting_%d sized/placed"%i)
# gold frames
for tn in ("trim.001","trim.002","trim.004","trim.005"):
    t=bpy.data.objects[tn]
    chk(t.data.materials and t.data.materials[0].name=="gold","%s gold frame"%tn)
# prior P-004/005/006 checks (spot)
chk(len([o for o in bpy.data.objects if o.name.startswith("lux_chair_")])==32,"32 chairs")
tR=bb(bpy.data.objects["wed_throne_R"])[1][0]; sR=bb(bpy.data.objects["wed_sofa_R"])[0][0]
chk(abs((sR-tR)-0.6096)<0.01,"2ft throne-sofa gap")
print("P7| RESULT:", "ALL PASS" if ok else "FAILURES")
sys.exit(0 if ok else 1)
