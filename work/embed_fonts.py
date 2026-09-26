import pathlib,re,urllib.request,base64
base=pathlib.Path(__file__).parent
css=(base/'manrope.css').read_text()
def replace(m):
    url=m.group(1)
    data=urllib.request.urlopen(url,timeout=30).read()
    return "url(data:font/ttf;base64,"+base64.b64encode(data).decode()+")"
css=re.sub(r'url\((https://[^)]+)\)',replace,css)
(base/'fonts-embedded.css').write_text(css)
print('Embedded font CSS:',len(css),'bytes')
