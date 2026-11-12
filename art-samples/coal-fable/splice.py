import sys
s = open('coal.py').read()
a = s.index("TOP = {1: 4.0")
b = s.index("_border = kit.border_of")
s = s[:a] + open(sys.argv[1]).read() + s[b:]
open('coal.py', 'w', newline='\n').write(s)
