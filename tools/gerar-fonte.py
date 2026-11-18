# Gera fonts/bitter.woff a partir do Bitter (OFL), variável 500-800, subconjunto latino.
# Uso: python3 tools/gerar-fonte.py /caminho/Bitter[wght].ttf
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset
f = TTFont(sys.argv[1])
f = instancer.instantiateVariableFont(f, {"wght": (500, 800)})
opts = subset.Options(); opts.flavor = "woff"; opts.layout_features = ["kern", "liga", "lnum", "tnum"]
s = subset.Subsetter(opts)
s.populate(unicodes=list(range(0x20, 0x7F)) + list(range(0xA0, 0x180)) + [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x2713])
s.subset(f)
f.flavor = "woff"; f.save("fonts/bitter.woff")
