"""Repoint a city .blend's textures at the copy beside it, and make the paths
RELATIVE, so the whole pack is self-contained and can be moved.

  blender -b <blend> -P scripts/city/relink_textures.py -- --save

The pack shipped with absolute paths into ~/Downloads. A blend whose textures
have moved renders UNTEXTURED and does not error — flat grey buildings, a
successful exit code, and a published town that looks like a placeholder. This
is run once after moving the pack; `--save` writes the blend in place.
"""
import bpy, sys, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
blend_dir = os.path.dirname(bpy.data.filepath)
tex_dir = os.path.join(blend_dir, "Texture")
if not os.path.isdir(tex_dir):
    raise SystemExit(f"[relink] no Texture/ beside the blend at {blend_dir}")

missing, fixed = [], 0
for img in bpy.data.images:
    if img.source != "FILE" or not img.filepath:
        continue
    name = os.path.basename(img.filepath.replace("\\", "/"))
    target = os.path.join(tex_dir, name)
    if not os.path.exists(target):
        missing.append(name)
        continue
    img.filepath = bpy.path.relpath(target)
    img.reload()
    fixed += 1

print(f"[relink] {fixed} textures repointed at //Texture/")
if missing:
    # Loud, and not a warning: a missing texture renders as flat colour with a
    # zero exit code, so this is the only place it can be noticed.
    raise SystemExit(f"[relink] {len(missing)} textures NOT found in {tex_dir}: {missing[:8]}")

if "--save" in argv:
    bpy.ops.wm.save_mainfile()
    print(f"[relink] saved {bpy.data.filepath}")
