# MuJoCo Menagerie preview renders

The images in `public/img/menagerie/` are the preview renders from MuJoCo Menagerie
(https://github.com/google-deepmind/mujoco_menagerie), one per model folder of the same name.

Modified: each original PNG was resized to 800px wide and converted to WebP (quality 80).
No other changes were made.

Each model's licence and copyright notice is in `<model-id>.txt` in this folder, copied unchanged
from that model's folder in the Menagerie repository.

# MuJoCo Menagerie model files

The MJCF and mesh files under `public/models/menagerie/` are downloaded by `scripts/fetch-menagerie.mjs`
from the same model folders (pinned commit) and are not committed. They are unmodified and covered by the
same per-model licence files in this folder.
