#!/bin/sh
# py.sh <script.py> [args] : python for the picture scripts. This PC's python3 has no numpy and a Pillow whose NEAREST
# resize fails, so: Blender's own python (it has numpy) with Pillow from work/pylib if that is there
#   (<blender>/5.2/python/bin/python3.13 -m pip install --target work/pylib pillow), else python3 with pilfix.py.
HERE="$(cd "$(dirname "$0")" && pwd)"
BP=$(ls -d "$(dirname "$(readlink -f "$(command -v blender)")")"/*/python/bin/python3.* 2>/dev/null | head -1)
if [ -n "$BP" ] && [ -d "$HERE/work/pylib/PIL" ]; then
  PYTHONPATH="$HERE/work/pylib:$HERE" exec "$BP" "$@"
fi
PYTHONPATH="$HERE" exec python3 -c "import pilfix, runpy, sys; sys.argv = sys.argv[1:]; runpy.run_path(sys.argv[0], run_name='__main__')" "$@"
