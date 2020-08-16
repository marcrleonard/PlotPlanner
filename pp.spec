# -*- mode: python ; coding: utf-8 -*-

# to run this, type `pyinstaller --clean pp.spec`
# if we want to run ms signing: https://github.com/pyinstaller/pyinstaller/wiki/Recipe-Win-Code-Signing
# this is the redist MAY be needed for windows ... https://www.microsoft.com/en-us/download/confirmation.aspx?id=48145
# we could include it? The dlls are all in: C:\Program Files (x86)\Windows Kits\10\Redist\ucrt\DLLs\x64

import pathlib
import sys


# this is 'hard coded' to get the parent of this current folder
# it will work for our current setup, but if we change where this file is
# this path will have to change.
root_location  = pathlib.Path(os.getcwd())
print(f'Project root -> {root_location}')


dist_location = str(pathlib.Path(root_location, 'src'))
static_location = str(pathlib.Path(root_location, 'public'))




block_cipher = None


a = Analysis(['web_api.py'],
             pathex=[root_location],
             binaries=[],
             datas=[
                (dist_location, 'src'),
                (static_location, 'static')
             ],
             hiddenimports=[],
             hookspath=[],
             runtime_hooks=[],
             excludes=[

             ],
             win_no_prefer_redirects=False,
             win_private_assemblies=False,
             cipher=block_cipher,
             noarchive=False)
pyz = PYZ(a.pure, a.zipped_data,
             cipher=block_cipher)
exe = EXE(pyz,
          a.scripts,
          a.binaries,
          a.zipfiles,
          a.datas,
          [],
          name='PlotPlanner',
          debug=False,
          bootloader_ignore_signals=False,
          strip=False,
          upx=True,
          upx_exclude=[],
          runtime_tmpdir=None,
          console=True,
     #     icon=icon_path
          )


###########
print('complete')
